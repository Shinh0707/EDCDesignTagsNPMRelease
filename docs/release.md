# 公開の流れとサプライチェーン対策

- 状態: 草案(2026-09-27 更新。公開の workflow `release.yml` と最初の公開の手順を追加)
- npm の organization: `entertainment-design-catalog`(個人で作成。後で組織へ渡す)
- パッケージ名: `@entertainment-design-catalog/design-tags`(最初の公開までは変えられる)

## 1. 段階

| 段階 | GitHub | npm |
|---|---|---|
| 1. 開発 | `Shinh0707/EDCDesignTagsNPM`(private) | 公開しない。EDCWebAPI とアプリは `npm pack` の tarball か `file:` で使う |
| 2. 確認 | 同上。第三者を collaborator として招待する | 公開しない |
| 3. 公開 | `Shinh0707/EDCDesignTagsNPMRelease`(public)。履歴を引き継がず、確認した中身を最初のコミットにする。以後の開発はこちらで行う | 名前を取るための空の版(0.0.1)だけ手元から公開し、Trusted Publishing を登録してから、中身のある最初の版(0.1.0)を workflow で公開する(4 章) |
| 4. 組織へ渡す | organization へリポジトリを移す(古い URL は GitHub が転送する) | organization に owner を追加する。Trusted Publishing の登録(リポジトリと workflow)と `repository.url` を移した先に更新する |

- 公開用のリポジトリを分けた理由: 開発用のリポジトリの履歴には、公開しない説明文(LLM への指示。[contract.md](contract.md) 2.1)が残っている。GitHub では、履歴を書き換えても PR の参照(`refs/pull/*`)などから古いコミットを取れることがあるため、履歴ごと公開しない
- 公開の前に npm に出さない理由: npm に出した時点で中身は誰でも見られる。また、private のリポジトリからは出どころの証明(provenance)を作れない
- スコープ付きのパッケージは、別のスコープへ移せない。はじめから organization のスコープで出すので、組織へ渡してもパッケージ名は変わらない

## 2. 配る側の対策

| 対策 | 内容 |
|---|---|
| Trusted Publishing(OIDC)だけで公開する | GitHub Actions から、トークンを持たずに公開する。パッケージの設定で、トークンでの公開を許可しない。provenance は自動で付く |
| 段階的な公開と承認 | workflow は `npm stage publish` で npm に置くだけ。公開には npm 上での承認(2FA)が要る。Trusted Publishing の登録も `--allow-stage-publish` だけにし、workflow が単独で公開できないようにする。公開の workflow は GitHub の environment(`npm`)で承認者を必須にする |
| workflow を守る | `main` とタグの保護(`v*` のタグは管理者だけが作れる。タグを押すと公開の workflow が動くため)。Actions は SHA で固定する。workflow の権限は最小(`id-token: write` は公開のジョブだけ)。公開の workflow ではキャッシュを使わない |
| アカウント | npm と GitHub の 2FA はパスキーか WebAuthn。npm のトークンは作らない |
| 中身を最小にする | 実行時の依存は `zod` だけ(peerDependency)。インストールスクリプトを持たない。`files` で配るものを限定する |
| 公開物を確かめる | 公開の前に `npm pack --dry-run` の一覧をレビューの対象にする |

## 3. 使う側の対策(このリポジトリ、EDCWebAPI、アプリの共通)

`.npmrc` の例:

```ini
save-exact=true
min-release-age=7
min-release-age-exclude=@entertainment-design-catalog/*
```

| 対策 | 内容 |
|---|---|
| `min-release-age=7` | 公開から7日未満の版を入れない(npm 11.10 以上)。自分たちのパッケージは除く |
| インストールスクリプトの承認制 | npm 11.16 以上の `approve-scripts`。npm 12 では既定で止まる。許可するパッケージは理由と一緒に記録する |
| 版の固定 | `save-exact`、lockfile、CI では `npm ci` |
| 署名の確認 | CI で `npm audit signatures` を実行する |

## 4. 最初の公開の手順

Trusted Publishing は、npm にパッケージがあるときにしか登録できない(`npm trust` はパッケージ名を取る)。そこで、最初の1回だけは手元から、コードを含まない空の版を出して名前を取る。空の版には出どころの証明が付かないが、コードがないので問題にならない。コードを含む版は、すべて workflow から出どころの証明付きで出す。

1. 公開してよいかの確認: パッケージに入る説明文(DesignTag、v2 の外枠)を、MIT で公開してよいか。共同で作った人がいれば同意を得る
2. GitHub(`Shinh0707/EDCDesignTagsNPMRelease`。public のリポジトリで行う。private の無料プランでは、ルールセットと environment の承認者が使えない)
   - Secret scanning、push protection、Private vulnerability reporting を有効にする
   - ルールセットを適用する:
     `gh api -X POST repos/Shinh0707/EDCDesignTagsNPMRelease/rulesets --input .github/rulesets/main-protection.json`
     `gh api -X POST repos/Shinh0707/EDCDesignTagsNPMRelease/rulesets --input .github/rulesets/tag-protection.json`
   - Environment `npm` を作る(Settings → Environments): Required reviewers に自分、Deployment branches and tags は「Selected」にしてタグ `v*` だけ
3. npm: 空の版(0.0.1)を手元から公開する(npm に 2FA でログインしておく)。コマンドは ASCII の文字だけにしている(日本語の入力で壊れないため)
   ```sh
   # このリポジトリの直下で実行する(LICENSE を写すため)
   mkdir /tmp/edc-placeholder
   cp LICENSE /tmp/edc-placeholder/
   cd /tmp/edc-placeholder
   # npm pkg set は package.json がないと失敗するので、先に空のものを作る
   echo '{}' > package.json
   npm pkg set name=@entertainment-design-catalog/design-tags version=0.0.1 license=MIT \
     "description=Placeholder to reserve the package name. Use 0.1.0 or later." \
     repository.type=git repository.url=git+https://github.com/Shinh0707/EDCDesignTagsNPMRelease.git
   printf '%s\n' '# @entertainment-design-catalog/design-tags' '' 'Placeholder to reserve the package name. Use 0.1.0 or later.' > README.md
   # 公開されるのが LICENSE・README.md・package.json の 3 つだけか確かめる
   npm publish --access public --dry-run
   npm publish --access public
   ```
   - このリポジトリの中で公開しない(コードの入った版になる)。空の版はコードを含まないので、出どころの証明がなくても問題にならない
4. npm: Trusted Publishing を登録する(stage publish だけを許可する)
   `npm trust github @entertainment-design-catalog/design-tags --file release.yml --repo Shinh0707/EDCDesignTagsNPMRelease --env npm --allow-stage-publish`
5. npm: パッケージの Settings → Publishing access を「Require two-factor authentication and disallow tokens」にする
6. 0.1.0 を公開する: この版の変更が `main` に入ってから
   ```sh
   git switch main && git pull
   git tag v0.1.0 && git push origin v0.1.0
   ```
   - Actions の `release` が動く。`verify` の結果(公開物の一覧は Summary)を見て、`publish` の承認(environment `npm`)をする
   - `npm stage list @entertainment-design-catalog/design-tags` で置かれた版を確かめ、`npm stage approve <stage-id>`(2FA)で公開する
   - 確かめる: npm のページに「Provenance」が出ていること。別のディレクトリで入れて `npm audit signatures`
7. 空の版を非推奨にする:
   `npm deprecate @entertainment-design-catalog/design-tags@0.0.1 "Placeholder to reserve the package name. Use 0.1.0 or later."`

2 回目からは 6 だけを行う(版を上げる PR → `main` → タグ)。

