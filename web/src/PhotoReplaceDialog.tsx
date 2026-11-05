import {useTranslation} from 'react-i18next';
import {t} from './i18n';
import {useRef,useId} from 'react';
import {useNativeDialog} from './useNativeDialog';

export function PhotoReplaceDialog({open,onKeep,onReplace,titleText=t("写真を置き換えますか？"),descriptionText=t("新しい写真に切り替えると、位置調整と作成済みファイルをリセットします。用途と仕上がりサイズは保持します。")}:{open:boolean;onKeep:()=>void;onReplace:()=>void;titleText?:string;descriptionText?:string}){
 useTranslation();
 const title=useId(),description=useId();
 const keep=useRef<HTMLButtonElement>(null),modal=useNativeDialog(open,onKeep,keep);
 return <dialog ref={modal.ref} className="replace-dialog" aria-labelledby={title} aria-describedby={description} onCancel={modal.onCancel} onKeyDown={modal.onKeyDown}>
  <h2 id={title}>{t(titleText)}</h2>
  <p id={description}>{t(descriptionText)}</p>
  <div className="dialog-actions"><button ref={keep} onClick={modal.dismiss}>{t("今の写真を続ける")}</button><button onClick={()=>{modal.close();onReplace();}}>{t("写真を置き換える")}</button></div>
 </dialog>;
}
