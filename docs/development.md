# 開発と処理の構成

[ドキュメント一覧](../README.md#ドキュメント)

本体は`web/`の静的ブラウザアプリです。画面はReact、画像処理はWorkerと共有adapter、モデル配布は固定HF入力、公開はPagesが所有します。詳細は[責務・変更先](browser/modules-and-ownership.md)と[状態機械](browser/state-machine.md)を参照してください。

## 開発・確認

Nodeは`web/.node-version`、依存はlockfileで固定します。

```sh
cd web
npm ci --ignore-scripts
npm test
npm run test:scripts
npm run test:domain
npm run build
npm run dev
```

`npm run dev`はloopbackで起動します。`npm test`は画面、`test:scripts`はbuild/配布、`test:domain`は共有処理・Worker・状態契約を確認します。これらは実機GPU推論、一般画質や物理印刷の保証ではありません。

## モデル付きビルド

`web/background-release/`は固定入力から生成する作業用directoryで、ソースへ追加しません。CIは`IMAGE_STUDIO_BUILD_INPUT`から匿名取得・整合性確認を行い、`tools/browser-build/`の固定依存でWorkerを組み立てます。入力不正時は失敗し、背景機能なしへ黙って切り替えません。

[Web開発メモ](../web/README.md)、[ビルド依存](../tools/browser-build/README.md)、[公開runtime接続](browser/public-runtime-integration.md)を参照してください。

## 開発用ツールと履歴

`tools/export_browser_*.py`、参照画像生成、WASMビルド等は開発時だけ使用します。PythonやPyTorchを公開サイトの実行依存にしません。出力は指定された非公開評価directoryへ保存し、写真やモデル原本をソースへ混入させません。

旧サーバーを前提とした起動・ROCm/ExecuTorch比較・Vulkanエクスポートと、その専用patch群は廃止しました。既存の比較結果とライセンス証拠は保持します。過去の手順は当時のタグに対応する履歴であり、現行構成の起動手順ではありません。
