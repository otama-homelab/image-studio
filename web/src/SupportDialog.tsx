import {useEffect,useId,useRef,useState} from 'react';
import {useNativeDialog} from './useNativeDialog';
import {readBrowserCapabilities,createDiagnostic,type BrowserCapabilities} from './browserCapabilities';
import {createDownloadLinks} from '../../tools/browser-library-adapter/download-links.mjs';
type Link={id:string;url:string;filename:string};
const labels:Record<keyof BrowserCapabilities,string>={secureContext:'安全な接続（HTTPS等）',worker:'Worker API',offscreenCanvas:'OffscreenCanvas API',imageBitmap:'createImageBitmap API',imageData:'ImageData API',objectURLs:'Blob URL API',fileAPI:'File / Blob API',webgpuAPI:'WebGPU API',webAssembly:'WebAssembly API',crossOriginIsolated:'クロスオリジン分離'};
export function SupportDialog({open,onDismiss,backgroundConfigured=false}:{open:boolean;onDismiss:()=>void;backgroundConfigured?:boolean}){
 const title=useId(),description=useId(),heading=useRef<HTMLHeadingElement>(null);
 const modal=useNativeDialog(open,onDismiss,heading);
 const [caps,setCaps]=useState<BrowserCapabilities|null>(null),[link,setLink]=useState<Link|null>(null),[error,setError]=useState('');
 const ready=useRef<ReturnType<typeof createDiagnostic>|null>(null),linkRef=useRef<Link|null>(null),links=useRef<ReturnType<typeof createDownloadLinks>|null>(null);
 function discard(){ready.current=null;links.current?.reconcile();if(linkRef.current)links.current?.release(linkRef.current.id,'diagnostics');linkRef.current=null;setLink(null);setError('');}
 useEffect(()=>{discard();if(open)setCaps(readBrowserCapabilities());else setCaps(null);},[open,backgroundConfigured]);
 useEffect(()=>{
  const clear=()=>{ready.current=null;links.current?.close();links.current=null;linkRef.current=null;setLink(null);};
  addEventListener('pagehide',clear);return()=>{removeEventListener('pagehide',clear);clear();};
 },[]);
 function prepare(){
  if(!caps)return;discard();
  try{ready.current=createDiagnostic(caps,backgroundConfigured);links.current??=createDownloadLinks({getReady:()=>ready.current});const next=links.current.acquire({kind:'diagnostics',format:'json'},'diagnostics');linkRef.current=next;setLink(next);}
  catch{discard();setError('診断情報を作れませんでした。画面内の端末情報を確認してください。');}
 }
 function begin(){try{if(!linkRef.current)return false;links.current?.beginDownload(linkRef.current.id,'diagnostics');return true;}catch{return false;}}
 return <dialog ref={modal.ref} className="replace-dialog support-dialog" aria-labelledby={title} aria-describedby={description} onCancel={modal.onCancel} onKeyDown={modal.onKeyDown}>
  <h2 ref={heading} id={title} tabIndex={-1}>端末情報と診断</h2><p id={description}>このページで使えるAPIの有無を確認します。GPU取得・推論・モデル取得・画像の読み込みは行いません。</p>
  {caps&&<><dl className="capability-list">{Object.entries(labels).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{caps[key as keyof BrowserCapabilities]?'検出':'未検出'}</dd></div>)}</dl>
   <p>サイズ調整にはWorker・OffscreenCanvas・ImageData、JPEGの書き出しにはcreateImageBitmapも必要です。直接PNG印刷はWorkerで処理します。WebGPUは手動サイズ調整・印刷には不要です。</p>
   {!caps.worker&&<p role="alert" className="error">Worker APIが見つかりません。このブラウザではファイルを作成できません。WindowsのChromeで開き直してください。</p>}
   {!caps.offscreenCanvas&&<p className="hint">OffscreenCanvas APIが見つかりません。現在のサイズ調整・JPEG書き出しは利用できません。</p>}
   <p className="hint">APIの検出は、この端末での処理成功・画質・速度を保証しません。Worker内の対応状況、GPUの利用可否とメモリ容量は未確認です。</p>
   <p className="hint">モデルの保存容量と、実行中に使うRAM（作業用メモリ）・GPUメモリ（VRAM）は別です。GPU推論でもRAMを使います。この画面では空きRAM・VRAMを測定しません。</p>
   <p className="hint">背景処理のCPU・GPU推論にはWebAssemblyも必要です。CPU推論はWebGPUを使わずに処理する経路ですが、利用できるモデルは構成によって異なります。</p>
   {backgroundConfigured&&!caps.webAssembly&&<p role="alert" className="error">WebAssembly APIが見つかりません。このブラウザでは背景処理を開始できません。サイズ調整・印刷は各画面の対応状況を確認してください。</p>}
   <h3>背景処理の準備状況</h3><p>{backgroundConfigured?'非公開検証用のモデル構成が接続されています。取得・保存状況は背景編集の画面で確認できます。接続済みの表示は、モデルの取得完了やこの端末での動作確認を示しません。':'背景処理用モデルは未搭載です。モデルの取得・削除機能は準備中です。'}</p>
   <h3>診断情報</h3><p>アプリの版・ビルドID・モデル構成の接続状態と上記APIの有無だけをJSONにします。ビルドIDはアプリの内容を識別するもので、端末ごとの識別子ではありません。写真・ファイル名・パス・URL・画素・GPU名・ブラウザ識別文字列は含めず、自動送信しません。</p>
   <button onClick={prepare}>診断情報を作成</button>{error&&<p role="alert" className="error">{error}</p>}
   {link&&<><pre className="diagnostic-preview" aria-label="保存する診断情報">{ready.current?.text}</pre><a className="download" href={link.url} download={link.filename} onClick={event=>{if(!begin())event.preventDefault();}} onAuxClick={event=>{if(!begin())event.preventDefault();}} onContextMenu={event=>{if(!begin())event.preventDefault();}}>診断JSONを保存</a><p className="hint">共有する場合は内容を確認してから、ご自身で送ってください。</p></>}
  </>}
  <div className="dialog-actions"><button onClick={modal.dismiss}>閉じて元の画面に戻る</button></div>
 </dialog>;
}
