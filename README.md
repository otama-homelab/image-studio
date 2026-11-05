# Image Studio

**[アプリを開く](https://image-studio.otama-playground.com/)**

写真の背景除去・サイズ調整・印刷配置を、ブラウザ内で行う静的Webアプリです。写真はアップロードせず、利用者の端末で処理します。英語が初期表示で、日本語にも切り替えられます。

- 背景編集：MODNet、PC向けBiRefNet HRと任意のViTMatte補正。CPU/GPUは明示選択します。
- サイズ調整：用途別・カスタム寸法、ズーム・パン、位置調整、300dpi PNG保存。
- 印刷配置：A4・L判・2L判・はがきへ配置し、PNG/PDF保存。

PCの高画質CPU処理は非常に遅く、多くのRAMを使います。スマホではHRモデルを表示しません。写真・設定はメモリ内に保持し、再読み込みやページを離れると失われます。完全オフライン起動は保証しません。

## 構成

| 場所 | 責務 |
|---|---|
| `web/` | Vite / React / TypeScriptのアプリとWorker。Pagesで静的配信 |
| `tools/browser-library-adapter/` | 画像・モデル処理、状態・所有権を扱う共有モジュール |
| `tools/` | モデル変換、WASMビルド、参照生成、ローカル検証。公開アプリの実行サーバーではありません |
| `tests/`、`web/tests/` | 共有処理・Worker・画面・配布契約の検証 |
| `docs/browser/` | 設計、責務、状態機械、権利表示、検証記録 |

旧Python/Gradioサーバー版、Docker起動、GHCR公開は廃止しました。モデル変換等で使うPythonは開発用です。旧実装の履歴は既存タグに保持し、ブラウザ版から読み込みません。

## 開発

```sh
cd web
npm ci --ignore-scripts
npm run dev
```

Nodeの版は[web/.node-version](web/.node-version)を使用します。モデル付き配布ビルドには固定HF入力と別のビルド依存が必要です。[開発手順](docs/development.md)を参照してください。

## ドキュメント

- [写真の編集と印刷](docs/usage.md)
- [ローカル起動](docs/running.md)
- [開発・検証](docs/development.md)
- [リリースと復帰](docs/releases.md)
- [トラブルシューティング](docs/troubleshooting.md)
- [モジュールの責務](docs/browser/modules-and-ownership.md)
- [状態機械](docs/browser/state-machine.md)

`main`はPreview、安定SemVerタグは本番へ配信します。GitHub Releaseには検査済み静的成果物とチェックサムを公開します。コンテナは生成しません。

## ライセンス

アプリ本体は[MIT](LICENSE)。依存・モデル・変換物・素材は、それぞれのLICENSE/NOTICEと条件に従います。アプリ内に権利表示と固定ソースへのリンクがあります。背景処理用モデルは固定リビジョンの[otama3/image-studio-models](https://huggingface.co/otama3/image-studio-models)から取得します。

提出用写真の寸法や加工条件は、提出先の要件も確認してください。
