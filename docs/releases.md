# バージョン更新とリリース

[ドキュメント一覧](../README.md#ドキュメント)

ブラウザ版のみを公開します。DockerイメージとGHCRへの公開は廃止しました。

| 起点 | 検査・配信 |
|---|---|
| `main`へのpush | 全検査後、Pages `preview`へ配信 |
| 安定`vX.Y.Z`タグ | 同じ検査後、Pages `production`へ配信し、GitHub Releaseへ静的成果物を添付 |
| PR・web-check手動実行 | 検査と成果物保存のみ |
| Bump version | VERSION/package/lockを同期し、タグ作成後にブラウザworkflowを明示呼出 |

## 通常のリリース

1. 変更をmainへ反映し、Previewで必要な確認を済ませます。
2. **Bump version**をmainに対して実行します。patch/minor/majorを指定できます。
3. ブラウザ検査、Pages本番配信、GitHub Releaseを確認します。

```sh
gh workflow run version-bump.yaml --ref main -f bump=patch
```

Bump versionは`VERSION`、`web/package.json`、`web/package-lock.json`を同期してコミット・タグをatomic pushします。GITHUB_TOKENのtag pushは別workflowを起動しないため、web-checkを直接呼びます。版を先に同期済みの場合は、そのmain内commitへ一致する安定タグを一度だけ付けます。公開済みタグを動かしません。

## 検査と配布物

`web-check.yaml`がscripts・型・domain/Worker・UI・依存audit・モデル入力・build・配布guardを検査します。同じ実行が保存した`dist/`と`inventory.json`をdeploy jobで全bytes/SHA照合し、再buildせずPagesへ配信します。モデルは固定HF commit、private marker・25MiB上限・出力契約のguardを維持します。

タグ公開時は同じ検査済み成果物を`image-studio-web-X.Y.Z.zip`とSHA256としてGitHub Releaseへ添付します。既存Release/添付の黙った上書きはしません。公開済みassetがある場合は照合してから個別に復旧してください。ソースはタグのGitHub source archiveから取得できます。

## Pages設定

- Project：`image-studio`。Production branch：`production`。
- 本番：**https://image-studio.otama-playground.com/**
- Preview：https://preview.image-studio-c5u.pages.dev/
- Pages標準domain：`image-studio-c5u.pages.dev`。CNAMEの転送先にもこの完全な名前を使用します。
- Secrets：対象アカウントのPages Read/Writeを持つ`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。
- Variable：固定HF配布入力を示す`IMAGE_STUDIO_BUILD_INPUT`。R2・S3キーは不要です。

DNS・独自domainの変更権限はPages公開権限と別です。アカウントトークンへ認証値を埋め込んだり、ブラウザへ渡したりしません。

## 復帰と履歴

問題時は確認済みの**production** deploymentへCloudflare Pagesで戻し、commit・sourceId・artifact inventoryを照合します。Previewを本番domainへ接続しません。初回の確認済み本番はv1.2.0/commit630bb43a90186c3aa9a1574f84926fb7b84e887e、deployment265e3a7b-5573-4f42-b128-e85197ac213eです。

サーバー側の復帰は、すでに開いているタブ内の写真やJavaScriptを巻き戻しません。未保存写真のあるタブを強制reloadせず、既存タブの保存と新しいタブの動作を別々に確認します。写真はreloadで失われる仕様です。

旧サーバー版のイメージ・タグは履歴です。新規イメージは作りません。既存タグやモデル/NOTICE/sourceの不変資産、必要な復帰証拠は削除しません。
