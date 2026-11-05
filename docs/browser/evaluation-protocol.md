# 非公開比較評価の準備（A06準備）

2026-10-31。ユーザー指定の生成画像2件と数値評価用の寸法変種でROCm参照セットを準備済み（A06）。
これはONNX/WebGPUの数値・画質受入ではない。
既存Vulkan評価は参考情報であり、本計画の実端末WebGPU合格の証拠にはしない。

## 評価セット

人物写真・派生alpha・trimap・顔座標はリポジトリ外の非公開ディレクトリに置く。
各画像にランダムID、利用許諾の根拠、元ファイルSHA256、寸法、EXIF向き、特徴をローカル台帳に記録。
ファイル名・人物名・画像内容は公開レポートに含めない。

必要な特徴: 縦長、横長、長辺2000、非整除寸法、縮小が必要な2000超、
細い髪、眼鏡、半透明、服と背景の近似色、細い輪郭、前景/背景アンカー不足。
1画像で複数条件を満たしてよい。合成画像だけで実写真の画質受入を代替しない。

## ROCm参照

1. 現行作業ツリーのcommitと差分、Python依存一覧、GPU/driver/ROCm、モデルrevisionと重みSHA256を保存。
2. `IMAGE_STUDIO_BACKEND=rocm` を指定し、実際のアプリと同じRGB/方向/thumbnail処理を通す。
3. 前処理後RGB、HR alpha uint8、trimap、補正後alpha、rembg後RGBA、背景合成RGBをローカル保存。
4. 補正OFF/ON両方を保存。スキップ時は理由を記録。顔座標は顔機能比較用に別保存。
5. 画質比較は段階ごとに行う。最終合成だけではexport誤りと前後処理誤差を分離できない。

## 計測と判定

- alphaは0〜1へ正規化してMAE、最大絶対差を計算。trimap未知領域のMAE・最大差も別掲。
- 境界領域の画素数を併記し、空集合をゼロ誤差として扱わない。
- 確定領域の違反数、不透明画素のRGB不一致数、画像寸法を確認。
- 同じ背景色の合成を等倍で髪/眼鏡/服ごとに確認し、色縁と欠損を記録。
- 許容差はPoC測定後に根拠付きで決める。未設定の現時点では合格にしない。
- coldはモデル未取得、warmは取得済みとして分離。取得bytes、取得時間、session初期化、初回/再推論、切替時間を測る。
- 端末OS/ブラウザ版/GPU/driver、WebGPU limits、CPU配置演算、device lost/割当失敗を記録。GPUメモリ推定と実測を区別。
- BiRefNetは全2048モデル、ViTMatteは長辺2000を含む縦横/非整除寸法で判定。小型演算probeだけで通過にしない。

A06完了には許諾済みセットと全参照出力が必要。公開資料には匿名ケースIDと集計値・環境だけを記載する。


## 生成画像と実行ツール（2026-10-31追記）

ユーザーが「適当に生成してください」と指定したため、架空の人物をbuilt-in image_genで生成。
非公開領域 `/home/yamato/otama-homelab/image-studio-browser-evaluation/inputs/generated-portrait-01.png`
に保存した。1122×1402 RGBで、髪・眼鏡・近似色の服・薄手の布を含む。
入力SHA256と生成根拠は同領域の `dataset.json` に保持。画像や推論結果はGitへ追加しない。
生成時の狙いは「単独の架空の成人、細い髪、透明レンズの眼鏡、灰色の服と薄いスカーフ、灰色の背景、自然光」。
実際のサイズは生成指示の希望2048×2560より小さく、2000px評価ケースとしては扱わない。
生成画像のテストは変換・処理の比較に使えるが、実写真への一般化やground truthによる精度を証明しない。

参照採取は [capture_browser_reference.py](../../tools/capture_browser_reference.py) をROCm環境で実行する。
既存 `change_background` を呼び出し、プロセス内の観測wrapperで入力RGB、HR alpha、trimap、
補正alpha、合成RGB、透過RGBA、依存版、ソースSHA256を保存する。既存サーバーコードを書き換えない。
faceは明示optionのみで、既定では未実行。ROCm以外を拒否し、出力はrepo外・新規directoryに限る。

```bash
IMAGE_STUDIO_BACKEND=rocm python tools/capture_browser_reference.py \
  --input /private/evaluation/inputs/generated-portrait-01.png \
  --output /private/evaluation/reference-01 \
  --provenance 'user-authorized generated evaluation image; see local dataset.json'

python tools/compare_browser_alpha.py \
  --reference /private/evaluation/reference-01/refine-on/alpha.png \
  --candidate /private/evaluation/browser-01/alpha.png \
  --trimap /private/evaluation/reference-01/refine-on/trimap.png \
  --output /private/evaluation/comparison-01.json
```

入力decodeはPillow EXIF transpose→RGB→numpyの契約で、Gradio自身のdecode差は含まない。
実行環境が稼働版と異なる場合は `--app-dir` のソースと依存の差を記録する。
現ホストのtorchはCUDA版でROCmではない。稼働PodにはROCmと固定revisionのモデルcacheが存在するが、
参照採取はまだ実行していない。GPU役割・メモリ・他処理との競合を確認して実行環境を選ぶ。
比較ツールは境界MAE/最大差と確定領域違反を記録し、空の境界はnullとする。
閾値未確定なので `measured_not_accepted` とし、数値を得ただけで合格にしない。


## 1件目のROCm参照（2026-10-31実測）

[匿名化した採取・整合性結果](validation/2026-10-31-rocm-reference-01.json)。
固定モデルcacheとROCm環境を利用し、作業ツリーのGPU/backend/refinementの3ファイルを
Pod一時領域へコピーして別プロセスで実行した。稼働サーバーソースは変更していない。
参照画像と完全なreceiptは非公開領域 `image-studio-browser-evaluation/reference-01/` に回収済み。

- Radeon 8060S、torch 2.12.1+rocm7.2、ROCm HIP 7.2.53211。
- 1122×1402の生成入力で補正OFF/ONとも採取成功。trimap未知190,268画素、背景598,348、前景784,428。
- 採取呼出し時間はOFF 4.39秒、ON 42.03秒。中間PNG観測保存を含み、imports/重みSHA計算は除く。
  OFF→ONを同一プロセスで逐次実行しHR重みを再利用。cold/warm性能比較には使わない。
- PyTorch allocated peakはOFF 5,392,811,008 bytes、ON 7,082,481,664 bytes。
  これはtorch allocatorの指標で、端末全体のGPUメモリ実測ではない。
- 各PNGのSHA、shape、透過RGBAとalphaの一致、不透明画素RGBの完全保持を確認。
- 補正ONのtrimap確定領域違反0。OFFはthresholdから作ったtrimapにalphaを強制しないので、
  OFFの確定域偏差カウンタを失敗判定に使わない。

顔座標は未採取。横長・長辺2000・非整除・縮小入力・アンカー不足のケースも未完。
A06は継続中であり、A07以降の全モデル判定は未開始。


## A06参照セット準備完了（2026-10-31）

[セットの検証記録](validation/2026-10-31-reference-set.json)。ユーザーの生成指定に従い、
独立した生成場面2件を用意し、形状・padding評価にはPillow LANCZOSによる寸法fixtureを追加した。
fixtureは元の写真の比率や画素を変えており、独立した場面や実写真の多様性とは数えない。

| ケース | 評価入力→背景処理寸法（幅×高さ） | 目的 |
|---|---|---|
| 生成縦長原寸 | 1122×1402→同寸法 | 細い髪、眼鏡、灰色服、薄手の布 |
| 縦長2000 | 1601×2000→同寸法 | 長辺2000、非整除幅、顔/頭頂/顎座標の参照 |
| 横長2000 | 2000×1333→同寸法 | 横長と非整除高さ、別生成場面 |
| 正方形2000 | 2000×2000→同寸法 | 現行の最大入力面積 |
| 縮小経路 | 2001×1601→2000×1600 | 長辺2000超のthumbnail処理 |

各ケースで補正OFF/ON、入力RGB・HR alpha・trimap・補正alpha・最終透過/合成を採取。
[検証ツール](../../tools/verify_browser_reference.py)で各ファイルのSHA、mode、寸法、
alpha一致、不透明RGB保持、補正ONの確定領域を確認した。
顔座標は縦長2000で取得して非公開receiptに保持。公開記録には座標値を含めない。
別途、全背景/全前景/未知のみ/背景アンカーなし/前景アンカーなしの5数値fixtureで
補正スキップと元alpha保持、モデル未ロードを確認した。

採取ツールは`--evaluation-size WIDTH HEIGHT`で寸法fixtureを明示し、receiptへ記録する。
顔参照を採る際には観測wrapperを先に外し、頭頂用の追加HR推論が補正ONの保存結果を
上書きしないようにした。全ケースの参照整合性は顔採取後に確認済み。

完全な画像・顔座標・入力台帳・依存freeze・元commit/差分は非公開評価領域に置く。
公開するのは匿名ケース、集計値、ソース/重みSHAと環境だけ。
転送切断で破損したファイルはSHA確認で拒否し、完了済みの参照を再取得した。
推論を転送失敗のために再実行していない。ONNX比較と境界の画質受入は次段階で行う。

## ONNX変換環境の準備

非公開評価領域の`onnx-env/`にvenvを作成。`--system-site-packages`で既存torchを再利用し、
torch 2.12.1+cu130、transformers 5.18.0、ONNX 1.23.2、ORT 1.31.1、onnxscript 0.7.2を確認。
完全なfreezeは`onnx-pip-freeze.txt`。既存global環境を更新していない。
継承した未使用datasetsとhuggingface-hubには依存警告があり、採用構成の再現環境整備時に除く。
変換に使うimportは成功したが、これだけでexport成功とはしない。
固定重みはROCm参照と同じSHAを確認してローカルに保存した。

[ViTMatte exporter](../../tools/export_browser_vitmatte.py)はまず512pxの演算調査と
native ORT CPU比較を行う。dynamic寸法は32の倍数で32〜2048を要求し、
最終判定では上記参照画像をprocessorでpadした現行寸法を比較する。
補助関数の変更を使う場合は明示optionとし、変更前との数値差も測る。
512pxの成功だけでA09を完了としない。


## 合成色縁比較の準備（2026-10-31）

[compare_browser_composites.py](../../tools/compare_browser_composites.py)は、保存済みのGPU由来alpha PNGを
SHA指定で読み、モデルをロードせずに参照環境のrembg前景色推定を実行する。
最初にROCm参照alphaからRGBAを再生成し、保存済みtransparent.pngと画素一致しなければ停止する。
そのcontrolが通った場合のみGPU alphaで処理し、不透明RGB保持を確認して、
オフホワイト/白/黒/青の合成RGBを未知領域と全体で比較する。

実行は固定依存のCPU制限付き隔離環境で行う。端末上の重い前景推定は追加しない。
画像出力先はrepo外の新規directoryのみ。引数例:

```bash
python tools/compare_browser_composites.py \
  --reference /private/reference-01/refine-off \
  --candidate-alpha /private/browser-comparison/alpha.png \
  --candidate-sha256 <保存済みalpha-PNGのSHA256> \
  --output /private/composite-comparison-01
```

現段階は構文検査とmetricsの符号付き差分/領域/空集合チェックのみ。
実rembg校正・全ケース合成計測・髪/眼鏡/服ROIの目視は未実施。
この比較はalpha差がnative前景推定/合成に与える影響を調べるもので、
まだ実装していないブラウザ前景推定kernelの等価性を証明しない。


## 原寸1件のnative前景色・合成比較（2026-10-31）

[計測記録](validation/2026-10-31-birefnet-composite-reference-01.json)。CPU1/RAM2GiBの隔離Podで実行し、
参照alphaからのRGBA再生成が画素一致。GPU由来alphaでも不透明RGBを完全保持した。
4背景色の未知領域RGB平均差は0.346〜0.616/255、最大12〜18/255。
前景RGB自体の未知領域平均差0.859/255、最大16/255。

各背景の最大RGB誤差付近96pxをagentが確認し、選んだ髪輪郭の欠落や新たな広い色縁は明らかでなかった。
不透明度/明るさ差は残る。髪patchのみの確認で、眼鏡/服/残り4ケースの判定ではない。
公開資料へ画像やROI座標は含めず、全画像はprivate領域に保持した。
回収10ファイルのSHA/bytesを確認、memory peak約1.00GB/2GiB、OOM0、Pod削除済み。
初回は移設したscriptのrepo判定が`/`となる引数検証不具合で処理開始前に停止し、
実際の.git祖先から判定するよう修正してから実行した。追加GPU推論はない。
ブラウザ前景色kernelの検証・品質受入は引き続き未完了。


### 2026-11-02: Playwright応答差替えによるCORS検証の限界

Playwrightの`route.fulfill`はcross-origin応答にACAOがないとrequest Originを自動追加する（取得済みcoreBundle.jsの`_maybeAddCorsHeaders`を確認）。従って「欠落ヘッダーでも通った」を実CORS成功としない。負例は明示空ACAO/誤originで拒否を確認し、真のheader欠落は実HTTPで別途検証する。公式WASMの実Chrome Worker診断では空/誤originをfetchで拒否、正originだけSHA一致＋ORT初期化に成功したが、実R2配信やモデル実行の受入ではない。初回control不合格も保持。証拠: validation/2026-11-02-native-cross-origin-wasm.json。


2026-11-02: async OS観測中の停止flag消失を修正。mutable flagをawait前に読む論理OR代入ではなく、観測完了後に最新flagを読んで保持する。CSP callbackをawait中に発火する回帰testは旧codeで失敗/修正後成功。run statusだけを受入証拠にせず、保存sampleをbudgetへ再評価する。今回Lite disabled01はfunctional PNG一致でもGPU増加1192MiBで1GiB枠不合格、固定02は1063MiBで正しく停止。証拠: validation/2026-11-02-lite-disabled-cache-and-sticky-stop.json。


## 2026-11-02 固定foreground WASMの原寸5形状校正

[原寸5形状のport検証](validation/2026-11-02-five-case-foreground-port-parity.json)では、実装済み固定foreground WASMを保存済みalphaへ適用し、数値処理の差とモデル由来の差を分離した。ROCm参照と同じalphaでは5件ともnative RGBAのRGBが全pixel一致。現HR graphの実WebGPU alphaでも、既存native rembgによるRGBAと全byte一致し、既存Pillow合成の4背景×5形状のPNGとも全RGB一致した。不透明RGBとalpha保持も照合済み。既存のforeground-runtime/foreground-rgba/composite-rgbを使い、WASM上限512MiB・最大使用352,452,608byteで処理した。Nodeの処理系確認であり、ブラウザー最大寸法のRAM/VRAM・Worker/CSPの確認とは分ける。

出力を辿る際は、remote-native-fp32meansのnative CPU alphaと、remote-hr-browser-compareのWebGPU alphaを区別する。後者のrawSHAは既存5形状WebGPU検証に一致し、alpha PNG SHAは従来native合成比較のcandidate SHAと一致する。旧比較が古い候補だったという初期の説明は誤りで、WebGPU側の既存native結果は現graphとして有効。追加探索したnative CPU alphaの結果は別branchに保持する。

ここで確認したのは同じ入力alphaに対する前景色portの数値一致であり、異なるモデル/providerのalpha差や、細い髪・眼鏡・布の見た目を合格にするものではない。参照ROCmとの差分・未知領域の値は従来どおり保持し、目視/利用者受入と根拠のある画質閾値は未確定。正方形2000²の本体HR＋Matteは[RAM admissionで推論前停止](validation/2026-11-02-hr-matte-square2000-admission.json)しており、foreground単独の成功を本体全体の最大寸法受入へ流用しない。

## 2026-11-03 Linux Chromiumのprofile再利用とdownloadの切り分け

Chromium153.0.8010.12の既存検証profile再利用では、MODNet出力download時にbrowser SIGSEGVを記録。スクリーンショットなしでも再現し、同一PNGの単独Blob保存は成功した。新規空profileではmain11のMODNet→白背景→crop→A4 PNG/PDFが完遂し、独立画素/metadata照合と作成済PDFのoffline再保存も成功した。新規profileで通った結果を、再起動後のwarm cache受入へ広げない。

[上流issue42506](https://github.com/microsoft/playwright/issues/42506)にはprofile再起動とdownloadに関する共有Chromium側の報告・155修正があるが、こちらのnative stackが同一原因と証明されたわけではない。今後はbrowser版/profile生成・再利用/同一browser内のcache利用を分けて記録する。profile Historyの削除や安全設定の緩和で受入を作らず、更新後browserで再利用条件を確認するまで残件とする。[観測・独立照合](validation/2026-11-03-linux-profile-download-isolation.json)。

### 2026-11-03追補: 既存Playwright指定155で保持profileの再起動条件を確認

既存CLIが指定するChrome for Testing155.0.8059.12/revision1247だけを公式installerで追加（no-shell/no-remove、app lock/常用browser不変）。153で失敗したmain11/no-screenshot手順の実行binaryだけを155へ変更し、既存profile・History・cacheをそのまま使って全保存経路が成功。正常終了後に同profileを再起動した2回目も成功。両回model network0、PNG/PDF/crop各byte一致、独立画素・300dpi/用紙/PDF照合pass。

今後のLinux受入は既存Playwrightが指定する対応binaryを使い、153を黙って再利用しない。旧binary/失敗証拠は再現用に保持する。155のこの条件でprofile再起動後warm保存の残件を限定的に閉じるが、全機種/全版を保証せず、native原因同一性も断定しない。[版・binary SHA・2実行結果](validation/2026-11-03-linux-updated-browser-warm-chain.json)。


### 2026-11-03: CPU成功PNGの4背景・等倍ROI比較（F02部分）

保存済みのCPU正方形2000²/縦長1601×2000のfinal RGBAと、対応する既存ROCm参照final RGBAを使用し、既存composite-rgb.mjsと同じ整数丸め式で白/黒/青/オフホワイトへ合成した。追加モデル推論/依存なし。既存compare_browser_composites.metricを再利用して全体/参照trimap未知領域のRGB差を記録。全体RGB MAEは正方形0.00349〜0.00539/255、縦長0.00421〜0.00624/255、最大差はそれぞれ50/24。平均の小ささで局所最大差を合格扱いしない。

agentは8plateで髪境界・眼鏡・布・最大alpha差付近を等倍確認し、選んだ範囲にCPU版だけの広い欠損/新たな広い色縁は目立たなかった。局所opacity/edge差は残る。plate64tileを保存PNGから独立decodeし、入力cropの合成RGBと全pixel一致をassertして1:1/補間なしを確認。画像/ROI座標はprivate評価領域だけへ保持し、repo receiptは匿名caseと集計値/観察範囲に限定。

これは合成画像2形状の選択crop比較で、native参照をground truthとせず、元のモデル/HR/trimap/前処理差を単独に帰属できない。数値許容差/他画像・実写真/人の画質判定/全shape・端末は未完。F02/A11の最終合格を付けない。根拠: `image-studio/docs/browser/validation/2026-11-03-cpu-final-composite-quality-review.json`（evaluation-protocol内ではvalidation/同名）。

## 2026-11-04: 現source11のCPU/GPU差と保存形式の整合

同じsource11ペア・同じ合成入力のnative保存済みRGBAを比較した。両backendの
処理graph/精度が異なるため、相互をground truthにせず、過去の補正入力一致probeの
「1段階以内」をこの最終pipeline全体の合格閾値へ流用しない。

| 項目 | 観測 |
|---|---|
| alpha差 | 1,572,528画素中8,201画素、MAE0.006146 U8、最大16/255 |
| 差の裾 | 8段階以上22画素、16段階1画素、32段階以上0 |
| 差の位置 | 全て少なくとも片方のalphaが半透明の領域。これはtrimap未知領域や人手注釈ROIと同じではない |
| 不透明画素の入力RGB保持 | CPU770,880画素/GPU770,798画素、それぞれ不一致0 |
| A4 PNG/PDFの画素 | CPU/GPUそれぞれPDF内の2480×3508・8bit DeviceRGB画像をdecodeし、対応PNGの全26,099,520 RGB bytesと一致 |
| PDF配置 | 1ページ・595.2×841.92pt、同画像をページ全体へ1回描画。D07の画素由来寸法 |

最大差位置は(x504,y242)、CPUalpha250/GPU234。黒/白背景の数値合成差も記録したが、
sRGB code-valueの比較であり知覚評価・linear-light指標ではない。
このalpha集計は先行固定出力の観測と一致し、新しい退行や許容差を発見・設定したものではない。
保存RGB整合と不透明RGB保持は確認できたが、一般写真の品質、HR/Matte段階別の原因、
trimap確定領域違反、目視の許容判断、実プリンター倍率/色の合格は示さない。
[現候補の画素とPDF検証](validation/2026-11-04-source11-pixel-and-pdf-integrity.json)を参照。
新しいモデル推論・取得・画像の外部送信・派生比較画像の生成は行っていない。

## 2026-11-04: 同写真の補正OFF→ON→OFFと保持mask再利用

新作業候補c87924e5…で実AMD GPU/同写真1086×1448の3PNGを保存。修正前6275e161…の対応3PNGと全byte一致し、OFFに戻したPNGも最初のOFFと一致した。ON→OFF時の再HR計算を省く性能改善で、モデル/重みの変更ではない。ON/OFFのalpha変更185022px、最大184/255、平均0.417597/255は補正の変化量で、ground truthに対する誤差ではない。不透明部分の入力RGB不一致は3出力とも0。

保存した同run OFF alphaから既存Python make_trimap/OpenCV4.11.0で参照trimapを再構成し、未知領域別の変化とON alphaの確定領域違反0を記録。これはinterceptしたON Worker入力ではなく、任意動的実行/実trimap対応や一般画質を証明しない。許容差・人の画質判定・全shapeは未完のまま。
[数値・入力来歴・native観測](validation/2026-11-04-mask-reuse-off-native-optimization.json)。


## 2026-11-04: 新repo固定ペアのHR補正ON/OFF画素照合

新repo713d404b…/artifact620c087b…のCPU/GPU各OFF→ON→OFFを実保存。各6PNGは旧構成の各基準と全byte一致し、不透明入力RGB不一致0。CPU/GPU alpha差はOFF最大7・MAE0.0520658456・68,725画素、ON最大16・MAE0.0061461545・8,201画素。ONは先行source11の最終pipeline集計と一致する。初回ad-hoc検査で過去のmatched-input probeの1段階閾値を誤って流用しassert失敗したが、各旧基準byte一致と既存最終pipelineの条件を確認して検査対象を訂正。アプリ変更/再推論なし。差を一般品質の合格へ置換せず、F02の数値許容差/他画像/全shape/人の判定は未完。

[同一候補四構成の証拠](validation/2026-11-04-clean-paired-four-choice-native.json)。保存PNGから再実行できるpixel verifierはprivate paired-clean-repository-gpu-refine-toggle01/verify-four-choice.pyに保持。
