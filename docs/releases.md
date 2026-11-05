# バージョン更新とリリース

[ドキュメント一覧](../README.md#ドキュメント)

## 通常のリリース

1. アプリの変更と必要な確認を済ませ、`main`へpushします。
2. GitHub Actionsの **Bump version** を開き、`main`と更新種別を指定して実行します。
3. `publish / image`まで成功することを確認します。
4. GitHub Releaseに記載されたSemVerとdigestを、利用先のイメージ参照へ設定します。
5. 利用先でGPUの認識と、変更した機能の動作を確認します。

| 種別 | 用途 | 例 |
|---|---|---|
| patch | 不具合修正 | 1.1.2 → 1.1.3 |
| minor | 互換性を維持する機能追加 | 1.1.2 → 1.2.0 |
| major | 互換性に影響する変更 | 1.1.2 → 2.0.0 |

CLIからも実行できます。

```bash
gh workflow run version-bump.yaml --ref main -f bump=patch
gh run list --workflow version-bump.yaml --limit 5
```

workflowは`VERSION`とWebのpackage/lockfileの版を同期して更新し、botのコミットと`vX.Y.Z`タグをatomic pushしてから、reusable release workflowを直接呼び出します。GITHUB_TOKENによるタグpushでは別のworkflowが自動起動しないため、明示的に呼び出しています。実行後は`git pull --ff-only`でbotの更新を取り込んでください。

## 公開されるもの

- `ghcr.io/otama-homelab/image-studio:X.Y.Z`
- `ghcr.io/otama-homelab/image-studio:latest`
- GitHub Release: バージョンとイメージdigest。
- 依存ビルド用の`buildcache`とActionsのビルド記録。

`VERSION`とタグが一致しない場合、リリースは失敗します。手動のタグpushでもビルドできますが、通常はBump versionを使ってください。

イメージはlinux/amd64向けです。アプリ・依存は含みますが、モデル本体は初回起動時に取得します。ソースリポジトリとGHCRパッケージの公開範囲は別に管理されます。

## 失敗した場合

workflowの失敗したstepを確認します。ディスク不足・依存のimport失敗・VERSION不一致などを区別してください。GPUライブラリを含むため、依存層の取得・展開はキャッシュ利用時でも数分かかることがあります。

同じタグのコードに問題がなく、ビルドや通信などの一時的な失敗で、イメージ・Releaseがまだ公開されていなければ、**Release image**のworkflow_dispatchから既存タグを指定して再試行できます。

```bash
gh workflow run release.yaml -f tag=vX.Y.Z
```

コード修正が必要な場合はmainへ修正を入れ、次のpatchを発行します。公開済みタグ・バージョンを差し替えないでください。キャンセルや失敗で番号が飛んでもそのまま残します。

## 利用先の更新とロールバック

運用では`latest`だけを使わず、SemVerとdigestを固定します。新しいタグの公開だけでは、利用先のDeploymentは更新されません。

問題があれば、利用先のイメージ参照を直前の確認済みSemVer/digestへ戻します。モデルキャッシュは再利用できますが、写真の一時領域はPod・コンテナの交換で消えます。

workflowの権限はGitHubの`contents`と`packages`を使用します。認証値をbuild-argやイメージのENVに渡しません。ログ・Release・ビルド記録は公開範囲に合わせて扱ってください。

## ブラウザ版：trunkはpreview、タグは本番

`otama-playground-astro`と同様に、通常開発と本番リリースを分けます。
このリポジトリのtrunkは`main`です。ブラウザ配信は`web-check.yaml`が所有します。

| 起点 | 検査 | Pagesの配信先 |
|---|---|---|
| `main`へのpush | scripts・型・domain/Worker・UI・依存audit・build・配布物検査 | `preview` |
| `vX.Y.Z`タグのpush | 同じ検査をタグのコードで実行 | `production` |
| PR | 検査と配布物の保存 | 配信しない。forkへ認証を渡さない |
| Bump version | 新タグを指定して同じworkflowを直接呼ぶ | `production` |
| web-checkの手動実行 | 検査と配布物の保存 | 配信しない |

本番タグは安定版SemVerで、タグ先の`VERSION`と一致し、`main`に含まれるコミットである必要があります。
版番号の正本はルートの`VERSION`です。`web/package.json`と`web/package-lock.json`の版も同じ値に同期します。ブラウザのbuild metadataは`VERSION`を使い、packageとの不一致はビルド時に拒否します。タグも同じ版と一致させます。
GITHUB_TOKENのpushでは別workflowが自動起動しないため、Bump versionはコンテナの`publish`とブラウザの`publish-web`を明示的に呼びます。
それぞれの配信結果は独立しており、片方の失敗が他方を自動で巻き戻すことはありません。

検査jobが作った`image-studio-static-review`（`dist/`と`inventory.json`）を同じ実行のdeploy jobで取得し、
全bytes/SHAと既存のprivate/model/25MiB guardを再検査してから配信します。deploy jobでビルドし直しません。
GitHub Actionsのsummaryへ配信先ブランチ、コミット、固有URL、aliasを記録します。
productionの実行は取り消さず直列化し、新しいpreviewは古いpreviewを取り消せます。

### 初期設定

- Cloudflare Pagesのプロジェクト名：`image-studio`
- Pages側のProduction branch：**`production`**。Gitのtrunk名とは分けます。
- GitHub Actions Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`
- トークン権限：対象アカウントのPages Read/Write。ゾーン限定のpolicyでは不足します。
- 予定公開URL：`https://image-studio.otama-playground.com`。独自ドメイン/DNS/TLSの接続は別途必要です。

配信前にAPIでProduction branchを照合し、`preview`等へ誤設定されていればアップロードを拒否します。
Cloudflare認証はdeploy jobだけに渡し、アプリのbuild環境や配布JSへ埋め込みません。
モデルの配布入力はGitHub repository variable `IMAGE_STUDIO_BUILD_INPUT`の固定CID・size・SHAで指定します。descriptorの`source_id`は、その入力をレビューした過去のbuildの来歴です。pair内のreview sourceIdとの一致、archiveと全memberのSHA、対応するモデル変換/runtime sourceは検証を維持します。
現在のアプリは別に`VERSION`・全source・実際の配布入力からbuild-infoを生成し、同じCI実行のGit commitとinventoryへ結びます。UIや版番号だけの変更で、同じモデルを再uploadしたりHF入力を毎回作り直したりする必要はありません。モデル/設定の変更時は新しい固定入力をレビューして変数を更新します。アプリsourceは該当GitHub commit、モデル変換/runtimeの必要sourceは固定HF URLで案内します。

Hugging Faceへのモデル公開はこのworkflowでは行いません。モデル配信を有効にする際は固定commitと対応manifest/notice/sourceを別途確認します。
現行の通常public buildは背景機能が準備中の静的アプリです。CI追加によってprivate検証モデルが公開されることはありません。

### 確認とロールバック

mainのpreviewで操作と保存を確認してから、通常のBump versionまたは安定版タグで本番へ進めます。
CIの成功は実機・写真品質・物理印刷の受入の代わりにはなりません。
不具合時はCloudflare Pagesの過去の確認済みproduction deploymentへ戻し、記録済みコミット・inventoryと照合します。
Gitタグは移動せず、コード修正は次のpatchへ進めます。版を固定したモデル資源は旧リリースのため保持します。
previewのaliasを本番独自ドメインへ接続しないでください。

### 背景機能付きビルドの入力

通常の`npm run build`は`web/background-release/`の有無で背景設定を決めます。
入力があれば同じCI内で4親・2子Workerと資産を生成・照合して本体へ接続します。
入力が不正な場合は配信を止め、背景機能なしの版へ切り替えません。
入力schema、固定依存、検証候補の組立方法は
[公開runtimeへの接続](browser/public-runtime-integration.md#通常buildでのworker資産組立)を参照してください。
現在の非公開HF検証入力は採用directoryへ配置していないため、通常CIは手動編集版を作ります。

### 2026-11-04の実接続チェック（配信は未実施）

Pages `image-studio` は既存で、Production branchは `production`。Wranglerで直接
配信するため、Git integrationの `source` がないことは異常ではない。
ローカルAccount Tokenでproject/deployment/domainの参照に成功し、
GitHubの `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` の名前の存在も確認した。
Secretの値や、実Actions内での認証成功を確認したことにはしない。

remote `main` はまだブラウザ用 `.github/workflows/web-check.yaml` がなく、
Pages deploymentは0件、custom domainも未登録。予定名のpublic DNS照会は
A/AAAA/CNAMEとも回答なしで、実配信・TLS・header・rollbackは未検証。
現在のsource11固定ペアはprivate markerを持つ非公開検証候補であり、公開guardを
外すだけで配信へ進めない。公開条件を満たす候補とworkflowをレビューしてmainへ
反映し、最初のpreviewを検査してからタグ本番・domain接続・旧deployment復帰を確認する。

R2 APIは403/10000で参照不可。この結果からbucket不存在や未有効化とは断定せず、
HF配信案のためにR2有効化・課金設定・S3 key作成を追加で要求しない。
[読み取り専用の実接続証拠](browser/validation/2026-11-04-pages-live-readonly-preflight.json)を参照。


### source14の復帰資産照合（2026-11-04、private候補のみ）

旧713d/620cと現7677/c2bdの各111file、両source archive、両build-input archiveを実hash照合した。共通105fileはbyte一致、モデル固定commitと4親Worker policyも同じ。差分は旧/新の各JS2本＋MODEL_NOTICES1本、同pathで変更するindex.html/build-info.json/background-release.jsonの3件。再生成やモデルcopyなしで既存資産を保持する。

旧source13にはsource14で修正した旧session通知/取消結果と、transfer初表示前origin失効時のrollback欠落がある。保管資産が完全であることは、安全な復帰先であることを意味しない。旧候補を推奨復帰先へ昇格させず、復帰先も既知不具合と受入範囲を審査する。

旧tabが参照する `assets/index-CNCp-CUs.js` と遅延読込の `assets/releaseRuntime-DDWVq599.js` は現artifactに存在しない。これは静的set差分で、Pagesが実際に404を返すことや写真消失の実証ではない。初previewでは旧tabを開いたまま切替え、遅延import/Worker/保存の結果を確認する。旧fileの保持方針と安全な案内が成立するまで、この条件を合格にしない。写真があるtabを自動reloadして回避しない。

Pagesでdeployment全体を戻しても、既に新版JSを持つtabや未保存写真の状態は巻き戻らない。復帰の手順ではdeployment ID・artifactId・モデルcommitを照合し、既存tabで写真を保存できるかと、新tabで復帰版が動くかを別々に確認する。両artifactはprivate markerを保持しており、この資料を根拠にmarkerを除去/公開しない。

[復帰資産の照合と限界](browser/validation/2026-11-04-source14-rollback-inventory.json)。実Pages deployment/旧tab/本番rollbackは未確認。


### source14の背景runtime読込失敗でも手動写真・保存を保持（制御native）

`releaseRuntime`のdynamic importはmain起動時に開始する。背景操作を押すまで待つ実装ではない。現7677/c2bdの通常入口を使い、このJS応答だけを保留し、crop写真選択→PNG作成後に404を返した。失敗案内が出ても同じdocument/写真Blob URL/既存保存linkを保持し、そのlinkからnativePNGを保存。写真再選択なしの再作成も新しいlinkまで確認した。

nativePNG354×472/300dpi/263942Bは既存manual基準と全byte一致。UIの背景読込失敗1案内を除き未捕捉browser errorなし、model/HF取得0。応答fixtureの意図したruntime404以外のHTTP応答は200。Python send_errorの同path Not Found診断と404応答logは分けて検査し、他assetの失敗を除外していない。

[制御HTTPのnative証拠](browser/validation/2026-11-04-source14-runtime-import-failure-native.json)。本体変更なし。この試験は、実Pagesでの版切替・CDNの旧asset保持・別時点の旧tab・deployment rollbackの合格ではない。


### 2026-11-04 06:52UTC頃のcontrol-plane再確認（変更なし）

Pages project参照は再度200、branch production、deployment0/custom domain0。GitHub connectorでmainのweb-check.yamlは404、ghでは必要Secrets名2件の存在を確認（値の確認ではない）。予定domainのpublic DNS A/AAAA/CNAMEは回答なし。HF新repo head6ea9fff8…/private、旧workbench privateを維持。

[最新read-only証拠](browser/validation/2026-11-04-pages-current-readonly-recheck.json)。実deploy成功を意味しない。R2追加検査/有効化・公開/branch push・Pages deploy・DNS変更は行っていない。
