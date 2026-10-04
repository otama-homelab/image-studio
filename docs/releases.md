# バージョン更新とリリース

[ドキュメント一覧](../README.md#ドキュメント)

## 通常のリリース

1. アプリの変更と必要な確認を済ませ、`main`へpushします。
2. GitHub Actionsの **Bump version** を開き、`main`と更新種別を指定して実行します。
3. `publish / image`まで成功することを確認します。
4. GitHub Releaseに記載されたSemVerとdigestを、利用先のイメージ参照へ設定します。
5. 利用先でGPUの認識と、変更した機能の動作を確認します。

| 種別 | 用途 | 例 |
|---|---|---|
| patch | 不具合修正 | 1.1.2 → 1.1.3 |
| minor | 互換性を維持する機能追加 | 1.1.2 → 1.2.0 |
| major | 互換性に影響する変更 | 1.1.2 → 2.0.0 |

CLIからも実行できます。

```bash
gh workflow run version-bump.yaml --ref main -f bump=patch
gh run list --workflow version-bump.yaml --limit 5
```

workflowは`VERSION`を更新し、botのコミットと`vX.Y.Z`タグをatomic pushしてから、reusable release workflowを直接呼び出します。GITHUB_TOKENによるタグpushでは別のworkflowが自動起動しないため、明示的に呼び出しています。実行後は`git pull --ff-only`でbotの更新を取り込んでください。

## 公開されるもの

- `ghcr.io/otama-homelab/image-studio:X.Y.Z`
- `ghcr.io/otama-homelab/image-studio:latest`
- GitHub Release: バージョンとイメージdigest。
- 依存ビルド用の`buildcache`とActionsのビルド記録。

`VERSION`とタグが一致しない場合、リリースは失敗します。手動のタグpushでもビルドできますが、通常はBump versionを使ってください。

イメージはlinux/amd64向けです。アプリ・依存は含みますが、モデル本体は初回起動時に取得します。ソースリポジトリとGHCRパッケージの公開範囲は別に管理されます。

## 失敗した場合

workflowの失敗したstepを確認します。ディスク不足・依存のimport失敗・VERSION不一致などを区別してください。GPUライブラリを含むため、依存層の取得・展開はキャッシュ利用時でも数分かかることがあります。

同じタグのコードに問題がなく、ビルドや通信などの一時的な失敗で、イメージ・Releaseがまだ公開されていなければ、**Release image**のworkflow_dispatchから既存タグを指定して再試行できます。

```bash
gh workflow run release.yaml -f tag=vX.Y.Z
```

コード修正が必要な場合はmainへ修正を入れ、次のpatchを発行します。公開済みタグ・バージョンを差し替えないでください。キャンセルや失敗で番号が飛んでもそのまま残します。

## 利用先の更新とロールバック

運用では`latest`だけを使わず、SemVerとdigestを固定します。新しいタグの公開だけでは、利用先のDeploymentは更新されません。

問題があれば、利用先のイメージ参照を直前の確認済みSemVer/digestへ戻します。モデルキャッシュは再利用できますが、写真の一時領域はPod・コンテナの交換で消えます。

workflowの権限はGitHubの`contents`と`packages`を使用します。認証値をbuild-argやイメージのENVに渡しません。ログ・Release・ビルド記録は公開範囲に合わせて扱ってください。
