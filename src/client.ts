// EDC Web API v1 の HTTP リクエストのラッパー(docs/contract.md)。
// サーバーからサーバーへ呼ぶためのもの。資格情報は、エラーのメッセージにも中身にも含めない。
import type { z } from "zod";
import {
  type CreateAnalysisRequest,
  CreateAnalysisRequestSchema,
  type CreateAnalysisResponse,
  CreateAnalysisResponseSchema,
  type StoredAnalysis,
  StoredAnalysisSchema,
} from "./contract.js";
import { type ApiErrorCode, ApiErrorBodySchema } from "./errors.js";

/** ラッパーだけが使う code(サーバーは返さない) */
export const CLIENT_ERROR_CODES = ["network", "timeout", "aborted", "invalid_response"] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

/** 知らない code(サーバーが後から増やしたもの)も文字列のまま渡す */
export type EdcErrorCode = ApiErrorCode | ClientErrorCode | (string & {});

export class EdcApiError extends Error {
  override readonly name = "EdcApiError";
  readonly code: EdcErrorCode;
  /** HTTP の状態コード。応答がなかったときは undefined */
  readonly status: number | undefined;
  readonly retryable: boolean;
  /** 次に試してよい日時(ISO 8601) */
  readonly retryAt: string | undefined;

  constructor(init: {
    code: EdcErrorCode;
    message: string;
    retryable: boolean;
    status?: number | undefined;
    retryAt?: string | undefined;
    cause?: unknown;
  }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.code = init.code;
    this.status = init.status;
    this.retryable = init.retryable;
    this.retryAt = init.retryAt;
  }

  toJSON(): Record<string, unknown> {
    return { name: this.name, code: this.code, message: this.message, status: this.status, retryable: this.retryable, retryAt: this.retryAt };
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** 資格情報: API キー、または ID トークンなどを返す関数(リクエストのたびに呼ぶ) */
export type Credential = string | (() => string | Promise<string>);

export type EdcClientOptions = {
  /** API の基点(`/v1` の手前まで)。https か、エミュレータ用の http://localhost・127.0.0.1 */
  baseUrl: string;
  credential: Credential;
  /** 既定は globalThis.fetch */
  fetch?: FetchLike;
  /** 1回のリクエストの制限時間(ミリ秒)。既定は 120 秒(LLM の生成を待つため) */
  timeoutMs?: number;
  /** 応答の本文の大きさの上限(バイト)。既定は 4 MiB。超えたら読むのをやめて invalid_response */
  maxResponseBytes?: number;
};

export type RequestOptions = { signal?: AbortSignal };
export type CreateOptions = RequestOptions & {
  /** 送り直し用のキー(UUID)。省くと自動で作る */
  idempotencyKey?: string;
};

const DEFAULT_TIMEOUT_MS = 120_000;
// 入力の上限(10 万文字、UTF-8 で約 300 KB)と story を足しても十分に収まる大きさ
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
// AbortSignal.timeout と setTimeout が扱える最大(約 24.8 日)
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Authorization ヘッダーに入れられる文字(空白・改行・制御文字・ASCII 以外を除く)
const HEADER_TOKEN = /^[\x21-\x7e]+$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TypeError("baseUrl が URL ではありません");
  }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
  if (!secure) throw new TypeError("baseUrl は https にしてください(http はエミュレータの localhost だけ)");
  if (url.username || url.password) throw new TypeError("baseUrl に資格情報を含めないでください");
  if (url.search || url.hash) throw new TypeError("baseUrl にクエリやフラグメントを含めないでください");
  return url.href.replace(/\/+$/, "");
}

const invalidArgument = (message: string) => new EdcApiError({ code: "invalid_argument", message, retryable: false });

function requireId(id: string): string {
  if (typeof id !== "string" || id.length === 0) throw invalidArgument("id を指定してください");
  // "." と ".." は URL の正規化で上の階層を指してしまう(DELETE /v1/analyses/.. が DELETE /v1/ になる)
  if (id === "." || id === "..") throw invalidArgument("id が正しくありません");
  try {
    return encodeURIComponent(id);
  } catch {
    // 対になっていないサロゲートは URIError になる
    throw invalidArgument("id が正しくありません");
  }
}

function requirePositiveInteger(name: string, value: number, max: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    throw new RangeError(`${name} は 1 以上 ${max} 以下の整数にしてください`);
  }
  return value;
}

/** 本文を上限まで読む。超えたら null(読むのをやめる) */
async function readText(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export class EdcClient {
  readonly analyses: {
    /** 分析する(POST /v1/analyses) */
    create(request: CreateAnalysisRequest, options?: CreateOptions): Promise<CreateAnalysisResponse>;
    /** 保存したものを読む(GET /v1/analyses/{id}) */
    get(id: string, options?: RequestOptions): Promise<StoredAnalysis>;
    /** 取り下げる(DELETE /v1/analyses/{id}) */
    delete(id: string, options?: RequestOptions): Promise<void>;
  };

  readonly #baseUrl: string;
  readonly #credential: Credential;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;

  /** 設定の誤りは、作るときに TypeError・RangeError で知らせる(リクエストの失敗は EdcApiError) */
  constructor(options: EdcClientOptions) {
    this.#baseUrl = parseBaseUrl(options.baseUrl);
    if (typeof options.credential !== "string" && typeof options.credential !== "function") {
      throw new TypeError("credential は文字列か、文字列を返す関数にしてください");
    }
    this.#credential = options.credential;
    if (options.fetch !== undefined && typeof options.fetch !== "function") {
      throw new TypeError("fetch は関数にしてください");
    }
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#timeoutMs = requirePositiveInteger("timeoutMs", options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    this.#maxResponseBytes = requirePositiveInteger(
      "maxResponseBytes",
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      Number.MAX_SAFE_INTEGER,
    );

    this.analyses = {
      create: async (request, options = {}) => {
        const body = CreateAnalysisRequestSchema.safeParse(request);
        if (!body.success) throw invalidArgument("リクエストが契約に合いません");
        const idempotencyKey = options.idempotencyKey ?? globalThis.crypto.randomUUID();
        if (typeof idempotencyKey !== "string" || !UUID.test(idempotencyKey)) {
          throw invalidArgument("idempotencyKey は UUID にしてください");
        }
        const response = await this.#send(
          "POST",
          "/v1/analyses",
          options,
          CreateAnalysisResponseSchema,
          body.data,
          idempotencyKey,
        );
        // サーバーは頼んだ範囲のとおりに保存する。違えば、サーバーの不具合として知らせる
        if (response.stored !== body.data.store) {
          throw new EdcApiError({
            code: "invalid_response",
            message: "API の応答が契約に合いません(保存の範囲が頼んだものと違います)",
            retryable: false,
            status: 200,
          });
        }
        return response;
      },
      get: async (id, options = {}) =>
        this.#send("GET", `/v1/analyses/${requireId(id)}`, options, StoredAnalysisSchema),
      delete: async (id, options = {}) => {
        await this.#send("DELETE", `/v1/analyses/${requireId(id)}`, options, null);
      },
    };
  }

  async #authorization(): Promise<string> {
    let value: unknown;
    try {
      value = typeof this.#credential === "function" ? await this.#credential() : this.#credential;
    } catch (cause) {
      throw new EdcApiError({ code: "unauthenticated", message: "資格情報を取得できませんでした", retryable: false, cause });
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new EdcApiError({ code: "unauthenticated", message: "資格情報が空です", retryable: false });
    }
    // 値はメッセージに含めない
    if (!HEADER_TOKEN.test(value)) {
      throw new EdcApiError({ code: "unauthenticated", message: "資格情報に使えない文字が含まれています", retryable: false });
    }
    return `Bearer ${value}`;
  }

  async #send<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    options: RequestOptions,
    schema: z.ZodType<T> | null,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const caller = options.signal;
    if (caller?.aborted) throw new EdcApiError({ code: "aborted", message: "中断されました", retryable: false, cause: caller.reason });

    const headers = new Headers({ Accept: "application/json", Authorization: await this.#authorization() });
    if (body !== undefined) headers.set("Content-Type", "application/json; charset=utf-8");
    if (idempotencyKey !== undefined) headers.set("Idempotency-Key", idempotencyKey);

    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const signal = caller ? AbortSignal.any([caller, timeout]) : timeout;
    const failure = (cause: unknown): EdcApiError => {
      if (caller?.aborted) return new EdcApiError({ code: "aborted", message: "中断されました", retryable: false, cause: caller.reason });
      if (timeout.aborted) return new EdcApiError({ code: "timeout", message: "時間内に応答がありませんでした", retryable: true });
      return new EdcApiError({ code: "network", message: "API に接続できませんでした", retryable: true, cause });
    };

    let response: Response;
    let text: string | null;
    try {
      // 資格情報を待つ間に中断・時間切れになっていたら、fetch に渡さずに終える
      signal.throwIfAborted();
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers,
        signal,
        // リダイレクトは追わない(別のホストへ資格情報や DELETE を送らない。API はリダイレクトを返さない)
        redirect: "manual",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      // 差し替えた fetch が redirect を守らなかった場合も、成功として扱わない
      const redirected =
        response.redirected || response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
      if (redirected) {
        await response.body?.cancel().catch(() => {});
        text = null;
      } else {
        text = await readText(response, this.#maxResponseBytes);
      }
    } catch (cause) {
      throw failure(cause);
    }

    const status = response.status;
    const invalidResponse = () =>
      new EdcApiError({
        code: "invalid_response",
        message: "API の応答が契約に合いません",
        retryable: status >= 500 || status === 429,
        status,
      });

    // リダイレクト、または本文が上限を超えた
    if (text === null) throw invalidResponse();

    if (response.ok && schema === null) {
      if (status === 204 || text === "") return undefined as T;
      throw invalidResponse();
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw invalidResponse();
    }

    if (!response.ok) {
      const parsed = ApiErrorBodySchema.safeParse(json);
      if (!parsed.success) throw invalidResponse();
      const { code, message, retryable, retryAt } = parsed.data.error;
      throw new EdcApiError({ code, message, retryable, status, retryAt });
    }

    const parsed = schema === null ? null : schema.safeParse(json);
    if (!parsed?.success) throw invalidResponse();
    return parsed.data;
  }
}
