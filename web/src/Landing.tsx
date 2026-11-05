import {useTranslation} from 'react-i18next';
import {t} from './i18n';
import {BackgroundComparison} from './background/BackgroundComparison';
import {Brand,StarLink,LanguageSwitcher} from './SiteChrome';
import {focusSection} from './navigation';
import {PaperPreview} from './PaperPreview';
import {cropBox,paperLayout} from '../../tools/browser-library-adapter/print-geometry.mjs';
const sample={url:'/examples/portrait-small.webp',width:1086,height:1448};
const [x,y,right,bottom]=cropBox({width:sample.width,height:sample.height,outputWidth:354,outputHeight:472,range:80,horizontal:50,vertical:25});
const sampleCrop={x,y,width:right-x,height:bottom-y};
const samplePaper=paperLayout({paper:'a4',photoWidth:354,photoHeight:472,dpi:[300,300]});
export function Landing({backgroundAvailable=false}:{backgroundAvailable?:boolean}={}){
 useTranslation();
 return <div className="app landing mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8">
  <a className="skip" href="#home-content" onClick={event=>focusSection(event,'home-content')}>{t("内容へ移動")}</a>
  <header><Brand/><div className="flex items-center gap-3"><LanguageSwitcher/><StarLink/></div></header>
  <main id="home-content" tabIndex={-1} className="landing-content md:gap-32">
   <section aria-labelledby="landing-title" className="grid min-w-0 items-center gap-8 py-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:min-h-[calc(100svh-12rem)] md:gap-12 md:py-10">
    <div className="flex min-w-0 flex-col items-start gap-6">
     <h1 id="landing-title" tabIndex={-1} className="max-w-[14ch] text-4xl leading-[1.08] font-semibold tracking-tight sm:text-5xl lg:text-6xl">{t("写真を、使いたいかたちに。")}</h1>
     <p className="max-w-lg text-lg text-muted">{t("背景を消す。サイズを整える。印刷まで、ブラウザひとつで。")}</p>
     <div className="flex flex-wrap gap-3">{backgroundAvailable&&<a className="primary-link" href="#/background">{t("背景を消す")}</a>}<a className={backgroundAvailable?'secondary-link':'primary-link'} href="#/crop">{t("サイズを整える")}</a><a className="secondary-link" href="#/print">{t("印刷用に並べる")}</a></div>
     <p className="text-sm text-muted">{t("インストール不要。写真はアップロードしません。")}</p>
    </div>
    <figure className="m-0 min-w-0">
     <BackgroundComparison original={sample.url} result="/examples/portrait-cutout-small.webp" width={sample.width} height={sample.height} originalAlt={t("背景除去作例の処理前の架空人物")} resultAlt={t("MODNetで自動処理した架空人物の透過作例")}/>
     <figcaption className="mt-3 text-sm text-muted">{t("架空の人物写真をMODNetで処理した作例。仕上がりは写真によって異なります。")}</figcaption>
    </figure>
   </section>
   <section aria-labelledby="usage-title" className="border-t border-line pt-8">
    <h2 id="usage-title" tabIndex={-1} className="text-3xl md:text-5xl">{t("操作で画像がどう変わるか")}</h2>
    <div className="grid min-w-0 gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
     <article className="min-w-0"><div className="flex min-h-64 items-center justify-center rounded-xl bg-subtle p-6"><figure className="m-0 w-36"><svg className="aspect-[3/4] w-full" viewBox={`${x} ${y} ${sampleCrop.width} ${sampleCrop.height}`} role="img" aria-label={t("30×40mmの切り抜き作例")}><image href={sample.url} width={sample.width} height={sample.height}/></svg><figcaption className="mt-3 text-center text-sm text-muted">30 × 40 mm</figcaption></figure></div><h3 className="mt-5">{t("必要なサイズに")}</h3><p className="text-sm text-muted">{t("用途別・カスタム寸法に調整して、300dpiのPNGで保存。")}</p><a className="section-link" href="#/crop">{t("サイズ調整へ進む")}</a></article>
     <article className="min-w-0"><div className="flex min-h-64 items-center justify-center rounded-xl bg-subtle p-6"><PaperPreview layout={samplePaper} picture={{...sample,crop:sampleCrop}}/></div><h3 className="mt-5">{t("用紙へ自動配置")}</h3><p className="text-sm text-muted">{t("A4・写真用紙に並べて、印刷用のPNGやPDFを作成。")}</p><a className="section-link" href="#/print">{t("直接印刷へ進む")}</a></article>
    </div>
   </section>
   <aside className="grid min-w-0 gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <article aria-labelledby="requirements-title" className="border-t border-line pt-6"><h3 id="requirements-title" tabIndex={-1} className="text-base">{t("必要な環境・入力")}</h3><p className="pb-5 text-sm text-muted">{t("JPEG/PNG、20MiBまで。サイズ調整・印刷はGPU不要。高画質HRはPC向けで、CPU処理は非常に遅く、多くのRAMを使います。")}</p></article>
    <article aria-labelledby="limitations-title" className="border-t border-line pt-6"><h3 id="limitations-title" tabIndex={-1} className="text-base">{t("制約・確認してほしいこと")}</h3><p className="pb-5 text-sm text-muted">{t("再読み込みで写真と設定は失われます。先にファイルを保存してください。印刷は100%を指定し、提出先の寸法・加工条件も確認してください。")}</p></article>
   </aside>
  </main>
 </div>;
}
