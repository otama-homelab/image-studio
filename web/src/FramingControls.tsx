import {useTranslation} from 'react-i18next';
import {t} from './i18n';
import {useId} from 'react';
import {axisMinimum,type FrameAxis,useFraming} from './useFraming';
const axes:Array<{axis:FrameAxis;label:string;low:string;high:string}>=[
 {axis:'range',label:t("写る範囲"),low:t("狭く"),high:t("広く")},
 {axis:'horizontal',label:t("横位置"),low:t("左へ"),high:t("右へ")},
 {axis:'vertical',label:t("縦位置"),low:t("上へ"),high:t("下へ")},
];
export function FramingControls({control,disabled}:{control:ReturnType<typeof useFraming>;disabled:boolean}){
 useTranslation();
 const prefix=useId(),hint=`${prefix}-hint`;
 return <fieldset className="framing" disabled={disabled}><legend>{t("写真の範囲と位置")}</legend>{axes.map(({axis,label,low,high})=>{
  const value=Math.round(control.value[axis]),min=axisMinimum(axis),id=`${prefix}-${axis}`,invalid=!control.valid(axis);
  return <div className="frame-field" key={axis}><label htmlFor={`${id}-slider`}>{t(label)}（%）</label>
   <input id={`${id}-slider`} type="range" min={min} max="100" step="1" value={value} aria-label={t(t("{{v0}}のスライダー",{v0:label}))} onChange={event=>control.adjust(axis,Number(event.target.value))} onKeyDown={event=>{if(event.key==='PageUp'||event.key==='PageDown'){event.preventDefault();control.adjust(axis,Math.max(min,Math.min(100,value+(event.key==='PageUp'?10:-10))));}}}/>
   <div className="frame-number"><button type="button" aria-label={t(t("{{v0}}を1%減らす（{{v1}}）",{v0:label,v1:low}))} disabled={value===min} onClick={()=>control.adjust(axis,Math.max(min,value-1))}><span aria-hidden="true">−</span></button><input type="text" inputMode="numeric" aria-label={t(t("{{v0}}の数値（%）",{v0:label}))} aria-invalid={invalid} aria-describedby={invalid?`${id}-error`:hint} value={control.drafts[axis]} onChange={event=>control.edit(axis,event.target.value)} onBlur={()=>control.commit(axis)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();control.commit(axis);}if(event.key==='Escape'){event.preventDefault();control.restore(axis);}}}/><button type="button" aria-label={t(t("{{v0}}を1%増やす（{{v1}}）",{v0:label,v1:high}))} disabled={value===100} onClick={()=>control.adjust(axis,Math.min(100,value+1))}><span aria-hidden="true">＋</span></button></div>
   {invalid&&<p className="error" id={`${id}-error`}>{min}{t("〜100の整数を入力してください。")}</p>}
  </div>;
 })}<p className="hint" id={hint}>{t("範囲を狭くすると写真が拡大されます。数値はEnterまたは欄を離れると反映し、Escapeで戻します。ドラッグ後の数値は概数です。")}</p><button type="button" onClick={control.reset}>{t("範囲と位置を戻す")}</button></fieldset>;
}
