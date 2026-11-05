import {useEffect,useRef,type RefObject,type SyntheticEvent,type KeyboardEvent} from 'react';
function closeNode(node:HTMLDialogElement|null){
 if(!node?.open)return;
 if(typeof node.close==='function')node.close();else node.removeAttribute('open');
}
function available(node:HTMLElement|null):node is HTMLElement{
 return !!node?.isConnected&&!node.matches('body,:disabled')&&!node.closest('[hidden],[inert],dialog:not([open])');
}
/** Native dialog owns modality and normal focus restoration. Fallback stays non-modal. */
export function useNativeDialog(open:boolean,onDismiss:()=>void,initialFocus:RefObject<HTMLElement|null>){
 const ref=useRef<HTMLDialogElement>(null);
 const returnTo=useRef<{node:HTMLElement|null;fallback:boolean}|null>(null);
 const close=(restore=true)=>{
  const ownedFocus=!!ref.current?.contains(document.activeElement)||document.activeElement===document.body;
  const previous=returnTo.current;returnTo.current=null;closeNode(ref.current);
  if(!restore||!previous||!ownedFocus)return;
  const target=available(previous.node)?previous.fallback?previous.node:null:
   [...document.querySelectorAll<HTMLElement>('h1[tabindex="-1"]'),...document.querySelectorAll<HTMLElement>('main[tabindex="-1"]')].find(available);
  target?.focus({preventScroll:true});
 };
 const dismiss=()=>{close();onDismiss();};
 useEffect(()=>{
  const node=ref.current;if(!node)return;
  if(open&&!node.open){const fallback=typeof node.showModal!=='function';returnTo.current={node:document.activeElement instanceof HTMLElement?document.activeElement:null,fallback};if(!fallback)node.showModal();else node.setAttribute('open','');initialFocus.current?.focus({preventScroll:true});}
  else if(!open)close();
  const hide=()=>close(false);addEventListener('pagehide',hide);
  return()=>{removeEventListener('pagehide',hide);close();};
 },[open]);
 return {ref,close,dismiss,onCancel:(event:SyntheticEvent)=>{event.preventDefault();dismiss();},onKeyDown:(event:KeyboardEvent)=>{if(event.key==='Escape'&&typeof ref.current?.showModal!=='function'){event.preventDefault();dismiss();}}};
}
