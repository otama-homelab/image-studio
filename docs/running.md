# 起動する

通常は **https://image-studio.otama-playground.com/** を開いて使用します。サーバー、Docker、Node、Pythonのインストールは不要です。

ローカル開発はリポジトリ全体を取得し、指定のNode版で実行します。

```sh
cd web
npm ci --ignore-scripts
npm run dev
```

開発サーバーは127.0.0.1のみで待ち受けます。モデル入力の準備と検証は[開発手順](development.md)、公開は[リリース手順](releases.md)を参照してください。旧ROCmサーバー版のポート7860・モデルキャッシュ・GPUコンテナ設定は使用しません。
