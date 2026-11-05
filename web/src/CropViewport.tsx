import {useEffect,useRef,useState} from 'react';
import Cropper,{getInitialCropFromCroppedAreaPercentages,type Area,type MediaSize,type Size} from 'react-easy-crop';
import {cropBox} from '../../tools/browser-library-adapter/print-geometry.mjs';
import type {Framing} from './useFraming';
type Props={image:string;outputWidth:number;outputHeight:number;frame:Framing;guides:boolean;squareGuide:boolean;onMove:(frame:Framing)=>void;onReady:(width:number,height:number)=>void;onError:()=>void;invalidate:()=>void};
export function CropViewport(props:Props){
 const [media,setMedia]=useState<MediaSize|null>(null),[viewport,setViewport]=useState<{aspect:number;size:Size}|null>(null);
 const [crop,setCrop]=useState({x:0,y:0}),[zoom,setZoom]=useState(1);
 const interacting=useRef(false),imageRef=useRef<{current:HTMLImageElement|null}|null>(null);
 const aspect=props.outputWidth/props.outputHeight;
 useEffect(()=>{
  if(!media||!viewport||viewport.aspect!==aspect)return;
  const [x,y,right,bottom]=cropBox({width:media.naturalWidth,height:media.naturalHeight,outputWidth:props.outputWidth,outputHeight:props.outputHeight,...props.frame});
  const area={x:x/media.naturalWidth*100,y:y/media.naturalHeight*100,width:(right-x)/media.naturalWidth*100,height:(bottom-y)/media.naturalHeight*100};
  const next=getInitialCropFromCroppedAreaPercentages(area,media,0,viewport.size,1,10);
  setCrop(current=>Math.abs(current.x-next.crop.x)<1e-9&&Math.abs(current.y-next.crop.y)<1e-9?current:next.crop);
  setZoom(next.zoom);
 },[media,viewport,aspect,props.outputWidth,props.outputHeight,props.frame]);
 function moved(area:Area){
  if(!interacting.current||!media)return;
  const width=media.naturalWidth,height=media.naturalHeight;
  const cw=area.width*width/100,ch=area.height*height/100;
  const limit=(value:number,min=0)=>Math.min(100,Math.max(min,value));
  const next={range:limit(ch/Math.min(height,width/aspect)*100,10),horizontal:width-cw>1e-9?limit(area.x*width/(width-cw)):props.frame.horizontal,vertical:height-ch>1e-9?limit(area.y*height/(height-ch)):props.frame.vertical};
  if(Object.values(next).every(Number.isFinite))props.onMove(next);
 }
 return <Cropper image={props.image} crop={crop} zoom={zoom} minZoom={1} maxZoom={10} aspect={aspect}
  onCropChange={next=>{if(interacting.current)props.invalidate();setCrop(next);}} onZoomChange={setZoom}
  setMediaSize={next=>{if(Object.values(next).every(value=>Number.isFinite(value)&&value>0))setMedia(current=>current&&Object.keys(next).every(key=>current[key as keyof MediaSize]===next[key as keyof MediaSize])?current:next);}}
  onCropSizeChange={size=>{if(Object.values(size).every(value=>Number.isFinite(value)&&value>0))setViewport(current=>current?.aspect===aspect&&current.size.width===size.width&&current.size.height===size.height?current:{aspect,size});}}
  setImageRef={ref=>{imageRef.current=ref;}}
  onMediaLoaded={next=>{if(imageRef.current?.current?.src===props.image&&next.naturalWidth>0&&next.naturalHeight>0)props.onReady(next.naturalWidth,next.naturalHeight);}}
  onCropAreaChange={moved} onInteractionStart={()=>{interacting.current=true;props.invalidate();}} onInteractionEnd={()=>{interacting.current=false;}}
  classes={{cropAreaClassName:props.guides?`portrait-guide${props.squareGuide?' square-guide':''}`:''}}
  mediaProps={{alt:'選択した写真',onError:props.onError}} cropperProps={{role:'group','aria-label':'写真の切り抜き枠'}}
  zoomWithScroll={false} roundCropAreaPixels={false} cropShape="rect" showGrid={false}/>;
}
