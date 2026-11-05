# ADR 002: ML周辺処理は既存ライブラリの再利用を先に評価する

2026-10-31。状態: 再利用優先の方針を採用。Transformers.js全体の実行互換性・本番採用は未判定。
利用者の「transformer.js」「MLC」という指摘を受け、独自loader/前処理/cacheを前提にした順序を見直す。
Vite/ReactのADR001とは別の、推論・画像処理層の判断である。

## 比較と現在の優先順位

| 選択肢 | 再利用を期待する範囲 | 今回の判断 |
|---|---|---|
| Transformers.js | model/processor、WebGPU指定、取得・browser cache・WASM cache、external data、session options | 第一候補。既存APIで成立する範囲を先に実装・比較する |
| ONNX Runtime Web直接 | 既存の固定ONNX入出力、検証済み低レベルsession制御 | 検証基準と不足箇所の薄いadapter。ML周辺全体の独自実装を意味しない |
| MLC/TVM系 | モデルを最適化コードへ変換するコンパイラ基盤 | 比較対象として残す。独自MLコードを減らす初手ではTransformers.jsを先に評価する |
| WebLLM | MLC系のブラウザLLM推論 | 公式の対象はLLM。今回の人物マッティング用の既成pipelineとしては選ばない |

根拠: [Transformers.js概要](https://huggingface.co/docs/transformers.js/en/index)、
[WebGPU指定](https://huggingface.co/docs/transformers.js/en/guides/webgpu)、
[カスタム配信](https://huggingface.co/docs/transformers.js/en/custom_usage)、
[MLCの役割](https://mlc.ai/)、[WebLLMの対象](https://webllm.mlc.ai/)。
MLC自体をLLM専用と分類していない。今回の第一候補判断は、model/processor/cacheをまとめて再利用できる範囲を重視したもの。

## 確認した実装と版

npm公開版`@huggingface/transformers`4.3.2の選択したソースファイルを取得し、実行・installせず読んだ。
`VitMatteForImageMatting`、`VitMatteImageProcessor`、browser/custom/WASM cache設定、
external dataと`session_options`の入口が存在する。
別途main commit `656d627317100ac9f9bb7aa7952297b71f8c37b5`も確認したが、npmとmainを同一成果物として扱わない。
公開ドキュメントの版表示とも差があるので、採用時はversionと実配布物を固定する。

4.3.2のonnxruntime-web依存は`1.31.0-dev.20260914-8d85527a0`。
これまでのPoCで使った1.31.1とは異なる。既存のGPU比較を、そのままライブラリ経由の合格証拠に移さない。
依存overrideで同じだと推定せず、薄いadapterの検証時に実際のruntimeとmodel SHAを記録する。
[確認記録](validation/2026-10-31-ml-library-reuse-review.json)。

## 実装範囲を減らす方針

1. ViTMatteの標準processorとmodel APIを第一候補にする。既存の固定Base重み・変換graph・
   `pixel_values`/`alphas`・FP32・do_resize=Falseを維持し、既存の入力tensorと比較する。
   サンプルで使われるsmallモデルへ無断で置き換えない。
2. HRはカスタムONNXと入出力名`pixels`/`alpha`をlibrary APIへ渡せるか確認する。
   loaderが対応済みと推測したり、BiRefNet liteのサンプルをHR2048の成功根拠にしない。
   必要な違いだけ薄いadapterとし、汎用model loaderをもう一つ作らない。
3. 取得・cacheはlibrary標準機能を先に使い、固定manifest、SHA照合、容量不足UI、削除、
   中止/失効などアプリ固有の要求との差だけを補う。独自OPFS engineを既定採用しない。
4. 写真を外部送信しない条件を維持する。model/runtimeの配信先を固定し、
   不要なHub/CDN fallbackを無効化する。標準設定のnetwork挙動を確認してから公開する。
5. 画像resize/正規化/補間も既存processor/utilityをまず比較する。
   差を測る前にPillow相当の全画像kernelを書き直す方針を取らない。
6. trimap、確定領域保持、rembg前景色処理、crop/印刷/revisionは必要なアプリ要件として保持する。
   既存APIで満たせないことを確認した部分だけ実装・移植を検討する。

## 計画への影響と残る検証

D05のOPFSファイル配置・commit実装は比較案に戻す。整合性・中止・更新・プライバシーの要求は残す。
D06は数値契約と参照fixtureを先に定義し、実装方法はライブラリ比較後に選ぶ。
WorkerでUIを塞がないこと、同時推論1件、古い結果の不採用、保存・印刷の仕様はアプリ側に残る。
過去のPoCは固定モデルの互換性調査として保持するが、その診断ページ群を本番へそのまま移植しない。

次は小さい合成入力のprocessor/cache/通信テストから始める。ユーザー端末のGPU・大容量モデル実験は再開しない。
ライブラリの導入だけで大きなメモリ負荷が改善するとは主張しない。実モデル互換性・メモリは未判定のまま記録する。
A10/A11や製品受入を完了に変更しない。


## 小入力で確認できた再利用（2026-10-31）

[公開版processorの実行結果](validation/2026-10-31-transformersjs-vitmatte-processor.json):
実配布4.3.2 bundleのVitMatteImageProcessorを人工raw画像4件で実行した。
NCHW、32倍数padding、元寸法保持が一致し、保存済みPython processor由来の値と最大差約5.914e-8。
GPU/モデルsession/ネットワーク要求は各0、current RSSの観測最大は約80.1MB。
ORT1.31.1の実JS Tensorを明示注入した限定構成で、標準依存の推論互換性や実ブラウザ受入は未確認。
この範囲は独自の正規化/padding/結合kernelを書く前提を外し、既存processorの再利用を進める。


## 取得/cache APIの小入力確認（2026-10-31）

[AutoConfigとcache制御](validation/2026-10-31-transformersjs-config-cache.json)を実配布bundleで確認。
合成JSONとin-memory cacheに限り、cache hit、remote fallback禁止、破損拒否、env.fetch hookを確認した。
quota put失敗でも未保存configを返す挙動と、local prefixが同じ場合revision引数変更だけではcacheが分離されない挙動も記録。
[薄いadapterの担当範囲](library-resource-policy.md)へ反映し、保存済み/読込済みを区別する。
GPU・model session・実network要求は0。native browser cacheやmodel load受入の代わりにはしない。

## HRの入力名と解放のwrapper確認（2026-10-31）

[人工sessionによる契約テスト](validation/2026-10-31-transformersjs-model-contract.json)で、
公開PreTrainedModelの既定encoder経路はsession.inputNamesから入力を選択し、
`pixels`を変更せず渡すこと、誤った`pixel_values`ではrun前に拒否すること、
disposeがsession.release完了を待つことを確認した。これはHRの実model loadや推論の証拠ではない。
既存wrapperを再利用する余地があり、名前の違いだけを理由に独自loaderを作らない。
また既定エラーログに入力dataが含まれるため、[診断方針](library-resource-policy.md)へ抑止要件を追加した。
モデルsession生成・GPU・実networkは0。

## 固定成果物の読込経路レビュー（2026-11-01）

[読込設計候補](transformersjs-model-loading.md)に精度suffix、配布alias、外部重みの明示mappingを整理。
既定external-data命名は現graphと一致しない。自動設定任せにせず既存APIの指定で接続を試す。
Webの失敗queueとORT fatalログの扱いも確認し、Worker再作成・診断の要件を維持する。
静的レビューのみで、実モデル互換性やA10/A11の判定は未完了。

## 本体統合時の再利用方針（2026-11-01、利用者指示）

各機能の実装前に既存の有名ライブラリ/公式APIを確認し、採否理由を記録する。
部品検証の追加を目的化せず、本体web/へ統合する。リポジトリAGENTS.mdにも記録した。

- UI基盤: ADR001通り公式Vite/React/TypeScript。静的buildでPython runtime不要。
- crop操作: [react-easy-crop](https://github.com/ValentinH/react-easy-crop) 6.2.4（MIT）をweb本体に採用。drag/zoom/keyboard/選択範囲の公開APIを使い、自前の操作kernelを増やさない。
- 本体の画像header検査: 既存image-dimensions2.6.0 + 検証済み薄いpreflightを再利用。
- 推論: [Transformers.js](https://github.com/huggingface/transformers.js)等の既存runtimeを優先する方針を維持。対象BiRefNet/ViTMatteと版の整合性は未受入で、機能を搭載済みとはしない。
- PNG/PDFは既存fast-png/pdf-lib候補を統合予定。cropperは画像生成decoder/encoderではなく、これだけで最終画素・DPI・PDFを完了にしない。

Vite8.3.5/React19.3.1/plugin-react6.1.2/react-easy-crop6.2.4の公式配布metadataを確認してlockfileへ固定。
型検査と静的build成功は実browser操作・性能の証拠ではない。

## 本体crop PNGのlibrary/API接続（2026-11-01）

- react-easy-cropの公開APIでfractional crop範囲を受け取り、公開Web APIのOffscreenCanvasでcrop/resampleする候補を本体に接続。独自resamplerや診断用C/WASMを本体の既定にせず、ブラウザ標準補間と参照の画質を今後比較する。現時点でPillow互換の受入済みとはしない。
- PNG encodeは既存fast-png8.0.0、CRCはcrc-321.2.2、解凍はfflate0.8.3とpako1.0.11のchecksum helper。既存PNG/DPI exporter、bounded decoder、JPEG reader、single-worker-task、download-linksを再利用。vendor sourceを変更せずSHA固定の内部helper aliasは更新時の保守対象として残す。
- mainはBlob/設定/リンクmetadataだけを持ち、画素処理をWorkerで行う。RGB/RGBA間のbyte並べ替えは薄いlayout glueで、背景合成や独自色変換を追加しない。
- 作成後の明示保存、中止/旧設定の結果拒否/URL猶予は既存部品を使用。背景モデル/PDF/用紙機能を完成したと扱わない。

## 本体の用紙・PDF接続（2026-11-01）

pdf-lib1.17.1（MIT）の既存公開API adapterをそのまま利用して用紙PDFを接続。
PDF専用importはWorker内の必要時だけにし、通常PNGの初期bundleに混ぜない。
独自PDF writer/PNG圧縮/配置kernelは追加せず、既存paperLayout/renderPaperRgb/
createPngExporter/createPaperPdfExporterと同一の用紙RGBを使う。
4用紙/自動枚数/余白/間隔は既存仕様から計算し、UIも同じlayoutを参照する。

## Crop UIの公開座標APIと既存テストライブラリ（2026-11-01）

react-easy-cropのpixel座標は内部で丸められるため、公開onCropAreaChangeの割合座標を原本寸法へ換算する。roundCropAreaPixels=falseだけではpixel callbackの丸めを防げない。同aspectの用途切替はgeometry callbackを発行しないため、画像ID/aspectで範囲を保持し、media読み込み完了を保存条件へ加えた。

UI回帰確認はVitest5.0.5 / React Testing Library16.3.3 / DOM10.4.2 / jsdom26.1.0を採用。公式文書のjsdom環境とlabel/role操作APIを使い、独自DOM runnerを作らない。jsdom30.1.3はNode24.8.0のengine範囲外のため撤回し、対応版26.1.0へ固定。テスト専用依存で配信bundleには含めない。3件pass、型検査/static build pass。実browser/Canvas/Worker保存は未受入。

参照: https://vitest.dev/guide/environment.html / https://testing-library.com/docs/react-testing-library/intro/

## カスタム寸法の本体接続（2026-11-01）

寸法フォームはReact stateとHTML label/input/fieldset、画像操作は既採用react-easy-cropを継続利用。小さい寸法draft契約のために別form engineを増やさず、既存photoPixels/paperLayoutで丸め・収容を共通化する。library公開zoomWithScroll=falseでwheelをページ操作へ残す。4プリセットと9〜152mmのcustom寸法/未確定値の保存禁止/用紙収容不可の復帰を本体へ接続。jsdom UI5件・型検査・buildがpass。モデル接続の採否/Transformers.js版差/メモリと実browser受入は未完。exifr7.1.3の公式APIも直接印刷metadata候補として確認したが、本体へinstall/採用はまだしていない。

## 手動framingとlibrary座標API（2026-11-01）

保存cropの正本を既存cropBox（原本px、roundEven後の出力px比、range/u/v）へ接続し、DOM/CSS寸法への依存を外した。従来のmm比によるaspectは24×30等で丸め後px比と異なるため修正した。previewへの写像には既存react-easy-crop6.2.4の公開getInitialCropFromCroppedAreaPercentages / setMediaSize / onCropSizeChangeを使う。ドラッグ/キー中だけonCropAreaChangeの割合をdomain設定へ戻し、resize/aspect変更の内部通知を新しい利用者編集として採用しない。pixel callbackは丸められるので使わない。

フォームはReact/HTMLの既存input/fieldset/button、guideは公開cropAreaClassNameとCSS gradientを使う薄いUI。新たなdrag engine/画像resampler/form engineを追加していない。range/u/vの数値draft失敗と明示確定、旧ファイル失効、寸法変更時のframing保持を接続した。

実libraryコンポーネントを使うjsdom2件で400→200px previewの比例変換とkeyboardの逆写像を確認し、App8件と合わせ10件pass。型検査/static buildもpass。native browser decode/Canvas品質/touch/pointer cancelと全体受入を完了扱いにしない。公開API資料: https://github.com/ValentinH/react-easy-crop 。

## 元寸法の直接印刷とDPI metadata（2026-11-01）

exifr7.1.3（MIT、公式配布、版/lock固定）を採用。JPEGのJFIF/IFD0密度だけを既存parse APIへ渡し、GPS/XMP/ICC/thumbnail/EXIF本体の収集は無効化。bytes入力だけでURLを与えない。silentErrors=falseは公式実装に存在するが同版の型定義にないため、設定変数を渡す薄い接続とした。vendor sourceを変更せず、独自JPEG/EXIF parserは作らない。ライセンス原文を既存NOTICE生成に含めた。

PNGは既採用fast-pngのresolutionを保持し、別のPNG metadata packageを増やさない。既存bounded subclassで重複/IDAT後のpHYsを拒否する。JPEGは物理JFIF→EXIFの順、inch/cmをDPIへ換算し、D07契約どおり両軸300±0.1を検証する。Pillow12.3.0公式sourceのJFIF優先を確認したが、同sourceのEXIF X軸複製/72dpi fallbackまでの全互換を主張しない。欠落/破損tagの比較は残す。

直接印刷では既存paperLayout/renderPaperRgb/PNG/PDF exporterを再利用し、PNG経路はCanvasもresamplerも起動しない。UIは独立したmodeでcrop draftに妨げられず、元のpxでPNG/PDFを明示作成する。PDF writerとrow配置を重複実装していない。

UI11+実cropper DOM2+実metadata parser3+実Worker handler3=19件pass、型検査/static build pass。実handlerはtest環境self/Node Blobで合成PNGを処理し、実browser WorkerやJPEG decode/ICC/直接PDF/印刷の受入ではない。

参照: https://github.com/MikeKovarik/exifr / https://raw.githubusercontent.com/python-pillow/Pillow/12.3.0/src/PIL/JpegImagePlugin.py

## 写真入り用紙previewとjourney（2026-11-01）

用紙の表示は新しいCanvas renderer/画像libraryを追加せず、公開SVG pattern/viewBoxと既存paperLayoutを再利用。元画像URLと小数crop boxを1つのpatternへ渡し、多数配置でも画像DOMを増やさない。生成済みPNGは既存download-linksが所有する同じURLを使い、preview用にencode/URLを複製しない。保存範囲や生成pixelをSVG表示から逆算しない。

準備済みURLはuseCropSaveのrender時にも依存キーを照合し、effect掃除前に古いpreviewを表示しない。初回の段階的開示、stale/中止/失敗/準備完了、DPI復帰はReact stateとHTML semanticsで実装し、新しいrouter/form/state engineを増やさない。正式なhash移動/工程入力の所有権統合は未完。

公開API参照: https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/pattern / https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/viewBox 。DOM契約テストはnative SVG描画品質の受入ではない。

## 候補写真の確認と置換（2026-11-01）

画像preview候補の確認は既存image-dimensions preflightとブラウザ標準HTMLImageElement.decodeを使い、独自decoder/cache/queue engineや新しい依存を追加しない。Blob/URLを候補のまま保持してnative decode promiseを待ち、成功した最新選択だけ採用する。旧編集は失敗/中止で保持し、前のnative promise終端まで次のdecodeを始めない。Abortはsrc除去による停止要求であり、即時物理解放の証拠にしない。

既存input-loadはRGB allocation registryへ登録するWorker経路の契約なので、preview URLのためにその型やregistryを拡張せず、Appの候補採用境界へ薄く接続する。JPEGのnatural寸法はheaderと同一/軸交換のみ、PNGは同一を要求。型検査/buildと37件passはnative decode/色管理・全処理形式/メモリ受入ではない。

参照: https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode 。

## 写真置換確認と離脱通知（2026-11-01）

確認は標準HTML dialog/showModalとReactの薄い接続で実装し、新しいmodal library/focus trapを追加しない。取消を最初のfocusとし、Escapeも取消へ接続。候補Fileはrefに保持し、確認前はpreflight/decode/save失効を起動しない。取消では旧写真/調整/準備済みdownloadを保持し、確定後だけ既存候補decode経路へ渡す。indexへ移動した場合は未確定候補を破棄する。

写真がある間だけbeforeunloadを登録し、再読込/外部移動の標準確認を要求する。hash移動では保持する。pagehideで写真と候補を清掃。ブラウザの制限により通知は保証できず、常設の消失説明を残す。独立工程入力/全rollback/実ブラウザfocus拘束と復帰/実離脱通知は未受入。

参照: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog / https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event 。

## 工程入力を保持するReact境界（2026-11-01）

独立工程の保持に新しいrouter/global state/cache engineを入れず、Reactのcomponentごとのstate/ref寿命とhidden wrapperを利用する。React公式preserving-state/useIdに従い、同じ位置のcomponentを保持し、accessibility IDをinstanceごとに生成する。画素/BlobはReact stateへ移さず各refに保持。非表示のnative photo viewportはunmountする。必要な復旧受渡しだけimperative handleで候補入力へ渡し、確認前のdecode/失効を避ける。

書出の排他には既存createWorkerGate/createSingleWorkerTaskを再利用し、終了待ち中はleaseを保持、停止失敗時はblockedにする。候補previewは標準Image.decodeの全editor共通terminalを待ち、待機中にImage/URLを確保しない。全処理横断のadmissionやGPU資源所有権をこの限定統合で完了扱いにしない。

参照: https://react.dev/learn/preserving-and-resetting-state / https://react.dev/reference/react/useId 。

## 切り抜きPNGを再処理せず印刷へ渡す（2026-11-01）

既存save hookのcurrent-key照合済み成果物を取り出し、標準File snapshotと既存候補input/decode/確認dialogを再利用する。受渡し専用のencode pipelineやstate/Blob cache libraryを追加しない。上流はprimitive input ID/単調crop revisionをvalidatorへ結合し、既存hookの生成完了/保存/成果物参照にも同validatorを通す。新しい画素copy/preview用URL生成はFile受入側の既存読込境界に限り、物理copy量やnative解放の確認は残す。

標準API参照: https://developer.mozilla.org/en-US/docs/Web/API/File/File 。BG/全registryの最終adoptionを意味しない。

## 候補decodeと書出の共通admission（2026-11-01）

全editorで共有する既存createWorkerGateをimageWorkGateから1つだけ供給し、標準Image.decode候補検査と既存single-worker-taskへ渡す。新しいscheduler/queue/cache libraryは追加しない。別処理が枠を持つ間はImage/URL/Workerを確保する前にbusyで拒否し、候補decodeどうしは従来のterminal逐次待ちを維持する。

写真置換時は既存save.invalidateで自分の書出をabortし、save.waitForIdleでgenerate/Worker終端まで待ってから候補検査を開始する。待機中に取消/新選択なら世代照合でdecodeを始めない。候補native decodeのabortはsrc除去後もpromise終端までleaseを保持。候補後始末失敗とWorker停止失敗はgateをblockedにし、再読込まで新規重処理を止める。実メモリ解放やvisible img/SVG描画、将来の推論・合成までの全admissionをこの統合で証明しない。

## SUPPORTと診断ファイル（2026-11-01）

端末情報は標準APIのpresenceを読むだけとし、GPU probe/UA parser/端末fingerprint SDKを追加しない。表示はReactと既存native dialog、保存は既存download-linksを再利用。JSON用の新downloaderや自動送信loggerを作らない。package版はVite標準JSON importで取得し、TypeScriptのresolveJsonModuleを有効にする。

診断payloadをsessionから収集せず、固定9 booleanと固定識別項目だけを組み立てる。標準modal APIなしの環境では非modal表示へ下げ、独自trapを増やさない。元の写真や生成状態は変更しない。取得/cache/GPU稼働診断とnative focus/downloadの受入は別途残す。

参照: https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal / https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static 。

## 処理ごとの標準API判定（2026-11-01）

新しいbrowser検出/UA parserを入れず、実行realmの標準API存在を必要な処理ごとに確認する。mainのWorker不在はBlob copy前、Worker内crop/JPEGの不足APIはpixel decode/Canvas生成前に拒否。PNG直接印刷は既存fast-png/RGB/export経路なのでCanvas/ImageData/bitmap APIを要求しない。既存Worker protocolに固定unsupported-browserを追加し、UIの端末情報導線と明示再試行へ結合する。API存在をnative動作成功と混同しない。

## PNG/PDFの準備状態を分離（2026-11-01）

B09の「一方の失敗で他方の成功を破棄しない」に合わせ、既存save hookを固定3出力枠へ配置する。形式別の独自cache engineや新しいstate libraryを入れず、Reactの独立したhook寿命と既存URL所有権を再利用。共通contentキー/用紙キーに対して形式選択は表示だけとし、出力ごとの旧設定判定を保持する。全busyを集約し、Workerの共通gate/逐次実行は維持。形式切替のために再encode/新Workerを起動しない。

## palette PNGは既存公開APIで展開（2026-11-01）

fast-png8.0.0にconvertIndexedToRgbがあることを固定packageと公式tag sourceで確認。新しいPNG/色変換libraryや手製palette pixel loopを追加せず、既存input adapterへoptional callbackとして注入する。許可する新規形式は8bit indexedだけで、bounded IHDR/IDAT/CRC/metadata policyを維持。RGB参考PLTEをindexedと誤認しない。展開後の正確な長さ/寸法/型を既存境界で検証する。

palette encoderのtRNS実装をdecode正解に流用せず、test fixtureに順序明示の小tRNS chunkを使う。production RGB exporterは変更しない。package/fork/依存更新なし、既存MIT noticeを継承。低bit/grayscale/16bit/ICC/実browser採用は残す。

## packed paletteとAdam7の採否分離（2026-11-01）

同じ公開convertIndexedToRgbを1/2/4bitの通常行へ適用し、新しいpixel loopを追加しない。pixel数/bit数/scanline byte数を分け、既存bounded inflateへpacked byte budgetを渡す。独立fixtureは既存Pillow/libpngで作り、fast-png自身のencoder/decoderだけの往復を正解にしない。比較用Pythonはlocal toolのみでPages runtimeへ入れない。

低bit Adam7は固定upstream helperのstrideが不適合で、独立3fixtureでも正解にならない。decode前拒否を維持し、upstream修正版または別の既存decoderと境界/hiddenRGB/色管理を比較する残件にする。独自Adam7の実装や無断のupstream patch/buildは行わない。PNG全形式/画質の受入を限定対応へ縮めない。

## 2026-11-01 車輪の再発明の再監査（公開本体優先）

利用者の再指示により、機能追加を続ける前に実import経路と独自処理の必要性を見直した。静的ASTでmain.tsx/Worker/dynamic importを追い、type-only importと非到達の評価コードを分ける。本体の到達可能なlocal logicは35 files、うちtools/browser-library-adapterが13 files。これはsource上の到達性で最終bundle解析やrepo全コードの監査完了ではない。識別/hash/import一覧はvalidation/2026-11-01-web-reuse-imports.json。

| 責務 | 実際の再利用 | 独自部分と判断 |
|---|---|---|
| crop操作/preview | react-easy-crop公開API | 共有domain座標との変換だけ。gesture/cropperを再実装しない |
| JPEG decode/Canvas resize | Image.decode/createImageBitmap/OffscreenCanvas | 寸法・世代・所有権の検証。Pillow画質との採否は未完 |
| PNG decode/encode/palette | fast-png8、公開convertIndexedToRgb | **見直し優先**。private API subclassと制約adapterが増えており、このまま汎用codecへ広げない |
| deflate/CRC/checksum | fflate/crc-32/pakoの既存実装 | fixed output budget/Adler照合のみ。独自解凍kernelなし |
| PNG pHYs | fast-pngの画素encodeとcrc-32 | encoder公開入力にresolutionがなく、300dpiの固定chunk検証/挿入を保持。汎用PNG parserへ広げない |
| PDF | pdf-lib | 同じ用紙PNGの埋込とpx→ptだけ。PDF writer/parserの独自実装なし |
| JPEG metadata | exifrのpick対象限定 | DPIの優先順/許容差は製品契約。独自EXIF parserなし |
| crop/用紙座標、RGB配置 | 共通print-geometry/paper-rgb | Python互換の丸め、小数crop、固定余白/間隔と行copy。PNG/PDF/previewで重複計算しない |
| 数値draft/状態 | React/native inputs | 寸法/Enter/Escapeの製品規則。form/state engineを増やさない |
| dialog | native HTML dialog | **今回整理**。2箇所の開閉/focus/fallback/EscapeをuseNativeDialogへ統合し、写真置換のfallback欠落を修正 |
| Worker/保存 | Worker/Promise/AbortController/Blob URL | 失効・固定code・終了待ち・共通1件制限・URL所有権の接続。汎用RPC/queue/cache engineへ広げない |

### PNG代替の確認と保留理由

npm registry metadataはfast-png latest=8.0.0、pngjs latest=7.0.0。取得記録はvalidation/2026-11-01-png-library-watch.json。install/依存変更なし。fast-pngの確認したupstream mainも8.0.0で、packed Adam7問題を修正版へ更新するだけでは解消した証拠がない。

pngjsは定番の全bit深度/interlace候補としてREADMEと実sourceを確認した。README内の古いAPI説明には食い違いもあるため、機能表だけで採用しない。現行repositoryのparser-syncはinterlaceをzlib.inflateSyncへ出力上限optionなしで渡し、format-normaliserはtruecolor/grayscaleのtRNS一致画素をRGBAすべて0にする。後者は当アプリのhidden RGB保持と一致しない。したがってstock APIへの単純置換は採用しない。これは公開repo sourceの比較で、npm配布browser bundleのfixture/資源受入は未実施。

この比較で「適切なライブラリが存在しない」とは結論しない。PNGの追加独自kernelを作る前に、修正版・他decoder/標準ImageDecoder等を同じ独立fixture・CRC・展開量・metadata・hidden RGB・色管理の条件で比較する。標準APIもnative受入を経ずに同一画素と推定しない。制約を外してライブラリだけへ差し替えることも、既存の不足を理由に自前codecを育て続けることも採用しない。

### 未搭載の推論・評価コード

Transformers.js/ORTのloader、cache、processorを第一候補とする既存方針を維持。独自HR/ViTMatte演算やPyMatting C/WASM、資源取得adapterは評価物で、本体import graphにはない。本番採用前に、同じモデル/画質/メモリ条件で標準APIによる置換可能性を再確認する。ML本体を含むrepo全体に「再発明なし」と認定したわけではない。A11/D12とnumerical/資源gateを省略しない。

一次資料:
- https://registry.npmjs.org/fast-png/latest
- https://registry.npmjs.org/pngjs/latest
- https://raw.githubusercontent.com/image-js/fast-png/main/package.json
- https://raw.githubusercontent.com/pngjs/pngjs/master/README.md
- https://raw.githubusercontent.com/pngjs/pngjs/master/lib/parser-sync.js
- https://raw.githubusercontent.com/pngjs/pngjs/master/lib/format-normaliser.js

今回の整理は全92件/型検査/buildで確認。native focus/Tab/物理解放・画質と背景runtime/全体受入は未完。今後も実装前に公式API/既存libraryと同じfixtureの不足を確認し、custom engineの追加を既定にしない。

## 2026-11-01 PNG代替候補の配布物・独立fixture比較

custom decoderを増やす前に、@jsquash/png3.1.1とupng-js2.1.0をnpm registryから私有評価領域へ取得し、tarball SHA512をregistry SRIと照合した。appのpackage/lock/配信物は変更せず、install scriptやWASM初期化もしない。取得tarballは各96,574/11,656byte、評価物はimage-studio-browser-evaluation/png-library-review-2026-11-01に保存。

| 候補 | 確認したこと | 今回の判断 |
|---|---|---|
| @jsquash/png3.1.1（Apache-2.0） | ブラウザWASM/公開decode/init/8・16bit出力。基盤はlibpngではなくRust pngで、参照Cargoは0.17.10（READMEの0.11表示だけを信用しない）。参照Rustの8bit decodeはignore_checksums(true)、公開decode optionsはbitDepthのみ。ImageData constructorを利用 | stock sourceのままではCRC必須条件を満たす証拠なし。配布wasmとrepo sourceの対応・runtime/メモリ・CRCの実挙動は未検証。WASMを起動せず候補保留 |
| upng-js2.1.0（MIT） | 公開UPNG.decode+toRGBA8を既存pako1.0.11で実行。独立Pillow/libpng12fixtureの11件一致、1bit9×11 Adam7は396byte中88byte不一致。PLTEのCRCを壊したfixtureも受理 | 元の形式制限を外すdrop-inとして不採用。CRC/展開量境界と正しいpacked Adam7を公開APIで満たす候補比較を継続 |

UPNGの小fixture検証はtools/check_upng_candidate.mjsで再現できる。候補source/fixture manifest/新しいreport pathを引数にし、public APIを呼ぶだけでpixel kernelやdecoderは作らない。VMは比較実行用で、security sandboxの保証とはしない。入力はhash一致した既知の小合成fixtureに限定した。app本体にはこの評価物をimportしない。

現段階でいずれも採用せず、既存制約を維持する。これはライブラリ不存在の結論でも全形式対応の完了でもない。今後はstock公開APIでCRC/資源/hiddenRGB/形式を満たす候補、upstreamの修正、標準ImageDecoderのnative受入を比較し、採用前にライセンス/NOTICEと同fixtureを照合する。upstream修正/buildが必要なら親AGENTSどおりfork側で管理し、homelab内の独自patch付きcodecを既定にしない。

一次source・配布物:
- https://registry.npmjs.org/@jsquash/png/latest
- https://registry.npmjs.org/upng-js/latest
- https://raw.githubusercontent.com/jamsinclair/jSquash/main/packages/png/codec/src/lib.rs
- https://raw.githubusercontent.com/jamsinclair/jSquash/main/packages/png/codec/Cargo.toml
- 配布file hash/SRIとsource snapshot hashはvalidation/2026-11-01-png-decoder-alternatives.json。

## PDF追加moduleの標準読込境界（2026-11-01）

標準dynamic importと既採用pdf-libを使い、独自loader/cache/SWを追加しない。PDF dependencyの読込をpixel decode前へ移し、module取得/評価失敗を固定codeで説明する。PNGは既存経路のまま追加PDF moduleを要求しない。navigator.onLineによる推測停止や自動reload/無限retryはせず、既存形式別保存状態から明示回復する。HTTP/モデルcacheと完全offlineを混同しない。

## PNG上限の早期確認を既存APIへ集約（2026-11-01）

image-dimensionsの既存header取得と既存PNG decoderの寸法定数を、本体の薄いimageInputへ接続する。UIとWorkerで同じ方針を使い、PNGの形式parser/pixel decoderや汎用policy engineは作らない。保存時に成立しない既知のサイズをnative previewより前に拒否して旧編集を保持する。数値条件そのものを緩和せず、全形式/品質のgateは残す。15files/105件と型検査/build pass、native受入未完。

## 診断と配布物のソース識別（2026-11-01）

Vite標準defineとgenerateBundle/emitFileを再利用し、固定入力集合のNode標準SHA256だけをbuild時に接続する。新しいmetadata/plugin依存やGit/端末/環境変数収集は追加しない。同じ値をアプリ内とbuild-info.jsonへ出し、診断schema v2のbuildIdと照合する。これはソース集合の識別でありfinal dist署名/公開承認ではない。詳細と対象範囲・限界はdistribution-conditions、証拠はvalidation/2026-11-01-web-build-identity.json。公式API: https://vite.dev/config/shared-options.html#define / https://vite.dev/guide/api-plugin.html 。

## 既存dialog部品のfocus復帰を補完（2026-11-01）

HTMLDialogElement.closeとHTMLElement.focusを既存useNativeDialogで利用し、標準modalの通常復帰は再実装しない。APIなしの非modal fallbackと、消えた呼出元から現画面へ戻る不足だけを補う。新trap/modal依存やkeyboard engineは追加しない。111件/型検査/build pass、native Tab/読み上げ/scrollとCSS-only非表示は未受入。公式API: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog / https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus 。

## 8bit grayscaleのデコード再利用とsample配置（2026-11-01）

fast-png8.0.0はgrayscale/gray-alphaのparse/filterを既に実装しており、本体のadmissionが拒否していた。公開変換helperはindexed用だけ。既存評価物のTransformers.js4.3.2 RawImage.rgbもchannel2を扱わず、sample配置だけのために未採用ML全体を本体依存へ追加しない。既存bounded decoderの8bit whitelistへchannel1/2を追加し、png-input境界でgrayのRGB反復とalpha/tRNSを既存rgb-u8/rgba-u8へ配置する小さなcopyを行う。decompression/unfilter/色変換の独自kernel、upstream source修正、新dependencyはない。private decoder adapterの見直し優先という判断は維持し、16bit/低bit/color managementをこのcopyへ継ぎ足す前に再度library/APIを比較する。

grayのPLTEは禁止、tRNSは1値/u8範囲を検査し、indexedと誤解釈しない。CRC/展開量/profile/axis/pixel制約は維持。独立Pillow/libpng12fixtureでRGBA全byteとRGB SHA、直接印刷handlerで同じ用紙PNGを確認。17files/127件・型検査/build pass。native色/向き/資源/全形式とモデル・配信受入は未完。証拠: validation/2026-11-01-web-grayscale-png.json。一次API: https://raw.githubusercontent.com/image-js/fast-png/v8.0.0/src/index.ts / https://www.w3.org/TR/png-3/#11PLTE / https://www.w3.org/TR/png-3/#11tRNS 。

## 16bit truecolor入力と既成normalizerの実比較（2026-11-01）

独自16bit decoderを作る前に、PyPNG0.20220715.0（MIT）の公式wheel SHA256とpngjs7.0.0（MIT）のnpm SRIを照合し、私有評価領域だけで使用した。install scriptやapp依存追加なし。独立PyPNG writer→Pillow12.3.0 decoderのRGB/RGBA16・通常/Adam7計8fixture（955byte）を作成。pngjs公開PNG.sync.readの標準8bit変換はscaleDepthのfull-range丸めでPillowと134byte異なった。変換方針の違いでありPNGjs全体の誤りとはしない。fast-png8.0.0公開decodeのraw16bit samplesは全件一致し、上位byteを既存RGB/RGBA8境界へ配置するとPillow参照と全byte一致した。

本体は既存fast-pngのparse/filter/Adam7をそのまま再利用し、truecolor16の限定admissionとUint16→Uint8のsample packingだけを既存png-inputへ接続。汎用rescale/色管理/PNG kernelや新dependencyは追加しない。private decoder adapter置換の優先課題は維持し、gray16の異なる変換規則や他形式をこのpackingへ無断に拡張しない。stock全range変換へ差し替えて参照条件を緩めない。PyPNGはlocal fixture writerだけでPages/appへ入らない。

18files/138件と型検査/build pass。CRC/資源上限はそのまま。16gray/低bitgray/packed indexed Adam7/ICC/向き/物理memory/native browser/本体モデル・配信は未受入。比較: validation/2026-11-01-png16-library-comparison.json、本体証拠: validation/2026-11-01-web-rgb16-png.json。一次配布物: https://pypi.org/pypi/pypng/json / https://registry.npmjs.org/pngjs/7.0.0 。

## Gray16の階調と互換例外（2026-11-01）

Pillow12.3.0の通常gray16読込はI;16で、直接RGB変換すると値256が255へclipされる。一方、同値のRGB16やalpha付きgray16は上位byteを使い値256が1となる。直接I;16のtRNS変換にもkey257と値1の扱いに差を観測した。legacyの直接変換を正解として白飛びを再現せず、ブラウザでは同じ画素値を持つRGB/RGBA16との表現不変性を採用する。これは明示的なserver互換例外で、全前処理一致やF02完了とは扱わない。

既存fast-pngの16bit parse/filter/Adam7と既存byte packing/gray expansionを再利用。追加はgray16 keyをfull precisionで比較し既存gray-alpha8へ渡す配置のみ。新decoder/色管理/rescale engine/依存はない。PyPNGのraw RGBA16を同値のtruecolor16へencodeしPillowでdecodeした独立reference12件を使い、pngjs skipRescale:trueのalphaとも全件一致。元Pillow結果も保存して差をassertし、互換差を隠さない。

19files/155件と型検査/build pass。RGBA raw/byte/handler比較の限定確認で、native表示・ICC/HDR・資源・ユーザー画質受入は残す。証拠: validation/2026-11-01-web-gray16-png.json / validation/2026-11-01-gray16-library-comparison.json。private adapter置換と全format条件、全体scopeは維持。


## 低bitグレースケール入力（2026-11-01）

1/2/4bitの非インターレースgrayを既存fast-png公開convertIndexedToRgbへ濃淡palette（2/4/16色）として渡す。bit unpackerやdecoder、依存を追加しない。tRNSは拡大前の原sampleで比較し、透明RGBも保持する。Pillow12.3.0の2/4bit直接RGBA変換ではkey1が拡大後の値と一致せずalphaが異なるため、PyPNGの原sample参照を使用し、Pillow RGBとの一致と旧RGBAを別々に保持する。旧サーバーとの全RGBA一致とはしない。

独立24fixture（2,178byte）の18非interlaceは全byte一致、6 Adam7はinflate前に拒否。1/3/9px幅の行padding、不正key、実handlerの直接印刷3経路（Canvas禁止）を確認。20files/183件、型検査/build/dist guard pass（11files/3,208,636bytes）。全68fixtureとmanifestの再生成一致。証拠: validation/2026-11-01-web-low-gray-png.json。

低bit Adam7・ICC/向き/HDR・native表示と物理memory・実機UX・モデル/runtime/cache統合・Pages/R2と全体gateは未完。既存private decoder adapterの置換優先と元のCRC/Adler/寸法/展開量上限を維持。GPU/browser/model/WASM起動・公開なし。


## 前景色推定の再利用再確認（2026-11-01）

IMG.LY background-removal-jsの公開APIを再確認した。removeBackgroundは入力RGBを維持して推論alphaを第4channelへ書き込む。公開applySegmentationMaskも既存maskを適用する入口であり、これだけではrembg decontaminateのforeground推定の置換根拠にならない。設定schemaのmodelはisnet/isnet_fp16/isnet_quint8で、固定BiRefNet HR/ViTMatteの同一重み要件を満たす公開設定は確認できない。従って既成browser背景除去として参考候補に残すが、現在の同一モデル・前景色要件へそのまま採用しない。これは性能や品質が劣るという判定ではなく公開APIの適合性判断。依存追加・モデル取得・実行なし。

参照したmainは可変sourceであり配布版の固定/SRI/ライセンス審査を完了した扱いにはしない。公式source: https://raw.githubusercontent.com/imgly/background-removal-js/main/packages/web/src/api/v1.ts と https://raw.githubusercontent.com/imgly/background-removal-js/main/packages/web/src/schema.ts 。PyMatting公式foreground APIはnumpy.ndarray入力のestimate_foreground_mlを提供する（https://pymatting.github.io/foreground.html）。この確認だけで既成WASM実装が存在しないとは結論しない。

既存C診断移植の小参照一致はvalidation/2026-11-01-foreground-c-port.jsonにあるが、browser用WASM成果物/2000px資源/製品採用は未完。upstream由来sourceをbuild・配布する場合は親AGENTSのfork管理方針を満たす経路でsource差分/build/releaseを管理し、診断Cを本体へ直接取り込まない。


## checkpoint1 runtime版整合の候補（2026-11-01）

Transformers4.3.2の既定ORT Web dev版を、既存ORT1.31.1の受入として扱わない。公開bundleの通常browser importをesbuild aliasで取得済みWeb/Common1.31.1へ揃え、source修正なしの候補buildが成立。global ORT注入branchはdevice listを構築しないため製品経路には選ばない。既存Common注入CPU testの限定価値は維持する。詳細はtransformersjs-model-loading.md、証拠はvalidation/2026-11-01-runtime-pinned-browser-build.json。採用確定は同じcheckpoint1の実runtime/model/資源確認待ち。


### runtime Tensor identityの候補修正（checkpoint1）

別moduleのCommonを同じ1.31.1へ揃えるだけではORT bundleとTensor classが二重になる。実公開browser loaderの接続確認で検出し、Common importもORT Web公式bundle exportsへaliasして単一classを使う候補に更新。HR/matteのセッション生成直前までの接続、owner解放をGPU/engineなしで確認。詳細/限定範囲はtransformersjs-model-loading.md、証拠はvalidation/2026-11-01-runtime-browser-contract.json。実モデル受入は引き続き未完。


## HR正規化/FP16とResizeの再利用判断

公開ImageProcessor＋Tensor.to(float16)が全768 RGB階調のFP16参照と一致したため、この処理を独自kernelへ置き換えない。native Float16Arrayの存在を要求する。HRのbilinearと既存印刷Lanczosは用途が異なるため、Pillow upstream Resample.cは無変更でown hostのfilter選択exportだけ追加。native4ケースと元経路の回帰確認済み。証拠: validation/2026-11-01-hr-preprocess-reuse.json。WASM化/実HR接続は未完で、既存full scopeを保持する。


## 2026-11-01: 実local appのprepare失敗とORT配布物のCSP条件

許可されたHR-only UI試行1件は、実resourceを検証・CacheStorageへ保存した後にprepareでruntime-errorとなった。prepared eventがなく、infer/PNG保存には進んでいない。公開protocolが任意例外を伏せるため、元例外の直接原因は未確定。

固定ORT Web1.31.1 JSEP MJS（SHA7838b4b2…）のEmbind method-caller Pbにはnew Functionがある。配布物からその関数をそのまま取り出し、依存をstubしたVMでstrings禁止時のEvalError、許可時の生成成功を確認した。WASMだけを許すCSPと、このJavaScript bindingの互換性問題は別に確認できたが、元のbrowser失敗の直接証明ではない。

ORT公式の[CSP配布ガイド](https://onnxruntime.ai/docs/tutorials/web/deploy.html#content-security-policy-csp-restricted-environments)は必要assetの配布を案内する。実採用判断では固定artifactのbindingも確認する。[MDNのWorker CSP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy#csp_in_workers)に従い、非公開local serverで固定hashのmodel Worker応答だけにunsafe-evalを付ける候補へ修正。HTML/他Worker/公開Pages headersは変更しない。上流patch/独自ORT buildを追加せず、公開採用/実Chrome再確認は未完とする。

証拠: validation/2026-11-01-authorized-local-hr-attempt.json、validation/2026-11-01-ort-csp-binding.json。許可1件は消費済みで、自動再実行しない。


## 2026-11-01: 取得状況とモデル保存データの操作

既存workerのresource-stateを画面へ接続し、完了したファイル単位の保存・検証済み容量と、読込/推論/補正/前景色/終了/PNG作成の段階を表示する。未検証のbyte受信を完了と呼ばない。quota/checksum失敗時は写真を保持して復帰方法を示す。

モデル保存データの確認・削除は標準[CacheStorage.keys](https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage/keys)、[CacheStorage.delete](https://developer.mozilla.org/en-US/docs/Web/API/CacheStorage/delete)を利用する。現在の固定releaseのnamespaceとresource URLに限定し、確認時にbodyを読んだりmissing cacheを作らず、削除では既存imageWorkGateを使う。別cache engine/downloaderを追加しない。ファイル存在数は完全性の証明ではなく、実行時に既存streamed SHAで再検証する。

実機prepare失敗の詳細不足には、private local policyだけで有効になるmodel-loader exceptionログを追加した。from_pretrainedのcatchだけを対象にし、画像をinferへ渡す前の失敗を2048文字に制限して非公開observerへ記録する。一般ページのconsole/画像/推論例外は収集せず、public worker protocolの固定errorを変更しない。次の実機確認での有効性は未受入。


## 2026-11-01: 実環境継続の承認後の設計再点検

利用者は実環境での継続実装・検証を明示承認済み。個々の試行の再承認は要求せず、端末負荷への配慮と直列実行を維持する。

実prepare失敗はCSPだけでは説明できず、固定WebGPU entrypointが要求するwebgpuInitとJSEP MJSのjsepInitのABI不一致を検出した。公式WebGPU entrypointと公式asyncify MJS/WASMの組へ修正し、実ChromeでHR preparedを確認。配布版/hashだけでなくartifact familyの整合をstagingで検査する。以前のCSP単体検証はその限定範囲の証拠として残す。runtime-family-abi.json参照。

Transformers.js4.3.2のBackgroundRemovalPipelineも確認したが、ImageSegmentationPipelineへ委譲して画像をcloneしmaskを付ける高水準APIであり、この固定pixels/alpha graph・既存Pillow前処理・ViTMatte・前景色復元の契約を一括保証するAPIではない。既存のPreTrainedModel/ImageProcessor/Tensor/interpolateを利用する薄い接続を維持する。推論engineやschedulerを再実装しない。IMG.LYの背景除去は別モデル/処理/AGPL条件を持つため、同一品質契約の透過的置換とは扱わない。MLCへの移行も、このONNX graphをそのまま支える根拠なしに新しい変換系を増やさない。

公式ORT Web1.31.1のpreferredLayout既定はNCHW。公開Transformers bundleをSession.create直前で遮断した試験ではHR/Matteともgraph capture、layout、optimization、CPU arena/patternを上書きしない。GPU/WASMを初期化せず実公開loaderの実際の引数を確認した（runtime-session-flags.json）。したがってNCHW追加やcapture無効化だけの重い再試行は根拠不足。固定Web runtimeではoptimization=all、CPU arena/pattern=falseが既定。

HR graphには既に出力block分割があり、元の240ch full-resolution concatを現在の最大tensorとして再報告しない。過去の静的逐次生存試算約1.806GiBはworkspace/CPU-GPU複製/driver保持を含まない。bucket/disabled/simpleの実試行はいずれも資源基準で停止し、モードごとの完走ピーク比較はできない。最新simple試行はWS7.12GB、private12.52GB、全GPU7717MiB、空きRAM835MBを観測した。出力未取得で製品受入未完。

サンプル監視はhard capではなく、停止後もGPU解放が遅れる。検証observerへRAM/commit/VRAMの設定増加分とreserveを開始前に確保するadmissionを追加した。これもモデルが収まる保証ではない。品質・画面導線・解放・公開配信はライブラリ名だけでは担保できず、それぞれ実出力比較/操作確認/資源観測/Pages-R2検証が必要。既存ライブラリの採用と受入試験の責務を混同しない。

一次資料: [ORT WebGPU EP](https://onnxruntime.ai/docs/execution-providers/WebGPU-ExecutionProvider.html)、[JS WebGPU options](https://onnxruntime.ai/docs/api/js/interfaces/InferenceSession.WebGpuExecutionProviderOption.html)、[ORT Web large models](https://onnxruntime.ai/docs/tutorials/web/large-models.html)、[Transformers pipeline API](https://huggingface.co/docs/transformers.js/api/pipelines)、[IMG.LY upstream](https://github.com/imgly/background-removal-js)。APIの詳細判断は取得済み固定配布版sourceと照合し、可変mainを固定版の保証としない。


### 2026-11-01: 完走PoCとの差・公式dispatch設定の実測

過去のserial-model-lifecycle-squareの完走観測はWS15,158,587,392/private20,063,526,912byteで、現在のUIだけのmemory regressionとは断定できない。PoCはshader-f16/subgroups等を利用可能時にrequestDeviceへ渡すが、現在bootstrapはshader-f16だけだった。公式ORTのJSEP device初期化もsubgroupsを利用可能時に要求する。bootstrapを、対応adapterのみsubgroupsを要求するよう揃えた。非対応機器に必須化せず、数値受入/資源改善は別に検証する。

固定native sourceではmaxNumPendingDispatches（1〜4096、既定16）をsession configで指定できる。pending bufferはsubmit後RefreshPendingBuffersでcache再利用へ移るため、公式設定を薄く渡せるようにした。source/固定WASMにkeyの存在を確認し、公開Transformers loaderでもextra.ep.webgpuexecutionprovider.maxNumPendingDispatches='1'が保持されることを、engine初期化前の2role接続試験で確認した。独自queueやGPU同期engineは実装しない。

simple＋window1＋optional subgroupsの実HR1件は、prepared後にWS7.45GB/private13.31GBへ増加し停止、alpha/PNG0。Chrome/server終了とGPU baselineへの復帰を確認。window変更だけでは資源問題を解決しなかった。検証profileだけで指定し、公開採用条件を満たしたとはしない。証拠: validation/2026-11-01-runtime-dispatch-window.json、native-runtime-hr-resources.json。

次の公式代替経路は、同じORT1.31.1のdefault bundle（ort.bundle.min.mjs）＋JSEP MJS/WASMの組。WebGPU entrypoint/native asyncifyとは異なる公式backendであり、混在させない。現行JSEP sourceはGridSampleを登録するが、全graph実行/品質/資源は未証明。さらにJSEPはEP optionsのdeviceを採用せず内部でdeviceを作るため、現在native用ownerをそのまま流用すると余分なdeviceと誤った解放保証になる。検証前に公式env.webgpu.deviceの公開/解放とWorker終了を接続する必要がある。upstreamではJSEP凍結/移行方針も示されており、実測なしに恒久的な採用としない。一次資料: [ORT migration design](https://github.com/microsoft/onnxruntime/blob/main/docs/design/onnxruntime_web_jsep_to_webgpu_ep_migration.md)。取得済み固定配布版のbackend-webgpu.ts/session-options.tsと照合済み。


### 2026-11-01: JSEP比較と未採用の判断

正しいdefault JSEP bundle＋JSEP MJS/WASMを別の非公開候補としてstageし、native用deviceを余分に作らず、libraryの公開env.webgpu.deviceを読込後に採用・監視・解放する接続で実検証した。公開Transformers loaderの2role接続、部分失敗/解放順序等24testを通過。HRは実Chromeでpreparedとなったが、forward中にWS6.03GB/private11.84GBで停止し、alpha/PNGなし。全GPUは終了後の遅延解放を含め7780MiB。Chrome process0/GPU798MiB復帰/server終了を確認。nativeより優れる完走ピークとは比較できない。

nativeのdisabled cache単独で過去に発生したused-in-submit-while-destroyedエラーとpending buffer refreshの関連を確認し、disabled＋dispatch window1も別の1件として試した。WS9.55GB/private15.76GB、GPU7802MiBで資源停止、出力なし。旧エラーを修正できたとは証明できず、resource改善にも採用しない。

JSEPへの変更だけで現資源問題を解消する証拠は得られなかった。未受入backend/ownerを本体へ増やさず、実験時source9ファイルとhashを非公開評価領域へ保存し、製品のmodel builder/ownerはnative一経路へ戻した。診断用の正しい公式pair metadataとoffline stagerの明示jsep optionのみ保持し、製品builderは未採用familyを拒否する。新dependency/独自engine/上流patchなし。最終native ownership/preparation/staging統合25testと型検査を通過。

証拠: validation/2026-11-01-jsep-resource-comparison.json、native-runtime-hr-resources.json。メモリ消費の根本対策として、次は同じ重み/演算のgraphを公式ONNX抽出APIで段階化し、境界tensor・総転送量・session解放の費用を確認する。単一node sessionを全数回す既存CPU診断器を製品engineとして流用しない。既成libraryのgraph抽出とORT session APIで足りるかを先に調べ、画質/資源/速度が未測定の分割を採用済みとはしない。


### 2026-11-01: 公式ONNX抽出・外部データAPIによる段階分割候補

一括sessionの資源問題に対し、既存ONNX1.23.2の公式Extractorを使う。独自の演算実装/graph evaluatorを本体へ追加せず、既存runtime/session/Workerへ接続するためのオフライン成果物を用意する。公開docsは1.24.0のため、実APIは取得済み1.23.2のsourceも確認した。Pythonは変換・比較だけで、Pages実行依存にはしない。

partition_browser_onnx.pyは静的shapeとトポロジーを確認し、データ非依存の祖先を各graph内部へ残す。整数のshape情報等を境界へ持ち出して定数畳み込みを壊さない。cutは論理output量を目安とし、その後半でreadbackの小さい位置を選ぶ。目安は実VRAM/RAM capではない。Extractorの結果について、runtime nodeが元のbyte recordのまま全件1回ずつ現れること、initializer record/IOの型・shapeの保持を独立検査する。RNG/Dropout/制御flow/動的shape/非floatingのruntime境界は明示拒否。

HR固定候補8635nodeのうちデータ非依存1333node、runtime7302nodeを46stageへ分割。学習済み重み/演算/2048px/FP16を維持。公式external-data helperでstageごとにpackし、全initializerの論理byte列・型・shapeの一致、全46graphのcheckerを確認。91files合計869,926,132byte。重複する定数祖先/initializerにより元の約457MBより配布量が増えるため、採用前にこの費用も比較する。

境界readback計6,357,438,464byte、upload計8,216,563,712byte。最大stage入力925,892,608byte/出力520,093,696byte。単純な同work量cutのreadback11,391,682,560byteより削減したが、host registry・workspace・allocator・実時間は未測定。実生成は1core/nice19/仮想2GiB制限、19.37秒、peak RSS999,444,480byte。GPU/session作成なし。

FP16/FP32小graphの全体vs分割参照、skip/定数再利用、external packでのFP16特殊bit保持、cut改変/不正graph拒否等7test通過。最後のstageはexternal fileを持たないため、既存TransformersPreparationへ明示したconfig+graphの2resource契約も接続した。dummy weightsや自動外部取得を作らず、元の3resource契約は維持。対象9testと実公開Transformers loaderの3case（HR/Matte external＋HR self-contained、GPU/WASMなし）を確認。

実46stageを既存single-worker-taskと既存model preparation/cacheへ接続し、全工程のalpha/画質/資源/速度を測るまでは採用しない。境界の同じfeatureを後段でも使う場合の所有・copy/transferと、各stageのsession解放後のWorker終了は既存gateの規則へ従う。独立のcache/queue/ownership engineを増やさない。証拠: validation/2026-11-01-hr-stage-artifacts.json。一次API: https://onnx.ai/onnx/api/utils.html / https://onnx.ai/onnx/api/external_data_helper.html 。


### 2026-11-01: 46stageの実GPU完走と出力同一性

新queue/cache/engineを作らず、既存SingleWorkerTask・WorkerGate・TransformersPreparation・ORT native bootstrapを接続した。各stageのTensor/model/runtimeを解放してからresultを返し、親はWorker終了後に次stageを開始する。後段で再利用するfeatureだけcopyし、最終利用ではtransferする。親のregistryはlogical2GiBを上限とし、fixed FP16/FP32 shape/byte数/重複buffer/nonfinite結果を検査する。root leaseを全46stageの間保持し、別編集が途中へ割り込まない。これは資源hard capではない。

実機の最初の試行は開始前VRAM予約でmodel開始0。段階用profile（WS4GiB/private12GiB/GPU増加4GiB、空きRAM3GiB/commit8GiB/VRAM1GiB）を別に設定した試行は38stage完了後にWS4.45GBで中止した。公式ORT1.31.1 wasm-core-impl.tsがCPU出力を独立typed arrayへcopyすること、Common Tensor.disposeが配列をdetachしないことを確認し、stage-workerの二重output copyを削除。subview/shared/aliasの場合だけcopyする。入力descriptor参照もTensor作成後に破棄する。

この変更後は43stageまで完了してWS4.93GBの目安超過で停止したが、全GPU最大3682MiB、空きRAM最小8.40GBを保持していた。既存HR検証と同じWS5GiBへ較正し、private/GPU増加/空きsystem reserveは維持して最後の試行を行った。46stage全て完了し、browser算出alpha SHA86d425839bc958e5a5a5b73ea67240b921c16f789140d4a185a9d83094328f2fは、保存済みwhole-model出力16,777,216byteを再hashした値と一致した。新たな数値誤差はこの1入力では検出されない。約134.49秒、task Chrome WS合計最大4,474,376,192byte（約4.17GiB）、private commit6,140,170,240byte、全GPU最大3723MiB（約3.64GiB、開始943MiB）、空きRAM最小8,124,985,344byte。

メモリはsample値で、WS合計の共有page重複やGPU他app使用を含む。最後の試行は過去partial試行のCacheStorageがほぼwarmであり、cold性能/実写真/全体UXの受入ではない。計算後のDownload.saveAs側でobserver errorとなってexit2。raw出力のbrowser SHAは得られたが、今回のexport fileを保存済みと偽らず、PNG/ダウンロードを合格にしない。Chrome終了/process0/GPU baseline復帰/server終了を全試行で確認。次はGPUを再実行せず、WSL→Windows Chromeのdownload transportを小さい非GPU probeで切り分ける。

対象staged9/observer15/header1、全domain192test、型検査・build・Pages artifact検査pass。公開背景編集は未接続/未受入の準備中表示を維持。証拠: validation/2026-11-01-staged-hr-browser.json。


### 2026-11-01: 全基準入力の一致とWindowsブラウザの保存観測

HR分割は基準5入力すべてで一括出力SHA一致。保存修正後の4入力はraw fileを取得しbyte一致まで確認した。squareの旧保存失敗は履歴として保持する。約123〜143秒のwarm実行であり、本体前後処理・foreground・PNG・cold負荷・一般写真の受入とは分ける。証拠: validation/2026-11-01-staged-hr-all-reference-cases.json。

既存Playwright core1.63.0のDownload.saveAsはWSL側artifact pathとWindows Chrome側filesystemの差でcanceled/ENOENTとなった。新downloaderやSDK patchを作らず、[公式CDP Browser.setDownloadBehavior](https://chromedevtools.github.io/devtools-protocol/tot/Browser/#method-setDownloadBehavior)のallowAndName/downloadPath/eventsEnabledとdownloadProgress completedを使用。専用Windows一時directoryへChromeが保存したowned GUIDのBlob fileだけをobserverがmounted filesystem経由でprivate評価先へcopyする。byte上限・実file種別・completed size・GUID・pathを検査し、browser終了後に専用directoryを清掃する。製品の保存UI/Blob linkには適用せず、HTTP downloader/cache/推論engine/依存を増やさない。非GPUの生成16MiB Blob/2×2 PNGで実bytes/SHA一致とprocess0を確認。証拠: validation/2026-11-01-browser-download-transport.json。

本体の準備gateでは同じSHA/サイズの別resourceにも各1件のstored/verified stateを要求する。ResourcePolicyの公開stateにURLを追加せず、多重度を保持して照合する。既存の標準CacheStorage・streaming検証をそのまま使い、別cache engineは導入しない。重複resourceの不足/未保存/未検証を拒否する回帰と既存preparation/Worker連携14testが通過。


### 2026-11-01: 分割HRを本体の既存model契約へ接続

Transformers4.3.2の既存ImageProcessor/Float16 Tensorと検証済みPillow resize・補間を維持し、callable model部分だけを既存createStagedHrへ接続する。46stageの各resourceを既存ResourcePolicyと標準CacheStorageで順番に保存・検証し、準備gateを通ってからhandleを公開する。cache hitはstreamをEOFまでdrainし、networkはcache.putへ直接渡して巨大arrayBuffer/未読cloneを増やさない。入力Tensorの完全bufferをtransferし、最終alphaは既存library.Tensorへ戻す。独自推論kernel/queue/cache/新dependencyなし。同じ内容の別URLは準備gateで個別確認し、UIのhash単位stateだけを保守的に集約する。

親model Worker内の子専用Workerは標準APIを利用。[HTML Worker処理モデル](https://html.spec.whatwg.org/multipage/workers.html#terminate-a-worker)のclosing/owner/lifetime規則を確認し、Windows Chrome156のGPU無効probeで親・子2target→親terminate後0target、子のheartbeat停止を実測した。GPU解放のhard capや全端末保証とはしない。

HR/Matteの親model-set versionを同一の内容IDへ揃え、段階内部のrelease/cache/immutable URLは維持。本体local build170mount/モデル1,267,265,814byteが通過し、重みread/copy0。既存background session/foreground/exportを再実装しない。全domain209件と型検査pass。GPU有効ChromeはCDP成立前に終了し、写真→PNGの実機受入は未完。検証起動は終了、PID再利用で見えた別Windows updaterをtask Chromeとして終了しない。証拠: validation/2026-11-01-staged-hr-main-integration.json。


### 2026-11-01: Windows側の公式Playwright経路・本体HR実行・速度の再評価

WSL→WindowsのHTTP CDP起動が安定しないため、新たなbrowser engine/remote-control実装を増やさず、既存Playwright core1.63.0のlaunchPersistentContext/pipeをWindows側で使用した。[公式Node24.8.0 Windows archive](https://nodejs.org/en/download/archive/v24.8.0)を非公開の開発用directoryへ展開し、公式SHASUMSとの一致を確認（zip36,382,247byte、SHA970ecc121a16f546174b6a870215ca4cc0de33f8a616b42c16c8c02e66b07d05）。同じ既存Node版、MIT/同梱LICENSEを保持、インストール/PATH変更/公開アプリ依存は追加しない。Playwrightも既存Apache-2.0 packageを使用し、上流patch/new SDKなし。task-only profileと既存resource admission/停止/保存観測を再利用する。Windows native observerでは同じ標準CDP downloadをWindows file pathで読む。

NVIDIA Ampereの実adapter（fallback=false、shader-f16=true）を確認。本体の合成写真1086×1448はHR46/46・最終alpha result・model disposeまで進んだ。page-relative結果時刻126,988msであり、GPU kernel単体時間と扱わない。観測WS最大4,570,951,680byte、private commit6,207,733,760byte、全GPU3903MiB。PNG保存前に失敗し、hasResult=false。Chrome終了process0/GPU復帰/一時download cleanup/server停止を確認。以後の小foreground browser probeはnavigation時のERR_NETWORK_ACCESS_DENIEDで処理開始前に止まり、成功と扱わない。

旧foreground WASM128MiB capは同寸法の生成RGB/mixed alphaでも不足し、既存memory-growth hookが拒否することをNode上で再現した。256MiBなら同寸法が完了、最大2000×2000は512MiB capでmemory352,452,608byte・約4.58秒で完了した。計算kernel/精度/画像サイズを変更せず、同じ検証済みWASMのcapだけを512MiBにしたprivate workerをbuild。これはWASM線形memory上限であり、総RAM/写真画質/ブラウザ受入ではない。本体の失敗原因がこのcapだけだったと断定せず、次の通し確認で確かめる。

利用者がPython GPU-node版との速度差を指摘。既存ROCm referenceはRadeon8060S/別合成画像で補正なし4.3916秒・補正あり42.0256秒。ブラウザの約2分を実用速度の受入完了にしない。GPU/入力が異なるため厳密倍率は主張しない。46回の初期化・転送・解放が主要候補だが、内訳未測定のまま断定/新engineへ進まない。標準performance.nowによるprepare/infer/export/releaseの4区間を既存stage-result/progressへ追加し、数値/上限/現jobを検査。非公開traceは全46段の合計を保持し、64event ringにより前半を失わない。計測はCPU wall timeで、inferにはTensor作成/ORT呼出/readbackを含む。実測後に公式ORT session/device再利用等を比較し、モデル/2048/精度を維持する。

UIには完了数を表示し、次工程で色補正表示へ切り替える。hash単位の保存stateはmanifest resourceの多重度を反映して合計し、同じ内容の別URLを読み終わったのに容量表示が未完になる問題を修正。全domain229件、背景UI7件、型検査/production build/Pages artifact11files・3,220,854byteチェックpass。timing-enabled private app03も170mount/重みread-copy0でbuild。速度改善/PNG完了/公開採用は未証明。

証拠: validation/2026-11-01-windows-native-observer.json、2026-11-01-main-hr-progress-and-foreground-capacity.json、2026-11-01-browser-latency-priority.json。


### 2026-11-02: 本体PNG完遂と計算経路・小型モデルの比較方針

11月1日の通常HTTP/native Playwright本体試行で、合成写真1086×1448→固定HR46段→既存foreground→透過PNGの実保存が完了した。PNG2,235,809byte/SHA bc1ceedafe434ab56ea51515738e3b86733573187712d98f6dfea3d3277323ff。透明619,704/不透明764,850/中間alpha187,974画素、不透明RGBの元画像との不一致0。これは1写真・補正OFFの通し成功であり、一般画質/Matte/顔/CPU/最大寸法/公開受入ではない。Chrome process0/GPU復帰/保存一時directory清掃/server終了を確認。

HR計測は118.897秒、prepare56.741秒、infer46.814秒、export0.009秒、release0.296秒、区間外15.036秒。inferはTensor準備/ORT呼出/compile/readbackを含むCPU wall timeで、純粋なGPU shader時間ではない。静的graphを重みなしで確認すると、元ONNX3,351node/DeformConv20が、現browser graph8,635node/GridSample300となっている。分解のsampling/accumulationと一部meanはFP32であり、「同じ重みだから同じkernel計算量」と扱わない。公式torch.profiler/ORT WebGPU profilingを先に使い、同一GPU・写真・精度でnative PyTorch/ONNX/browserの演算内訳を比較する。

[Playwright公式route文書](https://playwright.dev/docs/api/class-browsercontext#browser-context-route)はroutingがHTTP cacheを無効化すると明記し、検証serverもno-storeだった。現記録はmodel CacheStorageがwarmであっても、通常のHTTP/code cacheが効いた性能ではない。キャッシュ差を分けてからsession/device再利用、[公式IO binding](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)によるGPU上の中間tensor保持を比較する。独自cache/kernel/engineを先に増やさない。

公式Playwright route.fulfillでforegroundだけを動かす小fixtureは、旧128MiBの失敗と512MiB capで2000×2000まで成功を再現した。ただし親Workerからの子Worker要求がrouteへ届かない小再現も得たため、本体用fixture mode/helper/testは採用せずprivate評価sourceへ退避し削除した。通常HTTPのplain HTMLをWindows native fetch/persistent/incognitoで200確認後、本体は通常HTTPで成功した。接続制限の根本原因が恒久解消したとはしない。

利用者の追加要求「計算自体/PyTorchとの差、WebGL、VulkanとROCm、小さいモデル」を比較scopeへ追加した。46分割は現HR/実装/端末で資源を抑える候補であり、全モデルの必須構成としない。基準HRを保持し、小型モデルを別条件で評価する。既存変換物と公開ライブラリを優先し、以下のmetadata/revision/license/config/SHAを取得した。

| 候補 | 確認した内容 | 採否・残条件 |
|---|---|---|
| [BiRefNet lite-matting](https://huggingface.co/ZhengPeng7/BiRefNet_lite-matting) | MIT、約44.4M、FP16 safetensors88,965,896byte、revision99c33412… | 人物matting比較の候補。author repoの現metadataにはONNXなし。自動生成Transformers.js snippetだけで実装済み扱いしない |
| [BiRefNet lite-2K](https://huggingface.co/ZhengPeng7/BiRefNet_lite-2K) | MIT、約44.4M、FP32 safetensors177,634,392byte、revision3f789d2… | 小型backbone/高解像度候補。cardは2560×1440入力を推奨、HRの2048正方形と混同しない。変換/品質未検証 |
| [onnx-community BiRefNet lite](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX) | MIT、既存FP16 ONNX114,538,221byte、processor1024正方形、revisionde15b22… | 既存Transformers.js/ORTで試す優先候補。lite-mattingとは別variant、同一重みとは主張しない |
| [Xenova MODNet](https://huggingface.co/Xenova/modnet) | Apache-2.0、FP32 ONNX25,888,640byte/FP16 12,984,781byte、short edge512/divisible32、revisionfa2fa54… | 人物専用の軽量比較候補。既存FP32 fileだけ取得しSHA/ONNX checker確認。WebGL名前表にはExpandがなく、Constantはloader処理もあるため単純な表照合を可動判定にしない |

上記は重み/graph fileサイズでありRAM/VRAMではない。MODNetの[元著者README](https://github.com/ZHKKKe/MODNet/blob/master/README.md)もcode/model/demoをApache-2.0とする。MITの本体と依存/model noticeは分離したまま、実機品質/速度/1session可否を測るまで既定modelを変更しない。

WebGLは固定ORT1.31.1配布のsupport table/実装でDeformConvとGridSampleを持たず、現HRをprovider名変更だけで動かせない。[ORT公式](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)でもmaintenance mode。互換な小型graphでの比較は残す。ROCm/HIPはMIOpen/BLAS等のML実装を持ち、VulkanはAPIであり選んだbackendのshader/融合/配置/fallbackが速度を決めるため、API名だけの速さ順位は作らない。既存Vulkan移行記録にもGELU近似/serializer差があり、その修正前後を公平な速度比較に混ぜない。

[Dawn公式support](https://dawn.googlesource.com/dawn/+/refs/heads/main/docs/support.md)では利用可能なD3D12を優先し、Windows WebGPUをVulkanと同義にしない。さらに[公式ExecuTorch WebGPU](https://docs.pytorch.org/executorch/stable/backends/webgpu/webgpu-overview.html)はbrowser用experimental backendを提供するが、Vulkan serialization再利用とWebGPU演算coverageは別。新backend buildへ進む前に固定版の演算表/既存配布物/画質を確認する。

次の比較は同一写真/同一GPU/同一精度を基本とし、初回取得・session準備・初回run・warm run・PNG完了を分離。小型モデルは分割なしの1sessionから試し、髪/眼鏡/服の境界・alpha・不透明RGBとRAM/VRAMを併記する。GPU kernel timingが取れない場合はCPU wall timeと明記する。全domain230test、observer18test、private app04 build pass。証拠: validation/2026-11-01-main-hr-png-and-timings.json、2026-11-01-foreground-browser-capacity.json、2026-11-01-backend-and-small-model-review.json。

### 2026-11-02: MODNet single-session 実機比較（正しさ未受入）

既存Transformers.js 4.3.2 / ORT 1.31.1 / Pillow resize / Worker・export APIを再利用し、Windows Chrome・NVIDIAでMODNet FP32約25.9MBを分割なしの1sessionで実行。prepare 2.261秒、mask request初回2.003秒、warm 0.196/0.242秒。requestは前処理・推論・復元・Worker往復込みでkernel時間ではない。3回alpha SHA一致、PNG実保存・hash照合・browser終了確認、関連28test pass。観測最大WS約1.14GB/private約1.37GB、GPU全体1781MiB（開始1180MiB、瞬間peak保証なし）。

ただし白背景PNGの顔・髪・服に大きな欠けを目視確認。同じ写真のdecoded RGB SHAはCPUと一致するが、CPU ONNX参考出力とのalpha MAEは37.168/255（alpha拡大方法にも差あり）。したがって速度だけで採用せず、モデルの画質限界ともGPU誤差とも断定しない。次はresize済RGB→正規化tensor→raw alpha→拡大後alphaを順に比較する。CPU参考run 0.753秒はsingle-thread ORTでありPyTorch比較ではない。HRとのモデル/精度/解像度差もあるため速度倍率をbackend優劣に使わない。本体の既定model/公開状態は未変更、candidateはmain UX未接続。証拠: validation/2026-11-02-modnet-single-session.json。

### 2026-11-02: MODNet 前処理のoffline parityを確認

実createModnetInference・固定Transformers.js browser配布・検証済Pillow WASMをNodeで再現し、CPU ONNX出力を実アプリのinterpolate/quantizeへ戻した。独立Pillow/NumPy参照とresize RGB（512×672×3）、正規化FP32 tensor（1×3×672×512）は全要素一致。actual adapter inputでのCPU raw alphaもPython inputのCPU raw alphaと全要素一致。実アプリ拡大経路のCPU alphaと既存browser alphaとの差は529,048画素、MAE37.167969/255、最大255で残る。独立したalpha拡大方式だけでは先の不一致を説明できない。これはoffline実装経路の検証であり、実browserの入力tensor/raw GPU alphaはまだ未取得。GPU backend故障と断定せず、次は実browser入力hash→拡大前alphaを照合する。追加browser/GPUなし、CPUはnice19/core0/ORT1thread。診断scriptと中間dataはprivateに保持しhashを証拠へ記録。証拠: image-studio/docs/browser/validation/2026-11-02-modnet-stage-parity.json。元full scope/公開準備中/品質未受入を維持。

### 2026-11-02: MODNet 出力不一致を公式layout指定で解消

実browser入力tensor SHAはCPU参照と一致し、拡大前alphaでMAE0.1458029/最大0.9999949の差が存在した。基本最適化だけでも同じraw SHA、最適化disabledはCPU担当nodeが残りGPU限定でprepare失敗。公式WebGPU EP preferredLayoutをNCHWに明示した1件ではraw MAE4.56108e-8/最大1.63913e-6へ改善。最終alphaはCPU参照157万画素中5画素で1/255差のみ、不透明RGB不一致0、PNG alphaと保存raw alphaの不一致0。白PNGの顔・髪・服の大きな欠けが解消したことも目視確認。省略時に内部でどのlayout/kernelを選んだかは未特定（公式型の記載defaultはNCHW）；NHWC故障と断定しない。

修正は既存bootstrapにMODNet専用preferredLayout=NCHWを加えただけ。HR/Matteの設定は維持し、新依存・kernel・runtime forkなし。回帰assertionと関連28test/full domain237test pass。診断instrumentationを除いた実source buildで再実行し、corrected diagnosticとalpha/両PNG SHAが一致、3run alphaも一致。prepare1.677秒、request初回0.431秒、warm0.243/0.202秒、foreground2.168秒、PNG透過0.341秒/白0.268秒。requestはGPU kernel単体時間ではない。total11.515秒は3run・6秒の観測wait・2PNGを含むため1枚の所要時間と表示しない。model/shader cacheに先行実行あり、cold-install benchmarkでもない。

最終観測最大WS1,042,661,376/private1,189,539,840byte、全GPU1564MiB（開始1105MiB、専有VRAM/瞬間peakではない）。各試行は直列、全5browser process0/必要download清掃、全server終了130。追加質問なし。証拠: image-studio/docs/browser/validation/2026-11-02-modnet-layout-fix.json。

次は人物候補の複数fixture品質・寸法/profileと本体model選択/Apache2表示を整理し、既存background sessionへ接続する。MODNetは依然private比較でmain UX未接続、一般品質未受入。HR基準/Matte/顔/CPU/UX/Pages-R2/公開という元full scopeは保持。今回の小型実機結果で46分割を唯一の本体構成と見なさない。

### 2026-11-02: MODNet本体通しとモデル候補の見直し

MODNetを既存background session/serial/cache/foreground/exportへ役割名を偽らず接続し、private本体UIの写真選択→推論1回→前景色推定→透過PNG実保存まで完了。2,297,975byte/SHA2653d0d69b3589fe8e3f3a47a6959e5b0c13f55d701560b37bdb4f31bb1321b0はcorrected診断PNGと一致。refine off、CSP/load errorなし、Worker gate解放/browser process0/download清掃/server10748終了130。新依存なし。共通239test/背景UI7test/observer18test/typecheck/Pages build pass、既存HR private appも170mountでbuild成功（GPU再実行なし）。public背景は準備中。モデル切替UI・可変入力profile・複数fixture品質は残る。証拠: image-studio/docs/browser/validation/2026-11-02-main-modnet-png.json。

利用者指定でportrait/dynamic/dynamic-mattingを優先比較候補へ追加。公式HF metadata/config/card/revisionを取得し、重みは未取得。dynamic系は約220.7M/FP16 safetensors444,473,596byte、portraitは同規模/FP32 884,878,856byte、いずれもMIT。既存onnx-community portrait FP16約489.7MB、dynamic-1024 FP16約489.8MBを発見。小型化を意味せず、dynamic学習の可変解像度と固定1024変換物の可変shape対応を混同しない。次は既存ONNXの互換性/人物用途から選び、無条件の変換や全候補の大型取得を避ける。

fal v2（既存familyを選ぶendpoint）、LayerStyle LoadBiRefNetModelV2（BiRefNet-General/RMBG-2.0を選ぶloader）、BRIA RMBG-2.0（独自学習の別重み）を区別。BRIA公式の重み利用条件はMITとは別であり未取得。BiRefNet-SuperはPython Transformers device_map/max_memoryのCPU/GPU offload・cache・native ONNXを使うnodeで、新Super重みではない。1024resize・alpha min/max再正規化・二値thresholdもあり、そのままsoft alpha契約へ移植しない。既存libraryの再利用方針は採り入れ、Python runtimeをPagesへ持ち込まない。

追加提案のBiRefNet+DA3+AutoMask/PyMattingも候補として整理。DA3-Smallは公式80M/Apache2/relative depthで、追加負荷は未測定。深度による遠景除外の有効性は比較対象だが、似た色の混入を完全排除する保証とはしない。誤ったhard除外は髪/眼鏡/意図した遠いforegroundを消し得るため、既存baseline・Matte補正を先に比較し、低解像度/直列解放/任意OFFの補助として採否を判断する。新model依存は未追加。証拠: image-studio/docs/browser/validation/2026-11-02-model-family-and-hybrid-review.json。元full scope/goalは継続。

### 2026-11-02: 本体モデル選択と結果失効を接続

前turnはMODNet本体保存・最新model/ComfyUI/深度補助の調査を進めたprogress。今回はtrusted modelVariantsを既存background sessionへ加え、写真/背景色を保持したHR↔MODNet切替を本体UIへ接続した。旧result/PNGの失効は既存revision/committer/exportを再利用し、refineをresetして選択モデルの利用可否を表示。未知release/処理中切替は拒否、各releaseは専用Workerへ委譲する。新依存/ML engine/cache engineなし。private builderは既存HR/MODNet releaseの検証済mountを合成し、174mount/重み読込0で構築。

実Chrome/NVIDIAのprivate本体でMODNet→透過PNG実保存後、HRへの切替で写真保持/旧PNGリンク削除、MODNetへ戻して追加推論なしを確認。保存PNG2,297,975byte/SHA2653d0d69b3589fe8e3f3a47a6959e5b0c13f55d701560b37bdb4f31bb1321b0は既存corrected参照と一致。最初のobserverはPNG保存後の厳密label取得timeoutで停止したが、combobox roleへの修正後の別観測は完了。両browser終了確認、server98088/85989終了130。HR推論は再実行していない。

共通241test/背景UI8test/typecheck/Pages build pass（11file/3,221,983byte、deployなし）。切替中の遅延結果・旧PNG・unknown modelをdomain/UIで確認し、実browserの確認範囲とは分けて記録。証拠: image-studio/docs/browser/validation/2026-11-02-main-model-choice.json。通常公開背景は準備中。次はMODNet可変入力profileと複数fixture品質、人物向けportrait/dynamic-mattingの既存変換物互換性を優先する。CPU/Matte/顔/UX/配信/公開の元full scopeは継続。

### 2026-11-02: MODNet可変shape2件・portrait既存ONNX静的確認

前turnはmodel切替本体接続のprogress。今回private MODNet profileのheight672/width512固定を外し、公式freeDimensionOverridesはbatch_size1だけ保持。既存NCHW/weights/runtimeのまま縦長1086×1448と別生成場面の横長1536×1024で本体UI→透過PNG実保存が完了。前者PNGは固定profileとSHA完全一致。後者model入力は1×3×512×768、CPU参照と最終alphaの差は19画素が1/255のみ、元不透明RGB不一致0。CPU参照のalpha拡大はPillow、browserは既存Transformers.interpolateであることも記録。独立ground-truthではなくruntime parityの確認。

横長の白背景確認には既存アプリexport handler/fast-pngをNodeで再利用（新kernel/追加GPUなし）。顔・眼鏡・巻き髪は保持、肩のsoftness/髪のfringeはHR/portraitとの比較を残す。最大2000正方形/極端aspect/一般画質は未受入。可変profile+既存model選択のprivate組合せも174mount/重み読込0でbuildしたが、この組合せartifactの再browser実行はしていない。両browser終了0/process0/download清掃、server98560/37220終了130。source変更なしにつき同じdomain/UIを不要に再実行せず、先の241/8testとは区別する。証拠: image-studio/docs/browser/validation/2026-11-02-modnet-variable-shapes.json。

利用者指定portrait比較へ進むため、既存onnx-community/BiRefNet-portrait-ONNX revision dd7167f6a8b54ff7efc29a4c988938d79866464fのFP16 file489,666,272byteを低優先度で取得しSHA4c05930c0b6f1418d02eb1de81c46fe37638ba54f5a93adeb5c674521db10110/checkerを確認。22,014node（Constant9,672）、GatherND80/ScatterND72があり、DeformConv/GridSampleは0。独自変換を増やす前にこの既存変換を試す。名前表coverageは実行可否の証明ではない。FP16ファイル名でもIOはFP32/input_image/output_image、1024正方形であり、HR2048 FP16 IO adapterへそのまま差替えない。session/GPU未実行、RAM/VRAM/速度は未測定。証拠: image-studio/docs/browser/validation/2026-11-02-portrait-existing-onnx-review.json。

次はportraitの明示IO契約を既存processor/resize/interpolate/Workerへ接続し、CPU parity→監視下1件の比較へ進む。MODNet最大形状・品質/Matte/顔/CPU/UX/Pages-R2/公開という元full scopeは保持、通常公開背景は準備中。

### 2026-11-02: portrait接続と既存変換物のruntime制約を確認

前turnはMODNet可変shape2件・portrait既存ONNX静的確認のprogress。今回は共通single-session adapterへ既存ImageProcessor/resize/interpolate/quantize/所有を再利用し、portrait1024/FP32 input_image/output_imageを明示接続した。出力末尾はCast←ConvでSigmoid済ではなかったため、公式Tensor.sigmoidを1回だけ適用する。MODNetは既存確率出力としてSigmoidを追加しない。roleをWorker/prepare/session/private UIへ通し、portraitのCPU併用はtrusted flag明示時だけ、既定strict/HRのGPU限定を維持。新ML依存・kernel・独自変換なし。関連モデルMIT表示も候補として追加。

CPU参照は低優先度1core/ORT1thread/仮想アドレス上限4GiBで2回停止。通常arenaではErfの201,326,592byte確保、arena/memory pattern無効ではdecoder Sumのbad_alloc。後者peakRSS3,726,220KiB。無制限RAM要求の測定ではなく、上限内未完走として記録し、上限を拡大しなかった。CPU参照alphaは未取得。

実Chrome/NVIDIAではstrict GPU-onlyがCPU担当node残存でprepare拒否。明示CPU併用ではprepare成功するが推論shaderのstorage buffer上限で停止。private合成画像専用diagnosticで既定8→要求9/10を調べ、adapter実上限16を取得。検証済み公式requiredLimitsへmaxStorageBuffersPerShaderStageを追加し、unsupported adapterはdevice作成前に拒否。16要求でも17個目を必要として停止したため、このORT native経路/変換物は未受入。失敗operator名は未取得でありConcat故障と断定しない。原graphのConcat入力数は1..1024。全6browser process0、全server終了130、PNGなし。負荷上限を際限なく増やす対処はしていない。

固定ORT1.31.1 JSEPのconcat.tsには、maxStorageBuffersPerShaderStage-1ごとにinputをbatch処理する既存実装があることを確認。独自batch/kernel/46分割を増やす前に、失敗nodeの同定と公式JSEP/forceCpuNodeNames等の既存APIを検討する。JSEP portraitは未実行で、以前のHR JSEP高メモリと混同せず別受入が必要。MODNet baseline/HR referenceを保持し、portraitの品質・速度改善を未測定で主張しない。

最終domain246test/typecheck/Pages build pass（11file/3,222,213byte、deployなし）。observerのadapter metadata追加に対応してfake browserのGPU stub/whitelist検証を修正した後に全体再実行pass。portraitのFP32 IO/Sigmoid1回/解放とCPU fallback明示・HR strict維持/上限要求を検証。元のCPU/Matte/顔/UX/Pages-R2/公開scopeは継続。証拠: image-studio/docs/browser/validation/2026-11-02-portrait-connection-and-runtime-limits.json。

### 2026-11-02: portraitの既存CPU配置/JSEPを比較、変換物の採用を保留

前turnはportrait接続とnative storage-buffer限界の特定を進めたprogress。今回、元graphのwide Concatは4個（入力1024/256/64/16）と確認し、公式forceCpuNodeNamesで4個をCPU指定したが17-vs16 shader errorは残った。実際の失敗op/最適化後の配置は未特定であり、Concatが原因である/4個がCPUで走ったとは断定しない。未確認のCPU配置option/testは通常sourceから撤去し、first-party snapshot/private replayへ退避した。

取得済み公式ORT1.31.1 JSEP bundle/wasmと既存device ownerをprivateで再利用。モデル重み/グラフは同一。JSEPのConcatは既存のbatch実装を持つが、default graph optimizationではFP16 com.microsoft.FusedConvがJsExecutionProvider未対応でprepare失敗。公式graphOptimizationLevel=basicではprepareに成功し、推論へ進むがbrowser private commitが4GiB予算を超えて停止した。観測最大working set2,718,859,264byte/private commit5,757,153,280byte、全GPU4259MiB。常駐RAM・commit・全GPUは別指標であり、サンプルは瞬間peakやプロセス専有VRAMの保証ではない。上限を増やして再実行せず、PNG/alpha未取得、数値/画質/速度は未受入。

全3browser終了/process0、server77389/42151/3353終了130。JSEP sourceの実験はprivateだけで、通常runtimeのnative限定は維持。追加ML依存・upstream/runtime/kernel patchなし。retire後の関連33test pass、既存全domain246testとは区別。今回の不成立は取得済みportrait変換物/ORT/profileの条件であり、portrait一般の品質否定ではない。

この変換物は負荷条件付きで保留し、次は既存の軽量BiRefNet変換物と、MODNet最大形状/画質・CPU modeなど本体受入を進める。HR referenceと新しいdynamic/matting候補、元のMatte/顔/UX/Pages-R2/公開というfull scopeを維持。証拠: image-studio/docs/browser/validation/2026-11-02-portrait-existing-api-comparison.json。

### 2026-11-02: MODNet CPU modeを本体接続、最大寸法PNGを確認

前turnはportrait既存API/JSEPの比較と採用保留を進めたprogress。今回は既存ORT/Transformers.jsへtrusted executionProvider=wasmを明示するMODNet FP32専用CPU modeを追加した。WASM1thread/proxyfalse/既存pinned assetsを再利用、GPU API不要・adapter/device取得なし。CPUへ黙ってfallbackせず、HR等の未対応CPU指定は拒否。CPU/GPUでmodelVersion/Workerを分け、同じ重み/cacheを共有。cache UIの物理資源計数は同一namespace/URL/SHA/bytesのみ重複を除き、矛盾descriptorは拒否する（新cache engineなし）。

最初のWindows→WSL loopback取得は推論前にEACCES。WSL curl200/own server生存、Windows native fetchでもEACCES/localhost timeout、除外port範囲外・Windows listenerなしを確認し、再bind後も未復旧。OS/firewallは変更せず、既存Playwright route.fulfillで固定artifact allowlist/CSPを配信してCPU計算の検証を分離。通常HTTP/Pages-R2の受入とはしない。own WSL servers3463/78735終了130。

実Windows Chrome本体で1086×1448写真→CPU推論→透過PNG実保存完了。model WorkerのrequestAdapterをbundle開始前からthrowさせても完走し、observerのadapter probeもskip。CPU/GPU切替を含む別観測でもphoto保持/旧PNG削除/追加推論なし。PNG2,297,950byte/SHA8ef80121f72498d3ddc4ccb064d0b9739df0b884bdebd6a2bc9a2beeb7f63fee。GPU版alphaとの差は143画素が1/255だけ、不透明元RGB不一致0。prepared→result約1.779秒は前後処理/Worker往復込み、pure CPU kernelではない。model CacheStorage warm・single観測でcold性能とはしない。

上限2000×2000の許諾済み生成寸法fixtureでもCPU→前景色→PNG実保存完了（7,042,010byte/SHAa2c0d69e7d94915e09e848fdf0e9b3c088695675cb3095302bf9bf612752834f）。不透明元RGB不一致0、独立Python ORT CPU参照とのalpha差は400万画素中386画素が1/255（参照alpha拡大はPillow、browserはTransformers.interpolate）。prepared→result約1.536秒。Chrome観測最大working set1,056,436,224/private commit944,103,424byte。ブラウザ描画のGPU利用とは別であり、全体VRAM0や瞬間peak保証とはしない。全3成功browser終了/process0/download清掃、実モデル/PNGはmockしないが配信transportは固定fixture。

全domain250test/typecheck/Pages build pass（11file/3,222,213byte、deployなし）。CPU未対応role/暗黙downgrade拒否、GPU無しbootstrap、共有cache矛盾、CPU observerでadapter非取得を検証。公開背景は準備中。CPU modeの一般画質/極端aspect/通常配信、軽量新model/HR性能/Matte/顔/UX/Pages-R2/公開という元full scopeは継続。証拠: image-studio/docs/browser/validation/2026-11-02-modnet-cpu-main-and-max-size.json。


### 2026-11-02: 透過PNGのcrop受け渡しと上流失効

実ChromeのCPU背景→crop→A4 PNG/PDFで、ファイル保存までは完了したが2点を検出した。crop artifactのisCurrentが親の背景revisionを伝播せず、上流変更後の印刷を失効できなかった。getCropArtifact取得時とisCurrent両方へ既存validOriginを接続し、React再描画前の失効も回帰テストで確認した。

もう1点は、既存Pillow互換RGB crop decoderへstraight RGBAを直接渡すと透明部分のRGBが露出すること。全decoder/数値互換を変更せず、背景editorから透明画像をcropへ渡す際だけ、既存session.save(backgroundColor:white)の合成/exportを再利用する。元の透過PNGのpreview/downloadは保持し、モデル再推論や新pixel kernel/依存は追加しない。ボタンを「白背景にしてサイズ調整へ」とし、RGB印刷への変換を明示。既存prepared cacheの白画像を再利用し、epoch/session owner/closedで遅延completionを拒否する。関連UI43testとtypecheck pass。実browser再確認は別途記録する。

DA3/ComfyUI-AutoMaskは追加補正候補として調査。DA3 Smallは0.08B relative-depthモデルで、実測Z距離や境界完全除去を保証しない。AutoMaskはhistogram thresholdとPyMatting closed-form mattingを利用するPython/OpenCV依存。静的browserへ直接導入せず、既存Matte/foreground補正を先に完成する。深度追加の品質/速度/メモリは未測定、標準処理への採用なし。参照: https://huggingface.co/depth-anything/DA3-SMALL 、https://github.com/easygoing0114/ComfyUI-AutoMask 、https://pymatting.github.io/ 。


修正後の実Chrome journey-02は8工程すべて完了。CPUモデル推論1回、終了browser process確認済み、最終gate free。crop354×472 RGBとA4 PNG2480×3508 RGBは300dpi、PDFは1page/A4 595.2×841.92pt。Poppler抽出PDF imageと用紙PNGの全RGB一致。crop隅は白、保存画像を目視し背景再露出の解消を確認した。ただし独立Pillow白合成/Lanczos縮小との比較は199950channel差/max30。現行本体cropはCanvas high-quality drawImageでありPillow resizeとの同値ではなく、画質互換の受入は残す。

実画面screenshotはunstyledだった。private observer route.fulfillのMIME表にCSS/SVGがなく、nosniff付きoctet-stream配信となっていることをsourceで確認。通常appやCSSそのものの品質判定には使わず、次に検証transportのMIMEを修正して実画面を確認する。normal HTTP/Pages配信の受入も別途残る。最終Pages buildは11file/3,223,065byte/check pass、deployなし。証拠: validation/2026-11-02-background-crop-print-journey.json。


### 2026-11-02: CSS/SVG MIME修正とdesktop/mobile実画面

private Playwright route.fulfillのcontentTypeにtext/css・image/svg+xml・image/png・text/plainを追加し、nosniffを維持。製品CSSやupstream runtimeは変更しない。visual-journey-01はhome1440/390pxの表示確認後、observerが未選択inputを「写真を選び直す」で探してtimeoutし終了。実行はterminal/browser exit確認し、selectorを現在の「写真を選ぶ」へ直して別outputのvisual-journey-02を実行した。

02はhome/crop各1440×1000と390×844でCSS/ロゴ読込・横overflowなし、route見出しへのfocus、次TabのSELECTがviewport内にあることを確認。保存済み白背景crop PNGを入力し、モデル/runtime/validation-worker request0、console/page error0、browser終了確認。正常HTTP/Pagesの証明やモデル/印刷受入、タッチ/人の視線観察ではない。

目視でmobileは設定が長く写真previewまでの往復距離が大きいことを確認。既存のfocusSectionと通常anchorを再利用して、写真選択直後に「写真と仕上がりを先に確認」linkを追加。元からある設定末尾のpreview linkとpreview下の戻るlinkも保持。DOMと見た目を一致させ、新UI library/固定overlayは追加しない。既存のfocus回帰テストへ早期linkも含める。添付スクリーンショットはこのlink追加前で、変更後の実画面確認はまだ別途必要。証拠: validation/2026-11-02-styled-ui-desktop-mobile.json。


早期preview link追加後のvisual-journey-03も同じ4画面のCSS/ロゴ・横幅確認を完了。390pxで早期link→「仕上がりを確認」focus→「設定へ戻る」focusの往復とhash #/crop維持を実Chromeで確認。モデルrequest0/error0/browser exit確認。App34test/typecheck/Pages artifact check pass（11file/3,223,225byte）。03 screenshot/結果を同じvalidation JSONへ追記。公開・人の観察・全導線受入は未完。


### 2026-11-02: HRマスクを既存registryで保持し、補正切替の再推論を省く

前turnはCSS/MIMEと実画面・早期preview往復を進めたprogress。今回の本体確認で、refine切替のたびにHR46stageをやり直す設計を特定した。画素演算/モデル/新cache engineを増やさず、既存createImageRegistryに同じrgbAssetId/modelVersionのbase alphaを1枚だけ保持する。最初のHR disposeとisCurrent確認後にalpha copyを登録し、refine時だけそのcopyを既存createSerialInference→trimap→ViTMatte→foregroundへ渡す。補正結果をbaseへ上書きせず、同じ写真で補正を繰返してもマスクが劣化する連鎖を作らない。保持は最大2000×2000×1byte（4,000,000byte）、永続化・別写真/モデルへの流用なし。切替後の「背景除去」実行（refine OFF）は明示的に元モデルを再実行する。

写真の入力検証成功後/モデル変更/closeで解放。無効な写真の置換失敗では元のbaseを保持。補正中止後はbaseを残し、遅延結果のcommitは禁止する。既存gate、Worker dispose/cancel、export失効をそのまま通す。UIはbaseがありrefine ONなら「輪郭を補正してPNGを作成」と表示。MODNet/portraitとMatteの未検証組合せは従来どおり拒否する。新ML依存、pixel kernel、upstream patchなし。

処理系253test pass（関連serial/session24testを含む）。写真/model変更、refine繰返し、base再実行、失敗置換、中止、close、異常alpha拒否、元RGB保持を確認。これはtest doubleを含むアプリ状態検証で、実機の速度/画質/メモリ改善の実測ではない。

通し検証に先立ち、公式Playwright browserContext.routeでparent Worker→nested Worker→fetchの小fixtureを試したがchild-load-failed（実モデルなし）。Native Windows Nodeでloopback bind成功後の自己fetchはEACCES、同じWindows listenerへの実Chrome通常HTTPもERR_NETWORK_ACCESS_DENIED。WSL特有と決めつけず、通常HTTP/nested Workerは未解決として残す。全probe browser exit確認、native HTTP server close確認、モデルrequest0。OS/firewall/policy変更なし。公式API参照: https://playwright.dev/docs/api/class-browsercontext#browser-context-route と https://playwright.dev/docs/network 。証拠: validation/2026-11-02-refinement-mask-reuse.json。

最終関連UI44test/typecheck/Pages build pass（公開なし）。保持alpha最大4MBはretained planeの上限であり、処理中のcopy・既存alpha/RGBA・モデルtensorを含む総メモリ上限ではない。


### 2026-11-02: cache破損・取得失敗の案内と本体復帰を確認

既存ResourcePolicyのchecksum/bytes検証とnative CacheStorage UIを再利用。sessionのresourceError whitelistへbytes-mismatch/bytes-overflowを追加し、UIではchecksumと同じ「保存データ削除→再実行」を案内する。transport-failedには「接続を確認して再実行」を表示。写真/設定を保持し、raw例外の本文を表示しない。新cache engine/依存/画像演算なし。関連session15test/UI13test、全domain254test pass。

実Chrome cache-recovery-01/02では、observerがsanitized traceに存在しないresourceErrorを待ちtimeoutした。consoleのFailed to fetchだけで「モデル整合性検査前のWorker通信失敗」と推測したのは誤りで、これらをその証拠にしない。実際のUI alertとgate/photo/resultを確認する03へ修正した。page.routeからcontext.routeへ切替えた固定allowlist配信を使用し、CSS/SVG等の正しいMIME/nosniffを維持する。01/02/03はすべてterminal/browser exit確認。

03は実モデルconfig（83byte）のmodel_type文字列だけを同長で変えnative CacheStorageへ保存→本体実行でchecksum案内/写真保持/結果なし/gate free→本体の削除buttonで0/2file→configのGETだけabortして取得失敗案内/写真保持/結果なし/gate free→固定allowlistの通常応答に戻し再実行、の4工程を完了。正常config/FP32 ONNX約26MB/固定ORT asyncify MJS+WASMが実requestされた。成功したモデルresultは1回、透過PNG 2,297,950byte/SHA256 8ef80121f72498d3ddc4ccb064d0b9739df0b884bdebd6a2bc9a2beeb7f63feeで従来正常出力に一致。モデル/画素はmockせず、transportと2つの故障条件だけを操作した。全requestは固定allowlistのGET、GPU adapter非取得、最終gate free/browser exit確認。

これはprivate transportの1件の復帰受入。通常HTTP/Pages/R2、容量不足、全面offline、GPU喪失、長時間利用、全モデルの受入は残す。前turnで別に確認したnative HTTPのERR_NETWORK_ACCESS_DENIEDとnested Worker child-load-failedは未解決だが、今回の01/02 timeoutとは分ける。証拠: validation/2026-11-02-cache-and-fetch-recovery.json。

最終typecheck/Pages build・静的artifact検査もpass。配信/公開操作は行っていない。


### 2026-11-02: 既存出力検証を4用紙へ広げる

前turnはcache破損/取得失敗から実PNG保存への復帰を確認したprogress。今回、既存check_paper_save_pipelineのL判固定を任意用紙/既存RGB8 fixtureへ拡張した。製品のrenderPaperRgb/fast-png/pdf-lib/Worker/registry/Blob経路をそのまま利用。新ライブラリや独自serializerなし。A4/L/2L/はがきの8出力を1件ずつ生成し、別実装のPillow貼付とPoppler PDF抽出で全RGB・配置・余白・DPI・ページ寸法・metadataを確認した。A4は実Chrome保存物と全byte一致。8Worker停止/全URL解放。Python/Popplerはoffline検証だけでアプリ実行依存ではない。全4本体UI/実印刷/他写真寸法/crop resampler互換の受入は残す。詳細はcoordinates-and-print.mdとvalidation/2026-11-02-all-paper-artifacts.json。製品ソース変更がないためフロントbuild/既通過の全テストは繰返さず、実export検証を変更に対応する確認とした。


### 2026-11-02: npm標準SBOMを評価、既存notice生成とMODNet文書を照合

前turnは4用紙出力の独立画素/metadata/PDF検証を進めたprogress。今回は新libraryを追加せず、公式npm sbom(CycloneDX)を試した。omit-devの13componentは実production graph16packageのうちreact/react-dom/schedulerを落とすため、installed/lock-only/include-peerでも完全性を確認できず、単独採用しない。既存npm lsとnotices.mjsで全16package heading・実license全文の再生成byte安定性・dist同一性を確認した。独自依存resolver/新SBOM engineは作らない。

MODNetの固定ONNXモデルカード、元repoの固定README/Apache LICENSEを既存model-noticesへ保存してsource indexを更新。codeとmodelsへの適用声明は確認済みだが、ONNXと元checkpointの対応/変換履歴/採用binary全体のauditは残す。手動Web版とprivate ML版の権利表示範囲を区別し、public model採用や配信設定は変更しない。製品source/依存は未変更、実notice再生成とSHA照合が今回の検証。文書変更だけを理由に全build/testは繰返さない。詳細はdistribution-conditions.mdと2026-11-02-production-notice-audit.json/2026-11-02-modnet-license-evidence.json。


### 2026-11-02: 4用紙の本体保存を既存Playwright/CDPで確認

前turnはMODNetライセンス根拠/production16依存noticeを照合したprogress。今回は既存Playwright context.routeとtask-owned Chrome/CDP native download helperを再利用し、既存crop PNGを直接印刷へ入力して全4用紙/PNG-PDFの8保存を直列実行。既存の独立Pillow/Poppler検証済みartifactと全byte一致、PNG形式往復/用紙変更時の失効/focus往復を確認した。新依存/画像処理/製品source変更なし。モデルrequest0/error0/最終gate free/browser exit/download cleanup確認。通常HTTP/Pages-R2・実プリンター・全UX受入は継続。証拠: validation/2026-11-02-main-four-paper-downloads.json。


### 2026-11-02: 実書出Workerの開始待ちを中止・失効し復帰

前turnは4用紙PNG/PDFの実Chrome保存を進めたprogress。既存Playwright route.fulfillを一時保留するだけで、実Worker script取得待ちを作り、中止と作成中の用紙変更を検証。製品task/gate/AbortController/Worker terminationに手を加えず、遅延script応答解放後も旧保存linkなし、写真保持、gate free、最新設定での実PNG保存を確認。正常L出力と全byte一致。新依存/製品source変更なし、追加全build/testは行わず実browserの2競合と復帰を検証とした。モデルrequest0、browser exit/download清掃確認。計算済みの遅延resultやPDF等を網羅したとは扱わない。証拠: validation/2026-11-02-export-cancel-stale-recovery.json。


### 2026-11-02: 既存BiRefNet lite ONNXのグラフとCPU資源を比較

前turnは実書出Worker開始待ちの中止/失効と復帰を確認したprogress。モデル構成比較へ戻り、既取得metadataが示すonnx-community/BiRefNet_lite-ONNX revision de15b22ba131738a16dff04aab8bdf8dc32e3ac1が現在のmainと同じことを公開APIで確認。FP16114,538,221byte/SHA d39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402を4MiB/s程度でprivateへ取得し、stream SHA/長さとONNX1.23.2 checkerを照合した。元モデルはBiRefNet_liteでありlite-mattingとは別。

FP32 input_image[1,3,1024,1024]→FP32 output_image[1,1,1024,1024]、opset17、initializer437個はFP16、external dataなし。最終Cast←Convでraw logits（最後のSigmoidなし）。既存portraitと同じpublished ImageProcessor/Tensor.sigmoid/alpha interpolationを再利用できるIOだが、まず実行可能性を確認する。グラフ16,446node、Concat629個、最大fan-in1024/256/64/16がある。fan-inだけでnative GPUの具体的な失敗opと断定しない。

実onnxruntime1.31.1 CPUExecutionProvider限定、1thread/arena-off/memory-pattern-off、nice19/core0、仮想4GiB/timeout120秒で合成1件を実行。prepare約4.50秒まで通ったが、推論の/decoder/decoder_block1/dec_att/aspp_deforms.2/atrous_conv/Mul_8でstd::bad_alloc。観測maxRSS3,015,844KiB、exceptionを記録してterminal、alpha未取得。増量再試行/追加GPU実行は行わない。

失敗nodeのexport metadataは出力[1,1,64,49,256,256] FP16、205,520,896要素=411,041,792byte（392MiB）。FP32化された場合は784MiBになるが、optimized CPU temporaryのdtypeは未採取なので実際にpromotionしたとは主張しない。重み約115MBだけでは実行資源を判断できない具体例で、候補を現在予算下で保留。品質否定や全liteモデル不成立とはしない。次は既存export/runtimeのDeformConv展開・中間tensorを確認し、独自kernel/際限ない分割/安易な予算増加を増やす前に既存のより効率的な配布物/公式経路を検討する。製品model role/選択UI/公開設定は未変更。HR基準・MODNet baseline・Matte/CPU/UX/配信の元scopeを維持。

一次資料: https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/tree/de15b22ba131738a16dff04aab8bdf8dc32e3ac1 と https://github.com/ZhengPeng7/BiRefNet 。証拠: validation/2026-11-02-birefnet-lite-graph-and-cpu-budget.json。


### 2026-11-02: 既存の標準DeformConv exportと512px版を比較

前turnは従来lite FP16 ONNXを4GiB CPU予算で試し、392MiBの宣言中間tensorを持つ箇所でbad_allocとなることを確認したprogress。独自kernel/graph分割を増やす前に公開配布を再検索し、studioludens/birefnet-lite-512（962e67969ec6acec9c19fab76acee4f5e22e990c）とsenty-au/BiRefNet_lite-ONNX-dynamic（173d635935b93839608b9b9039da8d1d212471e9）を固定metadata/cardから確認した。

512版FP16は98,484,532byte、MIT/standalone LICENSEあり。作者は入力512化で中間tensorを縮小する旨を説明している。1024/HRと同等として既定置換せず、解像度を変える別品質mode候補とする。重みは未取得/未実行。

native DeformConv版FP32を4MiB/s程度でprivate取得し、180,839,545byte/SHA1e0da42f0fde010e32e938bad388457ecefe35806fde9d923421997861ae9391を確認。ONNX1.23.2 checker通過、opset19、FP32 input_image[1,3,h,w]→logits output_image[?,1,h,w]、external dataなし、initializer437個FP32。16k近いshape等のnodeは残るがDeformConv20/GatherND0/Sum0、最大Concat fan-in6（従来1024）。動的入力の64倍数条件・性能は作者声明で、実測ではない。

ORT1.31.1固定WebGPU provider sourceにDeformConv登録はなく、公式CPU sourceはfloat/doubleのkernelを登録。固定asyncify WASM内にはDeformConv文字列が14回あるが、名前の存在で実行可能とは判断しない。次はbounded CPU参照と小WASM演算対応を確認し、native CPU成功をGPU成功へ読み替えない。今回モデル推論/browser/GPUは実行せず、sourceの改変/build/自前exportも行わない。

重みの構成を確認するためFP32 native initializerをFP16丸めして従来FP16のshape+value SHA multisetと比較。437個中388個が一致、49個は未説明。これは名前/接続/元checkpoint同一の証明でもなく、CPU FP32出力一致の証明でもない。公開export sourceはsnapshot_downloadのrevision未固定、load_state_dictはunexpectedだけを拒否しmissingを検査していないため、採用時は元revision/重み対応を独立確認する。第三者codeはtextとして確認しただけで実行していない。

HR基準とMODNet CPU/GPU baseline、Matte/前景/crop/UX/Pages-R2の元scopeは維持。より効率的な既存exportを候補として確認できたが、標準採用/画質/速度/資源受入は未完。一次資料: https://huggingface.co/senty-au/BiRefNet_lite-ONNX-dynamic 、https://huggingface.co/studioludens/birefnet-lite-512 、https://github.com/microsoft/onnxruntime/blob/v1.31.1/onnxruntime/core/providers/cpu/nn/deform_conv.cc 。証拠: validation/2026-11-02-efficient-birefnet-export-review.json。


### 2026-11-02: native-DeformConv全CPU参照と固定WASMの演算対応

前turnは既存の効率的なexportを調査し固定グラフ/変換元差を採取したprogress。今回はsenty-au固定FP32 graphを同じ合成画像/1024px/Pillow12.2.0前処理で、ORT1.31.1 CPU限定・1thread/arena-off/mem-pattern-off・nice19/core0・仮想4GiB/120秒で実行した。input float32 SHA ae7b95d48feea1141fba4e7da0ebf7afe0c5fc0b1bf09333508e651aba4be59aは前回stock FP16試行と一致。prepare5.816秒/infer12.738秒、maxRSS1,854,356KiB（約1.77GiB）、finite logits[1,1,1024,1024]を取得し元寸法alphaも保存。native FP32とstock FP16は精度/graph/一部initializer差があるため、変換方法だけの純粋な速度比較や同一品質の証明にはしない。CPU scriptの説明に残っていたコピー元FP16の文字をFP32へ修正したが計測値は変更していない。

既存ONNX/native ORT helper APIで291byteのopset19 DeformConv fixtureを作り、3x3/weight2/bias1に対してzero offset、zero mask、fractional offset+maskの3caseをnative CPU参照化。固定未改変ORT Web1.31.1 entrypoint+asyncify MJS/WASMを実Windows Chromeのroot Workerへ読み、WASM1thread/proxyfalse/CPU provider限定で実行した。3case全9値がnative参照と誤差0、GPU request guardの呼出0。tensor.dispose/session.release/Worker terminate/browser exit確認。これは名前存在の推測から実行対応の証拠へ進んだが、大形状/全graphの可否には流用しない。

続けて全native graph/同じpreprocessed input/CPU logits参照をprivate fixed route配信で試したが、計測開始直後の状態しかreportに残らず、cleanupでTask browser identity mismatchになった。元の停止理由/peakがcleanup前に保存されず、モデル失敗/資源超過/監視失敗の区別ができない。全WASMモデル結果は未取得とする。識別できないChromeへforce終了せず、対象script名で識別した監視Nodeだけを停止（exit255）。後続の同じroot PIDのresource検査でprocessCount0、observer終了を確認した。今回の全modelを成功/特定原因の失敗とは扱わない。

次試行用private observerはfresh task profile/PID記録、毎stop/failureのcleanup前保存、context close timeout、識別/終了検査失敗でもreceipt保存へ修正しsyntax checkのみ。追加実行はまだしない。製品model role/標準選択・公開設定/元APIは変更していない。WASM全graph実行、本体matting/foreground/PNGと品質/速度/資源、49initializer差/元checkpoint対応は継続。証拠: validation/2026-11-02-native-deform-cpu-and-wasm.json。


### 2026-11-02: 大モデルの検証transportを標準File APIで解消

前turnはnative CPU全graph成功/WASM小DeformConv一致を確認したprogress。修正observerとfresh profileで全WASM試行02を実行したが、180,839,545byteのfull-model.onnxをroute.fulfillした直後にpage/context/browser closedとなった。今回はstop理由とsampleをcleanup前に保存できた。残ったsampleは約0.52GB WS/0.30GB privateで、推論結果もruntime WASM取得もなく、モデルOOMとは判定しない。context closeの後にPID identityを再確認できずscope終了は拒否されたため、該当scriptのNodeだけを停止（exit255）。後続の元PID検査でprocess tree0、observer終了を確認。

公式Playwright実装はfulfill本文をbase64のFetch.fulfillRequestとして送り、公式Chromium mainのASCIIZ pipeは100MiB受信buffer上限を持ち、容量不足でconnectionを閉じる。今回モデルのbase64本文は241,119,396byteで上限を超える。症状と整合するが、確認sourceは実Chrome binaryと同一revisionとまでは検証していないため原因断定はしない。増量/同じ大応答の再送は行わない。

独自Range downloaderやgraph分割を作らず、公式setInputFiles(path)をprivate診断inputへ適用し、native FileをWorkerへstructured cloneして読む方法を選んだ。実Chrome transfer-only確認で全180,839,545byte/SHA1e0da42f0fde010e32e938bad388457ecefe35806fde9d923421997861ae9391一致、推論0、error0、context close/browser exit確認。HTML/Workerは固定private validationだけで、公開本体にモデル手動選択やlocal-path読み出しを追加していない。productionは既存manifest/cache/R2のまま。

次試行のFile版observerを準備し、fixture responseは64MiB超を送信前拒否するguardを入れsyntax確認。今回は転送確認後の全model推論は再実行していない。native CPU参照/小WASM演算対応以上の、全WASM品質/速度/資源や本体接続の受入は未完。一次資料: https://playwright.dev/docs/input#upload-files 、https://chromedevtools.github.io/devtools-protocol/tot/Fetch/#method-fulfillRequest 、https://raw.githubusercontent.com/chromium/chromium/main/content/browser/devtools/devtools_pipe_handler.cc 。証拠: validation/2026-11-02-large-model-transport.json。


### 2026-11-02: native DeformConv全WASMと既存本体経路への接続

標準File転送で固定FP32モデルの全graphを実Chrome/WASM 1threadで1件実行し、prepare12.644秒/infer25.149秒、観測最大WS約2.32GiB/private約2.20GiB、GPU要求0/終了を確認。CPUと同じ前処理済み入力に対するlogit最大差約5.15e-5、1024²でsigmoid丸めしたalpha差は2画素各1段階。元解像度復元・foreground・本体PNGや一般品質を証明するものではない。

新しい推論engine/pixel kernelを増やさず、既存single-session mask inference、Pillow bilinear、Transformers ImageProcessor/Tensor、ORT公式WASMを再利用するlite roleを追加。FP32/明示WASMのみでGPU要求前に拒否条件を検証し、MatteはHR限定を維持。portrait adapterは共通BiRefNet adapterへの互換reexport。private worker/mainはbuild済み未実行、public defaultはunconfigured。処理系258testとtypecheck/通常build pass。49initializer差/元checkpoint対応、全binaryライセンス、通常配信と品質受入は残る。証拠: validation/2026-11-02-native-deform-full-wasm.json。


### 2026-11-02: lite本体PNGの1件受入

既存background session→Pillow bilinear/Transformers前処理→ORT WASM 1thread→既存foreground→PNG exportを、許諾済み合成1086×1448画像で1件実行。大モデルは標準Fileを検証専用CacheStorageへ格納し、本体のresource bytes/SHA検証は維持。64MiB超のroute応答を拒否し、独自downloader/モデル分割は追加していない。PNG2,162,611byte/SHA09027a19961cb672993bdfc9598b19efa8c13d662d3e29b752f3cb0698a0c70c、透明760,375画素/半透明40,898画素、不透明771,255画素のRGB差0。観測最大WS約2.25GiB/private約2.12GiB、gate解放・browser終了・download cleanup確認。prepared→resultイベント間約24.73秒は前後処理を含みkernel単体時間ではない。通常HTTP/Pages/R2、一般画質/連続利用、元checkpoint対応、Lite+Matteは未受入。証拠: validation/2026-11-02-lite-main-png.json。


### 2026-11-02: lite保存alphaと固定ライセンス宣言

保存済み本体1086×1448 PNGのalphaを同じnative FP32 graphのCPU参照と比較。1,572,528画素中2画素のみ各1/255差、平均差約1.27e-6 code unit。推論だけでなく既存前処理/元寸法復元を含む1件の数値一致根拠になるが、原著PyTorchや一般品質の証明ではない。MODNetとのalpha差156,857画素/平均1.135code unit/最大150はmodel間差であり、正解なしの優劣判定には使わない。追加推論なし。

原著lite固定revision aa62cd87eafb9cc43056d08ef3615a14628b831dのmodel cardと取得済みnative ONNX固定cardをmodel-noticesへ保存しsources.jsonへSHAを登録。両cardのMIT宣言を確認。native exporterの元revision未固定/missing weights未拒否、49initializer差は未解決なので配布許可完了・原著同一とは扱わない。証拠: validation/2026-11-02-lite-license-and-artifact-comparison.json。


### 2026-11-02: lite initializer差のFP16変換規則による説明

前回未解決とした49initializerは、native FP32を単純FP16丸めする比較では不一致だった。公式onnxconverter-commonの既定規則（0<絶対値<1e-7を±1e-7、有限絶対値>1e4を±1e4へclip後FP16）を適用すると、shape/value hashの多重集合で437/437が一致。名前一致で追える22tensorの差もすべて同規則で消える。これは値差の説明を得た進捗で、graph topology/元checkpoint revisionや実際に使われたconverter版の証明ではない。元modelを書換えず静的比較のみ、低優先度1core。証拠: validation/2026-11-02-lite-initializer-clipping.json。参照: https://github.com/microsoft/onnxconverter-common/blob/master/onnxconverter_common/float16.py 。


### 2026-11-02: crop用Lanczosの入力範囲を既存Pillow adapterで分離

既存pica比較はfractional crop APIとPillow数値対応が不足し保留済み。新resamplerを作らず、既存の未改変Pillow Resample.cへ専用pillow_crop_rgb入口を追加。original軸16384/24MP、出力軸4096、小数boxを許可し、モデル用Lanczos/bilinearの2048制限は維持。JS adapter/runtimeは明示filter=cropのみ新入口を使用、private builderは--cropでexportを追加。既存managed runtime fork/上流SHA検証と128MiB growth予算を使用。

合成人物1086×1448のfractional crop354×472、2049×1448入力、2050×16出力の3件でNode WASMと独立Pillow LanczosのRGBが全byte一致。adapter8test pass。観測WASM memory26,017,792byte。本体WorkerはCanvasのままで、最大24MP/4096出力・異常資源・実browser/CSP、fork/release/license確認と本体統合は未完。既存通常版の配布物へ診断WASMは追加していない。証拠: validation/2026-11-02-crop-lanczos-candidate.json。


### 2026-11-02: crop Lanczosの24MP/4096境界と予算不足

前turnのcrop入口を変更せず、6000×4000（24MP）→4096²のfractional boxと16384×1→4096×1をNode WASMで実行。独立Pillow Lanczosと全byte一致、元RGBのSHA不変。最大case約1.900秒、WASM351,797,248byte（512MiB growth予算内）、Node RSS観測540,286,976byte。これは最大pixel数と最大出力軸を含む2fixtureの根拠で、全aspect/全crop/ブラウザ全体の資源保証ではない。

64KiB予算は初期module上限で拒否され、128KiBではallocation時にgrowth拒否→resize-memory-failed/closedで再利用不可。最初のharnessは初期化拒否を想定せず終了したため、最大caseを繰返さず低予算部分だけ別検証した。本体Canvas置換、trusted artifact/SHA接続、実Worker/browser/CSP、公開fork/release/licenseの受入は残る。証拠: validation/2026-11-02-crop-lanczos-boundaries.json。


### 2026-11-02: crop本体Workerへの検証用Lanczos接続

本体crop.workerへ既存Pillow runtime/専用crop入口を接続。trusted build定数に固定URL/bytes/SHAがある場合だけ有効にし、通常buildはCanvasを維持。取得は既存resource-policyを再利用し64KiBまで、hashは標準Web Crypto。resource-policyは同期/非同期digestの両方をawaitし、中止済みならverifiedへ遷移しない。新hash/cache/downloader engineなし。configured asset失敗でCanvasへ黙って切替えず、既存失敗/再試行・Worker終了へ戻る。直接PNG印刷はresizerを準備しない。

self/Node実handlerの接続・破損asset拒否、既存直接印刷/API不足を合わせ10test、resource-policy16test pass。接続testのruntimeはmockで数値受入と区別。型検査/通常build11file3,232,858byte、私有build28mount/重み読込0。発行crop Workerに固定URL/SHAが含まれ、通常版にはprivate URLなしを確認。実browser/CSP/保存/中止、公開fork/release/licenseは未完。証拠: validation/2026-11-02-crop-worker-integration.json。


### 2026-11-02: 本体cropの実Chrome Lanczos保存

私有buildの本体crop画面へ許諾済み1086×1448画像を読み込み、範囲75%の小数box（135.75,181,950.25,1267）から354×472 PNGを実Worker/WASMで保存。独立Pillow RGB/Lanczos参照と全channel byte一致。PNG314,836byte/SHA30bffab2cd327c6475e2e0b6b0ea134c6cb6fc98e4dc27e5d2c4354d5881c3da、300dpi、gate解放/browser終了、モデル要求0を確認。観測WS638,140,416/private441,851,904byte。

標準Web Crypto SHA確認とwasm-unsafe-evalを含むprivate CSPで成功した限定根拠。通常HTTP/Pages/R2、実browser最大寸法/全aspect/中止・破損・再試行、公開fork/release/licenseは未完。通常版Canvas維持。証拠: validation/2026-11-02-crop-main-browser.json。


### 2026-11-02: 実cropのasset中止/破損/再試行

実Chrome本体のcrop WASM responseを保留しUI中止、同長1byte破損を送って拒否、正常assetで再作成の3操作を確認。両失敗で元写真1086×1448と範囲75%を保持、旧PNGなし/gate解放、再試行PNGは前回のPillow全byte一致PNGとファイル全byte同一。model要求0/error console0、browser終了/download cleanup確認。計算中のWASM中止を検証したとは扱わない。

観察したgeneric failure文言を改善し、asset準備失敗は固定crop-resize-unavailableを既存Worker/client経由で伝え、接続確認・同じ写真設定で再作成できる案内へ変更。実browserは旧buildの文言、改良文言はhandler/UI testで区別。関連11test/typecheck/通常build pass、追加の同input再試行UI testは別確認。通常Canvas維持。証拠: validation/2026-11-02-crop-cancel-corrupt-retry.json。


### 2026-11-02: cropの24MP JPEG/画面最大寸法

許諾済み合成人物から作成した6000×4000 JPEG（24MP/2,365,757byte）を実Chrome本体へ入力。カスタム152×152mm/範囲75%の3000²cropから1795²/300dpi PNG4,749,731byteを保存。native browser JPEG decode/既存RGB変換/Lanczos/PNG全経路で独立Pillow JPEG decode+LanczosとRGB全byte一致。この1件の一致をICC/EXIF/全JPEG一般へ広げない。観測約2162msはpoll overhead込、最大WS1,291,821,056/private1,005,879,296byte、gate解放/browser終了/download cleanup/model要求0。

最初のattemptは用途のexact label locatorでexport前に停止し、accessible combobox roleへ修正。両browser終了確認済み。UI上限1795pxとWorker4096pxを区別し、ブラウザ4096出力や全aspect/計算中止/通常配信/公開releaseは未完。証拠: validation/2026-11-02-crop-max-browser.json。


### 2026-11-02: crop WASMのライセンス/再現性レビューと作業path除去

Pillow12.3.0のMIT-CMU原文と固定xcc commitのMIT原文をruntime-noticesへ保存。旧crop artifactは再buildでbyte一致したがassertの__FILE__文字列にhome source pathが含まれていたため、通常配布前の問題として修正。compilerへ渡すC sourceをtemporary内の固定part-N.c名に揃え、必要な元header include pathは明示。compiler/runtime/filterのupstream改変は増やしていない。

修正artifact14,282byte/SHA3f72eca97528354a6a8b7119c852d8d235fb6b5185395e57be4f852272e92d7dは別directory/output名で再build全byte一致し、home path文字列なし。fractional/2049入力/2050出力の3caseもPillow全byte一致。旧browser検証済みartifactとはhashが変わるため実browser再受入は未完。runtime fork baseのgit archive、差分、app host/shim/build script、Pillow source/headerと全licenseをprivate crop-release-review-01へ19fileでまとめた。

レビュー用packageは公開releaseではなく、独立compiler bootstrap、管理fork/tag/release、sanitized build recipe、全third-party適用監査は継続。通常版Canvas維持。証拠: validation/2026-11-02-crop-release-review.json。一次資料: https://github.com/python-pillow/Pillow/blob/12.3.0/LICENSE 、https://github.com/tyfkda/xcc/blob/631e318432aeaaf72d6d2dfc93085766934314a2/LICENSE 。


### 2026-11-02: canonical crop artifactの実browser再受入

path除去版SHA3f72eca97528354a6a8b7119c852d8d235fb6b5185395e57be4f852272e92d7dで私有build03を生成し、実Chromeでasset取得中止→同長破損拒否→正常再試行を実行。写真/75%設定保持・gate解放、再保存PNGは旧artifactによるPillow確認済みfileと全byte同一。改善した接続確認/写真設定保持の案内をnative UIでも確認。browser終了/download cleanup/model要求0。build helperへ既知のprivate source/build directory文字列がWASM内に残る場合の拒否を追加。

旧hashの24MPブラウザ受入を新hashの最大資源確認と同一視しない。通常版Canvas、公開fork/release/独立bootstrap、計算中止/全aspect/通常配信は未完。証拠: validation/2026-11-02-crop-canonical-browser.json。


### 2026-11-02: 分割HRのnested script読込を既存verified Workerへ接続

crop後、元scopeのHR/ViTMatte未完へ復帰。private実Chromeでroot Workerがchild scriptをfetch→Blob Worker生成→constant message→terminate/revokeする小probeが成功。model/runtime要求0/browser終了。rootから直接子scriptを読む経路の代わりに既存createVerifiedWorkerScript（resource bytes/SHA検証/URLとWorker所有権）を再利用する候補を本体staged HRへ追加。stage policy builderはworkerFile URL/bytes/SHAを保存し、ownerをprepare時に検証、model dispose/prepare失敗でclose。descriptorなしの既存候補は従来経路。新downloader/cache/queueなし。

script lifecycleと破損/失敗時解放を含む11test pass。probeはconstantのみでHR/ViTMatte実graphの成功ではない。private CSP worker-src blob:が必要、公開header未変更。実stage policy/build/本体全推論、通常HTTP/Pages/R2と資源/性能は継続。証拠: validation/2026-11-02-nested-worker-blob-transport.json。


### 2026-11-02: 実stage scriptの検証付きBlob child起動

captured portrait stage-worker.js（667,953byte/SHAcd1974b1…）を既存createVerifiedWorkerScriptでroot Worker内からfetch/SHA確認しBlob childとして起動。実handlerへmodelを準備しないinvalid diagnosticを送り、期待するstage-input-failed応答を取得。owner close後ready=false/closed=true/workers=0、error console0、model/runtime要求0/browser終了確認。小constant probeから実bundle評価/handler起動へ進んだがGPU/graph受入ではない。

次の本体用には既存profile stageを固定したworkerFile descriptorをpolicyへ加え、HR+Matte親Worker752,725byteを新sourceからbuild成功。既存46stage/processor/Matte/foreground契約を保持。新parentと実profile childの本体通し推論、Blob CSPの公開採否/通常配信/性能と全体scopeは未完。証拠: validation/2026-11-02-real-stage-worker-load.json。


### 2026-11-02: HR+Matte本体bundleと通しobserver準備

新parent Workerとprofile stage/trimap/512MiB foreground/export/thumbnailを本体へ組み、170mount/モデル総bytes1,267,265,814/重み読込0でbuild成功。builderはworkerFile descriptorと捕捉済みstage mountのURL/bytes/SHA一致も検査。大応答による既知CDP制限を避け、stage5重みとMatte1重み（390,401,920byte）はnative Fileから検証専用cacheへ順次格納するobserverを準備。本体の全resource SHA gateは維持、64MiB超route応答は拒否。

refineを明示ONにし、HR/Matte各1resultとPNG保存・終了を確認する設計。既存stage-validation資源budget/開始前admissionを維持。syntax確認のみで、今回はbrowser/モデル未実行。通常HTTP配信・本体通し成功・資源headroomと性能/公開auditは未完。証拠: validation/2026-11-02-hr-matte-blob-main-prepared.json。


### 2026-11-02: HR+Matte開始前admission停止と原著liteの静的対応

準備済み本体observerを実行したが、開始前free physical6,859,915,264byteに対し既存stage budgetが要求する8,148,070,400byteを満たさずinsufficient-system-headroom-before-startで停止。modelStarts0/seed前/browser終了確認。GPU不足やモデル失敗とは判定せず、予算を緩めず再試行なし。証拠: validation/2026-11-02-hr-matte-admission.json。

重い実行の代わりに原著ZhengPeng7/BiRefNet_liteの固定revision aa62cd87eafb9cc43056d08ef3615a14628b831dのsafetensors177,634,392byte/SHA4417d89795250e698c3cb0ae8df15743810065f646f48a694fdfa7ca052d0815をdataのみ取得/照合。native ONNX initializer437個中、net. prefix除去後に原著名と対応する328個はshape/dtype/raw byte完全一致、不一致0。残109個はgenerated名で、folded定数/graph対応の確認が残る。原著checkpoint586tensor全部の使用やexporterがこのrevisionを用いた履歴までは証明しない。nice19/core0、観測maxRSS976,020KiB、remote code import/推論/GPUなし。証拠: validation/2026-11-02-lite-upstream-named-weights.json。


### 2026-11-02: 原著liteとONNX initializer全437個の値対応

前回generated名で残った109個を原著固定safetensorsから独立NumPyで再構成。Linear weight転置51、relative position bias tableのindex gather/reshape/transpose12、Conv+BN（eps1e-5）統合46はshape/raw byteすべて一致。direct328と合わせ437/437に完全な値対応が付き、生成定数の未解決数は0。exporterで繰返し呼ばれるattn_1 nodeは同じ原著attnのaliasとして対応させた。

再現用tools/compare_birefnet_lite_checkpoint.pyを追加。入力model/checkpointのSHAをstreamで確認し、self-contained ONNXとdata-only safetensorsを読む。source shape/dtype/byte一致と各変換の誤差をJSONへ出力、既存出力上書き拒否。固定実artifactでCLI成功、追加推論/remote code/GPU/browserなし、nice19/core0/maxRSS約0.93GiB。これは全initializer値の対応であり、full graph/演算順/PyTorch出力一致やexporterが実際に使ったrevision履歴を証明するものではない。証拠: validation/2026-11-02-lite-all-initializer-correspondence.json。


### 2026-11-02: crop/async SHA/nested Worker変更後の回帰確認

通常domain261件と全Vitest203件/23fileを直列・nice19/core0で確認。resource-policy16件とverified-worker-script4件がCIのtest:domain明示listから漏れていたため追加し、更新後domain281件、build script7件、typecheck/通常build11file3,233,228byteが成功。全画面testはmaxWorkers1。新依存/並列推論/実browser起動なし。GitHub hosted CIは未実行、unit/DOMのpassをHR+Matte実機や公開の受入とは扱わない。証拠: validation/2026-11-02-regression-checks.json。


### 2026-11-02: 同じnative lite重みの512px候補

原著対応437initializerを確認済みの同じdynamic FP32 ONNXへ512²入力を1件実行。native ORT1.31.1/CPU1thread/nice19/core0/4GiB AS cap、prepare6.345秒/infer2.821秒/maxRSS859,524KiB。1024pxの過去1件infer12.738秒に対する比4.516だが別時刻の各1回で安定した高速化率とは扱わない。同じPillow復元後alphaは元1086×1448で53,791画素差/平均0.527 code unit/最大160、16段階超差15,808画素。ground truthなしで優劣を判定せず、低解像度の別品質modeとして比較する。

既存BiRefNet adapterのliteだけtrusted inputSize512/1024を明示選択、既定1024/portrait固定1024を保持。未知sizeをruntime前に拒否。4adapter test pass、512用modelVersionを分けたprivate policy/workerをbuild済み未実行。重みURL/SHA/cache namespaceは同一資源のため維持し、新cacheengineは増やさない。browser速度/元size alpha/一般画質・Matteは未受入。証拠: validation/2026-11-02-lite-512-cpu-comparison.json。


### 2026-11-02: 512px liteの本体CPU保存

明示512px/private modelVersionで本体CPU→foreground→透過PNGを許諾合成1086×1448で1件実行。prepared→result6,173.5ms（前後処理含む）、観測最大WS1,672,257,536/private1,530,470,400byte。native512参照との元寸法alpha差は2画素各1/255、不透明RGB差0。PNG2,185,203byte/SHA6ba336108bc02a03d83726c1f178f3716585a83b5a17485939009e2ed0af2087。gate解放/browser終了/download cleanup確認。

既存adapter/manifest/cache/File経路を再利用し、新しい推論engineなし。observerはGPU adapterを要求せずWASM policyだが、このrunはWorker GPU counter注入なしのためGPU-call0の直接測定とは扱わない。1024pxとのalpha品質差、一般画質、通常HTTP/Pages/R2とLite+Matte受入は残る。既定1024維持、private UIは512/1024pxをmodel labelへ明記。証拠: validation/2026-11-02-lite-512-main-browser.json。


### 2026-11-02: 固定model card本文と利用者向けlicense参照

ブラウザを起動せずWindows RAM空きを再確認し6,519,304,192byte、HR stage admissionには不足するため重い再実行なし。既存sources.jsonにSHAだけ記録していたHRとViTMatteの固定model card本文を取得し、既知SHAと全byte一致を確認してmodel-noticesへ保存。フッターのHR/ViTMatte参照も検証済revisionへ固定し、新たに比較したliteの原著とnative ONNX変換版それぞれの固定cardリンクを追加。準備中/モデル未配布の説明は維持。

ライセンス宣言の出典を辿れるようにした変更で、変換binary/runtime/processorの配布audit完了とは扱わない。型検査/通常build確認、GPU/model/browser起動なし。証拠: validation/2026-11-02-model-card-footer-links.json。


### 2026-11-02: 既存axe-coreによる実browser UX検査

公式axe-core4.14.0（MPL2）のnpm tarball SRIを確認し、private評価専用に利用。新a11y検査engine/app依存は追加せず、同一origin scriptとしてprivate CSP下で実Chromeへ読み込んだ。開始desktop/mobile、crop空/写真mobile、印刷写真mobile、診断dialog mobileの6状態。最初にnamed crop divのaria-prohibited-attrとskiplinkのregionを検出し、公開cropperProps role=groupと既存header内へのskiplink配置で修正。上流library patchなし。

再実行6状態の自動違反0、app/crop36test/typecheck/通常build pass。incompleteとしてcolor-contrast、記号buttonのlabel-content-name-mismatch、印刷heading-orderの対象をJSONに保持。これらのmanual判定、screenreader/物理touch/初見利用者/視線/実印刷は未受入。モデル要求0/browser終了、通常HTTPやWCAG完全適合とは扱わない。証拠: validation/2026-11-02-axe-browser-ux.json。公式: https://github.com/dequelabs/axe-core 。


### 2026-11-02: axe incomplete理由の実DOM確認

未確定結果をviolationと混同せず、実Chromeの詳細理由・表示中heading・computed styleを取得。home3枚目の説明はbgOverlapで背景判定不能、minus glyphはnonBmp、6buttonは記号とaccessible nameの対応判定不能。通常有効buttonはrgb(34,34,34)/白の平坦色で計算contrast約15.91:1。disabled色は別扱い。printのheading-order incompleteは今回再現せず、表示outlineはh1→h2。

記号spanを装飾aria-hiddenとして明示し、操作を説明する既存button aria-labelを保持。再検査でもaxeのsymbol incompleteは残ったため、解消済みとはしない。App/crop36test/typecheck/build pass。home背景重なり、実読み上げ/音声操作/物理touch/人の導線は未完。証拠: validation/2026-11-02-axe-incomplete-review.json。


### 2026-11-02: 配布物SHA一覧と照合を既存Node/guardで追加

D09/F08の未完を棚卸し、sourceIdだけでは配布全byte/余分なfileを検証できない不足を確認。標準Node fs/cryptoと既存checkDistを再利用するrelease-inventoryを追加し、実distの一覧作成/照合成功。既存build/script test基盤へ組込み10test/typecheck/build pass。新依存/キャッシュ/配布engineなし。静的Pages artifactだけのローカル受入で、R2/署名/実公開/rollbackを完了にしない。証拠: validation/2026-11-02-static-release-inventory.json。


### 2026-11-02: 計算中止後のcrop重複を実観測し協調終了へ修正

private prefixで実WASM crop exportのenter/returnだけを観測（人工待機/演算変更なし）。旧native terminate呼出し待ちだけでは、中止後のretry enterが先のreturnより前になった。既存single-worker-taskに任意stop hookを加え、cropはcancel-crop→同期処理がunwindしhandle cleanup後のcrop-cancelled→terminate完了まで既存gateを保持。取得AbortSignalと同期計算後/公開前のevent loop yield、待機表示を追加。10秒で確認不能なら終了要求+gate blocked/再読込案内、abort済みでもstop failureを表示。新queue/推論engine/依存なし。

修正後の実24MP JPEG/1795²ではworker ID付きのenter<中止<return<retry enterを確認。中止→return約574.8ms、出力PNGはPillow確認済みfileと全byte同一。gate解放/browser終了/download cleanup/model要求0。これは同期計算/handle順序の受入で、物理RAM全解放や他の推論Workerの中止保証ではない。

テスト追加時にuseCropSave testを誤上書きしたため、既存8ケースを復元しstop failureケースを追加。既存fake Workerも終了ACKを表現するよう修正。最終全画面207/domain283/typecheck/build pass（11file3,235,402byte）。静的distをinventoryと組でprivate static-release-review-02へ保管し、別copyのSHA照合成功。公開/rollback実行なし。証拠: validation/2026-11-02-crop-compute-cancel.json。


### 2026-11-02: モデルWorker受信側の協調cancel準備

cropの同期WASM重複を受け、background model側をsource照合。client.cancelはfail→native terminate、旧handlerはbusy cancelをruntime error/idle cancelをdisposeなしACKとしており、同じ終了順序を保証できなかった。まず既存worker-handlerのcancelをactive jobに束縛し、prepare/infer/disposeのreturnとmodel.disposeを待ってcancelledを返す。遅延result/preparedを抑止し、stale cancel無視、dispose失敗はerror、dispose中のcancelも二重disposeなし。callbackへAbortSignalを渡すが、既存factoryのfetch/stageへの伝播はまだ未接続。

関連Node23test pass。model Worker builderはcooperative-model-cancel-v1 capabilityを記録するよう更新。clientのACK待ち接続/timeout/gateと実model取消は次工程で、受信側部品だけを本体全体の修正完了にしない。新queue/library/engineなし、モデル/GPU/browser起動なし。証拠: validation/2026-11-02-model-cancel-receiver.json。


### 2026-11-02: モデルclientの協調終了接続と準備AbortSignal

既存worker-clientのstop hookと標準Worker message/AbortSignalを使い、cropと共通のACK待ち部品へ接続。modelはcaptured reportのcooperative-model-cancel-v1を明示した場合だけ有効化し、variantは自身のcapabilityを使用。job/worker一致のcancelledとterminate完了までgate保持、120秒の確認不能/解放失敗はgate blocked。cropは従来10秒を維持。新queue/推論engine/依存なし。

prepareのresource policy、stored model、verified child script取得へAbortSignalを伝播し、準備前/途中/読込直後の中止でlate modelを公開せずdispose。同期WASMはsignalで中断できずreturn待ち。domain304/関連UI17/typecheck/build pass。更新Workerとprivate本体27mountのbuild成功、weight read 0。実model計算中止/非重複/再試行、staged inferとforeground/trimap、非cancel fatal経路の解放は未受入。証拠: validation/2026-11-02-model-cancel-client-wiring.json。


### 2026-11-02: 実モデル呼出し中止→再試行の順序確認

既存512px lite/WASM CPU1threadのprivate本体へ、esbuild onLoadで実handle.modelのawait直前/戻りだけを時刻観測する検証版を作成。人工待機/演算置換なし。実Chromeでenter→UI中止→return→中止完了/gate idle→再試行enter→return→PNGを確認。中止からmodel return約6.97秒、前returnからretry enter約19.48秒でmodel callの重複なし。中止したjobのresult公開なし、写真保持、retry PNGは既存512検証済みPNGと全byte一致。browser終了/download cleanup確認。

単一合成fixture/1中止1再試行の証拠であり、WASM個別export/物理メモリ回収/全競合/HR stage/Matte/foreground/trimapは未受入。private File cache/context.routeで通常配信を代用しない。証拠: validation/2026-11-02-model-compute-cancel.json。


### 2026-11-02: HR stage受信側の協調中止

既存stage-worker-handlerは中止commandを持たず、runnerはnative terminateだけを待っていた。標準Worker message/AbortControllerを使ってcancel-stage→stage-cancelledを追加し、active jobへ束縛。準備factoryへsignalを渡し、model return後のtensor/model releaseまでACKを遅らせ、late resultを抑止。解放失敗は固定errorで成功ACKを返さず、通常release中の中止でも二重disposeしない。新queue/library/engineなし。

関連20test pass（deferred model/prepare/releaseと失敗を含むmock）。runner stop hook/親infer signal伝播/更新bundle capability/実stage推論は次工程で、受信側だけを通し受入にしない。モデル/GPU/browser起動なし。証拠: validation/2026-11-02-stage-cancel-receiver.json。


### 2026-11-02: 親HRからstage協調終了へ接続

既存HR inferenceへoptional hooksを追加し、staged handle専用runStagedへsignalを渡す。元の単体model呼出しは維持。runnerは明示cooperative-stage-cancel-v1時だけ既存共通stop helper（120秒）を使い、子return/解放/ACK/terminateまでgateを保持。終了不能でblockedになったrunnerのcloseも失敗させ、親の成功ACKを防ぐ。stage builderはcapabilityを記録し、結合policy builderは旧captured childを拒否して再buildを要求する。新依存/queueなし。

処理系308test pass後、統合中止と親signal確認を追加し最終関連27test pass。deferred childではreturn→dispose→terminateの順、待機中gate busy、次stage未開始を確認。実GPU/HR通しと更新bundle再buildは未完。誤ってweb/testsへ作った追加testは実行前に正しいtestsへ移し、一時fileを削除。証拠: validation/2026-11-02-stage-cancel-wiring.json。


### 2026-11-02: 協調終了版HR child/parent/main再buildと開始前資源確認

標準esbuild/既存builderで46stage child→capability検証付き結合policy→HR+Matte parent→170mount本体を新directoryへ再build。child SHAとpolicy workerFile一致、親runtimeConfigのmodel protocolも一致。standalone stage診断pageにもmatching configのprotocolを渡すよう接続。重みはstatのみでbuild時read 0。

更新本体で既存observerのRAM admissionを実Chrome再確認したが、空き不足でmodelStarts0、browser終了/download cleanup確認。基準を下げず通し推論は未受入。新しいモデル起動はなし。証拠: validation/2026-11-02-staged-cooperative-build-and-admission.json。


### 2026-11-02: foreground/trimap受信側の協調中止

既存single-worker-task利用clientはnative terminateのみで、foreground/trimap受信側に中止commandなし。受信側へjobに束縛したcancel/ACKを追加し、遅延runtime/CV初期化を待つ。foregroundはcloseをawaitし、失敗は固定error/成功ACKなし。同期計算後に標準event loopへyieldして、計算中にqueuedのcancelを結果公開前に受け付ける。OpenCV Matは既存adapterのfinally cleanupを維持、runtime全体はWorker終了の所有範囲。新engine/queue/依存なし。

関連19test pass（新規5case）。client stop hook/capability付き本体接続、更新bundle、実WASM/OpenCV中止は未完。重い実行なし。証拠: validation/2026-11-02-foreground-trimap-cancel-receivers.json。


### 2026-11-02: foreground/trimap clientと本体capability接続

既存共通cooperative stop helperを両clientへopt-in接続（120秒）。matching jobの終了ACK/terminateまで既存gate保持、確認不能はblocked。builder report→runtimeConfig→browserSessionで各protocolを明示し旧captured Workerへ誤適用しない。deferred init/close統合17test、処理系317test/typecheck/build pass。新foreground/trimap Workerと170mount本体をbuildし3protocol設定を確認、weight read 0。初回foreground artifactはSHA拒否、canonical artifactと既存dependency directoryを指定し新worker-02で成功。

実WASM/OpenCV計算中止/再試行は未受入、重い実行なし。証拠: validation/2026-11-02-auxiliary-cancel-wiring.json。


### 2026-11-02: foreground実WASMの計算中止と再試行

既存nodeTaskWorker/foreground fixture/client/gateと固定SHAの4032byte WASMを再利用。fixtureに任意のSharedArrayBuffer時刻観測を追加し、runtime.estimate直前/戻り/closeを記録。観測なしの既存fixture経路は同じruntimeを使用。1000²の決定的合成RGB/alphaで実演算enter後・return前に中止し、約1.274秒後のreturn→close→terminate完了/gate解放を確認。次Worker enterは前closeより後、retry/通常controlのRGBAは全byte一致。3Worker終了/gate idle・blocked false。低優先度/core0、1件ずつ。

Node worker_threadsでありnativeブラウザ/通常配信の受入ではない。細かなWASM ABI entryや物理RAMの回収、一般画質も含意しない。実browserのforeground/trimap確認は残す。証拠: validation/2026-11-02-foreground-real-wasm-cancel.json。


### 2026-11-02: foreground実Chrome Workerの計算中止→再試行

既存client/gateと更新foreground bundleを使うprivate専用pageをesbuildで作成。既存crop計算観測と同じWebAssembly.instantiate exports facadeで実pymatting_ml_rgbのenter/exitのみを記録。1000²合成RGB/alphaでenter後にcancel、exit後に別Worker retry enterの順を確認、計算重複なし。中止→kernel return 885.7ms。retry RGBA SHAは既存Node実WASMと一致、gate idle/blocked false、model request0、browser終了確認。

専用page/検証prefix/route transportの範囲で、本体UIの中止/保存/通常HTTPを代用しない。trimap実計算とHR+Matte全体は残る。証拠: validation/2026-11-02-foreground-browser-compute-cancel.json。


### 2026-11-02: trimap実Chromeの協調中止とOpenCV CSP不適合を発見

2000²合成alpha/既存OpenCV adapterをprivate専用pageで実行。最初は演算enterなし、診断再実行で固定OpenCV.jsの初期化がscript-src self wasm-unsafe-eval下でJavaScript動的評価を拒否されることを確認。handlerは固定trimap-worker-failed、browser終了。これは製品版統合の未解決事項として残す。

切り分け用のprivate page/Workerだけunsafe-evalを許す3回目で、adapter enter→中止→Mat cleanup後exit→別Worker retry enter、重複なし。中止→return約1271.1ms、4MB trimapのretry/control SHA一致、gate idle/blocked false、browser終了。個別erode kernel計測や独立画質比較ではない。製品の_headers変更なし。今後は既存の動的評価不要配布物/公式設定・buildの再利用を調べ、独自morphology kernelを既定にしない。証拠: validation/2026-11-02-trimap-browser-cancel-and-csp.json。


### 2026-11-02: OpenCV既存配布と公式no-eval設定の比較

公式Emscripten settingsでDYNAMIC_EXECUTION=0とEMBIND_AOTを確認。後者は事前生成で前者のEmbind fallbackの性能差を避けるためのbuild設定で、取得済みJSへruntime flagを渡す解決ではない。OpenCV公式は既成配布の利用を案内、TechStark READMEは公式documentation artifact由来を明示。

registryの最新5.0.0-release.1 tarballを上限付きで取得しSHA512 SRI一致。13,298,869byte scriptにnew Functionが2箇所あり、更新だけでCSP対応と扱わない。現行4.11は直接eval/new Function検索に出ずnewFunc(Function,...)が2箇所あったため、単純grepを受入gateにしない。代替OpenCV5 wrapperも参照したがAPI/モジュール量/CSP保証を満たす根拠なしで未採用。既存対応版の探索を継続し、必要なら公式flagsによるmanaged fork/releaseを検討。public CSP/依存lock変更なし、ブラウザ/推論/コンパイラ起動なし。

公式: https://emscripten.org/docs/tools_reference/settings_reference.html / https://docs.opencv.org/4.x/d4/da1/tutorial_js_setup.html / https://github.com/TechStark/opencv-js 。証拠: validation/2026-11-02-opencv-csp-distribution-review.json。


### 2026-11-02: upstream無改変のCSP設定と1並列build手順を具体化

追加候補の公開build設定も確認したがCSP対応済み成果物の根拠は得られず、OpenCV4.11固定commitの公式build_js.pyを確認。--build_flagsでDYNAMIC_EXECUTION=0/EMBIND_AOT=1を渡せ、source patch不要。取得script SHA保存、ASTからget_build_flagsだけを検証しsingle-file/WASM/pthread0と両flagの出力を確認。

公式build phaseはmake -j multiprocessing.cpu_countを直指定するため、--config_only後にcmake --build --target opencv.js --parallel 1を使うrecipeを作成。nice19/core0を維持する。emcc未配置/Docker daemon未起動を確認し、buildは未実施。Emscripten固定配布/互換性、生成artifactのstrict CSPと画素一致確認は残る。CSP対応物が見つかれば既成配布を優先、独自morphology/binary patchは追加しない。証拠: validation/2026-11-02-opencv-official-csp-build-recipe.json。


### 2026-11-02: 固定公式toolchain配置と実compile smoke

公式emsdk3.1.64/tag commitとrelease hashを固定してprivate directoryへinstall/activate、emcc版確認。OpenCV4.11も既知commitを無改変取得。AOTをglobal flagへ渡すconfig01はCMake小link検査でembind.js未登録エラーとなり、所有process treeを停止（session terminal143）。--bind付き最小smokeでもEMBIND_AOT_OUTPUT marker欠落で失敗したため、このtoolchainでAOT併用を採用しない。

DYNAMIC_EXECUTION=0単独の--bind最小compileはexit0。公式の非AOT経路でcore/imgproc/jsに絞ったconfig02を開始、実性能差は未判定。source patchや独自kernelなし、nice19/core0、GPU/model/browserなし。OpenCV成果物の完成/CSP/画素一致/速度は次工程。証拠: validation/2026-11-02-opencv-csp-toolchain-setup.json。


### 2026-11-02: no-eval実行と固定native参照の検証toolを準備

Node標準vmのcodeGeneration strings:false/wasm:trueと既存OpenCV adapterを使う比較toolを追加。明示new Function拒否、network拒否/計数、保存済みpinned native4.11の8入力/期待trimap/kernel SHAを照合する。独自kernel/decoderなし。旧配布の実初期化でEvalErrorになるnegative checkが通り、エラーは巨大bundle本文を出さず固定長JSONで報告。新成果物に対する成功はまだ未検証。

config02/session8604はexit0を確認（約195.5秒）。同directoryでnice19/core0/parallel1のcompileを開始（session73235）。新runtime/browser受入は残る。証拠: validation/2026-11-02-opencv-csp-native-verifier.json。


### 2026-11-02: OpenCV中間WASMの作業path露出を標準compiler設定で修正

1並列build中の配布準備点検で、41object中37にprivate homeを検出。algorithm.cpp.oのWASM data sectionにCV error用source pathが実在したため、全link前に所有build treeを停止（session73235 terminal143）。同directoryへ標準-ffile-prefix-map=private-evaluation-root=/opencv-buildをC/C++双方に追加し、source無改変で再configure成功。新log/session10888でnice19/core0/parallel1 rebuild開始。観測timeoutに基づく再起動ではない。最終JS/WASMのpath不在は未確認。

生成linkLibsはcore/imgproc/zlib。固定sourceからOpenCV/zlib/Emscripten LICENSEをprivate review directoryへhash付き保存。最終binaryのtransitive notice/license/配布auditは未完。証拠: validation/2026-11-02-opencv-build-path-and-notices.json。


### 2026-11-02: 検証済みcompiled OpenCVを既存Worker builderへ取り込む準備

builderに任意private descriptor入力を追加。OpenCV4.11限定・private file境界・script bytes/SHA・単一embedded WASMのmagic/JSとdecoded WASMのprivate path不在・同SHAのno-eval/native8参照pass・notice bytes/SHAを確認する。既存fs/crypto/Buffer/esbuildのみで独自decoderや配信engineなし。compiled候補のpositive受入はbuild後に実行する。

拒否4test pass/domain commandへ登録。従来package経路を再buildしworker/script両byte一致。prefix-map再compile済みalgorithm objectはhome path不在/置換rootあり、全link成果物の検査は残る。session10888の同じ1並列buildを継続。証拠: validation/2026-11-02-opencv-compiled-packaging.json。


### 2026-11-02: no-eval OpenCV初回native8一致と生成metadataの正規化

compile03/session10888はexit0。VM harnessへ標準performance APIを加えた後、新JSはstrings:falseで起動し、固定native4.11の8caseすべてtrimap全byte/kernel SHA一致、network0。まだ正規化前のSHAに対する結果。

全object点検では164件中system.cppだけprivate path残存、getBuildInformationの生成文字列にcompiler/Python絶対pathがあった。公式OPENCV_SKIP_STATUS_FINALIZATION=ONを設定し、生成version_string.incのpath表記だけをbuild用canonical rootへ置換。最初の置換はPython home残存をassertで拒否し未更新、続けたlink01は未修正として扱う。全home対象を補ったheaderで1並列relink02/session44260開始。source改変/binary rewriteなし、最終path不在・同SHAのnative再比較と実Chrome strict CSPは未完。strict browser observerはscript未copy/未起動で準備済み。証拠: validation/2026-11-02-opencv-initial-parity-and-metadata.json。


### 2026-11-02: no-eval最終成果物のnative8/strict Chrome成功と本体build

metadata正規化後のrelink02/session44260はexit0。最終JSとdecoded embedded WASMのprivate home不在を確認し、同script SHAでVM strings:false起動/native4.11参照8件のtrimap全byte/kernel SHA一致を再確認。

同JSをprivate実Chrome pageへcopyし、script-src self wasm-unsafe-eval（unsafe-evalなし）で2000²生成中止→cleanup終了→別Worker retry非重複を確認。retry/control/旧配布4.11出力SHA一致、gate idle/blocked false、model requests0、browser終了。既存Worker builderのcompiled入力も実通過し、3license付きtrimap Workerと本体172mount/約1.27GB資源のbuild成功（weight read0）。

これで専用pageのOpenCV初期化CSP問題は解消したが、HR/Matte本体の通し、通常配信、一般画質、独立rebuild/配布release/全transitive licenseは未完。source無改変/生成metadata正規化、独自morphologyなし。証拠: validation/2026-11-02-opencv-no-eval-final-acceptance.json。


### 2026-11-02: no-eval OpenCVの固定recipe/ライセンスreview一式

成果物、native比較、path audit、canonical生成metadata、固定source/SDK/configのJSON recipeと9license本文をprivate reviewへ保存し14fileのSHA一覧を再照合。OpenCV/zlib/Emscriptenに加えmusl/compiler-rt/libcxx/libcxxabi/libunwind/mimallocを保守的に収集、全componentがlink済みと断定しない。sourceはclean、別directoryでの独立rebuildは未実施として明記。

既存compiled builderで9license付きWorkerをbuildし、先の実CSP確認版とworker/script bytes不変を確認。本体178mount/weight read0のbuild成功、処理系321test pass。private recipe/notice準備を公開releaseやbinary-specific全監査の完了にはしない。証拠: validation/2026-11-02-opencv-release-review-package.json。


### 2026-11-02: 別source worktree/新outputでのrebuild開始

既存公式SDKと固定OpenCV commitのclean worktreeを使うrebuild driverを追加。source/SDK git pinとclean状態、review済み生成metadata SHAを検証し、標準prefix-mapでsource/SDK/outputをcanonical rootへ揃える。nice19/affinity0、公式config_only→cmake parallel1をdriverで維持し、最終JS SHAが異なる場合はbuilt-different-requires-analysisとして保存する。新source/outputで実行開始、session15341はconfiguring/priority19/core0を確認。

同じインストール済みSDK/cacheとcanonical metadataの再利用であり、SDK bootstrapからの独立性/別host再現性を含意しない。完了/byte一致は未確認。証拠: validation/2026-11-02-opencv-separate-rebuild-started.json。


### 2026-11-02: 新directoryのmetadata作成順序を修正しcompileへ進行

別directoryのconfigはcompiler probe成功後、canonical version_string.incがまだなくCMake generateで失敗（session15341 exit1）。driverのmetadata設置をconfigure前へ移動し、matching failed configurationだけを明示resumeする経路を追加。旧failure reportを別file保持、probe cacheを使う再configure成功後、同じ新outputで1並列compileへ進行（session12512）。待機timeoutを理由に新buildを増やしていない。

初回config中の所有5processは全nice19/core0、RSS合計98,516KiB（共有重複/一時観測でpeakではない）。新compileのdriver設定もnice19/core0を確認。完成物/byte一致は未確認。証拠: validation/2026-11-02-opencv-separate-rebuild-recovery.json。


### 2026-11-02: runtime notice配布照合とvariant trimap capability修正

private本体manifestへ9runtime noticeが揃い、descriptor/mount/実file SHA一致を確認。点検中、model variantのtrimap Worker URLだけを置換しprimary側のcancel protocolを残すbuilderの組合せ不具合を発見。URLとprotocolを同時更新し、未知protocolを拒否するよう修正。実lite512 primary＋captured HR variantの184mount buildでURL/protocol一致を確認、未知protocolはoutput作成前に拒否。本体推論の成功とはしない。

別directoryの同じ1並列compile/session12512は継続中。証拠: validation/2026-11-02-variant-trimap-capability-and-notices.json。


### 2026-11-02: 別clean source/別outputのOpenCV JSが全byte一致

再configure後の1並列compile/session12512はexit0。別source worktree/新build directoryのJSを検証済みscriptと直接全byte照合して一致、SHA44d9f893…/4,327,298byte。embedded WASMも3,139,589byte/既知SHA一致、JS/WASM home path不在。全byte同じためnative8/strict browserの同一artifact検査は繰返さない。

同じ固定installed SDK/cacheとreview済みcanonical metadata、同hostを使う範囲。SDK bootstrap/別host再現性、公開release/full binary license、HR/Matte本体は未完。計画冒頭も現在の3段階と証拠表へ整理し、scope/タスク表は維持。証拠: validation/2026-11-02-opencv-separate-rebuild-byte-identity.json。


### 2026-11-02: Chrome公式quota overrideによる本体容量不足→復帰確認

Storage.overrideQuotaForOriginの公式schemaを確認し、fresh検証Chromeだけorigin quotaを1byteへ制限。API報告quota1/overrideActive、CacheStorage使用約181MB。WASM CPU lite512の本体prepareは容量不足案内になり、写真保持/古い出力なし/処理枠解放/blocked false、prepared/result公開なし。worker error eventはruntime-errorだがUIは既存resource error経路で容量不足文言を表示。prototype patchや偽のCache.put errorは使わない。

quotaを既定へresetし、同じ写真で再試行→透過PNG保存成功、以前の検証済み512 PNGと全byte一致。browser終了/download cleanup確認。実disk枯渇や通常HTTPの代用ではなく、native Fileでmodel cacheを先にseedした1ケース。HR+Matteはread-only空き約6.24GBが既存開始基準未達で起動なし。証拠: validation/2026-11-02-main-cache-quota-recovery.json。公式: https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json 。


### 2026-11-02: 本体PDF追加chunk通信断→PNG保持→PDF再試行

既存本体private buildでL判のPNG作成/独立参照全byte一致を先に確認し、PNGではPDF chunk要求0。追加PDF chunkの1要求だけPlaywright route.abort(internetdisconnected)で通信断を注入し、実Worker import失敗を固定案内へ変換。用紙設定/元写真/作成済みPNGの同一URLを保持し、失敗後gate idle/blocked false、PDF旧保存なし。復旧後の新Workerで再試行PDF保存、独立検証済みPDFと全byte一致。model要求0/browser終了/download cleanup確認。

回復後のfull-page screenshotも確認し、元写真/用紙preview/PNG切替と濃色PDF保存導線を確認。人の理解/視線/物理印刷の代用ではない。モデルだけのcacheではruntime assetまで完全offlineと保証できず、現行の完全offline非提供表示を維持。証拠: validation/2026-11-02-main-pdf-network-recovery.json。


### 2026-11-02: 本体PNG非300dpi/不正密度/収容不可の復帰確認

許諾済みcrop PNGの画素を保持し、既存crc-32を使って固定pHYs値だけを72dpi/0へ変更。実Chrome本体では両ケースを期待する文言で拒否、古い保存なし/gate解放。「サイズを整えるへ」→30×40mm/354×472の300dpi crop作成→印刷へ置換→L判PNG保存まで復帰。既存photo置換dialogは実操作として選択、6回。最初のobserverはこのdialog応答を欠いて停止したが、実装は変更せずscriptを修正した。

fast-pngでfixture画素不変と回復後4fileのCRC/寸法/pHYs11811両軸・unit1を確認。元の1086×1448合成人物はL判に入らず作成disabled、A4へ変更で案内解消/作成可能。最後に正しい300dpi写真へ戻すと独立参照とPNG全byte一致。model要求0/browser終了/download cleanup。JPEG metadata/全形状/物理印刷は別途。証拠: validation/2026-11-02-main-print-input-recovery.json。


### 2026-11-02: 実JPEGのJFIF/EXIF密度9caseを本体Chromeで確認

既存17×11の決定的JPEG fixtureの圧縮画像bodyを共通にし、単体テストと同じmetadata構造で9variant作成。実exifr-backed app functionを既存esbuildでbundleして事前検証後、実Chrome本体で全case確認。JFIF300優先（EXIF72）、EXIF300、密度なし300仮定、JFIF単位0からEXIF300へfallback、EXIF cm単位は受理。JFIF72優先（EXIF300）、EXIF軸不一致、JFIFゼロ密度、EXIF不正単位は期待文言で拒否し保存なし。

受理5caseのL判PNGは全byte同一、fast-pngでCRC/1500×1051/300dpi metadataを確認。各gate idle/blocked false、model要求0/browser終了/download cleanup。小さい画像bodyのmetadata判定であり、全JPEG/ICC/向き/大型画像/物理印刷の受入にはしない。実装変更なし。証拠: validation/2026-11-02-main-jpeg-density-cases.json。


### 2026-11-02: 本体直接印刷のnative keyboard/置換Escape確認

標準Playwright keyboardと既存native dialogを使い、Tabでfile inputへ→Enterでchooser（file指定は自動API）→preview shortcut/設定戻りをEnter→native select Home/Endで用紙→作成/保存をEnterまで実Chromeで確認。PNGは独立参照と全byte一致。Tabがhidden/disabled/寸法0のUIへ入らないことを観測した。

1440/390幅で置換dialog初期focusは「今の写真を続ける」、Tab/Shift+Tab中に背景controlへ移らず、Escapeで元file inputへ復帰/同一PNG URL保持。native modal境界ではBODY focusも観測し、browser chromeのfocusや完全trapはDOMだけで断定しない。model要求0/browser終了/download cleanup。実人の理解・視線・読み上げ・物理touch/OS chooser手動操作・他画面keyboardは未受入。証拠: validation/2026-11-02-main-print-keyboard.json。


### 2026-11-02: 本体診断JSONのnative privacy/開閉確認

合成写真を特徴的filenameで本体へ読み込み、support dialogを2回開いて診断JSONを実保存。schemaVersion2の固定8key/9boolean feature、filename/写真Blob URL/data image/端末path/UA文字列なし。pre.textContentと保存byte一致、2回の497byte JSONも一致。再open時は前の準備済みdownloadを表示せず、Escapeでopener復帰/写真URL保持。main realmのWorker生成/requestAdapter/createImageBitmap counterはいずれも前後0、診断中のnetwork追加0、model要求0/browser終了/download cleanup確認。

最初のobserverはinnerTextに改行を追加して比較した誤りで停止し、アプリ変更なしでtextContent比較へ修正。probeはmain realmの範囲で全面privacy監査の代用ではない。HR+Matteはread-only空き約4.80GBで開始条件未達、タイミング相談を一つのasync checkpointへまとめて待機。証拠: validation/2026-11-02-main-diagnostic-privacy.json。


### 2026-11-02: 選択モデルの容量・cache範囲を統一

既存runtimeが全variantを一つのcache操作対象にしていた一方、UIは現在モデルの削除と説明し、容量はprimaryの固定文言だった。モデルIDごとに既存createModelCacheActionsを構成し、背景＋補正の重複URLを除いた容量/確認/削除を一致させた。切替時は古い件数を失効。独自cache engineは追加せず、標準[Cache.delete](https://developer.mozilla.org/en-US/docs/Web/API/Cache/delete)で対象URLだけ削除し、namespace内の無関係な資源を保持する。共有資源・別タブによる再保存の影響をUIに表示する。

UI209/25files、domain321、型検査/production build pass。既存実Chrome記録では容量173→1209MiB、旧件数消去、選択構成だけ削除、他構成/同namespace sentinel保持、gate解放/browser終了、model要求0を確認。cache bodyはmetadata確認用dummyなので重み整合性/推論受入の証拠にはしない。通常HTTP/公開配布/cross-tab保証は未受入。証拠: validation/2026-11-02-selected-model-cache-scope.json。


### 2026-11-02: 単一モデル時の容量と現行静的artifact

追加確認でvariantなしの場合だけcaller由来の容量説明へ戻る抜けを修正。既存getScopeによる配布資源合計を単一/複数構成で共通利用し、storage/Worker未起動とMiB切上げをruntime testで確認。関連UI/runtime16test、型検査/build pass（全UI/domainの再実行ではない）。現行公開用distをstatic-release-review-03へ固定保存し、標準fs/cryptoの既存inventoryで11files/3,235,986byteの再検証一致。artifactId d9f06684fb58530490f6030b33734da84c7d07342e65a922475a8bf0369420a0。公開/実モデル配信/rollback受入は未実施。証拠: validation/2026-11-02-single-model-capacity-and-static-review.json。


### 2026-11-02: 静的artifactへのPages Functions混入を拒否

既存の拡張子/容量検査はPages固有の_worker.jsを通常JSとして許していた。公式advanced modeを確認し、root _worker.js（file/directory）、_routes.json、functionsを既存fs検査で拒否。browser assetsのWorkerは維持。新依存なし、script11testと既存dist検査pass。公開project設定やdist外functionsの確認は別途必要であり、写真非送信/本番配信受入を完了扱いにしない。証拠: validation/2026-11-02-static-server-boundary.json。


### 2026-11-02: 印刷/PDFの既存15testを標準CIへ接続

既存test_print_geometry/test_paper_rgb/test_paper_worker/test_pdf_exportがweb-checkのtest:domain列挙から漏れていた。新しい実装や依存を増やさず既存15件を接続し、保存Python geometry参照、L RGB配置、Worker契約、PDF point寸法と入力拒否を常時検査する。CIと同じNode heap192MiB/直列のlocal domain336件pass、型検査/build/dist検査pass。PDF unitの依存はmockで、実pdf-lib/独立PDF比較/実Chrome保存の既存証拠や物理印刷受入を代替しない。remote CI未実行。証拠: validation/2026-11-02-print-domain-ci-coverage.json。


### 2026-11-02: CPU契約テスト全体のCI漏れを照合

先の印刷15件以外にも、既存top-level Node契約28file/154件がCI標準コマンドから漏れていた。読込/表示/保存/teardown/Worker transport/推論commit/PoC precision・stored-model等を明示列挙へ追加。全74fileで重複0/該当node:test漏れ0。初回9件はmodel-workerへ追加されたESM importをVM harnessが置換しておらずparse段階で失敗し、readWarmModelを明示stub（呼べばthrow）へ更新。stored-model本体は別の既存warm_model_probe testで検査する。productionコードは変更しない。

web-checkのPR/push pathへPoC/prototype/candidate metadata/固定geometry参照を加え、関連ソースだけの変更でも走るようにした。local直列/Node heap192MiBでdomain490、script11、型検査/build pass。remote CI、実モデル/通常配信/実人利用/物理印刷は別受入。新dependencyなし。証拠: validation/2026-11-02-domain-ci-coverage-audit.json。


### 2026-11-02: 背景編集の比較プレビューを接続

[img-comparison-slider](https://github.com/sneas/img-comparison-slider)（MIT、React等対応）と[標準range](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/range)を確認。固定2枚のURL/0〜100という既存仕様には標準range＋CSS clip-pathを採用し、依存/custom pointer/keyboard engineを追加しない。元写真と結果を同じ表示領域へ重ね、透過結果の下は市松、表示境界と元のみ/結果のみbutton、label/説明/value textを付与。初期50、結果URL変更で初期化。Canvas変換・推論・encode・保存URL更新は行わない。

本体の有効結果へ接続し、色変更等で旧結果が失効すると比較も撤去。背景UI16testで表示変更中のrun/save各1回・保存link保持・stale撤去、型検査/build pass。実browserの画像整列/透過/EXIF/極端aspect、native key/touch/読み上げ・理解・memoryは未受入。通常背景は準備中を維持。証拠: validation/2026-11-02-background-comparison-ui.json。


### 2026-11-02: 中止protocolの未知値を開始前に拒否

browserSessionのmodel factoryは未知protocolを通常terminateへ黙ってdowngradeしていた。既存協調中止helperは維持し、session生成前にmodel/variant/foreground/trimapの既知値またはlegacy未指定を検証する。private assemblerもvariant modelの未知値を出力作成前に拒否。依存/独自queueは増やさない。

新wiring3testと型検査pass。primaryとvariantのcapabilityを相互に引き継がない両方向も確認。既存private specから未知値を入れたnegative assemblyは期待error/出力なし。正常primary lite512＋HR/Matte variantは現行UIで184mount build成功、重みread0、model両protocol/trimap URL＋protocol対応を再照合。推論やnative stage/Matte中止、公開配信の証拠にはしない。証拠: validation/2026-11-02-background-protocol-binding.json。


### 2026-11-02: HR全段階の時間明細をringから独立保持

既存本体HR記録browser-main-native-staged-03はelapsed118.897s、prepare56.741s/infer46.814s/export0.009s/release0.296s、区間外15.036s。以前の集計を再確認したもので新benchmarkではない。64event ringにstage明細は後半31/46しか残っておらず、前半15の遅い段階を特定できなかった。既存最大256entryのstageTimes Mapから、数字だけのsorted/frozen stageTimings一覧をprivate readへ追加。新しいprofiler/queue/library、画像/URL/任意Error保持は追加しない。

observer20testで46件保持、上書き時旧snapshot不変、未知/非有限値拒否、256上限、次HRでresetを確認。現行private184mount build/重みread0。標準ORT/torch profilerと同GPU/写真/精度の比較を次の資源checkpoint後に行い、prepareをshader compile等の一原因へ断定しない。infer wall timeをGPU kernel単体時間としない。既存ringの欠損は復元不可、速度改善の実証なし。証拠: validation/2026-11-02-stage-timing-detail-retention.json。


### 2026-11-02: privateモデル資料をartifactへ同梱

既存private artifactにはORT/OpenCV文書はあるが、固定モデルカード/上流license本文はrepo内参照だけだった。既存model-noticesのsource indexと10文書を標準fs/cryptoで検証しprivate出力へcopy、既存mount inventoryへ自動登録。独自license engineや依存は追加しない。現行195mountで全文書/元indexのbyte・SHA・bytes一致、計68,247byte、重みread0、Pages guardによるprivate拒否も確認。candidate status/未使用候補を含むことを維持し、全graph/binary/processor/runtime noticeの監査・公開配布承認は未完。証拠: validation/2026-11-02-private-model-notice-packaging.json。


### 2026-11-02: モデルWorkerのlibrary license本文を同梱

既存.LEGALにはhash-wasm/ORTの短い注記だけで、Transformers.js全文がなかった。既存固定JSを使い続け、公式4.3.2 tagのcommit028721487d55aac3c7f6bad8d87d1b3511a1027cからApache本文、hash-wasm npm4.12.0 gitHead373b796205ab55fb4a657374dad6ea589bf75815からMIT本文とSHA256実装先頭の別許諾全文を取得。package本文は保存済みnpmとbyte一致。source C全体は私有reviewにのみ保存し、repoにはheader全文と出典/SHAを記録。新依存なし。

model worker builderへJS SHA対応と文書bytes/SHA検査・copy・reportを追加。lite512 worker/current private app build成功、3文書すべてmountとSHA/bytes一致、重みread0。最初の旧Worker同一性比較は不一致だったため、その検証を打切り、新source artifactとして記録。旧実行結果を継承しない。Transformers内包依存/toolchain/全binary/processorの監査・公開承認は未完。証拠: validation/2026-11-02-model-worker-library-notices.json。


### 2026-11-02: C06の等倍/拡大を背景比較へ接続

既存比較UIと標準select/CSS overflowを再利用し、100%/200%/fitを追加。編集用react-easy-cropを再利用する必要のない表示操作なので、別pan/zoom libraryや独自pointer/keyboard処理を追加しない。100%は出力px数をCSS幅へ、fitは実aspectと高さ520pxを保ち、borderで表示pxを減らさない。拡大領域はnative scrollとfocusを使う。背景UI16testで比較/zoomがrun/saveや保存linkを変えないこと、focus対象を切替えることを確認、型検査/build pass。native geometry/scroll-key/touch/読み上げ/実人は未受入。証拠: validation/2026-11-02-background-comparison-zoom.json。


### 2026-11-02: 任意色をnative color inputで接続

背景の固定色だけでは元機能の任意色を扱えなかった。公式input color仕様を確認し、既存selectへ「色を指定」、標準limited-sRGB/no-alphaのcolor inputを追加。追加color-picker dependencyや独自canvas色変換は不要。#RRGGBBのみ受理し既存exporterのRGB3値へ渡す。色変更は推論済みcutoutを保持して古いPNG/比較/handoffだけ失効、明示作成でencode。初回testは変化するhex値もinput labelへ含めたため失敗し、値表示をlabel外へ出して固定名へ修正。背景UI17/型検査/build pass。native picker/実PNG色/管理・既定値整合は未受入。証拠: validation/2026-11-02-background-custom-color.json。


### 2026-11-02: 明示透過出力と実kindに基づくhandoff

背景付きと透過の操作を区別するため、既存session.save/getPreparedを使う明示透過作成を追加。別encoder/libraryは不要。保存label/寸法説明へkindを表示し、prepareが取得した実kindを保存。色選択と出力kindが異なる場合も、cropの白背景化を正しく判断する。共有observerは新旧labelへ追従。背景UI18/observer20/型検査/build pass、赤選択→透過→白handoff→赤で推論1回・選択色保持・透過link不変を確認。実PNG/native UXは未受入。証拠: validation/2026-11-02-background-explicit-export-kind.json。


### 2026-11-02: 保存済み4モデル出力の同条件表示

既存HR2048/Lite1024/Lite512/MODNet CPUの各report.fixtureShaと実保存PNG SHAを照合し、同じ許諾済み合成1086×1448・補正OFFと確認。元画像とopaque画素RGBを再照合し4件とも不一致0。alpha差はHRとの差として記録し、HRをground truthとしない。既存Pillow/NumPy/Matplotlibで髪/眼鏡/肩の同ROIを白と暗色背景へ図示しagentが実図を確認。repoのPython環境にMatplotlibがなく最初はimport前停止、既存ray環境へ切替え、依存installなし。

この1枚ではHRの細い毛束、Lite512の髪端、MODNetの柔らかい肩端に差が見える。眼鏡/顔は全出力で見えるが、一般品質順位や正式採用は未判定。補正ON/異なる背景や人物/類似色/難しい透過/人の判断は残す。新推論/browser/GPUなし。私有比較図とmetrics: validation/2026-11-02-saved-background-quality-review.json。


### 2026-11-02: 画像用途のlibrary exportだけを明示

モデルWorkerの...libraryが全exportを保持していたため、使用する公式8API（env/PreTrainedModel/ViTMatte model/RawImage/ImageProcessor/Tensor/interpolate/ViTMatte processor）へ明示import/同一property facadeを限定。新kernel/loader/fork/dependencyは追加せず同じ固定Transformers/ORT/hash/resize/policyを維持。bundle666,104→626,117byte（39,987byte減）。ただしモデルclass参照でtokenizer/jinja系の一部は残る。元sourceのpackage commentからtokenizers0.2.0/jinja0.5.10を識別し、依存監査を残す。

domain491test pass。実bundleをNode VMで初期化しfetch/Worker/GPU/cache各0、message listener1を確認。現行private198mount build/重みread0。native browser/推論/速度/資源は未計測、旧実行受入の継承なし。stage Workerは別途。証拠: validation/2026-11-02-narrow-model-library-imports.json。


### 2026-11-02: stage子Workerのlibrary export限定

同じ既存builderで変更前baselineを作成後、childをenv/PreTrainedModel/ViTMatte model/Tensorの公式4APIへ限定。同じstage-policy.json全byte一致、46stage/モデルresource/runtime設定を保持してbundle670,438→630,394byte（40,044byte減）。stage builderも既存library-sourcesのJS SHA/文書SHA照合と3本文copy/mountを行う。新dependency/loader/kernelは追加しない。

実child bundleのNode VM初期化はfetch/Worker/GPU/cache0・message listener1、関連stage/prepare/handler test pass。compiler/model初期化ではなくmodule bootstrapのみ。新childを親policyへ結合し直す作業、本体/native数値/中止/速度/資源は残る。旧実行受入を継承しない。証拠: validation/2026-11-02-narrow-stage-library-imports.json。


### 2026-11-02: narrow親子をHR+ViTMatte本体へ結合

既存staged-policy joinerで新childを固定し、named-import親715,204byte（hr-and-matte）とno-eval trimap/協調foreground/export/thumbnailの本体をbuild。旧trusted policyとmodels/stages/matteProcessor/profiles/runtimeAssets一致、差はstagedHr.worker/workerFileのみ。46stage/140モデル資源/同modelVersion/195mount/1,267,265,814byte/重みread0。parent実bundleのNode VM bootstrapもfetch/Worker/GPU/cache0・listener1。

全resourceのURL/bytes/SHAとmount対応、新childの実SHA/descriptor一致を照合。child SHAを変えたstaged manifestは既存builderが出力作成前にStage Worker descriptor mismatchで拒否。新loaderや実モデルは起動しない。次は資源checkpoint後のHR→trimap→ViTMatte→foreground→PNG→crop/用紙受入。開始RAM基準は下げない。旧実機数値/中止の受入は継承しない。証拠: validation/2026-11-02-narrow-hr-matte-main-integration.json。


### 2026-11-02: 内包tokenizers/jinjaの固定package license

narrow化後も残るコードの文書を補うため、source bundle commentのtokenizers0.2.0/jinja0.5.10に対応する公式npm archiveを取得しSHA512 SRI照合、LICENSE全文だけを既存notice indexへ追加。package installや依存の採用変更なし。親子の既存builderで各5文書へ増え、本体199mountで全対応SHA/bytes一致。文書追加前後の親子bundleは全byte一致。未知の内包binaryやtoolchain/processor全体監査・採用は完了扱いにしない。証拠: validation/2026-11-02-bundled-transformers-dependency-notices.json。


### 2026-11-02: 現行UI/処理系の統合checkpoint

比較/拡大/任意色/明示透過/補正可否表示/narrow library/時間明細/notice追加後のsourceで、全UI217件26file/domain491/script11/型検査/build pass。低優先度1core、domain heap192MiB。通常dist11files/3,240,533byteをstatic-release-review-04へ保持し既存SHA inventoryで再照合一致（artifact7e0e0b4debdfa5724079ad9ae5013a2905c682295cdeefc65f5ee0759909da24）。古いreview02/03は当時のsnapshotとして保持。

通常背景は未搭載のまま、実browser/新モデル推論/remote CI/公開/live rollback/人の理解/物理印刷の証拠にしない。次の資源checkpointでは新親子のHR+Matte通しと計算中止を検証する。共通observerは現在base-model専用であり、補正ONの明示モードを接続してから本体受入へ進む。証拠: validation/2026-11-02-current-web-checkpoint.json。


### 2026-11-02: 共通observerへ明示補正ONを接続

既存Playwright/資源判定/固定合成入力/download cleanupを再利用し、PLAN36_REFINE=1のみで補正ONを要求。未指定/0はbase専用を維持。不明flag・HR/matte版不一致・trimap欠落・別model/単独stage・stage-validation以外のprofileは開始前拒否。既存RAM/commit/VRAM/時間budget constantsを変更しない。checkboxを明示checkし、成功はresultがHR→matteの順で各1回、gate解放＋PNG保存までとする。別statusでbase結果と混同しない。

observer23test/syntax pass。実observer制御をfake browserで通し、補正check1回/既存budget一致/両result/保存/cleanupを確認。native推論・数値やtransportは未受入で、Windows大モデルpreseed/実資源checkpoint後の1件実行は別途。新依存/実browser起動なし。証拠: validation/2026-11-02-explicit-refinement-observer.json。

単独node --checkは想定外に長時間となり停止を試みたが、その直前に正常exit0で終了し対象PIDは既に不在だった。停止したprocessはなく、syntax passは実完了結果で記録する。テスト23件も別途完了済み。


### 2026-11-02: 補正ON observerの通信範囲を修正

明示refineモード追加後も旧base用allowlistが全matte URLを除外していた。refine時だけprepareMatte.source.resourcesに宣言されたpathを許可し、別variantのmatteは引き続き拒否。既存origin/GET/query制限とroute.continueを維持し、別downloader/proxy/route.fulfillによる重み転送は追加しない。共通observerはHTTP経路であり、以前のnative File/CacheStorage preseedは独立したprivate transportとして扱う。

observer24testでbase/refine/別構成matte拒否と、実observer callbackをfake refine成功経路から呼ぶことを確認。前の23件はmatte実要求callbackを通しておらず不足だった。native通信/CORS/大容量File/preseed/実資源/推論は未受入。証拠: validation/2026-11-02-refinement-network-scope.json。


### 2026-11-02: manifest由来R2試算とruntime再取得

A10の未確定項目を進め、現行公式Standard料金と実資源140/2/2件、WASM28,747,738byteで新規取得/版保持scenarioを算出。既存HR記録にWASM要求46回があり、model cache warmだけで通信0としない。1回WASM仮定とHR+Matte47回仮定を分け、通常CDN cache挙動は未受入と明記。月10万回のGET料金は他利用0/free枠仮定・百万単位切上げで$1.80〜$3.24。新server/cache engine/配信変更なし、計算は標準Pythonのみ。A10全体/採用/請求額の確定にはしない。証拠: validation/2026-11-02-r2-capacity-and-cost-estimate.json。


### 2026-11-02: 既存HTTP cacheでのruntime再利用を検証可能にする

ORT1.31.1公式sourceのwasmBinary（fetchを省く）を確認したが、追加のverified bytes所有/転送/cache層は先に増やさない。既存serve.pyに明示--cache-runtimeを追加し、local-appのhash入りruntimeだけ実SHA確認後immutable、既定/noquery以外/モデル/HTMLは従来no-storeを維持。native cache API/HTTP機構を優先する。

stdlib3testと5byte dummyの実Linux HTTPで固定runtime header/HTMLno-store/queryno-store/POST501/traversal404を確認、server終了。header suiteを既存web-checkへ接続（新依存なし）。最初のworkflow編集はcwd相違で対象fileなしとなり、絶対pathで修正して反映した。native browser cache/Windows通信/CDN/R2設定/速度・資源は未受入。証拠: validation/2026-11-02-runtime-http-cache-experiment.json。


### 2026-11-02: routingがHTTP cacheを無効にする制約を固定

公式Playwright page.route仕様を確認し、現observerが通常HTTP cache測定に不適格と判明。通信予防のroutingは弱めず、reportにeligible=false/reasonを加えてobserver24testで確認。既存46WASM要求はno-store/routing条件の観測で、通常本番cacheの証拠ではない。immutable header検証やモデルCacheStorage warmをHTTP cache性能へ読み替えない。no-routingの独立した実HTTP観測を後続に残す。新proxy/cache engine/ブラウザ起動なし。証拠: validation/2026-11-02-routed-http-cache-limitation.json。


### 2026-11-02: 色変更で透過PNGを破棄しない

既存UIは色変更時に透過PNGも消し、B07の色独立性と不一致だった。既存output.kindで分岐し、透過link/比較を保持、背景付きのみ撤去。既存epoch/onRevisionは下流の保守的失効に継続使用。写真/model/refineの変更は全出力を失効する。新依存/encoder/cacheなし。背景UI18・型検査/build pass、保存所有権の再確認も通過。最初のnpm起動はcwd誤りで開始できず、web cwdで再実行。native/model/GPU未実行。証拠: validation/2026-11-02-transparent-color-independence.json。


### 2026-11-02: 設計本文と現行所有権/中止契約を照合

D12を途中開始し、既存modules-and-ownership/inference-lifecycleの旧本文を現sourceへ整合。即terminate記述は協調ACK→terminate→gate解放/失敗blockedへ修正、HR親制御＋子1と同時ORT演算の区別、HR→Matte接続実装済み/実機未受入、手動Blobと背景registryの所有権を明記。仮directoryを増設せず論理責務と実ファイルを対応付ける。通常entry背景未搭載もsourceで確認。runtime変更なしにつき同じtestを再実行せず、source SHAを証拠に固定。A11/D12/数値・実機・公開・人の確認は未完。証拠: validation/2026-11-02-design-integration-audit.json。


### 2026-11-02: CacheStorage契約と旧OPFS比較案の区別

D12照合で、D05本文にOPFS/Web Locks必須・独自commit/receiptの旧案が残る一方、実装はlibrary hook＋native CacheStorageだった。機能要求を保ったまま現行候補のread/hash/put/ready/明示破損削除/URL scopeを表へ整理し、旧OPFS実装案を明示detailsへ隔離。metadata件数とready、URL keyと物理SHA重複排除、同pagegateと別tablock、modelcacheとHTTPcacheを区別する。独自engineやAPIを追加しない。source SHA/既存証拠を照合、runtime変更なしで再testなし。追加取得量/quota UI・cross-tab/eviction/crash・通常配信/A11/D12は未完。証拠: validation/2026-11-02-cache-design-integration.json。


### 2026-11-02: 保存容量は標準StorageManagerを再利用

[WHATWG Storage Standard](https://storage.spec.whatwg.org/#dom-storagemanager-estimate)のestimate()を確認し、既存native CacheStorage一覧＋固定manifest容量と組み合わせた。追加cache engine/OPFS receipt/容量probe書込み/依存packageは不要。明示操作のみでoriginのusage/quota概算を読み、整数/非負を検査、非対応・失敗は不明。RAM/VRAMや成功保証へ読み替えない。URL metadataの未保存bytesと実内容照合を区別。PNG保持と遅延結果破棄をUIで検証。初回準備panel・実容量表示/eviction/別tabの受入は残す。証拠: validation/2026-11-02-model-storage-estimate.json。


### 2026-11-02: 写真選択前の準備パネルを接続

configured背景編集は「モデルの準備」を写真設定の前へ配置。モデル選択→構成容量→明示の保存確認→写真選択→実行→保存の順でDOMと画面順を揃えた。確認ボタンを常時表示し、破壊的な保存データ削除だけnative detailsへ分離。保存確認のみならsession作成/decode/runは0、選択変更で旧計数を破棄する。事前確認APIのないruntimeは取得/検証が実行時になると明示。写真/結果のページ離脱時消失とPNG保存も説明した。既存React/section/detailsを使用し、依存追加なし。

今回のpanelは情報と任意確認の導線で、取得前の必須確認/端末実可否/独立した取得開始・中止を備えたB06全状態の完成ではない。publicの未配布状態は維持。最初のテストは旧summary文言を期待する4件が失敗、変更した整理用summaryへ修正後、UI/runtime24test・型検査・Pages build成功（11file/3,242,901byte）。native/model/GPU起動なし、視線/実browser/利用者観察は未実施。証拠: validation/2026-11-02-model-preparation-panel.json。


### 2026-11-02: 取得・検証開始の確認を実行へ接続

cache確認APIのあるconfigured runtimeでは背景除去buttonから既存native dialog hookで準備確認を開く。明示操作で保存一覧/容量を再確認し、構成容量・未保存量・保存空き・内容照合とruntime通信の別扱いを表示。「取得・検証して処理を始める」を押すまでrunしない。既知の保存不足なら開始不可、戻って整理/再確認する。不明の場合は0や成功保証を表示せず、明示開始後の既存quota/整合性/通信失敗処理を使う。cache API非搭載の旧runtimeは従来の直接実行と説明を維持、公開背景は依然未配布。

戻る/Escapeは写真・設定・既存PNGを保持して開始意図を破棄。確認中の遅延応答、pagehide/runtime交換/非active化、input/output revision変化から古い自動開始を復元しない。ownerとrevision、選択出力optionsを開始待ちとして捕捉し、確認時に再照合する。cache metadata確認は内容検証/端末可否の証拠ではない。実行用memory gateを緩和せず、端末実可否の事前表示/独立した取得のみ操作/全B06状態は未完。

既存useNativeDialogとReact stateを再利用、依存/modal focus trap/独自download engineなし。初回の検証は閉じたdialogの重複文言と旧0容量fixtureにより2失敗、dialog内容をopen時のみ描画し、PNG作成後に0容量を設定する検証へ修正。UI/runtime28test、型検査/Pages build成功（11file/3,245,014byte）。既存observerは同じ確認buttonを操作し、そのclick成功後にmodelStartsを計数。observer24testはfake browserであり実機受入ではない。native/browser/GPU/model起動・deployなし。証拠: validation/2026-11-02-model-preparation-consent.json。


### 2026-11-02: 取得前のAPI有無確認をCPU/GPU別に接続

既存readBrowserCapabilitiesを明示実行時だけ再利用し、Worker/Blob URL/File/Blob/WebAssemblyの有無を確認。GPU構成だけ安全な接続/WebGPUを要求し、明示CPU構成にWebGPUやcrossOriginIsolatedを追加要求しない。JPEG用APIはdecode側の契約へ残し、PNGも一律拒否しない。欠落時はcache走査・モデル取得/runの前に固定機能名で案内し、写真を保持、手動サイズへの既存導線を使う。未知のprovider/model IDは拒否。既存Worker側の実判定・device/features/limits・数値/確保失敗は別に継続する。

primaryとvariantのtrusted provider metadataをprivate build→localValidation→runtimeへ伝えた。これは実行providerを変更したりGPU失敗をCPUへ自動代替する処理ではない。確認ダイアログではAPI検出だけでメモリ確保/成功を保証しないと説明する。GPU adapter/device/Worker/Canvas/storage取得はこの判定では0。新検出library/engineを追加せず、[公式WebGPU仕様](https://www.w3.org/TR/webgpu/#navigator-gpu)のAPI有無と実adapter可否の区別に合わせた。

関連UI/runtime/Support34test pass。最初の型検査でlocal configのprovider型宣言不足を検出し、primary/variant宣言を接続後に型検査/Pages build pass（11file/3,245,860byte）。最新private MODNet CPU/GPU選択版は40mount/モデル資源25,888,723byte、weightFilesRead0で組立。出力manifestのprimary=wasm/variant=webgpuを独立確認。実browser/model/GPU未起動、deployなし。API有無だけで端末の全対応・空きRAM/VRAMを受入済みにしない。証拠: validation/2026-11-02-model-environment-preflight.json。


### 2026-11-02: 背景処理の経過時間を表示

B06/B07の工程表示に、写真読込/推論/PNG生成/終了待ちを含む現在の操作の経過秒数を追加。取得前のmetadata確認は計測対象外で、確認待ちを推論時間へ混ぜない。工程が変わっても連続したbusy中は起点を保持。setIntervalの呼出回数ではなくperformance.now()差分から秒を出すため、callback遅延でも1秒ずつしか進まない表示にしない。残り時間/純GPU時間/各工程benchmarkではない。読み上げの毎秒通知を避けるため経過時間はaria-live=offとし、既存の工程status/中止は継続する。実読み上げの受入は未実施。

既存React effectと[High Resolution Time API](https://www.w3.org/TR/hr-time/#dom-performance-now)を再利用、新time/date依存・animation loopなし。idle/unmountでtimerを掃除し、pagehideは推論promiseがまだ終了待ちでも直接timerを停止する。jsdomで時刻12.5秒の跳躍、工程変更後17秒、idle停止/再実行0秒、pagehide停止、未完runの巻戻し後save0を検証。関連背景UI30test、型検査/Pages build pass（11file/3,246,342byte）。実browser/model/GPU起動・deployなし。別画面のglobal進捗には工程/中止のみで経過表示は未接続、背景tab凍結/OS sleep/実assistive technologyは未確認。証拠: validation/2026-11-02-background-elapsed-time.json。


### 2026-11-02: 検証モデル資料をフッターから閲覧可能にした

private assemblyで既存のSHA照合済みcandidate資料10件を全文のままplain textへ集約し、各出典URL/文書SHA/scopeを併記。元の個別copy/indexも保持する。trusted configのmodelNoticesHrefをruntime→Root→footerへ伝え、利用者が明示クリックで別tabへ開く。描画だけでは資料fetch/session/decodeを始めない。既存React linkとNode標準fs/Bufferを使い、新package/renderer/license engineなし。

configured footerは検証用構成接続中・未採用分を含む候補資料と説明し、通常公開版の未配布表示と区別する。unconfigured版は従来の「搭載・配布していません」を保持。MIT本体とモデル条件の別扱いも維持。採用modelの全license受入やprocessor/変換物/ML runtime・C/WASM binaryの総auditとはしない。

最初のJSX閉じ括弧不足を修正後、関連UI65test/型検査/Pages build pass（11file/3,246,852byte）。private CPU/GPU切替版41mount、重みread0。集約資料63,156byte/SHA4603b17e6cd2f1f8367b3dabee641370270ba339cfdfda94e045e8d9eca87a69を独立照合し、10全文/出典/SHA包含、元個別copy byte一致、mount bytes/SHA一致を確認。実browserでのlink/MIME/CSPは未受入、モデル/GPU実行・deployなし。証拠: validation/2026-11-02-model-notices-ui-integration.json。


### 2026-11-02: Worker/runtime権利資料をprivateフッターの既存リンクへ統合

private組立で、実mount済みruntime/validation-workers/validation-assets配下の既存LICENSE/NOTICE/LEGAL/ThirdPartyNotices textだけを選び、読込時にbytes/SHAを再照合してapp/THIRD_PARTY_NOTICES.txtへ追記する。公開manual版の資料を先頭にそのまま保持し、公開sourceのnotice自体は変更しない。同内容SHAは全文1回＋全route aliasへまとめる。既存Node fs/Buffer/cryptoと既存footer anchorを再利用、新dependency/cache/rendererなし。model資料は別リンクのまま。捕捉できた文書の集約であり、資料がないbinaryや変換物の条件を推定して「全権利確認済み」としない。

最新HR+Matte private assemblyは200mount/モデル資源1,267,265,814byte/重みread0で成功。26notice asset・distinct19文書を既存endpointへ収録し、独立Python照合で全原文bytes/出典route/SHA包含・手動資料prefix保持・配信mount bytes/SHA一致を確認。Transformers.js/hash-wasm本体とSHA C header/tokenizers/jinja、ORT LICENSE/ThirdPartyNotices、OpenCV/Emscripten/C++runtime等の既存資料を含む。集約486,113byte/SHA38cc979605b115f0b8c6864b462aea6020251979ffc430bf2895e10bc00783e8。Vite compile/組立/実出力照合の証拠であり、今回UI suiteや実browserを再実行したとはしない。native/model/GPU起動・deployなし。全binary/toolchain/model/processor/変換物のaudit・配布受入は未完。証拠: validation/2026-11-02-runtime-notices-footer-integration.json。


### 2026-11-02: 検証版の診断状態を修正（schema 3）

モデル接続済みのprivate RootでもSupportが「モデル未搭載」/modelDistribution=not-shippedを固定表示していた。Rootから接続有無のbooleanだけを渡し、公開未配布はnot-shipped、非公開比較構成はprivate-validation-configuredへ分岐。schemaVersion=3として意味の変更を明示する。全fieldは従来同様に固定schemaから再構成し、runtime/session/model名/URLを直列化しない。非booleanはtoJSON等を呼ぶ前に拒否。接続状態は取得完了・端末対応の証明でないと画面に説明する。

Supportを開いたまま構成が交換されたら、古い診断preview/linkをdiscard/reconcileし、次の明示作成まで新しい診断を出さない。API確認も従来の受動的な有無確認のまま。既存React props/effectと既存download所有権を再利用、新依存/収集API/自動送信なし。関連Support/背景UI37testでsentinelのmodel名/URL/UA非混入、受動性、構成交換時の失効を確認。型検査/Pages build pass（11file/3,247,288byte）。実sourceのcreateDiagnosticをNodeで読み、全9API=false fixtureのpublic505byte/private523byte、固定7field/schema3を別に確認。以前の実Chrome schema2保存受入をschema3の実機受入へ引き継がない。実browser/model/GPU起動・deployなし。実runtime/model版と安全error codeの診断収録は依然未完。証拠: validation/2026-11-02-configured-diagnostic-state.json。


### 2026-11-02: HR46工程のデータ移動を静的に算定

現行narrow policyの46固定shapeとstagePortsから、parent→子Worker input合計8,216,563,712byte、子→parent output合計6,357,438,464byte（計13.5731GiB）、再利用featureを保持する明示ArrayBuffer.slice合計1,850,736,640byte（1.7236GiB）を算出した。parent Mapの工程完了時の最大保持量は951,058,432byte（907MiB）。最大inputは0-based stage43の925,892,608byte。別のPython consumer回数集計とデータ量保存式でinput/copy合計を独立照合した。

これはshapeによる所有権移動量であり、物理memcpy/実RAM/VRAM/転送速度の実測ではない。stage Worker内のORTテンソル化・GPU upload/readback・モデル/初期化の量は含まない。source上はcreateSingleWorkerTaskが1requestごとに新Workerを生成し、stage handlerがsession/tensorsを解放してから結果を返し、parentがterminate完了後に次へ進む。46回の初期化とCPU側中間feature往復が存在し、単純なブラウザ対PyTorchのGPU速度比較ではない。以前のprepare56.7s/infer46.8sもpure GPU時間ではなく、欠落した前半の段階明細を再構成したとはしない。

[ORT公式GPU IO binding](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html#keep-tensor-data-on-gpu-io-binding)のpreferredOutputLocation/fromGpuBuffer/明示寿命管理を再利用候補として確認。取得済み1.31.1 sourceのwasm-core-impl.tsは出力既定cpuと、nativeのwebgpuRegisterBuffer/JSEP別経路を保持する。ただし現在の1stage/1Worker/1device解放契約から、そのoptionだけで段階間GPU保持には移れない。既存のメモリ上限・協調中止を維持した同device/Worker寿命、native FP16 IO/数値/解放/device lostの受入が必要。独自GPU kernelや永続Workerへ直ちに変更せず、次の計測は通常HTTP cache条件とstage wall/worker内時間、CPU/GPU往復を区別する。軽量model比較も同条件で続ける。推論/モデル重量read/browser起動0、低優先度1core。証拠: validation/2026-11-02-hr-static-transfer-accounting.json。


### 2026-11-02: stage親側の準備/往復時間を追加

既存stageTimingへ任意のpaired numeric field roundTripMs/feedPreparationMsを追加。feedPreparationMsはparentのfeature lookup/保持slice/入力構成、roundTripMsはtask.run前後（Worker生成・起動・入力移動・子の全処理・出力移動・親のfinite検証・終了待ち）を同じparent clockで測る。子prepare/infer/export/releaseとの包含関係があるため、単純合算して総時間にしない。差分も純転送や純GPU時間ではない。画像/feature本体は診断へ追加しない。

既存数値validatorで両fieldを0..600000msのfiniteに限定、片方だけは拒否、未知fieldは破棄。親で計測不能/範囲外の場合は追加値だけを省き、既存の正しい出力を計測理由で拒否しない。private traceは従来の最大256段階Mapへ同じsanitize済み値を保持し、parentTimedStagesで実測された行数を明記。旧4fieldのみの観測へ架空の往復0秒を付けない。run切替時に初期化し、snapshotのfreeze/コピー契約を継続する。

既存performance.now/React外のmetadata経路を再利用、新依存/kernel/Worker再利用/実行予算変更なし。3段階のfake Worker数値出力・transfer所有権・解放順の検証を維持し、clock固定でWorker終了待ち500msが親往復のみへ入り子4時間は0のケース、paired不正値・private sentinel・partial coverage/resetを追加。関連57test、全domain499test、型検査/Pages build pass（11file/3,247,288byte）。新親bundle715,613byte/SHA27179dd927b50084de0f6a6a82535c841e378d53063c9366489ea333ce87b4a0をprivate200mountへ接続し、同policy・子630,394byteは既存と同一、親mount bytes/SHA/両property名を独立確認。重みread0、browser/model/GPU起動・deployなし。新bundleの実機数値/時間/中止受入、通常HTTP cacheとの分離、同GPU PyTorch比較は未完。証拠: validation/2026-11-02-hr-parent-timing-integration.json。


### 2026-11-02: 極端な縦長cropのPillow順序差を修正

Pillow12.3.0の既存wheelをPYTHONPATHで使用し、新規package取得なしで8つのRGB合成fixtureを作った（source軸16384/output軸4096、1pixelの細長画像、縦横の小数box、混合拡縮）。旧crop WASMでは7/8一致、3×16384→7×4096の小数boxだけ29,675channel/最大5階調の差が出た。初回比較はこの不一致で停止し、後続PNG確認もreport未作成で停止。保存済み診断から全8件を調べ直して差を特定した。

原因はPIL.Image.resizeがheight>width*100かつ出力高さが小さい場合だけ縦方向→横方向に分けること。自作filterへ置き換えず、既存hostのcrop入口に同条件と2回のImagingResample呼出を接続した。upstream Resample.cは未変更、既存Lanczos/Bilinearモデル入口は従来の直接順序を維持する。小数boxと中間画像を正しく渡し、失敗時も中間ownerを解放する。

修正後8/8のraw RGBと、既存PNG exporterで実保存した8PNGを独立Pillow decodeで全byte照合、寸法/RGB/299.9994dpi（300dpi pHYs丸め）一致、元RGB不変。既存164caseもcrop/従来resizeの双方で一致し、checked-in新fixtureは旧artifactで実際に失敗するnegative controlを確認した。新fixtureとcheckPillowCropAspectCasesを既存検証helperへ追加。最大観測WASM memory1,703,936byte、allocator予算32MiB、これは総RAMではない。

同じ検証済みcompiler/管理runtime forkから新WASM14,563byte/SHA4ac73b5af0432d878e2b946109d65a15a87c5185c5f4440415f091de814e773cを組み立て、private HR+Matte/crop本体201mountへ接続しmount bytes/SHA確認。重みread0、低優先度1core、browser/model/GPU起動・deployなし。新assetの実browser/Worker/中止、最大24MP/4096²・JPEG/ICC/EXIF/alpha等の一般受入、managed release/全licenseは未完。旧assetの実機証拠は新asset受入へ自動継承しない。公開cropは従来Canvasのまま。証拠: validation/2026-11-02-crop-aspect-parity.json。


### 2026-11-02: 新crop WASMを実Node Workerの本体書出entryで確認

既存browser-export-thread/nodeTaskWorker/createSingleWorkerTask/協調中止を再利用し、実crop.worker.tsをpinned Vite codec alias付きesbuild IIFEへbundle、制限VM上の実Node threadで実行した。fixtureは指定された1資源のin-memory Responseだけを返し、それ以外のfetchを拒否。固定userAgentと標準Abort/ReadableStream/WebCryptoはこのasset fixture時だけ提供する。Node globals/dynamic string codeは禁止のまま、GPUなし・Canvasなしで実PNG decode→SHA照合→実WASM→実PNG exporterを通す。アプリ/runtimeの実装をmockへ差し替えていないが、transportとbrowser realmはfixtureであり実Chrome/CSPの証拠ではない。

初回bundleはpinned codec alias不足で停止し、既存Vite configをloadして修正。次にVMのuserAgent/stream API不足を修正。16384軸のRGB fixtureをPNGへencodeすると、既存PNG上限4096軸/4MPでモデル/WASM取得前に拒否されることが判明した。上限を変更せず、4件のoversize拒否を取得/compile0で確認。追加の3×4096→7×1024小数box等4fixtureを独立Pillow12.3.0から採り、許容PNG8caseを検証した。元16384軸はraw WASMの根拠に留め、JPEG/nativeの受入へ広げない。

8成功＋破損WASM拒否＋同画像で復帰＋dispatch直後の中止ACK＋再実行を逐次実行し、16Worker全てterminate完了を確認。破損は当該Workerのasset取得1/compile0、入力拒否は各Workerの取得0/compile0を確認。保存した10PNG（復帰2件を含む）を別Python/PillowでRGB全byte/SHA/寸法/300dpi照合。最大観測linear memory1,703,936byte、64MiB Node old-generation指定は総RAM上限ではない。中止はdispatch直後で、同期WASM計算内での割込を証明しない。全domain499testもpass。低優先度1core、native browser/model/GPU起動・実network・deployなし。実Vite ES Worker/実Chrome/CSP/UI/24MP/JPEG/4096²の受入は残る。証拠: validation/2026-11-02-crop-worker-aspect-and-recovery.json。


### 2026-11-02: 縦長crop修正版のsource/rebuild資料を更新

旧14,282byte artifactのreview packageを上書きせず、crop-release-review-02を新設。旧inventoryでSHA照合したPillow/xcc/MIT全文・upstream source archive・runtime patch・Pillow source12fileを保持し、現行host/build script/shim/数値adapter/helper/reference fixture10fileをsnapshot化した。snapshot側のbuild scriptから別source directory/別output名で再buildし、現在private本体の14,563byte/SHA4ac73b5af0432d878e2b946109d65a15a87c5185c5f4440415f091de814e773cと全byte一致を確認。バイナリへprivate home pathなし、host SHAもsnapshotとbuild receiptで一致。

追加npm/pip依存なしのverify-crop.mjsをpackage内に置き、元repo外/tmpから実行。snapshot内だけのadapter/referenceを使う4+160+8＝172caseで全RGB一致、最大観測WASM memory2,031,616byte。26file/2,961,900byteの相対名/実bytes/SHA inventoryを作り、全file再読込で照合。コピーしたapp MITは現repo LICENSEと一致、runtime patchは旧記録およびbuild receiptのdiff SHAと一致。既存Node/fs/cryptoと既存build/resize検証helperを再利用し、新compiler/画像kernel/配布サービスは追加しない。

これは既存検証済みcompiler binary/同じmanaged runtime forkでのlocal review。fresh compiler bootstrap、別host再現、managed remote fork/tag/published release、公開配信用のpath非露出recipeは未完。build receiptはprivate監査用の絶対pathを含む。新binaryの実Chrome/Worker/CSP/UI・最大shape/中止と全binary/toolchain権利確認も継続。低優先度1core、native browser/model/GPU起動・publish/deployなし。証拠: validation/2026-11-02-crop-tall-order-release-review.json。


### 2026-11-02: 背景写真の入力失敗を原因別に案内

背景入力は全失敗を「写真を読み込めません」としていたため、既存preflight/Workerの固定codeを使ってAPI不足・20MiB超過・JPEG/PNG寸法・PNG画素形式・共有gate競合・Worker開始/終了失敗を区別した。差替え失敗時の元写真/作成済みPNG/URL/revision保持は継続し、保持するPNGがない場合は写真だけを保持すると表示。任意Error.message/写真名は表示しない。

mainでWorker未検出ならheader read/resize/gate取得の前にunsupported-browser。Worker内ではJPEGだけOffscreenCanvas/createImageBitmapの有無をdecode/Canvas生成前に確認し、PNGのcanvas不要経路を妨げない。PNG pixel-format/上限は既存decoder/preflightから固定allowlistへ変換し、未知failureは汎用固定codeへ。独自decoder/検出libraryは追加せず、既存crop Workerと同じAPI判定、既存imageDimensions/PNG decoder/単発Worker clientを再利用した。

関連3file/47testでWorker不在のfile.slice0、JPEG両API不足のdecode/Canvas0、Worker終了待ち→gate解放→エラー返却、5原因の差替え失敗で写真/PNG/revision不変・再run/save0を確認。追加の実Adam7 low-bit PNGテストは初回fixture URL解決で失敗し、先走った成功記録を取り消した。既存fixtureと同じ動的URLパターンへ修正後、3file全48test/型検査を再実行してpass、固定unsupported-png-format/RGB返却なしを確認した。Pages build11file/3,248,876byte、private201mount/重みread0、再buildしたinput Worker39,877byteの実mount SHA/新code確認。実browser/JPEG decode/API不足/CSP/作成失敗のnative受入は未実施で、旧input Workerの実機証拠を新binaryへ自動継承しない。低優先度1core、model/GPU/browser起動・deployなし。証拠: validation/2026-11-02-background-input-recovery.json。


### 2026-11-02: モデル構成とindexの導線を一致させた

private runtimeを接続してもLandingは背景編集未提供/モデル取得なしと固定表示していた。Rootの同じ接続有無をLandingへ渡し、検証版は背景編集→モデル準備へ進む明示linkと、取得/保存状況→写真→除去→確認/PNG保存→必要ならcrop/印刷の説明へ切替。hero/capability/処理場所/環境/制約を同じ状態へ揃えた。長辺2000px超の縮小と対応モデルだけ補正を選べることも示す。default publicは準備中・手動size/printを維持し、モデル採用/配布開始としない。合成サンプルは従来どおり操作イメージで、実背景品質を示したと偽らない。

既存React props/anchor/Root routeを再利用、新依存/遷移engine/自動計測なし。関連2file/71testと型検査/Pages build pass（11file/3,250,410byte）。configured index→model準備regionへ移り、cache query/session/decode/Worker/fetch0、未提供とする矛盾copyなしを確認。既存public index/手動journeyもpass。private201mount/モデル資源1,267,265,814byte/重みread0で組立、実browser/model/GPU起動・deployなし。視線/実layout/読み上げ/タッチ/初見観察は未受入。static review05は以前の凍結checkpointとして保持し、変更後distと同一とは表示しない。証拠: validation/2026-11-02-configured-index-journey.json。


### 2026-11-02: 今回の処理に必要な取得量だけで開始前判定

準備dialogは従来、補正OFFでも背景+Matte全構成を未保存量へ含めていた。serial-inferenceの既存分岐へ合わせ、refine=falseは背景だけ、refine=trueかつ当該写真/modelVersionのmask再利用可ならMatteだけ、それ以外の補正は両方を数える。inspectCacheの任意selectionを既存CacheStorage actionsへ通し、指定なしの手動確認とclearは全構成scopeを保持する。共有URLの重複/矛盾拒否とnative gateは従来どおり。未対応補正scopeは拒否。

準備用estimateを手動の全cache表示と別stateへ保持し、「今回の処理」とcaptionを付けた。全体capacityには「輪郭補正用を含む」と明記し、全構成不足の注意と実行前の選択機能の必要量を区別する。これにより不要なMatte分でbase-onlyを拒否せず、保存中のmask再利用時にも背景モデル分で過大判定しない。maskはsession内の一致情報で、永続保存済みの証明ではない。owner/revision/離脱時の意図破棄、明示開始、内容SHA照合、実行予算、実推論処理は変更しない。

既存native CacheStorage/getScopeを再利用し新cache engine/依存なし。関連2file/45test、型検査/Pages build pass（11file/3,251,014byte）。32MiB背景/96MiB補正fixtureでquota64ならbase可・fresh refine不可、quota100ならmask再利用の補正96可、手動全128表示/両URL削除を維持。最初の追加testは既存の補正専用button名と異なるlocatorで失敗、修正後pass。private201mount/重みread0へ接続。実descriptorのmetadataでは全140file/1,267,265,814byte、背景137file/869,929,904byte、Matte3file/397,335,910byteと確認した（URL scopeの見積り、物理storage/RAM/VRAMではない）。実browser/model/GPU起動・deployなし。native quota/再利用/内容照合/実HR+Matte受入等の元scopeは継続。証拠: validation/2026-11-02-operation-resource-scope.json。


### 2026-11-02: 軽量既存配布物を再調査、追加変換より先に静的Lite候補を評価する

Hub APIのblob metadataを固定revisionで確認した。CoderViking/birefnet-lite-onnx@dc06453148f01ef4131f17e9b791345e32e8ee78は既存static1024²/FP32/opset17 ONNX199,681,624byte（LFS宣言SHA50a57872...）とexport script8,728byteを提供。scriptをdataとして取得/SHA505d0236...確認・AST parseし、参照元ZhengPeng7/BiRefNet_lite@7838f1c3472f827cd8ce13ab5ccc2ce48077360fを抽出した。この旧revisionのsafetensors API宣言SHA4417d897...は、既に全437initializer対応を検証した手元checkpointの実SHAと一致する。ただし新ONNX本体は取得しておらず、変換後重み/graph等価性の証明ではない。

[配布元model card](https://huggingface.co/CoderViking/birefnet-lite-onnx)はper-tap GridSample/1×1Convの蓄積でwide GatherND/ScatterND中間を避け、ORT Web1.26-devでwasm/WebGPU完走と報告している。これは配布者/M-series環境の記述で、当方のORT1.31.1 native/NVIDIA・strict GPU配置/性能/メモリの測定ではない。独自converter/分割をさらに増やす前の比較候補とし、既存Transformer.js/ORT/前後処理を再利用できるIO/source/数値確認を先に行う。現Lite512/1024 CPU、MODNet、HR基準は保持し、LiteをHR互換としない。

onnx-community/BiRefNet_lite-ONNX@de15b22ba131738a16dff04aab8bdf8dc32e3ac1はFP32224,005,088byte/FP16114,538,221byte。配布者による旧runtime/MacでのOOM報告だけで現NVIDIA候補を不可と断定せず、file縮小だけでRAM/速度改善とも判定しない。公式Lite-matting@99c33412e3f58e1f33187abdc8c435c645243690はF16 source88,965,896byte、dynamic-matting@074df545be87034e74a96bf71566ecbbc4c15f0aはsource444,473,596byte。両Hub revisionにONNXなし。公式v1 release全28assetも列挙し、該当mattingはPTHで、lite-2K ONNX331,082,421byteは確認した。これは確認した場所の範囲で、全配布場所にONNXがないとは主張しない。HubのTransformers.js tag/自動snippetだけを実ONNX利用可の証拠にしない。

5repoのMIT宣言はmetadataとして記録したが、全model/変換物の配布承認ではない。低優先度1core、重み本体取得0・remote Python実行0・依存install/モデル推論/browser/GPU起動/public model変更/deployなし。新候補のbody SHA、graph/initializer、数値/保存PNG、性能/RAM/VRAM、中止/喪失、一般品質/権利は未検証。証拠: validation/2026-11-02-light-model-metadata-watch.json。


### 2026-11-02: 既存static Liteの本体SHAとONNX構造を検証

固定revision dc06453148f01ef4131f17e9b791345e32e8ee78の既存ONNXを最大2MiB/sで取得し、199,681,624byte / SHA256 50a57872cc739192446da2a934159f957c81af8b5a161dfda8e3daa51660ca67を実bodyで確認。既存ONNX1.23.2のchecker（full_check=False）pass。FP32 input_image [1,3,1024,1024] → output_image [1,1,1024,1024]、最終ConvでSigmoidなし。IR8/opset17、6,129node、969initializer、external initializer/custom functionなし。GridSample300/Conv382、GatherND/ScatterND/DeformConv/Clipなし、Concat最大5入力。ただしoperator名だけでORT1.31.1 WebGPU kernel/全GPU配置/高速化を証明しない。低優先度1core・仮想address上限2GiB、検査process peak RSS967,472KiBは推論RAM/VRAMではない。推論/remote code/browser/GPU実行0。新重み対応・数値等価・画質・性能・中止・全権利確認が次gateで、公開manifest未変更。証拠: docs/browser/validation/2026-11-02-static-lite-body-inspection.json。

深度補助は標準採用せず比較候補に保持する。[DA3-Small公式card](https://huggingface.co/depth-anything/DA3-SMALL)はrelative depthとApache2.0、PyTorch APIを提示するが、cardのparameter表記0.08BとHub集計34.3Mが一致しないためサイズを確定値として採用しない。追加modelのdownload/推論/資源とbrowser kernel対応は未測定。深度の単純閾値は奥側の人体も削り得るため、同色背景完全排除を保証しない。[ComfyUI-AutoMask](https://github.com/easygoing0114/ComfyUI-AutoMask)のMask Refineは既存pymatting closed-form matting、Auto Mask Thresholdはmask histogramの谷検出であり、背景の意味判定ではない。Python nodeを静的Pages実行依存にしない。軽量BiRefNet単体→既存輪郭補正比較→残る失敗例に低解像度深度補助、の順で追加費用と品質を評価する。既存ViTMatte/HR受入を置換・完了扱いしない。


### 2026-11-02: static Liteと元checkpointの初期照合

前turnはONNX body/SHA/構造検査のprogress。本turnは既存safetensorsの実SHA4417d89795250e698c3cb0ae8df15743810065f646f48a694fdfa7ca052d0815を再確認し、safe_open(numpy)とONNX numpy_helperでshape/dtype/生byte SHAを照合。969initializerのうち268がsource tensorと完全一致、同名一致0、701未分類（FLOAT445/INT64 256）。新exportは名前変更/定数fold/転置等を含むため、この未一致を重み不一致と断定しない。元重み対応の全証明は未完であり、次はMatMul転置・Conv/BN fold・分割weightと定数の分類を行う。既存ONNX/safetensors再利用、新依存なし、remote exporter未実行、推論/browser/GPU0。低優先度1core・address上限2GiB、検査peak RSS449,772KiBは推論資源ではない。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-source-correspondence.json。公開構成未変更、HR+Matte/全品質/性能/UX/配信/権利受入は継続。


### 2026-11-02: static Liteの転置weightを追加照合

前turnはsource tensorの生byte一致268件を確認したprogress。本turnは既存ONNX/numpy/safetensorsでsourceの2D転置をshape/dtype/SHA照合し、追加51initializerの完全一致を確認（identity268 + transpose51 =319）。残650件はINT64 256/FLOAT394で、定数・BN fold・deform convolutionのper-tap分割等の分類は未完。未一致を誤重みと断定せず、数値/graph等価性の証明とも扱わない。低優先度1core/address上限2GiB、peak RSS444,020KiB。推論/browser/GPU/remote exporter実行0、新依存なし。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-transpose-correspondence.json。次はper-tap Conv weightとfold対応を確認し、元のHR+Matte・全品質/性能/UX/配信/権利受入は継続。


### 2026-11-02: static Liteのper-tap Conv weightを照合

前turnは転置weight51件のprogress。本turnはsourceの3x3/7x7 kernelを1x1 tapに切り出し、shape/dtype/生byte SHA照合で290initializerを追加完全一致確認（identity268 + transpose51 + tap290 =609）。初回3x3のみ45件、7x7も含めた再検査290件で、重複加算しない。残360件はINT64 256/FLOAT104。これはsource tensorの対応であり、GridSample座標/offset/modulation/積算順やgraph接続の正しさを保証しない。BN fold、relative-position bias等の定数分類と数値受入は未完。低優先度1core/address上限2GiB、peak RSS444,612KiB、新依存なし。推論/browser/GPU/remote exporter実行0。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-tap-correspondence.json。公開manifest未変更、元のHR+Matte/全品質/性能/UX/配信/権利受入は継続。


### 2026-11-02: static LiteのBN統合・相対位置biasを照合

前turnはtap290件のprogress。本turnは既存compare-generated.pyのprefix整理/NumPy fold式（epsilon1e-5）を再利用し、通常Conv+BN46件、deform1x1 Conv+BN20件、relative-position table/indexからgather/reshape/transposeしたbias12件、計78件を追加して全て生byte完全一致。初回通常fold46件は最終78件に含み重複加算しない。累計687/969対応、残282はINT64 256/FLOAT26。照合対象のBN式とsource候補は明示し、graph接続/座標/積算順や数値等価性の証明とは区別する。低優先度1core/address上限2GiB、peak RSS790,028KiB、推論/browser/GPU/remote code実行0、新依存なし。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-fold-correspondence.json。残る定数/shifted-window attention maskの分類、graph確認、実数値/資源/速度/画質/中止が未完。公開manifest未変更、元のHR+Matte/全UX/配信/権利受入scopeは継続。


### 2026-11-02: static Liteの空間定数を独立再構成

前turnはBN fold/相対bias78件のprogress。本turnは残282件を全consumer付きでinventory化し、Swin window7/shift3のregion mask5個、align_corners=Falseのpixel-center grid（32/64/128/256、各yx）8個をNumPyで独立再構成、13個すべて生byte完全一致。source由来687と空間定数13を区別し、残りはscalar FLOAT13/INT64 256。これら269個は値とconsumerを記録したが意味/graph wiringの全検証は未完。attention maskは[-100,0]、scalarにはGELU/attention scale/座標scale/offsetがあるが、名称・値だけで全体等価性を断定しない。低優先度1core/address上限2GiB、空間定数検査peak RSS442,376KiB。推論/browser/GPU/remote code実行0、新依存なし。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-derived-constants.json。学習weightの変換対応は進んだが、モデル数値比較/画質/速度/資源/中止と元HR+Matte/UX/配信/権利受入を継続する。


### 2026-11-02: static Liteと固定ORTのkernel入口を照合

前turnは空間定数13件のprogress。本turnは既存配布ORT Web1.31.1 packageのJSEP WebGPU registry/sourceを実読し、candidate全演算種別と照合。GridSample300個は全てbilinear/zeros/align_corners=0でsourceが扱う属性。Erf/LayerNormalization/Conv等もregistry入口あり。Reshape248/Shape11/Unsqueeze601は当該JSEP registry外だが、shape/native/CPU等の扱いがあるため非対応とは断定しない。GridSampleは4D/同batch/grid末尾2のruntime条件があり、全中間shape・native WebGPU kernel配置・CPU fallback・実数値/性能/資源は未検証。独自kernelやconverterを追加せず既存ORTで比較する根拠を追加した。既存公式package source/SHAを証拠に固定、低優先度1core/address上限2GiB、peak RSS442,880KiB、session作成/推論/browser/GPU0。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-kernel-surface.json。次の実行比較では同じ1024入力/正規化/出力logits→alphaとNVIDIAの実配置を確認する。公開manifest未変更、元scope継続。


### 2026-11-02: static Liteを既存CPU比較アプリへ組立

前turnはORT kernel入口照合のprogress。本turnは現行Lite provider gateがWASM専用であることをsource確認し、GPU可能と装う変更を避けて同1024²のCPU数値比較用private appを組立。別版ID lite-static-fp32-50a57872cc739192446da2a9 / 別cache namespaceで旧Liteを保持。既存Transformers/ORT/safetensors確認済みモデルbody/前後処理/sigmoid/foreground/PNG/協調cancelを再利用、新converter/kernel/cache engineなし。既存builderでWorker626,523byte SHA91d5868d7629c8cb1c10ac66877f6d0371be4ab023c85f4615dc26f864d00155、外部import0。app44mount/モデルresource199,681,655byte、weightFilesRead0/server0/browser0。通常cropは既存Canvasで、この比較用captured補助assetが最新HR/crop/input受入を継承するとはしない。private assemblyのみ、公開manifest/配信変更なし。GPU候補はpreparation/bootstrap/build等の明示provider制約と配置受入が別途必要。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-private-app-assembly.json。数値/品質/速度/資源/中止/全権利、HR+Matte/UX/Pages-R2等の元scope継続。


### 2026-11-02: 明示static Lite GPU経路を既存runtimeへ接続

前turnはCPU比較app組立のprogress。既存ORT bootstrap/Transformers preparation/Worker/build/app labelを拡張し、liteGraphFormat=grid-sample-static-1024の明示時だけFP32 Lite GPUを許可、従来native DeformConv Liteは引続きWASM専用。builderは固定body SHA50a57872.../199,681,624byte/1024入力を要求し、可変dimension overrideを拒否。GPUはNCHW/no CPU fallback、既存device lost/disposal/協調cancelを再利用。関連38test pass、builder negative SHA/容量/input512/markerなし/dimension混入の5条件が出力作成前に拒否。private Worker626,926byte、app44mount/199,681,655resource bytes、weightFilesRead0/server0/browser0/GPU0。初回01はMODNetからcopyした不要dimension override混入を発見し未実行のまま破棄対象、除去した02を採用し再混入guard追加。buffer限度/cache/dispatchは既存MODNet設定を再利用した比較用値でLiteの資源適合は未受入。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-gpu-connection.json。公開manifest/deploy変更なし、実数値/全GPU配置/速度/資源/画質/中止/権利と元HR+Matte/UX/配信等のscopeは継続。


### 2026-11-02: static Liteの固定出典文書をprivate footerへ同梱

前turnはGPU経路/38testのprogress。本turnは変換repo dc064531...と参照source旧revision7838f1c...のREADMEを実取得/SHA固定して既存model-notices/sources.jsonへ追加。変換cardはYAML/API MIT宣言あり。一方旧source cardはMIT badgeのみ、YAML/API licenseなし、両rootに独立LICENSE/NOTICEなしを確認し、現在main aa62のMIT宣言と混同しない。最初の一律YAML MIT assertがこの差を検出、文書取得を条件別に修正した。文書2個12,378byteを既存builderでfooterのmodel notice endpointへ全文同梱し、保存SHA/合本文への包含をreadback確認（計12文書）。private static-lite-gpu-main-03は02のWorker/モデル設定を維持し文書のみ更新、weightFilesRead0/server/browser/GPU/推論0。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-model-documents.json。これは候補出典表示で元重み/変換物の全権利承認ではない。公開manifest/deploy未変更、実数値/速度/資源/品質/中止とHR+Matte/UX/Pages-R2等の元scope継続。


### 2026-11-02: static Lite接続後のdomain回帰確認

前turnは固定model文書同梱のprogress。本turnはGPU接続変更後の既存test:domainを低優先度1coreで実施し501/501 pass（従来499+追加2）。既存HR/Matte/MODNet/旧Lite・取得/中止/解放等のdomain契約の回帰確認であり、native実受入ではない。private main03のprovider webgpu/GPU表示一致をreadback確認。Worker静的scanではrequire/eval呼出0だが上流guard付きprocess参照7/node:文字列1/new Function1を確認。これをNode実行依存/実CSP失敗とは断定しない一方、strict CSP完了とも扱わずnative Worker起動時の到達性確認を残す。source/Worker/log SHAを固定。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-domain-regression.json。browser/GPU/推論/deploy0、実数値/全配置/性能/資源/画質/中止/権利/HR+Matte/UX/配信等の元scope継続。


### 2026-11-02: 実bundleの制限VM/Node thread起動と未登録model拒否を確認

前turnはdomain501passのprogress。本turnは既存browser-export-thread.mjsを再利用し、CPU Worker01/GPU Worker02の実bundleを各2本、計4本直列の実Node thread上で評価。Node globalsなし・JS動的code生成禁止・WASM利用可能の条件で、モデル未読込dispose ACKと未登録model prepare→unsupported-model固定errorを確認。各proofでnetwork/asset fetch/WASM compile/GPU adapter要求0、全thread termination await。前段のnew Function文字列はこの起動/未読込拒否経路では到達しないことを確認したが、ORT初期化/実推論/CSPの全経路を証明しない。最初の2本は最終4本に含み重複加算しない。低優先度1core/old-generation64MiB（総RSS上限ではない）、実browser/モデル推論/GPU起動0。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-bundle-startup.json。元HR+Matte/数値/品質/性能/資源/UX/配信/全権利scope継続。


### 2026-11-02: static Liteの静的容量が現GPU policyを超えると判明

前turnはUI252pass/checkpoint06保存のprogress。本turnは既存ONNX memory toolを1GiB address上限/低優先度1coreで実行。初回はinfer_shapesのPython SerializeToString copyでMemoryError（RSS791,056,384byte）、モデル実行失敗ではない。固定ONNX1.23.2公式infer_shapes_pathを実読し、独自shape engine/上限増加をせずtemp出力付きpath APIへ変更。sourceを上書きしない専用出力を使いdata_prop=False/external data読込なし。再検査1.06秒/RSS466,681,856byteで完了、既存解析unit4pass。

最大宣言tensorはConcat [1,120,1024,1024] FP32=503,316,480byte（480MiB）。次にResize384MiB、Concat320MiBで、現GPU policy maxBuffer256MiBを超えるもの3個、binding128MiB超4個。331valueのshapeは未確定。literal-order/fresh-output仮定のknown activation約4.26GB＋initializer197MBはalias/view/optimization/workspace等を扱わず、実RAM/VRAM値・上限・必要資源保証ではない。小さなONNX fileやper-tap化を低推論メモリの証明にしない。

static-lite-gpu-main04は現policyで実行しない対象とし、CPU数値比較を先行、既存の低精度配布物/最適化後graphと端末制約を確認する。上限を増やして実行したり512入力へ静かに縮小したりしない。pending CPU→GPU許可への回答が来ても、この新しい資源gateが通るまでGPU段階へ進まない。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-static-memory.json。ORT session/推論/browser/GPU0、元HR+Matte/品質/性能/UX/配信/権利scope維持。


### 2026-11-02: FP16でも現binding制約が残ると整理

前turnはstatic memory解析のprogress。本turnは固定ORT1.31.1付属の標準convert_float_to_float16実装を読み、FP32 IO維持/blocked node/clip等の既存APIを確認。モデル変換せず、宣言FLOAT tensorの幅だけ半分と仮定すると最大240MiB、次192/160/128MiB。現maxBuffer256MiBに対する既知超過は0になるが、binding128MiB超が3残る。331unknown/workspace/実型配置を含まず、FP16解決/実メモリ半減とは扱わない。独自converter/分割を追加せず、候補評価とCPU数値を先行。GPU main04は現policyで起動しない。

前turn変更のstatic memory CLIへ実小ONNXのsubprocess試験を追加し、元source SHA不変・専用temp出力・path API使用・推論なし・output構成を確認、既存を含む5test pass。低優先度1core/address上限不変、browser/GPU/model推論/変換0。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-fp16-projection.json。全元scope/実行タイミング未回答/未受入条件維持。


### 2026-11-02: 静的Liteの既知tensor不足を起動前に拒否

前turnはFP16容量投影/静的解析5testのprogress。本turnは既知最大503,316,480byteよりmaxBuffer/maxStorageBinding宣言が不足/欠落するstatic FP32 Liteを、Worker builder・app assembler・ORT runtimeの3箇所で拒否。実policy/予算を増加せず、古いGPU artifact01〜04は引続きdo-not-run。runtime mockではadapter/device要求0、builder実呼出しでもWorker/app出力作成0を確認。十分なlimitの成功試験はfake adapterのみで、NCHW/FP32/shader-f16不要/no CPU fallback/解放を確認。関連35testpass、旧Lite WASM維持。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-early-limit-gate.json。既知tensor最低条件を満たしてもunknown shape/総RAM/VRAM/workspace/実性能を保証しない。checkpoint06は以前の固定artifactとして保持し現変更sourceと同一扱いしない。低優先度1core、実browser/model/GPU/deploy0、元scopeと未回答タイミング条件維持。


### 2026-11-02: adapter上限と検証policyを区別しGPU候補を再準備

前turnは不足policyの早期拒否のprogress。本turnは保存済みNVIDIA実測reportのadapterLimitsを確認し、maxBuffer2,147,483,648/binding2,147,483,644byteで、既知480MiB tensorを単一buffer能力では満たすことを確認。前turnまでの256/128MiBはMODNetから引き継いだpolicyの値であり、端末hardware上限ではなかった。この区別を訂正し、旧policy/main01〜04は拒否のまま、既知minimum503,316,480byteを両requiredLimitsへ指定した新policy02/Worker03/main05を準備。これは総VRAM枠の引上げではなく、observer BUDGETはprivate/WS4GiB・GPU増加1GiB・120秒を実export読取で維持。新Worker627,129byte/app46mount/モデル199,681,655byte、weightFilesRead/server/browser0。現adapterは未問い合わせ、runtimeは実行時に現在値を再確認する。unknown331/最適化/workspace/総資源/実数値/速度/中止は依然未受入。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-adapter-policy-distinction.json。実行時期未回答のため依存推論未開始、元scope維持。


### 2026-11-02: static LiteのFLOAT initializer値の対応を網羅

前turnはadapter/policy区別の訂正と候補main05準備のprogress。本turnは未確認FLOAT scalar13個をhead-dim32逆平方根/GELU sqrt2・1・0.5/座標2・2÷size/kernel offsetの明示式からFP32丸めbyteで照合し全一致。既存identity268/transpose51/tap290/fold+relative78/spatial13/scalar13の名前集合が重複なし計713で、元inventoryの全FLOAT名集合と一致することを実assert。残りはINT64 256個のみ。これはinitializer値の対応網羅で、整数index/reshape/座標/積算順/graph wiring/全体数値等価を証明しない。式の意味とnode接続の全証明は別途。低優先度1core/structのみでONNX/ORT import不要、推論/browser/GPU0。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-float-coverage.json。実行時期未回答、CPU比較待ちと全元scope維持。


### 2026-11-02: INT64定数の用途と局所契約を照合、静的検証の境界を確定

前turnはFLOAT713値対応のprogress。本turnは保存inventoryからINT64全256個の値とconsumer位置を確認、全てGather index/Unsqueeze axes/Slice start-end-axis-step/Reshape shape/Pad pads/Resize sizes/shape Concat入力で、未分類consumerなし。int64範囲、Reshape240の-1数/非負指定、Unsqueeze601の軸重複なし、Slice437の各vector同長/軸重複なし/step非0、Resize19の正サイズ、Pad24の偶数長を実assert。これらはsource graphとの意味等価ではなく、Gather範囲/runtime rank/element数/正確なslice/座標・積算順は未証明。静的にFLOAT値713とINT64制御256を分類したが、ここから先の全体数値/品質/性能判定には準備済みCPU実推論が必要。追加の静的件数を実推論の代わりに合格根拠としない。低優先度1core/JSONのみ、ORT/ONNX import/model/browser/GPU0。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-integer-controls.json。実行時期質問は未回答、元scope維持。


### 2026-11-02: CIの公開dist/一覧保持を接続

前turnは整数制御値分類のprogress。browser CIがbuild止まりでartifact保持未接続だったため、既存release-inventoryのcreate/verifyでreview copyと元distの両方を照合するstepを追加。GitHub公式APIでupload-artifact最新v7.0.2（2026-10-07公開）をcommit cf430e030ddbb5b0abf93d22962f4752f3646cd9へ解決し、固定action.yml SHA/Node24入口とinputを確認。独自upload実装やwranglerを追加せず、公式actionで公開dist＋inventoryのみ14日保持、filesなしerror、contents read維持。workflow YAML構文を既存PyYAMLでparse。READMEの古い診断schema2を4へ訂正し保持期限と未remote受入を明記。

型検査/build/dist guard pass（11file/3,252,160byte）、localで同じcopy/create/両verifyを実施し現sourceId一致。artifactId d345822f.../sourceId20686181...をci-release-review-local-01へ固定、旧checkpoint06保持。GitHub上のjob起動/権限/アーカイブ取得は未実行、push/commit/upload/deployなし。証拠: image-studio/docs/browser/validation/2026-11-02-ci-static-review-retention.json。14日CI保存は公開版長期保管/live rollbackの代用ではない。低優先度1core、browser/model/GPU0、元scope維持。


### 2026-11-02: model文書の既存SHA検査をCIと共有

前turnはCI review artifact保持のprogress。既存app assembler内のmodel-notices検査をNode built-inだけのcheck_browser_model_notices.mjsへ抽出し、assembler/CLI/CIが同じfilename/regular file/SHA/任意byte数/重複検査を使うよう統一。実12文書+index81,709byte一致を確認。改変/byte数/重複名/path逸脱/symlink/directoryの拒否と原文保持の3test pass、標準domain scriptへ接続。最初のnegative試験で先行改変を戻さないと後続条件を独立検証できない点を修正し、log02で個別error確認。CIのPR/push pathへmodel-noticesと両private builder/helperを追加、モデル文書CLIとbuilder syntaxをstepへ接続、PyYAMLでevent/構文確認。private main06実assembly46mount/weightFilesRead0、型検査/build/dist guard pass（11file/3,252,160byte）。新依存/二重validator/モデル取得なし。証拠: image-studio/docs/browser/validation/2026-11-02-model-documents-ci-coverage.json。remote CI/全binary権利/実機等の元scopeは未完、push/commit/upload/deploy/browser/model/GPU0。


### 2026-11-02: static Lite重み/変換sourceの権利資料対応を連結

前turnは6領域の受入gap照合のprogress。本turnは変換script8,728byte/SHA505d0236...を固定URLからdataとして再取得し、AST/docstring/import/commentのみ確認、remote source実行0。scriptに独立したcopyright/license headerはなく、docstringが元BiRefNet_liteをMITと記す。torch/torchvision/transformers/ONNX/ORT/onnxslim等のimportを確認するが、配布者の正確な変換環境版は未取得。これらをbrowserのPython実行依存と扱わない。

既存model-notices/sources.jsonのmodels欄へstatic ONNXの実SHA/容量、元checkpoint実SHA/固定revision/card file、変換scriptURL/SHAを連結。card文書だけの一覧から配布物との対応を追えるようにし、変換sourceを再配布する場合の権利表示確認/全binary audit/実受入は残した。既存共有validatorで12文書+index83,398byte一致、model取得/変換/推論なし。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-conversion-provenance.json。実行時期未回答、全元scopeと未受入gate維持。


### 2026-11-02: static Lite GPU1件は既存資源budgetで停止・解放確認

利用者の包括実推論許可でCPU完了後に直列実行したNVIDIA GPU1件は、モデルSHA取得/準備まで通過し、推論中にbrowser privateBytes5,873,205,248byte（約5.47GiB）が既存4GiB基準を超え、stopped-without-retry。同観測Working Set1,782,702,080byte（約1.66GiB）、全GPU3,035MiB/終了後968MiB。Private Bytesは物理RAMや正確なVRAMとは区別する。PNG/resultなし、画質/速度成功とはしない。browserClose ACK/最終processCount0/browserExitVerifiedを確認しbudget増加retryなし。実modelStarts1、CSP issue0だがmodel Workerだけunsafe-eval許可・nativeFile→CacheStorage seed/Playwright route診断条件で、public strict CSP/通常HTTP/CDN受入ではない。最新observerを元にprivate wrapperを作り、model199MBを巨大route.fulfillせず既存native File手法を再利用。開始前confirm UI待ちを明示waitへ補正。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-native-gpu-resource-stop.json。

次は標準float16変換等の資源改善候補を比較する一方、元HR+Matteの通し受入も維持する。終了後観測で空き物理約12.4GBへ回復しており、従来約4.44GBで停止したHR+Matte admissionは実行前の再判定対象。実行時期の再確認は利用者指示により不要、負荷監視と直列実行を維持する。


### 2026-11-02: HR+ViTMatte補正ONの本体PNG保存を初完遂

前turnはstatic Lite CPU完了/GPU資源停止のprogress。利用者の継続許可に従い、元要件のHR+Matteを最新UI/文書へ203mount/モデル資源1,267,265,814byteで組立し、同一合成人物1086x1448/補正ONでnative Windows Chrome/NVIDIA1件実行。今回は空きRAM admissionを通過し、HR全46stage→trimap→ViTMatte→foreground→透過PNGダウンロードまで成功、HR/Matte各1result、停止理由なし。検証用browser終了/process0/全GPU baseline近傍復帰を確認。保存PNG2,180,556byte/SHAe55ccc48...を独立Pillowでverify/decode、1448x1086 RGBA/alpha0..255/不透明770,798画素のRGB不一致0。補正OFFからalpha186,580画素変化、これは正解品質改善の証明ではない。

HR stageElapsed133.308秒、全46のprepare合計72.838/infer49.283/roundTrip132.222秒/parent feed copy0.639秒を保持。roundTripはchild時間を内包し重複加算しない、pure GPU/転送とはしない。Matte prepared→result約4.297秒。観測peakWS4,460,273,664byte（約4.15GiB）/Private4,064,034,816byte（約3.78GiB）/全GPU3,751MiB。資源は既存stage-validation基準内、約2分のHRは実用性能未受入。nativeFile cache seed/routing/no-store/model Workerのみunsafe-eval/blob childの診断条件で、public CSP/通常HTTP/CDN coldwarmとは区別する。

証拠: image-studio/docs/browser/validation/2026-11-02-hr-matte-native-png-acceptance.json。一般品質/可変形状/補正数値参照/実中止/device lost/連続使用/背景色再利用/crop用紙全通し/物理印刷/UX/配信/全権利は継続。計画を完了扱いにしない。


### 2026-11-02: 標準FP16変換とCPU比較、プランへ随時書戻し

利用者「進捗は適宜プランに書き戻すように」に従い、本正本と検証JSONへ結果/失敗理由/残条件を継続記録する。前turnはHR+Matte PNG通し成功のprogress。本turnは固定ORT1.31.1のconvert_float_to_float16(keep_io_types=True, disable_shape_infer=True)を再利用し、独自変換器なしでstatic LiteをFP16化。初回は公式converterが後置したIO Castによりtopological orderのcheckerエラー、モデル推論前に停止。ORT公式OnnxModel.topological_sort(deterministic)を追加した02でchecker pass。101,153,519byte/SHA298799f1...、6,131node、FLOAT16 initializer713/INT64256、IO FP32維持、低優先度1core/address2GiB/変換約5.94秒/RSS783,756KiB。

同一入力/SHA/旧native FP32参照、CPU1thread/address4GiB/timeout120秒で1件実行、exit0。prepare4.033秒/infer14.471秒/peak RSS2,710,928KiB。alpha1024²は5,329画素差・最大8段階、logit最大差0.43988/平均0.006629。FP32版11.510秒/alpha1画素1段階よりCPU速度/数値一致は劣る単発結果で、半容量をCPU実行の軽量化や同等品質の証明にしない。GPUは別途shader-f16明示/新SHA policy/実資源/画質比較が必要で未実行。既存path版memory toolを同1GiB上限で実行し静的容量も保存、runtime資源とは区別。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-fp16-cpu-comparison.json。元HR+Matte/全品質/速度/UX/配信/権利scope維持。


### 2026-11-02: static Lite FP16 GPUは約3.32秒でPNG完走、数値差は未受入

前turnはFP16変換/CPU14.47秒のprogress。本turnは2固定artifactのSHA/容量/既知tensor最低値/shader-f16要件をlite-graph-profileへ一元化し、既存bootstrap/Transformers/両builderで共有。FP16内部graphはIO FP32でもshader-f16を要求、CPU fallbackなし/NCHWを維持。入出力/資源/低精度featureの関連41testpass。別版/cache namespace、単一buffer/binding256MiB（既知240MiB tensorを満たす）、総private/WS4GiB・GPU増加1GiB・120秒の既存監視基準でnative Windows Chrome/NVIDIA1件を実行。モデルprepare→resultの要求区間3.318秒で透過PNG2,157,377byte/SHA0ed0c89b...保存、browser終了/全GPU baseline復帰確認。観測peakPrivate1,877,225,472byte（約1.75GiB）/WS1,581,723,648byte（約1.47GiB）/GPU増加156MiB。ただし短い処理のsamplingは瞬間peakを逃し、GPU値は他appを含むため厳密なpeak上限/使用量とはしない。

独立Pillow保存確認は1448x1086 RGBA、不透明RGB不一致0。CPU FP16 logitsをsigmoid/float bilinear/丸めした元寸法alphaと38,483画素差・最大45段階（>8段階14,042画素）、FP32 CPU比も最大45。差はbackend＋前後処理を含み、rawGPU errorや画像品質改善とは断定しない。CPU版に対する数値同等は未受入、次は同一raw入力/出力のprobeでGridSample座標等を切分ける。実行成功/速度と画質を分ける。CSP issue0でも既存model Workerのみunsafe-eval/nativeFile cache seed/routing診断条件、通常配信受入ではない。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-fp16-native-gpu.json。元HR+Matte/全品質/UX/配信/権利scope維持。


### 2026-11-02: FP16 GPU差をraw実行へ切分け、後処理の一致を確認

前turnはFP16 GPU3.32秒/保存alpha差45・domain507passのprogress。本turnは既存createStagedHr/StageWorkerHandler/Transformers preparation/ORT bootstrapを1stage・全modelとして再利用し、同じモデルSHA298799f1.../同じ保存済みFP32入力SHAae7b95d4...12,582,912byteを前処理なしでGPUへ渡すprivate probeを組立。独自推論executorは追加せず、既存port/finite/SHA/解放/協調中止/gate/downloadを再利用。初回native runnerはUNC require literalのescape誤りでbrowser前に終了、修正後launch02でmodel1件のみ実行。prepare4.246秒/infer要求区間2.492秒、FP32logits4,194,304byte/SHA b295f14e...を保存、gate/runner idle・browser終了確認。

rawGPU対CPU FP16はlogit最大差2.6652/平均0.77692、1024²のalpha25,160画素差・最大50段階（>8段階9,681画素）。対CPU FP32も最大logit2.6632、alpha最大49段階。一方rawGPUを独立Pillow sigmoid/float bilinear/丸めで元寸法へ戻すと、前turn本体PNG alphaと全1,572,528画素完全一致。従ってこの固定入力では画像前処理/復元/保存が45段階差の原因ではなく、モデルGPU実行（最適化/FP16演算を含む）側へ限定できた。GridSample等の個別kernel原因はまだ断定しない。次は中間checkpointで差の成長箇所を確認し、必要なら標準mixed precision指定を比較する。

証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-fp16-raw-parity.json。診断File/cache/routing/worker unsafe-eval条件、合成1入力、一般品質/production CSPは未受入。公開source/model設定変更なし、重い実行は直列・既存budget維持。計画へ結果/失敗理由/残条件を書戻し、全元scope継続。


### 2026-11-02: エンコーダー中間6点でFP16差の増大を確認

前turnはrawGPU後処理→本体PNG全alpha一致による実行側切分けのprogress。本turnはONNX公式extract_modelでFP16 modelの最初Conv/直後LayerNorm/4段norm特徴量を出力するencoder診断subgraph64,750,326byte/SHA4c00c8b2.../606nodeを抽出、同inputでCPU1thread1件（infer4.629秒/RSS1,204,752KiB）→GPU1件（infer要求1.337秒）を直列実行。既存stage runner/handler/ports/SHA/finite/gate/協調解放/downloadを再利用、全6出力48,758,784byteのSHA保存/CPU比較、browser終了確認。

FP16 CPU/GPU差は最初Conv max0.005859/相対L2約0.157%、直後norm max0.04297/約0.266%。norm0約2.43%、norm1約4.47%、norm2約2.90%、norm3約2.29%とdecoder/GridSample前に増大。norm2の単要素max7.947等も記録。これはcheckpoint付きsubgraphのoptimizer差を含み、特定kernel bugやfull graph全誤差原因の断定ではないが、GridSampleだけをFP32へ戻す前にencoderの精度を比較する根拠になった。次は標準float16変換のnode_block_listでencoderをFP32保持しdecoder FP16を比較。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-encoder-checkpoints.json。低優先度1core/同budget/重い実行直列、公開設定変更なし、元scope維持。


同turn補足: 標準ORT float16変換のnode_block_listへ/net/bb/配下を指定したencoder FP32/decoder FP16候補を試したが、生成Castの同名output（...Constant_1_output_0_cast_to_fp32等）が重複しONNX SSA検査で拒否。mixed-encoder-fp32-01/model.onnxは未生成・推論なし、無効graphを実行しない。既存ORT sourceを確認すると共有入力のFP32 Cast生成経路で同じoutput名を生成する。独自kernel/変換器を増やす前に保守済み標準converter/重複除去APIを確認する。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-mixed-conversion-rejection.json。既存FP32/FP16基準を保持、品質同等/採用は未完。


### 2026-11-02: 公式推奨の代替mixed converterを確認、型不整合で採用せず

前turnはencoder FP16差/ORT converter SSA拒否のprogress。本turnはORT公式float16文書が案内するMicrosoft onnxconverter-commonを一次資料とPyPI metadataで確認。1.16.0 wheel89,511byte/SHA df39ee96...を固定取得、MIT LICENSE/NOTICE保存、private requirements.lockへ版/hash記録。zipimportだけで利用しglobal/pip install/公開JS依存は追加しない。標準node_block_listへencoder1229nodeを指定し、既定op blocklist（Resize等）/既定clip/IO FP32を維持した候補は166,093,212byte/SHA014ca6d8.../6,711node、変換50.98秒/peakRSS1,124,500KiBでSSA/checker(full_check=False)通過。独自修正なしでCast重複は回避できた。

しかし同input/model/reference SHA確認後のCPU session作成でdecoder aspp_deforms.2 Add_22の入力Tがfloat16/float混在しLoad Fail。実inferは0回、数値/性能結果なし・GPUへ進めず採用しない。source/onnx構造チェックのみを実行可能の証明としない。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-common-mixed-rejection.json。標準2経路で問題が出たため独自converter/kernelを増やす前に、数値確認済みFP32版を適切な既存検証resource profileで測る選択を検討する。軽量4GiB Private/1GiB GPU増加枠の失敗は保持し、別枠成功を軽量合格としない。元HR+Matte/全品質/性能/UX/配信/権利scope継続。


### 2026-11-02: 数値確認済みFP32 Liteを既存HR検証枠で完走

前turnは標準mixed converter2経路の拒否を記録したprogress。本turnは独自変換修正を増やさず、同じ固定FP32200MB graph/policy/main06を既存stage-validation資源classで1件比較。Private12GiB/WS5GiB/GPU増加4GiB・GPU空き1GiB/物理空き3GiB/virtual空き8GiBの既存admissionを維持、時間は元lightと同じ120秒。新profile/fresh task browserで開始前条件を通し、モデルprepare→result要求区間2.567秒でPNG保存、終了/process0/GPU baseline復帰確認。

独立Pillow decodeで1086x1448 RGBA/不透明RGB不一致0、同inputのstatic FP32 CPU参照から元寸法alphaは2画素・各1段階のみ、>1段階0。保存SHA15c3196b...。このfixtureではFP16版最大45段階差と異なり1段階以内へ収まった。モデル全体の数値/一般品質/速度順位を確定せず、軽量枠不合格を取り消さない。

今回の観測peakPrivate1,821,487,104/WS1,985,863,680byte・GPU増加45MiBは、sampleのphaseがresource-state→disposedへ飛びinfer中を観測していないため、小メモリ実行の証拠ではない。前回light枠で観測したPrivate5.47GiB/GPU増加2047MiBは保持し、sample間隔約3〜4秒より短い2.57秒処理のpeak取り逃しを明記。次は継続的なOS/GPU観測でpeakを確認し、採用resource条件/実用性能/一般画質を判断する。診断routing/worker unsafe-eval/nativeFile cache条件でproduction配信未受入。証拠: image-studio/docs/browser/validation/2026-11-02-static-lite-fp32-expanded-gpu.json。元HR+Matte/UX/配信/権利scope維持。


2026-11-02: リソース観測はWindows標準Process APIと公式nvidia-smiの継続出力を再利用。独自GPU監視エンジンを増やさず、単発shell起動の観測間隔を改善した。空browserで中央値206ms/最大535ms、PowerShellのみCPU約0.11core。推論peak/全collector負荷は未受入。証拠: validation/2026-11-02-browser-resource-stream.json。


2026-11-02: FP32 static Liteを継続観測付き実Chromeで1件完走、prepared→result 2.575秒/保存PNG SHA前回一致。観測Private最大5.43GiB/WS1.90GiB、全GPU最大4864MiB（baseline比3872MiB増）。light枠不合格を保持、既存拡大検証枠の成功と区別する。観測最大値は真のpeak/モデル専有VRAMではない。FP16は既知の数値差により未採用、独自converterを追加しない。一般品質/連続性能/配信受入は残る。証拠: validation/2026-11-02-static-lite-fp32-stream-gpu.json。


2026-11-02: 公式ORT1.31.1 asyncify MJS/WASMを固定SHA照合後、Nodeの文字列code-generation禁止下でもmodule初期化成功。new Functionの静的出現はprepare/sessionでのunsafe-eval必須の証拠ではない。公式配布を維持し公開CSPを広げず実browser呼出しで切り分ける。証拠: validation/2026-11-02-ort-csp-initialization.json。モデル/session/GPU/browser/network起動0、HTTP CSP受入は未完。


2026-11-02: static Lite FP32本体は実ChromeでJS unsafe-evalなしのpreparedまで成功、CSP違反0。infer中は全GPU増加4359MiBで既存枠超過停止し、CSP不適合の証拠とはしない。公式moduleを維持し独自no-eval build/ヘッダー緩和を先行しない。次は既存軽量モデルのstrict CSP完走を確認する。証拠: validation/2026-11-02-lite-strict-csp-prepare.json。


2026-11-02: MODNet可変寸法GPUの現UIを実Chromeでscript-src self+wasm-unsafe-eval/worker-src self/JS unsafe-evalなしでPNG保存まで完遂。以前GPU出力とSHA一致、CSP違反0。公式runtimeを改造せず完走経路あり。WASM許可と本番HTTP/CORS、HR/Matte経路は別受入。証拠: validation/2026-11-02-modnet-strict-csp-png.json。


2026-11-02: HR46stage＋trimap＋Matte＋foregroundは実ChromeでJS unsafe-evalなしにPNG完走、既存CPU比較済みPNGとSHA一致。公式ORTの動的Function静的出現から必須とは言えなかった。ローカルserverのJS eval例外を削除し、blob子Worker許可はhash固定model ownerだけに限定。3test/4HTTP境界を確認、狭いserver policyでのnative/production受入は別。証拠: validation/2026-11-02-hr-matte-strict-csp-png.json。


2026-11-02: native asyncify ORT1.31.1の公式storageBufferCacheModeをMatteだけsimple→disabledで比較。同入力/固定graph/precision/停止値を維持し、全GPU観測増加5067→2929MiB、PNGはCPU比較済み保存物とSHA一致。新kernel/converter/縮小を増やさず標準optionで改善候補を得た。RAMは引続き大きく、別入力/連続使用と既定採用は未受入。証拠: validation/2026-11-02-matte-disabled-cache-first-input.json。


### 2026-11-02: 利用者指定SAM2Mattingの一次資料確認

FudanCVL/SAM2MattingのHF metadata/checkpointsと公式GitHub README/LICENSE/requirements/image sample/predictor/Tiny configを固定revisionで確認。証拠: validation/2026-11-02-sam2matting-candidate.json。Tiny約216MB/Base+約383MB/SAM3約3.51GBは保存量でありRAM/VRAMではない。静止画sampleはraw mask/256² mask_inputを入力し、1024² image encoder featureからalpha headを実行する。既存マスクの補正や対象指定の候補になるが、自動人物抽出のdrop-in代替・encoder省略・WebGPU動作は未証明。公式経路はPyTorch/CUDA bfloat16等で、確認した公式資料にそのまま使えるONNX/WebGPU配布経路は見つからず。

HF/READMEはCC BY-NC-SA 4.0、LICENSEはCC BY-NC 4.0で不一致。両方非商用条件を含み、app MITからweightの許諾を推定しない。採用は保留し、公開時のgrant整理と既存export/runtime対応確認を先行。重み取得/推論/新依存/独自exporter追加なし、現行モデル検証を置換しない。


### 2026-11-02: HR46工程の速度内訳と公式最適化の適合性

横長2000×1000の実HR46工程を全明細で再集計。186.566秒の内訳はstage prepare105.856秒、inference call64.885秒、export/release0.394秒、parent往復のその他13.551秒、往復外1.879秒。prepare約56.7%。prepareはruntime/device作成・検証・WASM初期化・session作成等をまだ分離していない。inference callも転送/初回shader compileを含みpure GPU時間ではない。その他を固定し計算呼出しを仮に0にしても約121.680秒残るため、計算kernelだけを根拠に高速化を約束しない。

公式ORT performance diagnosis / env flags session optionsを再確認: https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html および https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html 。graph captureは一回限りのstage sessionをそのまま速くする保証がなく、freeDimensionOverridesは静的HR stageへ自動適用しない。GPU tensor保持は既存device/Worker間所有権と解放境界の変更を伴うため無計測で導入しない。既存診断routeはHTTP cache無効なのでcache最適化効果も未測定。先にprepareの検証/runtime/session内訳を限定metadataで計測し、維持する解放/資源条件と比較する。新kernel/新依存/独自cache engineなし。証拠: validation/2026-11-02-hr-time-breakdown.json。


### 2026-11-02: 利用者指定NanoSAM・蒸留済み上流モデル優先

利用者の「蒸留」により、既存の学習済みstudentを先に確認し、自前の蒸留学習を既定にしない。NanoSAM公式はMobileSAM encoder featureをResNet18へ蒸留しdecoderを共有、既存ONNX encoder/decoderを案内する。したがってTensorRT専用だから候補外とはしない。一方、標準出力はpoint/box指定のsegmentation mask/logits/IoUであり、髪の半透明alphaの受入は別。NanoSAM mask＋既存補正の全体精度/速度/RAMを比較し、SAM2Matting encoderへの無検証差替えは行わない。Jetson TensorRTの公式速度をWindows Chrome WebGPUへ転用しない。

repo Apache-2.0と個々ONNX重み/上流SAM-MobileSAMの許諾・由来は区別して確認する。teacherとstudentは重み/品質が変わるため同一HR互換baselineを置換せず別候補として評価。自前蒸留は利用許諾済み学習素材と独立した髪/眼鏡/透明境界の評価が必要で、現2合成素材のみで品質維持を主張しない。証拠: validation/2026-11-02-nanosam-distillation-review.json。固定公式source SHA保存、重み取得/推論/学習/新依存なし。次は既存ONNXのmetadata/重み許諾/対応opを確認。


### 2026-11-02: 利用者提案の読込最適化を現経路へ照合

OPFS/transferable/Safetensors/並列fetch/instantiateStreaming/事前最適化の提案を検討。現経路はTransformers.js＋ONNXで、Safetensorsを直接ORTへ渡す機能とは別。OPFS SyncAccessHandle.readは指定bufferへのreadでmmapではなく、GPU writeBufferも転送copyを含むため全体zero-copyを主張しない。既存stage/taskはtransfer listで所有権移譲済み。無制限Promise.allはpeakを増やし得るため既存直列を維持。runtime loaderは公式ORTを優先、graphOptimizationLevel disableは対応artifact/EP/shape/出力を確認して比較する候補。

既存resource-policyのreader.read待ちとhash update/digest呼出し時間、検証byte/stream数を数値snapshotで追加し準備handleへ保持。hash初期化は未含有、read待ちはpure disk I/Oではない。tee/並行streamの合計は重なるのでmodelLoadから単純減算しない。固定clockのhash24ms、snapshot不変、identity非保持を含む関連47/全domain534pass。stage protocolへの追加伝搬とnative再測定は次段階。証拠: validation/2026-11-02-resource-timing-and-loading-options.json。

一次資料: https://developer.mozilla.org/en-US/docs/Web/API/FileSystemSyncAccessHandle/read 、https://developer.mozilla.org/en-US/docs/Web/API/GPUQueue/writeBuffer 、https://huggingface.co/docs/transformers.js/v3.8.1/en/index 。固定ORT1.31.1配布source backend-webgpu.tsのrun経路はmissing artifact時programManager.buildを呼ぶため、全shader compileをsession作成へ割当てない。新cache/decoder/kernel/dependencyなし。


### 2026-11-02: NanoSAM既存API/公式export契約の照合

公式Drive uc/usercontent endpointsは今回の接続で両ONNXともHTTP200 HTML、各4KiBで打切り。encoder HTML followupも64KiB以内で、サイズ/SHAは未確定。固定GitHub treeにある40,728,226byte assets/mobile_sam.ptはteacher系であり、蒸留student encoderと取り違えて取得しない。repo treeにはstudent checkpoint/ONNXなし（外部配布の不存在の証明ではない）。

既存固定Transformers.js4.3.2 bundleはSamModel/SamProcessorを公開するので、新frameworkを追加する前に再利用を比較できる。ただしHF SamModel encoder入力pixel_valuesに対しNanoSAM exportはimage、decoderはimage_embeddings/point_coords/point_labels/mask_input/has_mask_input→iou_predictions/low_res_masksで契約差があり、classの存在だけでそのまま読込可能とはしない。公式encoder/decoder export sourceをSHA保存、実配布graphは未取得。証拠: validation/2026-11-02-nanosam-upstream-contracts.json。新依存/変換器/重みdownload/推論/学習なし。


### 2026-11-02: 年代を踏まえ新しい軽量候補を優先

利用者「3年前なので古いかも」を反映し、NanoSAMは過去比較基準へ下げ、EdgeTAM（CVPR2025、SAM2系軽量化）を新候補の優先1、EfficientTAM（2024公開/2025更新）を優先2とする。EdgeTAMは現固定Transformers.js4.3.2 bundleにEdgeTamModelがあり、別framework追加前に既存経路を評価可能。EfficientTAMは軽量ViT/効率的memory attentionであり、NanoSAM同様の蒸留だと未確認で分類しない。両方prompted segmentationで髪alphaの品質は別、動画の公称速度を静止画browserへ転用しない。SAM2Matting2026は既存の許諾不一致/非商用条件を保持。公式: https://github.com/facebookresearch/EdgeTAM / https://github.com/yformer/EfficientTAM 。

NanoSAM公式Drive HTMLは全文の表示textからGoogle Drive Sign-in画面と確認、認証未実施。公開再配布元moeen14/argus-omnimotus-vision-modelsの固定revision/metadata SHAでencoder63,321,621byteとdecoder16,505,236byteを取得、既存ONNX1.23.2 checker両pass/graph IOとopset16/演算集計保存。これは原NVIDIA重み一致を証明せず公開採用しない。推論/学習なし、構造確認のみ。証拠: validation/2026-11-02-newer-distilled-candidate-priority.json、private receipt/graph-inspection.json。


### 2026-11-02: EdgeTAM既存ONNX/公式APIを取得して構造確認

onnx-community/EdgeTAM-ONNX@9c77c7bff7fd0f3079585fa17af7f730ddc531edを既存候補として確認。HF staff/Xenova配布のFP32 graph2/data2を公開SHA/容量照合して取得、計40,896,123byte。metadata base_modelはyonigozlan/EdgeTAM-hf@c266ce53b3fc00f0f495b583f6a116c4e57f53bb、双方Apache-2.0宣言。ただしMeta原重みとのtensor一致までは未証明。既存Transformers.js4.3.2のEdgeTamModelはSam2Model継承、processor metadataも既存Sam2系で、自前export/decoder不要の候補。

既存ONNX1.23.2 checker両graph pass、外部tensor252件のlocation/offset/length範囲を照合、opset18。encoder386node、pixel_values[batch,3,1024,1024]→3特徴32×256²/64×128²/256×64²。decoder692node、points/labels/boxesと3特徴→iou_scores/pred_masks/object_score_logits。ScatterND8/OneHot1等を含み、native WebGPUのtype/shape対応は実確認が必要。低優先度1core/address2GiB/peakRSS56,312KiB、推論/学習/GPUなし。FP16/量子化は別品質候補として保持し未取得。証拠: validation/2026-11-02-edgetam-existing-onnx.json。


### 2026-11-02: Matte Anything教師→EdgeTAM alpha student案

利用者「matte anythingがあるならそれをedgetamに蒸留」を具体化。重いMatte Anything（SAM＋pseudo trimap＋ViTMatte）の連続alphaを教師信号としてofflineで利用し、ブラウザは既存EdgeTAM encoder＋学習済みalpha decoder1本へする案。二値maskを学ぶだけでは半透明alphaの蒸留にならない。教師/studentは同画像・同対象promptで対応付け、自動人物抽出と手動対象指定を混同しない。既に確認済みEdgeTAM3特徴32×256²/64×128²/256×64²は多段headへ渡す候補。SAM2Matting等の既存head/学習方法/条件を先に調べ、形状一致だけで重み互換としない。

最初はencoder固定の小head pilot、必要性が確認できたら一部encoder fine-tune。alpha回帰/境界gradient等、正しいforeground/backgroundがある場合のcompositing lossを比較候補とする。教師誤差とGTを区別し、髪/眼鏡/半透明/背景を跨ぐholdoutでMODNet/教師と比較。1024特徴から失われる2000px細部は単純拡大で復元できるとせず、必要なら既存軽量RGB detail branchを検討。公開許諾/学習素材/新weight/学習資源/ONNX演算/実browser全体時間と資源の検証を要する別モデル案であり、現在のHR同一重みscopeは保持。現2合成写真は動作確認に限り、品質維持を証明する学習データには不足。

利用者の前段提案も一次資料へ補正: BRIA公式cardはBiRefNet architecture/非商用HF weights・商用別契約（https://huggingface.co/briaai/RMBG-2.0）、Matte Anything公式は別SAM/ViTMatte/optional GroundingDINO（https://github.com/hustvl/Matte-Anything）で共有encoderを既存事実としない。MODNet速度は今回実測CPU約1.57〜2.74秒を使用、Depth近景＝対象人物とはしない。証拠: validation/2026-11-02-matting-edgetam-distillation-design.json。設計案のみ、学習/新依存/新kernel/GPU/deployなし。


### 2026-11-02: 人の対象指定を不要とする要件とSAM2.1 Tiny

利用者「点選択など、人間が関与しないアルゴリズム」を通常背景除去の必須条件に反映。予定していた手動box比較を通常UX解決策として進めず、既存画像のみMODNet/自動HR＋Matteを基準へ。蒸留studentも画像のみ→alpha、教師は既存自動HR＋Matteを優先し、Matte Anythingを使う場合もteacher targetを自動化する。手動crop等の元機能scopeは維持。

利用者指定SAM2.1 Hiera-Tinyを公式READMEとautomatic_mask_generator.pyで確認。2024-09-29公開/38.9M/Apache-2.0。SAM2AutomaticMaskGeneratorは内部grid点を生成し人の点指定なしで動くが、既定32²点・batch64の複数mask生成であり、目的の人物全体の選択や半透明alphaとは別。ONNX Community固定revision814a066...のimage FP32 graph2/data2 metadata計155,610,424byte、EdgeTAM取得版40,896,123byteの約3.8倍（DL量比でありRAM/速度比ではない）。既存Sam2Modelを比較へ再利用可能だが、候補実graph/実browser/品質は未受入。新しさもSAM2.1は2024、EdgeTAMは2025で区別。精度/教師比較候補に保持し、単体prompted速度で自動背景除去の採否を決めない。証拠: validation/2026-11-02-automatic-selection-sam21-tiny.json。


### 2026-11-02: 保存済み実推論作例は既存比較UIを再利用

許諾済み架空人物の既存MODNet CPU PNGを変更せず公開作例へコピー。新画像viewerや処理libraryを追加せずBackgroundComparisonを再利用し、details展開時だけmount、lazy画像と作例専用altで既存editorと区別。比較/倍率は表示のみ。関連UI82pass、build/guard pass、native390/1440でkeyboard slider/切替/200%拡大のdocument幅/閉じunmountを確認。モデル要求0/browser終了。実推論出力の提示であり一般画質・人の理解・live配信の証明ではない。証拠: validation/2026-11-02-landing-actual-matting-example.json。


### 2026-11-02: MODNet FP32は公式案内ONNXと全byte同一

既存Xenova/modnet固定revision fa2fa546...のFP32 binaryについて、MODNet公式固定revision28165a451...のonnx/READMEが案内するDrive ID1cgycTQlYXpTh26gB9FTnthE7AvruV8hdを取得。今回はHTMLでなく26MB binaryで、既存採用候補とbyte完全一致、25,888,640byte/SHA07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9。公式READMEはcommunity contributor manthan3C273を明記し、変換recipeはphotographic checkpoint、dynamic batch/height/widthを案内。新converter/re-exportを作る必要なし。公式案内の元binaryとのidentityは証明、元checkpointからの再build/学習data由来は別。公式ONNX READMEをnoticeへcaptureし13文書SHA/3tests pass、distributionApproved=falseを維持。証拠: validation/2026-11-02-modnet-official-onnx-lineage.json。


### 2026-11-02: OPFS等を追加する前にHR工程28の準備を分離実測

全HRのadmission headroom不足に対し、同重み/設定/既存factoryの工程28 prepare/disposeだけを既存light枠で2回実測。3,539,442byte、native Chrome/fresh Worker。約2.9595/3.1516秒、modelLoad約2.8128/2.9759秒、reader wait12.0/16.6ms、hash27.7/19.8ms。初回6検証/7,078,884byte（保存/再読）、2回目cache3検証/3,539,442byte、model network3計。少なくともこの工程はread/hashが支配的ではなく、OPFS/new cacheを増やす根拠はない。次は既存ORT session API等の時間境界を診断計測。sumは重複し得てloaderから単純減算しない、shader特定/全HR速度改善/HTTP coldwarmの証明ではない。証拠: validation/2026-11-02-hr-stage28-preparation-timing.json。


### 2026-11-02: ORT既存session境界とWorker維持の準備時間を比較

既存ort.InferenceSession.createのみReflect.applyで同this/argsのまま診断wrap、各prepare1callを確認してfinally原method復帰。新Worker各2回の工程28でsession2372.4/2281.7ms、modelLoad2492.2/2320msの約95〜98%。同Workerでdispose→再prepareは全体2279.6→476ms、session2078.1→381.1ms。Worker/ORT初期化維持の候補が有望で、OPFSや新cacheを先行追加しない。WASM/graph/shaderの内部原因までは特定せず、同graph再prepare/CacheStorage影響を含む準備のみで本体高速化とはしない。異なるstageの実推論数値/中止/所有device・tensor・session解放/長時間資源を確認してから採用判断。既存stage-per-Worker方式は未変更。証拠: validation/2026-11-02-hr-session-boundary-worker-reuse.json。


### 2026-11-02: 同Workerの異なるHR工程実推論がbyte一致

既存preparation/runtime/Tensor/model APIで28→22を逐次prepare/infer/disposeし、fresh Worker各1工程とretained Worker2工程を別fresh profileで比較。catalog exactshapeの半精度5値pattern入力、双方出力finite/shape一致、工程28 relu_21 2MiB SHA dde04527...、工程22 add_89 24MiB SHA68fd5a59...が全byte一致。22資源は両方network3/保存読戻6検証でcachehitではない。22prepare1903.7→405ms、session1630.5→264.6ms（別runの観測、全体速度保証でない）。初回diagnosticのFloat16Array値をbit列と誤認したfinite判定はraw Uint16 viewへ修正し失敗receipt保持。次は中止/障害/資源範囲を検証し、production採用判断。証拠: validation/2026-11-02-hr-two-stage-worker-reuse-parity.json。


### 2026-11-02: 新poolを作らず既存stage handlerへ上限付き逐次契約を追加

ORT session再準備の実測に基づき、既存handlerのone-use制約を既定maxJobs1の上限指定へ拡張。default unchanged/1〜46/重複拒否/解放barrier/異常後poison。新scheduler/cache/kernel/ML libraryなし。関連30/domain541/build pass。既存protocolでnative同Worker中止→異工程→再工程、従来rawSHA一致を確認。親pipeline未切替、全shape/資源/実device喪失等受入後に採否を決める。証拠: validation/2026-11-02-stage-bounded-reuse-cancel-native.json。


### 2026-11-02: 既存逐次runnerとstop hookで親のper-run候補を実装

新Worker poolを追加せず、既存SingleWorkerTaskのstop hookへsettlement codeを渡しcreateStagedHrの明示per-run lifetimeで成功工程間だけ維持。error/cancel/final termination/gateを既存契約に接続。final終了待ち中のabortが結果を公開しないようlistener寿命/終了後abort確認も追加し回帰検証。関連36/domain547/build pass、native親経路/全46工程は未受入。通常prepare/builderはdefault per-stage/maxJobs1維持。証拠: validation/2026-11-02-stage-parent-opt-in-reuse.json。


### 2026-11-02: 元46工程のread/hash/loader全coverageを取得

headroom回復後に元per-stage/同重み＋Matteの1回を既存stage枠で完遂。HR elapsed120.4774s、prepare67.0659s/runtime4.2952s/modelLoad62.609s、model call42.8511s。child HR資源137stream/869,929,904byte、reader wait4.0596s/hash3.1381s。master初回取得/検証やMatte等はこのresource計測外、sum重複の可能性があり単純差分でsession時間を作らない。refined PNGは前回byte完全一致。既存library/ORT初期化維持のfull候補比較を優先し、OPFS/cache engine等を増やさない。資源観測/全scope制限はvalidation/2026-11-02-hr-full-resource-timing-native.json。


### 2026-11-02: 全46工程1Worker維持は資源gateで不採用

明示lifetimeをstage child maxJobs/manifest/親trusted policy/prepareへ接続し、不一致maxJobs45対46をbuild前拒否。関連38/domain549/build pass。元stage ports/resources/profile/runtimeassets、HR/Matte resources/profiles同一を確認しprivate候補205mountを組立（重みread0）。全体候補1件は34工程prepare11.4882s/infer16.3389sまで進んだが、WS観測5,736,828,928byteで既存5GiB上限を超え停止。Private6,231,846,912byte、collector450sample/drop0/終了、browser終了/GPU基準近傍復帰。全体1Workerは採用せず既定per-stage維持。次は既存task/stopを使う明示回数上限の工程groupと確実な終了で再利用を限定し、memory上限増加や新pool/cacheを避ける。証拠: validation/2026-11-02-full-worker-reuse-resource-rejection.json。


### 2026-11-02: 既存stop primitiveで8工程単位の再利用が全体完走

親maxStagesPerWorkerを明示上限へ、child maxJobs/manifest/trusted policy/builderへ同値を固定。既定per-stage/1は保持。成功時だけcountし8件でstopをawait、次Workerを作成、最終端数も終了。境界中止/stop失敗/不正上限/出力一致を関連44/domain555/buildで確認、不一致metadata7対8も拒否。元46stage/同重み/演算/資源profile/runtimeにてgroup8＋MatteがPNG全byte一致、HR120.4774→59.584s/prepare67.0659→19.2343sの観測。WS最大5,159,190,528byte（5GiB内、margin限定）/Private7,013,756,928byte、784sample/drop0/終了。1画像1回なので既定採用せず、他fixture/反復/実境界中止等を継続。新pool/cache/kernel/ML libraryなし。証拠: validation/2026-11-02-hr-group8-full-parity-resources.json。


### 2026-11-02: group8別人物失敗を保持し既存numeric設定max4を検証

group8は別portraitで44工程後WS5,610,958,848byte/既存5GiB超過、final PNGなし。一般採用しない。既存maxStagesPerWorkerのみ4へ固定した別build/policy/mainで同写真を検証し、全46＋Matte・PNG e55ccc48...が旧保存と全byte一致。HR69.986s/prepare26.7365s、観測WS4,919,320,576byte/Private6,668,750,848byte/全GPU3724MiB baseline923、873sample/drop0/終了・GPU復帰。追加source/依存/上限変更なし。次はmax4のlandscape/反復/実境界中止を確認し、1画像成功を一般化しない。証拠: validation/2026-11-02-hr-group4-portrait-parity-resources.json、validation/2026-11-02-hr-group8-portrait-resource-rejection.json。


### 2026-11-02: 選択runtime9部品の表示対応とrembg NOTICE漏れを修正

max4実mount/モデル資源/捕捉済みlicense全文を対応付け。ViTMatteはweight card Apache2と元code MITを分ける。foreground-rgbaはrembg変換を明示参照するが既存Foreground NOTICEはPyMatting/xccのみだったため、固定wheel2.0.85（SHA9642672c...）由来MIT全文SHA90a32150...をfixtures/licenses/rembg-MIT.txtへ追加し、既存builderのforeground時だけ表示へ収録。NOTICE2219→3339byte、Worker/WASM byte同一、再組立205mount/modelと実行asset158件のSHA/byteとruntime configがnative検証済みappと同一。初回古いWASM指定は既存SHAguardがbuild前拒否、固定review packageの569504ce...へ正して上限/guard変更なし。追加ML依存/演算変更なし、表示変更のみなので推論/全回帰の再実行なし。immutable公開URL/変換履歴/全適用性の残件は分離。証拠: validation/2026-11-02-selected-runtime-notice-coverage.json。

### 2026-11-02: 非公開候補の全byteレビューを標準Node APIで固定

既存release-inventoryはPages公開distの25MiB/禁止file/private混入guardを使うため、巨大モデルを含む非公開本体へ流用してguardを緩めない。`review_browser_private_artifact.mjs`を別入口とし、同じ「ファイル一覧＋内容SHAからartifactId」の方式を標準Node `crypto.createHash`と`FileHandle.createReadStream`で適用する。npm SBOMは依存情報であり、モデル・processor/config・custom Worker・noticeを同時に固定するbyte inventoryの代用にはならない。新しいSBOM/署名packageやarchive/cache engineを追加しない。APIは[Node24 crypto](https://nodejs.org/download/release/v24.18.0/docs/api/crypto.html)と[FileHandle](https://nodejs.org/download/release/v24.20.0/docs/api/fs.html)で確認、使用範囲は既存Node24.8で実行確認する。

候補manifestが明示private/loopback/配布未承認であることを要求し、全mountを正規化・重複確認してから実sourceを1MiB streamでSHA/bytes照合する。同じfileへのaliasは1回の読取にまとめるが宣言矛盾は拒否する。全sourceをprivate root内regular fileへ限定、読取中・後の変更と同サイズ破損も拒否。Workerとnoticeを個別にhashへ含めるため、実行Workerが同じでもnotice変更でartifactIdが変わる。mtime/host path/時刻はcontent IDへ入れない。private source manifestのSHAは別に束縛する。

これは承認や署名、source/build再現性、許諾audit、immutable public URL、CSP/CORS、live rollbackの代替ではない。snapshot後のfile改変も防がないため、実際に採用/配置する前に再verifyする。出力はprivate root内の新規0600 JSONのみで、upload/モデル初期化/推論/アプリcache変更は行わない。公開distのprivate拒否は維持する。

### 2026-11-02: 開始同意中のcache変化を再確認する

既存のCacheStorage keysとStorageManager estimateを開始ボタンでも呼び、既知の取得量が増加、既知から不明へ変化、または既知の空き容量不足になった場合は更新値を表示して開始しない。取得量増加・不明化は次の明示クリックで再同意する。既存epochとintent所有者で戻る/設定変更後の遅延応答を無効化する。API確認は[Service Workers CacheStorage](https://w3c.github.io/ServiceWorker/#cache-storage)と[Storage Standard](https://storage.spec.whatwg.org/#storage-pressure)。inspectはsnapshotでありlockではないため、直後のevictionや内容検証で破損が判明する場合を防げない。今回使うモデル資源全量の再取得可能性も同意画面に表示する。新cache engine/永続化権限/全tab lock/ML依存は追加しない。別tab実操作・本番配信・実推論はこのDOM検証では未受入。

2026-11-02追検証: actual loopback HTTPの同origin実2tabでconfig31byte削除→開始再確認で0→1MiB/再同意待ちを確認。model HTTP要求0、trace events/results0、config復元後0MiB。検証serverの既存suffix MIME表にCSS/SVG/PNG/JPEGを追加し、nosniff下のstyle/image拒否を修正。表示中画像とCSS適用を確認。非表示lazy画像のdecode完了を要求したharnessは停止・修正、旧失敗を保持。一般UX/同時推論/cache eviction/公開配信の受入ではない。証拠: validation/2026-11-02-two-tab-consent-real-http.json。

### 2026-11-02: offline開始の実失敗から接続案内を補う

保存済みモデルの取得量0MiBでも、新規model Workerのno-store scriptは接続が必要だった。実Chrome offline開始は写真/設定とidle gateを保持して失敗し、接続復帰後の同browser再実行から白背景/crop/A4 PNG/PDFまで完遂。ブラウザWorkerの汎用errorを通信障害と断定する新分類は追加せず、既存generic失敗文に「実行用プログラムの取得に接続が必要な場合があります。接続と端末情報を確認」を追加する。既存依存/API・終了/再試行経路を使い、新cache/service worker/ML実装は追加しない。完全offlineの実現や受入ではない。実推論receiptは修正前source53f83c9cの固定artifactであり、文言変更後は関連DOMテスト/新build/実offline案内を別に検証する。

### 2026-11-02: runtime変更をlocal commitへ固定できるbuild guard

前景色/Pillow buildはHEAD=upstreamかつdirty1fileを前提とし、差分をcommitすると拒否していた。既存Git ancestry/diff APIで固定baseが祖先か、base→worktreeの変更がbrk.cのみかを検証し、従来の全runtime/変更brk/compile binary SHA照合は維持。receiptは実HEADとbase差分SHAを記録する。新依存/compiler改変は追加しない。独立local cloneのreview commitbf65717a...から2WASM全byte一致、余分なLICENSE変更はoutput前拒否しcleanへ復元、従来dirty forkも同byteでbuild。remote publish/tag/releaseや全権利承認とは別。証拠: validation/2026-11-02-committed-runtime-fork-builds.json。

### 2026-11-02: 選択Worker内の依存を既存source map APIで追跡

公開済みesbuild APIのexternal sourcemapと既存dev依存@jridgewell/trace-mapping0.3.31のTraceMap/eachMappingを利用し、自前VLQ decoderや新依存を作らない（[esbuild](https://esbuild.github.io/api/#sourcemap)、[trace-mapping](https://github.com/jridgewell/trace-mapping)）。model prepare builderへ任意の末尾--review-source-mapを追加し、map/metafileをprivate outputへ保存。通常出力はmapなし、既存/通常/review3Worker全byte一致。transformers.web.jsの固定SHAと埋込package境界を照合しtokenizers0.2.0/jinja0.5.10のmapping残存と固定表示を対応付けた。ORTは元配布物のsource map経由。mapping数はbyte数や完全適用性auditではない。unknown flagはoutput前拒否。

これは親Worker1variantのsource attributionのみで、stage Worker/他variant/embedded WASM/全copyright/配布許諾完了ではない。mapはsource/policyを含む非公開監査用で配布しない。証拠: validation/2026-11-02-selected-worker-source-attribution.json。

2026-11-02追記: stage builderにも末尾--review-source-mapを追加しworkerだけexternal map/metafileを生成（pageはmapなし）。max4 stage Workerは通常/review/既存SHA7be2f30e...全byte一致、model weight read0。選択parentとstageの5vendor分類mapping数は一致し、固定library表示との対応を確認。map/metafileはmountしない。不正flag出力前拒否/構文/関連14test pass。既存esbuild/trace-mappingのみで新依存なし、full license applicabilityや他variant受入とは別。証拠: validation/2026-11-02-selected-stage-worker-source-attribution.json。

### 2026-11-02: 既存NOTICE経路へintegration差分を明示

Transformers4.3.2 metadataのORT dev指定と、実際の固定ORT1.31.1 alias/生成Workerの差を既存runtime-notices/NOTICE.txtへ記録。独自metadata形式や配布機構を作らず、既存notice readerのsafe filename規則へ正確なNOTICE.txtのみ追加許可し、固定bytes/SHA照合を維持。parent/stage両buildへ収録し本体aggregateでは同一contentを1回へまとめる。両実行Workerと既存model/runtime資源は同一、NOTICE破損はoutput前拒否。現UI7aed13cbの新private208mountは全byte stream review＋別verifyでartifact4d5a7422...へ固定した。旧native UI f8cdf5d3の実推論証拠はそのまま保持し、新候補のnative受入と混同しない。証拠: validation/2026-11-02-worker-integration-change-record.json。

### 2026-11-02: 極端な縦長前処理のPillow順序を明示候補で再利用

独立Pillow12.2 matrix16件中2件（2×2048/13×2000 downscale）でlegacy/source-rebuilt両方に最大1階調差を確認。[固定Pillow Image.resize実装](https://raw.githubusercontent.com/python-pillow/Pillow/12.2.0/src/PIL/Image.py)のheight>width*100のvertical-first処理へ対応する既存crop wrapper経路をbilinearにも使う。新filter/kernelを作らず、--bilinear --model-tall-orderの明示build optionで既存経路を有効にする。

修正WASM SHAff144be7...は独立16件/保存済みPillow12.3参照8件に全byte一致。通常2素材→2048²も旧版と同byte。初期の共有C変更でcrop binaryにも差が出たため明示macroに分け、default crop SHA4ac73b5a...を維持した。builderは旧SHAとこの固定候補だけ許可、未知WASM/不正flagは出力前拒否。MODNet private CPU Worker/mainの通常HTTP→PNGは既存f84c91b4...と同byte、browser/server終了。HR/Matte既定Workerや公開構成は置換せず、native受入は後続。証拠: validation/2026-11-02-bilinear-tall-order-browser-candidate.json。

2026-11-02追記: 明示候補をHR/Matte親Workerにも接続し、既存build/byte review APIのみで208mountの新private本体を固定。model Worker以外のruntimeConfigと他Worker/notice内容は同一、artifact79d02466...。新HR実推論/公開採用とは分離する。証拠: validation/2026-11-02-hr-matte-tall-order-private-build.json。

2026-11-02追記: 明示bilinearと現host/builderをsource candidate02に収録。既存Git/tar/標準SHA API、保存済みsource-bootstrap compilerを使い3種WASMの再build全byte一致とarchive全宣言fileのSHAを確認。新依存/独自配布機構は追加せず、同hostのcompiler再利用・private候補と限定する。証拠: validation/2026-11-02-three-processor-source-rebuilds.json。

### 2026-11-02: 選択ORT binaryの公式package来歴を分離して確認

固定onnxruntime-web1.31.1のlive npm metadataと公開署名鍵を保存し、標準Node cryptoでname@version:integrityのECDSA署名2件を検証。保存tgzのSHA512 SRI/SHA1が署名対象metadataと一致し、選択asyncify mjs/WASMとWorker生成用webgpu bundle入力がarchive memberと全byte一致。npm archiveにLICENSE/ThirdPartyNotices文書は含まれないため、binaryと同梱された資料とは扱わない。既存sources.jsonのupstream v1.31.1タグ2文書を再取得して固定SHA、実mount、既存フッターaggregate全文収録と照合した。

Python標準tarfile/hashlib/urllibとNode cryptoを使い、新依存/独自署名形式/ビルドは追加しない。最初の一括照合はarchive内LICENSE.txt不存在で停止し、binary archiveと別取得文書の来歴を分けた検証へ訂正。公式配布binaryの来歴証拠であり、sourceからの再build、全linked dependencyの適用性、公開許諾完了の証拠ではない。鍵の信頼元はlive HTTPS npm registryで、独立鍵provenanceの検証ではない。証拠: validation/2026-11-02-ort-official-package-provenance.json。

### 2026-11-02: 実browser zoomを公式tabs APIで検証

CSS transformやDPRだけの擬似拡大ではなく、Chrome tabs.setZoom/getZoomをprivate disposable extensionから呼び、実200%/400%とCSS viewport変化を照合。Playwright公式persistent Chromium extension経路と標準CDP Accessibility/Page.captureScreenshotを再利用し、新npm依存や製品用extensionは追加しない。headlessのdefault surface screenshotはblankだったため受入に使わず、2animation frame後のfromSurface=false viewport画像を確認。native dialogのscroll/focus/AX treeはpassだが、読み上げ実音声と人の使いやすさは別。証拠: validation/2026-11-02-native-dialog-actual-browser-zoom.json。

### 2026-11-02: 診断previewの高さを表示領域へ合わせる

Chrome実400%ではCSS viewport320×180に対し診断preのmax-height16remが256pxで、native focus scroll後も欄全体がviewport外へ出た。既存CSSのmin()/svhでmax-height:min(16rem,50svh)とし、独自scroll/focus trapや新依存は追加しない。修正後は90pxで表示内へ収まり、200%/400%の写真置換取消/診断保存/焦点復帰と400%のcrop→L判PNG/PDFを実HTTPで完遂。54関連test/型検査/build、独立画像/PDF照合pass。新sourcef586a94d/静的16、旧HR受入や旧source全回帰とは分離する。証拠: validation/2026-11-02-diagnostic-preview-zoom-and-manual-save-chain.json。

### 2026-11-02: Aiartyを参考にした軽量抽出＋境界補正の比較

利用者指定Aiartyの公式FAQはCNN2系/Swin2系、guideは4refinement/DirectML-CoreMLを記載するが、具体的OSS重みの派生やGuided Filter/ONNX/TensorRT/tilingの内部採用は確認できない。用途別処理と境界補正の考え方を参考にし、内部再現とは扱わない。EdgeSAM系はprompted maskで自動image→alpha条件とは別、量子化file容量をRAM/VRAM保証へ転用しない。

既存Kornia0.8.3 guided_blur（Apache-2.0、既存torch/NumPy/Pillow）をCPU1coreで再利用し、新依存/kernel/モデル実行なしで2保存MODNet alphaへkernel17/eps1e-3/subsample2を適用。全面とsoftalpha帯のみ適用を比較し、後者はalpha0/255を保持。filter本体0.615/0.294秒、process最大RSS956,682,240byte（torch等込み、追加常駐量ではない）。白/暗背景3ROIの共通sourceRGB図では輪郭の小差はあるがHR級細い髪の復元を証明せず、暗背景のhaloも残る。GT誤差や速度/品質両立の達成とはしない。

PP-MattingV2公式source/configをPaddleSeg固定3c4db66de1d9d59d0628ed87590b6308a2f4aa2aで保存、画像→alphaのinference contractを確認。次比較は軽量自動モデル＋必要なら学習済み局所補正。重み/ONNX/ブラウザop/全体quality/resourceを別途受入する。現browser OpenCVはximgprocなしでKornia候補を直接公開経路へ追加しない。証拠: validation/2026-11-02-lightweight-guided-refinement-and-aiarty-review.json。

### 2026-11-02: YOLO26/Rust-WASM/MobileSAMと軽量mattingの役割を確認

利用者指定YOLO26/Ultralytics Inference/MobileSAM/公式matting glossaryを確認。公式YOLO26n-seg ONNX v8.4.0は11,218,582byte/SHA711e0ef8...でrelease digest一致、opset20/full checker pass、入力1×3×640²、出力1×300×38＋1×32×160²。公式Rust inference固定15480a2...と@ultralytics/yolo0.0.55を保存、npm SHA512 SRI一致。Rust前後処理をWASM化しORT Web/ort-webまたはLiteRTへ渡す既存経路があり、自前YOLO decodeやRust compiler導入を既定にしない。app依存/公開runtimeは未変更。

公式matting glossaryはYOLO mask→別matting補正を明記。Results.masksは描画RGBA overlayでそのalphaをmatteへ流用しない。MobileSAM公式auto_annotateのYOLO box自動promptなら人の選択不要。ただしUltralytics PythonのMobileSAMはexport非対応表示、YOLO専用Rust loaderでSAMが動くとは扱わず別契約。最初はYOLO26n-seg→補正、追加比較でYOLO検出→MobileSAM→補正。余分なstageの全体コストとhair/透明内部/複数人物選択を測る。self-host固定asset、silent CPU fallback禁止の既存方針、AGPL/モデル条件を維持する。

PP-MattingV2はcommunity固定95efde2...35.7MB graphをGit blob照合/全ONNX検証し、既存ORT CPU1coreで2画像/2正規化を実行（推論各約3秒、session約0.125秒）。cv2不在のためPillow bilinearを再利用した予備評価で、正規化/resize/公式重み対応未受入。表示した2人目では細髪はHR+Matteより柔らかく見えるが、公式PP品質の一般順位へ転用しない。新Paddle/Ultralytics install/自作kernel/公開なし。証拠: validation/2026-11-02-ppmatting-yolo26-rust-mobile-sam-candidates.json。

### 2026-11-02: 公式YOLO26 Rust/WASMをself-host CPUで実行

@ultralytics/yolo0.0.55の配布JS/WASMを改変せず利用。既存GET-only allowlisted HTTP server/CSP/Chromium/4GiB資源監視を再利用し、device:cpuとortBaseUrlで既存公式ORT1.31.1をself-host。default ORT1.30 CDNへの依存は起動optionで置換し、全mount実byte SHA/同origin GETを確認。CPU1thread、GPU adapter request0、2合成画像で人物1名ずつ自動検出→overlay PNG保存、browser/server終了。新decoder/kernel/production依存/独自Rust buildなし。

単独初回model load1.1895秒、推論0.6314/0.3714秒。次の組合せでは既存no-eval OpenCV Workerと固定radius trimap adapterをそのまま使い、overlay alpha0/140を実opacityでなくbinary membershipとして入力、2trimap PNG保存。推論0.6043/0.4023秒、trimap0.471/0.8296秒、表示/download準備込み各約1.60/1.67秒、model load別1.1055秒。最大観測Private593,281,024/RSS1,260,896,256byte（Linux複数process合算）。速度は学習済みmattingを含まない。

unknown面積は4.87%/3.32%だが、HR alpha>8が確定BGへ18,359/9,122px、HR alpha<247が確定FGへ14,109/26,095px入り、狭い固定bandのままでは既存HR細髪/透明域を補正できないことを確認。HRはGTではない。次はband幅/context/半透明内部と学習済み補正のwholeコストを比較。unknown比率を計算削減率へ転用しない。main統合/MobileSAM/実GPU/全品質/許諾は別。証拠: validation/2026-11-02-yolo26-rust-wasm-cpu-auto-trimap.json。

### 2026-11-02: YOLO粗maskの不確定帯と局所ViTMatteを比較

private Workerで既存OpenCV ellipse erodeのみ1/2/4/8回を使用。既存radius/threshold/borderを維持し、1回結果は元trimapと全pixel一致、拡大unknownの包含単調性を独立確認。8回のunknownは2素材32.91%/23.45%、既存HR alpha>8を確定BGにする画素は共に0へ減るが確定FGのHR<247差373/13pxは残る。HRはGTでなく、8回を一般既定にしない。新kernel/依存/本体変更なし。

YOLO由来trimap1/8回と元RGBから320×256髪patchをPillowで切り出し、固定公式VitMatteImageProcessorと既存FP32 ONNX（全model SHA再確認）をORT CPU1threadで実行。session約0.757秒、推論1.231/1.318秒、native最大RSS1,570,668,544byte（Python/torch含む）。広帯はこのpatchで細髪と自然な境界を残し、HR alphaとの平均差はhard15.85/狭12.89/広2.65階調だがGT誤差ではない。

同じ2入力tensorをブラウザの公式ORT1.31.1/WASM CPU1threadへ配信しraw保存、nativeとのraw最大差1.40e-6/2.03e-6、anchor復元alphaは狭全pixel一致/広2pixel各1階調差。全mount SHA/同origin GET/GPU要求0/browser-server終了、最大Private1.485GB/RSS2.132GB。低level harness phase名は前実験のRust表記だが本stageはdirect ORT。準備済みtensorの部品比較で、browser image processor統合や全画像stitchingは未受入。ViTMatte重み約397MBは維持され、局所化を重み小型化としない。次はpatch overlap/context/継ぎ目と総コスト、小型補正候補を比較。証拠: validation/2026-11-02-yolo-wide-trimap-local-matte-browser.json。

### 2026-11-02: 利用者指定FGF/MEMatte/ZIM・MicroMat/LoRA/RMBGを比較候補へ接続

MODNet低解像度float alpha512×672と実前処理RGB、原寸RGB1086×1448から、公式DeepGuidedFilterのFastGuidedFilter(lr_x,lr_y,hr_x)を再利用。guided-filter-pytorch3.7.5 wheel SHA2b63cd83...、固定upstream0caaf2d...の実装と全byte一致。Kornia灰度guide、r4/8・eps1e-3/1e-4の4候補はCPU1core22〜29ms（model/guide準備除く）。以前の原寸8bit alpha後がけとは別。元bilinear replayは現MODNet PNGと最大1階調、肩等は小改善を目視するがHR細髪互換/GT品質向上は未証明。root LICENSE未検出なので公開採用は保留、isolated wheel extractのみでapp依存を追加しない。

MEMatte公式3c887e2...source29fileをGit blob照合して保存。公式Drive公開metadata itemJson[25][2]はViTS DIM116,882,245byte、実用mix116,874,309byteで利用者約120MB見立てに対応（実checkpoint download/SHA未確認）。RGB+trimap/動的router/token capを確認し、bool index/torch.any/masked_scatter/itemを含むためONNX/WebGPU実証は別。既存変換ViTMatte-small-distinctions FP32103,885,865/quantized27,499,369byteも固定公開SHAで取得、未実行。

ZIM固定392e613...のREADME/LICENSE/NOTICEを保存。ZIMはCC-BY-NC4.0、MicroMat HF cardのCC-BY4.0とは別。MicroMat snapshot7e6a7ec...のdata_list3000行/237画像、image/matte/prompt全参照あり、segは2800参照が不存在。初期4種必須assertはここで停止したため、必要3種と欠けるoptional segを分けた候補splitを作成。画像group165/35/37、注釈2049/476/475で漏洩0。同画像別targetのため単純image-only教師競合を避け、自動coarse/trimap条件付きstudent案へ。LoRAは学習parameter/optimizer削減の案で、base縮小とはしない。学習/重い教師推論は未開始。

RMBG2.0公式metadata2fd7b4b...でFP32 ONNX1,024,331,469/INT8366,087,445/Q4F16233,815,293byteを確認。BiRefNet系/配布条件は別でgated重みは未取得、INT8数十MBやVRAM100MBを前提にしない。light candidateとしてMODNet+FGFを先に比較、MEMatte/小型Matteを品質候補、LoRA/蒸留はGTと条件付きtargetを整えてから。証拠: validation/2026-11-02-fgf-mematte-zim-lora-rmbg-candidates.json。

### 2026-11-02: 利用者指定でPythonの画質比較を先行

FGF browser exportよりnative精度/同条件時間を優先。既存Pillow/公式VitMatteImageProcessor/ORT1.31.1 CPU1threadを再利用しSmall FP32/quantizedの固定ONNX checker pass後、Baseと同tensorで比較。320×256ではBase約1.20〜1.32秒、Small FP32約0.50〜0.54秒、quant約0.47〜0.48秒。初回parentがONNXをload/checkした後のru_maxrssに継承floorがあったため、low-memory parent/別process＋/proc VmHWMで再計測し、比較に旧RSSを使わない。

候補heldoutから画素を見る前に完全4fileの最初の異なる2画像groupを選び、HF pinned revisionと公表ETag/SHAを既存Hub clientで照合取得（token=False/private local_dir）。元解像度の512²cropを既定bbox中心へ固定し、提供segmentation閾値127とPillow17px Min/Maxでtrimap生成、同入力で3モデルを実行。annotation targetは馬（乗り手除く）/部分的な髪で、全人物自動切り抜きとは別。GT未知帯MAE（0〜255）Base17.43/15.77、Small FP3216.27/15.58、quant15.30/16.65。速度Base4.05/4.13秒、Small1.84/1.56秒、quant1.81/1.92秒。VmHWM Base1.183GB/Small0.634GB/quant0.728GB。量子化のsize削減を速度/実memory単調改善としない。

未使用testをmodel選択へ混ぜないため、参照した2image group全28注釈を除外した新reserve35画像447注釈を保存。元pilot splitは履歴保持、学習/微調整なし。この2probeの結果を一般順位/元MicroMat3K全benchmarkへ転用せず、PythonでFGF/MEMatte等の候補比較を続ける。source/public app不変。証拠: validation/2026-11-02-python-small-matte-alpha-gt-comparison.json。


### 2026-11-02: MEMatteのPython実測と公式checkpoint同一性を確認

既存BeeeFX/ComfyUI-MEMatteの固定revision 2e100eebe3595c199dc631f5146fa67ec543fb2fを無改変で使用し、detectron2の新規buildを避けた。weights_only=True/strict state_dictで29,191,293parameterをロード。公式Driveの116,874,309byteをstream hashし、取得ミラーのSHA256 538cf871933dd0663a6bc28a4bec9b870cc2de909c7431b857b72ce427e82a09と全byte一致。公式実装との数学的等価性・全配布条件の承認は別途未完。

既に開いたMicroMat GT付き512²の2領域でCPU1core推論1.959/1.731秒、未知帯MAE21.374/15.188（255段階）。Small FP32の16.272/15.578に対して優劣が分かれ、一般順位や採用根拠にしない。process VmHWM1,040,453,632byte。未使用holdout35画像447注釈には触れていない。

同じ既存実装で合成人物1086×1448＋既存YOLO自動trimap帯8を処理。token cap2048/既存patch decoderを使用し、推論18.635秒、VmHWM1,343,635,456byte。4GiB RSS/3GiB reserve/120秒guard内で正常終了。MODNet/FGF/MEMatte/HR＋Matteの白・黒背景比較を保存したが、合成画像のためGT画質評価ではない。raw reportに旧512crop文脈と公式byte未確認の記述が残る点を新receiptで訂正し、元記録は保存。PyTorch対ORTの速度・メモリはframework差を含む。

証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-python-native-comparison.json`。実装候補のnative評価までで、学習・browser移植・本体採用・公開なし。次は開封済みdevelopment画像で比較対象を揃え、未使用holdoutを温存して候補を絞る。HR現本体の端末/最大形状、代表品質、配布条件、Pages/R2、人のUXと実印刷の受入は継続。


### 2026-11-02: Small FP32をMEMatteと同じ原寸人物・自動trimapで比較

固定Small ONNX SHAa1cf4823…/ORT1.31.1 CPU1coreで1086×1448の同じRGB・YOLO帯8trimapを公式VitMatte processor（resizeなし、pad1472×1088）へ渡した。推論15.335秒/session準備0.435秒、process VmHWM3,521,331,200byte。4GiB RSS/3GiB reserve/120秒guard内で正常終了。MEMatte18.635秒/1.344GBとの比較はcheckpoint・framework・token capの差を含む。512²cropでの軽量性から原寸peakを推定しない。

MODNet/Small/MEMatte/HR＋Matteの同じ髪・眼鏡・肩領域の白黒背景比較を保存。合成画像には正解alphaがなくHR差を精度としない。本体source/依存/defaultは変更せず、browser移植・配布採用は未完。証拠: `image-studio/docs/browser/validation/2026-11-02-small-full-portrait-python.json`。


### 2026-11-02: Small量子化版の原寸CPU比較

固定量子化ONNX27.5MBを同じORT1.31.1/CPU1core/入力tensor SHA8beadff8…で実行。推論16.415秒、VmHWM3,268,993,024byteでguard内正常終了。通常Small15.335秒/3,521,331,200byteに対し今回単発では速くならずpeak約7%減。checkpoint容量約74%減をactivation削減と混同しない。量子化で細髪周囲のalphaが変化し白黒比較PNGを保存。合成1画像・GTなしのため一般精度順位にしない。追加差分要約はRGB trimapをLへ変換し忘れ計算前に停止、推論や保存画像には影響なし。証拠: `image-studio/docs/browser/validation/2026-11-02-small-quant-full-portrait-python.json`。通常Small/MEMatteを比較候補として残し量子化採用は保留。


### 2026-11-02: 横長2000×1000でSmallの資源停止とMEMatteの完走を確認

既存第二合成素材＋YOLO帯8自動trimapの原寸比較。Small FP32/ORT CPU1coreはRSS観測4,312,285,184byteで既存4GiB監視が12.07秒時点に自分のchildだけSIGTERM、exit-15。結果alphaなし、OS OOMやモデル破損ではなく受入資源内の未完走。上限変更・低解像度再試行なし。

同条件MEMatte token cap2048/既存patch decoderは推論16.232秒、VmHWM1,298,198,528byte、監視20.60秒/stopなしで完走。元RGB維持の白黒比較と髪patchを保存、確定FG/BG保持を確認。HR参照はGTでなく一般品質は未証明。未使用holdoutを開かず、学習/browser採用/公開なし。Small原寸高解像度候補には資源課題があるため、native画質比較はMEMatteを優先し、Smallは未受入として残す。証拠: `image-studio/docs/browser/validation/2026-11-02-landscape-small-mematte-python.json`。


### 2026-11-02: MEMatte既定18500tokenと2048制限の画質・負荷比較

公式固定source inference.pyの既定18500/patch_decoder=Trueを再確認し、同一原寸RGB/YOLO trimap・同一checkpoint/community実装でmax_number_tokenだけ変更。CPU1core推論25.728秒、VmHWM1,374,765,056byte、既存guard内完走。2048時18.635秒との差は単発host負荷差を含む。未知帯alphaの平均差0.253/255、最大179/255で設定が出力へ影響することを確認。白黒髪/眼鏡/肩比較を保存、FG/BG anchors保持。合成1画像にGTなしのため既定が高精度とも制限版が劣るとも断定しない。既定設定も同じ資源枠で実行可能という証拠を追加したが、community数学的等価性、一般品質、browser移植/本体採用は未完。証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-default-token-python.json`。


### 2026-11-02: MEMatte既定設定で最大2000×2000のnative完走

既存許諾済みA06 dimension fixtureの原寸RGBと保存済みHR由来自動trimapを使用。18500token/既存patch decoder/CPU1coreで推論42.701秒、VmHWM2,437,840,896byte、既存4GiB RSS/3GiB reserve/120秒内で正常終了。alpha/透過PNG・白黒参照比較を保存し確定FG/BG保持を確認。新たなYOLO粗抽出は含まず、既存合成sceneを寸法変更したfixtureなので独立写真の画質caseとは数えない。CPU候補の最大寸法を確認したが、本体HR最大形状のadmission/端末gateは未完のまま。community数学的等価性/browser export/一般品質/採用は別。証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-square2000-python.json`。


### 2026-11-02: MEMatte公式Attention.forwardを直接参照して部分校正

固定公式sourceのAttention.forwardをASTから無改変で取り出して実行（依存全体のbuild/独自演算への書換えなし）。同じcommunity Attention instance/seeded FP32 weights/inputでgrid/selected-token、policy有無、relative-position有無の6caseを比較し最大差0/全finite。公式constructorやhelper globalsはcommunity側を共有しており、policy softmaxの公式body・router/decoder/compat layer・全model数学的等価性までは証明しない。sourceとmethod AST SHA、script/結果SHAを記録。これは採用やbrowser exportの承認ではない。証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-official-attention-reference.json`。次はrouter/decoderと前処理の照合を進める。


### 2026-11-02: MEMatte router一致と片軸padding差を実確認

公式ViT.forwardを無改変ASTで実行し、開封済みGT2crop×token cap18500/32の4条件でcommunity実装と比較。特徴量・router score最大差0、選択token完全一致、cap発動経路も確認。constructor/helper/blockは共有のため全model等価性ではない。

公式preprocess_inputsも直接実行。512×512と513×515では全tensor一致。一方512×513はcommunity512×544/公式544×544、513×512はcommunity544×512/公式544×544となる。公式は片軸だけ32非整除の場合も両軸へpaddingを加えるため、communityの各軸独立paddingと異なる。共通範囲の値は一致。過去portrait/landscape/square2000は両軸非整除、512cropは両軸整除なのでこの条件差に該当しないが、任意寸法の公式一致を主張しない。source修正/独自fork/exportは行わず差を受入残件へ記録。証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-official-router-preprocess.json`。


### 2026-11-02: MEMatte decoder/patch一致とpadding出力差を実測

固定公式Detail_Capture.forwardとMEMatte.patch_inferenceを無改変ASTで参照実行。同じcommunity submodule/weights/featuresで開封済み2crop×幅512/511の4条件ともraw出力完全一致。公式constructor/submoduleまでは独立化しておらず全model等価性を意味しない。

幅511/高さ512では公式preprocess544×512、community512×512となり、同じcheckpoint/backbone/decoderへ渡した最終alpha（確定FG/BG復元後）も変化。case1最大63階調/5784画素、case2最大13階調/3830画素の差。512²では差0。これは単なるshape表記差ではなく出力へ影響するため、browser移植/採用前に元公式互換かcommunity契約かを明示し、無断で同一扱いしない。公式/候補sourceは修正なし。未使用holdoutに触れず、計算30.57秒/既存guard正常終了。GT併記の比較PNGを保存、今回の部分比較で優劣や一般精度を断定しない。証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-official-decoder-padding.json`。


### 2026-11-02: 既存Hypnos ONNX変換経路の固定取得・設計テスト通過

samhodge-tokgan/Hypnos revision76736c10cef2d5b5b7ccca4a14e148f5779a6a66のexport/routing/shape test/条件文書8fileをGit blob SHAで取得。既存2testを無改変でCPU1core・元guard内実行し両方all checks passed/SKIPなし。生成4小型ONNXもfull checker合格。runtime token capのtopk/gather/attention/scatterと可変resolutionの既存実装を再利用できる候補経路を得た。6shapeのPyTorch/ORT差は最大9.18e-6、routingも未trace cap/Nを確認。

ただし小型合成module/transcribed参照の検査であり実checkpoint全modelの変換ではない。実export loaderはdetectron2・weights_only=False/strict=Falseを前提とするためまだ実行せず、前述の公式padding差や元実装等価性、browser operator/provider対応も別gate。新dependency/build/source改変/公開なし。次は既存exportを実モデルへ適用する構築条件を整え、forkが必要なら親規則どおり差分管理し、PyTorch全出力一致を確認してからbrowserへ進む。証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-existing-onnx-export-review.json`。


### 2026-11-02: 実MEMatte重みから既存APIでONNX2分割を生成・native比較

無改変Hypnos BackboneWrapper/make_vit_forward/DecoderWrapperを既存community modelへ適用。torch.load weights_only=True/strict state_dict維持、detectron2 build/新dependencyなし。communityに存在しないconvnextを使わないことを検査し、Hypnosが読むuse_convnext_block=False属性のみharnessで宣言（全12block、演算source変更なし）。公式の元実装への無断patchや独自routing実装なし。

128²/cap32でtraceしたopset17のbackbone/decoderをfull checker。128²/32、256×320/128、512²/18500を同じ2graphで実ORT1.31.1 CPU1thread推論。元community PyTorchからのalpha最大差は2.44e-5/2.41e-5/6.19e-5、全finite。routing書換え自体のfeature差は最大7.63e-6。process VmHWM1.681GB/guard正常終了。実checkpointの変換経路が得られたが、公式detectron2 constructor等価性、混合片軸padding契約、原寸・512tile decoder/boundary、他画像/browser provider/配布は未受入。新本体採用/公開なし。証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-real-onnx-export.json`。


### 2026-11-02: MEMatte実ONNXを実Chrome/WASM CPUで初回完走

既存allowlist HTTP server/ORT Web1.31.1/Chrome153/明示WASM1threadで生成backbone＋decoderを読み込み、既存GTcase1の512²・cap18500を実行しraw alpha保存。native-prepared入力tensorを使用。model load5.778秒、backbone4.313秒/decoder1.666秒。native ORTとのraw最大差8.14e-06、平均4.92e-08、全finite、確定FG/BG復元PNGを保存。GPU adapter要求0/全通信same-origin GET（favicon404は推論と無関係）、既存4GiB/120秒guard内、private最大720,097,280byte/RSS1,367,298,048byte。browser/server終了済み。

Pythonでの生成だけでなくブラウザ実行可能性の証拠を得たが、browser前処理・自動全体pipeline・原寸tile・WebGPU・一般画質/配布採用は未完。新本体依存や公開なし。証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-browser-cpu-parity.json`。


### 2026-11-02: browser PNG読込→既存前処理ONNX→MEMatte alphaを接続

標準createImageBitmap（colorSpaceConversion none/premultiply none）/OffscreenCanvasで既存GTcase1 RGB/trimap PNGをbrowser内decode。既存community preprocess_inputsをTorch公式Cast/Transpose/Div等wrapperから固定512²のONNX1868byteへexportし、自前画像kernelを追加せずWASM CPUで正規化。元前処理method/sourceは無改変、モデル重みは前処理graphに含まれない。固定shape graphのため任意寸法padding対応を含意しない。

実Chrome/通常allowlist HTTP/ORT1.31.1でPNGからalphaまで完走。browser保存normalized inputと以前のTorch入力最大差0、native alpha最大差8.14e-06。private最大701,296,640byte/RSS1,355,264,000byte、GPU要求0/browser-server終了。画像source/normalized input/alpha/前処理graphとscriptをSHA束縛。target trimapは教師注釈由来、色profile/EXIF/透過写真・任意寸法/自動粗抽出・本体統合・公開は未受入。証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-browser-png-preprocess.json`。


### 2026-11-02: 可変PNG寸法の前処理ONNXとbrowser3shape校正

既存community preprocess_inputsを513×515でtraceし、公式Torch dynamic_axesで同一ONNXのshape計算を保持（sourceは変更なし）。同じgraph/同じbrowser sessionで512²、512×511、513×515のPNG decode→normalize/pad→MEMatte backbone→direct decoderを完走。community各軸独立padding契約を明示し、元公式の片軸追加padと同一とは扱わない。診断token cap128、寸法fixtureは既存開封済みcase1のcrop/黒padで品質caseを増やさない。

全3条件で保存normalized inputがTorchと1e-6未満、alphaがnative ORTと1e-4未満を確認しraw/SHA保存。browser既存4GiB/120秒guard内、private最大806,125,568byte/RSS1,459,560,448byte、GPU要求0/全通信same-origin GET/browser-server終了。native参照準備はcontinuous watcher外と区別。任意全寸法・原寸512tile/継ぎ目・自動粗抽出・中止/復旧・本体採用/公開は未完。証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-browser-dynamic-png.json`。


### 2026-11-02: 原寸MEMatte ONNX既定capは120秒枠で未完了

1086×1448/正規化pad1472×1088/cap18500の生成backbone→既存patch_inference＋ORT decoder adapterを計画し、native CPU1coreの同一枠で実行。120.53秒でwatcherが自分のchildをSIGTERM、exit-15/time-budget-exceeded。RSS観測最大4,133,523,456byte（4GiB未満）、raw/alpha/reportなし。backbone完了時刻も未採取のためtile開始まで進んだとはしない。原寸ONNX・seam比較は未達、OS OOMとは扱わない。

固定Hypnos export_routingはk=min(cap,N)のtopkで余分なtokenもgatherしmaskで除く。今回N=92×68=6256/cap18500なので全global blockで6256² attentionとなる一方、既存PyTorch routerは14/2717/2514/0を選択。これは原寸計算増大のsource上の原因候補で、profilerによる因果断定はしない。小さいcropの数値一致を原寸実用性へ外挿しない。上限拡大/同設定再試行/browser実行なし。次は既知の2048制限設定を同じreferenceと明示比較するか、元semanticsを保つ既存動的選択数exportを確認し、既定原寸browserは保留。証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-onnx-full-default-timeout.json`。


### 2026-11-02: cap2048の原寸ONNX＋既存9tile処理をPyTorch校正

既定18500のtimeoutを再実行せず、既に評価済み2048設定へ明示変更し同じ1086×1448原寸で比較。生成backbone ONNXをORT1.31.1 CPU1core、既存無改変community patch_inferenceへORT decoder adapterを接続（512px/64overlap/9tile）。backbone13.899秒、decoder tile11.003秒、process VmHWM2,027,581,440byte、元guard内32.63秒で正常終了。

同じcap2048 PyTorch保存rawとの差は最大3.17e-5/平均2.38e-8、最終alphaは2画素各1階調差。512境界±2px帯のraw最大1.73e-6、alpha差0を確認。これは数値parityでありGT画質や一般的seamlessness判定ではない。比較白黒PNG/SHAを保存。cap2048は既定18500と品質が変わるため、既定版の受入成功に置換しない。browser原寸tile・main統合・公式全実装互換/一般品質/公開条件は残す。証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-onnx-cap2048-full-parity.json`。


### 2026-11-02: browser原寸9tile診断は120秒停止、最終実行段階は未採取

標準ONNX Pad/Slice graph（公式onnx.helper/opset17/full checker）と標準TypedArray.set行copyで既存512px/64haloのtile配置をprivate harnessへ記述。独自画像kernel/上流source変更なし。最初はpublic側RGB sourceがprivate root外としてserver allowlistで拒否、model開始0。失敗manifest/reportを保存し、同一PNGをprivateへcopyして正規経路を再開、allowlist条件変更なし。

実Chrome/ORT Web1.31.1/CPU1thread/cap2048はoperation-time-budget-exceededで120秒停止。private観測最大909,381,632byte/RSS1,572,040,704byte、資源枠超過ではない。途中観測はbackbone取得までだったが、最終requestにはdecoder/pad/sliceとRGB/trimap PNGも含まれた。pageの順序から全5session create完了までは証明できる。前処理完了・backbone run完了・tile開始/完了の段階は未採取。runner modelStarts1は診断scheduled開始の数で、実推論開始の証拠に使わない。raw/alpha未生成、browser/server終了済み。native完走結果をbrowser受入へ代用せず、今回のtimeoutを原寸計算負荷の証拠とも断定しない。host競合/段階profile未測定。上限拡大/同設定の繰返しなし。次はsession load/PNG decode/preprocess/backbone/tileの段階観測を追加して切り分け、全体120秒枠を維持する。証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-browser-full-tile-timeout.json`。


### 2026-11-02: 段階観測でbrowser timeoutをbackbone session作成中へ限定

前回原寸browser未完了を盲目的に再実行せず、consoleのstage時刻を即時reportへ保存する観測を追加。同じmodel/PNG/runtime/WASM1thread/cap2048/4GiB/120秒枠を維持。前処理session createは41.277秒、次のbackbone session-start後、session-end前に120秒stop。PNG decode/preprocess/model.run/tile開始のstageなし。browser/server終了、private最大582,111,232byte/RSS1,240,956,928byte。

今回の未完了箇所は原寸推論そのものではなくsession初期化段階と判明。前回は最終入力PNG取得まで進んでおり、異なるattemptのphaseを合成しない。過去512cropがmodel load数秒で完走した事実との速度差の原因は未確定（CPU/compile/IO profilerなし）。read-only process/load観測は取得したが因果関係は断定しない。途中JSON読取1回がconcurrent writeで失敗したが同じlive handleを維持し再読取、process再起動なし。追加同条件試行/上限拡大は行わない。次は最小のruntime/session起動を分離観測し、full-size inference gateとは別にload遅延を解消する。証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-browser-stage-timeout.json`。


### 2026-11-02: PNG→原寸MEMatte→9tile合成を実browserで完走

起動切分けで動作した標準fetch→ORT create(bytes)を、元と同じ重み/PNG/cap2048/ORT1.31.1/WASM CPU1thread/4GiB・120秒枠へ適用。全5session・PNG decode・可変前処理・backbone・標準ONNX Pad/Slice/512px64haloの9tile・TypedArray.set行copy合成まで実Chrome/通常allowlist HTTPで完走しrawをdownload。独自画像kernel/上流source修正/新app依存なし。単発のためfetch方式の因果的改善率は主張しない。

model load49.435秒、normalize/pad22.145秒、backbone15.528秒、9tile25.162秒、completed約114秒。private観測最大1,100,705,792byte/RSS1,758,982,144byte、GPU adapter要求0/全通信same-origin GET/browser-server終了。native cap2048 ONNXとのraw最大1.61e-5/平均2.76e-8、最終alphaは1画素1階調差、512境界±2px帯raw最大1.25e-6/alpha差0。白黒髪/眼鏡/肩比較を保存。

小画像に限定せず原寸CPU browserの1caseが成立したが、取得済みYOLO trimapを使い同run内の自動粗抽出は未接続。既定18500、他scene/最大寸法/一般品質、公式片軸padding互換、WebGPU、中止/復旧/解放の本体受入、配布条件/main統合は残る。前処理ONNXにはScatterND/Range/Expandがあり、原寸paddingの既存torch slice代入由来を次の性能調査対象とする（operator別profile未取得、原因断定なし）。証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-browser-full-tile-parity.json`。


### 2026-11-02: 前処理を標準Padへ置換し原寸browserの出力同一を確認

既存community normalizeをsize_divisibility=1設定でそのまま呼び、torch.nn.functional.padで各軸32倍数へ0埋めするwrapperをexport。上流source/正規化式/重みは無改変。ScatterND/Range/Expandによるslice代入graphを標準Pad1演算へ置換、ONNX6255byte/full checker合格。5寸法（512²/片軸非整除/両軸非整除/1086×1448/2000²）のrandom byte入力で元Torch出力と全tensor完全一致。native guard内、VmHWM1.372GB。

同じ原寸browser harnessのpage logicは全byte同一、前処理ONNXだけを差替。PNG→cap2048 backbone→9tile出力が前browser rawと全byte一致、native alphaとは1画素各1階調/境界帯差0。load4.315秒/前処理0.472秒/backbone16.660秒/tile22.318秒、private最大1,113,214,976byte/RSS1,765,294,080byte、GPU要求0/既存guard内/browser-server終了。前回前処理22.145秒との差は単発観測で一般改善率ではなく、load49.4→4.3秒の変動もPadの効果と断定しない。

原寸の前処理負荷を品質を変えず削減する候補を得た。新library/custom kernel/fork/source改変/上限拡大なし。公式片軸padding互換/他scene/自動粗抽出との接続/本体統合・中止復旧・配布条件は継続。証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-standard-pad-browser.json`。


### 2026-11-02: YOLO26→自動trimap→MEMatte原寸9tileの同一browser通し完了

保存済みtrimap入力を外し、既存公式@ultralytics/yolo0.0.55 Rust/WASM＋固定YOLO26n-segをCPUで同じ原寸PNGへ推論（person class/conf0.25）。1person conf0.963を自動検出。描画overlayのalpha有無だけをbinary supportとし、既存無改変OpenCV band workerでradius9/8erosionのtrimapを生成。manual point/boxなし。YOLO free/worker terminate後、既存標準Pad前処理＋cap2048 MEMatte backbone＋9tileを同一Chromeで実行。新kernel/library/上流source改変なし。

自動trimapは保存基準のpixelと完全一致、raw alphaも前browser結果と全byte一致。nativeとの差1画素1階調/境界帯差0を維持。coarse準備11.976秒（YOLO load/推論/worker含む、YOLO pure inference1.159秒）、MEMatte load2.664秒/preprocess0.265秒/backbone16.430秒/tile21.502秒。private最大1,304,813,568byte/RSS1,966,575,616byte、GPU要求0/通常allowlist HTTP全通信same-origin GET/元guard内/browser-server終了。

ブラウザが保存したのはtrimapとraw alpha、alpha PNG/比較PNGはlocal verifierで後生成。公開の保存UI統合とは扱わない。合成1人物だけのため複数人物・対象選択policy/GT画質/他shapeは未受入。YOLOライセンス/モデル条件とMEMatte配布承認も別gateで本体採用・公開なし。証拠: `image-studio/docs/browser/validation/2026-11-02-yolo-mematte-auto-browser-chain.json`。


### 2026-11-02: 自動抽出→browser透過PNG実downloadまで完了

前turnのYOLO26→OpenCV→MEMatte cap2048原寸9tileを維持し、既存alphaToUint8を無改変再利用してtrimapの確定FG/BGを復元。元RGBへalphaを付与し、既存bundleのexport Worker（fast-png8.0.0/現handler protocol）でPNG encode→実download。独自codec/画像kernel/新runtime依存は追加せず、export Workerも終端。foreground色推定を実施したとはしない。

実Chromeのcompleted約50.14秒、PNG encode約0.878秒。PNG2,964,621byte/SHA0a035bcf…/RGBA1086×1448/IHDR-IDAT-IEND/全CRC正常/DPIなし。Pillow独立decodeでRGB全pixelが元画像と一致（透明pixelも保持）、alphaは前verified browserと全一致。rawはnativeと最大1.61e-5/最終alpha1pixel1階調、境界帯差0。private最大1,309,241,344byte/RSS1,973,190,656byte、既存guard内/GPU要求0/browser-server終了。

小部品ではなく自動人物抽出から透過PNG保存までprivate通しが成立。公開本体のgate/中止復旧・crop/印刷引渡し・他scene/複数人物/一般画質・配布条件/公式全互換性は残し、通常版背景は準備中のまま。証拠: `image-studio/docs/browser/validation/2026-11-02-yolo-mematte-browser-png-save.json`。


### 2026-11-02: 利用者の髪の根元への品質指摘を受け、色補正を切分け

利用者「髪の根元の部分が…うまくいきません」を画質未受入項目として追加。PNG保存までの成功を品質合格と扱わない。直前の横長2000×1000でも自動抽出→8tile→PNG保存は完了、PyTorch raw最大3.04e-5/alpha40pixel各1階調差/境界帯差0、RGBA保存全RGB保持/CRC正常を確認（landscape-png.json）。初回verifierだけportrait trimap参照を残して停止し、元script保存・参照修正後の再検査で確認、推論は再実行していない。

髪の診断は元portrait/cap2048 alphaを固定し、既存前景色WASM569504ce…＋foregroundToRgbaを再利用。CPU1core約1.83秒/WASM約141MB/上限512MiB/Node heap192MiBで補正、alpha変更0/確定不透明RGB変更0。白/暗背景の同じ髪領域を比較したagent目視では、外周の細毛の白浮きは減ったが分け目/頭頂付近の白い塊は残る。色補正だけで解決したとはしない。次は同領域のalpha/trimapの確定領域・値を確認し、速度やモデル容量の検証より髪の品質を優先する。GTなしのため白さの全てを誤抽出とも断定しない。証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-hair-root-color-ablation.json`、`2026-11-02-yolo-mematte-landscape-png.json`。


### 2026-11-02: 髪の根元を元RGB/alpha/trimapで切分け

既に開封済み合成人物の頭頂ROI[550,200,670,320]を診断用に固定し、元RGB/MEMatte alpha/自動trimapを等倍nearest拡大で比較。全RGB>190の明るい6247pixel中、trimap unknown6246/確定FG1/確定BG0、alpha分位0/8/24/67/255。これはGTでない記述的subsetであり全brightを背景と決めつけないが、少なくとも多数が確定FGへ固定されたため補正不能という説明は当たらない。固定alpha前景色補正で根元が残る結果と合わせ、次はalpha推定/trimap contextの学習済み局所補正を比較する。

当該ROIはagent診断で、利用者にmanual点/boxを要求するproduct policyへ変更しない。局所の明るさ閾値で髪を機械的に消す修正は採用しない。既存PyMatting CFも候補として確認したが、保存packageはforeground subsetのみ/numba未導入なので新solver依存は追加していない。新model推論なし、一般品質・根元修復は未達。証拠: `image-studio/docs/browser/validation/2026-11-02-mematte-hair-root-alpha-trimap.json`。


### 2026-11-02: 同じ根元contextでViTMatte Base/Smallの局所補正を比較

診断box[416,96,800,480]の元384²RGB＋同じYOLO帯8trimapを固定し、公式VitMatte processor（resizeなし）と既存ORT1.31.1 CPU1coreでBase/Smallを直列実行。推論2.073/0.722秒、全finite/確定FG-BG保持。元MEMatte全画像alphaの同じcropも併記。未知帯contextはモデル間で異なるのでmodel全体の一般順位にはしない。元384²をmanual UXへ要求する変更なし。

alpha/白/暗背景比較をagent目視し、Base/Smallとも分け目の白い塊が残ることを確認。Baseでは一部透過の出方が変わるが修復成功とは扱わない。前回bright6247pixelのalpha中央値はMEMatte24/Base23/Small28（255段階）で、この記述値をGT精度とはしない。既存guard22.62秒/stopなし、process VmHWM1.505GB。モデルを小さく置換するだけで根元問題を解決する証拠は得られず、本体採用保留。次は同じROIで既存の画像色統計を利用するalpha solver等の条件を調べ、残留色とalphaを分離する。元背景と髪の輝度だけで機械的に髪を削除しない。証拠: `image-studio/docs/browser/validation/2026-11-02-hair-root-local-matte-comparison.json`。


### 2026-11-02: 利用者指摘どおり元HR＋ViTMatteは根元の白残りが大幅に少ない

利用者「ViTMatte上位をPyTorchでも同様か/SAM2Mattingは」「以前PyTorchではできていた、BiRefNet HR＋ViTMatteなら」を受け、元pipelineを優先再比較。保存済み同一1086×1448のHR＋ViTMatte出力（Windows browser、foreground補正あり）と今回YOLO＋MEMatteを元RGB固定/補正済RGBに分けて根元を表示。元HR経路では目立つ白い塊が大幅に抑えられ、前景色補正済みでは更に自然というagent目視結果。元sourceが違う写真という説明ではない。保存browserを新PyTorch全pipeline実行とは呼ばない。

さらに公式local checkpointのViTMatte Base96,686,561parameterを実PyTorch CPU1coreでロードし、同じ384²RGB・同じprocessor/modelのままYOLO/HR由来trimapだけ変更して推論（2.202/1.900秒、元guard内11.02秒/peakRSS約1.409GB）。YOLO由来では白い塊、HR由来では大幅に減る。YOLO入力は先のONNXとtensor SHA完全一致、raw最大差1.11e-5。少なくともこのcaseではruntime変換より粗抽出/trimapの差が大きく、先の局所モデル不成功を元HR経路にも共通する限界と一般化しない。診断比較の順序不足を訂正し、元HR品質を軽量候補の比較基準へ戻す。

SAM2Mattingは公式FudanCVL source revision73dd721d77b56749248aefe5e8824d7f61b9d13cのREADME/条件/requirements/image inference/buildをGit blob検証して保存。SAM2.1Tiny/Base+のmask-prompt経路を確認したが重み取得/推論は未実施で「同様」と断定しない。PyMatting solver依存の追加はまだ行わず、この比較を優先。次はSAM2Mattingも同じscene・自動粗maskで比較する。証拠: `image-studio/docs/browser/validation/2026-11-02-pytorch-base-hr-trimap-root-comparison.json`。


### 2026-11-02: trimap品質の指摘を同一根元ROIのラベル分布で確認

利用者「trimapが上手く作れてない？」に対し、同じ[550,200,670,320]でYOLOは背景0/unknown10811/前景3589、HRは背景258/unknown11236/前景2906を確認。全RGB>190の記述的6247pixelでもYOLO背景0/unknown6246/前景1、HR背景258/unknown5989/前景0。HRのunknownはむしろ多いため、単に帯を狭くする/unknownを減らす方針を結論にしない。実PyTorch同モデルの改善と合わせ、このcaseでは確定領域の位置・背景への手掛かりの品質が重要。元HR粗抽出を品質基準として保ち、YOLOの二値輪郭＋一律erosionで同等品質とみなさない。brightness thresholdは診断のみでproductへ導入しない。証拠: `image-studio/docs/browser/validation/2026-11-02-hr-yolo-trimap-root-labels.json`。


### 2026-11-02: SAM2Matting Tinyの公式PyTorch経路も実比較

公式固定source32fileを無改変で使用、公式HF revision4315db9…のTiny215,569,778byte/SHA5b9321e3…を公表LFS SHA照合。Hydra1.3.2/iopath0.1.10と解決依存だけprivate targetへ導入しmetadata/pip-report/全版hash付きrequirementsを保存。共有Torch/CUDA/TensorRTや本体依存は変更せず。公式build_sam2matting(device=cpu)+predictorを使用しweights_only=True/strict state_dict全一致、43,911,558parameter。

同じ1086×1448画像をencode33.452秒、保存YOLO binary maskでalpha42.928秒、保存HRalpha>=128 maskで24.937秒、encoder特徴を共有する逐次推論。監視107.95秒/peakRSS2,025,033,728byte/元4GiB・120秒枠内で正常終了。SAM2Mattingはtrimapでなく粗maskを使い、manual点/boxなし。

4方式の同じ根元/白暗背景をagent目視。YOLO＋SAM2MattingはMEMatteより白い塊が減る一方、細毛がぼけて太く見える。HRthreshold128＋SAM2Mattingは白残りが減るが飛び出す細毛を大きく失う。元HR＋ViTMatteと同等品質とはせず、SAM2Mattingも「同じ失敗」と一般化しない。HRsoftalphaを128二値化したprompt条件の影響もあり、SAM2Matting全variantの一般順位ではない。CPUfloat32/currentTorch2.12で、公式要求2.8/CUDA BF16やBase+の検査ではない。公開採用・配布なし。証拠: `image-studio/docs/browser/validation/2026-11-02-sam2matting-tiny-pytorch-root-comparison.json`。


### 2026-11-02: FeyNoBg/S3ODと利用者指定4appの実装を調査

FeyNoBg（ComfyUI-RMBG v3.3.0の追加node）/S3OD/removerized/imgly/background-removal-js/T8RIN/ImageToolbox/ducan-ne/remove-bgを利用者指定として確認。公式repo revisionと取得file Git blob/SHA、HF revision/公表重みmetadataをprivate保存。実推論結果や採用済みとしない。

FeyNoBgはBiRefNet/Swin-L第3stage24block、約263M/入力1024/重み1,051,353,168byte。feyninc公式model.safetensorsとComfy1038lab/FeyNobgのFeyNobg.safetensorsは公表LFS SHA7ee18138…が同じ（実download前のmetadata照合）。Comfy nodeには既定refine_foregroundでmask由来係数をRGBへ掛ける処理があるため、model raw alphaとnode補正込みを分けて比較する。作者説明ではS3OD4000枚を学習へ混合しalpha教師もbinary化、S-measureだけで髪の半透明品質を保証しない。

S3ODはデータセットだけでなくDINOv3-Base＋DPTの推論modelも提供。3mask/predictedIoUから選択、入力1024、公表checkpoint464,526,126byte。粗抽出→trimapの候補として単体alphaとHR＋ViTMatte入力の両方を比較対象へ。重みpickle loaderは既定weights_only=Falseなので、安全な既存Torch weights_only=Trueでの取得/strict構築経路を次に検討し、元sourceを無断改変しない。

RemoverizedはORMBG/ISNet/BiRefNet-lite/RMBG1.4/MODNetの複数精度ONNX＋WASM/IndexedDB。IMG.LYはISNet系fp32/fp16/quantized＋ORT Web。ducan-neはRMBG1.4＋Transformers.js/WebGPU。確認したmask出力経路は原寸へbilinear拡大し元RGBへ付与する構成で、根元専用のtrimap再推定や学習済みrepairがある証拠ではない。ImageToolboxはAndroid FOSS側ONNX/Market側MLKit、BiRefNetTiny（birefnet_swin_tiny.ort/1024）等のbackendを持つ。Androidの処理をbrowser完成と混同しない。

候補modelの画質/資源比較と、既存appのruntime/前後処理再利用を分けて進める。app自身MIT指定と依存/モデル条件は分離（RemoverizedGPL3、IMG.LY AGPL3、ImageToolbox Apache2、ducan-ne appMIT）。無断で本体のlicenseや選択modelを切替せず、元HR＋ViTMatteを品質基準に維持。次の候補はFeyNoBg/S3ODの同一素材PyTorch評価、並行未完のHR粗抽出＋Small比較も保持する。証拠: `image-studio/docs/browser/validation/2026-11-02-model-and-app-candidate-source-review.json`。


### 2026-11-02: 同じHR入力のSmall原寸比較は120秒未完了

元HR/ViTMatteで使ったinput.f32 SHA4492d1c5…[1,4,1472,1088]を固定し、Small FP32 ONNX SHAa1cf4823…へ既存ORT1.31.1 CPU1coreを接続。今回はTorch前処理をimportしないnative observer。4GiB/3GiB reserve/120秒guardを維持したが120.67秒でtime-budget-exceeded/exit-15、最大観測RSS1,892,999,168byte。raw/PNG/report未生成のため原寸HR＋Smallの画質は未判定。stage callbackを置かなかったためsession loadかmodel runかも今回の記録だけで断定しない。

以前同shapeのSmall/YOLO入力は15秒台で完了したが、入力のtrimapとTorchimport/runtime/host条件が異なる。read-only process観測では他タスクも存在したが因果関係は未証明、他processへ変更なし。Smallだから遅い/HRguidanceが悪いという結論にはしない。次は実行設定・段階観測を切分け、同一失敗設定の繰返しや上限拡大を行わない。元HR＋ViTMatteを品質基準にする方針、FeyNoBg/S3ODの未推論状態は維持。証拠: `image-studio/docs/browser/validation/2026-11-02-hr-trimap-small-full-timeout.json`。


### 2026-11-02: Small局所入力のdenormal設定切分けは速度改善根拠なし

ORT公式session.set_denormal_as_zeroを確認。設定が最初のsession/thread環境へ影響するため、同じHR由来384²tensor SHA269de181…/同じSmallモデルを別々のfresh CPUprocessで設定0/1にて実行。0.908/0.970秒、raw SHA完全一致。小入力では速度改善なし、元の原寸timeoutの原因と断定できず、本体や既定の数値設定は変更しない。各guard2秒で正常終了。次の原寸再実行の根拠にせず、新規依頼候補S3ODのPyTorch画質比較を進める。証拠: `image-studio/docs/browser/validation/2026-11-02-small-denormal-ablation.json`。


### 2026-11-02: S3OD公式重み取得・strict構築後のCPU推論は120秒未完了

利用者指定S3ODの公式HF revision4e4a6c2a…/checkpoint464,526,126byteを取得し公表SHA4501d915…と全byte一致。元sourceのunsafe loaderだけを安全なlocal subclass（weights_only=True/既存_remap_state_dict/strictTrue）で差替え、元model/preprocess/inference/postprocessを無改変再利用。既存private OpenCV4.11/共有Torch2.12.1、371state key/116,097,990parameterをstrict一致で構築、load8.720秒まで確認。新pipeline/kernel/本体依存なし。

同じ原寸1086×1448・公式default入力1024・CPU1core/nice19で推論開始したが、元4GiB/3GiB reserve/120秒guardで120.32秒/time-budget-exceeded/exit-15。最大観測RSS2,686,111,744byte、メモリ超過ではなく出力alpha/3候補は未生成。画質、髪の根元改善、browser適合性を否定する証拠ではない。縮小/cropへの代替や同条件再試行・上限拡大なし。次は利用可能な既存GPU/native経路と資源条件を確認して画質比較を進め、CPU枠の未完了をモデル品質の結論にしない。FeyNoBg重みはまだ未取得/未推論。証拠: `image-studio/docs/browser/validation/2026-11-02-s3od-native-cpu-timeout.json`。


### 2026-11-02: 利用可能なnative CUDAでS3ODを原寸画質評価

環境を実確認し、共有Torch2.12.1+cu130からRTX3050/8GiBを利用可能、空き約7.54GBだった。CPUの120秒未完了を品質未達と混同せず、同じ公式checkpoint/無改変model・前後処理/原寸1086×1448/default1024入力をCUDAFP32へ移した。新dependency/source patchや解像度縮小なし。既存GPU増分4GiB枠を維持しallocator3.5GiB/free4.5GiB admission、CPU4GiB/3GiB reserve/120秒guardも維持。

load2.859秒/推論2.058秒、torch peak allocated2,045,702,656/reserved2,954,887,168byte、全体GPU観測増分3,064,987,648byteで正常終了（watch13.42秒）。371state key strict一致、3候補とpredictedIoU[0.9921,0.9912,0.7436]を保存し公式argmaxで0を選択。これはモデル予測scoreでGT精度とは呼ばない。終了後GPU全体1,168,113,664byteも記録、他processへ操作なし。

白/暗の元RGB固定比較では、選択S3ODは細毛が硬くまとまり、暗背景の白縁が強いというagent目視結果。元HR＋ViTMatteに代わる品質合格ではなく、S3OD単体alphaのprivate1case評価。粗guide＋別matting補正、他scene/GT/GPUCPU精度一致/browser移植は未実施。比較PNG/透明PNG/全3mask/raw/SHAを保存。証拠: `image-studio/docs/browser/validation/2026-11-02-s3od-native-cuda-quality.json`。

### 2026-11-03: 二構成の環境非対応時にモデル選択へ戻す

既存React BackgroundEditor、runtime.models、checkEnvironment APIを再利用。複数モデル構成で必須API欠落時は、写真保持と別モデル選択を案内する。端末名/UAによる自動切替や新依存は追加せず、利用者の選択と既存session.setModelによる再実行を維持する。CPU/モバイルMODNet、資源を満たすHR＋ViTMatteという基本方針に沿う復帰案内であり、実機対応や新runtimeの公開受入を含意しない。

### 2026-11-03: 高画質構成の輪郭補正初期値

既存session/React checkbox/serial inferenceを再利用し、trusted構成へdefaultRefineの明示opt-inを追加。従来構成の既定falseを維持し、新二構成のHR variantだけtrueとする。matte/trimapなしのtrueやboolean以外はsession構築時拒否。別モデルへ切替後は対象構成の初期値へ戻し、写真保持/旧結果失効は既存処理を使う。新依存/画像kernelなし。

### 2026-11-03: iOS実機向けの明示LAN HTTPS検証

既存private assembler/React validation entry/GET allowlist serverを拡張し、Python標準ssl/ipaddressとURL APIを使用。新server/proxy/依存やpublic tunnelは導入しない。明示privateLanHttpsフラグ＋RFC1918 IPv4＋HTTPS完全origin一致、CPU MODNet単独に限定。通常loopbackの制限を維持し、証明書/鍵はprivate評価directoryにのみ置く。Safariの証明書信頼と実機性能は別受入。

### 2026-11-03: LAN候補を既存byte reviewへ接続

既存review_browser_private_artifactのloopback判定を既存private-validation-origin helperへ統一し、LAN候補は明示flag/HTTPS RFC1918/CPU MODNet単独を追加検査。独自inventory/hash方式や新ツールは追加せず、既存stream SHAとstamp検査を使用。7testと実50file照合/再verify通過。

### 2026-11-03: source再現可能なcanonical thumbnail候補

既存Pillow checkerで7native基準SHA一致を確認した43,860byte候補を、既存resize Worker builderの信頼済みhash一覧へ追加。元44,142byteも保持しgeneric任意artifact引数は増やさない。source/既存runtime・Worker handlerを再利用、新kernel/依存なし。本体接続と実写真/最大入力の受入は別とする。

### 2026-11-03: アルゴリズム別の処理注意表示

既存prepare commandのmodel、matte構成、executionProviderからruntimeでprocessingNoticeを組み立て、既存モデル選択metadataと単一モデルruntimeへ渡す。Reactは渡された文だけを表示し、モデル名で分岐しない。HR＋ViTMatteだけCPUで処理に長時間を要することを説明し、現行WebGPU構成ではCPU未対応も併記。MODNetには当該注意を出さない。既存React/型/構成を再利用し、新依存やplugin機構は不要。推論経路と対応providerは変更しない。

### 2026-11-03: 利用者指定のHR＋ViTMatte CPU対応（作業中）

GPU必須という先行UI案を撤回し、非常に遅いCPU構成も明示選択できる方針へ変更。公式ORT WASM・Transformers.js・Worker・ONNX公式Extractorと既存分割toolを再利用し、新依存/独自推論engineは追加しない。明示wasmのHR FP16とmatte FP32を既存runtime ownerへ接続し、GPU構成のstrict設定は維持。CPUのメモリプール/パターン無効・逐次/最適化無効は公式session optionでHR CPUに限定。46分割の3条件は同じ5GiB RSS guardでHR4段後に停止したため、512MiB論理work targetの既存分割toolでCPU専用406分割を検証中。論理workは実メモリ上限ではない。CPU完走・画質・資源・参考時間は未受入。

### 2026-11-03: 最小CPU並列化とRAM8GiB単発試験の結果

公式ORT WASMのnumThreadsを明示1/2に限定し、2要求はcrossOriginIsolatedとSharedArrayBufferがある場合だけ有効、なければ1へ戻す。GPU profileは1に固定。private serverの明示COOP/COEPと既存Worker構成で、実Chrome155の小FP16 Convが2thread/期待値一致。新依存/独自schedulerは追加しない。CPU406分割の進捗上限は既存stage metadata ownerの共通上限1024へ揃え、per-run Worker再利用46上限は維持。576domain/52 UI/typecheck/build通過。

利用者承認のCPU RAM8GiB・2core・最大2thread単発試験はHR28段後にメモリ上限で停止し、CPU製品対応/速度・品質の受入にはしない。停止前stage-028はGather/Mul/TransposeでAttention前。次は小probeでWorker/WASM解放と該当段のメモリを分けて調べる。CPU構成のUI公開・参考時間の確定・COOP/COEPの通常公開版への適用は未完。Gufo0/container停止、約1.02GBのowned一時物を整理済み。

### 2026-11-03: CPU WASM環境を段ごとに作り直さない

実Chrome155の同一tiny FP16 Convで、Worker1個/6sessionのcgroupは約427〜429MB、Worker再生成6回は約450MBから最大1,775MB。全12出力一致/モデルweight要求0。既存per-run Worker再利用をCPU406段に接続し、session/tensorは各段でdispose、最後/中止/失敗はWorkerを終了する。Worker job上限は共通stage上限1024で拒否し、GPUビルドの上限46は維持。新pool/scheduler/依存は追加しない。406段の数値・Worker1個・終了1回と超過拒否をテスト。main08の実HRは通常5GiB枠で20段後に停止し、CPU全体対応は未受入。改めて8GiB以内でCPU検証を継続する範囲を確認中。


### 2026-11-03: CPU高画質の明示選択と計測条件付き注意書き

既存runtime.models/モデル別processingNoticeを再利用し、新しいplugin/推論engine/依存なし。CPU版HR＋ViTMatteだけへ「2000×1000px、AMD CPU2thread、主要処理約6分42秒、最大ブラウザメモリ約6.4GiB、初回取得/準備/PNG保存は別、端末/画像で変動・メモリ不足あり」を表示。GPU版は当該構成のWebGPU要件を示し、CPU全体が非対応という旧案内を撤回。軽量モデルへ変更すると高画質用注意を消す。

private `two-tier-cpu-choice-main-01`で軽量CPU/軽量GPU/高画質GPU/高画質CPUを明示選択可能にした。CPUは完走済みmain08の背景/Matte descriptor・親Worker・trimap Workerをそのまま再利用、補正初期ON。重みコピー0、差分8file/圧縮537,789Bだけ転送。1339routeをremote再照合。実Chrome155で写真/青背景保持、モデル切替/CPU必須API確認dialog取消、390px/1280pxの注意書きと横overflowなしを確認。モデル/runtime/モデルWorker要求0。初回の検証wrapperは古いmanifest参照で起動前停止、原因修正後の独立runで合格し、失敗証拠も保持。

UI267件（26file）・型検査・build/dist検査通過。現sourceIdはsha256:f04ace5f52e539ae147ee05c700c2ea18da40faee62f22bf7376a502c60efbb0。新構成で推論再実行はしておらず、単一CPU横長成功を全shape/品質/最新全体受入へ拡張しない。通常公開版は準備中、公開headers/Pages-R2/配布条件は残す。owned profile12,603,392B削除、container停止/Gufo0/GPU client0/baseline復帰。証拠: `validation/2026-11-03-cpu-model-choice-and-notice.json`。


### 2026-11-03: 最新選択画面からCPU2000²を実行、HR完走・ViTMatte失敗

`two-tier-cpu-choice-main-01`（source f04ace5f…）の高画質CPUを明示選択し、既存許諾済み正方形2000×2000で実行。WASM2thread/ブラウザ8GiB/host reserve3GiB/600秒を維持。HR406段は256.570秒で完了したが、ViTMatteはprepare後runtime-error。保持されたHRマスクによる補正のみ再試行も同エラーで、PNGなし。既存横長成功を最大正方形成功に拡張しない。

全run最大RSS6,866,759,680B/cgroup6,370,058,240B、host空き最低5,970,665,472B。監視の予算超過はなく、WASM内割当失敗等を含む原因は未特定。DevTools例外観測は初期化内部ErrnoErrorだけで因果的な最終例外を捕捉できず、原因と扱わない。次はgeneric runtime-errorへ変換する前の元例外をprivateに捕捉して切り分ける。上限拡大・画像の黙った縮小・軽量モデルへの代替合格は行わない。

補正OFFでは既存の明示base再実行仕様によりHRが再計算されることを確認。operatorのmask再利用想定が誤りで、67段でUI中止し、写真保持/busy解除・PNGなしを記録。これは補正失敗からの保存復帰成功ではない。owned profile/input計1,406,263,296B削除、container停止/Gufo0/GPU client0/baseline復帰。証拠: `validation/2026-11-03-cpu-square2000-matte-failure.json`。

CPU406分割の派生変更記録も既存Selected-model-CHANGESへ追記。元graph/external、同一partition tool、reportと1096HR資源canonical catalog（140,066B/SHA229a18dc…）を固定し、GPU46資源列を不変に保つ。catalog/notice indexのhash検査・notice3test通過。これは公開source releaseや全license受入ではなく、固定旧app/source archiveのnoticeはその時点のまま。次のreviewed releaseへ更新記録/catalogを含める条件を残す。証拠: `validation/2026-11-03-cpu-model-change-record.json`。


### 2026-11-03: CPU ViTMatte2000²の割当失敗を特定、設定比較は不採用

Worker受信層で汎用runtime-errorへ変換する前の元例外を、任意の内部callbackで観測可能にした。callbackは既定no-opで、local-validation scopeかつrecordLocalInferenceErrors=trueの明示private構成のinferだけ、own messageを2048文字に制限してconsoleへ記録する。画像/要求objectを記録せず公開failure eventは固定のまま、observerがthrowしてもcancel/disposeを妨げない。RED→17関連test、domain578件、revert後focused40件、型/build/dist通過。sourceId6f4fc81e…（12file/5,554,451B）、公開なし。

HR再計算を省いたViTMatte単体2000²・診断用unknown trimapで、OrtRun ERROR_CODE6/std::bad_allocを約10.86秒のinfer区間で再現。公式ORTのCPU arena/pattern OFF・逐次・最適化無効でも約9.62秒で同じbad_alloc。最大cgroupは基準4,775,092,224B/比較4,437,458,944B、RSS合算5,581,037,568B/5,256,478,720B。予算超過なし。完走しない設定を修正とは扱わず、memory設定変更をrevertし、診断callbackだけ残した。独立probeは本体通し/実trimap/画質合格ではない。

固定ORT1.31.1 asyncify MJSのgrow関数に4294901760B（約4GiB）上限と、超過要求の拒否を確認。ホスト空きRAMやブラウザ8GiB枠とWASM線形memoryの割当可能量は別。exact失敗node/要求bytes/live heap peakは未捕捉で、特定attention nodeを原因と断定しない。次は全keyと相対位置を保持したquery軸分割等で中間行列を抑える候補を検討し、縮小/量子化/小モデルへの置換や上限拡大で合格にしない。

owned profile2個/診断payload2個を計844,115,968B削除。必要なモデルとsource/ログを保持し、container停止・Gufo0・GPU client0/baseline復帰。証拠: `validation/2026-11-03-cpu-matte-square-allocation-diagnosis.json`。CPU最大正方形・全体scopeは未完。


### 2026-11-03: CPU ViTMatte query軸分割候補を検証、最大正方形は未解決

新しいprivate変換tool `tools/chunk_browser_vitmatte_queries.py`は固定元graph SHAだけを受け入れ、48個のglobal headにあるMatMul→相対位置加算→全key softmax→MatMulを、query高さ8行ごとのONNX Loopへ置換する。key軸・学習済み重み・相対位置項・精度・元画像寸法は維持。単一consumer/softmax軸/shape/48headを検査し、initializer全記録を不変照合。CPU専用の未採用候補でGPU版や選択済みCPU policyは変更しない。

実native ORTで4個の小形状（1×1/3×5/17×3/9×11、端数chunk含む）の元式対分割式がrtol1e-5/atol1e-6で一致、無効chunkを拒否。固定フルモデルも公式ONNX checkerに合格（新graph6,404,627B/SHA fddb32c6769fdd08f07b7ef6d5097734ca00809319578b98d4cae4b0e8216dec）。公式checkerのhardlink保護を回避せず、390,401,920Bの一時正規コピーで検査し、その後削除。重みの恒久複製なし、旧checker経路でできた同一graph6,404,627Bも照合後整理。

AMD containerの実Chrome/WASM2threadで元モデル128×160→分割版128×160を直列実行し、20,480画素のalpha-u8が全byte一致。次の分割版2000×2000はOrtRun ERROR_CODE6/std::bad_allocで失敗。小形状成功を最大寸法/品質/本体通しへ読み替えない。今回のsquare RGBは診断用合成配列で前の自然画像fixtureとは異なり、失敗時間の変化を改善率/原因node特定に使わない。exact失敗nodeは未確定で、これ以上の変換前にnode名のruntime診断が必要。

全run最大cgroup5,545,058,304B/RSS5,695,430,656B、host空き最低7,414,374,400B。8GiB/600秒の監視停止なしで終端失敗を記録。owned profile/remote実験payload833,982,464B削除、container停止/Gufo0/GPU client0/baseline復帰。モデル原本・候補source/graph・検証証拠は保持。現在のCPU2000² HR＋ViTMatteは引き続き未受入、公開/全shape/品質/実機/配布の元scopeも維持。証拠: `validation/2026-11-03-cpu-vitmatte-query-chunks.json`。


### 2026-11-03: nodeログは不確定、decoder Conv単体の実寸は成功

固定ORT Web1.31.1のinitRuntimeがenv.logLevelをOrtInitへ渡す公式実装を確認し、明示private flag時だけerrorへ変える比較を実行。元モデル/queries分割版を同じ2000²合成RGB・unknown trimapで直列に実行したが、両方std::bad_allocだけでexact node名なし。診断追加は目的を果たさずrevertし、元のsourceId6f4fc81e…へ一致。既存のbounded元例外observerは維持。

次に元graphのnode_Conv_9652（index2642、decoder fusion3、入力68ch/出力32ch、3×3・pad1・stride1）の元学習済みweight/bias/属性を82,104Bの独立ONNXへ抽出。直後のReduceMeanだけでJS readbackをscalarに限定し、零activationの64²/2016²を実Chrome/WASM2threadで実行。両方成功し、2016²入力1,105,477,632B・infer約2.294秒。元重みと属性のままの単体kernel/shape不適合という仮説はこの条件では再現せず。scalar値はfinite確認のみで、shape間数値同値や本体画質の証明に使わない。

単体run最大cgroup1,967,624,192B/RSS3,028,226,048B、host空き最低10,233,851,904B。元モデルの実activation/同時live tensor/allocator状態は再現していないため、full modelの失敗nodeや原因を特定したとはしない。次は単一kernelの書換えを増やさず、公式Extractorによるbackbone/decoder等の境界切分けとsession解放で、全tensor/shape/数値を維持して調べる。

16関連test通過。profile2個/remote診断payload2個を846,299,136B整理、必要モデル/診断source/ログ保持、container停止/Gufo0/GPU client0/baseline復帰。CPU最大正方形・full scopeは未完、公開なし。証拠: `validation/2026-11-03-cpu-matte-node-and-conv-diagnosis.json`。


### 2026-11-03: CPU ViTMatte3段化、実寸の単体計算に成功

query分割候補をbackbone→中解像度decoder→全解像度decoderの3graphへ切分けた。Loop lexical captureを追わない公式Extractorへ無理に渡さず、backboneは元の連続prefixを不変保持、残る2graphだけ公式Extractorを使用。全runtime nodeが重複/欠落なく一度ずつ含まれ、各node記録も元と一致。学習済みweight値・精度・寸法を変更せず、公式checker合格。decoder用external tensor約11.8MBは各段へinline化し、backbone用390MB external原本は再利用。一時checker正規コピーは削除済み。

実Chrome/ORT WASM2threadで、単一モデル128×160と3段128×160のfloat32 alpha20,480画素が完全一致。続く合成raw4ch/2016×2016は同じWorkerで3sessionを逐次create/run/releaseし、全3段と4,064,256個のfinite/0..1 alpha出力が成功。infer区間はbackbone101.504秒、中解像度decoder9.581秒、全解像度decoder2.908秒、計約113.994秒。画像・重みを縮小/量子化せず、最大寸法の単体NN計算が通った。

全run最大cgroup4,764,364,800B/RSS5,686,599,680B、host空き最低7,349,112,832B。8GiB/600秒内、GPU推論なし。ただし合成raw入力であり、実写真/HR→trimap→processor→3段Matte→PNGの本体受入は未実施。最大形状の参照alpha/一般品質・全shape受入でもない。次は新しい子Workerやschedulerを増やす前に、既存Matte worker内の公式ORT session逐次利用・既存cache/検証/中止/後処理へ接続する。

owned profile/remote payload75,935,744B削除、必要graph/source/evidenceとモデル原本を保持。container停止/Gufo0/GPU client0/baseline復帰。証拠: `validation/2026-11-03-cpu-matte-three-phase-success.json`。全体goal・公開/実機/権利/最終Gの未完を維持。


### 2026-11-03: CPU ViTMatteの3段化を再実行可能なtoolへ整理

既存ONNX1.23.2のExtractor/checkerを継続利用し、評価用固定パスscriptの責務を`tools/partition_browser_vitmatte.py`へ移した。新依存/独自ONNX parser/推論kernelは追加しない。`--onnx`/`--external`/未存在`--output`だけを受け、元query graph/externalの固定SHAを確認。Loop lexical captureを含むprefixは元の連続nodeを保持し、2decoderだけ公式Extractorへ渡す。runtime node coverageとserialized node recordを確認し、全checker成功後に出力を作る。

小さな実ORTでlexical initializer保持・3sessionの元graph全数値一致、欠損境界と未固定graph拒否を確認（関連query testと合計5件）。同host/nice19/1coreの再生成では3graphすべて受入済みphase0/1/2と全byte一致。生成物の重複36,446,208Bを照合後削除し、元graph/weights/報告/logを保持。ブラウザruntimeやモデルを変更しておらず、重い実推論再実行はしない。

既存評価環境からworkspace rootで実行する例（出力は新directory）:

```sh
image-studio-browser-evaluation/onnx-env/bin/python image-studio/tools/partition_browser_vitmatte.py \
  --onnx image-studio-browser-evaluation/onnx-vitmatte-cpu-query-chunks-02/model.onnx \
  --external image-studio-browser-evaluation/onnx-vitmatte-03/model.onnx.data \
  --output image-studio-browser-evaluation/cpu-matte-phases-new
```

実行版Python3.12.9/ONNX1.23.2/ORT1.31.1/protobuf6.33.6と実行argsをreceiptへ記録。clean-install lock、元重みからoriginal export全再生成、別OS/全source releaseの証明は残る。新source subset archive10memberを再読して全byte一致確認し、Selected-model-CHANGES/sources.jsonの参照とSHAを更新。既存固定appに新NOTICEを遡って適用しない。根拠: validation/2026-11-03-cpu-matte-phases-source-rebuild.json。


### 2026-11-03: 元ONNXからCPU query分割→3段化を連続再生成

現在の`chunk_browser_vitmatte_queries.py`と`partition_browser_vitmatte.py`をnice19/1coreで順番に実行し、既存queryモデルを入力へ流用せず元ONNX(cf0d2103…)から新queryモデルを生成、その新出力だけを3段化の入力にした。生成query fddb32c6…と3phaseの全byteが固定受入artifactへ一致。重みの保持用複製なし、checker用の一時regular copyは標準TemporaryDirectory終端で除去。比較用graph4件/allocated24,629,248Bを照合後削除し、commands/environment/tool SHA/report/logは保持。変更記録/notice indexへ証拠を追加。

直前のunittest glob実行logは7件合格（query2＋新phase3＋既存staged CLI2）。先行記録の5件はquery/phase対象分で、glob全件数とは区別する。今回新しい演算変更/ブラウザ推論/公開はなし。元学習済み重み→original ONNX exportの再現、clean-install lock/他OS/全source release、品質/全shape/実機/実印刷/Pages-R2/G最終監査は残る。証拠: `image-studio/docs/browser/validation/2026-11-03-cpu-matte-full-transform-source-rebuild.json`（ADR内ではvalidation/同名を参照）。


### 2026-11-04: Hugging Face固定commit配信のtransport対応

利用者提案に沿い公式Hubのresolve/HTTP redirect/CORSを調査。新download engineや依存を足さず、既存resource-policyのnative fetchだけを拡張した。固定40hex commitのHub manifestが選択された時のみfollow、それ以外は従来error。最終応答は同一repo/commit/fileのresolve-cache、またはHEADで確認したus.aws.cdn.hf.co/xet-bridge-us/を許可し、bytes/SHA/omit/Acceptのみ/中止/元URLcacheキーを保持。共有tokenをbrowserへ入れない。browser中間redirect制限はCSPで担保する必要があり、final URL検査だけを全chain検査とは呼ばない。未知CDN/地域は失敗させる。元loopback/private candidateの配信設定は変更しない。

失敗test3件→focused20/domain594成功、public build通過。過去固定configの783B/SHA67d70e8c…をlive Node fetchし、cache write/readの全検査成功。原重みHEADは302→CDN200/CORS*だが重みbody未取得。新依存/独自store/公開CSP変更なし。全モデルbrowser/CORS/COEP/429/source rights/公開repo/実機は未完。根拠: validation/2026-11-04-huggingface-resource-policy.json。


### 2026-11-04: HF配信を推論分割とは別にまとめる方針

利用者は大量短期requestを懸念し、archive化/queue/CDNを提示。公式匿名resolver3000IP/5分は公開済みであり、提示されたQPS10〜30/並行20〜50を確実な遮断境界として採用しない。current CPU HRのfor/awaitは逐次で1000Promise.allではない。redirect先requestが全てResolver枠へ二重計上とは断定せず、同一domain6接続はHTTP1.1の性質でHTTP2/3一般へ拡張しない。

推論用1096HR＋4Matte resourceは維持し、配布だけZIP_STOREDへまとめる方向を採る。CPU HR971,245,504B＋ZIP overhead141,770B、Matte408,618,148B＋428Bで、modelGET1100→2の計画（runtime/index/redirect/retry/Range別）。無圧縮なので総bytesは減らず、1GiB級archiveの全量ArrayBuffer/全量展開は避ける。大きいarchiveは中止再試行の無駄転送が増えるtradeoffがあり、最終bundle粒度は復帰試験で決める。

既存fflate0.8.3のUnzipを選択し、新decoder/storage engine/依存を足さずprototype。34entry/5,249,544B ZIPを4KiBずつ入力しnative TransformStreamから既存resource-policy.cache.putへ渡す。遅い消費cache stubで全entrySHA一致、全量archive bufferなし、queued output最大4096B。ただし小entry連続でcache保存31並行となり本体採用不可。保存並行数/壊れたarchive/途中中止/quota/既存cache再利用/全required completionを次の実装条件にする。Node試作でnative browser CacheStorage/全model成功ではない。fixture ZIP5,249,544Bは再生成recipe/hash/result保持後削除。

既存hf-otama-release-preparation-01の個別file配置は歴史的review資料で、最終Hub配信形式としてuploadしない。repo/全source/license/品質/実機/公開gateは継続。証拠: validation/2026-11-04-huggingface-bundle-feasibility.json。


### 2026-11-04: ZIP cache importerとRemBG.com比較

既存fflate Unzip注入＋native TransformStream＋既存resource-policyをmodel-archive.mjsへ接続。4KiB input sliceごとに書込をdrainし、次entryは前entryのcache.put完了後にstart。小entry連続/複数MiBで同時cache保存1/出力chunk最大4096B。全warmはstream再SHA検証後network0。stored ZIP以外、未知/重複/size不一致、破損/切断、quota、abortを固定errorで拒否する。archive全体と各fileをhashし、独自ZIP parser/storeを足さない。focused8/domain602/build通過。現UI/Worker/model prepareへ未接続、実browser/nativeCache/実model未受入。

利用者提示RemBG.com無料browserページを公開HTML/JSだけで調査。widget module16393はbriaai/RMBG-1.4を使用、processor1024²/FP16WebGPU優先、maskを元寸法へ拡大しalpha合成PNG。起動時1px画像のcallを開始し、widgetの通常処理timerは準備領域と分離。HR2048＋ViTMatteの速度/品質同等根拠ではない。common FAQの4K300ms–4sは共有copyでbrowser4s保証と断定しない。現在upstream fp16ONNX88,217,533Bだがsite未pinなので同一artifact断定なし。実行/画質比較や採用はしていない。証拠: validation/2026-11-04-model-archive-importer.json、2026-11-04-rembg-com-browser-pipeline-review.json。


### 2026-11-04: 公開runtime URLを公式wasmPathsへ渡す境界

公開Worker生成の確認中に、既存ORT bootstrapの/runtime直下限定がHF固定commit配下WASMと両立しないことを確認。新loaderを作らず、既に使用中の公式ORT1.31.1 env.wasm.wasmPathsのmjs/wasm指定を継続する（固定package lib/wasm/wasm-factory.tsのmjsPathOverrideFlag/wasmPathOverrideFlagを再確認）。同一origin MJSはnative URLで現在のoriginへ相対解決し、preview/productionへ同じ記述を使う。HFのWASMだけはHTTPS・resolve/40lowerhexcommit/runtime/ort/1.31.1/64lowerhexhash/ort-wasm-simd-threaded.asyncify.wasmを受理する。wasmOriginの明示一致とMJS同一origin、userinfo/query/hash禁止は維持。main/tag/CDN直接URLや任意HF pathへ広げない。

これはURL契約の変更であり、URL内のhashだけでbodyを照合した扱いにはしない。既存の固定runtime artifact照合・noticeに加え、実HF fetch/CORS/COEP/WASM起動は別途必要。公開資産builder/本体runtime注入は未完。根拠: validation/2026-11-04-public-runtime-hub-policy.json（focused27/domain613/scripts15/typecheckbuild成功）。


### 2026-11-04: 公開形式HR子Workerの生成

既存esbuild0.25.12の公式build API、既存browser-stage-worker/段階実行/ORT/bootstrap/resource-policyを再利用するcompile専用tool build_browser_public_stage_worker.mjsを追加。固定package本文SHA、runtime/noticeのbytes/SHAを照合し、scope/privateorigin/診断flag/sourcepathを含まないrelease policyだけ受理。stage接続検証は既存createStagedHr、URL/bytes/SHAは既存createResourcePolicy、runtimeoption検証は既存createOrtRuntimeBootstrapで行い、新しいsession/GPU/loaderは作らない。immutable assets/<scriptSHA>/stage-worker.jsとnotice/reportを出力。ライブラリを変更・再取得せず新npm依存なし。

GPU46段647988B、CPU406段1138244Bをfixture HF revisionで生成。CPUは最初1MiB上限により拒否したため、1096resource URLを内包するHR子Worker専用capを2MiBへ統一。汎用loader既定1MiBは保持し、明示上限/改ざん拒否のテストを追加。モデルのport/bytes/SHA/providerは不変、別cwd再buildで全10assetが各全byte一致。仮revisionのcompile試験であって、配布承認/実Hub内容/実browser/一般品質の受入にはしない。公開親Worker・補助資産・本体entry・CSP・実配信は未完。根拠: validation/2026-11-04-public-stage-worker-build.json（domain617/UI281/scripts15/typecheckbuild成功）。


### 2026-11-04: 親Workerで公開子Workerの相対descriptorを解決

既存resolveStageWorkerをnative URL(worker,origin)へ拡張し、workerFile.urlも同じoriginで絶対化して一致照合。browser-model-prepare-workerはその照合済URLを既存verified loaderへ渡す。別origin/query/hash/userinfo/path/SHA/bytesの拒否とprivate絶対URL互換を保持。新しいloader・cache機構は追加しない。

既存trusted-policy builderからMODNetCPU/GPU・HR+MatteGPU/CPUの親4本を生成。fixture HF revision、相対MJS/子Worker、固定アーカイブinventory対応を使い、6role/5ZIPのresource bytes/SHA/name・provider/processor/resize/stage契約を保持したと照合。CPU親1531859B/GPU親755251B、MODNetCPU643933B/GPU644064B。追加runtimeや重量モデルを読み込まないcompile証拠であり、公開policy検証/asset組立/本体entry/実HF/ブラウザ実行は未完。根拠: validation/2026-11-04-origin-neutral-parent-worker-build.json（domain618/UI281/scripts15/typecheckbuild成功）。


### 2026-11-04: 標準mainから固定release runtimeを既存Rootへ注入

公開本体にcreateReleaseBackgroundRuntimeを追加。既存createBackgroundRuntimeの型/選択/cache/CPU警告をそのまま使い、build固定設定のWorker/notice相対pathをhash付き同一originへ検証・解決する。private entry/trace/origin判定を公開mainへimportしない。Vite既定は__BACKGROUND_RELEASE__ nullで、実公開設定/資産の受入は未完のまま。

静的importでは通常buildにもbackground input Workerが約40KB余分に出力されたため、mainは手動編集を即表示して設定ありの場合だけ遅延importする形へ修正。chunk/設定失敗時は固定案内と同じRootの手動編集/印刷を残す。任意exception/URL/写真情報を画面へ出さず、GPU/CPU品質fallbackは追加しない。通常dist14files8172810B、未使用background Workerなし。fixture4構成を標準mainでcompileし93overlay資産をSHA照合、110files20567323Bとして組立。仮HF revision/未接続CSPのprivate marker付きでPages配布拒否を確認、実browser/inferenceとは区別する。新依存なし。根拠: validation/2026-11-04-public-entry-runtime-injection.json（UI287/scripts15/typecheckbuild成功）。


### 2026-11-04: モデル設定時だけPagesのCSP/COOP/COEPを生成

公式Cloudflare Pages _headersを使い、新しいserver/proxy/依存は追加しない。公式docs sourceをGitHub connectorで確認（docs HTTP403のため）。同名headerはmatching rule間でcomma結合されるので、CSPはglobal1行を生成し競合させない。web/scripts/pages-headers.mjsで通常/モデル接続の2modeを生成、ViteのconfigResolvedでbuild固定literalから選択してgenerateBundleでemit。nullの通常版はpublic/_headersと全byte一致。object判定はheader modeだけで、公開release全schema/配布承認ではない。

接続版はscript-src self wasm-unsafe-eval、worker-src self blob、connect-src self huggingface.co/us.aws.cdn.hf.co、COOPsame-origin/COEPrequire-corp。JavaScript eval/inlineや任意CDNは加えず、他既存制約を維持。これはapp全体の固定model capabilityとして許可するもので、写真非送信や実WASM/CORS成功をCSPだけで主張しない。実Viteの通常/4構成fixture出力がgeneratorに全byte一致、scripts18/typecheckbuild成功。private markerで配布拒否を保持。実Pages/CDN/ブラウザ制約適用は未受入。根拠: validation/2026-11-04-pages-background-response-headers.json。


### 2026-11-04: 公開build設定の構造と自己整合性を早期検証

単なるobject/null判定をparseBackgroundReleaseへ置換し、Vite configResolvedで初期4構成/HR補正ON/協調中止/固定同repo-commit/5ZIP/共有MODNet cache/unknownprivate keyを検証。URL/bytes/SHAとcache scopeは既存ResourcePolicy/CacheActionsを再利用。ZIP member名検証をimporterから純粋関数へ抽出しbuild/runtimeで共用、Worker/notice pathもrelease-asset.mjsで共用して判定差を減らす。ZIP_STORED最低容量とsafe integer合計を検査し、任意例外/入力値を固定invalid-background-releaseへredact。新しいschema依存/loader/registryなし。

構造が正しいことをモデル内容や配布承認の代わりにしない。実Hub/ZIP内容/親Workerpolicy/実資産SHAの結合は未完。TDD RED→domain619/UI287/scripts20/typecheckbuild成功（最後のbuild-only数値guard後はscripts/build再確認）。実ViteもmissingCPU/privatekey/mutableHubをoutput前に拒否、現4構成fixtureは192MiB heapでbuild成功。一時出力8635269B整理、recipe/manifest/log保持。根拠: validation/2026-11-04-public-release-schema-gate.json。


### 2026-11-04: app build設定digestとWorker policy/モデルcatalog/実資産を結合

公開設定JSONが実Vite buildの入力と同じか確認できなかったため、既存Vite pluginからbackground-release.json（version/configShaのみ）をemitし、Source public同名assetを予約拒否、既存dist guardへschema検査を追加。通常版はsidecarなし。新verify_browser_release_bindingsは既存prepare source/public stage policy検証とNode crypto/fs streamを使い、4親のbundle/policy digest・provider・prepare/ZIP記述、2子のpolicy/descriptor/notice、5packのcatalog entries、宣言assetの実bytes/SHAを結合する。別の設定JSONへの差し替えもapp側digestで検出。新cache/decoder/schema依存なし。

Source root内regular fileだけを読み、sourceJSON8MiB/asset25MiBを上限にstream SHA/stamp前後・最終再検査、symlink/traversal/変更中fileを拒否。JSON parse内容をerrorへ出さない。build reportを信頼した関係照合であって、署名/source認証/ZIP実body/Hub実在/完全dependency closure/配布承認は別。CI domainへ4testsとtool syntaxを接続。

現sourceで4親再compile→標準main候補03へ接続し、93asset/6role/5packを実読取照合、repeat同一bindingIdと設定差替え拒否を確認。全domain623/UI287/scripts21/typecheckbuild成功。候補111files20567852B/sourceId eb9f04fd…は通常版と同source。private markerで配布拒否を維持し、必要な中間Vite coreだけ事前全SHA確認後に再生成、duplicate overlayを整理。実browser/GPU/モデル/ネット/公開は実行しない。根拠: validation/2026-11-04-public-release-resource-bindings.json。


### 2026-11-04: Worker build依存を通常npm projectへ接続

既存採用済みTransformers.js4.3.2/ORT Web1.31.1/hash-wasm4.12.0/esbuild0.25.12を
`tools/browser-build`のprivate npm project/lockへ固定。別のML runtimeやdecoderを採用しない。
通常npm ci --ignore-scriptsを使い、標準createRequire.resolveでbrowser配布fileを特定する。
TransformersのNode entryは実行せず、Node側native処理の初期化をbuild依存にしない。
2builderの依存解決をbrowser-build-dependencies.mjsへ集約。installed版はversion/所属project/
実file/固定bundleSHAを確認、旧captured layoutはhashの取得証拠と互換性を維持する。
候補依存を動的に走査したりhome cacheを暗黙のfallbackにしない。

unit RED→GREEN3件と旧stage-builder corruption fixtureの更新、domain626/UI287/scripts21/
型/build成功。fresh npm ci48package、audit0。新依存rootから6Worker本体が旧固定候補と
全byte一致、全文noticeも保持。esbuildがnode_modules由来のパッケージ名をLEGAL.txtへ
付加する差は原copyright全block保持を確認して区別し、出力を旧formatへ加工しない。
CIへ導入/解決/監査とpath filter/syntaxを追加しmain-preview/tag-production条件は保持した。

同projectから実private HF commitへ5880 URL fieldを結合し4親/2子をcompile、標準mainと
93asset/6role/5packを既存binding verifierで照合した。配布markerは保持しpublic承認としない。
通常buildへのrelease注入/公開assembly/実origin受入とsource release更新は別の残件。
根拠: validation/2026-11-04-standard-worker-dependencies-and-hub-binding.json。

### 2026-11-04: 同一photo/modelの保持maskを補正OFFでも使う

旧仕様のOFFは明示base再計算だった（2026-11-03のCPU補正失敗記録等はその当時の契約）。今回の実GPU OFF→ON→OFFで、出力を変えずにOFF戻しだけ約71秒を再計算していると測定したため、性能改善として契約を改訂。既存session所有registry/serial-inference/operation cache scopeを拡張し、対応するcopy/見積りを更新する。ORTや画像libraryへappのphoto/model失効管理を移さず、別cache engineや新依存は加えない。写真/モデル変更・shape/byte/layout・操作key/遅延commit・gateの既存検査を保持する。

REDでは既存session/serial/見積り/UIで新契約を再現、GREEN/全306UI/631domainWorker/24scripts/型/2build成功。実AMD GPUでOFF→ON→OFFの各PNGが従来と一致し、OFF戻しはHR観測なし・取得見積り0・4.155秒。時間は単一事例で一般保証としない。古い明示base再実行の履歴を消さず、本変更が後継契約であることを記録する。
根拠: validation/2026-11-04-mask-reuse-off-native-optimization.json。新コードのsource固定ペア・CPU native・全品質/実機/配信等は継続。

### 2026-11-04: 既存3phase preparerをORT WebGPUへ接続

既存ORT1.31.1の正式WebGPU/NCHW/CPU Loop＋GPU MultiHeadAttention経路を、同じ4resource/3session preparerへ接続した。repoの既存graph変換/partition toolsで原SHAから検証済み3phaseをbyte一致生成し、CPU経路とHR artifact/profileを保持。境界はgetDataでCPU所有へ移し、有限値確認・session release・queue完了後に次phaseへ進む。新依存/独自kernel/上流build/別preparerは不要。

private current Rootの2000² HR→GPU Matte→native PNG、およびMatte取消→停止確認→保持HR maskで明示retryが既定4GiB/5GiB内で成立し、2PNGのbytes/decodedRGBAは同一。小download実fileのnamespace確認を先行。既存HR/Matte共通modelVersionを維持し、新Matte releaseId/cache/resource/packだけを固定した。正確なoperator/phase profilingは01-15の同一graph証拠の継承範囲を区別し、現Root測定とは扱わない。CPU同入力8bit差は記録のみで一般画質許容を追加しない。private markerを保持し、公開/採用/実機/一般画質は未完。

根拠: `.planning/phases/01-vitmatte-gpu/01-16-SUMMARY.md` とprivate `source14-mha-capability-01/integration-16/receipt.json`。外部write/公開/新予算0。
