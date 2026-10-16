import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  CreateAnalysisRequestSchema,
  CreateAnalysisResponseSchema,
  EdcApiError,
  EdcClient,
  EdcCaseSchema,
  type FetchLike,
  GetCaseResponseSchema,
  SearchCasesRequestSchema,
  SearchCasesResponseSchema,
  StoredAnalysisSchema,
  USAGE_SCOPES,
} from "../src/index.js";

const analysisOutput = JSON.parse(
  readFileSync(new URL("./fixtures/analysis-output.json", import.meta.url), "utf8"),
) as { story: string; design_tags: unknown[] };
const tag = analysisOutput.design_tags[0];
const meta = {
  model: "gemini-3.8-flash",
  generation: { temperature: 0.5 },
  promptVersion: "3.0.0",
  schemaVersion: "3.0.0",
  inputNormalizationVersion: "1",
  apiVersion: "1.2.0",
  generatedAt: "2026-10-17T03:00:00.000Z",
  usage: { inputTokens: 1200, outputTokens: 800, thoughtsTokens: 0 },
};
const edcCase = {
  caseId: "paper:IPSJ-EC2013007:0",
  origin: "paper",
  source: { title: "寂しさ解消ロボットの提案", authors: ["乳原, 梓", "上田, 博唯"], venue: "EC2013", year: 2013, url: null },
  tags: {
    context: ["一人で過ごす人"],
    approach: ["アルバム写真を提示する"],
    effects: [{ experience: "会話が自然に広がる", responses: ["懐かしさがこみ上げる"] }],
  },
};
const searched = {
  indexVersion: "paper-2026-10-17",
  embedding: { model: "gemini-embedding-2", dimensions: 768 },
  items: [{ case: edcCase, closeness: 0.81 }],
};
const TOKEN = "dummy-credential-for-tests-0123456789";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fakeFetch = (respond: () => Response) => vi.fn<FetchLike>(async () => respond());
const clientWith = (fetch: FetchLike) => new EdcClient({ baseUrl: "https://api.example.com", credential: TOKEN, fetch });

async function catchError(promise: Promise<unknown>): Promise<EdcApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EdcApiError) return error;
    throw error;
  }
  throw new Error("失敗しなかった");
}

describe("使い方の範囲(usageScope)", () => {
  it("owner-only と llm-source-only の 2 つ。付けなくてもよい", () => {
    expect(USAGE_SCOPES).toEqual(["owner-only", "llm-source-only"]);
    for (const usageScope of USAGE_SCOPES) {
      expect(CreateAnalysisRequestSchema.safeParse({ text: "本文", store: "tags", usageScope }).success).toBe(true);
    }
    expect(CreateAnalysisRequestSchema.safeParse({ text: "本文", store: "tags" }).success).toBe(true);
    expect(CreateAnalysisRequestSchema.safeParse({ text: "本文", store: "tags", usageScope: "public" }).success).toBe(false);
  });

  it("store が none のときは付けられない", () => {
    expect(CreateAnalysisRequestSchema.safeParse({ text: "本文", store: "none", usageScope: "owner-only" }).success).toBe(false);
  });

  it("分析と読み出しの応答に返る(付けたときだけ)", () => {
    const created = { id: "an_1", stored: "tags", usageScope: "owner-only", output: analysisOutput, meta };
    expect(CreateAnalysisResponseSchema.parse(created).usageScope).toBe("owner-only");
    const stored = { id: "an_1", stored: "tags", usageScope: "owner-only", createdAt: meta.generatedAt, output: { design_tags: [tag] }, meta };
    expect(StoredAnalysisSchema.parse(stored).usageScope).toBe("owner-only");
  });

  it("ラッパーは、応答の usageScope が頼んだものと違えば invalid_response", async () => {
    const fetch = fakeFetch(() => json(200, { id: "an_1", stored: "tags", output: analysisOutput, meta }));
    const error = await catchError(clientWith(fetch).analyses.create({ text: "本文", store: "tags", usageScope: "owner-only" }));
    expect(error.code).toBe("invalid_response");
  });

  it("ラッパーは usageScope を送る", async () => {
    const fetch = fakeFetch(() => json(200, { id: "an_1", stored: "tags", usageScope: "owner-only", output: analysisOutput, meta }));
    await clientWith(fetch).analyses.create({ text: "本文", store: "tags", usageScope: "owner-only" });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ text: "本文", store: "tags", usageScope: "owner-only" });
  });
});

describe("POST /v1/cases:search の形", () => {
  it("designTags は 1〜5 件、limit は 1〜20、excludeCaseIds は 10 件まで", () => {
    const ok = (body: unknown) => SearchCasesRequestSchema.safeParse(body).success;
    expect(ok({ designTags: [tag] })).toBe(true);
    expect(ok({ designTags: [] })).toBe(false);
    expect(ok({ designTags: Array.from({ length: 6 }, () => tag) })).toBe(false);
    expect(ok({ designTags: [tag], limit: 20 })).toBe(true);
    expect(ok({ designTags: [tag], limit: 21 })).toBe(false);
    expect(ok({ designTags: [tag], limit: 0 })).toBe(false);
    expect(ok({ designTags: [tag], excludeCaseIds: Array.from({ length: 10 }, (_, i) => `paper:x:${i}`) })).toBe(true);
    expect(ok({ designTags: [tag], excludeCaseIds: Array.from({ length: 11 }, (_, i) => `paper:x:${i}`) })).toBe(false);
    expect(ok({ designTags: [tag], excludeCaseIds: ["a#0"] })).toBe(false);
    expect(ok({ designTags: [tag], extra: 1 })).toBe(false);
  });

  it("応答は知らない項目を捨てる。origin は paper だけ", () => {
    expect(SearchCasesResponseSchema.parse({ ...searched, newField: 1 })).toEqual(searched);
    expect(EdcCaseSchema.safeParse({ ...edcCase, origin: "plan" }).success).toBe(false);
    expect(EdcCaseSchema.safeParse({ ...edcCase, tags: { ...edcCase.tags, effects: [] } }).success).toBe(false);
  });
});

describe("GET /v1/cases/{caseId} の形", () => {
  it("available と withdrawn", () => {
    expect(GetCaseResponseSchema.parse({ status: "available", indexVersion: "v", case: edcCase }).status).toBe("available");
    expect(GetCaseResponseSchema.parse({ status: "withdrawn" })).toEqual({ status: "withdrawn" });
    expect(GetCaseResponseSchema.safeParse({ status: "available" }).success).toBe(false);
  });
});

describe("EdcClient.cases", () => {
  it("search は POST /v1/cases:search に送り、送り直しの鍵を付けない", async () => {
    const fetch = fakeFetch(() => json(200, searched));
    const response = await clientWith(fetch).cases.search({ designTags: [tag] as never, limit: 3 });
    expect(response).toEqual(searched);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.example.com/v1/cases:search");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).has("Idempotency-Key")).toBe(false);
  });

  it("search は形の違うリクエストを送らない", async () => {
    const fetch = fakeFetch(() => json(200, searched));
    const error = await catchError(clientWith(fetch).cases.search({ designTags: [] }));
    expect(error.code).toBe("invalid_argument");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("get は caseId を符号化せずにパスに入れ、indexVersion をクエリに付ける", async () => {
    const fetch = fakeFetch(() => json(200, { status: "withdrawn" }));
    expect(await clientWith(fetch).cases.get("paper:IPSJ-EC2013007:0", { indexVersion: "paper 1" })).toEqual({ status: "withdrawn" });
    expect(fetch.mock.calls[0]?.[0]).toBe("https://api.example.com/v1/cases/paper:IPSJ-EC2013007:0?indexVersion=paper%201");
  });

  it("get は使えない文字の caseId を送らない", async () => {
    const fetch = fakeFetch(() => json(200, { status: "withdrawn" }));
    for (const id of ["", "..", "a/b", "a#0", "a".repeat(101)]) {
      expect((await catchError(clientWith(fetch).cases.get(id))).code).toBe("invalid_argument");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("サーバーのエラーは EdcApiError", async () => {
    const fetch = fakeFetch(() => json(429, { error: { code: "budget_exhausted", message: "上限", retryable: true, retryAt: "2026-10-18T00:00:00+09:00" } }));
    const error = await catchError(clientWith(fetch).cases.search({ designTags: [tag] as never }));
    expect(error).toMatchObject({ code: "budget_exhausted", status: 429, retryAt: "2026-10-18T00:00:00+09:00" });
  });
});
