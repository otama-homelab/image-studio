export const githubRepository='https://github.com/otama-homelab/image-studio';
export function Brand(){return <a className="brand" href="#/"><img src="/logo.svg" alt="" width="36" height="36"/><span>Image Studio</span></a>;}
export function StarLink(){return <a className="github-star" href={githubRepository} target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/></svg>Star on GitHub</a>;}
export function SiteFooter({onSupport,backgroundConfigured=false,modelNoticesHref}:{onSupport?:()=>void;backgroundConfigured?:boolean;modelNoticesHref?:string}={}){return <footer className="site-footer">
 <div className="footer-top"><Brand/><StarLink/></div>
 <p><strong>Client-side processing</strong>：写真をサーバーへ送信せず、ブラウザ内で処理します。</p>
 <div className="footer-links">{onSupport&&<button onClick={onSupport}>端末情報と診断</button>}<a href="/LICENSE.txt" target="_blank" rel="noopener noreferrer">アプリ本体：MIT License</a><a href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noopener noreferrer">依存ライブラリのライセンス</a><a href={githubRepository} target="_blank" rel="noopener noreferrer">ソースコード</a></div>
 <p>ライセンス・外部リンクは別のタブで開きます。</p>
 <details><summary>関連モデルのライセンス</summary><p>{backgroundConfigured?'背景編集の検証用モデル構成が接続されています。以下は未採用分を含む比較候補です。通常公開版の搭載・配布とは別です。':'背景編集は準備中です。以下は利用を検討しているモデルで、現在のWeb版には搭載・配布していません。'}モデルの条件はアプリ本体のMITライセンスとは別です。</p>{modelNoticesHref&&<p><a href={modelNoticesHref} aria-label="検証モデルのライセンス・モデルカード・出典" target="_blank" rel="noopener noreferrer">モデルのライセンス・出典</a>（未採用候補の資料も含みます）</p>}<ul>
  <li><a href="https://huggingface.co/ZhengPeng7/BiRefNet_HR-matting/blob/5d6b6f8adcb5b417c871b1d84ceaae9871355b7f/README.md" target="_blank" rel="noopener noreferrer">BiRefNet_HR-matting</a>：MIT（人物マスクの候補）</li>
  <li><a href="https://huggingface.co/ZhengPeng7/BiRefNet_lite/blob/aa62cd87eafb9cc43056d08ef3615a14628b831d/README.md" target="_blank" rel="noopener noreferrer">BiRefNet lite</a> / <a href="https://huggingface.co/senty-au/BiRefNet_lite-ONNX-dynamic/blob/173d635935b93839608b9b9039da8d1d212471e9/README.md" target="_blank" rel="noopener noreferrer">比較用ONNX変換版</a>：MIT（軽量モデルの比較候補）</li>
  <li><a href="https://huggingface.co/ZhengPeng7/BiRefNet-portrait" target="_blank" rel="noopener noreferrer">BiRefNet-portrait</a>：MIT（人物向けモデルの比較候補）</li>
  <li><a href="https://huggingface.co/Xenova/modnet" target="_blank" rel="noopener noreferrer">MODNet（Xenova ONNX）</a>：Apache-2.0（人物向け軽量モデルの候補）</li>
  <li><a href="https://huggingface.co/hustvl/vitmatte-base-distinctions-646/blob/b58373f8dbbfbeb58157456e2e4949f9f872aa18/README.md" target="_blank" rel="noopener noreferrer">ViTMatte Base Distinctions-646</a>：Apache-2.0（輪郭補正の候補）</li>
 </ul><p>提供開始時に、採用モデルの利用条件と権利表示を案内します。</p></details>
 <details><summary>免責・利用上の注意</summary><p>プレビュー版です。規格への適合、提出先での受理、印刷機での仕上がりを保証するものではありません。提出先の加工条件・寸法・印刷倍率を確認してください。再読み込みやタブを閉じる操作で、編集中の写真と設定は失われます。</p><p>作例はAI生成の架空の人物を使った操作イメージです。背景除去の実測結果や、処理品質を保証する比較画像ではありません。</p></details>
 <p>© 2026 Image Studio contributors</p>
 </footer>;}

export function EditorNavigation({current,backgroundAvailable=true}:{current:'background'|'crop'|'print';backgroundAvailable?:boolean}){
 return <nav aria-label="編集工程" className="flex min-w-0 flex-wrap gap-2 border-b border-line pb-3">
  {([{id:'background',label:backgroundAvailable?'背景編集':'背景編集（準備中）'},{id:'crop',label:'サイズ・配置'},{id:'print',label:'直接印刷'}] as const).map(item=><a key={item.id} href={`#/${item.id}`} aria-current={current===item.id?'page':undefined} className="inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-muted hover:bg-subtle aria-[current=page]:bg-ink aria-[current=page]:text-paper">{item.label}</a>)}
 </nav>;
}
