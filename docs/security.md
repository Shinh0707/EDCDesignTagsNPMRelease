# セキュリティ対策

- 状態: 2026-09-26
- 公開の流れと、配る側の対策の理由は [release.md](release.md)

## 1. リポジトリの中にあるもの

| ファイル | 対策 |
|---|---|
| `.npmrc` | `min-release-age=7`(公開から7日未満の版を入れない)、`strict-allow-scripts=true`(許可していないインストールスクリプトは失敗にする)、`allow-git=none`(git から直接入れる依存を禁止)、`save-exact` |
| `package.json` の `allowScripts` | インストールスクリプトを許可するパッケージ。`npm approve-scripts <pkg>` で版を固定して追加し、理由をコミットに書く |
| `.githooks/pre-commit` | コミット前に、秘密情報のファイル名とキーらしい文字列(Google、OpenAI、EDC の API キー、GitHub のトークン、秘密鍵)を検査する。gitleaks があればそれも実行する。clone したら `git config core.hooksPath .githooks` |
| `.github/workflows/ci.yml` | 権限は `contents: read` だけ。Actions は SHA で固定。`persist-credentials: false`。`npm ci` と `npm audit signatures`。Node 22・24・26 で試す |
| `.github/workflows/release.yml` | `v*` のタグで動く。タグと版の一致、テスト、公開物の一覧を確かめてから、environment `npm` の承認を経て `npm stage publish`。`id-token: write` は公開のジョブだけ。キャッシュを使わない |
| `.github/dependabot.yml` | 依存と Actions の更新の PR。`cooldown` 7日。minor・patch はまとめる。`@types/node` のメジャー版は上げない(`engines` の下限 22 に合わせる)。自動マージはしない |
| `.github/CODEOWNERS`、`SECURITY.md` | レビューの担当と、脆弱性の非公開の報告先 |

## 2. パッケージの中身

- 実行時の依存は `zod` だけ(peerDependency)。ほかの依存を足すときは、理由をコミットに書く
- インストールスクリプト(`preinstall`、`install`、`postinstall`、`prepare`)を持たない
- `files` で配るものを `dist/` と `README.md`、`LICENSE` に限る。公開の前に `npm pack --dry-run` の一覧を確認する
- 資格情報(API キー、ID トークン)を、ログ・エラーの本文・例外のメッセージに含めない
- プロンプトとスキーマの説明文(LLM への指示)を含めない。サーバーだけが持つ([contract.md](contract.md) 2.1)。テストのフィクスチャにも置かない
- ラッパーは、リダイレクトを追わない(別のホストへ資格情報や `DELETE` を送らない)。`id` の `.`・`..` を断る(パスの正規化で別のエンドポイントを指さない)。応答の本文は上限までしか読まない

## 3. GitHub の設定(手で行う)

| 設定 | 値 |
|---|---|
| Visibility | public(`Shinh0707/EDCDesignTagsNPMRelease`)。開発用の `Shinh0707/EDCDesignTagsNPM` は private のまま([release.md](release.md) 1 章) |
| Branch protection / Ruleset(`main`) | PR 必須、CI(`test`)の成功が必須、force push と削除を禁止 |
| タグの保護 | `v*` の作成・変更・削除は管理者だけ(`.github/rulesets/tag-protection.json`)。タグの作成が公開の引き金なので、公開の workflow の安全の要 |
| Actions の権限 | Workflow permissions は「Read repository contents」。「Allow GitHub Actions to create and approve pull requests」は切る |
| Environment `npm` | 必須の承認者を自分にする。`v*` のタグからだけ使える(公開の段階で作る) |
| Secret scanning と push protection | 有効 |
| Dependabot alerts / security updates | 有効 |
| Private vulnerability reporting | 有効 |
| アカウント | GitHub と npm の 2FA はパスキーか WebAuthn |

## 4. npm の設定(公開の段階で行う)

- Trusted Publishing に、このリポジトリと公開の workflow(`release.yml`、environment `npm`)を、stage publish だけを許可して登録する(手順は [release.md](release.md) 4 章)
- パッケージの設定で、トークンでの公開を許可しない(2FA 必須、トークン不可)
- npm のトークンは作らない
