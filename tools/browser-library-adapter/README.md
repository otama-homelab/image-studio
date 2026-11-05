# ライブラリ資源取得の薄いpolicy adapter

Transformers.js等の`env.fetch`/`customCache`へ接続する診断用実装。
HTTP取得・保存先・model loaderそのものは既存ライブラリ/Cache Storageへ委譲する。
本番`web/`やモデル対応の完成ではない。

```js
const policy = createResourcePolicy({
  files: selectedManifestFiles, // 固定absolute URL、bytes、sha256
  fetchImpl: nativeFetch,
  cache: nativeCache,
  makeHasher: approvedIncrementalHasherFactory,
  signal: operationAbort.signal,
});
env.fetch = policy.fetch;
env.useCustomCache = true;
env.customCache = policy.cache;
```

hasher factoryは`update(Uint8Array)`と`digestHex()`を持つ実装、またはそのPromiseを返す。
新しいhash algorithmをここで実装しない。小テストはNode標準cryptoを注入する。
`hash-wasm-factory.mjs`は既存hash-wasmの`createSHA256`を接続する。
4.12.0公開bundleで分割入力・独立instance・実AutoConfig接続を確認済み。
ブラウザ/CSP実機確認、配布時のC由来notice監査と本番依存への固定は残っている。

- manifestにないfetch、GET以外、body付き要求を拒否。HTTPS（または開発loopback）だけを許可する。
- transportにはAccept以外のcaller headerを引継がず、credentials=omit、通常はredirect=error。
- Hugging Faceの`/owner/repo/resolve/<40桁commit>/file`のみredirect=follow。最終応答は同じrepo/commit/fileのresolve-cache URLまたは実測した`https://us.aws.cdn.hf.co/xet-bridge-us/`に限定し、bytes/SHA検証を維持する。mutable revisionは拒否。署名URLを保存キー/eventへ渡さず元の固定URLでcacheを照合する。
- browserのconfigured buildではCSP connect-srcもHubと確認済みCDNに制限し、CORS/COEPを実測する。fetchのfollowは中間転送先の独自検査ではない。別CDN/地域は未対応として失敗させ、検証後に追加する。現在の公開buildには外部接続許可を追加していない。
- network/cacheのbodyを背圧付きで読み、bytes/SHAを検証してからstream完了を通知する。全量bufferをここでは作らない。
- 読みが止まった場合もAbortSignalでreaderをcancelする。拒否したResponseの未読bodyもcancelする。
- customCacheはnative match/putへ委譲し、保存成功はbody消費・SHA検証・put完了の後だけ記録する。
- cache quota/書込失敗は固定codeへ変換して保持する。元の例外文字列をeventへ送らない。
- library内部の未知cache lookup keyはmissとして返す。未知keyのputやfetchは拒否する。

`model-archive.mjs`は配布用ZIP_STOREDを元のresource cacheへ取り込む。
アプリ所有のarchive URL/bytes/SHAと元file name/URL/bytes/SHAを渡し、
既存fflateの`Unzip`を注入する。全fileのcacheをstream再検証して揃えば通信しない。
不足があればarchiveを1回取得し、4KiBずつparserへ渡し、保存完了後に次entryを開始する。
archive全体と各entryを既存resource-policyで検証し、未知/重複/圧縮entryを拒否する。
有効な途中cacheは中止後も残るが、次回不足がある場合はarchiveの先頭から再取得する。
全archiveのRAM展開、独自ZIP decoder、独自storeは作らない。
モデルWorkerはtrusted releaseにarchive記述がある場合だけ、通常モデル準備の前に取り込む。
受信commandのarchive記述は採用せず、埋込trusted policyから固定copyする。
既存policyにはまだarchive記述を加えていないため、配信packの生成・設定とUIの容量/進捗対応、
native browser CacheStorage/quota/実配信は未受入。
取り込み後も既存の全required resource準備gateを省略しない。

`getState()`はnetworkVerified/cacheVerified/storedを区別する。
ライブラリがquota warning後にbufferを返しても、アプリはstored=falseを準備成功へ変換しない。
model/sessionが先に生成され得る点は未検証で、アプリ側の失効/解放処理も必要。
削除/更新/進捗UI、キャッシュの永続保証、model自身の読込・推論はこのadapterの担当ではない。

小テスト:

```bash
node --test tests/test_library_resource_policy.mjs
```

`tools/check_transformersjs_resource_policy.mjs`は実配布4.3.2 bundleのAutoConfigへ接続し、
合成87byte JSONとメモリ内cacheで動作を確認する。GPU/session/実HTTPは使わない。
Node向けのprivate JS backend注入を使う限定構成で、browser/大容量model/cache永続性の検証ではない。
library側のarrayBuffer/cloneやnative Cache Storageの追加コピーまで低メモリと保証しない。

## Worker失敗応答の境界

`worker-failure.mjs`はD03のerror eventに許可したfieldだけを設定する。
`runWorkerOperation`は例外のmessage/name/stack/独自fieldを読まず固定runtime-errorを返す。
特定codeはアプリが明示確認した条件にだけ`workerFailure`で指定し、例外の文字列から推測しない。
渡すenvelopeはmain側operation registryが発行したIDだけに限定し、写真名等から生成しない。
成功valueの検証やpostMessage/失効判定/Worker終了は呼出側の責務。
このhelperだけではライブラリのconsole出力は抑止されないため、env.logLevel設定も必要。
本番Workerの実装・全ログ監査の完了とは扱わない。

```bash
node --test tests/test_worker_failure.mjs
```

## alphaの8bit化

`alpha-u8.mjs`はFP32乗算とties-to-even、clip、補正時のtrimap anchor復元だけを担当する。
resizeは既存library utilityへ委譲する。shape/plane寸法/所有権は呼出側で検証する。
人工小入力での確認であり、画像全体の品質受入ではない。

## 前景色と背景合成

`foreground-rgba.mjs`は推定済みFP32前景色の切り捨て変換・alpha維持・不透明RGB復元を行う。
`composite-rgb.mjs`はstraight RGBAを不透明RGB色へ合成する。
前者は推定器を含まず、後者は任意の背景alphaや色profile変換を扱わない。
Pillow参照fixtureの再現は`make_pillow_composite_fixture.py`と`check_pillow_composite.mjs`を使う。

`matte-output.mjs`は固定Baseの32倍数paddingを検証・切除し、alpha変換へ接続する。
入力背景画像の上限2000pxを検査し、結果shapeをresizeで補正しない。
`tests/test_matte_output.mjs`と実processor＋人工出力の確認を用意した。

## 準備完了の採用判定

`prepared-model.mjs`は既存load関数の戻り値を、操作の有効性と必須資源の保存/照合状態で判定する。
保存失敗/中止/旧操作ではdisposeを待って拒否する。独自model loaderは実装しない。
load途中の失敗や解放失敗は所有Workerを終了し、本番controllerから再利用しない。
実GPU/本番Workerの確認は未完了。単体は`tests/test_prepared_model.mjs`。

`preparation-source.mjs`はprepare要求をアプリbuild由来の信頼済みrole manifestと完全照合する。
返却するdescriptorはtrusted側から作り、requestのURLや可変objectをloaderへ直渡ししない。
信頼済みmanifestのschema/配信origin/bytes照合やWorker/controller実装は別に必要。

`worker-event.mjs`はmain側の現在operationと応答を照合し、stale/invalid/acceptedを返す。
acceptedは既知fieldだけで再構成し、有効alphaのbufferは複製せず所有権を渡す。
staleと不正応答の復旧を区別し、controller側でregistry登録/Worker終了を実装する必要がある。
単体は`tests/test_worker_event.mjs`。

## 単一Worker client

`worker-client.mjs`は既存Worker APIへ委譲し、1要求制限、応答判定、失敗/中止時終了、
新Workerでの明示再準備を担当する。createWorkerはapplicationが指定する。
registry/manifest/画像pipelineや実Worker scriptは含まない。
`tests/test_worker_client.mjs`は人工Workerだけで実行できる。

`inference-input.mjs`はinfer入力の寸法/形式/key/長さを検証し、作業用RGB/alphaのtransfer listを作る。
clientはinfer要求でこれを必ず使う。applicationはregistry原本のcopyを渡す必要がある。
構造検証だけで原本所有権は判別できない。`tests/test_inference_input.mjs`に実structuredClone転送例を含む。

`worker-handler.mjs`はlibrary-resources候補の受信側で、固定資源・入力・出力を検証する。
prepare/inferの実処理はcallbackに渡し、本番では既存loader/processorと保存gateへ接続する。
`tests/test_worker_protocol_roundtrip.mjs`は実structuredCloneを使う同一processの往復確認で、
実Workerや実モデルの受入ではない。

待機中のWorker故障はclientの`onWorkerFailure({workerId, code})`へ通知する。
applicationは保持するreadyWorkerIdと照合し、画像を消さずmodel準備状態だけ失効させる。
handlerのprepare callbackには`onDeviceLost`を渡すが、実device.lostへの接続は選定runtime側に必要。
通常dispose中の意図したdevice破棄は障害通知を抑止する。

`transformers-prepare.mjs`は固定role別の既存from_pretrained API、取得policy、保存gateを結合する候補。
返すhandleのmodelを推論へ使い、disposeではモデルとruntimeを順に解放する。
configureRuntimeの実device/asset固定実装と本番接続は未完了。テストは人工class/ownerを使う。
複製Responseのquota時にcancel完了を待つとtee siblingと循環するため、失敗時cancelは要求だけ行う。

`tests/test_worker_thread_transport.mjs`は小さい実Node threadを逐次起動し、
client/handlerの実postMessage転送と未捕捉エラーを確認する。終了Promiseまで待機する。
thread内は人工処理だけで、ブラウザ・GPU・モデル検証ではない。

`image-registry.mjs`はmainの画素所有権を管理する。登録はbufferを消費し、metadataだけを返す。
推論用にはinferencePlanesで独立copyを作り、返却alphaも採用後に登録する。
所有者集合の最後のreleaseで参照を外す。物理RAM回収やdomain revisionの採用判定は別。
`tests/test_image_registry.mjs`と実threadテストで小さい所有権経路を確認できる。

`alpha-commit.mjs`は現在domain keyを登録直前に確認し、最新alphaだけをregistryへ登録する。
補正変更はstale、写真変更は破棄、背景色だけの変更ではalpha保持という既存規則を適用する。
Worker中止や他工程の失効はapplicationの責務として残る。実threadのrevision競合例をテストに含む。

`inference-operation.mjs`は入力keyと独立した操作意図を管理し、中止後の遅延commitを防ぐ。
全HR/補正pipelineのexecuteと所有資源のcancelOwnedをapplicationから接続する必要がある。
旧操作の後始末は新操作へ干渉せず、解放待ち中の新規処理を拒否する。
`tests/test_inference_commit_integration.mjs`は同じ入力keyでの中止/再実行競合を確認する。

`serial-inference.mjs`はHR→dispose→trimap判定→必要時matte→disposeを逐次制御する。
makeTrimapと実Workerモデルbindingは接続が必要。補正失敗でHR単体へ暗黙fallbackしない。
一時HR assetは成功/失敗で解放するが、obsolete処理から共有clientを終了しない。

`opencv-trimap.mjs`はready済みOpenCV.jsへellipse/threshold/erodeを委譲する候補。
module自体はWASMを読み込まない。人工cvによる単体4件は実morphologyの数値証明ではない。
4.11系候補bundleの初期WASM memory宣言が128MiBのため、この段階では初期化していない。

`png-export.mjs`は既存PNG encoder/CRCへ委譲し、固定出力形式とDPIだけを管理する候補。
pixelはCanvasへ戻さず、IDATを再圧縮しない。用紙の固定寸法はencode前に確認する。
`tests/test_png_export.mjs`は小さい公開fixture、`check_png_export.mjs`はprivate固定codecを使う。
本番encoder Worker/export job/download/PDFの接続は未完了。

`export-job.mjs`はregistry pinと出力依存keyを管理し、同時encodeを1件に制限する。
中止後もencoder終端までbusyを維持し、結果を採用しない。PNG/PDFのreadyは別slot。
getReadyで再びcurrent keyを確認するが、download URL作成/クリック時にも照合が必要。
本番のencode callbackは専用Workerへ接続する。実PDF/Blob URL/UI接続は未完了。

`download-links.mjs`はexport jobのgetReadyへ接続し、ownerごとのリンク共有、
クリック直前の再照合、開始済みdownloadの60秒猶予、終了時全revokeを管理する。
beginDownloadの戻り値でのみUIの明示clickを行い、closeをpagehideへ接続する必要がある。
単体は仮想時計で、実Node Blob URLの局所読出しも確認する。ブラウザ保存の受入は未完了。

`pdf-export.mjs`はpdf-libへ同一用紙PNGを埋め、画素数×72/300のページを作る。
`paper-contract.mjs`をPNG/job/PDFで共有し、画像寸法の不一致を拒否する。
`check_paper_pdf.mjs`はprivate固定codecと人工L判で実生成/registry/jobを確認する。
専用Worker、他用紙の実サイズ、browser/save dialog/実印刷の受入は未完了。

`export-worker-client.mjs`/`export-worker-handler.mjs`はexport jobとcodecを別Workerで接続する候補。
export-transportで入出力を再検証し、部分view/Node Bufferは必要なbyteだけ転送する。
終了Promiseをawaitしてからreadyを返す。ブラウザentry/bundle/UIの接続は未完了。
`check_export_worker.mjs`はprivate固定codecとNode専用fixtureで実PNG/PDFを逐次確認する。
heap設定値は実効heap/RSS上限の保証ではない。

`browser-export-worker.mjs`はブラウザ用entry候補。`build_browser_export_worker.mjs`が
private依存から自己完結bundleを作り、build serviceを停止する。
`check_export_worker.mjs`の第3引数へbundle pathを渡すと、Node固有global/WASM/
動的code生成なしの制限VMで実codecを確認する。実ブラウザ受入の代用ではない。

`save-actions.mjs`は保存controlのheadless状態/操作候補。export jobとdownload-linksへ接続し、
生成とdownloadを分離する。job IDで中止を限定し、クリック直前に出力選択も確認する。
settings/source変更時reconcile、control破棄時close、pagehide時links.closeの本番配線は未完了。
`tests/test_save_actions.mjs`は人工画像/fileによる8件。実ブラウザ受入ではない。

`print-geometry.mjs`はD07のmm丸め/crop box/固定用紙配置を計算する候補。
`paper-rgb.mjs`は確定RGB写真を白用紙へコピーする候補で、resamplerを実装しない。
4crop/4用紙のPython記録と座標一致、L判全画素を確認。本番Worker/UI配線は未完了。

`check_paper_save_pipeline.mjs`は人工写真3枚のL判→registry→export job→Node codec thread→
save actions→実Node Blob URLを逐次結合する。PNG decoded RGBとPDF独立抽出のRGBが
用紙に一致した。ブラウザUI/保存/実印刷および本番用紙描画Worker接続は未完了。

`crop-view.mjs`はCSS stageへのfit/座標逆変換とpointerdown固定drag snapshotの候補。
イベント差分を累積せず、移動余地0の軸を保持する。実pointerイベント/cancel/resizeの
本番接続とブラウザ操作の受入は未完了。

`crop-pointer.mjs`はborderless stageのprimary pointerをcrop dragへ接続する候補。
cancel/lost capture/resize時は最後の設定を保持して終了、closeでlistener/observerを解放する。
UIはtouch-action、共有設定、上流変更前endを接続する。実ブラウザ操作は未受入。

`pillow-resize-memory.mjs`は準備済standalone moduleへRGBとfloat32 boxを渡す候補。
memory.grow後にviewを更新する。通常のC失敗はfree、trap/allocator失敗は再入を禁止しmodule失効。
所有Workerの終了接続が必要。現diagnostic各軸2048上限で、
原本cropの製品backendには未採用。小Memory＋人工filterテストはPillow WASM数値証拠ではない。

`single-worker-task.mjs`はexport/resize共通の1request/1Worker・中止・終了await制御。
`resize-worker-client/handler.mjs`はRGBと浮動boxを両端検証し、WASM factoryをWorker内で
実行する候補。`check_pillow_resize_worker.mjs`で実WASM4例/例外/中止/新thread復帰、
7thread終了を確認。本番browser bootstrap/配布/原本上限/allocator/実メモリは未完了。

`browser-resize-worker.mjs`はSHA照合したbounded WASMと固定budgetを同梱するbrowser entry候補。
`build_browser_resize_worker.mjs`が既存esbuild binary loaderでIIFE化しNOTICEを添付する。
生成物は制限VM/実threadで確認済み。不正inputはWASM初期化前に拒否する。
実browser/CSP/UI/原本上限/総メモリ/全面的な配布license監査は未完了。

`paper-worker-client/handler/transport`は用紙RGB描画の1request/1Worker制御。
RGB/DPI/用紙と戻り寸法を検証し共有layoutを使う。browser entryは約3KB。
`build_browser_export_worker.mjs <deps> <new output> paper`で生成できる。
crop→紙描画→PNG/PDFの逐次thread結合を確認。製品UI/browser/CSP受入は未完了。

`image-render-job.mjs`はcrop/paperのsnapshot/registry pin/採用前guardを共通管理する候補。
中止はrenderer終端まで待ち、古い結果は登録しない。上流staleはavailable:falseで
preview保持と再render禁止を両立する。保存sourceはget().status===validのみから供給する。
単体7件と実全経路を確認。UIへの配線は未完了。

`worker-gate.mjs`はresize/paper/exportへ同じinstanceを渡す共有admission候補。
終了await中も次のWorkerを拒否し、終了失敗は全clientをblockedにする。
session/UI/推論Workerへの配線は未完了で、RAM上限や即時回収の保証ではない。

`worker-client.mjs`も任意の共有gateを受け、prepared idleを含むWorker所有期間にleaseを保持。
cancel/dispose/errorは非同期terminateがあればawaitし、停止失敗で全clientをblockedにする。
モデルなし実threadとsynthetic制御テストの証拠であり、実GPU/メモリ受入ではない。

親worker-gate leaseのcreateChildGateは推論pipeline内の逐次Workerへ委譲するcapability。
inference-operationへ親gateを渡し、execute hooksのworkerGateでmodel clientを作る。
HR→trimap→matteの隙間も外部clientを拒否し、子停止が終わるまで親のreleaseを保留する。
模型/Node protocolの証拠であり、実GPU/browserと本番UIの受入は未完了。

`tracked-operation.mjs`はmetadata trackerと終了まで含む所有controller Promiseを接続する候補。
cleanup後だけidleを公開し、終了失敗はcancelling/blockedを保持。旧runが遅れても新intentを変更しない。
13件とモデルなし実Node thread3件で確認。本番UI/session/browserの配線は未完了。

export jobのcancelAndWaitは捕捉したdomain jobの終端/pin解放を待つ。save-actions側は
所有jobに限定して同APIを提供する。tracked-operationにはこのPromise APIを渡す。
停止失敗はblockedとして新規生成を止める。実PNG/Node thread2件で終了後idleを確認した。

image-render-jobはresize/paperのWorker終了失敗をrender-stop-failedへ固定し、
中止・設定失効の後でも隠さない。blocked ownerの再実行はrender-unavailable。
reconcile内部の中止Promiseは回収する。busy=falseは実Worker終了の証拠ではなく、
blockedも確認し、共有gateがblockedなら新たなownerでも実行しない。
検証: docs/browser/validation/2026-11-01-render-stop-failure.json（注入失敗、実ブラウザ未受入）。

renderとtracked-operationの接続では、Worker clientと同じ共有gateをtracked-operationにも渡す。
終了失敗でrenderが既にterminalでもgate.blockedを検査し、操作metadataをcancellingに保持する。
他clientからの再起動も共有gateで拒否する。4結合ケース（resize/paper × error/cancel）は
tests/test_render_tracking_integration.mjs、証拠はdocs/browser/validation/2026-11-01-render-tracking-integration.json。
Worker doubleの失敗注入であり、実ブラウザの終了保証ではない。

check_crop_save_pipeline.mjsはresize/paper/export/exportの各操作を共通trackerへ接続する。
購読callbackは観測だけを行い、callback外で全4回のidleがWorker終了後・gate解放後であるとassertする。
2026-11-01-tracked-crop-save-pipeline.jsonで実codec/resize WASMのNode thread結合を確認。
PNG/PDFは既存参照とbyte一致。実DOM/ブラウザ/保存dialog/印刷の受入は含まない。

bindSaveLink({anchor,control,pageTarget,onPageHide})は既存save-actionsをnative anchorへ接続する候補。
生成は呼ばず、refreshでready URL/filenameを表示し、click/auxclick/contextmenuで同期再検証する。
source/options変更時はcallerがrefreshを呼ぶ。pagehideでcontrol.closeとsession callbackを実行し、
callback側が共有links.close等を担当する（非同期終了を待つ保証なし）。closeはbindingだけ解除する。
bfcache復帰時は閉じたcontrol/bindingを再作成し、生成済みbytesからreconcileする必要がある。
DOM/default download/bfcache実受入は未実施。証拠: 2026-11-01-save-link-binding.json。

check_crop_save_pipelineはbindSaveLinkも経由し、生成された実Blob URLのbytesを検証する。
設定変更時のclickをdefaultPreventedにし、開始済downloadの猶予URLが残ること、
pagehideで全URLが失効してfetch不能となること、閉じたbindingが再生成しないことを確認。
anchor/pagehideはEventTarget double。実DOM/default download/bfcacheは未検証。
証拠: docs/browser/validation/2026-11-01-save-link-pipeline.json。

createInputLoad({registry,read})は入力選択の所有候補。readはWorker終了まで含むPromiseを
返す必要がある。loadは旧選択をabortし終端を待ち、待機中の中間選択を飛ばして最新だけ
開始する。成功時にRGBをregistryへ採用してinputIdを更新、失敗/中止/失効なら旧画像を維持。
旧画像は新画像採用後に所有参照だけ解放し、crop等のretainは尊重する。
getはinputId/画像metadataだけ。close/cancelは終端待ち、既知decoder停止失敗はblocked。
RGBAを勝手にRGB化せず拒否するため、PNG透過入力の正規化方針は別途未完。
証拠: docs/browser/validation/2026-11-01-input-load-owner.json（単体5件＋実PNG4threads）。
製品sessionの下流失効、UI操作追跡、file picker/page lifecycleへの配線は残る。

check_crop_save_pipelineのpaper bundle引数に続けてPNG input bundleとimage-dimensions
package directoryを渡すと、人工160×200を実PNGへencodeして、所有Workerでdecode→
input-load採用→crop→paper→PNG/PDFまで検証する。元RGBと出力artifact SHAを従来と照合。
2026-11-01-file-crop-save-pipeline.jsonでは5thread全終了、設定変更の保存拒否/URL解放もpass。
読込はinput-loadの所有制御、残る4操作はtrackerで検証。入力操作のUI tracker接続は未完。
これはPNG実codecのNode制限VM診断で、製品web/実DOM/実browser受入ではない。

input-loadのoptional trackerはkind=decode/selectionIdのmetadataのみ保持する。
InputSelectionIdは採用後InputId/AssetIdとは別。read開始前にbeginし、同期subscriberの
cancelならdecoderを作らない。中止/置換はcancelling→read終端→finishの順、
既知Worker停止失敗ならmetadataをcancellingに保持してblocked。別操作のtrackerを奪わない。
check_crop_save_pipelineのPNG input modeはdecodeを含む全5操作のidle順序を検証する。
証拠: docs/browser/validation/2026-11-01-input-operation-tracking.json（23単体/strict型/実5threads）。
製品session/file-picker/UI配線は未完。

bindFileInput({input,owner,pageTarget,onChange})は単一file pickerとinput-loadの接続候補。
選択fileは直接ownerへ渡しvalueを空にして再選択を許可する。公開stateはphase/input metadata/
固定errorCodeのみ。最新ticket以外の完了は表示せず、読込失敗時は旧inputを保持する。
pagehideはcloseを要求するがbrowser eventは非同期終了を待たない。close()の同じPromiseを
awaitして実decoder終了を確認する。phase=closedはイベント受付終了で、RAM解放の証拠ではない。
bfcache復帰時は新owner/bindingの作成が必要。共有URLや他controllerの解放はsession責務。
証拠: docs/browser/validation/2026-11-01-file-input-binding.json（関連17単体、実DOM未検証）。

PNG input modeのcheck_crop_save_pipelineはfile-input-binding経由で実Blobを選択する。
保存済PNG/PDFを生成した後、revisionを変える前に別PNGを選択してsource assetを更新し、
旧保存リンクが双方拒否されることを確認する。
2026-11-01-file-picker-save-pipeline.json: 6実thread逐次/全終了、初回出力SHA維持、
全6操作のidleは終了後、pagehideでURL全解放。picker/anchorはEventTarget double。
実DOM/FileList/OS picker/bfcache/download受入や製品session配線は含まない。

PNG input採用gate: docs/browser/validation/2026-11-01-png-inflate-boundary.json。
現fast-png readerはheaderpixel制限とCRCだけでは展開量を制限しない。125byte/1×1宣言から
49,280byte展開を受理する小反証を確認。既存normal PNG/Worker証拠をメモリ上限の根拠にせず、
bounded IDAT/iCCP等の既存library再利用を確定するまで製品入力へ採用しない。

PNG browser entryはbounded-png-decodeへ切替済み。固定SHAのfast-png内部class/keyword helperを
builderがaliasし、既存fflateの固定outへIDAT/iCCPを接続する。反証PNG拒否と正常RGB/RGBA、
実Worker/保存pipeline回帰は2026-11-01-bounded-png-worker.json。
以前のbrowser-worker-02は非boundedの履歴artifact。新bundleはprivate bounded-browser-worker-01。
総RAM/CPU/実Adam7/ICC色変換/実browserと製品採用gateは未完了。

実Adam7: capture_adam7_reference.pyが既存optipng/libpngとPillow参照で人工10casesを生成。
check_adam7_worker.mjsがbounded browser bundleで全RGBA/RGB一致と不足stream拒否を検証。
証拠: 2026-11-01-adam7-png-worker.json（11thread逐次/全終了）。大画像/全PNG形式/実browserは未受入。
