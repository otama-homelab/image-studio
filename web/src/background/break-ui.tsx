import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BackgroundEditor,type BackgroundRuntime} from './BackgroundEditor';
import '../style.css';

// This entry is served by Vite only; it is not a production build input.
if(!import.meta.env.DEV)throw Error('Development fixture only');
const unused=()=>{throw Error('Inference is disabled in this UI fixture');};
const fixtures:Record<string,BackgroundRuntime|undefined>={
 demo:{createSession:unused,decodePhoto:unused,refineAvailable:false,downloadDescription:'約25MiB',modelLabel:'MODNet CPU',inspectCache:async()=>({foundFiles:1,expectedFiles:2,expectedBytes:26_214_400,missingBytes:13_107_200}),estimateStorage:async()=>({usageBytes:0,quotaBytes:536_870_912,availableBytes:536_870_912})},
 worst:{createSession:unused,decodePhoto:unused,refineAvailable:true,downloadDescription:'背景除去と輪郭補正の資源を初回に取得します。',models:[{id:'hr',label:'BiRefNet HR＋ViTMatte・CPU（高画質・処理に非常に時間がかかります）',description:'IMG_20250914_183022_HDR_portrait_edited_edited.HEIC のような長い名前の写真でも、写真は端末内で処理します。',processingNotice:'CPUでは非常に時間がかかります。参考時間は検証環境と写真の大きさによって変わります。'},{id:'modnet',label:'MODNet',description:'人物向け'}],inspectCache:async()=>({foundFiles:0,expectedFiles:1100,expectedBytes:1_379_863_652,missingBytes:1_379_863_652}),estimateStorage:async()=>({usageBytes:0,quotaBytes:1_048_576,availableBytes:1_048_576})},
 empty:undefined,
};
const ignore=()=>{};
function Fixture(){
 const [data,setData]=useState(()=>new URLSearchParams(location.search).get('data')??'demo');
 const selected=data in fixtures?data:'demo';
 return <><BackgroundEditor key={selected} active runtime={fixtures[selected]} onCrop={ignore} onRevision={ignore} onActivity={ignore}/>
 <fieldset style={{position:'fixed',bottom:8,left:'50%',transform:'translateX(-50%)',zIndex:20,background:'#eee',padding:8,maxWidth:'95vw'}}><legend>Development data</legend>{[['demo','Demo data'],['worst','Worst case'],['empty','Unavailable']].map(([value,label])=><button key={value} aria-pressed={selected===value} onClick={()=>{history.replaceState(null,'',`?data=${value}`);setData(value);}}>{label}</button>)}</fieldset></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
