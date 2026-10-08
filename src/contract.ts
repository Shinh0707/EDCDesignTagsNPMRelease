// EDC Web API v1 の通信の形(docs/contract.md)。
// リクエストは strict(余分な項目を送らない)。レスポンスは項目の追加で壊れないよう、知らない項目を捨てる。
import { z } from "zod";
import { AnalysisOutputSchema } from "./analysis.js";
import { DesignTagSchema } from "./designTag.js";

/** 保存を許可する範囲。狭い順。tags_without_sources は DesignTag の sources(入力の原文の引用)を空にして保存する */
export const STORE_LEVELS = ["none", "tags_without_sources", "tags", "content_and_tags"] as const;
export const StoreLevelSchema = z.enum(STORE_LEVELS);
export type StoreLevel = z.infer<typeof StoreLevelSchema>;

export const RunMetadataSchema = z.object({
  model: z.string(),
  generation: z.object({ temperature: z.number() }),
  promptVersion: z.string(),
  schemaVersion: z.string(),
  inputNormalizationVersion: z.string(),
  apiVersion: z.string(),
  generatedAt: z.string(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number(), thoughtsTokens: z.number() }),
});
export type RunMetadata = z.infer<typeof RunMetadataSchema>;

/** `POST /v1/analyses` のリクエスト */
export const CreateAnalysisRequestSchema = z.strictObject({
  text: z.string(),
  store: StoreLevelSchema,
});
export type CreateAnalysisRequest = z.infer<typeof CreateAnalysisRequestSchema>;

/** `POST /v1/analyses` のレスポンス */
export const CreateAnalysisResponseSchema = z.object({
  id: z.string().min(1),
  stored: StoreLevelSchema,
  output: AnalysisOutputSchema,
  meta: RunMetadataSchema,
});
export type CreateAnalysisResponse = z.infer<typeof CreateAnalysisResponseSchema>;

/** `GET /v1/analyses/{id}` のレスポンス。story と text は content_and_tags のときだけ。tags_without_sources のときは sources がすべて空 */
export const StoredAnalysisSchema = z.object({
  id: z.string().min(1),
  stored: z.enum(["tags_without_sources", "tags", "content_and_tags"]),
  createdAt: z.string(),
  output: z.object({
    design_tags: z.array(DesignTagSchema),
    story: z.string().optional(),
  }),
  text: z.string().optional(),
  meta: RunMetadataSchema,
});
export type StoredAnalysis = z.infer<typeof StoredAnalysisSchema>;
