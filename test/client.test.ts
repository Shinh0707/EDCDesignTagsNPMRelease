import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { EdcApiError, EdcClient, type FetchLike } from "../src/index.js";

const analysisOutput = JSON.parse(
  readFileSync(new URL("./fixtures/analysis-output.json", import.meta.url), "utf8"),
) as { story: string; design_tags: unknown[] };

const meta = {
  model: "gemini-3.8-flash",
  generation: { temperature: 0.5 },
  promptVersion: "3.0.0",
  schemaVersion: "3.0.0",
  inputNormalizationVersion: "1",
  apiVersion: "1.0.0",
  generatedAt: "2026-09-26T03:00:00.000Z",
  usage: { inputTokens: 1200, outputTokens: 800, thoughtsTokens: 0 },
};
const created = { id: "an_1", stored: "tags", output: analysisOutput, meta };
// ダミーの資格情報(キーの形にしない。pre-commit の検査対象になるため)
const TOKEN = "dummy-credential-for-tests-0123456789";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** 呼ばれた内容を記録し、決めた応答を返す fetch */
function fakeFetch(respond: () => Response | Promise<Response>) {
  return vi.fn<FetchLike>(async () => respond());
}

function lastCall(fetch: ReturnType<typeof fakeFetch>) {
  const call = fetch.mock.calls.at(-1);
  if (!call) throw new Error("fetch が呼ばれていない");
  const [url, init] = call;
  return { url: String(url), init: init ?? {}, headers: new Headers(init?.headers) };
}

async function catchError(promise: Promise<unknown>): Promise<EdcApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EdcApiError) return error;
    throw error;
  }
  throw new Error("失敗しなかった");
}

describe("EdcClient の作成", () => {
  it("https の基点を受け付ける。末尾の / と、基点のパスはそのまま使う", async () => {
    const fetch = fakeFetch(() => json(200, created));
    const client = new EdcClient({ baseUrl: "https://api.example.com/edc/", credential: TOKEN, fetch });
    await client.analyses.create({ text: "本文", store: "tags" });
    expect(lastCall(fetch).url).toBe("https://api.example.com/edc/v1/analyses");
  });

  it("http はエミュレータ用の localhost・127.0.0.1 だけ受け付ける", () => {
    const fetch = fakeFetch(() => json(200, created));
    expect(() => new EdcClient({ baseUrl: "http://localhost:5001/p", credential: TOKEN, fetch })).not.toThrow();
    expect(() => new EdcClient({ baseUrl: "http://127.0.0.1:5001", credential: TOKEN, fetch })).not.toThrow();
    expect(() => new EdcClient({ baseUrl: "http://api.example.com", credential: TOKEN, fetch })).toThrow(TypeError);
    expect(() => new EdcClient({ baseUrl: "ftp://api.example.com", credential: TOKEN, fetch })).toThrow(TypeError);
    expect(() => new EdcClient({ baseUrl: "not a url", credential: TOKEN, fetch })).toThrow(TypeError);
  });

  it("基点にクエリや資格情報を含められない", () => {
    const fetch = fakeFetch(() => json(200, created));
    expect(() => new EdcClient({ baseUrl: "https://u:p@api.example.com", credential: TOKEN, fetch })).toThrow(TypeError);
    expect(() => new EdcClient({ baseUrl: "https://api.example.com?key=1", credential: TOKEN, fetch })).toThrow(
      TypeError,
    );
  });
});

describe("analyses.create(POST /v1/analyses)", () => {
  it("JSON で送り、Bearer の資格情報と Idempotency-Key(自動の UUID)を付ける", async () => {
    const fetch = fakeFetch(() => json(200, created));
    const client = new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch });

    const result = await client.analyses.create({ text: "本文", store: "tags" });

    const { init, headers } = lastCall(fetch);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ text: "本文", store: "tags" });
    expect(headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Idempotency-Key")).toMatch(UUID);
    expect(result).toEqual(created);
  });

  it("Idempotency-Key を指定すれば、それを使う(送り直し用)", async () => {
    const fetch = fakeFetch(() => json(200, created));
    const client = new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch });
    const key = "0f8fad5b-d9cb-469f-a165-70867728950e";
    await client.analyses.create({ text: "本文", store: "tags" }, { idempotencyKey: key });
    expect(lastCall(fetch).headers.get("Idempotency-Key")).toBe(key);
  });

  it("資格情報を関数で渡すと、リクエストのたびに呼ぶ(ID トークンの更新用)", async () => {
    const fetch = fakeFetch(() => json(200, created));
    const credential = vi.fn(async () => `token-${credential.mock.calls.length}`);
    const client = new EdcClient({ baseUrl: "https://api.example.com", credential, fetch });

    await client.analyses.create({ text: "a", store: "tags" });
    expect(lastCall(fetch).headers.get("Authorization")).toBe("Bearer token-1");
    await client.analyses.create({ text: "b", store: "tags" });
    expect(lastCall(fetch).headers.get("Authorization")).toBe("Bearer token-2");
  });

  it("資格情報が空なら、送らずに unauthenticated", async () => {
    const fetch = fakeFetch(() => json(200, created));
    const client = new EdcClient({ baseUrl: "https://api.example.com", credential: async () => "", fetch });
    const error = await catchError(client.analyses.create({ text: "a", store: "none" }));
    expect(error.code).toBe("unauthenticated");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("リクエストが契約に合わなければ、送らずに invalid_argument", async () => {
    const fetch = fakeFetch(() => json(200, created));
    const client = new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch });
    const error = await catchError(
      client.analyses.create({ text: "a", store: "all" } as unknown as { text: string; store: "none" }),
    );
    expect(error.code).toBe("invalid_argument");
    expect(error.retryable).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("成功の応答が契約に合わなければ invalid_response", async () => {
    const fetch = fakeFetch(() => json(200, { ...created, output: { story: "s", design_tags: [] } }));
    const client = new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch });
    const error = await catchError(client.analyses.create({ text: "a", store: "none" }));
    expect(error.code).toBe("invalid_response");
    expect(error.status).toBe(200);
  });
});

describe("エラーの扱い", () => {
  const client = (respond: () => Response | Promise<Response>, timeoutMs?: number) => {
    const fetch = fakeFetch(respond);
    return new EdcClient({
      baseUrl: "https://api.example.com",
      credential: TOKEN,
      fetch,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  };

  it("エラーの本文を EdcApiError にする(予算不足: code・message・retryable・retryAt・status)", async () => {
    const body = {
      error: {
        code: "budget_exhausted",
        message: "本日の利用額の上限に達しました",
        retryable: true,
        retryAt: "2026-09-27T00:00:00+09:00",
      },
    };
    const error = await catchError(client(() => json(429, body)).analyses.create({ text: "a", store: "none" }));
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("budget_exhausted");
    expect(error.message).toBe("本日の利用額の上限に達しました");
    expect(error.retryable).toBe(true);
    expect(error.retryAt).toBe("2026-09-27T00:00:00+09:00");
    expect(error.status).toBe(429);
  });

  it("エラーの本文が契約に合わなければ invalid_response。5xx は再試行できる、4xx はできない", async () => {
    const e502 = await catchError(
      client(() => new Response("<html>Bad Gateway</html>", { status: 502 })).analyses.create({ text: "a", store: "none" }),
    );
    expect(e502.code).toBe("invalid_response");
    expect(e502.status).toBe(502);
    expect(e502.retryable).toBe(true);

    const e404 = await catchError(client(() => json(404, { message: "nope" })).analyses.get("an_1"));
    expect(e404.code).toBe("invalid_response");
    expect(e404.retryable).toBe(false);
  });

  it("通信に失敗したら network(再試行できる)", async () => {
    const error = await catchError(
      client(() => {
        throw new TypeError("fetch failed");
      }).analyses.create({ text: "a", store: "none" }),
    );
    expect(error.code).toBe("network");
    expect(error.retryable).toBe(true);
    expect(error.status).toBeUndefined();
  });

  it("時間内に応答がなければ timeout(再試行できる)", async () => {
    const fetch = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const c = new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch, timeoutMs: 20 });
    const error = await catchError(c.analyses.create({ text: "a", store: "none" }));
    expect(error.code).toBe("timeout");
    expect(error.retryable).toBe(true);
  });

  it("呼ぶ側が中断したら aborted(再試行しない)", async () => {
    const fetch = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const c = new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch });
    const controller = new AbortController();
    const pending = catchError(c.analyses.create({ text: "a", store: "none" }, { signal: controller.signal }));
    controller.abort();
    const error = await pending;
    expect(error.code).toBe("aborted");
    expect(error.retryable).toBe(false);
  });

  it("資格情報は、エラーのメッセージにも中身にも含めない", async () => {
    const cases = [
      () => json(401, { error: { code: "unauthenticated", message: "無効な資格情報です", retryable: false } }),
      () => new Response("oops", { status: 500 }),
      () => {
        throw new TypeError("fetch failed");
      },
    ];
    for (const respond of cases) {
      const error = await catchError(client(respond).analyses.create({ text: "a", store: "none" }));
      const dumped = `${error.message}\n${error.stack ?? ""}\n${JSON.stringify(error)}\n${String(error.cause ?? "")}`;
      expect(dumped).not.toContain(TOKEN);
    }
  });
});

describe("analyses.get(GET /v1/analyses/{id})", () => {
  it("id をパスに埋めるときはエスケープする", async () => {
    const stored = {
      id: "a/b",
      stored: "tags",
      createdAt: "2026-09-26T03:00:00.000Z",
      output: { design_tags: analysisOutput.design_tags },
      meta,
    };
    const fetch = fakeFetch(() => json(200, stored));
    const client = new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch });

    const result = await client.analyses.get("a/b");

    const { url, init, headers } = lastCall(fetch);
    expect(url).toBe("https://api.example.com/v1/analyses/a%2Fb");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(headers.get("Idempotency-Key")).toBeNull();
    expect(result).toEqual(stored);
  });

  it("id が空なら、送らずに invalid_argument", async () => {
    const fetch = fakeFetch(() => json(200, {}));
    const client = new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch });
    expect((await catchError(client.analyses.get(""))).code).toBe("invalid_argument");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("取り下げ済みは withdrawn", async () => {
    const fetch = fakeFetch(() =>
      json(410, { error: { code: "withdrawn", message: "取り下げ済みです", retryable: false } }),
    );
    const client = new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch });
    const error = await catchError(client.analyses.get("an_1"));
    expect(error.code).toBe("withdrawn");
    expect(error.status).toBe(410);
  });
});

describe("analyses.delete(DELETE /v1/analyses/{id})", () => {
  it("204 なら何も返さない", async () => {
    const fetch = fakeFetch(() => new Response(null, { status: 204 }));
    const client = new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch });

    await expect(client.analyses.delete("an_1")).resolves.toBeUndefined();

    const { url, init } = lastCall(fetch);
    expect(url).toBe("https://api.example.com/v1/analyses/an_1");
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });

  it("他のクライアントの id は not_found", async () => {
    const fetch = fakeFetch(() =>
      json(404, { error: { code: "not_found", message: "見つかりません", retryable: false } }),
    );
    const client = new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch });
    expect((await catchError(client.analyses.delete("an_x"))).code).toBe("not_found");
  });
});

describe("設定の誤り(作るときに TypeError・RangeError)", () => {
  const fetch = fakeFetch(() => json(200, created));
  const base = { baseUrl: "https://api.example.com", credential: TOKEN, fetch };

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31])("timeoutMs が %s なら RangeError", (timeoutMs) => {
    expect(() => new EdcClient({ ...base, timeoutMs })).toThrow(RangeError);
  });

  it("maxResponseBytes が正の整数でなければ RangeError", () => {
    expect(() => new EdcClient({ ...base, maxResponseBytes: 0 })).toThrow(RangeError);
  });

  it("credential と fetch の型が違えば TypeError", () => {
    expect(() => new EdcClient({ ...base, credential: 1 as unknown as string })).toThrow(TypeError);
    expect(() => new EdcClient({ ...base, fetch: "x" as unknown as FetchLike })).toThrow(TypeError);
  });
});

describe("リクエストの失敗は、すべて EdcApiError", () => {
  const make = (overrides: Partial<ConstructorParameters<typeof EdcClient>[0]> = {}) => {
    const fetch = fakeFetch(() => json(200, created));
    return { fetch, client: new EdcClient({ baseUrl: "https://api.example.com/base", credential: TOKEN, fetch, ...overrides }) };
  };

  it.each([".", ".."])("id が %j なら、送らずに invalid_argument(別のパスへ送らない)", async (id) => {
    const { fetch, client } = make();
    expect((await catchError(client.analyses.get(id))).code).toBe("invalid_argument");
    expect((await catchError(client.analyses.delete(id))).code).toBe("invalid_argument");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("id に対になっていないサロゲートがあれば invalid_argument", async () => {
    const { fetch, client } = make();
    expect((await catchError(client.analyses.get("a\ud800"))).code).toBe("invalid_argument");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("id の ... や %2e%2e はエスケープしてそのまま送る(1 つの区切りの中に収まる)", async () => {
    const fetch = fakeFetch(() => new Response(null, { status: 204 }));
    const { client } = make({ fetch });
    await client.analyses.delete("...");
    expect(lastCall(fetch).url).toBe("https://api.example.com/base/v1/analyses/...");
    await client.analyses.delete("%2e%2e");
    expect(lastCall(fetch).url).toBe("https://api.example.com/base/v1/analyses/%252e%252e");
  });

  it("資格情報の関数が投げたら unauthenticated(元のエラーは cause)", async () => {
    const original = new Error("metadata server に届かない");
    const { fetch, client } = make({
      credential: () => {
        throw original;
      },
    });
    const error = await catchError(client.analyses.create({ text: "a", store: "tags" }));
    expect(error.code).toBe("unauthenticated");
    expect(error.cause).toBe(original);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("資格情報に改行や空白があれば、送らずに unauthenticated(値はメッセージに含めない)", async () => {
    for (const value of [`${TOKEN}\r\nX-Injected: 1`, `${TOKEN} x`, `${TOKEN}\u3042`]) {
      const { fetch, client } = make({ credential: value });
      const error = await catchError(client.analyses.create({ text: "a", store: "tags" }));
      expect(error.code).toBe("unauthenticated");
      expect(`${error.message}${JSON.stringify(error)}`).not.toContain(TOKEN);
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("idempotencyKey が UUID でなければ、送らずに invalid_argument", async () => {
    for (const idempotencyKey of ["", "abc", "0f8fad5b-d9cb-469f-a165-70867728950e\r\nX: 1"]) {
      const { fetch, client } = make();
      const error = await catchError(client.analyses.create({ text: "a", store: "tags" }, { idempotencyKey }));
      expect(error.code).toBe("invalid_argument");
      expect(fetch).not.toHaveBeenCalled();
    }
  });
});

describe("リダイレクト", () => {
  it("fetch に redirect: manual を渡す", async () => {
    const fetch = fakeFetch(() => new Response(null, { status: 204 }));
    const client = new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch });
    await client.analyses.delete("an_1");
    expect(lastCall(fetch).init.redirect).toBe("manual");
  });

  it("3xx は成功にせず invalid_response", async () => {
    const fetch = fakeFetch(() => new Response(null, { status: 307, headers: { Location: "https://evil.example/" } }));
    const client = new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch });
    const error = await catchError(client.analyses.delete("an_1"));
    expect(error.code).toBe("invalid_response");
    expect(error.status).toBe(307);
  });

  it("差し替えた fetch がリダイレクトを追っても(redirected)、成功にしない", async () => {
    const fetch = fakeFetch(() => {
      const response = new Response(null, { status: 204 });
      Object.defineProperty(response, "redirected", { value: true });
      return response;
    });
    const client = new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch });
    expect((await catchError(client.analyses.delete("an_1"))).code).toBe("invalid_response");
  });

  it("実際の fetch でも、別のホストへのリダイレクトを追わない", async () => {
    const { createServer } = await import("node:http");
    const hits: string[] = [];
    const other = createServer((req, res) => {
      hits.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""}`);
      res.writeHead(204).end();
    });
    const api = createServer((_req, res) => {
      const { port } = other.address() as { port: number };
      res.writeHead(307, { Location: `http://127.0.0.1:${port}/v1/analyses/an_1` }).end();
    });
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = api.address() as { port: number };
      const client = new EdcClient({ baseUrl: `http://127.0.0.1:${port}`, credential: TOKEN });
      const error = await catchError(client.analyses.delete("an_1"));
      expect(error.code).toBe("invalid_response");
      expect(hits).toEqual([]);
    } finally {
      api.close();
      other.close();
    }
  });
});

describe("応答の本文の上限", () => {
  it("上限を超える本文は読むのをやめて invalid_response", async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const fetch = fakeFetch(() => new Response(endless, { status: 200 }));
    const client = new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch, maxResponseBytes: 10_000 });
    const error = await catchError(client.analyses.get("an_1"));
    expect(error.code).toBe("invalid_response");
    expect(pulled).toBeLessThan(20);
  });

  it("Content-Length が上限を超えていれば、読まずに invalid_response", async () => {
    const fetch = fakeFetch(
      () => new Response("{}", { status: 200, headers: { "Content-Length": String(10 * 1024 * 1024) } }),
    );
    const client = new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch });
    expect((await catchError(client.analyses.get("an_1"))).code).toBe("invalid_response");
  });

  it("上限ちょうどまでは読める(マルチバイトの文字を含む)", async () => {
    const body = JSON.stringify(created);
    const size = new TextEncoder().encode(body).byteLength;
    const fetch = fakeFetch(() => new Response(body, { status: 200 }));
    const client = new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch, maxResponseBytes: size });
    await expect(client.analyses.create({ text: "a", store: "tags" })).resolves.toEqual(created);
  });
});

describe("応答の中身の確認", () => {
  it("stored が頼んだ store と違えば invalid_response", async () => {
    const fetch = fakeFetch(() => json(200, { ...created, stored: "content_and_tags" }));
    const client = new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch });
    const error = await catchError(client.analyses.create({ text: "a", store: "tags" }));
    expect(error.code).toBe("invalid_response");
    expect(error.retryable).toBe(false);
  });
});
