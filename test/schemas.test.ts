import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AnalysisOutputSchema,
  API_ERROR_CODES,
  ApiErrorBodySchema,
  CreateAnalysisRequestSchema,
  CreateAnalysisResponseSchema,
  DesignTagSchema,
  RunMetadataSchema,
  STORE_LEVELS,
  StoredAnalysisSchema,
} from "../src/index.js";
import * as pkg from "../src/index.js";

const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

const canonicalShape = readJson("./fixtures/DesignTagSchema.shape.json");
const analysisOutput = readJson("./fixtures/analysis-output.json") as { story: string; design_tags: unknown[] };

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

describe("DesignTag(正本は Gist)", () => {
  it("JSON Schema にすると、正本の schema から説明文を除いたものと一致する", () => {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(DesignTagSchema, { io: "input" });
    expect(schema).toEqual(canonicalShape);
  });

  it("正本にない項目を持つ DesignTag は受け付けない(形は正本のまま strict)", () => {
    const tag = analysisOutput.design_tags[0] as Record<string, unknown>;
    expect(DesignTagSchema.safeParse(tag).success).toBe(true);
    expect(DesignTagSchema.safeParse({ ...tag, extra: 1 }).success).toBe(false);
  });
});

describe("AnalysisOutput", () => {
  it("分析の出力の例を受け付ける", () => {
    expect(AnalysisOutputSchema.parse(analysisOutput)).toEqual(analysisOutput);
  });

  it("DesignTag は 3〜5件", () => {
    const tag = analysisOutput.design_tags[0];
    const withTags = (n: number) => ({ story: "s", design_tags: Array.from({ length: n }, () => tag) });
    expect(AnalysisOutputSchema.safeParse(withTags(2)).success).toBe(false);
    expect(AnalysisOutputSchema.safeParse(withTags(3)).success).toBe(true);
    expect(AnalysisOutputSchema.safeParse(withTags(5)).success).toBe(true);
    expect(AnalysisOutputSchema.safeParse(withTags(6)).success).toBe(false);
  });
});

describe("説明文(LLM への指示)を含めない", () => {
  /** JSON Schema の中の、文字列の title・description の場所を集める(プロパティ名の title は対象外) */
  const labels = (node: unknown, path = "$"): string[] => {
    if (Array.isArray(node)) return node.flatMap((child, i) => labels(child, `${path}[${i}]`));
    if (typeof node !== "object" || node === null) return [];
    return Object.entries(node).flatMap(([key, value]) =>
      (key === "title" || key === "description") && typeof value === "string"
        ? [`${path}.${key}`]
        : labels(value, `${path}.${key}`),
    );
  };

  it.each(
    Object.entries(pkg as Record<string, unknown>).filter(
      (entry): entry is [string, z.ZodType] => entry[1] instanceof z.ZodType,
    ),
  )("%s", (_name, schema) => {
    expect(labels(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }))).toEqual([]);
  });
});

describe("POST /v1/analyses のリクエスト", () => {
  it("保存の許可は none / tags_without_sources / tags / content_and_tags の4つ", () => {
    expect(STORE_LEVELS).toEqual(["none", "tags_without_sources", "tags", "content_and_tags"]);
    for (const store of STORE_LEVELS) {
      expect(CreateAnalysisRequestSchema.safeParse({ text: "本文", store }).success).toBe(true);
    }
    expect(CreateAnalysisRequestSchema.safeParse({ text: "本文", store: "all" }).success).toBe(false);
  });

  it("text と store は必須で、余分な項目は受け付けない", () => {
    expect(CreateAnalysisRequestSchema.safeParse({ text: "本文" }).success).toBe(false);
    expect(CreateAnalysisRequestSchema.safeParse({ store: "none" }).success).toBe(false);
    expect(CreateAnalysisRequestSchema.safeParse({ text: "本文", store: "none", user: "a" }).success).toBe(false);
  });
});

describe("POST /v1/analyses のレスポンス", () => {
  const response = { id: "an_1", stored: "tags", output: analysisOutput, meta };

  it("id・stored・output・meta を受け付ける", () => {
    expect(CreateAnalysisResponseSchema.parse(response)).toEqual(response);
  });

  it("知らない項目は捨てる(項目の追加で壊れない)", () => {
    const parsed = CreateAnalysisResponseSchema.parse({ ...response, newField: 1, meta: { ...meta, region: "x" } });
    expect(parsed).toEqual(response);
  });

  it("meta には apiVersion が要る", () => {
    const { apiVersion: _ignored, ...withoutApiVersion } = meta;
    expect(RunMetadataSchema.safeParse(withoutApiVersion).success).toBe(false);
  });
});

describe("GET /v1/analyses/{id} のレスポンス", () => {
  const base = { id: "an_1", createdAt: "2026-09-26T03:00:00.000Z", meta };

  it("tags のときは design_tags だけで、story と text はない", () => {
    const stored = { ...base, stored: "tags", output: { design_tags: analysisOutput.design_tags } };
    expect(StoredAnalysisSchema.parse(stored)).toEqual(stored);
  });

  it("tags_without_sources のときは design_tags だけで、sources は空", () => {
    const withoutSources: unknown = JSON.parse(JSON.stringify(analysisOutput.design_tags, (key, value: unknown) => (key === "sources" ? [] : value)));
    const stored = { ...base, stored: "tags_without_sources", output: { design_tags: withoutSources } };
    expect(StoredAnalysisSchema.parse(stored)).toEqual(stored);
  });

  it("content_and_tags のときは story と text も持てる", () => {
    const stored = { ...base, stored: "content_and_tags", text: "本文", output: analysisOutput };
    expect(StoredAnalysisSchema.parse(stored)).toEqual(stored);
  });

  it("保存していない(none)ものは読み出しの対象にならない", () => {
    const stored = { ...base, stored: "none", output: { design_tags: analysisOutput.design_tags } };
    expect(StoredAnalysisSchema.safeParse(stored).success).toBe(false);
  });
});

describe("エラーの本文", () => {
  it("code・message・retryable・retryAt(任意)の形", () => {
    const body = {
      error: { code: "budget_exhausted", message: "上限に達しました", retryable: true, retryAt: "2026-09-27T00:00:00+09:00" },
    };
    expect(ApiErrorBodySchema.parse(body)).toEqual(body);
  });

  it("契約にある code の一覧", () => {
    expect([...API_ERROR_CODES].sort()).toEqual(
      [
        "unauthenticated",
        "permission_denied",
        "invalid_argument",
        "input_empty",
        "not_found",
        "conflict",
        "withdrawn",
        "input_too_long",
        "budget_exhausted",
        "rate_limited",
        "internal",
        "llm_invalid_output",
        "service_stopped",
        "llm_unavailable",
      ].sort(),
    );
  });

  it("知らない code でも本文として受け付ける(サーバーが先に code を増やしても壊れない)", () => {
    const body = { error: { code: "new_code", message: "…", retryable: false } };
    expect(ApiErrorBodySchema.parse(body).error.code).toBe("new_code");
  });
});
