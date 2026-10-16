# EDC Web API v1 — 通信の形

- 状態: 草案(2026-09-26)。0.3.0(API 1.2.0)で 2.2a・2.6・3.4・3.5 を足した(2026-10-17)
- このパッケージが提供するのは、この文書の「形」(Zod のスキーマと型)と、それを送受信する HTTP のラッパーだけ
- サーバーの中の動き(認証の台帳、利用額、保存のしかた、LLM)は、EDC Web API(リポジトリ EDCWebAPI)の設計書にある
- 旧 API(`POST /`)は対象外

## 1. 共通

- 基点: `https://<API のホスト>/v1`(ホストはラッパーの設定で渡す)
- 本文は JSON(`Content-Type: application/json; charset=utf-8`)
- 認証: `Authorization: Bearer <資格情報>`。資格情報は次のどちらか。ラッパーは文字列か、文字列を返す関数(ID トークンの取得・更新用)を受け取る
  - API キー(`edc_sk_` で始まる)
  - Google の ID トークン(サービスアカウント。audience は API の基点)
- `Idempotency-Key`(任意、UUID): `POST` を安全に送り直すためのキー。ラッパーは指定がなければ自動で付ける
  - 同じキー・同じ中身の送り直しは、1 時間のあいだ同じ応答を返す(分析をやり直さない)。中身が違えば 409 `conflict`、前のリクエストを処理中なら 409 `conflict`(`retryable: true`)

## 2. 型

### 2.1 DesignTag

形の正本は Gist の `DesignTagStructuredOutputSchema.json`。

- このパッケージのスキーマは形(項目の名前・型・件数・strict)だけを持ち、説明文(`title`・`description`。LLM への指示)を含めない
- 理由: 説明文はプロンプトの一部で、サーバーだけに置く。パッケージに含めると、npm で誰でも読めるうえ、スキーマを import したアプリのブラウザ用の JS にも入る
- LLM に渡す JSON Schema は、EDC Web API がこのスキーマにサーバーの説明文を付けて作る。説明文を変えても、このパッケージは変わらない
- 説明文を含めないことは、テスト(`test/schemas.test.ts`、`test/smoke.mjs`)で確かめる

### 2.2 `StoreLevel`

`"none" | "tags_without_sources" | "tags" | "content_and_tags"` — 保存を許可する範囲(狭い順)。

| 値 | 保存するもの |
|---|---|
| `none` | 中身を保存しない(取り下げの確認のため `id` は残る) |
| `tags_without_sources` | DesignTag。ただし `sources`(`Sense.sources`・`External.sources`。入力の原文をそのまま引用したもの)はすべて空の配列にする |
| `tags` | DesignTag(`sources` を含む) |
| `content_and_tags` | `tags` に加えて、整形後のテキストと `story` |

- `tags_without_sources` は、入力の原文を長く残せない呼ぶ側(利用規約で原文の保存期間が決まっているデータなど)のためのもの。`sources` 以外の項目は言い換え・解釈だが、原文に近い文になることはある。サーバーはそこまでは除かない
- どの値でも、`POST /v1/analyses` のレスポンスの `output` は `sources` を含む(保存の範囲は保存にだけ効く)

### 2.2a `UsageScope`(0.3.0)

`"owner-only" | "llm-source-only"` — 保存したものの使い方の範囲。保存するとき(`store` が `none` 以外)だけ付けられる。

| 値 | サーバーが守ること |
|---|---|
| `owner-only` | 似たタグの索引に入れず、どのクライアントの検索・要約・事例の参照(3.4・3.5)にも使わない。読み出し・取り下げは今までどおり作ったクライアントだけ |
| `llm-source-only` | 索引に入れ、サーバーの中の LLM の要約の材料にしてよいが、事例としては返さない(3.4 にも出さない) |
| 付けない | 今までどおり |

- `store: "none"` と一緒に付けたら 400 `invalid_argument`(ラッパーは送らない)
- 同じ `Idempotency-Key` の送り直しでは、`usageScope` も「同じ中身か」の比べる対象に入る

### 2.3 `AnalysisOutput`

| 項目 | 型 |
|---|---|
| `story` | string |
| `design_tags` | DesignTag[](3〜5件) |

### 2.4 `RunMetadata`

| 項目 | 型 |
|---|---|
| `model` | string |
| `generation.temperature` | number |
| `promptVersion`、`schemaVersion`、`inputNormalizationVersion`、`apiVersion` | string |
| `generatedAt` | string(ISO 8601) |
| `usage.inputTokens`、`usage.outputTokens`、`usage.thoughtsTokens` | number |

### 2.5 `ApiError`

```json
{ "error": { "code": "budget_exhausted", "message": "…", "retryable": true, "retryAt": "2026-09-27T00:00:00+09:00" } }
```

| `code` | HTTP |
|---|---|
| `unauthenticated` | 401 |
| `permission_denied` | 403 |
| `invalid_argument`、`input_empty` | 400 |
| `not_found` | 404 |
| `conflict` | 409 |
| `withdrawn` | 410 |
| `input_too_long` | 413 |
| `budget_exhausted`、`rate_limited` | 429 |
| `internal` | 500 |
| `llm_invalid_output` | 502 |
| `service_stopped`、`llm_unavailable` | 503 |

- `message` は利用者に見せてよい日本語。判定には `code` を使う
- `retryAt`(任意)は、次に試してよい日時
- ラッパーは、契約に合わない応答(形が違う本文、JSON でない本文、通信の失敗)も型のあるエラーにする。そのための `code` はラッパー側だけのもの: `network`(通信の失敗)、`timeout`(時間切れ)、`aborted`(呼ぶ側が中断した)、`invalid_response`(応答が契約に合わない)
- ラッパーは、送る前に形を確かめる。合わなければ送らずに `invalid_argument`(`id` が空・`.`・`..`、`idempotencyKey` が UUID でない、を含む)。資格情報が空・ヘッダーに使えない文字を含む・資格情報の関数が投げた、なら `unauthenticated`
- ラッパーのメソッドの失敗は、すべて `EdcApiError`。設定の誤り(`new EdcClient()` に渡すもの)だけは、作るときに `TypeError`・`RangeError`
- ラッパーは、リダイレクト(3xx)を追わずに `invalid_response` にする(API はリダイレクトを返さない。別のホストへ資格情報や `DELETE` を送らないため)
- ラッパーは、応答の本文を上限(既定 4 MiB、`maxResponseBytes`)までしか読まない。超えたら `invalid_response`
- `POST /v1/analyses` の応答の `stored`・`usageScope` が、送った `store`・`usageScope` と違えば `invalid_response`(サーバーは頼んだとおりに保存する)

### 2.6 `EdcCase`(0.3.0)

1 事例 = 1 つの体験(論文の事例集なら `target-heart-movements` の 1 つ。1 本の論文から複数の事例ができる)。

| 項目 | 型 |
|---|---|
| `caseId` | string。1〜100 字、`[A-Za-z0-9_:-]`。版をまたいで同じ事例は同じ ID。論文は `paper:<論文の ID>:<体験の番号>` |
| `origin` | `"paper"`(事例として返してよい出どころ。いまは論文だけ) |
| `source.title` | string(≤ 300 字) |
| `source.authors` | string[](≤ 30 人、各 ≤ 200 字。漢字とローマ字の並びの重複を除いた名前) |
| `source.venue` | string(≤ 200 字) |
| `source.year` | 整数 |
| `source.url` | string(≤ 2000 字)\| null |
| `tags.context`、`tags.approach` | string[](各 0〜10 件、各 ≤ 400 字) |
| `tags.effects` | `{ experience: string, responses: string[] }[]`(1〜5 件。各 ≤ 400 字、responses 0〜10 件) |

- `tags` は見せるための粒度(論文の事例集の v2-short と同じ)で、DesignTag の形ではない
- 保存した分析(どの `store`・`usageScope` でも)は、事例として返らない

## 3. エンドポイント

### 3.1 `POST /v1/analyses` — 分析する

リクエスト: `{ text: string, store: StoreLevel, usageScope?: UsageScope }`

レスポンス(200): `{ id: string, stored: StoreLevel, usageScope?: UsageScope, output: AnalysisOutput, meta: RunMetadata }`(`usageScope` は付けたときだけ)

### 3.2 `GET /v1/analyses/{id}` — 保存したものを読む

レスポンス(200):

| 項目 | 型 | 説明 |
|---|---|---|
| `id` | string | |
| `stored` | `"tags_without_sources"` \| `"tags"` \| `"content_and_tags"` | |
| `usageScope` | UsageScope(保存のときに付けたときだけ) | |
| `createdAt` | string | |
| `output.design_tags` | DesignTag[] | `tags_without_sources` のときは `sources` がすべて空の配列 |
| `output.story` | string(`content_and_tags` のときだけ) | |
| `text` | string(`content_and_tags` のときだけ) | 整形後のテキスト |
| `meta` | RunMetadata | |

- 保存していない(`store: "none"`)・他のクライアントの・ない `id`: 404 `not_found`
- 取り下げ済み: 410 `withdrawn`

### 3.3 `DELETE /v1/analyses/{id}` — 取り下げる

- 成功は 204(本文なし)。自分の `id` なら、取り下げ済み・保存していない(`none`)ものでも 204
- 他のクライアントの・ない `id`: 404 `not_found`(存在を明かさない)

### 3.4 `POST /v1/cases:search` — 似た事例を探す(0.3.0)

リクエスト: `{ designTags: DesignTag[](1〜5 件), limit?: number(1〜20、既定 5), excludeCaseIds?: string[](0〜10 件) }`

レスポンス(200):

| 項目 | 型 | 説明 |
|---|---|---|
| `indexVersion` | string(1〜100 字) | 答えに使った索引の版 |
| `embedding` | `{ model: string, dimensions: number }` | 近さの尺度 |
| `items` | `{ case: EdcCase, closeness: number }[]` | 近い順。同じ近さは `caseId` の昇順。`closeness` は −1〜1 のコサイン類似度 |

- 近い事例がない・索引が空のときは、エラーにせず `items: []`
- 保存しないので `Idempotency-Key` は要らない(ラッパーは付けない)
- 回数は分析とは別に数える。上限に達したら 429 `budget_exhausted`(`retryAt` つき)

### 3.5 `GET /v1/cases/{caseId}` — 事例を引き直す(0.3.0)

クエリ: `indexVersion`(任意。検索で返った版。情報として受け取るだけで、古い版を指しても、いまの版の事例を返す)

レスポンス(200): `{ status: "available", indexVersion: string, case: EdcCase }` または `{ status: "withdrawn" }`

- 取り下げ・事例集から外れた・作ったことのない `caseId` は、404 ではなく 200 の `{ status: "withdrawn" }`
- 回数には数えない
- ラッパーは、使えない文字の `caseId` を送らずに `invalid_argument`

## 4. 版

- 破壊的な変更は、パスの版(`/v1`)とパッケージのメジャー版を一緒に上げる
- 項目の追加は破壊的としない。レスポンスのスキーマは、知らない項目を捨てる(`strict` にしない)
