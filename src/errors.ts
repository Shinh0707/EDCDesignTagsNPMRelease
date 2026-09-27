// エラーの形(docs/contract.md 2.5)。
import { z } from "zod";

/** サーバーが返す code */
export const API_ERROR_CODES = [
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
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** サーバーが先に code を増やしても壊れないよう、code は文字列として受け付ける */
export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    retryable: z.boolean(),
    retryAt: z.string().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
