# 公開runtimeへの接続（実装・受入状況）

2026-11-04のsource確認。これは実装境界の決定であり、公開承認・配信成功の証拠ではない。

## 状態契約と現ソースの検査

[状態機械](state-machine.md)を先行契約とする。全session生成入口/取消結果のowner・epoch確認、
初表示前のorigin検査/rollbackをsource14へ固定し、復元scripts24/domain665/UI317/型/通常buildが成功した。
旧713d/620cのnativeは修正前の履歴。以下の7677/c2bdでは四構成の通常保存を新たに確認している。
[RED/GREENの契約検査](validation/2026-11-04-state-machine-contract-and-session-ownership.json)、
[全入口と取消通知](validation/2026-11-04-state-machine-owner-paths-and-cancel.json)、
[初表示前rollback](validation/2026-11-04-state-machine-visible-transfer-rollback.json)。
全遷移・一般品質・公開条件の最終受入は別に残す。

## 現在の固定レビュー候補（source14・非公開）

| 対象 | 固定値 |
|---|---|
| 公開準備先（現在private） | `otama/image-studio-models` |
| source14 commit | `965876b458ca84913cc120379dab063233b02b9b` |
| 入力・再現手順commit | `6ea9fff8b1e0086a238662e3de5725a8f5864ec1` |
| モデル/runtime commit（不変） | `98d5ada5026b9e8fe277b4fb617ee3a308788d1b` |
| source archive SHA | `e3189668fb970295ba0c2a925a218dda0ffb5e6aeaaa781363ab361cd8cb135b` |
| 入力archive SHA | `9a4ea4f06a5b00c28916fcec08b87fb201183d657a674ddf52bb4addfe31a6fa` |
| 既定配置sourceId | `sha256:7677a09f71d1a309010a3828bfb51408248d4b1d709777a01c0e0993259be150` |
| artifactId | `sha256:c2bd4848eaecb515be3eccb5d41bf791df2dce9f566428436383ddeef85f2b94` |

source14の702sourceを変えず、48入力の7source/notice URLをsource14固定commitへ結合。
model/runtimeは旧98d5…のまま。Swin全文/元notice prefix/変換source06を保持し、旧handlerを再導入しない。
既存の検証済み依存を再利用してexternal build・既定配置2回を実行し全111filebyte一致。
92生成non-notice資産は旧source14捕捉入力の候補と同じ。private markerへのPages guard拒否を確認した。

source更新6fileと入力更新6fileを各非公開commitへ保存し、全55remote＋gitattrの対応・各6file認証readback一致・匿名401を確認。
旧workbenchもprivate。現7677/c2bd候補でMODNet CPU→GPU→ページ往復後CPUの3native PNG保存を確認。
全3PNGは各旧基準とbyte一致、不透明入力RGB不一致0、モデルZIP1GETを確認した。
GPU後のページ往復はBFCacheを使わない新document復帰（probe消失）であり、旧写真/保存0から再選択・CPU保存へ復帰。
同意→結果観測6.315/6.323/6.480秒は2秒poll込み・CPU初回cold/GPUと復帰CPUはcache再利用で、実HF性能やbackend速度順位を保証しない。
RSS最大2,075,389,952B/cgroup最大829,812,736B/GPU最大577,691,648Bでguard内。
owned92,291,072Bを撤去し、container停止・Gufo0・GPUclient0・VRAM169,684,992Bへ復帰した。
遷移先fixtureのfavicon404記録だけを区別し、アプリ/モデル資産はGET200。BFCache非利用の理由は未計測。
[現候補MODNet nativeとnavigation復帰](validation/2026-11-04-source14-modnet-native-lifecycle.json)。
同じ7677/c2bd候補のGPU HR＋ViTMatteでも透過PNG→白背景handoff→crop PNG→A4 PNG/PDF→背景復帰を実保存した。
背景PNGは既存GPU基準5b583f09…とbyte一致、crop/A4 PNG/PDFも各旧候補と全byte一致。
A4 PDF内2480×3508 DeviceRGBの全26,099,520Bは対応PNGと一致、1page595.2×841.92ptを確認。
390px6状態でoverflow/alertなし・対象a11y自動違反0（未完チェックは別）。
HR/Matte/準備/生成/5秒poll込み結果観測91.370秒で、実HF速度や一般画像処理時間の保証ではない。
RSS最大5,103,570,944B/cgroup最大4,517,040,128B/GPU最大3,205,795,840Bでguard内、
owned2,589,872,128Bを撤去しcontainer停止/Gufo0/GPUclient0へ復帰した。
[現候補GPU主要journey](validation/2026-11-04-source14-gpu-full-journey.json)。
CPU HR＋ViTMatteも同じ7677/c2bdで、透過PNG→白背景crop→A4 PNG/PDF→背景復帰を完了。
GPU無効・最大2WASMthreads/CPUquota200%/8GiB枠で、CPU注意書きを確認した。
透過PNGは旧CPU基準81f2b845…とbyte一致し、crop/A4 PNG/PDFも各旧CPU出力と一致。
結果観測339.547秒はcold local準備/HR/Matte/export/5秒poll込みで、native保存や全journeyの総時間とは別。
RSS最大6,821,974,016B/cgroup最大6,836,867,072B/host空き最低23,322,349,568B、
GPU最大171,622,400B（増加1,937,408B）でguard内。owned2,820,165,632Bを撤去しGufo0/container停止へ復帰。
8GiBはbrowser上限であり、物理RAM8GiB端末の対応保証ではない。
[現候補CPU主要journey](validation/2026-11-04-source14-cpu-full-journey.json)。

同一候補の四構成は単一合成portraitで通常native保存済み、不透明入力RGB不一致0。
HR CPU/GPU alpha差は最大16・8,201画素/MAE0.0061461545で既存最終pipeline観測と一致する。
新しい画質閾値を設定した意味ではない。
[四構成の対応表](validation/2026-11-04-source14-four-choice-native.json)。
source13→14の実行コード138fileではApp/BackgroundEditorの2fileだけが変更、他136file/依存manifest-lockは不変。
[変更影響の照合](validation/2026-11-04-source14-runtime-change-impact.json)に基づき、計算部分の既存証拠と現UI統合の証拠を分けて保持する。
同候補GPUで「輪郭を補正しています」表示中に中止し、同写真Blob URL/1086×1448保持、保存0/alert0、
「輪郭を補正してPNGを作成」から再試行して既存GPU基準PNGとbyte一致を確認した。
再試行の1秒pollではHR進捗再表示なし、trimap/Matte/前景色/保存を観測。ZIP2GET・子Worker1GET・cache140を維持。
cold準備/HR/Matte中止/補正再試行/export/poll込み101.274秒で、通常連続処理や正味ML時間ではない。
RSS最大5,121,527,808B/cgroup最大4,535,816,192B/GPU最大4,212,473,856Bでguard内。
owned2,586,497,024B撤去、container停止・Gufo0・GPUclient0/VRAM169,684,992Bへ復帰した。
[現候補GPU取消と保持mask再試行](validation/2026-11-04-source14-gpu-matte-cancel-retry.json)。
表示/最終結果/既存source契約の証拠であり、Worker commandやGPU kernel中断位置を直接観測したとはしない。
全取消競合の組合せ・匿名HF/Pages・全shape画質/実機/人/実印刷・権利最終受入は未完。
source14archive内のfixtureと旧source13 pairは履歴として固定し、最終組立にはこの別入力を使う。
復元source/deps/重複build945,393,664Bを全SHA再確認後に整理し、必要archive/input/最終111file/全証拠を保持。
[対応ペア・private readback・検証範囲](validation/2026-11-04-source14-private-pairing.json)。

## source14の初回ローカル復元候補（履歴・旧source案内入力）

状態機械からのsession owner/取消結果/初表示origin修正と契約・回帰を702source fileに固定した。
archive10,205,040B/SHA `e3189668fb970295ba0c2a925a218dda0ffb5e6aeaaa781363ab361cd8cb135b`。
同一lockfileの既存依存を移して再利用し、復元先scripts24/domain665/UI317/型/通常build成功。
通常版14fileは現作業版aecd…と全byte一致。fresh installや独立native rebuildとはしない。

旧98d5…固定資源とソース案内を持つ捕捉入力48fileを既定配置したローカル候補は、
sourceId `sha256:1d678b0588b731553908b26d403b77cd745982ffbf663fca4ed12e27e8211630`、
artifactId `sha256:14156ac28d292029fff55f3a58ef31118137d708e78e4422abd5fcbe21b068a9`。
2回の全111出力はbyte一致、生成資産93fileは旧713d/620c候補と同じ、private Pages guard拒否。
入力のsourceリンクはまだsource13を指すため、source14の非公開固定と新overlay/pairが必要。
現configured候補のnativeを未実施のまま旧候補から継承しない。
[復元・検査・cleanupの証拠](validation/2026-11-04-source14-restored-state-machine-build.json)。
復元依存は次のpair組立のため維持し、重複source/build93,175,808Bを整理した。モデル原本は変更しない。

## 公開用配布先と非公開workbenchの分離

利用者の選択により、公開用は`otama/image-studio-models`、既存の`otama/image-studio-browser-models`は非公開workbenchとして保持する。
公開用repoも現在は非公開。旧履歴を取り込まず、確認済みファイル52件だけをcommit `98d5ada5026b9e8fe277b4fb617ee3a308788d1b`へ配置した。
新repoの履歴は初期commit＋配置commitの2件、旧除外ソースを含むrevisionは新repoで404、匿名READMEは401。
[clean-history配置の検証](validation/2026-11-04-clean-release-repository-private-seed.json)参照。

新repo向けdescriptor/policy・noticeを結合し、固定入力48fileとsource13から全111fileを2回同一bytesで再現した。現在の非公開ペアは下表。下段の旧workbenchペアは履歴として保持する。

| 対象 | 固定値 |
|---|---|
| source・モデルcommit | `98d5ada5026b9e8fe277b4fb617ee3a308788d1b` |
| 入力・再現手順commit | `5b757cde330190b5d6d81d68d4eade7bcc37cc6f` |
| 入力archive SHA | `745f229ef1a169ba378591a78c187d654eb5e0d6ad598b6fda31e7f1a73bbfae` |
| 既定配置sourceId | `sha256:713d404b0173cc9140c38b63512406890b442fb80a89375c5402f19be430c2f4` |
| artifactId | `sha256:620c087b286e5a9440c4b8d9a440a54c9952fb40acb131077f02176554cb16b8` |

全remote metadataと変更6fileの認証readback一致、匿名401、旧repo非公開を確認。private markerとPages guard拒否を維持する。
新repo向け外部入力候補ではMODNet CPU/GPUの実PNG保存・既存基準byte一致・写真保持・旧保存失効・共有ZIP 1取得を確認した。
このnative観測は外部入力候補artifact `52d86c60…` に属し、既定配置artifact `620c087b…` のnative受入へ自動転記しない。
その後、既定配置artifact `620c087b…` / sourceId `713d404b…` を別試験し、MODNet CPU→GPU両方のnative保存を確認した。
各基準PNGと全byte一致、不透明部分の入力RGB不一致0、写真保持・旧保存失効・共有ZIP1GETを確認。
同意から結果観測まで6.413/6.387秒（2秒poll込み、GPUはcache再利用）であり、CPU/GPUの速度順位を示さない。
RSS最大2,202,865,664B、cgroup最大933,158,912B、GPU最大577,691,648B、ホスト空き最小28,266,250,240Bで既存guard内。
試験profile/app/ZIP/証明書/一時DLの89,128,960Bを撤去し、container停止・Gufo0・GPUclient0・VRAM169,684,992Bへ復帰した。
[既定配置ペアMODNet native検証](validation/2026-11-04-clean-paired-modnet-native-switch.json)。この限定した2構成の証拠をHR/Matteや実HF配信へ転記しない。
[固定ペアと検証範囲](validation/2026-11-04-clean-repository-fixed-pairing.json)。HR/Matteも同じ既定配置ペア713d…/620c…でCPU/GPU各OFF→ON→OFFのnative PNG保存を完了。全6PNGは各旧基準とbyte一致、OFF戻しと初回OFFもbyte一致、不透明入力RGB不一致0。保持mask再利用・写真保持/旧保存失効・各ZIP2GET/子Worker1GET・資源guard内を確認した。

| HRケース（同意・poll・保存込み） | CPU | GPU |
|---|---:|---:|
| 初回OFF（cold準備/HR/前景色/保存） | 298.558秒 | 81.857秒 |
| ON（保持maskでMatte/前景色/保存） | 45.718秒 | 16.577秒 |
| OFF戻し（前景色/保存） | 4.213秒 | 4.287秒 |

CPU RSS最大6,846,935,040B（8GiB枠）、GPU RSS最大5,291,089,920B（5GiB枠）で終了。CPU/GPU間alpha差はOFF最大7/ON最大16、ON差8,201画素で既存最終pipeline比較と一致する。過去の補正入力一致probeの1段階以内を最終CPU/GPU品質の閾値へ流用しない。
試験用計5,400,387,584Bを清掃し、container停止・Gufo0・GPUclient0・VRAM169,684,992Bへ復帰。
[同候補四構成の限定native証拠](validation/2026-11-04-clean-paired-four-choice-native.json)、[CPU](validation/2026-11-04-clean-paired-cpu-refine-toggle.json)、[GPU](validation/2026-11-04-clean-paired-gpu-refine-toggle.json)。単一合成画像/Linuxの限定試験であり、全shape画質・実機・人・印刷、権利全体、匿名HF/Pagesの受入は継続。
古い入力ペア3件は新repoへコピーせず、旧repoをそのまま公開する経路は使わない。公開自体は必要な受入後とし、ブラウザにtokenを入れない。

## 旧workbenchの固定レビュー候補（source13・補正OFFマスク再利用）

この表のcommitは非公開workbench `otama/image-studio-browser-models`に属する。以下は公開承認・実配信・全端末受入ではない。

| 対象 | 固定値 |
|---|---|
| ソースcommit | `5532e2010fe8b5739847fba2c40191ace2cb5d5e` |
| 入力・再現手順commit | `36515b717c8a569545ba73bc2720248e9bac001b` |
| README補足commit | `2e2901d41a2d71cc86c36f46ac9056d9248d95f2`（payload/入力は不変） |
| モデルcommit | `cb7fac5196a06a82c85ee3a82fc1ed8d852f2fb5`（変更なし） |
| source archive SHA | `71d1ccb9f6c38023e6e0103dd07e3facd745c782c652fe66a8fa23cfc25bb288` |
| 入力archive SHA | `e2e0fce2433fd0b9acfe652f6ec65f2ed2a98d8b7ae22533e5ef4fd919626efc` |
| 既定配置sourceId | `sha256:9b8c83d87825c53b9696003d9856098a7d2aa94836e199724368b20e73c87e5a` |
| 全111fileのartifactId | `sha256:662d8ed89252e74854323d607860640c435c46831b94ed19cff7167e51e383ad` |

補正ON/OFF両方の保持mask再利用・写真/model失効・OFF/mask時model取得0・操作/同意copyを含む696source fileを固定。
source archive10,179,889Bをfresh locked npmで復元し、UI306/domainWorker631/scripts24/型/通常/設定buildが成功。
捕捉された外部fixtureの全111fileは、実GPU OFF→ON→OFFを検証したc879候補と全byte一致。
この限定したnative観測は[性能改善の証拠](validation/2026-11-04-mask-reuse-off-native-optimization.json)と
[ソース復元](validation/2026-11-04-source13-restored-build.json)に対応する。

新しい固定source案内URLを含む別入力48file/2,040,530Bは、直前の復元source/検証済み依存を再利用してbuild。
既定配置2回で全111fileが一致し、private Pages guard拒否を維持。変換source06のhandler除外・Swin全文も保持する。
[現ペア・private固定・readback・限界](validation/2026-11-04-source13-private-pairing.json)参照。
既定入力のsourceId9b8…については、GPU無効/最大2WASMthreads/8GiB枠でCPU高画質OFF→ON→OFFのnative PNG保存を確認した。
OFF戻しは最初のOFFとbyte一致、ONは既存CPU基準81f2…と一致。全caseが同写真/旧保存link失効を維持し、後2caseでHR再実行表示なし。
同意・poll・実保存を含む384.641/60.139/4.380秒は、private loopback cold準備/補正だけ/前景色＋保存の単一画像観測で、一般speed保証ではない。
[現ペアCPU toggleの証拠](validation/2026-11-04-source13-cpu-refine-toggle.json)。GPU等の全体native受入は自動継承しない。
作業repoの通常公開入力への採用、実匿名HF/Pages、全品質・実機/人/実印刷・残り権利は継続。

以下のsource11/source12等の節と検証は履歴。先行e7f8d88a…のCPU Matte中止/補正のみ再試行PNG一致や、
source12＋source06表示入力6275e161…の実footer確認は、それぞれの古い固定artifactへ帰属する。

## 現在の接続と不足

| 責務 | 現在の所有者 | 公開へ必要な変更 |
|---|---|---|
| UIへのruntime注入 | `web/src/Root.tsx`の任意`backgroundRuntime` | `main.tsx`から固定build設定を`releaseRuntime.ts`へ渡し、既存runtime/Rootへ注入する経路を実装済み。通常buildの設定はnull。公開設定の構造検証とローカルpolicy/資産結合を実装済み。公開assembly・実origin受入は未完 |
| 4モデル・CPU/GPU選択、警告、cache操作 | `web/src/background/runtime.ts` | 既存のoptionsとmodelVariantsを使う。CPU高画質の明示選択・警告を保持する |
| 私有検証の入口 | `web/src/localValidation.tsx` | 公開入口からimportしない。private origin判定、trace、強制background遷移を公開へ転用しない |
| モデルの検証・取得 | `resource-policy.mjs` / `model-archive.mjs` | HF公開後の固定40桁commit URL・bytes・SHAへ結合。latestやブラウザ内API tokenを使わない |
| HR子Worker起動 | `browser-model-prepare-worker.mjs` | `/assets/<sha>/stage-worker.js`も同一origin・必須descriptor・path SHA一致で受理するよう実装済み。既存`createVerifiedWorkerScript`でbytes/SHA照合する。公開資産生成済み。ローカルTLSで公開形式の子Workerによる全HRとnative PNGを確認。実Pages/匿名HFでの接続は未受入 |
| Worker生成・asset配置 | `tools/build_browser_local_app.mjs`等 | HR子Workerは`build_browser_public_stage_worker.mjs`で公開形式の資産・notice・descriptorを生成可能。親4本・補助資産・標準mainのローカル候補を組立済み。標準assemblyは4選択/6Worker/93資産を再現済み。公開配布設定と実origin受入は未完。既存local app builderはprivate専用のまま保持する |
| CSP・cross-origin isolation | `web/public/_headers` | 設定ありbuildに限り固定HF配信先・WASM/Blob Worker許可とCOOP/COEPを生成する処理を実装済み。通常版のself限定ヘッダーはbyte保持。loopbackで出力header適用とcrossOriginIsolatedを確認。実Pagesと匿名HFモデル配信の受入は未完 |
| 配布検査 | `web/scripts/check-dist.mjs` | private entry拒否、モデル非同梱、25MiB上限、server実行禁止を保持。公開資産はその検査を通す |
| preview/production | `.github/workflows/web-check.yaml` | 同一build成果物のinventory照合を継続。main preview、安定タグproductionを変えない |

## 接続順序

1. 承認対象のruntime・モデル・全notice/sourceを確定し、HF公開候補のinventoryとの対応を確認する。
2. 公開用Worker資産と同一origin URL、必須descriptorの生成を実装する。まずローカルの公開相当buildで検証し、private検証buildの配布guardを変更しない。
3. 既存runtime optionsを公開entryへ渡す。モデルの切替で写真を維持し、GPU非対応でもCPUを明示選択可能にする。providerや品質の黙ったfallbackを加えない。
4. HFへの公開後、返された固定commitをmanifestへ結合する。公開前の仮commitやprivate filesystemのpathをbuild入力として受理しない。
5. mainのpreviewで実HTTPS、CSP/COEP、匿名HF配送、cold/warm、取得・推論中止、PNG保存、写真非送信を確認する。
6. 計画36の品質・端末・権利・印刷等の受入を満たしてからタグで本番へ進む。deployment IDとinventory、固定モデルcommitを記録し、旧版復帰を確認する。

公開モデルcommit未取得でも、手順2のWorker資産生成とdescriptor検証はローカルで進められる。
公開originを固定値でWorkerへ埋め込むとPages previewで使えないため、同一originの資産URLはbuild時のprivate hostからコピーしない。
公開APIから起動時にlatest manifestを取得する機構や新しいcache engineは追加しない。

## 必要な証拠

公開資産descriptorの改ざん・欠落・別origin拒否テスト、private配布拒否の既存テスト、
public buildへのruntime接続テストに加え、実previewでの4選択の保存・CPU警告・通信失敗復帰を確認する。
ローカル4モデル成功の既存証拠はモデル機能の根拠であり、この公開接続の完了とは区別する。

2026-11-04追補: ORT bootstrapは同一originの相対MJSと固定commit配下HF WASMのURL契約に対応した。公開Worker生成の前提の一部を解消したもので、生成tool・実配送・WASM起動の完了ではない。詳細はvalidation/2026-11-04-public-runtime-hub-policy.json。

## HR子Workerの公開形式生成

```bash
node tools/build_browser_public_stage_worker.mjs CAPTURED_DEPENDENCIES RELEASE_STAGE_POLICY_JSON NEW_OUTPUT
```

入力は`workerLifetime`、`maxStagesPerWorker`、`wasmOrigin`、`runtimeAssets`、`profile`、`stages`だけを持つJSON。
`stages`は既存段階実行のinputs/outputs/localModelPath/releaseを使う。
MJSは採用済みruntimeの相対path、WASMは同じ固定runtimeのHF commit付きURL。
各段の資源も同じHF repo/commit配下の固定URL・bytes/SHAへ結合する。
scope/appOrigin/診断flag/sourceArtifactなどprivate記述、別revision、任意runtimeの代入を拒否する。
既存の固定Transformers.js/ORT/hash-wasm/esbuildを再利用し、新しい依存は追加しない。
依存directoryには`tools/browser-build`へ`npm ci --ignore-scripts`したprojectを指定できる。旧captured evaluation layoutも過去の再現用に保持する。

出力は`assets/<script SHA>/stage-worker.js`と対応notice、`stage-worker.json`。
reportのworker.pathを実originで絶対URL化したdescriptorを親Workerへ渡す。
資産全体のbytes/SHAもreportに保持する。既存出力は上書きせず、private appの配布guardは維持する。
CPUカタログの固定URL埋込みでscriptが1MiBを超えるため、HR子Workerだけ2MiBを上限とする。
汎用verified Worker loaderの既定は1MiBのまま。

このtoolはcompile専用で、reportの`distributionApproved`と`hubRevisionVerified`はfalse。
HTTPでrevision実在や資源内容を証明しない。公開前に実revisionとinventoryを別途照合する。
検証fixtureの仮revisionを本番manifestや公開配布物に使わない。
2026-11-04の試験は実46/406段の資源identityを保ったfixture URLで実施し、
生成全assetのSHAと別cwdからの全byte再現を確認した。実HF配送・WASM起動・推論の受入ではない。
根拠はvalidation/2026-11-04-public-stage-worker-build.json。


2026-11-04追補（親Worker）: 子Workerの相対worker/workerFile.urlを実行originで照合し、
loaderには照合済みの絶対URLを渡すよう接続した。privateの絶対URL互換は保持。
既存trusted-policy builderでprivate metadataを除いた4構成をcompileし、
6role/5uniqueZIPのresource identity、provider/processor/resize設定と子Worker descriptorを照合した。
ここでもHub URLは未公開の構造fixture。公開用のpolicy検証・asset組立・本体entry注入を
既存builderで完了した扱いにはしない。根拠はvalidation/2026-11-04-origin-neutral-parent-worker-build.json。


## 公開入口の接続

`__BACKGROUND_RELEASE__`はbuild時に固定する`ReleaseBackgroundConfig | null`。
通常のVite設定はnullで、URL/query/localStorage/写真から設定を取得しない。
公開用設定は既存runtime optionsのWorker URLを`workers`の相対pathへ置き換え、
variantのmodelWorkerも相対pathとする。modelNoticesHrefは必須のhash付き同一origin TXT。
`releaseRuntime.ts`が`/assets/<64hex>/<name>.js`とnotice pathを検査し、実originへ解決する。
モデルの選択/CPU警告/cache/処理は既存runtimeが所有し、別実装は作らない。

mainは最初に手動編集を表示し、設定があればruntimeを遅延importして同じRootへ渡す。
失敗時は任意exceptionを表示せず固定の復帰案内を出し、サイズ調整・印刷を維持する。
モデルやWorkerの起動は従来どおり利用者の操作後。起動時にモデルを先読みしない。
nullの通常buildは背景runtime chunk/input Workerを出力しない。

private public-entry-build-01では、前段の4親/2子Worker・補助Worker・MJS/OpenCV・noticeを
実SHA照合して配置し、標準index/mainを固定fixture設定でbuildした（110files/20567323B）。
仮HF revisionと未接続CSPのため実行受入ではなく、private markerを保持してPages guardの拒否を確認。
実公開用設定の検証・資産組立tool、公開CSP/COEP、実HF・browser受入は引き続き必要。
根拠: validation/2026-11-04-public-entry-runtime-injection.json。


## Pagesヘッダーのbuild接続

Viteの解決済み`__BACKGROUND_RELEASE__`がobjectのときだけ、`pages-headers.mjs`が
HFモデル配信対応の`_headers`を生成する。nullの通常版は既存public/_headersと全byte一致する。
build literalは下記の構造検証を通してからmodeを選ぶ。資産実body/Hub実在/配布承認の検証とは分ける。
モデル版ではscriptのWASM compile許可、workerのself/Blob、connectのself/HF/既存観測CDNを許可し、
COOP same-origin / COEP require-corpを付ける。JavaScriptのunsafe-eval/inline scriptや任意hostは許可しない。
写真の非送信はCSPだけで証明せず、コードと実通信で引き続き確認する。

Cloudflareでは同じresponseに一致するCSP行が結合されるため、生成CSPはglobal1行にする。
既存のReferrer/Content-Type/Frame/Permissions制約とhash付きassetsのcache ruleは維持する。
public-entry-headers-build-02で4構成の実Vite出力とgeneratorの全byte一致を確認した。
private fixture markerは保持し、Pages guardの拒否も再確認。実Pages response/COEP/HubCDN/browserは未完。
根拠: validation/2026-11-04-pages-background-response-headers.json。


## release設定の構造ゲート

ViteのconfigResolvedで`parseBackgroundRelease`を実行し、不正設定は出力を作る前に拒否する。
nullは手動版。設定ありでは初期公開対象のMODNet CPU/GPU、HR+ViTMatte GPU/CPUの4選択を必須とし、
初期選択は軽量CPU、HRの輪郭補正はONを維持する。将来の別モデル対応をこのschemaで先取りしない。
各モデルの協調中止protocol、paired model version、unique UI選択IDを検査する。
Worker/noticeのpath判定はbrowser/runtimeと同じrelease-asset.mjsを使う。
ZIP member名判定もimporterと同じvalidateModelArchiveFilesを使い、既存ResourcePolicyとCacheActionsで
URL/bytes/SHA/cache namespaceを検証する。ネットワーク・GPU・モデル読込みは行わない。

全資源/ZIPを同じ固定HF repo/commitへ限定し、MODNetのCPU/GPU共有ZIPとcache namespace、
5packの共有member metadata一致、ZIP_STOREDの最低容量、整数bytes合計も確認する。
private scope/origin/trace/sourceArtifact/任意callback等のunknown keyは拒否し、例外は固定codeへまとめる。

これは設定の構造と自己整合性のゲート。Hub revision実在/許諾、ZIP実body、
親Workerに埋め込まれたpolicyや配信資産の実SHAとの結合は次の必須条件として残す。
実Viteで不正3例の出力前拒否と、既存4選択fixtureの192MiB heap内buildを確認した。
一時build8,635,269Bはmanifest採取後に整理。根拠はvalidation/2026-11-04-public-release-schema-gate.json。


## 本体設定・Worker・モデル一覧・配布bytesの結合

設定ありのVite buildは`background-release.json`へschemaVersionとconfigSha256だけを出力する。
public sourceへ同名fileを置くことは禁止し、通常版では生成しない。`check-dist`も小さなschemaを検査する。
これにより、外部の設定JSONと「実buildに渡した設定」の食い違いを検出する。

```bash
node tools/verify_browser_release_bindings.mjs SOURCE_ROOT SPEC_JSON NEW_REVIEW_JSON
```

specはapp/config/catalog/bindings/assetsを指定する。config/catalogと各Workerのpolicy/reportは
SOURCE_ROOT内の相対path。assetsはapp内の公開path・bytes・SHAの一覧。
既存trusted preparation検証とpublic stage policy検証を再利用し、4親Workerのpolicy digest・bytes/SHA、
6roleのprepare記述、2子Workerのpolicy/descriptor/資産、5packのcatalog member記述を照合する。
Workerのproviderとcache/アーカイブ記述の差異、noticeやruntime MJSの欠落も拒否する。
宣言した配布fileは1MiB chunkで全SHA照合し、symlink/範囲外/変更中のfileを拒否する。
source JSONは8MiB、Pages assetは25MiBで制限する。任意JSON parse errorへ内容を流さない。

これはローカルbuild reportを信頼する照合で、署名や独立したsource認証ではない。
全dependency closure/公開用assembly、実Hub commitやZIP本体、権利承認、実ブラウザ受入は残る。
private fixtureのmarkerを緩めずに実施でき、配布承認flagは常にfalse。

2026-11-04は現sourceから4親Workerを再compileし、4構成標準mainの候補03へ結合。
93asset/6role/5packを照合し、別configへの差し替え拒否と再検査の同一結果を確認した。
最終候補111files/20567852Bは通常buildとsourceId一致。初回に作った中間Vite出力だけを
全SHA確認後に置き換え、モデル/子Worker/markerを保持した。実推論とHF実配送は未実施。
根拠: validation/2026-11-04-public-release-resource-bindings.json。


## 標準入口のブラウザ起動受入（推論は未受入）

現sourceId `eb9f04fd…`、候補artifactId `19722622…`をChrome155のloopback HTTPで確認。
生成したglobal7headerを適用し、4選択、CPU高画質だけの時間警告、HR補正の初期ON、
明示GPU選択の保持、crop/printの入口、crossOriginIsolatedとSharedArrayBufferを確認した。
実親Worker4本はmodule Workerで起動しdispose応答まで受信。モデルprepare/inferは送っていない。
起動/選択時のpage通信はselfのみ、モデルcacheは空。CDP経由の空WASM/Blob Worker probeは
API能力のsmokeに限り、通常実行のCSP適合やモデル推論の証明には含めない。

2GiB/GPU無効/CPU1/nice19の監視下でRSS合計最大1,328,189,440B、
ホスト空き最小11,540,963,328B、監視は正常終了。profile/app配置33,644,544Bと
転送tar20,736,000Bを整理、proxy/tunnel撤去、container停止・Gufo0・GPU client0を確認した。
元モデルと証拠は保持。実HF/Pages/HTTPS、モデル取得・4構成推論・保存・写真非送信・
現sourceのHR推論中止は引き続き未受入。
根拠: validation/2026-11-04-public-entry-browser-bootstrap.json。


## 現標準入口でのMODNet CPU取得・推論・保存

同じsourceId `eb9f04fd…` / artifactId `19722622…`の本体・親Worker・CSPを変更せず、
専用ChromeだけHF名をコンテナ内の固定route TLS serverへ解決して試験した。
使い捨て証明書のSPKIだけをそのChromeへ許可し、host DNS/CAやCSPを変更していない。
実Hub/CDN配信の証拠には含めない。serverは本体111fileとMODNet資源/WASMの全SHAを起動時照合し、
任意proxy/画像受付を持たない。未知route404、資格情報/他Origin403、POST405をself-checkした。

通常の写真選択→取得確認→処理ボタンから、ZIP1GET・外部WASM1GETとself MJSの実取得、
MODNet CPU推論・前景Worker・PNG export・ブラウザnative保存まで完遂した。
1086×1448合成人物のPNGは2,297,950B、SHA `8ef80121f72498d3ddc4ccb064d0b9739df0b884bdebd6a2bc9a2beeb7f63fee`で、
以前の固定CPU候補と全byte一致。cacheはconfig/ONNXの2file、crossOriginIsolated=true、
private traceなし、取得済み結果のvisible alertなし。

PNGを回収した後、AMDホストのIncusサービス再起動によりコンテナが停止し、
監視の最終state書込みがBrokenPipeで失敗した。試験を再起動せず、停止中rootfsから証拠を回収した。
873sampleの観測区間はRSS合計最大1,736,093,696B、ホスト空き最小11,414,446,080Bで枠内。
正常な監視終了、warm、最終browser errors/network/screenshotを確認した扱いにはしない。
今回profile/app/ZIP複製/証明書93,179,904Bを削除、proxy/tunnel撤去、container停止/Gufo0/GPU client0と
GPU基準169,684,992Bを確認。元モデルとevidence53は保持した。
残る3構成、HR推論中取消、実Hub/Pages、通信privacy全体、一般品質・実機・物理印刷は未受入。
根拠: validation/2026-11-04-public-entry-modnet-cpu-save.json。


## 現公開形式sourceの復元・6 Worker再生成

source archive08は647file、8,119,401B、SHA
`0946d483f4b502c2d34465a048863e1e9faa53ecd8157e300cb266c2dc6aac80`。
現本体/公開runtime tool/CI/notice/testと、親4本・子2本の固定policy/期待report、
configured entry設定、既存resize WASM入力と再現手順を含めた。モデル重みや認証は含めない。
古いprivate policyを外部directoryから探す必要はなくした。Workerライブラリは既存の
固定captured依存を使うため、全依存の単独導入recipeが完成した意味ではない。

archiveを別directoryへ復元して全member照合、offline npm ciで135packageを新規導入。
sourceId `eb9f04fd…`の通常版14files/8,172,810B、configured core＋marker18files、
4親Workerと46/406段の2子Worker（全notice含む）が以前の現候補と全byte一致した。
private markerによるPages guard拒否も維持。復元元でscripts21/domain623/UI287/型/buildが成功し、
test後もarchived source647fileの全SHA一致を確認した。

HF offline候補05はEigen source提供案内を維持し、app sourceと対応review/binding文書を
新archiveへ更新した（42files/2,715,602,232B）。元13payloadは位置/identity保持、モデル複製0。
新sourceと文書は全SHA照合。古いsource候補は改変していない。
復元node_modules/source・configured core・Workerの再生成可能な重複200,359,936Bを
整理し、archive/source/manifest/logと元候補は保持した。

同OS・固定captured Worker依存での再現であり、native compiler/WASM/第三者source閉包、
補助overlay全資産の再生成、HF公開・実配信や新推論の証明ではない。
根拠: validation/2026-11-04-current-public-entry-source-archive-08.json。


## 現標準入口のGPU2構成保存・HR途中中止と再実行

同じsourceId `eb9f04fd…`/artifactId `19722622…`をAMD RDNA3/Chrome155で検証した。
前のCPU試験と同じ専用Chrome resolver/SPKI方式のprivate TLS配送で、本体/Worker/CSP/
モデルURLは変更していない。実HF/CDN/Pagesの受入とは区別する。既存raw model/runtime143routeと
必要3ZIPを全SHA照合し、配信server起動時に本体111files/model146routeを再検査した。
転送は標準tar streamでローカル一時tarを作らず、モデル原本は複製しない。

通常UIからGPUを明示選択、同じ1086×1448合成人物を処理してnative PNG保存:

- MODNet GPU: 2,297,969B、SHA `aa19ae030563443838d3cda0901e832aa961fd368cd93d3df923b62e2f597b85`。
- HR＋ViTMatte GPU（補正ON）: 2,180,411B、SHA `5b583f097bec35e4cd4ad70eb0c031a850ba26df0629fc6ebfc0a5de251f1f36`。

両方とも以前の固定GPU候補と全byte一致。HRの公開子Worker実ロードも確認した。
同じbrowserでモデル切替→写真保持/旧保存リンク消去→HR4/46段時点で中止→idleへ復帰。
元写真のpreview Blob URL/1086×1448は保持され、取消した結果の保存リンクはない。
同じ写真で全HR46段＋Matteを再実行しnative保存したPNGも、中止前のHRと全byte一致した。
全期間のZIP GETは初回3件だけで、中止/再実行時のモデル再取得なし。最終cacheは142files。

監視2544sample/interaction499.230秒、正常finished/errorなし/runDoneあり。
RSS合計最大5,139,386,368B、cgrouppeak5,040,721,920Bで5GiB枠内。GPU増加最大
4,100,526,080Bで4GiB枠内、ホスト空き最小25,390,350,336B。RSS共有page重複等があるため、
最小RAM要件や全端末の保証にはしない。browser最終errors空、server90件は全GET200/bodyなし。
これらの通信記録は部分観測で、写真非送信の全受入へは拡張しない。

観測helperがHR→Matteの主ボタンlabel変更を終了と誤認したため修正し、同じ進行中runの
完成PNGを回収した（再起動/推論の再開始なし）。warmでも確認dialogが出ることを観測timeout後に
確認し、不足0MiBの表示を確認して続行。いずれもproduct障害として数えない。
終了後、専有profile/app/3ZIP複製/TLS鍵と証明書/3native downloadを2,643,955,712B整理。
proxy/tunnel撤去、container停止/Gufo0/GPU client0/GPU基準169,684,992Bへ復帰、
モデル原本とevidence54・localPNG/receiptを保持した。

残る現CPU高画質、CPU/Matte途中中止、実Hub/Pages、一般品質/実機UX/印刷等は別の未受入。
根拠: validation/2026-11-04-public-entry-gpu-save-and-cancel.json。


## 現標準入口のHR＋ViTMatte CPU取得・推論・保存

同じsourceId `eb9f04fd…` / artifactId `19722622…`のCPU高画質を、GPU無効・
最大2 WASM thread/CPUQuota200%・8GiB cgroup/RSS・host reserve3GiB・600秒枠で実行。
前GPU試験と同じ専用Chrome resolver/SPKI private TLS方式で、公開本体/Worker/URL/CSPを変更しない。
既存raw model/runtime1101routeをstat照合、転送111appfiles/2ZIPとserver起動時1103model-routeを
全SHA検査。大きいmetadataのSSH単一引数上限に当たった事前stat検査は100件ずつに分け、
モデル試験を始める前に解消した。

CPU高画質の警告・旧2000×2000条件の約6分22秒表示を確認し、空cacheから通常UIで
取得確認→HR406段→ViTMatte3phase→前景色→PNG生成→native保存まで完遂した。
1086×1448合成人物の保存PNGは2,180,305B、SHA
`81f2b8456f6749ba90bd85e18274b5e33c94611b7817c378f9fdd859cfe3a30f`で旧固定CPU結果と全byte一致。
確認ボタンから結果観測まで329.815秒（約5分30秒）。private配送/検証/compile/処理/export/pollを
含み、写真設定とnative保存を除く。この素材/条件の値で、実Hub配信や一般速度保証ではない。
既存UI参考値の条件とは異なるため注意書きを置換していない。

監視1672samples/interaction332.085秒は正常finished/errorなし/runDoneあり。
RSS合計最大6,824,886,272Bで8GiB枠内、host空き最小23,272,910,848B。
GPUは起動時の1,937,408B増加まで。全cache1100files、model ZIP GET2だけ、
公開stage-worker実ロード1回、server26GET200/bodyなし、最終browser errors空。
部分通信観測を写真非送信全体の受入へは広げない。
専有profile/app/2ZIP複製/certkey/nativeDLの2,817,110,016Bを整理し、proxy/tunnel撤去、
container停止/Gufo0/GPU client0/GPU169,684,992Bへ戻した。原本/必要payload/evidence55は保持。
現4構成のnative保存結果は揃ったが、CPU途中取消/実Hub・Pages/一般品質/実機UX/印刷等は未受入。
根拠: validation/2026-11-04-public-entry-cpu-high-save.json。


## HF非公開ステージングの固定commit

モデル配信の実接続へ進むため、予定名`otama/image-studio-browser-models`を非公開で作成。
offline候補05の42fileを元にREADME/SOURCE_AVAILABILITY/MODEL_FILESの3文書を
private staging表記へ整え、REVIEW_INVENTORY.jsonを加えた43file/2,715,614,704Bを
1commitへ配置した（Hub既定.gitattributesを含むrepo全体44file）。
固定commitは`cb7fac5196a06a82c85ee3a82fc1ed8d852f2fb5`。

upload前に全入力を実読SHA検査し、元候補inventoryは既存receipt SHAへ照合。
create_repo(private=True,exist_ok=False)で作成した所有repoの初期headを記録し、
parent_commitで競合を防止、native HfApi.create_commit(num_threads=1)をCPU1/nice19で使用した。
全remote sizeとLFS SHA256またはgit blob SHA1が一致し、upload中にlocal inputは変更なし。
同commitから認証付きでREADME/source案内/28,747,738B WASM/4,075,744B Eigen sourceを
再取得し全byte/SHAを確認。大きいmodel ZIPは不要な再downloadをせずremote LFS SHA/sizeで確認した。
匿名READMEアクセス401、repo private=true。browserへtokenは渡していない。

最初のcreate_commitはREADMEのlicense_linkが相対pathだったため、公式metadata検査で
preupload前にValueErrorとなった。公式ModelCard.validateで同じ失敗を再現し、
license_linkをHTTPSのrepo LICENSES.mdへ修正、公式検証を先行させて再開した。
新repoを再作成せず「今回作成したprivate/同初期head/既定.gitattributesのみ」を確認した上で
同じ所有repoへcommitした。権限変更やmodel contentの変更はない。

private staging用client cache2,482,176Bとreadback TemporaryDirectoryを整理。
元token/global credentialをcopy/改変せず、原本/source/文書/receiptとremote固定commitは保持。
このcommitは認証が必要で、匿名browser配信/CORS/COEP/Pagesや公開承認の証拠ではない。
以後は実commitとzip/runtime/source/noticeを結合し、公開条件を確認して実previewへ進める。
根拠: validation/2026-11-04-hf-private-staging-commit.json。


## 通常npm依存からの実Hub commit結合

`tools/browser-build`に既存4固定ライブラリのnpm lockを配置し、親/子builderの両方が
共有のbuild dependency resolverで利用できるようにした。Node ML entrypointを実行せず
browser bundleだけを使い、既存SHA/全文notice検査を保持する。CIへnpm ci/resolve/auditと
変更path/syntax、新unit testを接続。trunk Preview/安定タグproduction条件は変えていない。

48packageのfresh installとaudit0、domain626/UI287/scripts21/型/build成功。
6Workerの実行JSは同policyの旧候補と全byte一致。生成LEGAL.txtはnpm package名を含む
esbuild標準表記に変わるため全byte一致とはせず、元著作権block保持と全文notice一致を確認した。
旧stage-builder改ざんtestは、新共有resolverの成立条件を満たすfixtureへ更新し、
改ざんJSが資産生成前に拒否される元の検査を保持した。

実private Hub commit `cb7fac5196a06a82c85ee3a82fc1ed8d852f2fb5`をlive参照し、
5ZIP/WASMのremote SHA/sizeを再照合。5880 URL fieldを実repo/commitへ差し替え、
2子の新descriptorを4親policyへ接続して標準main候補をbuild。111files/20,615,715B、
sourceId `4717f5d5…`、bindingId `a67433c9…`。93assets/4choices/6roles/5packsと
app config digestが結合し、private markerによるPages拒否を維持した。
前の実推論は`eb9f04fd…`の固定候補へ帰属し、この新候補を実推論済みとは扱わない。

6資源の実resolver metadataはcommit/SHA/size一致、redirectは全てus.aws.cdn.hf.co。
署名付きCDN HEADは全200、Origin=image-studio.otama-playground.comにACAO=*を返した。
signed URL/tokenは保存せず、これは匿名HF GETやbrowser CORS/COEP/Pagesの受入ではない。
通常npm buildの背景設定はnullのまま。公開用入力/asset assemblyの所有とCI呼出し、
公開条件/匿名配信・実browser・新source releaseを閉じる必要がある。

新node_modules/npm cacheと重複再生成出力865,652,736Bを整理し、lock/source/logと実Hub候補を保持。
元captured依存/モデル/証拠は変更せず、remote/Gufo/公開visibility/deployも変更していない。
根拠: validation/2026-11-04-standard-worker-dependencies-and-hub-binding.json。

## 通常buildでのWorker・資産組立

`npm run build --prefix web`は`web/scripts/build.mjs`を通る。
`web/background-release/`がなければ従来の手動編集版を作る。存在する入力が不正な場合は失敗し、
背景機能なしの版へ黙って切り替えない。CIも同じコマンドを使うため、採用済み入力を配置した後は
別のCI用組立処理やモデル取得用tokenを必要としない。

入力directoryの`release.json`は次の必須fieldを持つ。ファイル指定はそのdirectory内の相対path。

| field | 内容 |
|---|---|
| `config` | 構造ゲートを通る4選択の背景設定JSON |
| `catalog` | 5個のZIPと全memberのbytes/SHAを持つモデル一覧JSON |
| `parents` | `modnet-cpu`、`modnet-gpu`、`hr-gpu`、`hr-cpu`のpolicy JSONへの対応 |
| `stages` | `cpu`、`gpu`のHR子Worker policy JSONへの対応 |
| `resize` | 親Worker生成に使う固定resize WASM |
| `assets` | `static/`内の補助資産の公開path・bytes・SHA一覧 |

`tools/browser-build`のlock済み依存を`npm ci --prefix tools/browser-build --ignore-scripts`で用意する。
組立処理は既存の子Worker builderを2回、親Worker builderを4回呼び、生成された子のdescriptorを
HR親へ接続する。4親のURLを本体設定へ反映し、catalog/policy/reportと生成bytesを照合してからViteへ渡す。
一時出力は終了時に整理する。モデルZIPや重み本体は読み込まず、ネットワーク取得も行わない。

検証用に入力directoryを別置きする場合は、repo rootで次のAPIを使える。
入力・出力の相対pathは呼出し元の作業directoryから解決する。

```js
import {buildBrowserApp} from './web/scripts/build.mjs';
await buildBrowserApp('/path/to/review-input', '/path/to/new-candidate');
```

別置き入力は通常の`web/background-release/`としてsourceIdへ含まれない。
本体に渡した設定は`background-release.json`のconfigSha256、資産は組立中のbytes/SHA検査で照合する。
sourceIdだけで別置き入力の同一性を主張しない。リリース採用時は既定directoryへ置き、
入力も含むsourceId・対応source archive・配布inventoryを更新する。

入力に`LOCAL_VALIDATION_ONLY.json`があれば同内容を出力へ保持し、既存Pages guardで拒否する。
マーカーを外すだけで公開承認済みにはならない。固定commitの匿名取得、配布条件、
実previewでのCSP/COEP・Worker・推論・保存・復帰の受入は引き続き必要。
2026-11-04の実入力試験では6Worker/93資産、111出力fileを組立・照合した。
根拠: validation/2026-11-04-configured-worker-build-pipeline.json。

## 固定sourceと採用入力の組合せ（2026-11-04）

source archiveの中へ、そのarchiveを置くcommitへのURLを埋め直し続ける必要はない。
コードsource10（固定commit `7f8d4f5f…`、SHA `558aa25d…`）と、別のbuild-input bundleを固定する。
入力bundleは48file/2,040,134B、SHA
`addacf238a7d87d8efca122893a208cf4f3e02a428be906af798023186f74404`。
モデルURLは実体不変の`cb7fac51…`、source/notice案内はsource10の`7f8d4f5f…`を参照する。

両archiveを同じdirectoryへ展開して全manifestを検査し、source側で以下を実行する。

```bash
npm ci --prefix web --ignore-scripts
npm ci --prefix tools/browser-build --ignore-scripts
cp -R ../release-input/input web/background-release
node --input-type=module -e 'import {buildBrowserApp} from "./web/scripts/build.mjs"; console.log(await buildBrowserApp())'
```

この配置では既存sourceId計算に採用入力48fileも含まれる。
復元先で得たsourceIdは`5cceca95…`、2回の既定buildの全111fileがbyte一致した。
archive690source memberと入力48memberはbuild後も全SHA一致。
`npm run build`の最終Pages guardはprivate markerを拒否するため、ここではassembly APIまでを検査している。
markerは保持し、guardの拒否も別途確認した。作業repoの既定入力へはまだ採用していない。

コードsourceと入力bundleの両SHA、モデル/source commit、app config digestと全配布file SHAを
pairing reviewへ記録する。入力更新をコードsourceの更新と混同せず、実際の最終配布物との一致を検査する。
bundle/対応表/REPLAYはHF private commit `0ef04c07…`へ配置し、認証readbackでSHA一致を確認した。
新sourceId `5cceca95…`ではGPU Matte中止→写真/マスク保持→補正のみ再実行→nativePNG基準一致も確認。
CPU等の現候補受入・匿名配送・Pages・公開は引き続き未完。
根拠: validation/2026-11-04-fixed-source-default-input-pairing.json。

### ORTの上流既定toolchainの補足表示（G06、2026-11-04）

ORTの固定commit `41d4d61f14b9c1dd0b2ccda1e9b85dd415fd0496` の
`tools/ci_build/build_args.py` と `.gitmodules` はEmscripten 4.0.23を既定にする。
Emscriptenの固定commit `7a5d93b50f6a3a35e85a0d2fc9e667b8498e6aed` から、
Emscripten/compiler-rt/musl/libc++/libc++abi/libunwindの全文6件を取得・SHA照合した。
SDKのMIT表示だけで生成コードへ入る各runtimeの条件を代替しない。

Pagesの既存OpenCV補助資産には同一6全文があり、重複追加は不要。
単独のHF配布候補には `licenses/runtime/emscripten/4.0.23/` と
`TOOLCHAIN_NOTICE_REVIEW.json` を補った（offline候補09、公開/アップロードなし）。
上流既定値の確認は、公式ORT WASMの実ビルド環境・link入力の証明ではない。
全componentが実際にlinkされるとの主張や、完全toolchain closure・配布承認には使わない。
旧source10と入力pairは現UIより古いため、補足表示を含む最終source/pairの固定は引き続き必要。
検証範囲・固定URL・全文SHAは
[toolchain補足の検証](validation/2026-11-04-ort-toolchain-notice-supplement.json)を参照。

### UI修正後source11の非公開固定ペア（2026-11-04）

現在のレビュー用ペアは以下。先行source10の再現証拠を現UIへ流用しない。

- ソースcommit: `336703bb733e2ca0f093b8b9854dcb46b1c2c6e8`、`source/app-source.tar.gz`、SHA `2c39f7b74eae2044660f3c8b48221855ca12ac4692661ef3a99a17c176a2133d`。
- 入力/再現手順commit: `0f4361954a0cdbabc78924bccc6239c4e6dc44aa`、`source/app-build-input.tar.gz`、SHA `8d9dead530a382f786078a82b845995afb7e2cfc58e4dcee27babf83d4472646`。
- モデルcommit: `cb7fac5196a06a82c85ee3a82fc1ed8d852f2fb5`（変更なし）。
- 既定配置のsourceId: `sha256:cd1721ee7b4f88f22a01fc67f7dd75e65796d645b79c59e49275abc27392af14`。
- 全111fileのartifactId: `sha256:9afc561382e32b4f104590ba3163eb1d0b0d5e5d29ae69330c9ae3e0d5820242`。

固定ソースを復元し、入力48fileを `web/background-release` へ配置する手順で
全111出力を2回同一bytesで再現。入力のsource/noticeリンクはsource11commitへ対応する。
HFはprivateを維持し、認証readback一致・匿名401を確認。private markerを保持し、
Pagesguard拒否も維持する。これは公開/実推論/実機受入ではなく、作業repoの既定採用も未実施。
[対応ペアとremote検証](validation/2026-11-04-source11-private-pairing.json)参照。


### source14 GPU HR＋ViTMatte 横長2000×1000の実保存

同じ7677/c2bd候補111fileで、既存合成入力をpadした横長2000×1000を通常UIから処理しnative透過PNGを保存した。1,847,649B/SHA `4332e207554696712e396341ec80d901401a9001b834b14548d9829a38d391a5`。結果観測86.561秒はcold local取得・準備・HR/Matte・PNG生成・5秒pollを含み、photo setup/native保存時間と実HF速度は含めない。PNG CRC/寸法/透明・半透明・不透明の存在、不透明画素の元RGB不一致0を確認した。旧Windows横長出力とはbyte不一致、alpha最大差7/MAE0.0011305/2058画素差を観測。新画質閾値や一般品質の合格へ転用しない。

RSS最大5,106,696,192B/cgroup最大4,519,538,688B、GPU最大4,416,020,480B（基準169,684,992Bから増加4,246,335,488B）、host空き最低25,372,209,152Bでguard内。GPU増加4GiB上限との差は48,631,808Bに留まり、他端末の余裕や2000²対応を保証しない。model ZIP2GETのみ、記録GET全200/bodyなし/browser error0。privateTLS fixtureであり実HF/Pagesではない。

完了後owned profile/app/ZIP/input/cert/一時download計2,587,873,280B撤去、browser/proxy/tunnel終了/containerStopped/Gufo0/GPUclient0/VRAM169,684,992Bへ復帰。原model・合成原本・結果PNG/recipe/証拠は保持。[現候補横長native](validation/2026-11-04-source14-gpu-landscape-native.json)。crop/printは今回実行せず、一般品質・全shape・Windows/NVIDIA/iOS実機の受入は残す。


### source14 GPU HR＋ViTMatte 最大正方2000×2000は4GiB増加枠で停止

同じ7677/c2bd全111fileを保持し、既存許諾済み合成正方入力2000×2000/SHA `ce155dd42fb9e9005e03834fb1f0da6eddfcec1ccbdd4b3c4ba0fb4b5fc4b293`を通常UIへ渡した。HR46段後に補正工程へ進んだが、GPU増加4GiB枠を越え、外部watchdogがbrowser/serverを停止。runDoneなし、nativePNG/保存結果なし。結果を成功・アプリ内の通常取消・物理OOMと扱わない。

全sampleのGPU最大6,859,153,408B、基準169,684,992Bから増加6,689,468,416B（約6.23GiB）。RSS最大5,276,487,680B/cgroup最大4,554,080,256B/host空き最低25,526,534,144B。GPUguardは0.2秒pollで超過後に停止するため、大きなallocationで4GiBを瞬間的に超えない保証はない。この観測値を完走に必要な最小VRAMとも解釈しない。

owned profile/app/2ZIP/input/cert計2,593,308,672B撤去、browser/proxy/tunnel終了/containerStopped/Gufo0/GPUclient0/VRAM169,684,992Bへ復帰。原model/原入力/全証拠を保持。[最大正方の資源停止](validation/2026-11-04-source14-gpu-square-resource-stop.json)。

未解決: GPU HR＋Matteの2000²完走条件。横長2000×1000やportrait成功を全shapeへ継承しない。元の上限を下げたり画素を減らして最大寸法要件を置換せず、同じ出力条件を保った資源対策または別途許可された資源枠で再確認する。上限超過は公開前の対応条件・注意書きの判断へ反映が必要。今回production/HF固定pairを変更しない。


### 正方資源停止の時系列切分け・次試験の準備

HR46表示直後とMatteモデル読込表示の後の対応sampleはGPU約175MBであり、HRの数GiBがその時点で残った状態ではない。最後の0.201508秒間にGPU使用量が3,704,209,408→6,859,153,408B（3,154,944,000B増）となりguard発火。UIは5秒pollのため、この割当がsession準備か推論開始後のどのoperatorかは判別できない。serial-inferenceはHR dispose応答後にtrimap/Matteへ進む既存実装で、測定と矛盾する同時保持を推定して不要なWorker分割・再実装を始めない。

[停止時系列](validation/2026-11-04-source14-gpu-square-stop-timeline.json)。同じ2000²/同じ固定pairのGPU増加8GiB案を別private手順として準備し、guard境界と既存RAM/host/GPU空き停止条件の5assertを確認した。RAM5GiB/host reserve3GiB/GPU free1GiB/600sは維持。既定4GiB枠を変えるため利用者判断を質問済み、承認前の転送/起動/再推論はしない。大きい割当によるsample間超過は引き続きあり得る。


### source14 loaded tabの配信元停止：保存済みfileと新処理を区別

現7677/c2bdのMODNet CPUで初回透過PNGをnative保存した後、app HTTP/private model TLSを兼ねる配信serverを停止した。両originへのcache:no-store HEADがnetwork failureとなることを確認し、既存Blob linkからの再保存は初回と全byte一致した。

一方、同じ写真での新しい処理は「モデルのダウンロード見積り約0MiB」でも実行用Worker/program取得に接続が必要なため失敗した。これはモデル保存とプログラム利用可能性が別という既存表示に沿う。写真Blob URLは不変・busy解除・安全なerror1件で、server復旧後の明示再試行からnativePNGを再保存できた。最初・配信停止中の再保存・復旧後の3fileは1086×1448/2297950B/SHA8ef80121…で全byte一致、modelZIPのGETは全期間1回のみ。新しい処理開始で旧linkは退役するので、失敗後に古いlinkが復活する保証にはしない。

GPU無効、RSS最大1,990,516,736B/cgroup最大820,592,640B/host空き最低28,361,674,752B、GPUは基準169,684,992Bから増加なし。guard正常終了・未捕捉browsererrors0。owned profile/app/ZIP/cert/一時DL84,754,432B撤去、proxy/tunnel終了/containerStopped/Gufo0/GPUclient0へ復帰。

[配信停止と復旧のnative証拠](validation/2026-11-04-source14-loaded-origin-outage-native.json)。1MODNet CPU/1合成画像で、全ネットワーク遮断・offline起動・HR/GPU・匿名HF/Pagesの合格へ拡張しない。オンライン起動/独自SWなしという提供方針を維持する。


### source14 GPU最大2000²：承認済み8GiB増加枠でも停止

利用者の「OK」を既存のGPU増加8GiB/1回案への了承として明示して再開。同じ7677/c2bd/入力ce155dd4…/2000×2000、RAM5GiB/host予備3GiB/GPU空き1GiB/600sを維持し、GPU増加だけ4→8GiBにした。live Gufo0/claim空/containerStopped/host空き29,245,841,408B、evidence82未使用を確認し、全111appと2pack/inputの転送SHA一致後に実行した。

HR46→Matte準備を経て実UI「輪郭を補正しています」まで到達したが、GPU増加8GiB枠を超え外部watchdogが停止。PNG/runDoneなし。最大GPU9,869,471,744B、基準169,684,992Bから増加9,699,786,752B（約9.03GiB）。RSS最大5,307,142,144B/cgroup最大4,550,504,448B/host空き最低25,352,544,256B。GPUは0.2秒pollなので8GiBを超えたsampleを観測して停止する方式で、硬いGPU割当上限ではない。DRMのGPU使用量counterであり、全端末の独立した物理VRAM必要量や完走の最低容量を証明しない。

今回許可された1回を消化し、追加枠/再試行/縮小代替は実施しない。2000²のGPU完走条件はなお未受入。4GiBでの停止と今回8GiBでの停止を別に保持し、既存portrait/横長成功を取り消すものではない。最終対応条件と資源対策は、この結果を含めて判断する。

owned profile/app/ZIP/input/cert計2,594,213,888B撤去、browser/proxy/tunnel終了/containerStopped/Gufo0/GPUclient0/VRAM169,684,992B復帰。原model/原入力/全証拠は保持。[8GiB試験の停止記録](validation/2026-11-04-source14-gpu-square-8g-resource-stop.json)。production/HF/Pages/DNS変更なし。
