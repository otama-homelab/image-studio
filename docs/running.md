# コンテナの起動

[ドキュメント一覧](../README.md#ドキュメント)

## 必要なもの

- Linux x86_64とDockerなどのコンテナランタイム。
- ROCm 7.2で使えるAMD GPUと、ホスト上のGPUドライバー。動作確認機はRadeon 8060Sです。他のGPUでは互換性を確認してください。
- `/dev/kfd` と `/dev/dri`、renderデバイスへのアクセス権。
- イメージの取得と、初回のモデル取得に必要なネットワーク接続。
- イメージ・モデル・処理用の空き容量。イメージ自体が約7.1GBあるため、モデル分とイメージ更新時の余裕も必要です。

現在のイメージはAMD GPUを必須とし、GPUが使えない場合は起動に失敗します。CPUへの自動フォールバックはありません。

## Dockerで起動する例

以下は`/dev/dri/renderD128`を使う例です。GPUデバイス名とグループIDはホストに合わせてください。

```bash
mkdir -p ./image-studio-cache
sudo chown 1000:1000 ./image-studio-cache
GPU_RENDER_GID=$(stat -c '%g' /dev/dri/renderD128)

docker run -d --name image-studio \
  --device /dev/kfd --device /dev/dri \
  --group-add "$GPU_RENDER_GID" \
  --cap-drop ALL --security-opt no-new-privileges \
  --read-only \
  -e MIOPEN_CUSTOM_CACHE_DIR=/cache/miopen/kernels \
  -e MIOPEN_USER_DB_PATH=/cache/miopen/db \
  --tmpfs /tmp:rw,size=1g,uid=1000,gid=1000 \
  --mount "type=bind,src=$(pwd)/image-studio-cache,dst=/cache" \
  -p 127.0.0.1:7860:7860 \
  ghcr.io/otama-homelab/image-studio:1.1.2

docker logs -f image-studio
```

初回はモデルのダウンロードに時間がかかります。GPU名と`Running on local URL`が表示されたら、ホスト上で`http://127.0.0.1:7860/`を開きます。初回の推論もカーネルなどの初期化により遅くなることがあります。

GHCRのパッケージが非公開の場合は、実行者にpull権限が必要です。GitHubの画面でパッケージの公開範囲を確認し、必要なら`docker login ghcr.io`で認証してください。ソースリポジトリが公開されていても、パッケージの公開範囲は別です。トークンをDockerfileやコマンドの引数、Gitへ書き込まないでください。

## 保存先と認証

| パス | 内容 | 扱い |
|---|---|---|
| `/cache/huggingface` | BiRefNet・ViTMatte | 永続化して再利用 |
| `/cache/insightface` | 顔検出・ランドマークモデル | 永続化して再利用 |
| `/cache/miopen`・`/cache/numba` | 実行キャッシュ | 永続化して再利用 |
| `/tmp/photos` | 入力・出力・Gradioの一時ファイル | 一時領域。写真を永続化しない |

アプリはUID/GID 1000で実行します。`/cache`と`/tmp`はこのユーザーで書き込めるようにしてください。依存ライブラリやアプリ本体はイメージ内にあります。

アプリ単体のログイン画面はありません。LANなどへ公開する場合は、リバースプロキシ側で認証とHTTPSを設定し、画面だけでなく`/gradio_api/`やファイル取得を含む全パスを保護します。上の例はホストのlocalhostだけに公開します。

画像処理はサーバー内で完結します。Gradioのshareとanalyticsは無効です。モデル取得時には公式配布元へ接続します。

## Kubernetesで使う場合

Deployment・Service・PVCと一時領域を用意し、GPUの割り当てをクラスタのdevice pluginまたはDRAに合わせます。

- コンテナポート: 7860。
- 永続ボリューム: `/cache`。書き込み可能なUID/GIDを設定。
- 一時ボリューム: `/tmp`。Pod交換時に写真が消える構成。
- UID/GID: 1000。renderデバイスに必要な補助グループを追加。
- 更新: イメージのSemVerとdigestを固定。GPUとキャッシュを引き継ぐ。
- 認証: Ingress/Gatewayで全パスを保護。

このリポジトリは環境固有のクラスタ設定を持ちません。モデルの準備・読み込みを待てる起動確認を設定し、実際の入力写真で必要なCPU・メモリ・GPUメモリを測定してください。

## 更新・停止

新しいイメージを取得し、同じモデルキャッシュを使ってコンテナを作り直します。更新で一時領域の写真は失われるため、先に必要な出力を保存してください。固定digestは[GitHub Releases](https://github.com/otama-homelab/image-studio/releases)で確認できます。

停止だけなら`docker stop image-studio`、コンテナの削除は`docker rm image-studio`です。モデルキャッシュは別に残るので、再起動・再作成で再利用できます。

関連: [リリース手順](releases.md) / [トラブルシューティング](troubleshooting.md)
