import {t} from './i18n';
import {useState} from 'react';

export const photoPresets=[
 {label:t("履歴書・在留カード（30 × 40 mm）"),width:30,height:40},
 {label:t("パスポート・マイナンバー（35 × 45 mm）"),width:35,height:45},
 {label:t("運転免許（24 × 30 mm）"),width:24,height:30},
 {label:t("米国パスポート（50.8 × 50.8 mm）"),width:50.8,height:50.8},
];
export function usePhotoSize(invalidate:()=>void){
 const [preset,setPreset]=useState(0);
 const [custom,setCustom]=useState({width:30,height:40});
 const [draft,setDraft]=useState({width:'30',height:'40'});
 const customMode=preset===photoPresets.length;
 const size=customMode?custom:photoPresets[preset];
 const valid=(value:string)=>/^\d+(?:\.\d)?$/.test(value)&&Number(value)>=9&&Number(value)<=152;
 const errors={width:valid(draft.width)?'':t("幅は9〜152mm、0.1mm単位で入力してください。"),height:valid(draft.height)?'':t("高さは9〜152mm、0.1mm単位で入力してください。")};
 const pending=customMode&&(!!errors.width||!!errors.height||Number(draft.width)!==custom.width||Number(draft.height)!==custom.height);
 return {preset,size,draft,errors,customMode,pending,
  select(value:number){if(!Number.isInteger(value)||value<0||value>photoPresets.length)return;invalidate();setPreset(value);},
  edit(axis:'width'|'height',value:string){invalidate();setDraft(current=>({...current,[axis]:value}));},
  commit(axis:'width'|'height'){if(valid(draft[axis])){invalidate();setCustom(current=>({...current,[axis]:Number(draft[axis])}));}},
  restore(axis:'width'|'height'){setDraft(current=>({...current,[axis]:String(custom[axis])}));},
 };
}
