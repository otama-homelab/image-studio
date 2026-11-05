import {useEffect,useRef,useState,useId,useImperativeHandle} from 'react';
import type {EditorActivity} from './editorActivity';
import {CropViewport} from './CropViewport';
import {useFraming} from './useFraming';
import {FramingControls} from './FramingControls';
import {usePhotoSize} from './usePhotoSize';
import {PhotoSizeControls} from './PhotoSizeControls';
import {PaperPreview} from './PaperPreview';
import {Brand,EditorNavigation} from './SiteChrome';
import {focusSection} from './navigation';
import {PhotoReplaceDialog} from './PhotoReplaceDialog';
import {decodePreview} from './decodePreview';
import {inspectImage as inspect} from './imageInput';
import {useCropSave} from './export/useCropSave';
import type {OutputOptions,PaperKind} from './export/types';
import {paperLayout} from '../../tools/browser-library-adapter/print-geometry.mjs';
import {photoPixels,cropBox} from '../../tools/browser-library-adapter/print-geometry.mjs';
import type {Ref} from 'react';
export type PhotoTransfer={file:File;isCurrent:()=>boolean};
export type EditorHandle={hasPhoto:()=>boolean;getCropArtifact:()=>PhotoTransfer|null;importPhoto:(file:File,isCurrent?:()=>boolean,origin?:()=>boolean)=>Promise<boolean|undefined>};
type Preview={id:number;url:string;width:number;height:number};
type HeldPreview={preview:Preview;file:Blob;origin:(()=>boolean)|null};
type Props={backgroundAvailable?:boolean;onSupport?:()=>void;onPrint?:(transfer:PhotoTransfer)=>void;onRevision?:()=>void;onRefreshOrigin?:()=>void;sessionRef?:Ref<EditorHandle>;onRecover?:(file:Blob)=>void;active?:boolean;requestedMode?:'crop'|'original';onNavigate?:(mode:'crop'|'original')=>void;onActivity?:(activity:EditorActivity)=>void};
export default function App({backgroundAvailable=false,active=true,requestedMode,onNavigate,onActivity,sessionRef,onRecover,onPrint,onRevision,onRefreshOrigin,onSupport}:Props={}){
 const prefix=useId();const section=(name:string)=>`${prefix}-${name}`;
 const [source,setSource]=useState<Preview|null>(null),[loadedId,setLoadedId]=useState<number|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[guides,setGuides]=useState(true);
 const [inputNotice,setInputNotice]=useState('');
 const [inputStage,setInputStage]=useState<'waiting'|'checking'>('checking');
 const inputProgress=inputStage==='waiting'?'前の処理の終了を待っています…':'画像を確認しています…';
 const [mode,setMode]=useState<'crop'|'original'>(requestedMode??'crop');
 const directPrint=mode==='original';
 const [outputKind,setOutputKind]=useState<'crop'|'paper-png'|'paper-pdf'>('crop'),[paper,setPaper]=useState<PaperKind>('l');
 const output:OutputOptions=outputKind==='crop'&&!directPrint?{kind:'crop',format:'png'}:{kind:'paper',paper,format:outputKind==='paper-pdf'?'pdf':'png'};
 const invalidateSave=useRef<()=>void>(()=>{});
 const dimensions=usePhotoSize(()=>invalidateSave.current());
 const {size,preset}=dimensions;
 const framing=useFraming(()=>invalidateSave.current());
 const [photoWidth,photoHeight]=photoPixels(size.width,size.height);
 const box=source&&loadedId===source.id?cropBox({width:source.width,height:source.height,outputWidth:photoWidth,outputHeight:photoHeight,...framing.value}):null;
 const selection=box?{x:box[0],y:box[1],width:box[2]-box[0],height:box[3]-box[1]}:null;
 const photoReady=!!source&&loadedId===source.id;
 const draftPending=!directPrint&&(dimensions.pending||framing.pending);
 const candidate=useRef<File|null>(null);
 const [replaceOpen,setReplaceOpen]=useState(false);
 const fileRef=useRef<Blob|null>(null),origin=useRef<(()=>boolean)|null>(null);
 const validOrigin=()=>!origin.current||origin.current();
 const upstreamStale=!validOrigin();
 const cropKey=JSON.stringify([source?.id,source?.width,source?.height,preset,size.width,size.height,framing.value,draftPending]);
 const cropRevision=useRef({key:cropKey,revision:0});if(cropRevision.current.key!==cropKey)cropRevision.current={key:cropKey,revision:cropRevision.current.revision+1};
 useEffect(()=>{onRevision?.();},[cropRevision.current.revision,onRevision]);
 function keepPhoto(){candidate.current=null;setReplaceOpen(false);}
 function requestPhoto(file:File){if(preview.current){candidate.current=file;setReplaceOpen(true);}else void choose(file);}
 function replacePhoto(){const file=candidate.current;keepPhoto();if(file)void choose(file);}
 useEffect(()=>{if(!active)keepPhoto();},[active]);
 useEffect(()=>{if(!source)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};addEventListener('beforeunload',warn);return()=>removeEventListener('beforeunload',warn);},[!!source]);
 const content=[source?.id,source?.width,source?.height,preset,size.width,size.height,framing.value,selection,draftPending,upstreamStale];
 // Three fixed output slots reuse the same save/link ownership.
 const cropSave=useCropSave(JSON.stringify([mode,'crop',...content]),validOrigin);
 const paperPngSave=useCropSave(JSON.stringify([mode,'paper-png',...content,paper]),validOrigin);
 const paperPdfSave=useCropSave(JSON.stringify([mode,'paper-pdf',...content,paper]),validOrigin);
 const saves=[cropSave,paperPngSave,paperPdfSave];
 const save=output.kind==='crop'?cropSave:output.format==='pdf'?paperPdfSave:paperPngSave;
 const exportBusy=saves.some(value=>value.busy),exportCancelling=saves.some(value=>value.phase==='cancelling');
 function invalidateAll(){for(const value of saves)value.invalidate();}
 function cancelExport(){for(const value of saves)value.cancel();}
 invalidateSave.current=invalidateAll;
 const preview=useRef<Preview|null>(null),generation=useRef(0),pending=useRef<AbortController|null>(null),checking=useRef<ReturnType<typeof decodePreview>|null>(null);
 const held=useRef<HeldPreview|null>(null),awaitingView=useRef<number|null>(null),verifiedId=useRef<number|null>(null);
 const verifyingView=!!source&&awaitingView.current===source.id;
 useImperativeHandle(sessionRef,()=>({hasPhoto:()=>!!preview.current,importPhoto:choose,getCropArtifact}));
 function cancelInput(){generation.current++;pending.current?.abort();pending.current=null;if(awaitingView.current!==null)restorePreview(awaitingView.current);setBusy(false);setInputNotice('写真の読み込みを中止しました。編集中の写真と設定はそのままです。');}
 useEffect(()=>{if(requestedMode&&requestedMode!==mode){invalidateAll();setMode(requestedMode);if(requestedMode==='original'&&outputKind==='crop')setOutputKind('paper-png');}},[requestedMode]);
 useEffect(()=>{onActivity?.({busy:busy||verifyingView||exportBusy,cancelling:exportCancelling,label:busy?inputProgress:verifyingView?'写真の表示を確認しています…':exportCancelling?'中止しています。処理の終了を待っています…':'ファイルを作成しています…',cancel:()=>{if(busy||verifyingView)cancelInput();else cancelExport();}});},[busy,verifyingView,exportBusy,exportCancelling,inputProgress,onActivity]);
 useEffect(()=>{
  const clear=()=>{candidate.current=null;setReplaceOpen(false);generation.current++;pending.current?.abort();releasePreviews();setSource(null);setLoadedId(null);setBusy(false);setInputNotice('');};
  addEventListener('pagehide',clear);return()=>{removeEventListener('pagehide',clear);candidate.current=null;generation.current++;pending.current?.abort();releasePreviews();};
 },[]);
 function releasePreviews(){
  if(held.current)URL.revokeObjectURL(held.current.preview.url);held.current=null;
  if(preview.current)URL.revokeObjectURL(preview.current.url);
  preview.current=null;fileRef.current=null;origin.current=null;awaitingView.current=null;verifiedId.current=null;
 }
 function restorePreview(id:number){
  if(preview.current?.id!==id||awaitingView.current!==id)return false;
  URL.revokeObjectURL(preview.current.url);const previous=held.current;held.current=null;awaitingView.current=null;
  preview.current=previous?.preview??null;fileRef.current=previous?.file??null;origin.current=previous?.origin??null;verifiedId.current=previous?.preview.id??null;
  setSource(preview.current);setLoadedId(verifiedId.current);return !!previous;
 }
 function displayReady(id:number,width:number,height:number){
  if(preview.current?.id!==id||![width,height].every(value=>Number.isSafeInteger(value)&&value>0))return;
  if(awaitingView.current===id&&!validOrigin()){
   invalidateAll();const restored=restorePreview(id);
   setError(restored?'元の画像が変更されました。元の写真と調整内容は保持しています。最新画像を作り直してから渡してください。':'元の画像が変更されました。最新画像を作り直してから渡してください。');return;
  }
  if(awaitingView.current===id){if(held.current)URL.revokeObjectURL(held.current.preview.url);held.current=null;awaitingView.current=null;framing.reset();}
  verifiedId.current=id;const next={...preview.current,width,height};preview.current=next;setSource(next);setLoadedId(id);
 }
 function displayFailed(id:number){
  if(preview.current?.id!==id)return;invalidateAll();
  const wasCandidate=awaitingView.current===id,restored=restorePreview(id);
  if(!wasCandidate){verifiedId.current=null;setLoadedId(null);}
  setError(restored?'新しい写真を表示できませんでした。元の写真と調整内容は保持しています。':'画像を表示できませんでした。別のJPEG・PNGを選んでください。');
 }
 function getCropArtifact():PhotoTransfer|null{
  const file=cropSave.getPreparedFile();if(!file||file.filename!=='image-studio-crop-300dpi.png'||draftPending||!photoReady||!validOrigin())return null;
  const revision=cropRevision.current.revision,inputId=preview.current?.id;
  return {file:new File([file.bytes],file.filename,{type:file.mime}),isCurrent:()=>validOrigin()&&cropRevision.current.revision===revision&&preview.current?.id===inputId&&inputId!==undefined};
 }
 async function choose(file:File,isCurrent?:()=>boolean,fromOrigin?:()=>boolean){
  const id=++generation.current;pending.current?.abort();const controller=new AbortController();pending.current=controller;setInputStage('checking');setBusy(true);setError('');setInputNotice('');
  let ownCheck:ReturnType<typeof decodePreview>|undefined;
  try{
   // Reject bounded header failures before retiring valid output for the current photo.
   const metadata=await inspect(file,{signal:controller.signal});if(id!==generation.current||controller.signal.aborted)return;
   invalidateAll();setInputStage('waiting');
   for(const value of saves){await value.waitForIdle();if(id!==generation.current||controller.signal.aborted)return;}
   setInputStage('checking');
   // An aborted native decode must settle before the latest selection starts another.
   await checking.current?.catch(()=>{});if(id!==generation.current||controller.signal.aborted)return;
   const blob=new Blob([file],{type:metadata.type==='jpeg'?'image/jpeg':'image/png'});
   ownCheck=decodePreview(blob,metadata,{signal:controller.signal});checking.current=ownCheck;
   const decoded=await ownCheck;if(id!==generation.current||controller.signal.aborted||isCurrent?.()===false||fromOrigin?.()===false){URL.revokeObjectURL(decoded.url);return;}
   const previous=preview.current;
   if(previous&&verifiedId.current===previous.id&&fileRef.current)held.current={preview:previous,file:fileRef.current,origin:origin.current};
   else if(previous)URL.revokeObjectURL(previous.url);
   const next={id,...decoded};fileRef.current=blob;origin.current=fromOrigin??null;preview.current=next;awaitingView.current=id;verifiedId.current=null;setSource(next);setError('');setLoadedId(null);return true;
  }catch(cause){
   const code=(cause as Error)?.message;
   if(id===generation.current&&!controller.signal.aborted)setError(code==='png-dimensions-too-large'?`このPNGは現在の処理上限を超えています。各辺4,096px以内・総画素400万以下に縮小したPNGを選んでください。${preview.current?'元の写真と調整内容は保持しています。':''}`:code==='image-dimensions-too-large'?`この画像は寸法の上限を超えています。JPEGは各辺16,384px以内・総画素2,400万以下、PNGは各辺4,096px以内・総画素400万以下に縮小してください。${preview.current?'元の写真と調整内容は保持しています。':''}`:code==='image-file-too-large'?`この画像はファイル容量の上限を超えています。20MiB以内のJPEG・PNGを選んでください。${preview.current?'元の写真と調整内容は保持しています。':''}`:code==='preview-busy'?'ほかの画像処理が進行中です。完了するか中止してから、写真を選び直してください。':code==='preview-unavailable'||code==='preview-cleanup-failed'?'処理の終了を確認できませんでした。必要なファイルを保存してから、ページを再読み込みしてください。':`この画像を読み込めませんでした。20MiB以内のJPEG・PNGを選んでください。${preview.current?'元の写真と調整内容は保持しています。':''}`);
  }finally{if(checking.current===ownCheck)checking.current=null;if(id===generation.current){pending.current=null;setBusy(false);}}
 }
 const placedWidth=directPrint&&source?source.width:photoWidth,placedHeight=directPrint&&source?source.height:photoHeight;
 let layout:ReturnType<typeof paperLayout>|null=null;
 if(output.kind==='paper'){try{layout=paperLayout({paper:output.paper,photoWidth:placedWidth,photoHeight:placedHeight,dpi:null});}catch{/* Offer another paper/size without discarding the photo. */}}
 const paperDoesNotFit=!!source&&output.kind==='paper'&&!layout;
 return <div className="app mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8"><header><a className="skip" href={`#${section('editor')}`} onClick={event=>focusSection(event,section('editor'))}>編集へ移動</a><div><h1><Brand/></h1></div><span className="badge">プレビュー版</span></header>
  <EditorNavigation current={directPrint?'print':'crop'} backgroundAvailable={backgroundAvailable}/>
  <section className="journey flex flex-col gap-2" aria-labelledby={section('journey-title')}><h2 id={section('journey-title')} tabIndex={-1}>{directPrint?'写真を印刷する':'サイズを整える'}</h2><ol aria-label="作業手順"><li aria-current={!photoReady?'step':undefined}>1 写真を選ぶ</li><li aria-current={photoReady&&!exportBusy&&!save.link?'step':undefined}>2 {directPrint?'用紙と形式を選ぶ':'サイズと位置を調整'}</li><li aria-current={photoReady&&(exportBusy||save.link)?'step':undefined}>3 作成して保存</li></ol></section>
  <main className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]" id={section('editor')} tabIndex={-1}>
  <aside className="panel" id={section('settings')} aria-labelledby={section('settings-title')}><h2 id={section('settings-title')} tabIndex={-1}>写真と設定</h2><label className={`file-button${source?' secondary':''}`}>{source?'写真を選び直す':'写真を選ぶ'}<input type="file" accept="image/jpeg,image/png" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)requestPhoto(file);}}/></label><details><summary>写真の使い方</summary><label>写真の使い方<select aria-describedby={onNavigate?section('mode-hint'):undefined} value={mode} onChange={event=>{const next=event.target.value as typeof mode;if(onNavigate){onNavigate(next);return;}invalidateAll();setMode(next);if(next==='original'&&outputKind==='crop')setOutputKind('paper-png');}}><option value="crop">サイズを整える</option><option value="original">切り抜かずに印刷へ</option></select></label>{onNavigate&&<p id={section('mode-hint')} className="hint">サイズ調整と印刷の写真・設定は別々に保持します。切り替えるだけでは写真を移しません。</p>}
   </details><p role="status">{busy?inputProgress:verifyingView?'写真の表示を確認しています…':source?`${source.width} × ${source.height} px`:''}</p>{(busy||verifyingView)&&<button onClick={cancelInput}>読み込みを中止</button>}{inputNotice&&<p role="status" className="hint">{inputNotice}</p>}{error&&<div><p role="alert" className="error">{error}</p>{onSupport&&<button onClick={onSupport}>端末情報を確認</button>}</div>}
   {photoReady&&<a className="section-link" href={`#${section('preview-title')}`} onClick={event=>focusSection(event,section('preview-title'))}>写真と仕上がりを先に確認</a>}
   {photoReady&&<>{!directPrint&&<><PhotoSizeControls value={dimensions}/>
   <FramingControls control={framing} disabled={!selection||busy}/>
   <label className="guide-toggle"><input type="checkbox" checked={guides} onChange={event=>setGuides(event.target.checked)}/>顔位置の目安線を表示</label>
   {guides&&<p className="hint">線は顔位置の目安です。規格への適合を判定するものではなく、写真には保存されません。</p>}
   <p className="hint">ドラッグ・矢印キーで位置を調整</p>
   {selection&&<p className="hint">切り抜き範囲：約{Math.round(selection.width)} × {Math.round(selection.height)} px</p>}
   </>}
   {directPrint&&<details><summary>印刷サイズについて</summary><p className="hint">元の画素寸法で配置します。DPI情報がなければ300dpiで実寸を計算します。</p></details>}
   <h2>保存するもの</h2><label>形式<select value={directPrint&&outputKind==='crop'?'paper-png':outputKind} onChange={event=>setOutputKind(event.target.value as typeof outputKind)}>{!directPrint&&<option value="crop">切り抜き PNG</option>}<option value="paper-png">用紙に並べた PNG</option><option value="paper-pdf">用紙に並べた PDF</option></select></label>
   {output.format==='pdf'&&<p className="hint">PDF用プログラムは作成時に読み込みます。接続が必要な場合があります。写真は送信しません。</p>}
   {output.kind==='paper'&&<><label>用紙<select value={paper} onChange={event=>setPaper(event.target.value as PaperKind)}><option value="l">L判</option><option value="2l">2L判</option><option value="postcard">はがき</option><option value="a4">A4</option></select></label>
   </>}
   {upstreamStale&&<div className="save-recovery"><p role="alert" className="error">元の画像が変更されました。このプレビューは以前の画像です。サイズ調整でPNGを作り直し、最新画像を反映してください。</p>{onRefreshOrigin&&<button onClick={onRefreshOrigin}>最新画像を反映</button>}{onNavigate&&<button onClick={()=>onNavigate('crop')}>サイズ調整で作り直す</button>}</div>}
   {paperDoesNotFit&&<p role="alert" className="error">この寸法の写真は用紙に収まりません。用紙または写真の寸法を変更してください。</p>}
   </>}
   {photoReady&&<a className="section-link" href={`#${section('preview-title')}`} onClick={event=>focusSection(event,section('preview-title'))}>プレビューで確認する</a>}
  </aside>
  <div className="review-column grid min-w-0 gap-6"><div className="preview-region grid min-w-0 gap-3"><h2 id={section('preview-title')} tabIndex={-1}>仕上がりを確認</h2><section className="workspace" aria-label="写真プレビュー" aria-busy={busy||verifyingView}>
   {source&&active?(directPrint?<img key={source.id} className="original-preview" src={source.url} alt="印刷する写真" onLoad={event=>{const image=event.currentTarget;displayReady(source.id,image.naturalWidth,image.naturalHeight);}} onError={()=>displayFailed(source.id)}/>:<CropViewport key={source.id} image={source.url} outputWidth={photoWidth} outputHeight={photoHeight} frame={framing.value} guides={guides} squareGuide={preset===3} invalidate={invalidateAll} onMove={next=>{if(preview.current?.id===source.id)framing.move(next);}} onReady={(width,height)=>displayReady(source.id,width,height)} onError={()=>displayFailed(source.id)}/>):<div className="empty"><h3>選んだ写真がここに表示されます</h3><p>JPEG・PNG、20MiBまで</p><p>写真は外部へ送信しません。</p></div>}
  </section>
   {photoReady&&layout&&<><PaperPreview layout={layout} picture={source&&loadedId===source.id&&selection?{url:source.url,width:source.width,height:source.height,crop:directPrint?{x:0,y:0,width:source.width,height:source.height}:selection}:undefined} pngUrl={!upstreamStale&&!draftPending&&save.link?.mime==='image/png'?save.link.url:undefined}/><p className="hint">{layout.count}枚を自動配置・余白5mm／間隔3mm</p></>}
   {photoReady&&<a className="section-link" href={`#${section('settings-title')}`} onClick={event=>focusSection(event,section('settings-title'))}>設定へ戻る</a>}
  </div>
  {photoReady&&<section className="output-panel" aria-labelledby={section('output-title')}><h2 id={section('output-title')} tabIndex={-1}>作成して保存</h2>
   <button disabled={!source||!selection||draftPending||paperDoesNotFit||upstreamStale||busy||exportBusy} className={save.link?'secondary':'primary'} onClick={()=>{if(!validOrigin()||!fileRef.current||!source||!selection||draftPending||paperDoesNotFit)return;if(directPrint){if(output.kind==='paper')void save.prepare({mode:'original',file:fileRef.current,sourceWidth:source.width,sourceHeight:source.height,output});}else{void save.prepare({mode:'crop',file:fileRef.current,crop:selection,width:photoWidth,height:photoHeight,sourceWidth:source.width,sourceHeight:source.height,output});}}}>{exportBusy?'作成しています…':output.format==='pdf'?'PDFを作成':'PNGを作成'}</button>
   {draftPending&&<p className="hint">入力中の数値を確定すると作成できます。「設定へ戻る」から確認してください。</p>}
   {save.error&&<div className="save-recovery"><p role="alert" className="error">{save.error}</p>{onSupport&&<button onClick={onSupport}>端末情報を確認</button>}{directPrint&&save.recovery==='crop'&&<button onClick={()=>{if(onRecover&&fileRef.current){onRecover(fileRef.current);return;}if(onNavigate){onNavigate('crop');return;}invalidateAll();setMode('crop');}}>サイズを整えるへ</button>}</div>}
   {output.kind==='paper'&&!upstreamStale&&<>{output.format==='pdf'&&paperPngSave.link&&<button onClick={()=>setOutputKind('paper-png')}>作成済みPNGに切り替える</button>}{output.format==='png'&&paperPdfSave.link&&<button onClick={()=>setOutputKind('paper-pdf')}>作成済みPDFに切り替える</button>}</>}
   {save.phase==='stale'&&<p role="status" className="hint">保存用ファイルを作り直すと、最新の設定で保存できます。</p>}
   {save.phase==='cancelled'&&<p role="status" className="hint">作成を中止しました。写真と設定はそのままです。もう一度作成できます。</p>}
   {save.link&&<p role="status" className="hint">ファイルの準備ができました。下の「{output.format==='pdf'?'PDF':'PNG'}を保存」で端末に保存してください。</p>}
   {exportBusy&&<><p role="status">{exportCancelling?'中止しています。処理の終了を待っています…':'保存用ファイルを作っています…'}</p><button disabled={exportCancelling} onClick={cancelExport}>{exportCancelling?'中止しています…':'中止'}</button></>}
   {save.link&&!upstreamStale&&!draftPending&&<a className="download" href={save.link.url} download={save.link.filename} onClick={event=>{if(!validOrigin()||!save.beginDownload())event.preventDefault();}} onAuxClick={event=>{if(!validOrigin()||!save.beginDownload())event.preventDefault();}} onContextMenu={event=>{if(!validOrigin()||!save.beginDownload())event.preventDefault();}}>{output.format==='pdf'?'PDFを保存':'PNGを保存'}</a>}
   {save.link&&!upstreamStale&&output.kind==='crop'&&<button onClick={()=>{if(onPrint){const transfer=getCropArtifact();if(transfer)onPrint(transfer);return;}setOutputKind('paper-png');}}>このサイズで用紙に並べる</button>}
   {!directPrint&&<p className="hint">{size.width} × {size.height} mm・{photoWidth} × {photoHeight} px・300dpi。作成後に保存できます。</p>}{directPrint&&source&&<p className="hint">300dpiなら約{(source.width*25.4/300).toFixed(1)} × {(source.height*25.4/300).toFixed(1)} mmです。</p>}{output.kind==='paper'&&<details className="hint"><summary>印刷時の注意</summary><p>保存したPNG/PDFを開き、選択した用紙と同じ用紙サイズで印刷してください。「実際のサイズ（100%）」を選び、「用紙に合わせる」などの自動拡大・縮小はオフにします。</p><p>最初の1枚は写真の縦・横を定規で測り、指定した寸法になっているか確認してください。画面上のプレビューは実寸表示ではありません。</p></details>}
  </section>}
  </div></main><PhotoReplaceDialog open={replaceOpen&&active} onKeep={keepPhoto} onReplace={replacePhoto}/></div>;
}
