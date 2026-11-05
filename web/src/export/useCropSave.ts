import {t} from '../i18n';
import {useEffect,useRef,useState} from 'react';
import {createDownloadLinks} from '../../../tools/browser-library-adapter/download-links.mjs';
import {createCropExportClient} from './client';
import type {ExportRequest,PreparedFile} from './types';
type Link={id:string;url:string;filename:string;mime:string};
export function useCropSave(key:string,canUse:()=>boolean=()=>true){
 const permitted=useRef(canUse);permitted.current=canUse;
 const running=useRef<Promise<void>|null>(null);
 const currentKey=useRef(key);currentKey.current=key;
 const ready=useRef<{key:string;file:PreparedFile}|null>(null),linkRef=useRef<Link|null>(null),pending=useRef<AbortController|null>(null),mounted=useRef(true);
 const [link,setLink]=useState<Link|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [feedback,setFeedback]=useState<'idle'|'stale'|'cancelled'>('idle'),[recovery,setRecovery]=useState<'crop'|'retry'>('retry');
 const resources=useRef<{client:ReturnType<typeof createCropExportClient>;links:ReturnType<typeof createDownloadLinks>}|null>(null);
 function getResources(){return resources.current??=( {client:createCropExportClient(),links:createDownloadLinks({getReady:()=>permitted.current()&&ready.current?.key===currentKey.current?ready.current.file:undefined})});}
 function discard(){if(ready.current||pending.current)setFeedback('stale');pending.current?.abort();ready.current=null;const r=resources.current;r?.links.reconcile();if(linkRef.current)r?.links.release(linkRef.current.id,'crop-view');linkRef.current=null;setLink(null);}
 useEffect(()=>{discard();setError('');},[key]);
 useEffect(()=>{
  mounted.current=true;
  const close=()=>{pending.current?.abort();ready.current=null;resources.current?.links.close();void resources.current?.client.close().catch(()=>{});resources.current=null;linkRef.current=null;};
  addEventListener('pagehide',close);return()=>{mounted.current=false;removeEventListener('pagehide',close);close();};
 },[]);
 async function generate(input:ExportRequest){
  if(!permitted.current()){discard();setError(t("元の画像が変更されました。最新画像を反映してから作成してください。"));return;}
  if(pending.current)return;discard();setFeedback('idle');setError('');setRecovery('retry');const requestKey=currentKey.current,controller=new AbortController();pending.current=controller;setBusy(true);
  const r=getResources();
  try{
   const file=await r.client.generate(input,controller.signal);
   if(!mounted.current||controller.signal.aborted||requestKey!==currentKey.current||!permitted.current())return;
   ready.current={key:requestKey,file};const next=r.links.acquire(input.output,'crop-view');linkRef.current=next;setLink(next);
  }catch(error){const code=(error as {code?:string})?.code;if(mounted.current&&(!controller.signal.aborted||code==='crop-save-stop-failed')&&requestKey===currentKey.current){setRecovery(code==='unsupported-print-dpi'||code==='invalid-print-metadata'?'crop':'retry');setError(code==='crop-resize-unavailable'?t("画像処理用の機能を読み込めませんでした。接続を確認して、もう一度作成してください。写真と設定は保持しています。"):code==='png-dimensions-too-large'?t("このPNGは現在の処理上限を超えています。各辺4,096px以内・総画素400万以下に縮小したPNGを選んでください。写真と設定は保持しています。"):code==='pdf-module-unavailable'?t("PDF用の機能を読み込めませんでした。接続を確認して再試行するか、作成済みPNGに切り替えてください。写真と設定は保持しています。"):code==='unsupported-png-format'?t("このPNG形式を処理できません。対応するPNGかJPEGを選び直してください。対応形式は開始画面の「必要な環境・入力」で確認できます。"):code==='unsupported-browser'?t("このブラウザでは、この画像の書き出しに必要な機能を利用できません。「端末情報を確認」から必要なAPIを確認してください。"):code==='crop-save-create-failed'?t("画像処理用Workerを開始できませんでした。接続やブラウザの設定を確認し、「端末情報を確認」から診断情報を保存できます。"):code==='crop-save-failed'?t("画像処理を完了できませんでした。接続やブラウザの設定を確認して、もう一度作成してください。写真と設定は保持しています。"):code==='crop-save-busy'?t("ほかの画像処理が進行中です。完了するか中止してから、もう一度作成してください。"):code==='crop-save-unavailable'||code==='crop-save-stop-failed'?t("処理の終了を確認できませんでした。必要なファイルを保存してから、ページを再読み込みしてください。"):code==='unsupported-print-dpi'?t("300dpiの写真を使用してください。「サイズを整える」で寸法を指定できます。"):code==='invalid-print-metadata'?t("写真のDPI情報を確認できませんでした。「サイズを整える」で寸法を指定してください。"):code==='photo-does-not-fit'?t("写真が用紙に収まりません。用紙または写真の寸法を変更してください。"):t("画像ファイルを作れませんでした。写真を確認して、もう一度お試しください。"));}}
  finally{if(pending.current===controller){pending.current=null;if(mounted.current)setBusy(false);}}
 }
 function prepare(input:ExportRequest){
  if(running.current)return running.current;
  const task=generate(input);running.current=task;
  const settled=()=>{if(running.current===task)running.current=null;};void task.then(settled,settled);
  return task;
 }
 function beginDownload(){try{if(!permitted.current()||!linkRef.current)return false;resources.current?.links.beginDownload(linkRef.current.id,'crop-view');return true;}catch{discard();setError(t("設定が変わりました。画像を作り直してください。"));return false;}}
 const visibleLink=permitted.current()&&ready.current?.key===key&&link?.id===linkRef.current?.id?link:null;
 const phase=busy?(feedback==='cancelled'?'cancelling':'generating'):error?'error':visibleLink?'ready':feedback;
 function getPreparedFile(){return permitted.current()&&ready.current?.key===currentKey.current?ready.current.file:null;}
 return {waitForIdle:()=>running.current??Promise.resolve(),getPreparedFile,prepare,busy,error,recovery,phase,link:visibleLink,beginDownload,cancel:()=>{if(!pending.current)return;setFeedback('cancelled');pending.current.abort();},invalidate:discard};
}
