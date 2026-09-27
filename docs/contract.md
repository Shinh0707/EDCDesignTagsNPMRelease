# EDC Web API v1 — 通信の形

- 状態: 草案(2026-09-26)
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

`"none" | "tags" | "content_and_tags"` — 保存を許可する範囲。

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
- `POST /v1/analyses` の応答の `stored` が、送った `store` と違えば `invalid_response`(サーバーは頼んだとおりに保存する)

## 3. エンドポイント

### 3.1 `POST /v1/analyses` — 分析する

リクエスト: `{ text: string, store: StoreLevel }`

レスポンス(200): `{ id: string, stored: StoreLevel, output: AnalysisOutput, meta: RunMetadata }`

### 3.2 `GET /v1/analyses/{id}` — 保存したものを読む

レスポンス(200):

| 項目 | 型 | 説明 |
|---|---|---|
| `id` | string | |
| `stored` | `"tags"` \| `"content_and_tags"` | |
| `createdAt` | string | |
| `output.design_tags` | DesignTag[] | |
| `output.story` | string(`content_and_tags` のときだけ) | |
| `text` | string(`content_and_tags` のときだけ) | 整形後のテキスト |
| `meta` | RunMetadata | |

- 保存していない(`store: "none"`)・他のクライアントの・ない `id`: 404 `not_found`
- 取り下げ済み: 410 `withdrawn`

### 3.3 `DELETE /v1/analyses/{id}` — 取り下げる

- 成功は 204(本文なし)。自分の `id` なら、取り下げ済み・保存していない(`none`)ものでも 204
- 他のクライアントの・ない `id`: 404 `not_found`(存在を明かさない)

## 4. 版

- 破壊的な変更は、パスの版(`/v1`)とパッケージのメジャー版を一緒に上げる
- 項目の追加は破壊的としない。レスポンスのスキーマは、知らない項目を捨てる(`strict` にしない)
