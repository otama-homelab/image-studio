# Image Studio Web

Vite + React + TypeScriptの静的アプリ本体です。写真はブラウザ内で処理し、Pythonサーバーや画像アップロードAPIは使いません。背景処理は通常入口の固定ビルド設定へ接続済みです。source11非公開候補ではCPU/GPUから背景→サイズ調整→A4 PNG/PDFの実通しを確認していますが、モデル匿名配信・対象実機・画質・実印刷の受入は未完了です。

| 現在の機能 | 操作と状態 |
|---|---|
| サイズ調整 | 4プリセットとカスタム寸法、範囲・位置の数値/slider/ドラッグ、目安線、300dpi PNG作成・保存 |
| 印刷配置 | A4/L/2L/はがき、PNG/PDF作成・保存。サイズ済み画像は切り抜き・拡縮せず直接配置 |
| 工程間の移動 | サイズ調整と印刷は写真・設定を別々に保持。作成済み切り抜きPNGを明示的に印刷へ渡せる |
| トップ画面・補助情報 | 合成作例と操作フロー、入力条件/制約、Client-side processing、GitHub/MIT/依存・モデル表示、明示保存する診断JSON |
| 背景編集 | 固定設定からUI・推論・前景色推定・保存へ接続。source11非公開候補でCPU/GPU各1件の通しを確認。通常ビルドの設定は未採用で準備中 |

## 開発と検証

build用Nodeは[.node-version](.node-version)の24.8.0。現在のローカルnpmは11.6.0です。利用者のブラウザにNodeやPythonのインストールは不要です。共有adapterとLICENSEを参照するため、webだけでなくrepo全体をcheckoutしてください。

```sh
cd web
npm ci --ignore-scripts
npm test
npm run test:scripts
npm run test:domain
npm run build
npm run dev
```

開発/previewサーバーは127.0.0.1のみ。npmのinstall lifecycleは[.npmrc](.npmrc)でも無効にしています。明示的なtest/buildコマンドは実行できます。

`npm test`はVitest/Testing Library/jsdomで確認し、同時worker数1。native画像処理・実Worker・保存・印刷・GPUを受入済みとはしません。`npm run test:scripts`はNode標準test runnerでbuild識別と配布guardを6件確認します。`npm run test:domain`はNode標準test runnerで結果所有・中止・Worker通信・前景色ABI・PNG出力・背景編集sessionなどを直列実行します。privateモデル/ビルド済WASMや追加依存は要求しません。GPU・モデル・ブラウザを起動するコマンドは含みません。

[Web専用CI](../.github/workflows/web-check.yaml)は関連変更のPR/mainと手動実行を対象に、同じNode指定・固定lockfileで上記の確認を順番に行います。checkout/setup-nodeは確認済みcommit SHAへ固定し、contents:read、保存credentialなし、モデル/画像の取得・デプロイは含めません。定義を追加した段階で、GitHub上の実行成功は未確認です。

## 入力・出力と制約

- JPEG/PNG、1ファイル20MiBまで。JPEGは各辺16,384px・総画素2,400万以下、PNGは各辺4,096px・総画素400万以下の暫定条件です。PNG寸法はnative preview前とWorkerで検査し、上限超過では元の写真・位置調整を保持します。
- 現在のPNG readerはRGB/RGBA・グレースケールの1/2/4/8/16bit（透明度付きは8/16bit、透明色指定も対応）とindexed 1/2/4/8bit。16bit入力は同値のRGB/RGBA16と同じ8bit表現へ変換して処理・保存します。低bit（1/2/4bit）のindexed/grayscale Adam7等の全形式・ICC/向き・物理メモリの受入は未完了です。既存fast-png/fflate/pako/CRCを再利用し、private helperのSHAを確認します。元packageは変更しません。
- cropの正本は共有cropBox。react-easy-crop公開APIでpreviewへ写像し、書出はCanvasのhigh-quality補間を使う候補です。Pillowとの画質同等性は未受入です。
- 寸法は30×40/35×45/24×30/50.8×50.8mm、custom各辺9〜152mm・0.1mm単位。draft未確定中は保存不可。範囲10〜100%、位置0〜100%にはドラッグ以外の操作もあります。
- 直接印刷は元pxを保持。PNGのpHYs、JPEGのJFIF/EXIF密度を既存libraryで確認し、300±0.1dpiを受け入れます。密度なしは300dpiとして扱い、不適合ならサイズ指定へ戻れます。全EXIF fallback互換は未完了です。
- PDFはpdf-libを明示作成時にdynamic import。同じ用紙RGBのPNGを埋め込み、px由来の物理寸法を使います。module失敗では接続確認/明示再試行/準備済みPNG切替を案内します。ネイティブ保存・PDF viewer・100%実寸印刷は未受入です。
- 写真・設定・出力はメモリ保持。工程移動では保持し、reload/pagehideで失われます。Service Workerや完全offline保証はありません。形式別に準備済み出力を保持し、同時書出と候補decodeを共通gateで1件に制限します。native描画cache等を含む物理メモリ保証ではありません。
- 主対象はWindows Chrome。手動サイズ調整・印刷にWebGPUは不要です。API有無の検出を成功・性能保証とせず、実端末の導線/gesture/色/向き/保存/印刷は別に検証します。

16bitグレースケールは階調を保つため、同じ画素値をRGB16で表した場合と変換を揃えています。旧サーバー/Pillow12.3.0の直接I;16→RGB変換とは規則が異なります。この差を含む実機画質の受入は未完了です。

## Cloudflare Pagesの設定案（未公開）

| 項目 | 値 |
|---|---|
| Framework preset | None |
| Root directory | web |
| Build command | npm ci --ignore-scripts && npm run build |
| Build output directory | dist |
| Production/Previewの環境変数 | SKIP_DEPENDENCY_INSTALL=1 |
| Node指定 | web/.node-versionの24.8.0。Dashboardの別指定が競合しないことを確認 |
| Build watch paths | web/**、tools/browser-library-adapter/**、LICENSE、.github/workflows/web-check.yaml |

既存Pagesのbuild機構を使い、Functions/Python/Wrangler依存は追加しません。上記は入力すべき設定案で、実プロジェクトの変更・公開は未実施です。Cloudflare向けのcredentialをソースやブラウザへ渡しません。

buildにはMIT/第三者文書、標準_headers、合成作例、build-info.jsonを同梱。診断schema v4のbuildIdとbuild-info.jsonのsourceIdを照合できます。IDは固定ソース集合のhashで、最終dist署名やPages deployment IDではありません。公開時のartifact全SHA/production ID・CSP/HTTP・旧tab/rollback確認は残っています。大モデルはdistへ入れず、採用後のR2配布を別途検証します。

根拠と残条件は[配布条件](../docs/browser/distribution-conditions.md)、[再利用の採否](../docs/browser/adr-002-reuse-ml-libraries.md)、[数値仕様](../docs/browser/preprocessing-numerics.md)を参照してください。過去の小検証やCI定義を全体完成として扱いません。


## 非公開ローカル検証アプリ

通常のmain.tsxとは別のlocal-validation.html/src/localValidation.tsxを追加しています。既存の実モデルpolicy・5種類のWorker候補・ORT/OpenCV配布物を、tools/build_browser_local_app.mjsでprivate出力へ組み合わせます。モデル重みはコピーせず、GET限定の既存PoC serverの--local-appで固定allowlistだけを参照します。設定されたloopback origin以外では起動しません。モデルのSHA検証は既存resource loaderがロード前に行います。

この検証版はLOCAL_VALIDATION_ONLY.jsonを含み、Pages配布guardが拒否します。通常のnpm run buildに検証用entry/configを混ぜません。静的build/HTTP配信の確認と、実ブラウザ・モデル推論・OpenCV初期化・最大メモリの受入は別です。GPU/モデル/ブラウザの起動は、端末負荷に関する現在の実行指示を確認してから行います。


## 配布物を公開前に固定して照合する

通常build後、`npm run release:inventory -- create dist /path/to/review/release.json`で全fileの相対path/byte/SHA、build情報とartifactIdを保存できます。保存先directoryは事前に作成し、distの外を指定します。既存JSONは上書きしません。`npm run release:inventory -- verify dist /path/to/review/release.json`で同じ配布物か確認します。同じ長さの改変や余分なfileも拒否します。private検証buildには使えません。

旧版のdistと一覧を組で保持し、復帰前にもverifyします。artifactIdは署名やPages deployment IDではなく、一覧作成後の変更を防ぐ機能でもありません。公開/復帰時は実際のdeployment IDと、採用R2 model/runtime manifestの版・SHAも別に記録します。現時点では実Pages/R2公開・ロールバックは未実施です。


GitHubのbrowser check workflowはbuild後に公開distをreview用directoryへcopyし、既存のrelease inventoryでcopyとbuild元の両方を照合します。公式actions/upload-artifact v7.0.2をcommit SHAへ固定し、distとinventory.jsonを単一review artifactとして14日保持する定義です。モデル・private検証app・credentialは対象に含めません。これはCI定義であり、GitHub上の実行・artifact取得・Pages公開の成功はまだ確認していません。期限後の復帰保証はなく、公開版の長期保管と実deployment IDの記録は別途必要です。

### 非公開モデル候補のbyteレビュー

モデルを含む非公開本体の全mountは、公開dist用inventoryとは別に照合します。親workspaceから実行する例です（既存のprivate build manifestと、新規レビューJSONを指定します）。

```bash
node image-studio/tools/review_browser_private_artifact.mjs create \
  image-studio-browser-evaluation \
  image-studio-browser-evaluation/hr-matte-actual-input-main-01/local-app.json \
  image-studio-browser-evaluation/private-release-byte-review-01/inventory.json

node image-studio/tools/review_browser_private_artifact.mjs verify \
  image-studio-browser-evaluation \
  image-studio-browser-evaluation/hr-matte-actual-input-main-01/local-app.json \
  image-studio-browser-evaluation/private-release-byte-review-01/inventory.json
```

全sourceをstreamで読み直すため、モデル容量相当のローカルI/Oが発生します。画像やモデルを解釈・実行せず、ネットワークにも送信しません。noticeも別項目として内容IDに含め、既存JSONは上書きしません。byteの対応確認であり、配布承認・署名・ファイルの変更防止ではありません。モデル採否/許諾/source release/配信条件の受入と、Pages公開distのprivate拒否は別に維持します。

選択model Workerの非公開sourceレビューでは、`tools/build_browser_model_prepare.mjs`の既存4引数の後へ`--review-source-map`を指定するとexternal mapとmetafileを追加保存する。通常buildには出力しない。mapは元source/policyを含むため配布対象へ入れない。実行Workerのbyteは既存選択物と一致を確認済みで、権利表示の完全適用性や公開承認の代用ではない。証拠は`docs/browser/validation/2026-11-02-selected-worker-source-attribution.json`。

## 起動・オフラインと更新の範囲

初期公開はオンライン起動を前提とし、アプリ独自のService Workerは登録しません。モデルの保存済み表示は、HTML/Worker/ORT等も揃った完全オフライン状態を意味しません。開いた画面の作成済みファイルを再保存できた検証と、再起動や新しい処理のオフライン対応は別です。写真はページ内メモリのみなので、更新・再読込前に必要な出力を端末へ保存してください。固定manifest、別タブでの保存データ削除、公開版の復帰と未検証範囲は[起動・更新方針](../docs/browser/model-manifest-and-cache.md)を参照してください。
