// ビルドしたもの(dist)を、使う側と同じくパッケージ名で import できるかを確かめる(npm run smoke)。
import assert from "node:assert/strict";
import * as pkg from "@entertainment-design-catalog/design-tags";

const expected = [
  "API_ERROR_CODES",
  "AnalysisOutputSchema",
  "ApiErrorBodySchema",
  "CLIENT_ERROR_CODES",
  "CreateAnalysisRequestSchema",
  "CreateAnalysisResponseSchema",
  "DesignTagSchema",
  "EdcApiError",
  "EdcClient",
  "RunMetadataSchema",
  "STORE_LEVELS",
  "StoreLevelSchema",
  "StoredAnalysisSchema",
];
for (const name of expected) assert.ok(name in pkg, `${name} が export されていない`);
// 説明文(LLM への指示)を配らない(docs/contract.md 2.1)
assert.ok(!("DESIGN_TAG_DESCRIPTION" in pkg), "DESIGN_TAG_DESCRIPTION を export している");
assert.throws(() => new pkg.EdcClient({ baseUrl: "http://example.com", credential: "x" }), TypeError);
console.log(`smoke: ok(${Object.keys(pkg).length} 個の export)`);
