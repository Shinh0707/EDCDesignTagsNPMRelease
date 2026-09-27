// DesignTag の形(正本は Gist の DesignTagStructuredOutputSchema.json)。
// 形は正本と一致させる(test/schemas.test.ts)。LLM に渡す JSON Schema は EDC Web API がこれから作るので、strict にする。
// 説明文(LLM への指示)は含めない。サーバーだけが持つ(docs/contract.md 2.1)。
import { z } from "zod";

export const SenseTypeSchema = z.enum(["sight", "hearing", "touch", "taste", "smell"]);

export const SenseSchema = z.strictObject({
  type: SenseTypeSchema,
  perceive: z.string(),
  method: z.string(),
  sources: z.array(z.string()),
});

export const ExternalSchema = z.strictObject({
  perception: z.array(SenseSchema),
  cognition: z.string(),
  sources: z.array(z.string()),
});

export const EmotionSchema = z.strictObject({
  emotion: z.string(),
});

export const MotivationSchema = z.strictObject({
  motivation: z.string(),
});

export const InternalSchema = z.union([EmotionSchema, MotivationSchema]);

export const ContextSchema = z.strictObject({
  environment: z.array(ExternalSchema),
  condition: z.array(InternalSchema),
  label: z.string(),
});

export const EffectSchema = z.strictObject({
  passive: z.array(ExternalSchema),
  internal_effects: z.array(InternalSchema),
  title: z.string(),
});

export const DesignTagSchema = z.strictObject({
  context: ContextSchema,
  effects: z.array(EffectSchema),
});

export type SenseType = z.infer<typeof SenseTypeSchema>;
export type Sense = z.infer<typeof SenseSchema>;
export type External = z.infer<typeof ExternalSchema>;
export type Internal = z.infer<typeof InternalSchema>;
export type Context = z.infer<typeof ContextSchema>;
export type Effect = z.infer<typeof EffectSchema>;
export type DesignTag = z.infer<typeof DesignTagSchema>;

