# モデル・主要依存の配布条件（A05）

一次資料確認日: 2026-10-31。モデルカードは計画の固定revisionから取得。
2026-11-03追補: 冒頭の候補範囲を現二構成へ整合。後段の日付付き記録は当時の状態を残す。
モデルと主要依存の出典・条件・初期公開範囲を以下に確定する。
実装時のlockfileと配布物のLICENSE/NOTICE同梱はE01/F07で照合する別の必須ゲート。
手動機能の先行本体では固定npm依存の文書をbuildへ同梱しているが、モデル/runtimeを含む最終配布物の監査は未完了。

| 対象 | 一次資料・条件 | 初期公開範囲と対応 |
|---|---|---|
| MODNetコード・重み / Xenova ONNX | 固定資料 `model-notices/MODNet-upstream-README.txt` はcode/models/demosをApache-2.0（doc/gifを除く）と明記。ONNXは固定revision fa2fa546052fba4c08921230a26cc69a333fca12 のカードもApache-2.0宣言 | CPU/モバイルの軽量候補、GPU版は選択肢。元著作権・Apache本文・存在するNOTICE・変更告知を維持。変換来歴/元重み対応/実機/公開の未完は別ゲート。READMEのGIFや例示の外部写真を素材として転載しない |
| BiRefNet HR重み | [固定モデルカード](https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting/blob/5d6b6f8adcb5b417c871b1d84ceaae9871355b7f/README.md) の `license: mit` | A08/A11合格後の同一重み変換物のみ候補。元revision・重みSHA256・変換物SHA256・MIT文書を添付 |
| BiRefNetコード | [公式MIT LICENSE](https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE) | 変換環境で使用。固定revisionのremote codeに適用される文書もexport時に保存する。コードと重みの条件を混同しない |
| ViTMatte Base重み | [固定モデルカード](https://huggingface.co/hustvl/vitmatte-base-distinctions-646/blob/b58373f8dbbfbeb58157456e2e4949f9f872aa18/README.md) の `license: apache-2.0` | A09/A11合格後のみ候補。Apache-2.0、存在するNOTICE、出典と変換変更の記録を同梱 |
| SCRFD-10G・2d106det | [InsightFace公式License節](https://github.com/deepinsight/insightface#license) はコードMITと学習済みモデルの非商用研究条件を分ける | 初期公開から除外。自動download、manifest、R2、アプリcacheにも含めない。許諾取得または代替選定後に再開 |
| ONNX Runtime Web / WASM | [公式MIT LICENSE](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) | 使用するnpm版のLICENSE/ThirdPartyNoticesとWASM同梱物をE01で固定・確認 |
| React | [公式MIT LICENSE](https://github.com/facebook/react/blob/main/LICENSE) | 初期UIに採用。固定npm版の文書を同梱 |
| Vite | [公式MIT LICENSE](https://github.com/vitejs/vite/blob/main/LICENSE) | build用。build成果物に含まれる依存をlockfileから別途列挙 |
| rembg | [公式MIT LICENSE](https://github.com/danielgatis/rembg/blob/main/LICENSE.txt) | Python版自体をブラウザ配布しない。前景色推定の移植時は実際に利用するpymatting等のコード出典・版・条件も追跡 |
| TypeScript 5.9.3 | [公式LICENSE](https://github.com/microsoft/TypeScript/blob/v5.9.3/LICENSE.txt)、Apache-2.0 | 型検査/build用。型契約の検査で使用済み。アプリ側のversion固定はE01 |
| pdf-lib 1.17.1 | [固定tagのMIT LICENSE](https://github.com/Hopding/pdf-lib/blob/v1.17.1/LICENSE.md) | PDF生成に採用。ブラウザ内でPNG埋込とmm由来のpage寸法を指定。著作権とMIT文書、実際にbundleする依存の条件を同梱 |
| PyMatting 1.1.16 | [公式MIT LICENSE](https://github.com/pymatting/pymatting/blob/master/LICENSE.md)、稼働wheelの`pymatting-1.1.16.dist-info/licenses/LICENSE.md`もMITと確認 | rembgが使う前景色推定の移植元。必要なML kernelをC/WASMへ移植し、出典・版・変更・MIT著作権を記録。Python/Numba runtimeはブラウザ配布しない |
| WASM build toolchain | 現画像処理候補はxcc/wccとそのruntimeを使用。`runtime-notices/xcc-LICENSE.txt`はMIT。trimap等のcompiler-rt/別componentは各実配布noticeで追跡 | Emscriptenは初期調査候補で現生成物の根拠ではない。compiler本体とリンク済みruntime/移植元を分離し、固定source・変更・再生成物・実同梱文書を照合。公開source releaseは未完 |

## 比較・変換専用の主要依存

2026-10-31に変換venvの配布metadataと同梱文書の所在を照合した。
以下のPython runtime自体は初期Web bundleに含めない。転用コードや配布物へ組み込む部分が
生じた場合は、表のlicense名だけでなく実際のLICENSE/NOTICEを継承する。

| 対象 | 確認した版・条件 | 配布文書の所在（wheel内） |
|---|---|---|
| torch | 2.12.1、BSD-3-Clause | `torch-2.12.1.dist-info/licenses/LICENSE`・`NOTICE` |
| torchvision | 0.27.1、BSD表記 | `torchvision-0.27.1.dist-info/LICENSE` |
| transformers | 5.18.0、Apache-2.0 | `transformers-5.18.0.dist-info/licenses/LICENSE` |
| timm | 1.0.30、Apache-2.0 | `timm-1.0.30.dist-info/licenses/LICENSE` |
| kornia | 0.8.3、Apache-2.0 | `kornia-0.8.3.dist-info/licenses/LICENSE` |
| einops | 0.8.2、MIT | `einops-0.8.2.dist-info/licenses/LICENSE` |
| NumPy | 2.3.5、BSD系の同梱条件 | `numpy-2.3.5.dist-info/LICENSE.txt` |
| Pillow | 変換側12.2.0、MIT-CMU。参照サーバー12.3.0とは区別 | `pillow-12.2.0.dist-info/licenses/LICENSE` |
| ONNX | 1.23.2、Apache-2.0 | `onnx-1.23.2.dist-info/licenses/LICENSE`・`NOTICE` |
| onnxscript | 0.7.2、MIT | `onnxscript-0.7.2.dist-info/licenses/LICENSE` |
| native ORT | 1.31.1、MITのmetadataを確認 | [公式LICENSE](https://github.com/microsoft/onnxruntime/blob/v1.31.1/LICENSE)。metadataのfile一覧にlicenseがないことを「文書不要」とは解釈しない |

BSD等は著作権・条件・免責等を含む元文書の全条件に従い、Apacheには必要なNOTICE等も添付する。
Python側依存の条件をモデル重みの条件へ流用しない。
元モデルカード・元重みのSHA、変換環境freeze、変換コードの版をそれぞれ保持する。

## 初期公開へ含める範囲

背景機能の採用候補はMODNet CPU/GPUと、HR＋ViTMatte GPU/CPUの明示選択。高画質CPUも利用者指定の対応対象とし、非常に遅いこと・多いRAM使用・計測条件付き参考時間を当該構成だけに表示する。モバイルの実機受入は別条件で、CPU対応を実iOSの受入としない。A11および対象端末の受入・配布条件を満たした構成だけを提供し、前景色推定kernelと対応runtimeも個別に追跡する。
顔重み2件とInsightFace runtimeは初期配布へ含めない。手動cropと印刷はモデル取得なしで利用可能にする。
Python/Gradio/ROCm/CUDA/torch/timm/transformers/kornia等は比較・変換環境だけで使用し、
ブラウザbundleへ組み込まない。変換でコードを転用する場合は、その部分の出典と条件を追跡する。
画像decode/Canvas/Blob/ダウンロードにはブラウザAPIを使い、PDFはpdf-lib、前景色は上記kernelとする。
別ライブラリへの変更・追加は本一覧を更新してから採用する。

現xcc/wcc構成の固定sourceと再生成物はD06/E08の証拠へ対応付け、別host再現と公開source releaseは未完として管理する。
ツールがインストール済み・kernelが移植済みとは扱わない。生成glueや第三者runtimeが入る場合は、
compiler本体のライセンス表示だけで済ませず、その配布部分の条件もF07で確認する。

## 保存済み一次資料の識別

取得した固定モデルカードのSHA256:

- HR: `834ba4551d22697900286f26909064338c1e04dd44a8feb43e2992c0d644334b`
- ViTMatte: `8989345ec2ce5963f28d0398cf2230059e10c3107a0bbbac4f26f21e29f3b1d3`

これはモデル本体のSHA256ではない。モデルの配布manifestへ流用しない。
main branchのコードLICENSEは確認時点の根拠であり、将来採用するnpm版の条件の代わりにはしない。

## 実装・公開段階へ引き継ぐ必須ゲート

E01でlockfileを固定し、pdf-libやORT等の実際の推移依存を列挙する。
F07/F08で配布artifactに必要な著作権・LICENSE・NOTICEを揃え、変換物には出典・元revision・
元重み/成果物SHA・精度・入出力・opset・検証runtimeを添付する。モデル採否はA11で決定。

以前はA05完了前にWeb lockfileを要求していたが、E01がD12/A11/A05完了後という依存順と循環していた。
A05本来の完了条件である「全モデル・主要依存の出典/配布条件と公開範囲の決定」をここで満たし、
実装後にしか確認できないartifact同梱・lockfile監査は削除せずE01/F07へ引き継ぐ。

## hash-wasm候補依存の確認（2026-10-31）

hash-wasm 4.12.0の公開tarball SRIを照合し、SHA256専用UMD bundle（18,616 bytes）を私有評価領域で使用。
package/LICENSEはMIT、Copyright (c) 2020 Dani Biró。著作権表示・許諾文の同梱が必要。
同LICENSEには埋込C実装に別のpermissive licenseがあり得るためsrc先頭を確認する指示もある。
従ってpackage LICENSE確認のみで配布notice監査完了とはしない。採用時はSHA256のC出典を確認し、
E01で依存固定、F07で対応noticeをartifactへ同梱する。現時点は診断用adapter候補で本番配布していない。

## OpenCV.js配布候補の確認（2026-11-01）

@techstark/opencv-js 4.11.0-release.1は第三者配布で、package/LICENSEはApache-2.0本文。
公開tarball SRIと選択bundle SHAを照合した。既存OpenCV公式配布物と同一だと推定しない。
内包WASM/第三者コードの出典・NOTICE・build来歴と実行資源を監査するまで本番採用しない。
[証拠](validation/2026-11-01-opencv-trimap-adapter.json)はadapter候補調査で、
F07配布notice完了やE01依存固定を意味しない。

## PNG export候補依存（2026-11-01）

private評価環境にfast-png 8.0.0、crc-32 1.2.2を固定し、install scripts無効で取得した。
lockが固定したfflate 0.8.3/iobuffer 6.0.1も[検証記録](validation/2026-11-01-png-export.json)へ
SRI/版/SPDXを記録。fast-png/fflate/iobufferはMIT、crc-32はApache-2.0。
実LICENSEファイルの存在と識別を確認したが、全推移依存の本文・NOTICE・本番同梱監査はE01/F07へ残す。
本番依存への採用・lock固定ではなく候補評価。旧png-chunks2候補は採用しない。

## PDF export実配布候補の固定（2026-11-01）

private評価環境でpdf-lib 1.17.1を固定しscripts無効で取得。
[推移依存とSRI](validation/2026-11-01-paper-pdf-export.json)を記録した。
PNG/CRC/PDFの候補lockは本番E01 lockfileとは別で、NOTICE/全依存LICENSEと
最終bundle同梱の監査はE01/F07へ残す。実用紙Lでの確認を採用全体の完了へ広げない。

## D09 静的配信の接続準備（2026-11-01、未公開）

モデル採否/実origin/最終runtimeが未確定のため、D09全体の確定ではない。手動機能の先行本体統合と同じ例外範囲で、現在の静的配布境界だけを実装する。Cloudflareの既存Pages機構を使い、新しいPython/Functions/proxy/cache serverを追加しない。

| 配布対象 | 現在の扱い | 未確定・受入条件 |
|---|---|---|
| アプリ | repo root `web`、`SKIP_DEPENDENCY_INSTALL=1`、build command `npm ci --ignore-scripts && npm run build`、出力`dist`。`.node-version`でNode 24.8.0を指定 | Cloudflare上での版選択・実buildログ・公開originは未確認 |
| HTML/ロゴ/作例/NOTICE | Pages既定の再検証を維持。作例は許諾済み合成写真のみ | CDN実response/版切替時の表示を確認 |
| JS/CSS/Worker/PDF chunk | Viteのhash名付き`/assets/*`のみ1年immutable | 開いた旧tabの遅延import/Worker起動と新版切替は別の受入。Pages更新をセッションのatomic更新と扱わない |
| 大モデル | Pages distへ含めない。R2上の採用済みimmutable revision/hash URLと固定manifestを使う計画 | A11/D05後に実object/bytes/SHA/ライセンス/CORSを照合。候補manifestを本番化しない |
| 写真/出力 | File/Blob/Worker内だけで処理。R2へ送信するAPI/credentialを作らない | F06で実通信を観測し、非送信を検証 |

`public/_headers`をViteがdistへcopyする。CSPはdefault none、script/Worker/connect self、img self/Blob、object/base/form/frame禁止。Reactのstyle属性とreact-easy-crop6.2.4の標準style注入があるためstyle inlineだけ許可。scriptのunsafe-inline/unsafe-evalやWASM権限を先に許可しない。現在は外部font/analytics/CDN runtimeを使わない。モデル接続時はR2 origin、ORTのWASM compilation/worker経路を実artifactから決め直す。COOP/COEPは現状不要として送らず、threaded WASM等を採用した時に全resource/CORP/CORSと一緒に検証する。WebGPUだけを理由に必須としない。

Pagesの_headersは静的responseに適用され、Vite dev/previewには適用されない。現物HTTPとブラウザのCSP受入は未実施。R2のresponseはPages_headersでは制御できない。R2はGET/HEAD、採用アプリと検証originを許可するCORSを別途設定し、必要なContent-Length/ETag等の公開headerをloader契約に合わせる。Origin付きGET/HEAD/必要時preflightを実objectで検査する。認証cookieやS3 keyをクライアントへ渡さず、ETagをSHA256の代用にしない。未採用preview全体へのwildcard許可は設定していない。

build末尾の`check-dist.mjs`は画像やモデルを展開せずstatで25MiB/20,000件制限を確認し、symlink、隠しファイル、既知のモデル/秘密形式、Python/source map混入、必須LICENSE/NOTICE欠落を拒否。build-info.jsonも必須とし、固定schema・版・SHA形式以外のフィールドを拒否する。これは任意のファイル内容から秘密/重みを完全検出するものではない。model重みの拡張子変更や分割で検査を迂回しない。node標準APIだけを使い、新しい配布SDK/CLI依存は追加しない。

更新前はソースrevision、lockfile、distのSHA/サイズ一覧、採用manifest、旧production deployment IDを一組で記録する。Pagesのrollback対象は成功したproduction deploymentでありpreviewではない。R2の旧object/manifestは旧版が必要とする間保持し、上書き/即削除しない。失敗時は前のproductionへ戻し、対応する旧manifest/objectが取得できることを確認する。現在はproduction IDも実公開もなく、手順の通し受入はF07/F08へ残す。編集中tabを強制reloadしない。Service Worker/完全offlineは未導入で、HTTP cacheやモデルcacheだけをoffline保証と表示しない（D11未確定）。

一次資料（2026-11-01確認）:
- https://developers.cloudflare.com/pages/configuration/headers/
- https://developers.cloudflare.com/pages/configuration/serving-pages/
- https://developers.cloudflare.com/pages/platform/limits/
- https://developers.cloudflare.com/r2/buckets/cors/
- https://developers.cloudflare.com/pages/configuration/rollbacks/

## D11 オフライン・再読込・更新時の扱い（2026-11-01、部分確定）

手動本体の先行範囲として、Service Workerは現在導入しない。アプリを完全offline対応とは表示せず、独自app cache/更新通知engineも追加しない。背景モデル配布とcache採用はD05/A11未完なので、D11全体の設計完了とはしない。

| 状況/資源 | 現在の規則 | 未受入・将来条件 |
|---|---|---|
| 初回/再読込のHTML・JS・CSS | PagesとブラウザHTTP cacheを利用。未取得/eviction/要再検証なら接続が必要。強制offline起動を保証しない | 本番originでcold/warm/更新・通信断をF06/F07で確認 |
| 写真/設定/alpha/保存準備 | メモリのみ。hash工程移動は保持、reload/pagehideで消失/清掃。永続DBへ自動保存しない | native離脱通知とBFCache/保存の実動作は未受入 |
| 作成済みPNG/PDF | 同じ設定のBlob URLを明示保存できる導線を保持。形式切替で他方を破棄しない。OS保存完了は断定しない | native download/URL猶予/離脱を確認 |
| 新規書出Worker | 同一versionのhash付きWorker assetが必要。構築/実行失敗は編集保持・明示再試行 | 旧tabから新deploymentへの切替時のasset残存/404/rollbackを確認 |
| PDF追加module | PDF明示作成時だけ標準dynamic import。header/API確認後、pixel decode/用紙確保前に読み込む。失敗は固定pdf-module-unavailableで接続確認/再試行/作成済みPNG切替を案内 | 実HTTP/CSP/eviction/旧chunk404を確認。PNG経路はPDF moduleを要求しない |
| モデルcache | アプリcacheと独立。固定manifest/runtime/必要file/SHAの一致が必要で、raw bytesの存在だけを利用可としない | 背景本体・native cache/容量/破損/削除/版競合の採用後にoffline可能範囲を確定 |

接続断、CSP、404、module評価の失敗をnavigator.onLineだけで決めない。onLineを機能停止の根拠にせず、実際のmodule取得/評価失敗の境界で固定codeを返す。自動retryやreloadをせず、同じ入力/設定から明示retryする。更新を理由に編集中tabを強制reloadしない。ユーザーがreloadを選ぶ前に、必要な準備済みファイルの明示保存と写真消失の説明を維持する。

PDF読込失敗はI/O mockで検証し、成功のPNGを保持する。実browserのoffline検証やHTTP cacheの保証へ広げない。将来SWを採用する場合も、既存library/標準機構とversion対応・旧model保持・更新同意・rollback・写真非永続化を比較し、独自cache engineを先に作らない。

一次資料: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import / https://developer.mozilla.org/en-US/docs/Web/API/Navigator/onLine 。

## 固定モデルの文書と現在のnpm同梱確認（2026-11-01）

[model-notices/sources.json](model-notices/sources.json)へ固定モデルカードのrevision/SHAと公開file一覧、公式コードLICENSEの固定commit/URL/SHAを保存した。両固定モデルrepoのrootに独立したLICENSE/NOTICEはなく、重みの条件はモデルカードの宣言に基づく。コードLICENSEを重みへ自動適用しない。BiRefNetコードとHR重みの宣言はMIT、ViTMatte公式コードはMITだが、このHF重みはApache-2.0。Apache本文と各公式コード本文をmodel-noticesへ保存した。これは候補文書で、web/publicやR2へ重み・候補NOTICEを公開したものではない。

現行npm buildの文書生成はLICENSEに加え、package rootのNOTICE/ThirdPartyNoticeText/CopyrightNotice等も保持する。実際の16 production依存の見出し、tslib CopyrightNoticeの全文、アプリMITの完全copy、保存文書のSHAを検査した。型検査/build/dist guard pass（10 files/3,205,774 bytes）。アプリlogic変更なしのため前回100件passからVitestを再実行しない。証拠は[validation/2026-11-01-model-license-documents.json](validation/2026-11-01-model-license-documents.json)。

export/rewrite済みgraphと転用source、採用するTransformers.js/ORT/processor/WASMの最終文書、変更記録とR2実releaseへの同梱は未監査。candidate manifestのartifact_notices_audited=falseと配布blockerを維持する。API/file一覧の確認で最終artifactの権利・配布条件を認定しない。GPU/model/browser/WASM起動・重み取得・公開なし。

## ビルド元の識別と診断情報の照合（2026-11-01）

package版だけでは、同じ0.1.0で異なるソースを区別できなかった。既存ViteのdefineとgenerateBundle/emitFile、Node標準crypto/fsで、同一のソース識別情報をアプリとdist/build-info.jsonへ埋め込む。追加依存・取得要求・Git/環境変数収集はない。診断schemaVersion=2のbuildIdがbuild-info.jsonのsourceIdと一致する。IDはアプリ側の値であり、利用者/端末ごとの識別子ではない。

SHA256の対象はweb/src・web/public・web/scripts・tools/browser-library-adapterの通常fileと、web/index.html・package.json・package-lock.json・tsconfig.json・vite.config.ts・.node-version・.npmrc・.github/workflows/web-check.yaml・repo LICENSE。相対path/byte長/内容を固定順でhashし、絶対path/mtime/hostname/時刻/環境変数/写真選択内容はpayloadへ入れない。個人写真やhome/Git全体をscanしない。source IDはこの集合の識別子であり、未import評価adapterも集合に含む。生成時に同じ集合を再確認し、build中に変わっていれば失敗させる。public/build-info.jsonによる古い値の上書きとsymlink入力も拒否する。

同じソース集合は同じIDであり、これはfinal distのhash、署名、再現build保証、toolchain/実行環境証明、Pages deployment IDではない。公開時は引き続きsource revision/lockfile/dist全file SHA/採用model manifest/production deployment IDを組で記録する。Vite dev serverでは起動時点のsnapshotなので、HMR後のrelease証拠には使わない。実配布buildは生成直前の再照合を通す。診断画面は同梱値を使うだけで、build-info.jsonを通信取得しない。

検証はnpm run test（15 files/105件）、npm run test:scripts（6件）、型検査/build/dist guard pass（11 files/3,206,404 bytes）。実distのsourceId再計算・main chunk内の同値・placeholder消失・絶対workspace path/Node crypto helper非混入を照合した。小fixtureでcheckout場所/mtime不変、ソース/lock/adapter/notice変更で変化、対象外fileの非影響を確認。証拠: validation/2026-11-01-web-build-identity.json。native通信/privacy/保存、実Pages/CDN/CSP/版切替・rollbackは未受入。

再利用根拠: https://vite.dev/config/shared-options.html#define / https://vite.dev/guide/api-plugin.html 。標準の定数埋込とasset出力に、固定集合のhashだけを接続し、汎用build/cache engineや追加metadata収集libraryは導入しない。

## Pages向けNode指定とWeb専用CIの準備（2026-11-01、未公開）

web/.node-versionへ既検証Node24.8.0を指定し、web/.npmrcでinstall lifecycleを無効にした。Pagesの自動依存installはSKIP_DEPENDENCY_INSTALL=1とし、明示的なnpm ci --ignore-scripts && npm run buildをbuild commandに指定する案をweb/READMEへ整理。root=web、output=dist、framework=None。Production/Preview両方の変数とDashboard側の競合するNode指定を実プロジェクトで確認する必要がある。Nodeが利用者のブラウザ実行依存になるわけではない。Wrangler/Functions/Python/新配布SDKは追加していない。

.github/workflows/web-check.yamlはWeb関連PR/mainと手動実行に対し、同じNode fileでlocked install→Node script test→Vitest→static buildを逐次実行する定義。contents:read/persist-credentials:false/package-manager-cache:false、checkout/setup-nodeは取得したv7のcommit SHAへ固定。既存コンテナrelease workflowは変更しない。デプロイやモデル取得はなく、現時点でcommit/push/remote実行もしていない。

共有adapterとLICENSEに加え、Node/npm設定とWeb workflowもsource IDに含めたため、Pagesのwatch pathsはweb/**・tools/browser-library-adapter/**・LICENSE・.github/workflows/web-check.yamlを含める。repo全体をcheckoutし、webだけを切り出す構成にしない。CI definitionを追加したこととGitHub runner/Pages build成功は区別する。

YAMLをPyYAMLでparseしevent/権限/SHA/input/command構造を確認、npmの実効ignore-scripts=trueを確認。ローカル105件・Node script6件・型検査/build/dist guard pass（11files/3,206,404 bytes）。fresh runner install、GitHub上のCIと実Cloudflare上のtool版/headers/公開・rollbackは未受入。証拠: validation/2026-11-01-web-pages-ci-preparation.json。設定案はweb/READMEを参照。

一次資料: https://developers.cloudflare.com/pages/configuration/build-image/ / https://developers.cloudflare.com/pages/configuration/monorepos/ / https://github.com/actions/setup-node/blob/main/README.md 。公開・アップロードは行っていない。


## checkpoint1 ORT runtimeのoffline配置準備（2026-11-01）

取得済みnpm onnxruntime-web1.31.1 packageにはroot LICENSE/ThirdPartyNoticesが含まれていなかったため、公式v1.31.1 tagのLICENSEとThirdPartyNotices.txt全文をruntime-noticesへ取得し、sources.jsonへURL/bytes/SHAを記録。WebAssemblyに実際に組み込まれた個別third-partyの適用範囲まで審査済みとはしない。

既存Node標準fs/cryptoだけを使うtools/stage_browser_runtime.mjsで、固定candidateの2fileをstream hash照合して新規private outputへ配置。MJSはpages overlay、29.5MB WASMはr2、双方version/SHAを含むimmutable key。コピー後もSHA照合し、noticeを添付、最終manifestには未設定originと必要pathを記録。公開API/credential/upload/モデル/ブラウザ/WASM実行は行わない。改変/版違い/既存output拒否の3testだけpass。証拠: validation/2026-11-01-runtime-offline-staging.json。

source: https://raw.githubusercontent.com/microsoft/onnxruntime/v1.31.1/LICENSE と https://raw.githubusercontent.com/microsoft/onnxruntime/v1.31.1/ThirdPartyNotices.txt 。実origin/CORS/CSP/asset配信の通し確認と個別license適用審査、実モデル受入は未完。pages overlayだけを完成appやdeploy済みと扱わない。


## 2026-11-02 MODNetと現行Web配布物の権利表示照合

MODNetの候補文書を既存model-noticesへ追加した。Xenova/modnet固定revision fa2fa546052fba4c08921230a26cc69a333fca12のモデルカードはApache-2.0を宣言し、参照するZHKKKe/MODNetの28165a451e4610c9d77cfdf925a94610bb2810fb READMEはcode/models/demos（doc/gifを除く）へのApache-2.0適用を明記している。LICENSE全文、声明を含むREADME、ONNXモデルカードを保存し、URL/版/byte/SHAをmodel-notices/sources.jsonへ追加した。固定ONNX revisionのrootには独立LICENSE/NOTICEはない。元checkpointと変換tensor/変更履歴の対応、実際に採用するprocessor/runtime/foreground一式の配布auditは未完で、この記録を採用/再配布完了の判定にはしない。

既存npm11.6.0の標準SBOMを、公式npm-sbom説明に従ってomit=dev/lock-only/installed/include-peer条件で試したが、この環境ではreact/react-dom/schedulerがcomponentsから欠けた。実package.json/lockfileとnpm lsでは3件ともproduction依存として存在するため、SBOM出力だけをinventoryの正本にしない。新SBOM依存や独自の依存解決engineは追加しない。

既採用npm ls --omit=dev --parseable --allの実installed graph16packageと、既存notices.mjsによるLICENSE/NOTICE全文生成を照合した。全16の名称/版headingを確認し、pako追加Adler-32 noticeも存在。再生成したpublic権利表示は元byteと一致、distのLICENSE/THIRD_PARTY_NOTICESもpublic/root MITとSHA一致。これは現行手動Web版の依存範囲の照合で、private ML/ORT/Pillow/PyMatting/OpenCVの全バイナリ配布auditとは分ける。アプリ/モデル配布設定、モデル取得、browser/GPU/推論、commit/push/deployは行っていない。

証拠: validation/2026-11-02-production-notice-audit.json と validation/2026-11-02-modnet-license-evidence.json。
一次資料: https://github.com/ZHKKKe/MODNet/blob/28165a451e4610c9d77cfdf925a94610bb2810fb/README.md#license 、https://huggingface.co/Xenova/modnet/blob/fa2fa546052fba4c08921230a26cc69a333fca12/README.md 、https://docs.npmjs.com/cli/v11/commands/npm-sbom/ 。


## 静的配布物の固定一覧（2026-11-02、公開操作未実施）

既存checkDistとNode fs/cryptoを再利用するweb/scripts/release-inventory.mjsを追加。新deploy SDKやupload engineなし。通常buildの全file相対path/byte/SHA、build-infoのsourceId、一覧内容のartifactIdをdist外の新規JSONへ保存し、verifyで全内容を再照合する。host path/時刻をidentityへ含めず、既存JSON上書き/配布内出力（symlink parent含む）/private marker/未許可fileを拒否する。

sourceIdとartifactIdは別物。後者は署名/環境証明/原子的snapshot/Pages deployment IDではない。旧dist+一覧の保管と復帰前verifyに利用し、R2の固定manifest/runtime、実deployment ID、retention/復帰条件とlive確認は別途必要。現時点の実11file/3,233,946byteでcreate→verify成功、同長改変/追加/欠落/メタデータ変更の拒否を含むscript10test/typecheck/build pass。CLIはweb/READMEを参照。証拠: validation/2026-11-02-static-release-inventory.json。


## 2026-11-02 静的配布境界の補強

[Pages公式advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/)では出力rootの_worker.jsが全HTTP要求を扱うサーバー処理になる。check-distはファイル/ディレクトリ形式の_worker.js、_routes.json、functionsを出力rootで拒否する。ブラウザ用assets内Workerは対象外。標準Node fsによる既存検査へ追加し、新しいSDK/サーバー依存なし。script11testと既存dist検査pass。これはdist外のsource-root functionsやPages project設定まで検査しないので、公開時はその不在も確認する。実配信/非送信の全面監査は未完。証拠: validation/2026-11-02-static-server-boundary.json。


## 2026-11-02 private候補文書の同梱

private local app builderは既存model-notices/sources.json（candidate_documents_only_not_a_distribution_approval）を読み、記載10文書のSHA/宣言bytes/通常fileを検証してvalidation-notices/model-candidatesへcopyする。indexもbyte同一で保持。現行195mountで全対応SHA/bytes一致、重みread0、公開用check-distはprivate markerで拒否。未使用候補の文書も含む一覧で、全候補の採用や配布許諾を表明しない。公開用releaseへの選別/モデル変換履歴/全processor・runtime・WASM notice監査は引き続き必要。証拠: validation/2026-11-02-private-model-notice-packaging.json。


## 2026-11-02 モデルWorkerのlibrary本文

runtime-notices/library-sources.jsonへ固定Transformers.js4.3.2 source commitとApache本文、hash-wasm4.12.0 package MIT本文、同固定sourceのSHA256 C先頭にある別の著作権/許諾全文を保存した。build_browser_model_prepareは使用JSのSHAと文書bytes/SHAを検証しWorkerへcopy、reportへ出典を記録する。現行private appは3文書のmount SHA/bytes一致。旧実行Workerとはbundle SHAが異なるため推論受入は再検証が必要。Transformers内包依存、WASM toolchain/processor全体監査は未完。証拠: validation/2026-11-02-model-worker-library-notices.json。


## 2026-11-02 Transformers内包依存の文書

固定web bundleのsource commentでtokenizers0.2.0/jinja0.5.10を識別し、npm各版tarballのSHA512 SRI照合後、package/LICENSE全文を取得。install/script実行なし。runtime-notices/library-sourcesへarchive URL/SRI/文書SHA/bytesを追加し、親子builderの既存検査で各5文書を同梱。本体mountの実SHA/bytes一致と追加前後の親子実行code全byte一致を確認。source commentは完全な変換後code対応の証明ではなく、全binary/toolchain/processor監査と公開採用は未完。証拠: validation/2026-11-02-bundled-transformers-dependency-notices.json。


## 2026-11-02 A10のR2容量・費用試算

[公式Standard料金](https://developers.cloudflare.com/r2/pricing/)（更新2026-10-30）と現在のmanifestから算出。取得回数は写真枚数ではなく、新規端末・cache削除/eviction・新model版などによる資源取得回数。無料枠は同accountの他利用がない仮定で、実請求や公開承認ではない。

| 候補 | model資源数 / bytes | runtime WASMを1回取得する場合の合計 |
|---|---|---|
| HR＋ViTMatte | 140 / 1,267,265,814 | 1,296,013,552byte（約1.30GB） |
| Lite512 | 2 / 180,839,576 | 209,587,314byte |
| MODNet | 2 / 25,888,723 | 54,636,461byte |

既存base HRのprivate記録にはWASM要求46回がある。HR46stage＋Matte1sessionでHTTP cacheが効かず47回取得する仮定では、1回の取得量は2,618,409,500byte/187 GETとなる。この47回は補正通し実測ではなく計画scenario。private interceptionと本番HTTP/CDN cacheの挙動を混同しない。model cache warmでもruntime/appまで通信0とは保証しない。[R2 custom domainとcache設定](https://developers.cloudflare.com/r2/buckets/public-buckets/)の実受入を残す。

月1,000/10,000回の新規取得は、HR＋補正で約1.30〜2.62TB / 12.96〜26.18TB。GETは最大187万で、上記無料枠仮定ではR2 read料金0。10万回なら1,410万〜1,870万GETで、無料分控除後の百万単位切上げ込み約$1.80〜$3.24。転送量だけの課金は0だが、税・他サービス・classA/再試行/HEAD等を含めない。

全く異なるHR model版を1/2/5/10個、共通runtime1個を丸1月保持する仮定のstorageは約1.30/2.56/6.37/12.70GB-month。無料枠が残っていれば最初の5版は0、10版は正味3GB-month切上げで$0.045の計算。実際の単位/日次peak平均/共有資源・account利用/最終invoiceを確認する。全条件・bytes・四段階の取得回数scenarioはvalidation/2026-11-02-r2-capacity-and-cost-estimate.json。


## 2026-11-02 runtime HTTP cacheの明示検証モード

既存loopback PoC serverは既定no-storeを維持。--local-appと--cache-runtimeを明示した場合だけ、/runtime/ort/version/64桁SHA/file.wasm・mjsへ1年immutableを付ける。manifestのSHA/URL内SHA/実file SHAを開始前に照合し、model/input/HTML/configやquery付き要求はno-store。GET allowlist/CSP/loopback境界は維持する。通常HTTP cacheの条件を検証する設定で、独自loader/Service Worker/cache engineは増やさない。

stdlib3testと小さな非実行fixtureの実Linux HTTP応答でheader/不一致拒否/POST501/traversal404を確認。web-checkに限定suiteを接続したがremote CI未実行。ブラウザcache hit/Windows/CDN/CORS/モデル実行/性能の証拠ではない。ORT公式wasmBinary APIは固定sourceで確認したが、追加byte管理は通常HTTP経路の計測後に判断する。証拠: validation/2026-11-02-runtime-http-cache-experiment.json。


## 2026-11-02 routed observerはHTTP cache性能測定の対象外

[Playwright公式page.route仕様](https://playwright.dev/docs/api/class-page#page-route)ではrouting有効化でHTTP cacheが無効になる。共通observerはGET/origin/path拒否のためrouteを使うので、継続要求にも通常cacheを期待しない。reportへhttpCacheObservation.eligible=false/reasonを明示。--cache-runtimeはserver headerを確認する設定で、このobserverをcache benchmarkに変えるものではない。

46回のWASM要求や約119秒の既存値は診断transport条件下の記録として維持し、本番cold/warm性能やcache不具合の証明へ広げない。model CacheStorage warmとも区別する。別のno-routing/通常HTTP観測でexact CSP/server allowlistと合成入力を保ちつつ確認が必要。observer24testでreport値を確認、native実行なし。証拠: validation/2026-11-02-routed-http-cache-limitation.json。


### 2026-11-02: Worker/runtime権利資料をprivateフッターの既存リンクへ統合

private組立で、実mount済みruntime/validation-workers/validation-assets配下の既存LICENSE/NOTICE/LEGAL/ThirdPartyNotices textだけを選び、読込時にbytes/SHAを再照合してapp/THIRD_PARTY_NOTICES.txtへ追記する。公開manual版の資料を先頭にそのまま保持し、公開sourceのnotice自体は変更しない。同内容SHAは全文1回＋全route aliasへまとめる。既存Node fs/Buffer/cryptoと既存footer anchorを再利用、新dependency/cache/rendererなし。model資料は別リンクのまま。捕捉できた文書の集約であり、資料がないbinaryや変換物の条件を推定して「全権利確認済み」としない。

最新HR+Matte private assemblyは200mount/モデル資源1,267,265,814byte/重みread0で成功。26notice asset・distinct19文書を既存endpointへ収録し、独立Python照合で全原文bytes/出典route/SHA包含・手動資料prefix保持・配信mount bytes/SHA一致を確認。Transformers.js/hash-wasm本体とSHA C header/tokenizers/jinja、ORT LICENSE/ThirdPartyNotices、OpenCV/Emscripten/C++runtime等の既存資料を含む。集約486,113byte/SHA38cc979605b115f0b8c6864b462aea6020251979ffc430bf2895e10bc00783e8。Vite compile/組立/実出力照合の証拠であり、今回UI suiteや実browserを再実行したとはしない。native/model/GPU起動・deployなし。全binary/toolchain/model/processor/変換物のaudit・配布受入は未完。証拠: validation/2026-11-02-runtime-notices-footer-integration.json。


### 2026-11-02: 縦長crop修正版のsource/rebuild資料を更新

旧14,282byte artifactのreview packageを上書きせず、crop-release-review-02を新設。旧inventoryでSHA照合したPillow/xcc/MIT全文・upstream source archive・runtime patch・Pillow source12fileを保持し、現行host/build script/shim/数値adapter/helper/reference fixture10fileをsnapshot化した。snapshot側のbuild scriptから別source directory/別output名で再buildし、現在private本体の14,563byte/SHA4ac73b5af0432d878e2b946109d65a15a87c5185c5f4440415f091de814e773cと全byte一致を確認。バイナリへprivate home pathなし、host SHAもsnapshotとbuild receiptで一致。

追加npm/pip依存なしのverify-crop.mjsをpackage内に置き、元repo外/tmpから実行。snapshot内だけのadapter/referenceを使う4+160+8＝172caseで全RGB一致、最大観測WASM memory2,031,616byte。26file/2,961,900byteの相対名/実bytes/SHA inventoryを作り、全file再読込で照合。コピーしたapp MITは現repo LICENSEと一致、runtime patchは旧記録およびbuild receiptのdiff SHAと一致。既存Node/fs/cryptoと既存build/resize検証helperを再利用し、新compiler/画像kernel/配布サービスは追加しない。

これは既存検証済みcompiler binary/同じmanaged runtime forkでのlocal review。fresh compiler bootstrap、別host再現、managed remote fork/tag/published release、公開配信用のpath非露出recipeは未完。build receiptはprivate監査用の絶対pathを含む。新binaryの実Chrome/Worker/CSP/UI・最大shape/中止と全binary/toolchain権利確認も継続。低優先度1core、native browser/model/GPU起動・publish/deployなし。証拠: validation/2026-11-02-crop-tall-order-release-review.json。


### 2026-11-02: 現行public静的成果物の回帰チェックポイント

初回準備/モデル権利資料/diagnostic schema3/入力復旧等の累積変更後、nice19/1coreで全UI244test（26file）→全domain499test→配布script11test→Python header3test→型検査/Pages buildを直列実行し全pass。通常distは背景runtime未接続の手動crop/印刷版で、private model/crop WASM構成とは別。最新private executableや実機の受入へ自動拡大しない。

11file/3,248,876byteを新しいstatic-release-review-05/distへ保持し、既存release-inventory create/verifyを再利用。snapshotと現行web/distの両方が同じinventoryへ一致、createBuildInfoで再計算した現sourceIdもbuild metadataと一致した。artifactId=sha256:38db68e1d1aef36c4184fd4331ff29655dcf17f6d0823c6e2b6a45ba9bb45c55、sourceId=sha256:f4479ff6ddbaae4d0a50fdba7e9d73566315e3fc5d182bfc288c07652eac09b8。旧review02〜04を保持し、今回のinventoryはdeploy directory外へ置く。これらはhashであり署名/deployment IDではない。

新依存/commit/push/remote CI/browser/model/GPU起動・deployなし。全自動testとartifact整合のチェックポイントであり、HR+Matteの新構成通し、モデル一般画質/数値・性能/メモリ、最新crop/input Workerのnative受入、利用者/視線/読み上げ/物理印刷、通常配信/Pages-R2/live rollback/公開は未完。証拠: validation/2026-11-02-static-review-checkpoint.json。


### 2026-11-02: static Liteの固定出典文書をprivate footerへ同梱

前turnはGPU経路/38testのprogress。本turnは変換repo dc064531...と参照source旧revision7838f1c...のREADMEを実取得/SHA固定して既存model-notices/sources.jsonへ追加。変換cardはYAML/API MIT宣言あり。一方旧source cardはMIT badgeのみ、YAML/API licenseなし、両rootに独立LICENSE/NOTICEなしを確認し、現在main aa62のMIT宣言と混同しない。最初の一律YAML MIT assertがこの差を検出、文書取得を条件別に修正した。文書2個12,378byteを既存builderでfooterのmodel notice endpointへ全文同梱し、保存SHA/合本文への包含をreadback確認（計12文書）。private static-lite-gpu-main-03は02のWorker/モデル設定を維持し文書のみ更新、weightFilesRead0/server/browser/GPU/推論0。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-model-documents.json。これは候補出典表示で元重み/変換物の全権利承認ではない。公開manifest/deploy未変更、実数値/速度/資源/品質/中止とHR+Matte/UX/Pages-R2等の元scope継続。


### 2026-11-02: 検証用artifactのPages誤配布境界を補強

前turnは実Worker未読込起動/拒否のprogress。本turnは公開_headersが現状model未提供のself-only方針であることを確認、未確定R2 originやWASM CSPを推測で追加しない。check-distは従来LOCAL_VALIDATION_ONLY.jsonだけで判定していたため、marker欠落時にもroot local-validation.html/validation-workers/validation-noticesを拒否するguardを追加。既存script testへ混入/除去後復旧ケースを追加し12/12pass。実static-lite-gpu-main03/appをprivate別directoryへcopyしてmarkerだけ除去、同じguardが拒否することを確認し元artifact保持。初回編集はcwd相対path誤りで未適用だったためlog01を新変更の証拠にせず、修正後log02を使用。型検査/notices/Vite/配布check pass、公開dist11file/3,251,014byte。低優先度1core、deploy/実browser/GPU/model実行0。証拠: image-studio/docs/browser/validation/2026-11-02-private-deployment-boundary.json。R2/実CSP/CORS/版更新/rollback等の配信受入と元scope継続。


### 2026-11-02: CIの公開dist/一覧保持を接続

前turnは整数制御値分類のprogress。browser CIがbuild止まりでartifact保持未接続だったため、既存release-inventoryのcreate/verifyでreview copyと元distの両方を照合するstepを追加。GitHub公式APIでupload-artifact最新v7.0.2（2026-10-07公開）をcommit cf430e030ddbb5b0abf93d22962f4752f3646cd9へ解決し、固定action.yml SHA/Node24入口とinputを確認。独自upload実装やwranglerを追加せず、公式actionで公開dist＋inventoryのみ14日保持、filesなしerror、contents read維持。workflow YAML構文を既存PyYAMLでparse。READMEの古い診断schema2を4へ訂正し保持期限と未remote受入を明記。

型検査/build/dist guard pass（11file/3,252,160byte）、localで同じcopy/create/両verifyを実施し現sourceId一致。artifactId d345822f.../sourceId20686181...をci-release-review-local-01へ固定、旧checkpoint06保持。GitHub上のjob起動/権限/アーカイブ取得は未実行、push/commit/upload/deployなし。証拠: image-studio/docs/browser/validation/2026-11-02-ci-static-review-retention.json。14日CI保存は公開版長期保管/live rollbackの代用ではない。低優先度1core、browser/model/GPU0、元scope維持。


### 2026-11-02: model文書の既存SHA検査をCIと共有

前turnはCI review artifact保持のprogress。既存app assembler内のmodel-notices検査をNode built-inだけのcheck_browser_model_notices.mjsへ抽出し、assembler/CLI/CIが同じfilename/regular file/SHA/任意byte数/重複検査を使うよう統一。実12文書+index81,709byte一致を確認。改変/byte数/重複名/path逸脱/symlink/directoryの拒否と原文保持の3test pass、標準domain scriptへ接続。最初のnegative試験で先行改変を戻さないと後続条件を独立検証できない点を修正し、log02で個別error確認。CIのPR/push pathへmodel-noticesと両private builder/helperを追加、モデル文書CLIとbuilder syntaxをstepへ接続、PyYAMLでevent/構文確認。private main06実assembly46mount/weightFilesRead0、型検査/build/dist guard pass（11file/3,252,160byte）。新依存/二重validator/モデル取得なし。証拠: image-studio/docs/browser/validation/2026-11-02-model-documents-ci-coverage.json。remote CI/全binary権利/実機等の元scopeは未完、push/commit/upload/deploy/browser/model/GPU0。


### 2026-11-02: static Lite重み/変換sourceの権利資料対応を連結

前turnは6領域の受入gap照合のprogress。本turnは変換script8,728byte/SHA505d0236...を固定URLからdataとして再取得し、AST/docstring/import/commentのみ確認、remote source実行0。scriptに独立したcopyright/license headerはなく、docstringが元BiRefNet_liteをMITと記す。torch/torchvision/transformers/ONNX/ORT/onnxslim等のimportを確認するが、配布者の正確な変換環境版は未取得。これらをbrowserのPython実行依存と扱わない。

既存model-notices/sources.jsonのmodels欄へstatic ONNXの実SHA/容量、元checkpoint実SHA/固定revision/card file、変換scriptURL/SHAを連結。card文書だけの一覧から配布物との対応を追えるようにし、変換sourceを再配布する場合の権利表示確認/全binary audit/実受入は残した。既存共有validatorで12文書+index83,398byte一致、model取得/変換/推論なし。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-conversion-provenance.json。実行時期未回答、全元scopeと未受入gate維持。

### 2026-11-02: 前景色WASMのsource snapshotを元repo参照なしで再build

旧review-packageはbuild scriptがrepo内validation metadata/C sourceを参照し、単独のsource snapshotではなかった。旧資料を保持しforeground-source-review-02へ必要な相対tree、参照compiler metadata、RGBA/runtime adapter、app/PyMatting/xcc/rembg表示、runtime patchと既存upstream source tarを14fileとして固定した。snapshot内scriptから既存固定compiler/変更runtime forkを指定し、4,032byte/SHA569504ce...の現private選択WASMと全byte一致。全snapshot SHA、patch SHA、compiler SHAを別確認。WASMにprivate home pathなし。build receiptはprivate絶対pathを含むため公開しない。

外部prerequisiteのcompiler binaryとlocal未commit forkは残り、fresh bootstrap・別host・remote fork/tag/release・全適用権利確認の完了ではない。source snapshotはML全体やprocessor一式のsource releaseでもない。証拠: validation/2026-11-02-foreground-source-snapshot-rebuild.json。

### 2026-11-02: upstream sourceからcompilerを再生成

foreground-source-review-02の固定upstream tarを新directoryへ展開（wcc/objなし）し、変更なしMakefileのWCC_OBJSとlink commandでcompiler本体のみ再生成。履歴と同じOPTIMIZE=-O0により既存固定compiler SHAa8b3efdf...と全byte一致し、そのfresh compilerからsnapshot sourceの前景色WASMもSHA569504ce...へ全byte一致。既存compiler binaryのcopyは使っていない。

初回既定-O2 -g3は別compiler SHAとなり、make wcc末尾のoptional libraryでllvm-ar不在のexit2。これを成功扱いせず保持。compiler本体のobject target/linkだけを使う次試行で成功した。same-host/system GCCでのsource bootstrapであり、別host/self-hosting/完全toolchain trust/remote fork releaseではない。local runtime forkも引続き外部前提。証拠: validation/2026-11-02-fresh-xcc-foreground-rebuild.json。

2026-11-02追検証: fresh source compilerをcrop-release-review-02のsnapshot側build scriptへ指定し、crop export/bounded growthで14,563byte/SHA4ac73b5a...へ全byte一致。既存package全inventory fileのbytes/SHAとruntime patch SHAも再照合。前景色とcropの両方で既存compiler binaryコピーを使わないsame-host再生成が成立。新しい数値/実browser/最大shape/別host/権利公開受入を意味しない。証拠: validation/2026-11-02-fresh-xcc-crop-rebuild.json。

2026-11-02追記: runtime patchを独立local forkのcommitbf65717a5db5dfe51a94ddc17d2a44077bccd89dへ固定。build guardを固定base ancestry/厳密base差分/既存runtime SHAの組合せへ変え、clean commitから前景色/cropを全byte一致で生成。receiptでHEAD/base/patch SHAを束縛。旧dirty形式も互換確認し元forkを保持。remote fork/tag/releaseは未実施、local commitだけで公開管理完了とはしない。証拠: validation/2026-11-02-committed-runtime-fork-builds.json。

### 2026-11-02: 移動可能なprocessor source候補

processor-source-review-01へ33fileの相対tree/metadata/4表示/2WASM/recipe/remote除去済みbare runtime repository tarを固定し、0600 tar.gzを作成。元forkがshallowのためGit bundle単体cloneはmissing ancestorで失敗し不採用。標準bare repository tarならshallow boundaryを保持して別directoryへclone成功、固定baseをarchiveしてcompilerを新生成し、snapshot buildから前景色/crop両WASM全byte一致。元compiler binary/元runtime worktree参照なし、全33file SHAと未宣言fileなしを再確認。

same-host/system GCCの非公開候補であり、別host/managed remote release/全ML source/全適用権利承認や公開uploadの準備完了とはしない。private開発metadataを含む。証拠: validation/2026-11-02-portable-processor-source-candidate.json。

2026-11-02: opencv-source-review-02へ固定source archive/既存selected script/表示/driverをまとめ、既存separate rebuild成功をrecipeに反映。Git標準export-ignoreと明示CRLF変換を考慮し全archive blobを元commitへ照合。source archive単独ではdriverのGit checkout guardを満たさず、SDK/bootstrap/全権利/公開releaseは残る。証拠: validation/2026-11-02-opencv-source-candidate-linkage.json。

2026-11-02: 選択parent/model Workerとmax4 stage Worker双方の実bundleをsource mapへ束縛し、tokenizers/jinja/Transformers/hash-wasm/ORTの残存sourceを固定表示へ対応付けた。review buildも実行JSは既存選択SHA一致、private map/metafileは配信mount対象外。mappingによるsource attributionは全copyright/embedded WASM/processor適用性/公開許諾の完了ではない。証拠: validation/2026-11-02-selected-stage-worker-source-attribution.json。

2026-11-02: 実worker integrationのNOTICEを新規同梱。Transformers既定dev ORT→固定1.31.1へのalias置換、生成bundling/minification/application adapterを区別して記録。parent/stage個別mountと本体aggregateへ接続（同文1回）。現private208mount/1,309,157,328byteを全stream SHA/別verifyで固定し、実行Worker/model/runtimeの変更なしを照合。新UI候補のnativeHR受入、全model/processor/compiler許諾/source release、公開immutable配信は残る。証拠: validation/2026-11-02-worker-integration-change-record.json。

### 2026-11-02: foreground WASMへlinkしたsourceの照合

選択SHA569504ce...の再生成receiptとsourceを照合し、C移植wrapper＋xcc runtime6fileの7object、-nostdlib/外部archiveなしを確認。WASM moduleのimportはMath7関数＋application memory hookのみの8件で未知importなし。PyMatting/rembg/xccの3全文は選択NOTICE内へ完全一致し、xcc原source LICENSEも固定copyと一致。malloc sourceがKernighan/Ritchieのallocator algorithm/book節を参照する事実は保存sourceに残す（独自のlicense推定には使わない）。部品単位のsource/object/import/表示対応の確認であり、product全体の許諾承認や公開source releaseではない。証拠: validation/2026-11-02-foreground-linked-source-notice-review.json。

### 2026-11-02: crop source対応と前処理helperの版区別

選択crop SHA4ac73b5a...はPillow固定6source/header、xcc runtime7file、application hostのSHAを再照合。9object/-nostdlib/外部archiveなし、実import4件（Math sin/cos、assert、memory hook）、Pillow MIT-CMU/xcc全文の本体aggregate収録を確認。

モデル前処理用legacy SHA5c529458...はhost SHA9e4659e9...で、現在source archiveのhost9880e3ec...と異なる。このcrop資料だけでlegacy helperの厳密source来歴を完了扱いにしない。保存済みcurrent source＋復元compiler/runtimeからbilinear候補14,563byte/SHA9e20f461...を生成し、2既存合成人物→2048²のRGB各12,582,912byteがlegacyと全byte一致。新候補はまだapp採用せず、独立matrix/Worker/app受入を残す。証拠: validation/2026-11-02-pillow-linked-source-and-bilinear-candidate.json。

### 2026-11-02: 選択ORT binaryの公式package来歴を分離して確認

固定onnxruntime-web1.31.1のlive npm metadataと公開署名鍵を保存し、標準Node cryptoでname@version:integrityのECDSA署名2件を検証。保存tgzのSHA512 SRI/SHA1が署名対象metadataと一致し、選択asyncify mjs/WASMとWorker生成用webgpu bundle入力がarchive memberと全byte一致。npm archiveにLICENSE/ThirdPartyNotices文書は含まれないため、binaryと同梱された資料とは扱わない。既存sources.jsonのupstream v1.31.1タグ2文書を再取得して固定SHA、実mount、既存フッターaggregate全文収録と照合した。

Python標準tarfile/hashlib/urllibとNode cryptoを使い、新依存/独自署名形式/ビルドは追加しない。最初の一括照合はarchive内LICENSE.txt不存在で停止し、binary archiveと別取得文書の来歴を分けた検証へ訂正。公式配布binaryの来歴証拠であり、sourceからの再build、全linked dependencyの適用性、公開許諾完了の証拠ではない。鍵の信頼元はlive HTTPS npm registryで、独立鍵provenanceの検証ではない。証拠: validation/2026-11-02-ort-official-package-provenance.json。

### 2026-11-03: 復元ビルドで判明したsourceId入力漏れ

既存sourceId集合だけのsnapshot01を復元しnpm ci --ignore-scripts/型検査後、Viteがstyle.cssのimport先docs/browser/design-tokens.cssを見つけられず停止した。画面に使うCSSがsourceIdへ含まれていなかったため、既存createBuildInfoの明示入力へ追加し、同CSS変更でIDが変わる既存テストを拡張した。snapshot01のidentity一致は当時の集合についてのみ正しく、完全なbuild source packageの証明にはしない。snapshot02はCSS込み154file。新依存/署名方式/source走査範囲の無制限拡張は追加しない。

## 2026-11-03: 本体MIT方針の理由と現候補表示の照合

本体は利用者指定MITを維持する。少ない条件で利用・改変・再配布を認め、組込みや保守の入口を簡潔にする方針である。これはcopyleftによる改変公開を本体の条件にしない選択であり、第三者資産までMITへ変更する意味ではない。[MIT本文](https://opensource.org/license/mit)に従い著作権・許諾文を保持する。[Apache-2.0本文](https://www.apache.org/licenses/LICENSE-2.0)の対象にはlicense copy、改変告知、該当する帰属/NOTICE等の別条件があり、アプリMITの表示だけで置き換えない。商標・素材・モデルの出所も別に扱う。

root LICENSE/public LICENSEのbyte一致、package.jsonとlock rootのMIT一致、footerの本体/モデル条件分離を確認。main09でlicense/notice/copyright/検証モデル出典に該当するmountを実読し宣言サイズ/SHAへ照合した。対象と全hashは[確認記録](validation/2026-11-03-current-license-alignment.json)。同梱byte一致は、全条件充足や変換元重み一致・素材許諾を証明しない。最終G06では構成整理後の同一公開候補でsource release・各第三者条件・画像許諾・画面/metadata/配布資産を再確認する。候補文書の表示と採用/公開は分離し、条件が閉じない資産は公開対象へ含めない。

## 2026-11-03: export環境の実解決先とsystem依存

`onnx-env` は `include-system-site-packages = true`。標準 `importlib.metadata.distribution` による6主要依存の実解決版はhistorical HR exportの版と一致するが、torch/torchvisionはvenv外のpyenv 3.12.9 site-packagesから取得する。transformers等は別版もvisibleなため、既存environment.jsonの全列挙をそのままrequirements/lockへ変換しない。実解決先・候補版・METADATA/WHEEL/RECORD/INSTALLERのbyte/SHAとRequires-Distを[検証記録](validation/2026-11-03-export-environment-resolution.json)へ固定した。native module/重みはimport・実読していない。メタデータSHAはwheel本体の完全性証明ではなく、独立環境の復元にはsystem側を含む正確なwheel/native取得lockが残る。既存source archiveは当時の候補として保持し、今回の記録だけで全export再現・公開source releaseを完了にしない。

### 2026-11-03: 主要6依存の公式wheel候補を固定

前節の実解決版に対応する公式PyPI JSONを保存し、Python3.12/Linux x86_64の標準wheel tag優先順で各1件を選択。6件すべて公開wheelのPEP658 METADATAがinstalled METADATAと全byte一致した。取得URL/容量/SHA256とhash付きdirect candidate一覧を評価directoryへ固定した（[記録](validation/2026-11-03-export-direct-wheel-provenance.json)）。wheel本体は未取得で、digestは公式metadataの宣言値。インストール済みbinaryの同一性、推移依存/native libraryのlock、独立環境復元の証明にはしない。完全な環境lockとしてこの6件だけを利用しない。

### 2026-11-03: export推移依存のwheel lock候補

既存uvの公式pip compileを使い、6主要依存＋固定sourceが直接使うnumpy/Pillow/timm/kornia/einops/safetensorsの計12rootと実解決版constraintsから、Python3.12.9/Linux x86_64向け標準pylock.tomlを生成。推移依存66packageは全件installed版一致、主要6wheel SHAも前回候補と一致。68wheel候補のURL/hash形式と各packageの現host互換wheel存在を独立照合した。Pillow/protobufの複数候補は標準lockの仕様として保持。全候補容量約2.85GBだが本体取得・環境複製なし。[記録](validation/2026-11-03-export-transitive-wheel-lock-candidate.json)。wheel実体/native OS依存/別環境復元/動的optional import/全exportは未検証で、候補lockを再現成功と扱わない。

### 2026-11-03: 変換source候補の起動時helper欠落を修正

旧47file候補はHR exporterがexport-onlyでもimportするcompare_browser_alpha.pyを含まず、独立復元の実行入力として不足していた。旧候補を改変せず、全47fileをbyte保持した54file候補02へhelper/66package lock候補/補足READMEを同梱。現project toolの絶対importをASTで調べ、旧候補の欠落1件を再現→新候補0件、全archive memberの復元byte一致とPython12file構文を確認。復元helperの同alpha誤差0/float入力拒否も実確認。第三者・dynamic importや全exportの実行証明とはしない。[記録](validation/2026-11-03-model-transform-source-closure-fix.json)。


### 2026-11-03 CPU高画質と配信設定の境界

CPU3段Matteは元の学習済み重み/FP32/画像寸法を保持し、query8行分割と3段逐次sessionを用いる。HRは406段。明示WASM/最大2threadで、2000²・1601×2000・2000×1333のprivate Linux Chrome実PNG成功を記録。最新main04はbrowser再起動後に1100資源を再取得せず全CPU推論→PNGまで成功したが、一般画質/Windows/NVIDIA/実iOS/全shape/実写真の受入ではない。参考時間は取得・その他準備・最終foreground/保存を除く主要区間であり、全体時間の保証としない。

通常public `_headers`は背景準備中のmanual-only build向けにstrictなまま保持する。背景を公開するconfigured buildでは、承認済みR2 originをCSP connect-srcへ明示し、公式WASM実行のwasm-unsafe-evalとCPU2thread用COOP/COEPの必要性を固定browser/runtimeで検証する。R2は厳密なPages/Preview originのCORSとMIME/版固定を確認。ドメイン未確定のままwildcardや外部通信許可を足さない。

現main04のroute→Pages/R2サイズ分類はoffline候補だけ。private entry/診断/LOCAL_VALIDATION_ONLYをpublicへ配布しない既存guardを維持し、新しい正式公開artifactの組立と受入は別に行う。根拠: validation/2026-11-03-main04-offline-delivery-preparation.json。最新の改変記録/対応source subsetは準備済みだが、完全source公開と権利の最終確認を済ませた意味ではない。


### 2026-11-04: 標準ZIP配布packの生成・全entry再照合

build_browser_model_archives.pyはPython標準zipfileでZIP_STOREDを作る。既存private mount/resourceのurl/bytes/SHA対応とsource範囲を検査し、stream copy中のhashとfd/path stampで改変を拒否。ZIPを再openして全entryのbytes/SHAを元manifestへ照合する。固定1980timestamp/属性/entry順により同じ入力は同じZIP、ZIP64が必要な大きさは明示拒否。失敗時は自分が新規作成した出力だけ除去する。

CPU HR1096fileは971,387,274B/SHA0d0a724b…、Matte4fileは408,618,576B/SHAc0c2d99a…の2packになった。全1100fileは元とbyte/SHA一致、重み/graph/推論split変更なし。必要配布archive以外のweightcopy0。archive URLsはnullを維持し、公開・実browser受入やlicense/source最終確認を完了扱いにしない。生成物はevaluation/hf-cpu-transport-packs-01に保持。単体3/既存domain604/publicbuild成功、CIへbuilder testを追加。根拠: validation/2026-11-04-cpu-model-transport-packs.json。


### 2026-11-04: 実ORT WASMのcommitとEigenの対応source入手案内

G06のruntime条件を具体化した。選択asyncify WASM（28,747,738B、SHA ca319e95…）内の
`ORT Build Info`はcommit prefix `41d4d61f1`を持ち、公式GitHub APIのcommitへ
`41d4d61f14b9c1dd0b2ccda1e9b85dd415fd0496`として解決した。既存のORT LICENSE・
ThirdPartyNoticesは、この実build側commitの原文とも全byte一致する。版タグの文書だけを
実binaryのsource対応と推定する必要を減らしたが、producer自己申告のbuild文字列であり
独立再build/署名付きbinary attestationではない。

ThirdPartyNoticesのEigenはMPL-2.0で、Executable Formの配布時に対応Source Code Formを
入手できることと入手方法の案内が必要（本文3.2）。同commitのcmake/deps.txtから
Eigen `1d8b82b0740839c0de7f1242a3585e3390ff5f33`とupstream SHA1を固定した。
4,075,744Bの公式source ZIPは宣言SHA1に一致し、追加SHA256は
`6a60d76351f97132669daeeb721d6bf14b008101883ad2d687a3201c5c461eb0`。
2030memberのpath/サイズ/非symlinkを検査し、同commitのEigen build recipeが使う
2patchを標準patchでzero fuzz適用した。変更4fileをhash記録。source内のCOPYING.MPL2、
BSD、APACHE、MINPACK、READMEと各fileの表示は保持する。archive全体の単一licenseを推定しない。

新しいoffline HF候補04は、元5pack/モデル重み/runtimeを再複製せず、元候補03の8payload bindingを保持。
source ZIP、upstream deps/build recipe/2patch/LICENSE、SOURCE_AVAILABILITY.mdと検証記録を
追加して42files/2,715,313,443B。変更文書と新file34件は全SHA照合、private map0600、
public inventoryにhost絶対pathなし。READMEのlicense_nameをmixed-upstream-licensesへ修正し、
従来のMIT/Apacheだけの表示からEigen等の条件もあることを明確にした。
これはsource offerのローカル準備で、実公開URLへこれらを配置して初めて配信対象の
入手案内になる。公開本体のruntime noticeからも同じ固定source提供先へ到達させる必要がある。

旧source archiveは当時の固定候補として保持し、最新public-entry sourceを再現するとは表示しない。
その他のnative/toolchain・第三者条件と本体のsource release・モデル/画像・実公開の最終照合は残る。
runtimeを自前変更/再buildせず、新依存も追加していない。証拠:
validation/2026-11-04-ort-eigen-source-availability.json。


### 2026-11-04: 現公開形式アプリのsource配布候補を更新

古い611file source07を保持したまま、現public-entry/tool/6model Workerに対応する
647fileのsource08を準備した。source-only archiveに正確な公開policy fixtureと期待report、
resize WASM入力、手順を含め、復元先で通常版・configured core・全4親/2子Workerとnoticeが
全byte一致した。型/build/scripts21/domain623/UI287成功、sourceはtest後も全SHA一致。
同OS/既存固定Worker依存での検査で、native/全第三者source releaseへは広げない。

HF候補05のapp-source.tar.gzとSTATIC_SOURCE_REBUILD_REVIEW/SOURCE_BINDING_REVIEW/READMEを
現sourceへ合わせ、Eigen source入手案内を保持。source08のSHAは
`0946d483f4b502c2d34465a048863e1e9faa53ecd8157e300cb266c2dc6aac80`。
新source・文書は全SHA、既存モデル等13payloadは元bindingを保持して再複製しない。
実公開・公開本体noticeからのsource到達・残りnative/第三者条件の最終照合は未完。
根拠: validation/2026-11-04-current-public-entry-source-archive-08.json。


### 2026-11-04: HFに対応source/noticeを含む非公開候補を配置

`otama/image-studio-browser-models`のprivate commit
`cb7fac5196a06a82c85ee3a82fc1ed8d852f2fb5`へ、5model ZIP・ORT WASM・source08/変換source05・
Eigen source/patch・全文license/noticeとreviewを配置した。43reviewed fileの全remote
size/LFS SHA256またはgit blob IDが一致。WASM/Eigen source/2説明文書は認証付き
実readbackでもSHA一致。repoはprivate、匿名request401であり、公開source提供の完了ではない。

modelcardの`license_link: LICENSES.md`は公式検査がHTTPS URLを必須とするため拒否された。
実staging READMEではHTTPS repo LICENSES.mdへ修正し、ModelCard.validateをcommit前に必須とした。
旧offline候補は当時の証拠として保持する。license metadataの修正をmodel許諾変更とは扱わない。
公開時にはこの固定commitの対応source/noticeを実際のrecipientが取得できることと、
本体noticeからの到達、残る第三者条件、実HF/Pages/端末受入を確認する。
証拠: validation/2026-11-04-hf-private-staging-commit.json。

### 2026-11-04: 非公開ステージングのsource09差分を更新

private commit `de16f2b5b8860741327f8533cb703ca3bdb53b11`は、旧commitから
source09 archive/README/2review/inventoryの5fileだけを更新した。モデル/runtimeの実体は不変。
全43対象fileのremote sizeとLFS SHAまたはgit blob IDを再照合し、source09 archiveと
README/source案内/rebuildreviewを認証readbackしてSHA一致。公開範囲はprivate、匿名401を保持。
旧固定commitのモデルURLは不変のまま保持する。新sourceの匿名提供、本体noticeからの到達、
その他公開ゲートは未完。根拠: validation/2026-11-04-hf-private-source09-update.json。

### 2026-11-04: 本体noticeから固定sourceへの案内を接続した候補

既存`modelNoticesHref`が指すTXTへ、private commit `de16f2b5…`の
SOURCE_AVAILABILITY.md、本体source09、変換source、LICENSES、ORT第三者noticeの
固定URL・bytes・SHAを追記したローカル候補を組み立てた。元全文はprefixとして保持し、
新noticeのSHA付きpathとconfig/asset一覧を既存assemblyで照合した。
本体の既存「出典」リンクを使うため新しい画面設定や別経路は追加しない。
本体JSへのnotice URL埋込みとloopback HTTP body/SHA一致まで確認。
private markerを保持し、Pages guardの拒否も維持する。
認証なしではsourceに到達できず、実browserの操作や公開提供条件の完了ではない。
証拠: validation/2026-11-04-source-notice-static-delivery.json。

### 2026-11-04: 二重開始修正後source10の復元と非公開固定commit

source10は690file、archive SHA
`558aa25de4d918fa73b2100f59972e350c8ab1d49c95fec798cf5d3947a74311`。
fresh lock導入後、UI293/domain629/scripts24/型/buildと全source不変を確認し、
設定付き出力111fileを現候補f085be60…と全byte照合した。notice付き入力も同梱する。
private commit `7f8d4f5fe6f6ad4c9e1ff59ce8d7ad112c93a7aa`へsource/archiveと
関連文書6fileだけを更新し、archiveの認証readback SHA一致・匿名401を確認した。
モデル/runtime本体は不変。旧source09と実推論source8b17a544の証拠は固定履歴として保持する。
同梱入力のsource案内URLは先行固定commitを指すため、最終公開入力との対応確認は別途必要。
根拠: validation/2026-11-04-source10-private-staging-update.json。

### 2026-11-04: 変換source内のSwin表示補完・未使用handler除外

現source05の`model-input/birefnet/birefnet.py`には、Swin節のMicrosoft著作権とMIT参照がある一方、同source archive内のlicense/notice群にMicrosoftの全文がなかった。公式Swin-Transformerの固定commit `f82860bfb5225915aca09c3227159ee9e1df874d`からLICENSE 1141B/SHA `c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383`を取得し、API掲載git blobとも一致。既存model-notices索引とsource06のcurrent-noticesへ全文を追加し、元sourceのMicrosoft headerを保持した。重みの別許諾やSwin sourceの未改変一致を推定しない。

同source05の`model-input/birefnet/handler.py`はPhotoroom/fast-foreground-estimationを参照していた。固定commit `a98fe5dfe4b61521de1a92dcaeb6d138f95bc97d`の非省略recursive tree、READMEとsourceを確認した範囲で、明示的な利用許諾が見つからない。公開repositoryであることを許諾とせず、次の配布用source06からこの未使用HF deployment adapterだけを除外。元private資料とhistorical実行証拠は保持する。モデルconfig auto_mapはBiRefNet_config/BiRefNetのみ、bb_pretrained=false、残す全PythonのAST import/厳密module文字列にはhandler参照なし。任意の動的実行を証明する検査ではない。

source06は432file/708939B/SHA `9624b87141d651955c5f2598eaba115de57287b54be5af3ae4d6867cecf627cf`。元430fileのうち427file byte保持、handler1file除外、READMEとcurrent notice索引を更新し、license/補足/review3file追加。全archive memberの往復byte一致と既存notice検査16文書/回帰3件を確認。元exportレポートのsource_sha256は当時のdirectory全pyを含む履歴で、次のreportでは未使用handlerの項目がなくなる。今回新規export/推論はしていない。

HF offline候補14へsource06・全文・索引・来歴説明を結合。53配布file、変更/追加7path、model ZIP5本のbindingは不変で再複製0。現HF privateheadとsource12固定アプリ/入力・ソースリンクは更新しておらず、この修正を取り込んだ公開用assembly/匿名source提供/残りnative・第三者条件は別途必要。今回の修正だけでG06全体の条件充足としない。
[証拠と静的検査の範囲](validation/2026-11-04-source06-embedded-code-license-correction.json)参照。

### 2026-11-04: source06を非公開固定し本体のnotice overlayへ反映

source06/新Swin全文/索引/説明をprivate commit `080c14e31317e547e5d1190015393f91ecb496a9`へ変更8fileのみ反映。全54対象＋gitattr55fileのremoteサイズとLFS SHAまたはgitblobを照合し、修正7fileを認証付きreadback、匿名README401を確認。未変更payload20件は先行full-hash inventoryと今回のremote metadataへ結合し、大モデルは再read/uploadしない。

固定source12 archiveはbyte保持し、別release入力48file/2040643B/SHA `2097d6bd880106ad9765de5a9eb262ec1d2f1801f310ed7d64e7c3c2cfde0fbd`へ、source06を含む7固定URLとSwin MIT全文を接続。元notice全文をprefix保持。元コードsource12には古いモデル文書索引があるため、この入力を完全な表示overlayとして別に固定する。新依存・推論code/重み変更なし。復元source690fileと入力を全SHA照合し、fresh locked npmでexternal assemblyを作成、既定配置2回で全111fileがbyte一致。private Pagesguard拒否を維持。

更新ペア/入力/recipeはprivate commit `e8218bec6ab370138704b733df54a214a35da482`へ変更6fileだけ反映。全remote一致・10file認証readback一致・匿名401。新sourceId `sha256:6275e1613e0fe580441a74c021ebcd773a100c620245674bd3b115a7250d8b1a`、artifactId `sha256:c89bade34c990ad99395ed4fe785d0113e6d3f34438975f57404034c3c4846a1`。

GPU無効の実Chromeで、footerのdetailsを開く→出典linkをclick→別tabのSwin全文/7固定URL/元tab保持/noopenerを確認。local serverはTXT UTF-8を指定し、Pagesの実charset/header受入とは区別。初回harnessはsummaryをlinkとして探し、次に旧数値tab指定とJSON keyの誤りで終了した。各browser/serverはfinallyで終了し、実DOM/CLIのstable targetIdへ修正した最終試験が成功。推論0。owned復元依存/重複build894592478Bとbrowser profile/serverを整理し、原本/必要candidate/全証拠を保持した。先行e7 CPU実推論の証拠は当該先行artifactへ帰属させる。匿名提供/実Pages/権利全体・端末・画質・印刷の受入は継続。
[対応ペアとprivate/readback/実footerの証拠](validation/2026-11-04-source06-private-staging-and-paired-notice.json)。

### 2026-11-04: 補正OFF再利用source13と別入力の非公開固定

source13は696file/10179889B/SHA71d1ccb9f6c38023e6e0103dd07e3facd745c782c652fe66a8fa23cfc25bb288。fresh web/Worker lock導入から全UI306/domain631/scripts24/型/通常/設定build、全source SHA不変/privateguard拒否を確認。捕捉fixtureの全111fileがnative GPU OFF/ON/OFFを確認したc879作業候補と一致し、その限定した観測との対応を固定した。

private sourcecommit5532e2010fe8b5739847fba2c40191ace2cb5d5eへ変更6fileのみ反映し、全remote54対象＋gitattr55のsize/LFS SHAまたはgitblob一致・12file認証readback一致・匿名401。model/runtime/変換source06は不変。続いてsource13案内URLを含む別入力48file/2040530B/SHAe2e0fce2433fd0b9acfe652f6ec65f2ed2a98d8b7ae22533e5ef4fd919626efcを、検証済み復元source/依存を移して再利用し、既定配置2回の全111出力一致/privateguard拒否を確認。依存再installや大モデル再readを反復しない。新default sourceId9b8c83d87825c53b9696003d9856098a7d2aa94836e199724368b20e73c87e5a、artifactId662d8ed89252e74854323d607860640c435c46831b94ed19cff7167e51e383ad。

入力/recipe/pairはprivate36515b717c8a569545ba73bc2720248e9bac001bへ変更6file・全remote/readback12一致/匿名401。source06概要の「全400file保持」という古いREADME表記を427旧member byte保持/未使用adapter除外/notice更新へ訂正し、source13捕捉fixtureのnative観測と新default pair未受入を明確化した。READMEとinventoryだけをprivate2e2901d41a2d71cc86c36f46ac9056d9248d95f2へ変更2fileで反映、payload/入力binding不変、全remote/readback2一致・匿名401。旧immutable commitは当時の記録として保持する。

source captureコピーと移動した復元依存/重複build計938434210Bを全SHA再確認後に整理し、元archive/manifest/recipe/必要app/全native証拠/原モデルを保持。新default pairにnative全体受入を付けず、匿名source提供/実Pages・CPU native/全品質・端末・人・印刷・権利は継続。[source復元](validation/2026-11-04-source13-restored-build.json)、[対応ペアとprivate検証](validation/2026-11-04-source13-private-pairing.json)。

### 2026-11-04: 旧履歴の除外ソースを実確認し、新しい公開用repoを非公開で準備

非公開workbenchの過去commit0bedf932…からsource05 archive706774B/SHA8465d5a7…を認証付きreadbackし、現在は配布から除外した`model-input/birefnet/handler.py`4765B/SHAb0578adf…が残ることを確認した。headのsource06で除外しただけでは、既存repo公開時に過去の未確認ソースも公開される。利用者へ配布名の判断を求め、`otama/image-studio-models`を新規に使い、旧`otama/image-studio-browser-models`は非公開保持する選択を得た。

実行中のCPU試験終了/cleanupを確認後、確認済みallowlistだけから新repoを**非公開**作成。Git clone/fork/history移入は行わない。旧APP_RELEASE_PAIRING.json/REPLAY.md/app-build-input.tar.gzの3fileを除外し、new README/clean-history review・inventoryを加えた52fileをcommit98d5ada5026b9e8fe277b4fb617ee3a308788d1bへ配置した。公式SDK CommitOperationAddのupload_infoで全payloadのbytes/SHAを照合し、原file stampを送信前後で確認。全remote52対象＋gitattr53のsize/LFS SHAまたはgitblob一致、6file認証readback一致。全モデル/重み/実行WASMのbytesは変更しない。source06のhandler不在・Swin全文ありをarchiveで確認した。

履歴は新repo初期9a744fe1…と配置98d5ada5…の2commitだけ。旧0bedf932…を新repoで照会すると404、匿名README401、旧workbenchもprivateを維持する。これにより新repoへ旧未確認sourceの履歴を引き継ぐ経路を避けた。必要な旧private証拠は削除しない。新repoはまだ公開source offerではなく、現9b8アプリは旧workbenchのmodel URLを使用する。新repoの固定commitへresource descriptor/policy/noticeを結合し、対応入力・実配信等を受入する作業が残る。公開自体は必要な受入後。
[新repoのファイル・履歴・読戻しの証拠](validation/2026-11-04-clean-release-repository-private-seed.json)、[現ペアCPU試験と旧履歴の読戻し](validation/2026-11-04-source13-cpu-refine-toggle.json)。


### 2026-11-04: 採用ORTの公式Webビルド手順と既存NOTICEを照合

実WASMに記録されたORT固定commit `41d4d61f14b9c1dd0b2ccda1e9b85dd415fd0496` の
`.github/workflows/web.yml`、再利用Linux WASM workflow、`cmake/onnxruntime_webassembly.cmake`
を取得し、非省略Git treeのblob SHA-1/サイズと全byteを照合した。
Release callerはWebGPUを有効化し、再利用workflowの当該legはWebGPU/WebNNと
reduced operator/type supportを指定、`wasm_inferencing_webgpu`の出力を
`ort-wasm-simd-threaded.asyncify.wasm`へコピーする。JSEP/JSPIは別artifact。
これはファイル名だけから任意の旧JSEP recipeへ対応付ける根拠にはしない。

CMakeの直接link対象にはORT/ONNX/protobuf/flatbuffers/MLAS/re2と条件付きproviderがある。
XNNPACKは条件付きで、第三者NOTICEに名前があることだけから採用binaryにlinkされたとは推定しない。
Dawn/WebGPU関連のBSD-3-Clause全文・2017–2023 Dawn & Tint著作権・binary再配布条件・免責は、
採用ORTの既存ThirdPartyNotices（338088B/SHA143764b9…）に含まれる。
EigenのMPL全文3.2とsource入手案内は別に維持する。今回の確認対象に全文の重複追加は不要。
欠落Dawn節の変異fixtureを検査が拒否し、単なるファイル存在確認と区別した。

残るruntime証拠はproducerの実compiler版・有効依存とlink入力のmanifestであり、
固定commitの公式recipeを当該npm binaryのbuild attestationと同一視しない。
独立native再build自体を許諾の根拠へ置換せず、既存方針どおり公式runtimeを保持する。
公開時には必要source/patch/license/noticeの固定URLをrecipientが匿名で入手できることを確認する。
モデル/重み・画像の権利、実機/品質/印刷/Pages等は別の残件。
新依存・runtime/モデル変更・build・推論・公開・外部writeはなし。
[一次sourceと検査の証拠](validation/2026-11-04-ort-official-web-build-recipe.json)。


### 2026-11-04: source14とsource案内を含む別入力を新repoで非公開固定

source14archive702file/10205040B/SHAe3189668…を新repo commit965876b458ca84913cc120379dab063233b02b9bへ、README/source案内/2review/inventoryとともに変更6fileだけ保存。
全55対象＋gitattrのremote size/LFS SHAまたはgitblob一致、変更6file認証readback一致・匿名401、旧workbench privateを確認。
モデル/runtime/変換source06は不変で、大モデルの再read/uploadなし。

次に7source/notice URLをこのsource14固定commitへ結合した別入力48file/2041637B/SHA9a4ea4f0…を作成。
元notice prefix/Swin全文と元モデルcatalog対応を保持。source702/input48全SHA不変・既存同一lock依存再利用・既定配置2回全111file一致。
92生成non-notice資産は旧捕捉入力とbyte一致、private Pagesguard拒否を維持。sourceId7677a09f…/artifactc2bd4848…を新reviewへ記録した。
入力/recipe/pair/README/source案内/inventoryの6fileをprivate6ea9fff8b1e0086a238662e3de5725a8f5864ec1へ保存、全remoteと各6file認証readback一致・匿名401。
source14archive自身の捕捉fixtureは古いsource13案内の履歴として保持し、新規別入力と混同しない。

これはprivate固定と再現の証拠であり、recipientへの公開source提供・実匿名配送・configured native受入・全権利条件を完了扱いしない。
owned復元依存/重複build945393664Bを全SHA照合後整理。必要source/input/archive/paired111/全証拠/元モデルは保持。
[privateペアと限界](validation/2026-11-04-source14-private-pairing.json)。


### 2026-11-04: source14 NOTICEの固定配布先を認証付きで実照合

7677/c2bd候補111fileをpair manifestへ再hash一致確認し、実MODEL_NOTICES.txtの7本の配布案内を抽出。全URLは新repo `otama/image-studio-models` のsource固定commit `965876b458ca84913cc120379dab063233b02b9b`であり、当該commitのinventoryとHF metadataへ照合した。文書5件は認証readbackのsize/SHA/Git blob一致、source archive2件はLFS SHA/size一致（本体再取得なし）。Eigen source ZIPとORT source directoryの存在・案内SHAを確認し、ORT ThirdPartyNoticesはアプリ同梱分とも全byte一致。

これは必要文書・source案内の固定先に対する認証付き配送監査。private状態を維持し、匿名提供の合格や全license条件の確定へ拡張しない。実producer toolchain/link manifestは来歴の未証明事項として保持し、それだけを根拠にMIT/BSD等へ新しい独立再build義務を追加しない。Eigen等の実source提供条件と、一般の再現性・品質の受入を区別する。公開後は同じ固定URLの匿名readbackを別途確認する。

[照合結果と限界](validation/2026-11-04-source14-notice-delivery-audit.json)。一時readbackは自動撤去し、大モデルcopy・推論・HF更新・Pages配信は行っていない。


### 2026-11-04: source14配布文書・素材の同一性監査と残条件

同じ7677/c2bdの111fileを全再hashし、license/notice/legal名の全71txtを分類した。60件はSHA確認済みsource14 archive内の全文と一致、fflate4件はlock採用0.8.3のinstalled LICENSEと全文一致。生成LEGAL6件は必須帰属コメント/同directoryの全文文書の存在と既存pair再生成証拠へ対応、MODEL_NOTICES1件は先行7固定URL実配送監査へ対応した。未分類txtは0。本体LICENSEはrepo原文と全byte一致しnpm/package-lockのMIT metadataも一致。4作例PNG/WebPとlogo.svgの計5素材はarchive内SHA一致。原素材の許諾レビューを引き継ぐ識別照合であり、同一hashだけから新しい利用許諾を推定しない。

[全71文書と5素材の対応](validation/2026-11-04-source14-distribution-text-audit.json)。生成LEGALの自前再buildは今回追加せず、先行pairの全111出力再現と分けて記録した。

| 対象 | 確認済みの範囲 | 残る確認・公開時の条件 |
|---|---|---|
| 本体MIT / npm UI・PDF等 | 本体原文・metadata一致、配布THIRD_PARTY_NOTICES全文は捕捉sourceと一致 | 最終公開candidateを変更した場合はinventoryと実配信を再照合 |
| model/stage Workerの依存 | 変換/統合NOTICE、Apache/MIT全文、生成LEGALを固定candidateへ対応 | 匿名公開後も同じ文書を取得できること。旧private履歴を公開しない |
| MODNet / HR / ViTMatte | 先行の固定model card・code条件・変換変更記録・重み/pack/source識別を維持。今回model bytesは変更なし | G06の最終採用判断、モデル別条件と実配信物の最終照合。一般品質/実機の受入とは別 |
| ORT / Eigen | ORT全文同梱一致、固定Eigen source ZIP/patch/案内を非公開HFへ配置済み | MPL covered sourceと案内を受領者が入手可能にし、同じ固定URLを匿名readback。producer exact compiler/link manifestは別の来歴未証明事項 |
| processor / OpenCV / 移植kernel | 対応NOTICE/全文がsource14と一致。先行の固定source・改変記録・再生成証拠を維持 | 公開source/noticeの到達と最終採用条件の照合。公式未改変binaryへ独立再buildを一律要求しない |
| 合成作例 / logo | 公開予定5fileは捕捉素材と全byte一致、外部人物写真の追加なし | 新素材へ差替える場合だけ許諾と表示を再確認。今回同一性確認を許諾取得そのものとしない |

この監査で新たな文書欠落は検出していないが、権利条件全体の承認・公開済みのsource提供を主張しない。G06は進行中のまま。匿名HF/Pages配信、最終採用判断、人/実端末/実印刷は引き続き別ゲートである。
