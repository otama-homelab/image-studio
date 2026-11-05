# 公開前の配布構成レビュー

利用者指定のレビュー範囲は、ライセンス、版管理、他repoとの比較、不要ファイル、一般的な圧縮/配布形式。公開は修正完了後。安定版の本番公開とは分ける。

## アプリとCI

| 比較対象 | 確認した慣行 | Image Studioの採用 |
|---|---|---|
| otama-playground-astro | package版と安定タグ、mainのPreview、本番releaseを分離、frozen lockfile | main→Preview・安定タグ→productionを維持。版の正本は既存VERSIONに一本化 |
| scanner-kiosk | タグ/branchのrelease識別と実build版の照合、dist・cache・生成payloadをignore | build metadataとpackage/tagの版を一致させ、生成物を公開sourceへ混ぜない |

発見した不一致: VERSION=1.1.2とWeb package/lock=0.1.0が独立しており、version-bumpはWebを更新しなかった。
修正: package/lockを1.1.2へ同期し、build-infoはVERSIONをhash/参照してpackage不一致を拒否。Bump versionはVERSIONとpackage/lockを同じcommitで更新する。依存の版は変更しない。
テスト: build-infoの不一致回帰をRED→GREEN、5件成功。実workflow内Pythonを実行するpatch/minor/major同期と不一致時の非書込テスト2件成功。CIにも接続。

生成物: node_modules/dist/秘密情報は既存ignoreとsource allowlistで除外。ローカルdesign-toolの.hallmark/もignoreへ追加。GSD計画・原モデル・評価証拠を削除しない。従来サーバー版app/と静的ブラウザ版web/は明示した用途があり、混在だけを理由に削除しない。

## モデルとsource提供

[モデル配布レビュー](model-distribution-review.md)で、採用license全文25件と既存source提供を照合。公開upstream3件・公式HF guidanceと比較し、新しい欠落は検出していない。
モデルrepoの古いroot案内と未参照head候補21件を最終固定時に整理する。参照中のraw Matte4件とlicense/sourceは保持。stale REPLAY生成は修正済み、回帰1件成功。最終CIDは修正完了後に固定し、現在の983bb6/f6b628を新しい公開版と偽らない。

## 公開条件

ライセンス/必要source/版/構成の残gapを閉じ、同じ候補の配布チェックを通すまで公開しない。成立後は利用者指定どおりHFの公開用repoとPages Previewで実機確認を進める。旧workbench・本番production・独自domain・安定タグは対象外。

## アプリとモデル入力の版を分離

追加の不整合: CIはアプリ全体のsourceIdを過去のHF入力reviewと比較していたため、正常なVERSION/UI変更も失敗した。元要件にこの同一性の義務はなく、公開前の実装で過剰に結合していた。
修正: descriptor.source_idとpair.reviewBuild.sourceIdの一致は入力の来歴として保持。現在アプリとの比較だけを廃止し、アプリは従来のbuild-info・GitHub exact commit・同run配布inventoryで識別する。モデル/source/licenseの固定CID、全SHA/size/manifest/member照合とmarker拒否は維持。追加のschemaやregistryは作らない。
RED→GREEN: 固定モデル入力を異なる現在app releaseから再利用できること、入力reviewsource/modelの不一致拒否、private markerなど12テスト成功。

## 配布アカウントの移行

利用者指定により配布先をotama3/image-studio-modelsへ変更する。新しいWrite tokenは別の0600ファイルで保持し、whoamiでotama3と確認済み。旧otama側repo/workbenchは非公開保持・変更しない。新repoへ採用payload/license/sourceだけを移し、現在参照するURL・descriptor・model/source案内を新しい実CIDへ結ぶ。過去監査の識別子は歴史証拠として保持し、現配布先と混同しない。
