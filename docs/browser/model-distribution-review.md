# モデル配布の公開前レビュー

確認日: 2026-11-05。対象は非公開 `otama/image-studio-models`。
モデル・runtime・学習重みは変更せず、HFへはGETだけを実行した。
公開・upload・削除・履歴書換えは行っていない。

## 結論と必要な修正

現行の標準ZIP_STORED、sourceのtar.gz、HFのLFS/Xet管理を維持する。
公開前の修正は案内の整合とheadの整理に限定できる。再圧縮、新SDK、別のモデル形式、
compiler再buildの追加は不要。

| 項目 | 確認結果と対応 |
| --- | --- |
| 古いroot案内 | README、SOURCE_AVAILABILITY、APP_RELEASE_PAIRING、MODEL_FILESはsource14を案内し、最新GPU phased candidateと不一致。全修正後のsource/inputを一度固定し、その実CID・version・bytes・SHAで更新する |
| 誤ったREPLAY生成 | 再利用generatorに旧CID `957cdde…` が直書きされ、外部input配置もsourceId計算の既定配置と異なった。生成元を修正済み。CIDを引数から生成し、`web/background-release`へ配置する。commit説明も動的CIDへ変更。小さい回帰1件成功 |
| 不要なcurrent-head候補 | 旧source-release 15件、旧input 5件、旧unphased GPU Matte ZIP 1件は現入力から参照されない。将来headから除外する候補は計21件、1,227,471,780 logical bytes。正確なpathはanalysis.json。新candidateの参照再確認後にのみ整理する |
| 参照のあるraw Matte | 現releaseの4件はKEEP。ZIP内に同じ内容があっても、cache miss/eviction時の直接GET fallbackを完全追跡していないため削除対象にしない |
| license/source提供 | 必須文書の新たな欠落は検出していない。固定source/notice URLの匿名取得は非公開状態のため未確認。公開時に受領者から到達できることを確認する |

上の整理はheadの閲覧・通常snapshotの改善である。履歴に残る旧releaseは維持し、
削除によるLFS/Xet実保存量の回収を主張しない。旧workbench
`otama/image-studio-browser-models`、ローカル原本・過去証拠・rollback資産は保持する。
小さいlicense全文や変更記録は重複だけを理由に削らない。

## 現リモートの測定値

- Head: `f6b62814bac1e0f20040b0df8802fc8805a1fa03`、private、9 commits。
- 96 files、4,380,164,326 logical bytes、同一blobを1回ずつ数えると3,561,730,807 bytes。
- 最新採用候補の5 ZIPは2,684,331,665 bytes、内部1,243 entries。MODNetはCPU/GPUで共用。
- ORT WASMは28,747,738 bytes。モデル・大きなruntimeは再downloadしていない。
- rootの25 license文書は保持済み原文とsize/Git blobが全件一致。
- model source archive432 membersとapp source archive706 members（manifest含む）は保持済み実体のSHAがHF LFS metadataと一致。`.git`、`node_modules`、`.env`、`__pycache__`、除外済み`model-input/birefnet/handler.py`は両archiveにない。

これは監査した旧candidateの識別である。親作業のversion整合修正によって旧S/Iは公開候補として失効しており、
ここで挙げたCIDを次の最終releaseへ転用しない。新sourceには本レビューとpublication-review.mdも含める。

## 採用する配置と圧縮

HFのREADME model card、個別license全文、固定source案内、LFS/Xetの大payload、
versioned source/inputという既存構造を使う。既存`APP_RELEASE_PAIRING.json`をrelease indexとして
一貫させ、別のregistryや重複manifest形式を増やさない。次回はversion、sourceとinputの
revision/path/bytes/SHA、configured sourceId、実inventory、4 choicesに対応する5 transport、
runtime、license/source案内が同じcandidateを指すことを照合する。
旧root文書は最新indexから歴史資料と明示し、現在の手順へ混在させない。

| 配布物 | 形式と理由 |
| --- | --- |
| モデル | 現在のZIP_STORED（標準ZIP method 0）。1,243小fileを5要求へまとめ、既存stream importerが逐次hash検証/cache書込する。pack全体のRAM展開を避ける |
| source/build input | 標準tar.gz。既存hash・member manifest・data-only extractionを維持する |
| runtime | 元のWASM。binaryと対応license/source案内を維持する |

ZIP_STOREDは圧縮率を上げる方式ではない。DEFLATE/zstdへの変更にはloader変更・CPU/RAM/中断の再検証が必要で、
今回の公開前整理には採用しない。圧縮率や転送速度の新規測定はしていない。

## 公開upstreamとの比較

2026-11-05にHTTPでmetadataだけ取得。モデル本体は取得しなかった。

| 公開repo・固定revision | 構造 | 今回への適用 |
| --- | --- | --- |
| [Xenova/modnet](https://huggingface.co/Xenova/modnet/tree/fa2fa546052fba4c08921230a26cc69a333fca12) | 12 files、README/config、onnx/のLFS別精度モデル、Apache-2.0宣言 | 複数profileと大binaryのLFS管理は通常の構造。全repoを追加圧縮する必要はない |
| [BiRefNet HR](https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting/tree/5d6b6f8adcb5b417c871b1d84ceaae9871355b7f) | 8 files、README/config/code、LFS safetensors、MIT宣言 | codeと重みの条件を区別。upstreamのhandlerをそのまま転載する必要はない |
| [ViTMatte Base](https://huggingface.co/hustvl/vitmatte-base-distinctions-646/tree/b58373f8dbbfbeb58157456e2e4949f9f872aa18) | 6 files、README/config、LFS safetensors/bin、Apache-2.0宣言 | 利用する形式だけを選び、別形式の重複を公開必須と解釈しない |

今回のpackは一般のTransformers読込形式ではなく、既存ブラウザloader用transportであることをREADMEへ明記する。
公式[storage guidance](https://huggingface.co/docs/hub/storage-limits)のfile/dir/size目安を十分下回り、
9 commitsを理由に破壊的squashを行う必要はない。
[download guidance](https://huggingface.co/docs/hub/models-downloading)のXet chunk dedupと、
[license guidance](https://huggingface.co/docs/hub/repositories-licenses)のmodel card宣言を踏まえ、
現`license: other`＋mixed-upstream-licenses＋LICENSES.mdの境界を保つ。

## 採用モデルとruntimeの権利境界

既存[配布条件](distribution-conditions.md)と固定原文を引き継ぐ。

| 対象 | 適用条件・保持するもの |
| --- | --- |
| MODNet CPU/GPU | 公式READMEのcode/models Apache-2.0、固定Xenova ONNX cardもApache-2.0。本文、元表示、MODNet-artifact-CHANGES、固定元重み/ONNX対応を保持 |
| BiRefNet HR CPU/GPU | 固定HR model cardのMITと公式code MIT。埋込SwinのMicrosoft MIT全文を追加保持。除外handlerは戻さない |
| ViTMatte CPU/GPU phased | 重みApache-2.0、公式code MIT。両本文、変更告知、元/変換SHA、追加GPU graph変換のNOTICEと対応app sourceを保持。code MITで重みを再licenseしない |
| ORT Web 1.31.1 | 実commit `41d4d61f14b9c1dd0b2ccda1e9b85dd415fd0496`に対応するMIT/ThirdPartyNotices全文、Dawn等を保持 |
| ORT内Eigen | MPL-2.0 covered source、固定upstream ZIP、ORTの2patch/recipeと入手案内を保持し、配布時に受領者が取得可能にする |
| toolchain補足 | 既存Emscripten/compiler-rt/musl/libc++等の全文と適用範囲を保持。producerの独立build attestation未確立を、新たな一律再build義務へ置換しない |

推論・全tests・公開後の匿名配信・新しい品質判断は本レビューで実施していない。
既存のライセンス証拠を利用し、未公開を公開source提供成功とは扱わない。

## 証拠と実施したローカル修正

`../image-studio-browser-evaluation/distribution-review-01/`の
remote-inventory.json（全96path/size/LFSまたはblob/history）、public-upstreams.json、
official-guidance.json、remote-documents.json、analysis.jsonを正本とする。
token・host credentialは出力しなかった。

修正先は既存`gpu-phased-input-pairing-01/prepare.py`のREPLAY生成関数とcommit説明のみ。
`test_replay_text.py`は異なる2 CIDとcanonical配置を確認して成功した。
保持済みarchive、private input、既存REPLAY証拠は変更していない。

## アプリの継続リリース

入力のreview sourceIdは入力来歴として保持し、現在アプリとの同一性は要求しない。現在アプリはVERSION/build-info/GitHub commit/同run inventoryで識別する。UIだけの更新ではモデル配布版を作り直さない。対応するモデル変換/runtime sourceの固定HF提供は維持する。詳細は[公開前レビュー](publication-review.md)と[リリース手順](../releases.md)。
