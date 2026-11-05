# Image Studio Web

[本番アプリ](https://image-studio.otama-playground.com/) · [Preview](https://preview.image-studio-c5u.pages.dev/)

Vite / React / TypeScriptの静的アプリです。Pythonサーバーや画像アップロードAPIは使いません。背景処理は固定HFモデル入力とWorkerへ接続し、日本語・英語に対応しています。高画質HRはPC向けです。

## 開発と検証

Nodeは[.node-version](.node-version)、依存はpackage-lock.jsonで固定します。共有adapter・LICENSE・build用ツールを使うため、repo全体を取得してください。

```sh
cd web
npm ci --ignore-scripts
npm test
npm run test:scripts
npm run test:domain
npm run build
npm run dev
```

画面・共有契約・配布guardの自動検査は実機GPU推論・一般画質の保証ではありません。モデル付きビルドは`background-release/`の固定入力と`../tools/browser-build/`の依存を使います。入力不正時は失敗し、背景機能なしへ切り替えません。

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


## 配信

[リリース手順](../docs/releases.md)に従い、mainはPages Preview、安定タグはproductionとGitHub Releaseへ配信します。Docker/GHCRは使用しません。検査した同じ成果物を配信し、inventoryとSHAで照合します。モデルは固定HFリビジョンから取得します。
