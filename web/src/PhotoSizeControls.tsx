import {useId} from 'react';
import {photoPresets,usePhotoSize} from './usePhotoSize';
type SizeState=ReturnType<typeof usePhotoSize>;
export function PhotoSizeControls({value}:{value:SizeState}){
 const prefix=useId(),hint=`${prefix}-hint`;
 return <><h2>仕上がりサイズ</h2><label>用途<select value={value.preset} onChange={event=>value.select(Number(event.target.value))}>
  {photoPresets.map((preset,index)=><option key={index} value={index}>{preset.label}</option>)}<option value={photoPresets.length}>カスタムサイズ</option>
 </select></label>
 {value.customMode&&<fieldset className="custom-size"><legend>写真の寸法</legend>{(['width','height'] as const).map(axis=><div key={axis}><label>{axis==='width'?'幅 (mm)':'高さ (mm)'}<input type="text" inputMode="decimal" value={value.draft[axis]} aria-invalid={!!value.errors[axis]} aria-describedby={value.errors[axis]?`${prefix}-${axis}-error`:hint} onChange={event=>value.edit(axis,event.target.value)} onBlur={()=>value.commit(axis)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();value.commit(axis);}if(event.key==='Escape'){event.preventDefault();value.restore(axis);}}}/></label>{value.errors[axis]&&<p id={`${prefix}-${axis}-error`} className="error">{value.errors[axis]}</p>}</div>)}<p id={hint} className="hint">9〜152mm、0.1mm単位。Enterまたは欄を離れると反映し、Escapeで戻します。</p></fieldset>}
 </>;
}
