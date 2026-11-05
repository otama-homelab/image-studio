import {useTranslation} from 'react-i18next';
import {t} from '../i18n';
import {useId,useRef,useState,type CSSProperties} from 'react';
import * as Slider from 'react-compare-slider/components';
import {useReactCompareSlider} from 'react-compare-slider/hooks';
import {TransformWrapper,TransformComponent,type ReactZoomPanPinchRef} from 'react-zoom-pan-pinch';

/** Display only: both libraries reuse the existing URLs without inference or encoding. */
export function BackgroundComparison({original,result,width,height,originalAlt=t("背景編集前の写真"),resultAlt=t("背景編集後の写真"),loading='eager'}:{original:string;result:string;width:number;height:number;originalAlt?:string;resultAlt?:string;loading?:'lazy'|'eager'}){
 useTranslation();
 const [position,setPosition]=useState(50),[zoom,setZoom]=useState('fit'),[scale,setScale]=useState(1),hint=useId();
 const transform=useRef<ReactZoomPanPinchRef|null>(null),viewport=useRef<HTMLDivElement|null>(null);
 const slider=useReactCompareSlider({onlyHandleDraggable:true,keyboardIncrement:'1%',transition:'none',onPositionChange:setPosition});
 const nativeScale=()=>width/(viewport.current?.clientWidth||width);
 function selectZoom(value:string){
  setZoom(value);
  if(value==='fit')transform.current?.resetTransform(0);
  else transform.current?.setTransform(0,0,nativeScale()*Number(value),0);
 }
 return <div className="background-comparison">
  <label>{t("プレビューの倍率")}<select value={zoom} onChange={event=>selectZoom(event.target.value)}><option value="fit">{t("全体を表示")}</option><option value="1">{t("100%（等倍）")}</option><option value="2">200%</option>{zoom==='custom'&&<option value="custom">{Math.round(scale/nativeScale()*100)}%</option>}</select></label>
  <div ref={viewport} className="background-comparison-viewport" style={{aspectRatio:`${width} / ${height}`,maxWidth:`${520*width/height}px`}} tabIndex={zoom==='fit'?-1:0} role="region" aria-label={t("背景比較の表示領域")}>
   <TransformWrapper ref={transform} minScale={.1} maxScale={16} smooth={false} wheel={{step:.12}} panning={{excluded:['comparison-handle-root','comparison-handle'],velocityDisabled:true}} keyboard={{disabled:false,animationTime:0,excluded:['comparison-handle-root','comparison-handle']}} doubleClick={{disabled:true}} zoomAnimation={{disabled:true}} autoAlignment={{disabled:true}} velocityAnimation={{disabled:true}} onTransform={(_,next)=>{
    setScale(next.scale);const native=nativeScale();setZoom(Math.abs(next.scale-1)<.001?'fit':Math.abs(next.scale-native)<.001?'1':Math.abs(next.scale-2*native)<.001?'2':'custom');
   }}>
    <TransformComponent wrapperClass="comparison-zoom-wrapper" wrapperProps={{role:'group','aria-label':t('画像の表示操作')}} wrapperStyle={{width:'100%',height:'100%'}} contentStyle={{width:'100%',height:'100%'}}>
     <Slider.Provider {...slider}><Slider.Root className="background-comparison-images" style={{width:'100%',height:'100%'}}>
      <Slider.Item item="itemOne" className="background-comparison-result"><Slider.Image src={result} alt={t(resultAlt)} loading={loading} style={{objectFit:'contain'}}/></Slider.Item>
      <Slider.Item item="itemTwo"><Slider.Image src={original} alt={t(originalAlt)} loading={loading} style={{objectFit:'contain'}}/></Slider.Item>
      <Slider.HandleRoot className="comparison-handle-root" aria-label={t("背景比較の境界線")} aria-describedby={hint}><Slider.Handle className="comparison-handle" style={{'--rcs-handle-color':'var(--color-text)'} as CSSProperties} buttonStyle={{backgroundColor:'var(--color-surface)',borderColor:'var(--color-border)',backdropFilter:'none',WebkitBackdropFilter:'none',boxShadow:'none'}} linesStyle={{boxShadow:'none'}}/></Slider.HandleRoot>
     </Slider.Root></Slider.Provider>
    </TransformComponent>
   </TransformWrapper>
  </div>
  <p id={hint}>{t("中央線をドラッグして比較。ホイール・ピンチで拡大縮小し、画像をドラッグして移動できます。")}</p>
  <p>{t("表示だけが変わります。保存寸法は変わりません。")}</p>
  <label>{t("仕上がりの表示範囲")}<input type="range" min="0" max="100" step="1" value={Math.round(position)} aria-describedby={hint} aria-valuetext={t(position===0?t("元の写真のみ"):position===100?t("仕上がりのみ"):t("左{{v0}}%が仕上がり、右{{v1}}%が元の写真",{v0:Math.round(position),v1:100-Math.round(position)}))} onChange={event=>slider.setPosition(Number(event.target.value))}/></label>
  <div className="background-comparison-actions"><button onClick={()=>slider.setPosition(0)}>{t("元の写真のみ")}</button><button onClick={()=>slider.setPosition(100)}>{t("仕上がりのみ")}</button><button onClick={()=>selectZoom('fit')}>{t("全体表示に戻す")}</button></div>
 </div>;
}
