# @entertainment-design-catalog/design-tags

EDC Web API(テキストから DesignTag を分析し、集積する API)の、スキーマ(Zod)と HTTP リクエストのラッパー。
それ以外の機能(サーバーの動き、アプリの機能)は持たない。
スキーマは形だけで、LLM への指示(説明文・プロンプト)は含まない。

- 状態: 0.x(最初の公開の準備中)。0.x のあいだは、マイナー版で破壊的な変更をすることがある
- 通信の形: [docs/contract.md](docs/contract.md)
- 公開の流れ: [docs/release.md](docs/release.md)
- セキュリティ対策: [docs/security.md](docs/security.md)

## 使い方

```ts
import { EdcApiError, EdcClient } from "@entertainment-design-catalog/design-tags";

const client = new EdcClient({
  baseUrl: "https://<API のホスト>",
  // API キー、または ID トークンを返す関数(リクエストのたびに呼ぶ)
  credential: async () => getIdToken(),
});

try {
  const { id, output, meta } = await client.analyses.create({ text, store: "tags" });
  const saved = await client.analyses.get(id);
  await client.analyses.delete(id); // 取り下げ
} catch (error) {
  if (error instanceof EdcApiError && error.code === "budget_exhausted") {
    // error.message は利用者に見せてよい(テキストとして表示する)。error.retryAt は次に試してよい日時
  }
  throw error;
}
```

- 実行時の依存は `zod`(v4、peerDependency)だけ
- `client.analyses` のメソッドの失敗は、すべて `EdcApiError`(`code`、`message`、`retryable`、`retryAt`、`status`)。`code` の一覧は [docs/contract.md](docs/contract.md) 2.5
- `new EdcClient()` の設定の誤り(`baseUrl`、`timeoutMs` など)は、作るときに `TypeError`・`RangeError` で知らせる
- `error.message` はサーバーから来る文字列。画面に出すときは、HTML としてではなくテキストとして扱う(`innerHTML` や `dangerouslySetInnerHTML` に入れない)
- `error.cause` には、元のエラー(通信の失敗、資格情報の関数が投げたものなど)が入ることがある。ログに出すときは中身に気をつける
- リダイレクトは追わない。本文が `maxResponseBytes`(既定 4 MiB)を超えたら読むのをやめる。どちらも `invalid_response`

## ライセンス

[MIT](LICENSE)
