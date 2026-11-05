# WebGPU Worker診断PoC

ブラウザのGPU経路を調べるための独立した診断ページ。本番の`web/`実装ではない。
モデルや画像を取得せず、専用Worker内でadapter/deviceを取得し4要素のWGSL計算を行う。
出力 `[3,7,11,15]` の一致だけを確認する。これをHR/ViTMatteの実行成功として扱わない。

```bash
python -m http.server 17861 --bind 127.0.0.1 --directory tools/browser-webgpu-poc
```

同じ端末のブラウザで `http://127.0.0.1:17861/probe.html` を開く。
別端末からは安全なコンテキストが必要。HTTPをLAN公開して動作すると仮定しない。
「GPUを確認する」で結果JSONを表示。「中止」はWorkerを終了して遅延結果を破棄する。
adapterのfeatures/limitsを記録し、メーカー名だけで対応判定しない。
adapter上限と`requestDevice()`既定の上限は異なるため、モデル実行時は必要limitsを別途要求する。

## 確認した環境

- Linux/WSL・Headless Chromium 153.0.8010.12、既定設定: APIは存在するがadapter取得不可。
  Linux全般やNVIDIA全般の非対応を意味しない。
- Windows NT 10.0.26200・Headless Chrome 156.0.8078.73、専用の一時profile、GPU関連の強制flagなし:
  NVIDIA Ampere adapter、fallback=false、計算成功。修正後のページで2回連続実行を確認。
  `shader-f16`対応、adapterのmaxBufferSize=2,147,483,648、maxStorageBufferBindingSize=2,147,483,644。
  ブラウザはdevice名を返していない。別途CUDA側の情報はRTX 3050 8GiBだが、ブラウザからCUDAを呼んだテストではない。

[Linux結果](../../docs/browser/validation/2026-10-31-worker-webgpu-host-default.json)、
[Windows結果](../../docs/browser/validation/2026-10-31-worker-webgpu-windows-nvidia.json)。
最初の試行は診断用shaderが不正だったため失敗し、修正後に成功。
その失敗をGPUの利用不可とは分類しない。Worker URLに実行ごとのqueryを付け、古い診断scriptのcacheを避ける。

Windowsの確認は通常の利用者profileへ接続せず、専用headless processをlocalhost CDPから操作した。
確認後にBrowser.closeで終了し、HTTP serverも停止。残存する一時profileのロックファイルは、
他プロセスが利用している可能性があるため強制的な権限変更や他のChrome終了は行わない。

## 次のモデルPoC

固定ONNX/external dataと正規化済み入力を専用Workerに渡し、ORT WebGPUで実行する。
GPU演算配置、CPU fallback、初回/再実行、device lost、中止、モデル切替を別に記録する。
写真や入力tensorを外部へ送るAPIは作らない。この小計算を実モデルの合格判定に流用しない。主な受入環境は利用者指定のWindows Chrome・NVIDIA。


## 実モデルの検証ページ

`serve.py` はloopback限定・GET限定で、明示的に許可したruntime/ONNX/external data/参照tensorだけを配信する。
POSTは501、directory traversalは404を確認。写真upload APIを追加していない。

```bash
python tools/browser-webgpu-poc/serve.py \
  --artifacts /private/image-studio-browser-evaluation \
  --model-dir onnx-vitmatte-02
```

Windows Chromeで `http://127.0.0.1:17861/model.html` を開く。
「CPU fallbackを禁止する」はモデル準備時に適用する。準備後の切替だけではsession設定は変わらない。
CPU禁止で失敗した記録を保持し、必要な場合だけ新Workerを作りCPU併用を明示的に許可する。
モデル/外部dataと入力のbytes/SHAをWorker内で照合し、結果のFP32 tensorを保存できる。
処理中の観測timeoutだけでWorkerを再起動しない。cancelは明示操作でWorkerを終了する。

### onnx-vitmatte-02の実測（2026-10-31）

Windows Chrome 156、NVIDIA Ampere、ORT Web 1.31.1、専用Worker、WASM 1thread。
モデルとexternal dataは合計390,335,374 bytes（runtimeや入力tensorの取得量とは別）。
CPU完全禁止はsession作成時に拒否された。CPU併用を明示したrunでは、
[配置記録](../../docs/browser/validation/2026-10-31-vitmatte-webgpu-node-placement.json)に
CPU 67ノード、WebGPU 900ノードを記録。CPUは形状・座標用の算術/reshape/range等で、
Conv 22、MatMul 72、Einsum 24、Softmax 12等はWebGPUへ配置された。
JS側のprofiling callback件数が空でもGPU未実行を意味しない。native EPの配置/dispatchログを保存した。

1122×1402画像に対応する `[1,4,1408,1152]` で初回38.52秒、同session再実行20.70秒。
これは入力取得を除き、CPU readbackを含むrun時間。verbose診断を有効にしたPoCであり、
製品版の性能やモデルcacheのcold/warm受入ではない。
[alpha比較](../../docs/browser/validation/2026-10-31-vitmatte-webgpu-alpha-comparison.json)は
全体MAE 1.7451e-8、境界MAE 1.4428e-7、最大1/255、確定領域違反0。
2回のraw出力は完全一致。目視・許容差合意や全寸法の受入の代わりにはしない。

長辺2000の縦長入力では整数overflowで失敗した。
[実行記録](../../docs/browser/validation/2026-10-31-vitmatte-webgpu-full-model-attempt.json)。
元のall-headモデルを全サイズ対応として採用しない。その後、同じ重み/FP32/入力寸法を維持して
global attentionをheadごとに計算する候補を検証した（下記）。

### runtime assetの配置

実際にロードされたasyncify WASMは28,747,738 bytesで、Pagesの25MiB単一asset上限を超える。
同じruntimeを採用する場合はWASMもR2等へ分離し、CORS/Content-Type/固定版の整合をD09で設計する。
JSPI WASMは別artifactであり、サイズが小さいことだけで互換性を確認済みとは扱わない。
[Pages公式制限](https://developers.cloudflare.com/pages/platform/limits/)を2026-10-31確認。

### onnx-vitmatte-03の全参照ケース（2026-10-31）

`--model-dir onnx-vitmatte-03` で同じ診断ページを使用する。
Windows Chrome 156.0.8078.74、NVIDIAのWebGPUで、元画像、長辺2000の縦長・横長・正方形、
2001pxからの制限を含む5ケースと元画像の再実行を計測した。
[比較記録](../../docs/browser/validation/2026-10-31-vitmatte-headwise-webgpu-comparison.json)、
[演算配置](../../docs/browser/validation/2026-10-31-vitmatte-headwise-webgpu-placement.json)。
CPU併用は明示許可し、WebGPU2596 node、CPU67 node。Conv/MatMul/Einsum/SoftmaxはCPUに配置されていない。
全ケースでalpha最大差1/255、確定領域違反0、元画像の再実行raw差0。
これはROCm参照とのブラウザ比較であり、native ORT全ケース比較・目視受入・製品性能の完了ではない。

既定はViTMatteの契約。BiRefNetの候補は下記の明示的な契約で選ぶ。
モデル名だけの差し替えでは入力dtype/入出力名を変更しない。

### BiRefNet出力分割候補の検証準備

```bash
python tools/browser-webgpu-poc/serve.py \
  --artifacts /private/image-studio-browser-evaluation \
  --contract birefnet-output-tiles-01
```

候補はgraph SHA `3fbcfed0079e8a3b95bcba7c6bd2a8776a73c1e6681ab0aec51198bd24349006`、
external data SHA `364eab4994414fb107c1ec7680dd98202ec4ddb3b8d3dcc87f5a5f887890bb7c` に固定。
既存のcaptured FP16 `[1,3,2048,2048]` 1件を使用し、Workerでモデル/入力のbytes・SHAを照合する。
input `pixels` / output `alpha`、出力FP32 `[1,1,2048,2048]`。
入力はUint16ArrayのIEEE binary16ビット列をORTへ渡し、数値変換しない。
shader-f16がないadapterはモデル取得前に拒否する。
Node24ではORTが同じbufferのFloat16Array viewを返す場合があるため、
値表示ではなくUint16 viewで元ビット列の保持を確認した。

[準備確認](../../docs/browser/validation/2026-10-31-birefnet-browser-contract.json)は
metadata test4件、Worker mock test3件、固定ORT Tensor APIと実artifact長さの確認のみ。
GPU/session作成/モデル推論は実施していない。
[nativeの演算別結果](../../docs/browser/validation/2026-10-31-birefnet-native-staged.json)は
1件の比較証拠であり、通常sessionや全条件での画質受入は残る。
本契約を用意したことでA08の実機実行済みとは扱わない。

#### 全5ケースを選ぶ場合

```bash
python tools/browser-webgpu-poc/serve.py \
  --artifacts /private/image-studio-browser-evaluation \
  --contract birefnet-output-tiles-01 --hr-input-set full-reference
```

privateの`birefnet-inputs-01/inputs.json`と5つのFP16 tensorを使用。
元寸法/縦長/横長/正方形/長辺制限の全ID・各SHA・固定2048px・bytesを検証し、
欠落ケースや別tensorは拒否する。Worker側でも取得実体のSHA/長さを照合。
指定しない場合は従来どおり元寸法の1件。
[準備結果](../../docs/browser/validation/2026-10-31-birefnet-full-browser-inputs.json)は
5 tensorのコピー時SHA/長さ一致とmetadata test5件。ブラウザは起動していない。

BiRefNet初回実機はCPU禁止でsession ready、全7451最適化nodeがWebGPUだったが、
全2048px出力の非有限値検査で失敗。
[記録](../../docs/browser/validation/2026-10-31-birefnet-webgpu-nonfinite.json)。
専用Chrome/serverは終了し、同条件の再試行はしていない。
ロード成功をモデルの正常な推論・画質合格と扱わない。

#### 中間checkpointの診断

`extract_browser_checkpoint.py`で元候補SHAを指定し、元dtypeを保つ診断ONNXとreceiptを作成する。
ONNXは元external dataと同じdirectoryへ新規保存する。
serverに`--checkpoint diagnostic-encoder-primary-02.onnx`等を明示すると、原寸1入力だけで
receiptの型/shape/名前を照合し、alphaではなく有限値/NaN/±Infの件数を返す。
output-only Castは丸めを変えるため使用しない。中間結果は画像保存や全モデル合格に使わない。
[encoder側2点の結果](../../docs/browser/validation/2026-10-31-birefnet-encoder-checkpoints.json)はfinite。
元の全sessionのNaN原因はまだ特定していない。

#### FP32空間平均の修正候補

`--contract birefnet-fp32-means-01`は5つの平均だけFP32計算して元FP16出力へ戻す別候補。
元の失敗候補は`birefnet-output-tiles-01`として保持する。
新graph SHA584924ef…を固定し、元と同じcaptured FP16入力を使用。
[原寸1件の初回結果](../../docs/browser/validation/2026-10-31-birefnet-fp32-means-first-webgpu.json)は
CPU禁止・全GPU配置・有限alpha取得/コピーSHA照合に成功。
生2048px CPUとの差は最大約0.102で、元寸法の画質/全5ケースの合格は未判定。

#### 実行済みtargetを追跡するobserver

`tools/observe_browser_model_poc.cjs`はtask専用のblank Chrome targetへ接続する。
利用者の通常profileには接続しない。Chrome/serverの起動は含まない。
外部へ置いた`playwright-core`のpathと、task専用browserであることを指定する。

```bash
export PLAN36_DISPOSABLE_BROWSER=1
export PLAYWRIGHT_CORE_PATH=/private/node_modules/playwright-core
node tools/observe_browser_model_poc.cjs --mode load --output /private/load-01
node tools/observe_browser_model_poc.cjs --mode run --from-report /private/load-01/report.json \
  --case reference-01 --output /private/run-01
node tools/observe_browser_model_poc.cjs --mode run --from-report /private/run-01/report.json \
  --case reference-01 --output /private/run-02 --close-browser
```

run/observeはreceiptのtarget ID/CDP/originを使い、対象が消えた場合は停止する。
新規directoryへ分割転送した出力を保存し、diskから再読込したSHAも照合。
保存前のcompleted出力は次のrunで上書きしない。loadはblank targetだけを許可し、CPU禁止を明示する。
同じsessionで2回runできるが、再実行がbit一致することは別に結果比較で確認する。

観測期限到達はexit2と`observation_timeout_job_not_restarted`を残し、browser/Workerを終了しない。
そのreceiptに対し`--mode observe --from-report /private/pending/report.json --output /private/observe-02`
を使えば、同じtargetの状態と結果を取得できる。自動reload/自動再推論は行わない。
`--close-browser`はterminal状態でのみ専用browserを閉じる。serverは起動元が終了する。
小test4件は引数/target参照必須、chunk端、disk SHA、既存file保護、破損/不足出力の拒否を確認。
同一sessionのrepeatには、1つのCDP接続でloadと逐次2runを行う次の方式を使う。
新規blank targetが必要で、`--from-report`は指定しない。成功時に専用Chromeを閉じる。

```bash
node tools/observe_browser_model_poc.cjs --mode repeat \
  --case reference-01 --output /private/repeat-01
```

[実測結果](../../docs/browser/validation/2026-10-31-birefnet-repeat-same-session.json):
Windows Chrome 156.0.8078.74、CPU禁止でモデル初期化1回・run番号1→2。
両出力16,777,216 bytesのdisk SHAが一致し、専用Chromeも終了。
読み戻し込み約28.75秒/29.06秒は診断値で、製品性能やモデルcacheのcold/warm計測ではない。
以前の別接続方式では2回目のCDP接続がtimeoutした記録を保持している。
その試行では2回目推論は開始されておらず、モデル出力の不一致とは扱わない。


## GPUを使わない保存計測

`cache.html`は同じserverのconfigからモデルファイルだけを取得する別診断ページ。
ORTや入力tensorをロードしない。専用GPU無効profileで使用する。
`cache-worker.mjs`は増分SHA256とOPFS sync access handleで逐次保存し、
保存後にstream再読出ししてSHAを照合する。warmは保存済みfileだけを再照合する。
初回のcoldは専用namespaceが空の場合だけ受け付ける。部分保存を自動再開/削除しない。
中止はWorkerを終了するため、再計測には新規の専用profileを使う。
本番の複数release・中断復旧・モデルcache実装ではない。

```bash
PLAN36_DISPOSABLE_BROWSER=1 PLAYWRIGHT_CORE_PATH=/private/node_modules/playwright-core \
node tools/observe_browser_cache_poc.cjs /private/new-cache-observation
```

起動済みserverと17862のfresh blank専用Chromeが必要。observerは1接続でcold→ページ再読込→warmを実行し、
terminal成功でCDP Browser.closeを送る。timeoutは既存処理を再実行せずreceiptを残す。
再観測は同じtargetのstateを読むだけにし、このCLIを新規loadの代わりに再起動しない。

[HR実測](../../docs/browser/validation/2026-10-31-birefnet-opfs-cache.json):
457,390,054 bytes、取得/保存/再検証約21.33秒、保存済み読出し/再検証約9.55秒。
HTTP no-storeのloopback計測。R2/製品cold-warm、session初期化、GPU/RAM peakを証明しない。
増分SHA/streamのNode test3件、既存契約test7件と実Chromeでの両fileのSHA一致を確認。


ViTMatteは`--contract vitmatte --model-dir onnx-vitmatte-03`を指定したserverと新しい専用profileで計測する。
[再読込実測](../../docs/browser/validation/2026-10-31-vitmatte-opfs-cache.json)では約397MBをcold151.83秒、
新document/Workerでのwarm8.56秒、warmモデルGET0件。遅いcold試行も結果として保持する。
HRの初回記録は再読込なしの旧observer方式であり、同じ条件に読み替えない。


## session解放と逐次モデル切替

```bash
python tools/browser-webgpu-poc/serve.py --artifacts /private/evaluation \
  --contract birefnet-fp32-means-01 --lifecycle
PLAN36_DISPOSABLE_BROWSER=1 PLAYWRIGHT_CORE_PATH=/private/node_modules/playwright-core \
node tools/observe_browser_lifecycle_poc.cjs /private/new-lifecycle-observation /private/windows-state.json
```

GPU有効、BelowNormal、fresh blankの専用Chromeとその起動receiptが必要。
`lifecycle.html`はHR1run→dispose ack→Worker terminate→別Workerで補正1run→同じ解放を逐次実行。
同じHR出力を補正へ連結するページではなく、固定captured入力によるsession切替診断。
各出力のSHAを過去のGPU原寸出力へ照合し、不一致なら後続を止める。
Workerのdisposeはsession.releaseをawaitしてdevice.destroyを要求する。意図したdevice破棄のlostを新規故障にしない。
load時の既存session上書きを拒否。中止はWorker terminateで、自動retryしない。
load readyにはadapter準備・file取得/SHA・session.createの別時間を記録する。
`diagnostic:false`の場合だけverbose/profilingを無効化し、通常診断ページの既定設定は維持する。

observerは1CDP接続で状態を記録し、Windowsの当該browser子孫processメモリとGPU全体使用量を採取する。
真のpeakやアプリ単独VRAMではない。timeoutは同じjobを残してreceiptを書き、reload/再推論しない。
[初回結果](../../docs/browser/validation/2026-10-31-serial-model-lifecycle.json)は両SHA一致。
RAM集計のhashtable不具合は補足観測で修正を確認し、今後のobserverもPSCustomObjectを使う。
古い失敗サンプルを成功値に置換せず記録する。


最大面積の別測定はserverに`--hr-input-set full-reference`も指定し、observer末尾へ
`reference-square-2000`を追加する。各モデルの入力caseと過去出力SHAの対を固定して選択し、
未対応caseやconfig不足は拒否する。[結果](../../docs/browser/validation/2026-10-31-serial-model-lifecycle-square.json)。
RAM12/12観測に成功したが大きいmemory指標があり、快適さの合格とは扱わない。


storage cache比較はobserver末尾へ`reference-square-2000 disabled`を指定する。
省略時は`default`で、ORT既定のprovider optionsを維持する。
`disabled`だけが新しい許可値で、Workerは`storageBufferCacheMode:'disabled'`をWebGPU EPへ渡す。
未対応値は拒否する。結果readyにも要求modeを残すが、それだけで低メモリ動作を証明しない。
[準備・一次資料](../../docs/browser/validation/2026-10-31-native-storage-cache-investigation.json)。
実験GPU runは未実施。出力SHA・資源・時間の比較が通るまで製品設定へ採用しない。


### HR段階分割の候補生成（オフラインのみ）

`tools/partition_browser_onnx.py`は既存ONNX1.23.2のExtractor/external-data APIを使用する。
`--onnx`・`--source-sha256`・未作成の`--output`で構造と転送量だけを調べ、
`--pack --external-sha256`を付けると検証済みstageファイルを非公開出力先へ生成する。
対象は固定`model-fp32-means-01.onnx`と元の`model.onnx.data`。
`--target-mib 4096`はcutを選ぶ論理output量の目安であり、実メモリ上限ではない。

小graphの参照・packing検証は`OPENBLAS_NUM_THREADS=1 python -m unittest discover -s tests -p test_browser_onnx_partitions.py`。
実46stageのGPU/画質/資源/latencyは未受入で、本体や公開配布へ自動採用しない。
結果: `docs/browser/validation/2026-11-01-hr-stage-artifacts.json`。


2026-11-02: Windows nativeの共有`observe_browser_local_app.cjs`で`PLAN36_CONTINUOUS_RESOURCES=1`を設定すると、既存browser_resource_streamの200ms継続観測を開始前admission後に有効化する。system空きRAMは既存slow観測で維持し、高頻度側はbrowser RAM/GPUを確認。終了時はcollectorを停止し、保存sampleのbudget再判定・欠落/切詰め/collector errorの拒否を行う。live callbackを失ってもcompleteを資源合格にしない。Windows native PIDの確認が必須、他hostには適用しない。新規GPU要求を追加せず既存診断CLIを再利用。

shared sourceを変更せず使用した実Chrome MODNetでPNG SHA一致/collector2個停止/browser終了/GPU復帰確認、31observer/全domain526pass。private transport adapterは固定ファイル応答へ置換するだけであり、本番HTTP/CORS受入ではない。従来のsample取り逃しやasync flag上書きを含む旧private observerを次の検証へそのままcopyしない。証拠: image-studio/docs/browser/validation/2026-11-02-shared-continuous-observer.json。

共有observerで別の許諾済み合成PNGを評価する場合は、`PLAN36_SYNTHETIC_FIXTURE`（非公開ファイル絶対path）と`PLAN36_SYNTHETIC_FIXTURE_SHA256`（期待する64桁小文字SHA256）を両方明示する。未指定なら既存固定合成素材を使用する。起動前に通常file/32MiB以下/PNG signature/SHA一致を検証し、reportにはpathではなくSHAを記録。staged HRの固定参照入力はこの指定で置換できない。個人写真を自動探索せず、使用許諾済みの合成素材だけを指定する。

`PLAN36_RUN_COUNT=1..5`は通常の補正OFFモデルについて同じ写真・同じ設定の明示再推論を直列実行する（既定1、staged/refineは1のみ）。同browserで各回PNGを個別保存し、初回SHAと照合。再開始前admission、元の全体deadline、継続collectorを維持し、失敗・予算超過・出力差では次回を開始しない。`completedRuns`に実完了回数を記録し、`modelStarts`は開始した全回数。従来status名のoneは互換のため保持し、回数はこの配列で判定。モデル選択の失効確認は最終保存後だけ行う。3回等の短い繰返しは長時間/複数写真/モデル往復推論の受入ではない。
