import {useTranslation} from 'react-i18next';
import {t} from './i18n';
import {useEffect,useState,useRef,useCallback} from 'react';
import type {EditorActivity} from './editorActivity';
import App,{type EditorHandle,type PhotoTransfer} from './App';
import {SupportDialog} from './SupportDialog';
import {PhotoReplaceDialog} from './PhotoReplaceDialog';
import {Landing} from './Landing';
import {SiteFooter} from './SiteChrome';
import {BackgroundEditor,type BackgroundRuntime} from './background/BackgroundEditor';
type Route='home'|'background'|'crop'|'print';
const homeAnchors:Record<string,string>={'#home-content':'home-content','#usage-title':'usage-title','#requirements-title':'requirements-title','#limitations-title':'limitations-title','#usage':'usage-title','#requirements':'requirements-title','#limitations':'limitations-title'};
function readRoute():Route{return location.hash==='#/background'?'background':location.hash==='#/crop'?'crop':location.hash==='#/print'?'print':'home';}
export default function Root({backgroundRuntime,backgroundConfigurationFailed=false}:{backgroundRuntime?:BackgroundRuntime;backgroundConfigurationFailed?:boolean}={}){
 useTranslation();
 const [route,setRoute]=useState(readRoute),[supportOpen,setSupportOpen]=useState(false);
 const showSupport=useCallback(()=>setSupportOpen(true),[]);
 const dismissSupport=useCallback(()=>setSupportOpen(false),[]);
 useEffect(()=>{addEventListener('pagehide',dismissSupport);return()=>removeEventListener('pagehide',dismissSupport);},[dismissSupport]);
 const cropSession=useRef<EditorHandle>(null),printSession=useRef<EditorHandle>(null);
 const recoveryPhoto=useRef<{file:File;target:'crop'|'print';source:'background'|'print'|'crop';origin?:()=>boolean}|null>(null),recoveryEpoch=useRef(0);
 const [transferTarget,setTransferTarget]=useState<'crop'|'print'>('crop');
 const [,updateRevision]=useState(0);const reportRevision=useCallback(()=>updateRevision(value=>value+1),[]);
 const [recoverOpen,setRecoverOpen]=useState(false),[recoverError,setRecoverError]=useState('');
 function keepRecovery(){recoveryEpoch.current++;recoveryPhoto.current=null;setRecoverOpen(false);}
 async function recoverPhoto(){
  const transfer=recoveryPhoto.current;keepRecovery();if(!transfer)return;setRecoverError('');
  const epoch=recoveryEpoch.current,current=()=>recoveryEpoch.current===epoch&&(transfer.origin?.()??true);
  if(!current()){setRecoverError(t("元の画像が変更されました。サイズ調整でPNGを作り直してください。"));return;}
  const recipient=transfer.target==='crop'?cropSession:printSession;
  const adopted=await recipient.current?.importPhoto(transfer.file,current,transfer.origin);
  if(recoveryEpoch.current!==epoch)return;
  if(adopted)location.hash=`#/${transfer.target}`;
  else setRecoverError(t("画像を渡せませんでした。元の写真は各工程で保持しています。"));
 }
 function requestTransfer(transfer:NonNullable<typeof recoveryPhoto.current>){
  recoveryPhoto.current=transfer;setTransferTarget(transfer.target);setRecoverError('');
  const recipient=transfer.target==='crop'?cropSession:printSession;
  if(recipient.current?.hasPhoto())setRecoverOpen(true);else void recoverPhoto();
 }
 function requestRecovery(blob:Blob){requestTransfer({file:new File([blob],'image-studio-photo',{type:blob.type}),target:'crop',source:'print'});}
 function requestPrint(transfer:PhotoTransfer){requestTransfer({file:transfer.file,target:'print',source:'crop',origin:transfer.isCurrent});}
 function requestBackgroundCrop(transfer:PhotoTransfer){requestTransfer({file:transfer.file,target:'crop',source:'background',origin:transfer.isCurrent});}
 function refreshPrint(){const transfer=cropSession.current?.getCropArtifact();if(transfer)requestPrint(transfer);else setRecoverError(t("サイズ調整でPNGを作り直してから、最新画像を反映してください。"));}
 useEffect(()=>{keepRecovery();setRecoverError('');},[route]);
 useEffect(()=>{const clear=()=>{recoveryEpoch.current++;recoveryPhoto.current=null;setRecoverOpen(false);};addEventListener('pagehide',clear);return()=>{recoveryEpoch.current++;recoveryPhoto.current=null;removeEventListener('pagehide',clear);};},[]);
 const cropPanel=useRef<HTMLDivElement>(null),printPanel=useRef<HTMLDivElement>(null),backgroundPanel=useRef<HTMLDivElement>(null);
 const empty:EditorActivity={busy:false,label:'',cancel:()=>{}};
 const [cropActivity,setCropActivity]=useState(empty),[printActivity,setPrintActivity]=useState(empty);
 const [backgroundActivity,setBackgroundActivity]=useState(empty);
 const reportBackground=useCallback((value:typeof empty)=>setBackgroundActivity(value),[]);
 const reportCrop=useCallback((value:typeof empty)=>setCropActivity(value),[]),reportPrint=useCallback((value:typeof empty)=>setPrintActivity(value),[]);
 const navigate=useCallback((mode:'crop'|'original')=>{location.hash=mode==='original'?'#/print':'#/crop';},[]);
 useEffect(()=>{
  const changed=()=>{setSupportOpen(false);const next=readRoute(),anchor=homeAnchors[location.hash];if(anchor){if(location.hash!=='#'+anchor)history.replaceState(null,'','#'+anchor);document.getElementById(anchor)?.focus();}else if(!['','#','#/','#/background','#/crop','#/print'].includes(location.hash))history.replaceState(null,'','#/');setRoute(next);};
  addEventListener('hashchange',changed);changed();return()=>removeEventListener('hashchange',changed);
 },[]);
 useEffect(()=>{if(route==='home')document.getElementById(homeAnchors[location.hash]??'landing-title')?.focus();else (route==='background'?backgroundPanel:route==='crop'?cropPanel:printPanel).current?.querySelector<HTMLElement>('.journey h1,.journey h2')?.focus();},[route]);
 const cropTransferOrigin=recoveryPhoto.current?.source==='background'?t("背景編集のPNG"):t("印刷中の写真");
 return <>
  {backgroundConfigurationFailed&&<p role="alert" className="global-activity">{t("背景機能を読み込めませんでした。ページを再読み込みするか、サイズ調整・印刷を利用してください。")}</p>}
  {recoverError&&<p role="alert" className="global-activity">{t(recoverError)}</p>}
  <PhotoReplaceDialog open={recoverOpen} onKeep={keepRecovery} onReplace={()=>{void recoverPhoto();}} titleText={t(transferTarget==='crop'?t("サイズ調整の写真を置き換えますか？"):t("印刷する写真を置き換えますか？"))} descriptionText={t(transferTarget==='crop'?t("{{v0}}をサイズ調整へ渡します。サイズ調整で編集中の写真・位置調整・作成済みファイルを置き換えます。取消すると両方の工程をそのまま保持します。",{v0:cropTransferOrigin}):t("作成済みの切り抜きPNGを印刷へ渡します。印刷で編集中の写真・作成済みファイルを置き換え、用紙と形式は保持します。取消すると両方の工程をそのまま保持します。"))}/>
  {([{activity:cropActivity,path:'crop'},{activity:printActivity,path:'print'},{activity:backgroundActivity,path:'background'}] as const).filter(item=>item.activity.busy&&route!==item.path).map(item=><div className="global-activity" role="status" key={item.path}><span>{t(item.activity.label)}</span><a href={`#/${item.path}`}>{t("編集へ戻る")}</a><button disabled={item.activity.cancelling} onClick={item.activity.cancel}>{t(item.activity.cancelling?t("中止しています…"):t("中止"))}</button></div>)}
  <div hidden={route!=='home'}><Landing backgroundAvailable={!!backgroundRuntime}/></div>
  <div ref={backgroundPanel} hidden={route!=='background'}><BackgroundEditor active={route==='background'} runtime={backgroundRuntime} onCrop={requestBackgroundCrop} onRevision={reportRevision} onActivity={reportBackground}/></div>
  <div ref={cropPanel} hidden={route!=='crop'}><App backgroundAvailable={!!backgroundRuntime} active={route==='crop'} requestedMode="crop" sessionRef={cropSession} onPrint={requestPrint} onRevision={reportRevision} onNavigate={navigate} onSupport={showSupport} onActivity={reportCrop}/></div>
  <div ref={printPanel} hidden={route!=='print'}><App backgroundAvailable={!!backgroundRuntime} active={route==='print'} requestedMode="original" sessionRef={printSession} onRefreshOrigin={refreshPrint} onRecover={requestRecovery} onNavigate={navigate} onSupport={showSupport} onActivity={reportPrint}/></div>
  <SupportDialog open={supportOpen} onDismiss={dismissSupport} backgroundConfigured={!!backgroundRuntime}/>
  <SiteFooter onSupport={showSupport} backgroundConfigured={!!backgroundRuntime} modelNoticesHref={backgroundRuntime?.modelNoticesHref}/>
 </>;
}
