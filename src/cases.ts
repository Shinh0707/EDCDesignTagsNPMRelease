// 似た事例の検索と事例の参照(0.3.0。docs/contract.md 3.4・3.5)。
// 事例として返るのは、事例として見せてよい出どころ(いまは論文)だけ。保存した分析は、どの形でも返らない。
import { z } from "zod";
import { DesignTagSchema } from "./designTag.js";

/** 事例の ID。版をまたいで同じ事例は同じ ID。URL のパスにそのまま入れられる文字だけ */
export const CASE_ID_PATTERN = /^[A-Za-z0-9_:-]{1,100}$/;
export const CaseIdSchema = z.string().regex(CASE_ID_PATTERN);

export const IndexVersionSchema = z.string().min(1).max(100);

/** 検索の件数の上限と既定 */
export const CASE_SEARCH_LIMIT_MAX = 20;
export const CASE_SEARCH_LIMIT_DEFAULT = 5;

const text = z.string().max(400);

/** 論文の出典(origin が paper のとき) */
export const PaperSourceSchema = z.object({
  title: z.string().max(300),
  /** 重複(漢字とローマ字の並び)を除いた名前 */
  authors: z.array(z.string().max(200)).max(30),
  venue: z.string().max(200),
  year: z.int(),
  url: z.string().max(2000).nullable(),
});
export type PaperSource = z.infer<typeof PaperSourceSchema>;

/** 1 事例 = 1 つの体験。tags は見せるための粒度(論文の事例集の v2-short と同じ) */
export const EdcCaseSchema = z.object({
  caseId: CaseIdSchema,
  origin: z.literal("paper"),
  source: PaperSourceSchema,
  tags: z.object({
    context: z.array(text).max(10),
    approach: z.array(text).max(10),
    effects: z.array(z.object({ experience: text, responses: z.array(text).max(10) })).min(1).max(5),
  }),
});
export type EdcCase = z.infer<typeof EdcCaseSchema>;

/** `POST /v1/cases:search` のリクエスト */
export const SearchCasesRequestSchema = z.strictObject({
  /** 分析の output.design_tags をそのまま */
  designTags: z.array(DesignTagSchema).min(1).max(5),
  limit: z.int().min(1).max(CASE_SEARCH_LIMIT_MAX).optional(),
  /** 結果から除く事例 */
  excludeCaseIds: z.array(CaseIdSchema).max(10).optional(),
});
export type SearchCasesRequest = z.infer<typeof SearchCasesRequestSchema>;

/** `POST /v1/cases:search` のレスポンス。items は近い順(同じ近さは caseId の昇順) */
export const SearchCasesResponseSchema = z.object({
  indexVersion: IndexVersionSchema,
  /** 近さの尺度 */
  embedding: z.object({ model: z.string().min(1), dimensions: z.int().min(1) }),
  items: z.array(
    z.object({
      case: EdcCaseSchema,
      /** 問い合わせと事例の埋め込みのコサイン類似度 */
      closeness: z.number().min(-1).max(1),
    }),
  ),
});
export type SearchCasesResponse = z.infer<typeof SearchCasesResponseSchema>;

/** `GET /v1/cases/{caseId}` のレスポンス。取り下げ・事例集から外れた・ない ID は withdrawn */
export const GetCaseResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), indexVersion: IndexVersionSchema, case: EdcCaseSchema }),
  z.object({ status: z.literal("withdrawn") }),
]);
export type GetCaseResponse = z.infer<typeof GetCaseResponseSchema>;
