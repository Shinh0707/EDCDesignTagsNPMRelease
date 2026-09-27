// 分析の出力の形(v2 の外枠 + 正本の DesignTag)。説明文(LLM への指示)は含めない。サーバーだけが持つ(docs/contract.md 2.1)。
import { z } from "zod";
import { DesignTagSchema } from "./designTag.js";

export const AnalysisOutputSchema = z.object({
  story: z.string(),
  design_tags: z.array(DesignTagSchema).min(3).max(5),
});

export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;
