# 推論ライフサイクル（D04設計案）

2026-11-04更新。A11採否とD06の最終数値受入は未確定。D03型と本仕様の統合はD12で行う。
[逐次実機記録](validation/2026-10-31-serial-model-lifecycle.json)は資源切替の証拠で、本番pipelineの実装ではない。

applicationが1つの操作ID・入力ID・推論revision・固定model set版を所有し、ORT演算は逐次実行する。staged HRは親制御Worker＋最大1stage子Workerの構成で、Workerの個数と同時演算session数を区別する。
モデルのroleとmanifest SHAを別に検証し、HR/補正のどちらかだけ新しい版へ置換しない。
prepareのmodelVersionとinfer keyの版の意味は固定model set版へ統一し、ファイルSHAで各roleを識別する。

1. GPU features/limitsを確認し、必要なモデルの取得を明示操作で行う。
   同じ写真・固定model setの保持済み背景maskが有効なら、補正ON/OFFとも次のHR工程2〜4を省く。
   補正OFFでは保持maskを前景色推定へ渡し、補正ONではtrimapから先だけ実行する。写真/モデル変更でmaskを失効させ、shape/byte/layout検査と新操作keyへのcommit判定を維持する。
2. HR Workerへ選定したprepare sourceを渡してsession準備。library-resources候補では固定descriptorを渡し、
   Worker内の既存loader＋取得policyで読む。verified-bytes比較経路では検証済みfileをtransferする。
   原本と独立したRGB入力を渡す。
3. finite/shapeを検証したHR alphaをmainへtransferし、参照仕様の元寸法補間・丸めを行う。
4. HR session.releaseをawaitし、device.destroyを要求。disposed応答後にWorkerをterminateし参照を消す。
5. 補正OFFまたはtrimap anchor不足等のskip条件なら補正Workerを作らずHR alphaを採用する。
6. 補正ONではD06通りのtrimap/RGB/paddingを作り、別Workerで補正sessionを準備・実行する。
   HR alphaはregistryに保持し、必要なコピーだけtransferする。確定領域を参照通りに維持する。
7. 補正Workerも同じ順序で解放・終了する。有効な最新alphaだけを後続の前景色推定・合成へ渡す。

HR→trimap→ViTMatteは固定候補のLinux CPU/GPUでnative PNG保存まで確認済み。保持maskのOFF再利用は新しい作業候補で実OFF→ON→OFFの3保存と基準byte一致を確認したが、このコードのsource archive/HF固定ペア更新は未実施。個別ケースを全端末・一般品質・実配信の受入へ広げない。
製品では同じ操作keyを全段階で照合し、古い結果を採用しない。背景色だけの変更は推論しない。
GPU memoryの回収をdisposed応答だけで保証しない。device.destroyは要求であり、driver/cacheの解放時刻とは別。

準備/実行/解放中の重い次jobをqueueに積まない。途中の写真・設定変更は先に操作を論理失効し、
Worker終了まで次の操作を開始しない。通常完了ではtensor.dispose、session.release、device.destroy、Worker終了を行う。
キャンセルは所属を失効し、協調protocol対応Workerには固定cancelを送る。呼出し/解放完了の対応ACKを有限時間待ち、terminate後に次jobを受け付ける。timeout/error/終了失敗はblockedにし、早期解放で再開しない。legacy経路とは保証範囲を分ける。
GPU作業が物理的に瞬時停止したとは表示せず、完了済み写真/設定は保持する。ACK/device.destroyもdriver上の全VRAM回収時刻を保証しない。

解放失敗、device lost、割当失敗、非有限出力では壊れた結果を破棄し、そのWorkerを終了する。
新しいWorker/adapter/sessionでの明示再試行へ戻す。大モデルのCPU代替や解像度縮小を自動で行わない。
GPUが使えない場合も手動crop/印刷の導線を保つ。別タブのsessionや通常ブラウザをアプリから終了しない。

PoCのtestはsession解放待機/失敗時device破棄、既存session上書き拒否、逐次順序、SHA差での後続停止、
設定fetch中のcancel後に遅延Workerを作らないことを確認した。実機ではHR/補正各1run・解放とSHA一致を確認。
製品のdevice lost、cancel時GPU回収、複数回切替、旧応答、前後処理を含む実pipelineの検証はE06/E07/F01/F03/F05に残す。

## Transformers.jsを使う場合の追加条件

[固定model読込候補](transformersjs-model-loading.md)を参照。4.3.2のWeb用run queueは直前の
失敗をcatchせずthenで接続するため、失敗後に同じWorkerへ再runしない。既定のWorker再作成方針を維持する。
model.disposeはsession.releaseをawaitするが、device.destroyまでlibraryが保証するとはしない。
ORTのdevice所有権を確認し、共有deviceを不用意に破棄せず、Worker終了まで次modelを開始しない。

## libraryが返したmodelの採用境界（2026-11-01）

[prepareStoredModel](../../tools/browser-library-adapter/prepared-model.mjs)は既存load callbackを呼び、
role別必須manifest fileのSHA/bytesが照合済みかつstoredであることを確認してmodelを返す。
cache hitはcacheVerified、network経路はnetworkVerifiedを要求する。
入力file一覧とload optionsは固定manifestから呼出側が生成し、任意のUI入力を渡さない。
modelのrole/入出力検証は別であり、この保存判定だけでモデル互換性を宣言しない。

中止済み/失効済みならloadを呼ばず、load中に中止/失効した場合は返ったmodel.disposeをawaitして拒否する。
保存失敗も同様。dispose失敗はmodel-release-failedとし、所有Workerを終了する必要がある。
load自身が途中で例外を出しhandleを返さない場合、内部sessionをhelperが列挙できないため
Worker終了を必須とし、同じWorkerで再試行しない。
load/run中の物理キャンセルはこのhelperの責務ではなく、UIの論理失効とWorker終了を併用する。

[確認](validation/2026-11-01-prepared-model-gate.json)は単体4件と公開AutoConfigのquota結果を使う。
model handleは人工であり実sessionの解放/大容量native cache受入ではない。
policy instanceは操作ごとに分け、成功返却後も使用前に現在keyを確認する。
D03のprepare/files方式とlibrary取得方式の最終統合はD12/E03へ残す。

## 待機中Workerの障害（2026-11-01）

clientはactive requestがない時も、現在ownerのerror/messageerrorと最後のjobに属する固定errorを扱う。
準備済み状態を消しWorker終了後、onWorkerFailure({workerId, code})を通知する。
applicationは自分のreadyWorkerIdと照合して準備表示を無効にし、完了済み画像assetは保持する。
clientのstateは通知時点ですでに消えているため、それを古いworkerIdとの比較元にしない。
各Worker IDはrandom UUIDとし、client instanceが変わっても旧通知と衝突させない。

handlerはprepare callbackへonDeviceLostを渡す。実装は所有GPUDevice.lostへ接続する必要がある。
通常dispose中のdevice破棄や失敗済みWorkerからの重複通知は抑え、
予期しない喪失は固定device-lostを返し以後の実行を止める。
prepare callbackのemitはprogress/resource-stateだけを許可し、preparedは正常handle返却後にhandlerが出す。
[人工21件と型検査](validation/2026-11-01-idle-worker-failure.json)は成功したが、実device lost受入ではない。

## 既存library準備APIへの結合（2026-11-01）

[factory](../../tools/browser-library-adapter/transformers-prepare.mjs)は固定3資源
(config/graph/external weights)をpolicyへ結合し、既存from_pretrained APIを呼ぶ候補実装。
HR=PreTrainedModel/fp16、補正=VitMatteForImageMatting/fp32、固定externalData mappingを指定する。
HRはCPU fallback禁止を上書き不可にし、runtimeからのCPU-only provider差し替えも拒否する。
Hub fallback/FS/browser独自cache/既定WASM cacheを切り、customCacheと取得hookへ統一する。

configureRuntimeはアプリbuildが指定する信頼済み実装で、asset URL固定、device所有、
device.lost hook接続とdisposeを提供する必要がある。現在その実装と実GPU確認は未完了。
返却handleは{model,dispose}で、disposeはmodel解放後finallyでruntimeを解放する。
保存gateが未保存handleを拒否した場合も同じ順序で解放する。
[人工class/ownerの確認](validation/2026-11-01-transformers-prepare-composition.json)は
実from_pretrainedやモデル互換性の合格ではない。

## handlerと準備factoryの接続確認（2026-11-01）

[結合2件＋取得policy15件](validation/2026-11-01-worker-preparation-integration.json)で
createWorkerHandlerのprepareへcreateTransformersPreparationを渡す経路を確認。
SHAの異なる3資源の保存/照合完了後だけpreparedを返し、人工infer→disposeまで接続した。
quotaではmodel/runtimeを解放し、preparedを返さない。
既存library classとruntimeは人工なので、実モデルやWorker threadの受入ではない。

## 入力keyとは独立した操作意図（2026-11-01）

[調停処理](../../tools/browser-library-adapter/inference-operation.mjs)はexecute callback全体を
操作tokenで管理する。入力keyが変わらない単なる中止でもtokenを先に失効し、
遅延結果をcommitterへ渡さない。旧操作のfinallyが新しい操作を終了しない。
callbackには固定input/revision/model/refineと現在意図の判定関数を渡す。

executeは採用するHR＋必要な補正を含む全pipelineと通常解放を終えてから返す必要がある。
本処理はそのpipelineを実装するものでも、補正ONをHR単体へ変更するものでもない。
cancelOwned callbackの完了待ち中はstartを拒否し、解放失敗では再利用を禁止する。
物理GPU回収はcallbackのPromiseだけで保証しない。

[操作7件＋registry結合1件](validation/2026-11-01-inference-intent-commit.json)で
中止後に同じkeyで再実行した場合も、新しいalphaが旧完了に置換されないことを確認。
既存prototypeの失効規則を保持し、UI/実pipeline/Worker解放callbackの接続は未完了。

## HR→補正の逐次制御の接続（2026-11-01）

[serial executor](../../tools/browser-library-adapter/serial-inference.mjs)を操作調停のexecute候補として追加。
HR prepare/infer/disposeをawaitしてからtrimapを作り、補正ONかつ0/128/255の全領域が
存在する場合だけmatteをprepareする。条件不足はHR alphaを変更せず返す。
両roleは同一model set版を要求し、補正失敗をHR単体成功へ黙って切り替えない。

makeTrimapは参照互換の画像処理へ委譲する未接続callbackであり、
テストの人工trimapを本番処理として使わない。生成済みtrimapを新しいtrimap-u8 planeで送り、
Worker側も値/寸法/長さを再検証する。実推論bindingは渡されたtrimapをprocessorへ使う必要がある。

中間HR alphaはregistryの一時ownerが保持し、matteへの入力copyを送った後も原本を維持する。
matte成功/失敗で一時ownerをfinally解放する。obsolete operationのfinallyでは
client.cancelを呼ばず、操作調停が現在ownerの終了を担当して新jobへの干渉を防ぐ。
[関連42件と型検査](validation/2026-11-01-serial-inference-control.json)は成功。
逐次モデル処理そのものは人工clientなので実モデル・browser・GPU受入ではない。


## checkpoint1 runtime ownerの候補実装（2026-11-01）

未接続だったconfigureRuntimeをort-runtime-bootstrap.mjsで実装し、既存preparationからrole/precisionを渡す。ORT1.31.1、same-origin/runtime/内の固定WASM/MJS URL、build側の固定limitsを事前検証。published Transformersはenv.backends.onnxをshallow copyするため、root object一致ではなくwasm/webgpu flag objectの共有を確認する。global ORT注入を要求しない。

呼出し時だけadapter/deviceを要求し、HRはshader-f16とstrict fallback禁止、matteは明示GPUを維持。sessionへ専用deviceを渡し、model.disposeの後に既存ownerがdestroyを1回実行。device.lostは固定codeだけ通知し、通常disposeによるlostは通知しない。失敗owner内の自動再試行なし。既存PoCの正式ORT/WebGPU API利用を参考にし、新loader/device manager frameworkは作らない。

人工GPUによる対象16test pass。実requestAdapter/device/session/WASM/browser/modelは実行していない。通常domain commandへ同16件を追加（合計97予定）、checkpoint方針に従い旧81件や全体buildはこの変更で繰り返さない。証拠: validation/2026-11-01-ort-runtime-bootstrap.json。固定asset SHAの配布build照合、実limits/資源/Tensor/runtime/model受入はcheckpoint1で未完。


### runtime配布容量への対応（checkpoint1、2026-11-01）

取得済みORT1.31.1のJSEP WASMは29,520,971byteでPages25MiBを超え、MJSは47,250byte。runtime-assets.candidate.jsonへ版/byte数/SHA/Content-Typeを固定し、MJSはPages same-origin、WASMは明示したR2 originへ分離する。runtime bootstrapはbuild側wasmOriginだけを許可し、MJSの外部origin移動や未許可originは拒否。R2 CORS GET/Pages CSP connect-srcの実設定・immutable URLはまだ未定、候補URLはnullであり自動取得しない。

該当bootstrap10testだけpass、他suiteはcheckpointへ集約。通常domainの予定総数は98。証拠: validation/2026-11-01-runtime-assets-routing.json。公式上限: https://developers.cloudflare.com/pages/platform/limits/ 。全runtime同梱をPagesで可能と推定しない。WASMファイル名にthreadedを含むが、現在はnumThreads1でthread高速化/COOP-COEP受入を主張しない。実GPU/model/browser/WASMは起動していない。


2026-11-02更新: 所有deviceの実喪失をprivate MODNetで検証。prepared後/result前にGPUDevice.destroyを明示し、device-lost→写真保持/出力なし/gate解放→同browserで新Worker/device→PNG保存を完遂。通常出力とSHA一致、browser終了/GPU復帰確認。初期節のhook実装未完という記述は当時の履歴で、現実装のこの経路は確認済み。物理driver reset/HR/Matte/反復故障は未受入。診断hookは配布しない。証拠: validation/2026-11-02-modnet-device-loss-recovery.json。


### 2026-11-02: 工程Workerのbounded再利用候補

createStageWorkerHandlerはmaxJobs=1を既定として維持。診断では明示maxJobs（1〜46）で完全解放後だけ次のjobを受理し、重複ID/上限/同時要求を拒否。load/run/input/release異常またはdevice lost後はpoisonし、同Workerで新sessionを開始しない。正常な協調中止は返却tensor/owner解放→ACK後に次job可能。親pipeline/builderは再利用を選択していない。native maxJobs3でstage28推論中止→22→28の2結果が従来fresh Worker rawSHAと一致。全46工程/実故障/資源の採用gateは未完。証拠: validation/2026-11-02-stage-bounded-reuse-cancel-native.json。


2026-11-02追加: bounded reuseの実device失効も診断確認。prepare済み工程28の所有GPUDeviceのみdestroy→lostを待つとstage-device-lost、同handlerの22要求はstage-input-failed/prepare未進入。明示Worker交換後22が通常fresh Worker SHAと一致。物理driver reset/実kernel中喪失/全46工程の検証ではない。production maxJobs1保持。証拠: validation/2026-11-02-stage-reuse-device-loss-recovery.json。


### 2026-11-02: 親runnerの明示per-run候補

createStagedHr.workerLifetimeはper-stage既定。検証指定per-runはcooperative-stage-cancel-v1/46工程以下を要求し、各run内だけ1Workerを維持。既存SingleWorkerTask stop hookへsettlement codeを渡し、有効resultのみ保持、中止/エラーは終了。最終terminateまでouter gateとabort listenerを保持し、その間の中止で完成結果を返さない。terminate失敗はgate/runnerをblock。次runにはfresh Workerを用いる。handler側はcatalog工程数以上のmaxJobsを明示した対応artifactが必要。既存prepare/builderはどちらも選択せず、通常経路は従来どおり。関連36/domain547/build pass、新親経路のnative実測は未完。証拠: validation/2026-11-02-stage-parent-opt-in-reuse.json。


2026-11-02追加: 新親per-run経路をnative Chrome/GPUで隣接22→23のexact catalog/graphと半精度pattern入力に適用。2出力（12MiB/24MiB）rawSHAはper-stageと完全一致、作成/終了2→1、outer gate解放・browser終了。観測wall6226.4→2815.2msは順次同profile/cache再利用の交絡を含み、全体改善率としない。Private観測最大1,824,587,776byte/GPU増加62MiBは疎な2sampleでpeak保証なし。全46工程/親cancel/資源受入は未完。証拠: validation/2026-11-02-hr-parent-adjacent-reuse-native.json。


2026-11-02追加: 親per-run経路で実model開始時abort→cancel-stage→stage-cancelled ACK→terminateの順序をnative確認。ACK/terminate時outer gateはbusy、終了後idle。中止回はstart0だけでcomplete/次stage/resultなし。同じrunner再実行はWorker2を新規作成し22→23出力2件が無中止fresh基準とSHA完全一致、終了合計2/作成合計2。診断markerは親protocolに混ぜず計測listenerで消費。全46工程と親device失効は未完。証拠: validation/2026-11-02-hr-parent-cancel-same-runner-retry.json。


2026-11-02追加: trusted policy/buildの明示per-run候補を全46工程へ接続。親child上限不一致を拒否しdefault per-stage維持。実候補は34完了後WS5.7368GBが既存5GiB枠を超え停止、final PNGなし/資源条件不合格。全工程Worker維持は現条件で未採用。次候補は明示上限の複数工程ごとに終了を待つ方式で、最終出力一致/同資源枠を再評価する。証拠: validation/2026-11-02-full-worker-reuse-resource-rejection.json。


2026-11-02追加: 明示maxStagesPerWorker8により、既存stop hookを8工程ごとにawaitしてWorkerを交換する候補を接続。最終端数も終了し、error/cancelは即そのWorkerを終了、outer gateは全run終了まで保持。child上限/固定policy一致をbuildで照合。全46stage＋Matteが旧PNGと全byte一致、既存stage枠内で1回完遂。全工程1Worker失敗の上限増加ではなくlifetime制御変更。全fixture/反復/実group境界cancelは未完、既定per-stage維持。証拠: validation/2026-11-02-hr-group8-full-parity-resources.json。


2026-11-02追加: max4はportraitと別人物landscape各1回で全46＋Matte/元PNG全byte一致/同資源枠内。landscape HR71.9655s/prepare27.4775s、WS観測4,919,783,424byte/Private6,650,630,144byte、886sample/drop0/終了・GPU復帰。単発2画像で一般品質/反復/実境界中止を完了とせず、通常default per-stage維持。証拠: validation/2026-11-02-hr-group4-landscape-parity-resources.json。


2026-11-02追加: private traceは64件event ringとは別にresult role列を32件上限/overflowで保持。反復observerは各回photo選び直し/置換確認を通してraw HR maskを失効し、全HR→Matteを検証する（通常の同写真補正はmask再利用があるため区別）。max4で同browser2回とも46stage/HR→Matte順/PNG元基準byte一致、HR69.9834/67.3937s、WS観測4,972,646,400byte/Private7,156,523,008byte、1652sample/drop0/終了・GPU復帰。原期限/継続監視/admission保持、失敗retryなし。証拠: validation/2026-11-02-hr-group4-same-browser-repeat.json。


2026-11-02追加: max4を本体UIから実際に中止。8工程完了後（少なくとも4工程group交換済み）に中止をclick、busy/gate終了/写真保持/resultなし、1500ms後のlate結果/linkなしを確認。同browserで明示実行と取得確認後、全46HR＋Matteを再実行して元PNGと全byte一致。親runner mockだけでなく本体session/協調停止を含む。正確なterminate途中ではないことと全競合未完を保持。証拠: validation/2026-11-02-group4-ui-cancel-recovery.json。

### 2026-11-04: 補正OFFも保持背景maskを再利用

従来は補正ONだけで保持maskを再利用し、OFFの開始は明示base再計算としていた。今回の性能改善では、同写真/同modelの有効maskがある場合、OFFでもモデルprepare/inferを省いて前景色推定・PNG生成へ進む。独自cache/新libraryは追加せず、既存registryのphoto/model所有境界とserial-inferenceのpixel検査を使用する。写真/モデル変更や不正alphaは引き続き再利用を拒否する。全体cache確認/削除は両モデルscopeを維持し、今回の取得見積りだけ0にする。

AMD実browserのON→OFFは旧71.347秒→新4.155秒（同意/2秒poll/native保存を含む観測、単一事例）。OFF/ON/OFFの3PNG全てが修正前の対応PNGとbyte一致し、旧保存link失効/同写真保持を確認した。全306 UI/631domainWorker/24scripts・型/通常/設定build成功。GPU5GiB RAM/増加4GiB/600秒guard内、owned一時物撤去/Gufo0。原CPU実測の時間保証変更やnative CPU再受入ではない。
[検証と限界](validation/2026-11-04-mask-reuse-off-native-optimization.json)。

### 2026-11-04: source13固定入力9b8のCPU OFF/ON/OFFも実保存

GPU無効/最大2WASMthreads/CPUquota200%/8GiB RAM枠/600秒で、同写真1086×1448のHR406段OFF初回→保持maskでMatteのみON→保持maskで補正なしPNGを実行。3caseともnative PNG保存し、OFF戻しは最初のOFFと全byte一致、ONは既存CPU baseline81f2…と一致。OFF戻しはmodel/通信見積り0MiB、写真BlobURL/寸法保持/旧link0、後2caseでHR進捗表示なし。

確認/poll/native保存を含むcase時間は384.641/60.139/4.380秒。cold private loopbackからの観測で、実HF初回時間や一般CPU性能の保証ではない。RSS最大6840950784B/cgroup最大6850060288B、GPU増加1937408B、host空き最低23318544384Bで全guard内。owned一時物2814976000B撤去、containerStopped/Gufo0/GPUclient0/GPU169684992Bへ復帰。
[source13 CPU検証](validation/2026-11-04-source13-cpu-refine-toggle.json)。全shape/実機/人/印刷/匿名配信は別の受入。
