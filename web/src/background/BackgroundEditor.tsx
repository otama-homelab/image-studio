import {useTranslation} from 'react-i18next';
import {t} from '../i18n';
import {useEffect,useRef,useState} from 'react';
import type {EditorActivity} from '../editorActivity';
import {Brand,EditorNavigation,LanguageSwitcher} from '../SiteChrome';
import {BackgroundComparison} from './BackgroundComparison';
import {PhotoReplaceDialog} from '../PhotoReplaceDialog';
import {useNativeDialog} from '../useNativeDialog';
import type {PhotoTransfer} from '../App';
import {createDownloadLinks} from '../../../tools/browser-library-adapter/download-links.mjs';
import {workerFailure} from '../../../tools/browser-library-adapter/worker-failure.mjs';

type Pixels={width:number;height:number;format:'rgb-u8';data:ArrayBuffer};
type State={hasBackgroundMask?:boolean;hasPhoto:boolean;hasResult:boolean;busy:boolean;blocked:boolean;closed:boolean;refine:boolean;
 phase?:string;modelRole?:string|null;resourceProgress?:{storedBytes:number;totalBytes:number}|null;resourceError?:string|null;inferenceError?:'device-lost'|null;
 modelId?:string;refineAvailable?:boolean;
 stageProgress?:{completedStages:number;totalStages:number}|null;
 lastFailure?:{phase:string|null;modelRole:string|null;code:string}|null};
type Options={kind:'transparent'}|{kind:'background';backgroundColor:number[]};
type Png={bytes:Uint8Array;width:number;height:number;mime:string;filename:string};
type Session={getState:()=>State;setPhoto:(image:Pixels)=>void;setModel?:(id:string)=>void;setRefine:(value:boolean)=>void;
 run:()=>Promise<{status:string}>;save:(options:Options)=>Promise<{status:string}>;
 getPrepared:(options:Options)=>Png|null;cancel:()=>Promise<unknown>;close:()=>Promise<unknown>};
type ModelCacheInfo={foundFiles:number;expectedFiles:number;expectedBytes:number;missingBytes:number;downloadBytes?:number};
type StorageInfo={usageBytes:number;quotaBytes:number;availableBytes:number};
export type BackgroundRuntime={
 modelNoticesHref?:string;processingNotice?:string;
 models?:{id:string;label:string;description:string;processingNotice?:string;downloadDescription?:string}[];
 createSession:(onChange:(state:State)=>void)=>Session;
 // The release supplies the reference-compatible input Worker, using imageWorkGate.
 decodePhoto:(file:File,signal:AbortSignal)=>Promise<Pixels>;
 refineAvailable:boolean;downloadDescription:string;modelLabel?:string;
 inspectCache?:(modelId?:string,selection?:{refine:boolean;backgroundMaskAvailable:boolean})=>Promise<ModelCacheInfo>;
 clearCache?:(modelId?:string)=>Promise<void>;
 estimateStorage?:()=>Promise<StorageInfo>;
 checkEnvironment?:(modelId?:string)=>{mode:'cpu'|'gpu';missing:string[]};
};
const empty:State={hasPhoto:false,hasResult:false,busy:false,blocked:false,closed:false,refine:false};
type Props={active:boolean;runtime?:BackgroundRuntime;onCrop:(value:PhotoTransfer)=>void;onRevision:()=>void;
 onActivity:(value:EditorActivity)=>void};

function failureDetails(failure:State['lastFailure']){
 if(!failure)return '';
 const background=['hr','modnet','portrait','lite'].includes(failure.modelRole??'');
 const model=failure.modelRole==='matte'?t("輪郭補正モデル"):background?t("背景除去モデル"):t("モデル");
 const stages=new Map([
  ['model-load',t("{{v0}}の読み込み・検証",{v0:model})],['inference',failure.modelRole==='matte'?t("輪郭補正"):background?t("背景除去"):t("モデルの実行")],
  ['releasing',t("モデルの終了処理")],['trimap',t("輪郭補正範囲の作成")],['foreground',t("透過部分の色の調整")],['export',t("PNGの作成")],
 ]);
 return t(" 失敗した段階：{{v0}}（コード：{{v1}}）。",{v0:stages.get(failure.phase??'')??t("処理段階不明"),v1:workerFailure({},failure.code).code});
}

export function BackgroundEditor({active,runtime,onCrop,onRevision,onActivity}:Props){
 useTranslation();
 const session=useRef<Session|null>(null),epoch=useRef(0),pending=useRef<AbortController|null>(null);
 const candidate=useRef<File|null>(null),photoUrl=useRef<string|null>(null);
 const links=useRef<ReturnType<typeof createDownloadLinks>|null>(null),linkId=useRef<string|null>(null);
 const actionBusy=useRef(false);
 const [actionAtOutput,setActionAtOutput]=useState(false);
 const [state,setState]=useState(empty),[loading,setLoading]=useState(false),[acting,setActing]=useState(false);
 const [error,setErrorState]=useState<{message:string;location:'settings'|'output'}|null>(null);
 const [notice,setNotice]=useState(''),[photo,setPhoto]=useState<string|null>(null);
 const setError=(message:string,location:'settings'|'output'='settings')=>setErrorState(message?{message,location}:null);
 const [output,setOutput]=useState<{url:string;file:Png;kind:Options['kind']}|null>(null),[color,setColor]=useState('transparent'),[customColor,setCustomColor]=useState('#f5f3ef');
 const [replacing,setReplacing]=useState(false);
 const [cacheBusy,setCacheBusy]=useState(false),[cacheInfo,setCacheInfo]=useState<ModelCacheInfo|null>(null),[cacheNotice,setCacheNotice]=useState('');
 const [storageInfo,setStorageInfo]=useState<StorageInfo|null>(null),[storageChecked,setStorageChecked]=useState(false);
 const cacheEpoch=useRef(0);
 const [confirmRun,setConfirmRun]=useState(false);
 const [environmentMode,setEnvironmentMode]=useState<'cpu'|'gpu'|null>(null);
 const [preparationEstimate,setPreparationEstimate]=useState<{cache:ModelCacheInfo|null;storage:StorageInfo|null}|null>(null);
 const preparationCache=preparationEstimate?.cache,preparationStorage=preparationEstimate?.storage;
 const runIntent=useRef<{owner:Session;revision:number;options:Options;refine:boolean;backgroundMaskAvailable:boolean}|null>(null);
 const preparationTitle=useRef<HTMLHeadingElement>(null);
 function ensureSession(){
  if(!session.current){
   let owner:Session|null=null;
   owner=runtime!.createSession(value=>{if(owner&&session.current===owner)setState(value);});
   session.current=owner;
  }
  return session.current;
 }

 function dismissPreparation(){runIntent.current=null;setConfirmRun(false);cacheEpoch.current++;setCacheBusy(false);}
 const preparationDialog=useNativeDialog(confirmRun,dismissPreparation,preparationTitle);
 function requestRun(){
  if(!runtime||busy||actionBusy.current||!session.current||!state.hasPhoto||state.blocked||state.closed)return;
  setError('');setEnvironmentMode(null);
  try{const check=runtime.checkEnvironment?.(selectedModel?.id??state.modelId);if(check){
   if(check.missing.length){setError(t("このモデルに必要なブラウザ機能が見つかりません：{{v0}}。{{v1}}背景を変えずにサイズ調整へ進んでください。",{v0:check.missing.join('、'),v1:runtime.models&&runtime.models.length>1?t("写真は保持しています。別の背景除去モデルを選ぶか、"):t("対応する環境で開くか、")}));return;}
   setEnvironmentMode(check.mode);
  }}catch{setError(t("このモデルの端末条件を確認できませんでした。モデルを選び直して、もう一度お試しください。"));return;}
  if(!runtime.inspectCache){void prepare(true);return;}
  runIntent.current={owner:session.current,revision:epoch.current,options:options(),refine:state.refine,backgroundMaskAvailable:state.hasBackgroundMask===true};setConfirmRun(true);void manageCache(false,true);
 }
 async function acceptPreparation(){
  const intent=runIntent.current;if(!intent||busy||actionBusy.current)return;
  if(intent.owner!==session.current||intent.revision!==epoch.current||!active||state.blocked||state.closed){dismissPreparation();return;}
  const ticket=++cacheEpoch.current;
  setCacheBusy(true);setCacheNotice('');
  const [cacheResult,storageResult]=await Promise.allSettled([
   Promise.resolve().then(()=>runtime?.inspectCache?.(selectedModel?.id??state.modelId,{refine:intent.refine,backgroundMaskAvailable:intent.backgroundMaskAvailable})),
   Promise.resolve().then(()=>runtime?.estimateStorage?.())
  ]);
  if(ticket!==cacheEpoch.current||runIntent.current!==intent)return;
  const cache=cacheResult.status==='fulfilled'?cacheResult.value??null:null;
  const storage=storageResult.status==='fulfilled'?storageResult.value??null:null;
  setPreparationEstimate({cache,storage});setCacheBusy(false);
  if((preparationCache&&(!cache||cache.missingBytes>preparationCache.missingBytes))||(cache&&storage&&storage.availableBytes<cache.missingBytes)){
   setCacheNotice(t("保存状況が変わりました。取得量と空き容量を確認してください。"));return;
  }
  runIntent.current=null;setConfirmRun(false);preparationDialog.close();
  if(intent.owner!==session.current||intent.revision!==epoch.current||!active||state.blocked||state.closed)return;
  void prepare(true,intent.options);
 }

 const activityBusy=loading||acting||state.busy,busy=activityBusy||cacheBusy;
 const [elapsedSeconds,setElapsedSeconds]=useState(0);
 useEffect(()=>{
  if(!activityBusy){setElapsedSeconds(0);return;}
  const started=performance.now();setElapsedSeconds(0);
  const timer=setInterval(()=>setElapsedSeconds(Math.max(0,Math.floor((performance.now()-started)/1000))),1000);
  const stop=()=>clearInterval(timer);addEventListener('pagehide',stop);
  return()=>{stop();removeEventListener('pagehide',stop);};
 },[activityBusy]);
 const progressLabel=state.phase==='model-load'?t("{{v0}}モデルを読み込み・検証しています…",{v0:state.modelRole==='matte'?t("輪郭補正"):t("背景除去")})
  :state.phase==='inference'?t("{{v0}}しています…{{v1}}",{v0:state.modelRole==='matte'?t("輪郭を補正"):t("背景を除去"),v1:state.modelRole==='hr'&&state.stageProgress?`（${state.stageProgress.completedStages} / ${state.stageProgress.totalStages}）`:''})
  :state.phase==='trimap'?t("輪郭補正の範囲を作っています…"):state.phase==='foreground'?t("透過部分の色を整えています…")
  :state.phase==='releasing'||state.phase==='stopping'?t("処理の終了を待っています…"):t("PNGを作成しています…");
 async function manageCache(remove:boolean,forPreparation=false){
  if(!runtime||busy)return;const ticket=++cacheEpoch.current;setCacheBusy(true);setCacheNotice('');
  if(forPreparation)setPreparationEstimate(null);else{setCacheInfo(null);setStorageInfo(null);setStorageChecked(false);}
  let removed=false;try{
   if(remove){await runtime.clearCache?.(selectedModel?.id??state.modelId);removed=true;if(ticket!==cacheEpoch.current)return;setCacheNotice(t("使用中モデルの保存データを削除しました。次の実行時にモデルを再取得します。"));}
   const id=selectedModel?.id??state.modelId;
   const [cacheResult,storageResult]=await Promise.allSettled([forPreparation?runtime.inspectCache?.(id,{refine:state.refine,backgroundMaskAvailable:state.hasBackgroundMask===true}):runtime.inspectCache?.(id),runtime.estimateStorage?.()]);
   if(ticket!==cacheEpoch.current)return;
   const cache=cacheResult.status==='fulfilled'?cacheResult.value??null:null,storage=storageResult.status==='fulfilled'?storageResult.value??null:null;
   if(forPreparation)setPreparationEstimate({cache,storage});else{setCacheInfo(cache);setStorageInfo(storage);setStorageChecked(true);}
   if(cacheResult.status==='rejected')throw cacheResult.reason;
  }catch{if(ticket===cacheEpoch.current)setCacheNotice(removed?t("削除は完了しましたが、保存状況を確認できませんでした。"):t("モデルの保存データを操作できませんでした。他の画像処理が終わってから、もう一度お試しください。"));}
  finally{if(ticket===cacheEpoch.current)setCacheBusy(false);}
 }

 const selectedModel=runtime?.models?.find(item=>item.id===state.modelId)??runtime?.models?.[0];
 const processingNotice=selectedModel?selectedModel.processingNotice:runtime?.processingNotice;
 const options=():Options=>color==='transparent'?{kind:'transparent'}:{kind:'background',backgroundColor:color==='custom'?[parseInt(customColor.slice(1,3),16),parseInt(customColor.slice(3,5),16),parseInt(customColor.slice(5,7),16)]:color==='white'?[255,255,255]:color==='blue'?[67,142,219]:[220,50,50]};
 function clearOutput(){if(linkId.current)links.current?.release(linkId.current,'background-view');linkId.current=null;setOutput(null);epoch.current++;onRevision();}
 function changeColorOutput(){if(output?.kind==='transparent'){epoch.current++;onRevision();}else clearOutput();}
 function beginDownload(){try{if(!linkId.current)throw Error();links.current?.beginDownload(linkId.current,'background-view');return true;}catch{clearOutput();setNotice('');setError(t("保存用のPNGを確認できませんでした。写真と設定は保持しています。PNGを作り直してください。"),'output');return false;}}
 async function cancel(){
  const owner=session.current,generation=++epoch.current;
  const isCurrent=()=>session.current===owner&&epoch.current===generation;
  pending.current?.abort();setNotice(t("中止しています…終了の確認に時間がかかることがあります。"));
  try{await owner?.cancel();if(isCurrent())setNotice(t("処理を中止しました。写真を確認して、もう一度実行できます。"));}
  catch{if(isCurrent())setError(t("処理を終了できませんでした。保存済みファイルを確認し、ページを再読み込みしてください。"));}
 }
 useEffect(()=>{onActivity({busy:activityBusy,cancelling:state.phase==='stopping',label:loading?t("背景編集の写真を読み込んでいます…"):progressLabel,cancel:()=>{void cancel();}});},[activityBusy,loading,progressLabel,state.phase,onActivity]);
 useEffect(()=>{if(!active){candidate.current=null;setReplacing(false);dismissPreparation();}},[active]);
 useEffect(()=>{
  const clear=()=>{
   runIntent.current=null;setConfirmRun(false);cacheEpoch.current++;setCacheBusy(false);setCacheInfo(null);setStorageInfo(null);setStorageChecked(false);setPreparationEstimate(null);setCacheNotice('');
   epoch.current++;pending.current?.abort();pending.current=null;candidate.current=null;
   const previous=session.current;session.current=null;void previous?.close().catch(()=>{});
   if(photoUrl.current)URL.revokeObjectURL(photoUrl.current);photoUrl.current=null;
   links.current?.close();links.current=null;linkId.current=null;
   setPhoto(null);setOutput(null);setState(empty);setReplacing(false);
  };
  addEventListener('pagehide',clear);return()=>{removeEventListener('pagehide',clear);clear();};
 },[runtime]);
 useEffect(()=>{if(!photo)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};addEventListener('beforeunload',warn);return()=>removeEventListener('beforeunload',warn);},[!!photo]);
 async function choose(file:File){
  if(!runtime||busy)return;const generation=++epoch.current,controller=new AbortController();pending.current=controller;
  setActionAtOutput(false);setLoading(true);setError('');setNotice('');let nextUrl:string|undefined;
  try{
   const pixels=await runtime.decodePhoto(file,controller.signal);
   if(controller.signal.aborted||epoch.current!==generation)return;
   nextUrl=URL.createObjectURL(file);
   const owner=ensureSession();owner.setPhoto(pixels);
   if(photoUrl.current)URL.revokeObjectURL(photoUrl.current);photoUrl.current=nextUrl;nextUrl=undefined;
   setPhoto(photoUrl.current);clearOutput();setState(owner.getState());
  }catch(failure){if(!controller.signal.aborted){const code=(failure as {code?:string})?.code,keep=photo?(output?t("元の写真と作成済みPNGは保持しています。"):t("元の写真は保持しています。")):'';
   setError(code==='unsupported-browser'?t("写真の読み込みに必要なブラウザ機能がありません。端末情報を確認するか、対応するブラウザで開き直してください。{{v0}}",{v0:keep})
    :code==='image-file-too-large'?t("写真は20MiB以下のJPEG・PNGを選んでください。{{v0}}",{v0:keep})
    :code==='png-dimensions-too-large'?t("このPNGは現在の処理上限を超えています。各辺4,096px以内・400万画素以下のPNGを選んでください。{{v0}}",{v0:keep})
    :code==='image-dimensions-too-large'?t("写真の寸法が上限を超えています。JPEGは各辺16,384px以内・2,400万画素以下、PNGは各辺4,096px以内・400万画素以下で選んでください。{{v0}}",{v0:keep})
    :code==='unsupported-png-format'?t("このPNGの画素形式には対応していません。別のJPEG・PNGを選んでください。{{v0}}",{v0:keep})
    :['background-input-busy','resize-worker-busy'].includes(code??'')?t("ほかの画像処理が進行中です。完了するか中止してから、写真を選び直してください。{{v0}}",{v0:keep})
    :['background-input-stop-failed','resize-worker-stop-failed','background-input-unavailable','resize-worker-unavailable'].includes(code??'')?t("処理の終了を確認できませんでした。必要なファイルを保存してから、ページを再読み込みしてください。{{v0}}",{v0:keep})
    :['background-input-create-failed','resize-worker-create-failed'].includes(code??'')?t("写真を読み込む処理を開始できませんでした。端末情報を確認し、もう一度お試しください。{{v0}}",{v0:keep})
    :t("写真を読み込めませんでした。対応するJPEG・PNGを選んでください。{{v0}}",{v0:keep}));
  }}
  finally{if(nextUrl)URL.revokeObjectURL(nextUrl);if(pending.current===controller)pending.current=null;setLoading(false);}
 }
 function requestPhoto(file:File){if(photo){candidate.current=file;setReplacing(true);}else void choose(file);}
 async function prepare(run:boolean,selected:Options=options()){
  const owner=session.current;if(!owner||busy||actionBusy.current)return;actionBusy.current=true;clearOutput();const generation=epoch.current;
  setActionAtOutput(false);setActing(true);setError('');setNotice('');
  try{
   if(run&&(await owner.run()).status!=='committed')return;
   if(epoch.current!==generation)return;
   if((await owner.save(selected)).status!=='ready'||epoch.current!==generation)return;
   const file=owner.getPrepared(selected);if(!file)throw Error();
   links.current??=createDownloadLinks({getReady:(input:Options)=>session.current?.getPrepared(input)??null});
   const link=links.current.acquire(selected,'background-view');linkId.current=link.id;setOutput({url:link.url,file,kind:selected.kind});
   setNotice(t("PNGを作成しました。仕上がりを確認して保存、またはサイズ調整へ進んでください。"));
  }catch{if(epoch.current===generation){const failure=owner.getState(),reason=failure.inferenceError??failure.resourceError;
   setError((reason==='device-lost'?t("GPUとの接続が失われました。写真と設定は保持しています。もう一度実行してください。繰り返す場合は、端末情報を確認してください。")
    :reason==='cache-quota-exceeded'?t("モデルを保存する空き容量が足りません。モデルの保存データを削除するか、端末の空き容量を増やしてください。写真は保持しています。")
    :['checksum-mismatch','bytes-mismatch','bytes-overflow'].includes(reason??'')?t("モデルの内容を検証できませんでした。保存データを削除してから、もう一度実行してください。写真は保持しています。")
    :reason==='resource-rate-limited'?t("モデル配信先が取得を一時的に制限しています。しばらく待ってから、もう一度実行してください。写真と設定は保持しています。")
    :reason==='resource-access-denied'?t("モデル配信先から取得を拒否されました。写真と設定は保持しています。別のモデルを選んで試してください。")
    :reason==='transport-failed'?t("モデルを取得できませんでした。接続を確認して、もう一度実行してください。写真と設定は保持しています。")
    :t("処理を完了できませんでした。写真と設定を保持しています。実行用プログラムの取得に接続が必要な場合があります。接続と端末情報を確認して、もう一度実行してください。"))+failureDetails(failure.lastFailure));}}
  finally{actionBusy.current=false;setActing(false);if(session.current===owner)setState(owner.getState());}
 }
 async function transferToCrop(){
  const owner=session.current;if(!owner||!output||busy||actionBusy.current||state.blocked||state.closed)return;
  actionBusy.current=true;const generation=epoch.current;setActionAtOutput(true);setActing(true);setError('');setNotice('');
  const isCurrent=()=>epoch.current===generation&&session.current===owner&&!owner.getState().closed;
  try{
   let file=output.file;
   if(output.kind==='transparent'){
    const white:Options={kind:'background',backgroundColor:[255,255,255]};
    if(!owner.getPrepared(white)&&(await owner.save(white)).status!=='ready')return;
    if(!isCurrent())return;
    const prepared=owner.getPrepared(white);if(!prepared)throw Error();file=prepared;
   }
   if(isCurrent())onCrop({file:new File([new Uint8Array(file.bytes)],file.filename,{type:'image/png'}),isCurrent});
  }catch{if(isCurrent())setError(t("サイズ調整用のPNGを作成できませんでした。透過PNGはそのまま保存できます。もう一度お試しください。"),'output');}
  finally{actionBusy.current=false;setActing(false);if(session.current===owner)setState(owner.getState());}
 }
 const feedbackAtOutput=actionAtOutput&&!!output&&!cacheBusy;
 const operationFeedback=<>
    {activityBusy&&<button disabled={state.phase==='stopping'} onClick={()=>{void cancel();}}>{t(state.phase==='stopping'?t("中止しています…"):t("中止"))}</button>}
  {busy&&<p role="status">{t(cacheBusy?t("モデルの保存データを操作しています…"):loading?t("写真を読み込んでいます…"):progressLabel)}</p>}
  {activityBusy&&<p aria-live="off">{t("経過時間：")}{elapsedSeconds}{t("秒。読み込み・処理・終了待ちを含みます。残り時間の予測ではありません。")}</p>}
  {activityBusy&&state.phase==='model-load' &&state.resourceProgress&&state.resourceProgress.totalBytes>0&&<p>{t("保存・検証済み")} {t((state.resourceProgress.storedBytes/1024/1024).toFixed(1))} / {t((state.resourceProgress.totalBytes/1024/1024).toFixed(1))} {t("MiB。完了したファイルごとに更新します。")}</p>}
  {notice&&<p role="status">{t(notice)}</p>}
 </>;
 return <div className="app background-editor mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8">
  <header><Brand/><div className="ml-auto flex flex-wrap items-center justify-end gap-3"><a className="text-sm" href="#/crop">{t("背景を変えずにサイズ調整")}</a><LanguageSwitcher/></div></header>
  <EditorNavigation current="background" backgroundAvailable={!!runtime}/>
  <main className="flex min-w-0 flex-col gap-6" aria-busy={busy}><section className="journey" aria-labelledby="background-title"><h1 id="background-title" tabIndex={-1}>{t("写真の背景を整える")}</h1>
   <ol aria-label={t("背景編集の手順")}><li aria-current={!photo?'step':undefined}>{t("1 写真を選ぶ")}</li><li aria-current={photo&&!output?'step':undefined}>{t("2 背景を除去・色を選ぶ")}</li><li aria-current={output?'step':undefined}>{t("3 PNG保存・サイズ調整へ")}</li></ol>
   <p>{t("Client-side processing：写真は端末内で処理します。")}</p>
  </section>
  {!runtime?<section className="output-panel background-notice" role="status"><h2>{t("背景編集は準備中です")}</h2><p>{t("モデルの配布と動作確認が完了していないため、まだ写真の読み込みや背景処理は開始できません。")}</p><p>{t("背景を変えずにサイズ調整・PNG/PDFの作成は利用できます。")}</p><a className="primary-link" href="#/crop">{t("サイズ調整へ進む")}</a><a className="secondary-link" href="#/print">{t("加工済み写真を印刷する")}</a></section>:<>
   <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]"><section className="panel" aria-label={t("背景編集の設定")}><h2>{t("写真と背景")}</h2>


    <p className="hint">{t("JPEG・PNG / 20MiBまで。出力は長辺最大2000px。")}</p>
    <label className={`file-button${state.hasPhoto?' secondary':''}`}>{t(state.hasPhoto?t("写真を選び直す"):t("写真を選ぶ"))}<input aria-label={t("背景編集の写真を選ぶ")} type="file" accept="image/jpeg,image/png" disabled={busy||state.blocked||state.closed} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)requestPhoto(file);}}/></label>
    {runtime.models&&runtime.models.length>1?<><label>{t("背景除去モデル")}<select value={selectedModel?.id} disabled={busy||state.blocked||state.closed} onChange={event=>{
     if(event.target.value===state.modelId)return;
     try{const owner=ensureSession();if(!owner.setModel)throw Error('model-switch-unavailable');owner.setModel(event.target.value);cacheEpoch.current++;setCacheInfo(null);setStorageInfo(null);setStorageChecked(false);setPreparationEstimate(null);setCacheNotice('');clearOutput();setState(owner.getState());setError('');setNotice(t("モデルを切り替えました。写真と背景色は保持しています。背景除去を実行してください。"));}catch{setError(t("モデルを切り替えられませんでした。処理の終了を待って、もう一度お試しください。"));}
    }}>{runtime.models.map(model=><option key={model.id} value={model.id}>{t(model.label)}</option>)}</select></label><p className="model-description">{t(selectedModel?.description)}</p></>:runtime.modelLabel&&<p>{t("使用モデル：")}{t(runtime.modelLabel)}</p>}

   <details className="model-settings"><summary>{t("モデルと保存データ")}</summary><div className="disclosure-content">

   <p className="background-notice">{t(selectedModel?.downloadDescription??runtime.downloadDescription)} {t("初回のモデル取得通信は発生します。写真は送信しません。")}</p>
   {runtime.inspectCache&&<><button disabled={busy} onClick={()=>{void manageCache(false);}}>{t("保存状況を確認")}</button>{(cacheInfo||storageChecked)&&<div role="status">{cacheInfo&&<><p>{t("キャッシュ内ファイル")} {cacheInfo.foundFiles} / {cacheInfo.expectedFiles}{t("（実行時に内容を検証します）")}</p><p>{t(cacheInfo.downloadBytes===undefined?t("未保存モデル資源の取得見積り：約{{v0}}MiB",{v0:Math.ceil(cacheInfo.missingBytes/1024/1024)}):t("モデルのダウンロード見積り：約{{v0}}MiB",{v0:Math.ceil(cacheInfo.downloadBytes/1024/1024)}))}</p>{cacheInfo.downloadBytes!==undefined&&<p className="hint">{t("一部が未保存の場合も、まとめたファイル全体を再取得します。ダウンロード容量と追加の保存容量は異なります。")}</p>}<p className="hint">{t("URLの保存状況による見積りです。内容は実行時に照合します。実行用プログラムの取得通信は別途発生します。")}</p></>}{storageChecked&&(storageInfo?<><p>{t("ブラウザ保存領域の空き見積り：約")}{Math.floor(storageInfo.availableBytes/1024/1024)}MiB</p><p className="hint">{t("このサイトの保存領域の見積りで、保存成功を保証しません。空きRAM・VRAMの値ではありません。")}</p>{cacheInfo&&storageInfo.availableBytes<cacheInfo.missingBytes&&<p>{t("構成全体の未保存資源に対して、見積り上は保存領域が不足しています。保存データを整理するか、今回使う機能の取得量を開始前に確認してください。")}</p>}</>:<p>{t("ブラウザ保存領域の空き容量を取得できませんでした。容量は不明です。")}</p>)}</div>}{!confirmRun&&cacheNotice&&<p role="status">{t(cacheNotice)}</p>}{runtime.clearCache&&<details className="background-notice"><summary>{t("モデルの保存データを整理する")}</summary><p>{t("このモデル構成のキャッシュを削除します。写真と作成済みPNGは保持します。同じ資源を共有するモデル構成にも影響します。他のタブがモデルを使用中の場合は、再保存されることがあります。")}</p><button disabled={busy} onClick={()=>{void manageCache(true);}}>{t("使用中モデルの保存データを削除")}</button></details>}</>}
   {!runtime.inspectCache&&<p>{t("保存状況の事前確認には対応していません。必要なモデルは背景除去の実行時に取得・検証します。")}</p>}

   </div></details>

    {(state.refineAvailable??runtime.refineAvailable)?<label><input type="checkbox" checked={state.refine} disabled={busy||!state.hasPhoto||state.blocked||state.closed} onChange={event=>{session.current?.setRefine(event.target.checked);clearOutput();if(session.current)setState(session.current.getState());}}/>{t("髪や服の輪郭を補正する")}</label>:null}
    <label>{t("背景色")}<select value={color} disabled={busy} onChange={event=>{setColor(event.target.value);changeColorOutput();}}><option value="transparent">{t("透過")}</option><option value="white">{t("白")}</option><option value="blue">{t("青")}</option><option value="red">{t("赤")}</option><option value="custom">{t("色を指定")}</option></select></label>
    {color==='custom'&&<><label>{t("指定する背景色")}<input type="color" value={customColor} disabled={busy} onChange={event=>{if(!/^#[0-9a-f]{6}$/i.test(event.target.value))return;setCustomColor(event.target.value);changeColorOutput();}}/></label><p className="hint">{t("選択色：")}{t(customColor.toUpperCase())}</p></>}
    {processingNotice&&<p className="background-notice">{t(processingNotice)}</p>}
    <button className="primary" disabled={busy||!state.hasPhoto||state.blocked||state.closed} onClick={requestRun}>{t(state.hasBackgroundMask?(state.refine?t("輪郭を補正してPNGを作成"):t("補正せずにPNGを作成")):t("背景を除去してPNGを作成"))}</button>
    {state.hasResult&&<button disabled={busy||state.blocked} onClick={()=>{void prepare(false);}}>{t("選んだ背景でPNGを作成")}</button>}
    {state.hasResult&&color!=='transparent'&&<button disabled={busy||state.blocked} onClick={()=>{void prepare(false,{kind:'transparent'});}}>{t("透過PNGを作成")}</button>}
    {!feedbackAtOutput&&operationFeedback}
    {error?.location==='settings'&&<p role="alert">{t(error.message)}</p>}
   </section>
   <div className="grid min-w-0 gap-6"><section className="preview-region grid min-w-0 gap-3" aria-label={t("背景編集のプレビュー")}><h2>{t("仕上がりを確認")}</h2>{photo?(output?<BackgroundComparison key={output.url} original={photo} result={output.url} width={output.file.width} height={output.file.height}/>:<><img className="background-image" src={photo} alt={t("背景編集前の写真")}/><p className="hint">{t("元の写真")}</p></>):<div className="workspace"><div className="empty"><h3>{t("写真を選んではじめる")}</h3><p>{t("写真は端末内で処理します。")}</p></div></div>}</section>
   {output&&<section className="output-panel" aria-label={t("背景編集の保存")}><p>{t("保存するPNG：")}{t(output.kind==='transparent'?t("透過"):t("背景付き"))}{t("・")}{output.file.width} × {output.file.height} px</p><a className="primary-link" href={output.url} download={output.file.filename} onClick={event=>{if(!beginDownload())event.preventDefault();}} onAuxClick={event=>{if(!beginDownload())event.preventDefault();}} onContextMenu={event=>{if(!beginDownload())event.preventDefault();}}>{t(output.kind==='transparent'?t("透過PNGを保存"):t("背景付きPNGを保存"))}</a><button disabled={busy||state.blocked||state.closed} onClick={()=>{void transferToCrop();}}>{t(output.kind==='transparent'?t("白背景にしてサイズ調整へ"):t("このPNGをサイズ調整へ"))}</button>{feedbackAtOutput&&operationFeedback}{error?.location==='output'&&<p role="alert">{t(error.message)}</p>}<p className="hint">{t("サイズ調整・印刷へ進むと、透過部分は白になります。")}</p></section>}
  </div></div></>}
  {!runtime&&operationFeedback}
  {error?.location==='output'&&!output&&<p role="alert">{t(error.message)}</p>}
  </main>
  <dialog ref={preparationDialog.ref} className="replace-dialog" aria-labelledby="background-preparation-confirm" onCancel={preparationDialog.onCancel} onKeyDown={preparationDialog.onKeyDown}>
   {confirmRun&&<><h2 ref={preparationTitle} tabIndex={-1} id="background-preparation-confirm">{t("モデルを取得して処理しますか？")}</h2>
   <p>{t(selectedModel?.downloadDescription??runtime?.downloadDescription)}</p>
   <details><summary>{t("端末条件")}</summary><p>{t(environmentMode?t("{{v0}}モードの必須APIを検出しました。実際の対応・メモリ確保・処理成功は保証しません。実行時にも対応を確認します。",{v0:environmentMode==='cpu'?'CPU':'GPU'}):t("端末条件の事前確認には対応していません。実行時の確認で処理できない場合があります。"))}</p></details>
   {processingNotice&&<p className="background-notice">{t(processingNotice)}</p>}
   <p>{t("今回の処理：")}{t(runIntent.current?.backgroundMaskAvailable?(runIntent.current.refine?t("この写真の切り抜き情報を再利用して輪郭補正"):t("この写真の切り抜き情報を再利用（輪郭補正なし）")):(runIntent.current?.refine?t("背景除去と輪郭補正"):t("背景除去のみ")))}</p>
   {cacheBusy?<p role="status">{t("保存状況と容量を確認しています…")}</p>:<>
    <p>{t(preparationCache?t("今回の処理で未保存のモデル資源：約{{v0}}MiB",{v0:Math.ceil(preparationCache.missingBytes/1024/1024)}):t("保存状況を確認できませんでした。必要な取得量は不明です。"))}</p>
    {preparationCache?.downloadBytes!==undefined&&<p>{t("今回のモデルのダウンロード見積り：約")}{Math.ceil(preparationCache.downloadBytes/1024/1024)}MiB</p>}
    <p>{t(preparationStorage?t("ブラウザ保存領域の空き見積り：約{{v0}}MiB",{v0:Math.floor(preparationStorage.availableBytes/1024/1024)}):t("ブラウザ保存領域の空き容量は不明です。"))}</p>
    {preparationCache&&preparationStorage&&preparationStorage.availableBytes<preparationCache.missingBytes&&<p>{t("見積り上は保存領域が不足しています。戻って保存データを整理してください。")}</p>}
   </>}
   {cacheNotice&&<p role="status">{t(cacheNotice)}</p>}
   <details><summary>{t("通信・メモリについて")}</summary>
   {preparationCache&&<p>{t("保存データの削除・破損が見つかった場合、今回使うモデル資源の全量（約")}{Math.ceil(preparationCache.expectedBytes/1024/1024)}{t("MiB）を再取得することがあります。")}</p>}
   <p>{t("保存容量と、実行中に使うRAM（作業用メモリ）・GPUメモリ（VRAM）は別です。GPU推論でもRAMを使います。")}</p>
   <p>{t("保存済みデータも内容を検証します。実行用プログラムの通信は別途発生します。保存容量の見積りはRAM・VRAMや処理成功の保証ではありません。写真は送信しません。")}</p>
   </details>
   <div className="dialog-actions"><button onClick={preparationDialog.dismiss}>{t("写真と設定に戻る")}</button><button className="primary" disabled={busy||!!(preparationCache&&preparationStorage&&preparationStorage.availableBytes<preparationCache.missingBytes)} onClick={acceptPreparation}>{t("取得・検証して処理を始める")}</button></div></>}
  </dialog>
  <PhotoReplaceDialog open={replacing} onKeep={()=>{candidate.current=null;setReplacing(false);}} onReplace={()=>{const file=candidate.current;candidate.current=null;setReplacing(false);if(file)void choose(file);}} descriptionText={t("新しい写真に切り替えると、背景編集の結果と作成済みPNGを置き換えます。読み込みに失敗した場合は元の写真を保持します。")}/>
 </div>;
}
