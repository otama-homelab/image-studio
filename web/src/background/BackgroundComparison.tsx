import {useTranslation} from 'react-i18next';
import {t} from '../i18n';
import {useId,useState,type CSSProperties} from 'react';
import * as Slider from 'react-compare-slider/components';
import {useReactCompareSlider} from 'react-compare-slider/hooks';

/** Display only: reuse the existing URLs; page scrolling stays native. */
export function BackgroundComparison({original,result,width,height,originalAlt=t("背景編集前の写真"),resultAlt=t("背景編集後の写真"),loading='eager'}:{original:string;result:string;width:number;height:number;originalAlt?:string;resultAlt?:string;loading?:'lazy'|'eager'}){
 useTranslation();
 const [position,setPosition]=useState(50),hint=useId();
 const slider=useReactCompareSlider({onlyHandleDraggable:true,keyboardIncrement:'1%',transition:'none',onPositionChange:setPosition});
 const valueText=position===0?t("元の写真のみ"):position===100?t("仕上がりのみ"):t("左{{v0}}%が仕上がり、右{{v1}}%が元の写真",{v0:Math.round(position),v1:100-Math.round(position)});
 return <div className="background-comparison">
  <div className="background-comparison-viewport" style={{aspectRatio:`${width} / ${height}`,maxWidth:`${520*width/height}px`}} role="region" aria-label={t("背景比較の表示領域")}>
     <Slider.Provider {...slider}><Slider.Root className="background-comparison-images" style={{width:'100%',height:'100%'}}>
      <Slider.Item item="itemOne" className="background-comparison-result"><Slider.Image src={result} alt={t(resultAlt)} loading={loading} style={{objectFit:'contain'}}/></Slider.Item>
      <Slider.Item item="itemTwo"><Slider.Image src={original} alt={t(originalAlt)} loading={loading} style={{objectFit:'contain'}}/></Slider.Item>
      <Slider.HandleRoot className="comparison-handle-root" aria-label={t("背景比較の境界線")} aria-describedby={hint} aria-valuetext={valueText}><Slider.Handle className="comparison-handle" style={{'--rcs-handle-color':'var(--color-text)'} as CSSProperties} buttonStyle={{backgroundColor:'var(--color-surface)',borderColor:'var(--color-border)',backdropFilter:'none',WebkitBackdropFilter:'none',boxShadow:'none'}} linesStyle={{boxShadow:'none'}}/></Slider.HandleRoot>
     </Slider.Root></Slider.Provider>
  </div>
  <p id={hint}>{t("中央線をドラッグ、または左右キーで比較")}</p>
 </div>;
}
