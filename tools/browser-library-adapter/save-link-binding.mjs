/** Native anchor binding. Caller invokes refresh after every source/options change. */
export function bindSaveLink({anchor,control,pageTarget,onPageHide=()=>{}}){
 let closed=false;
 const clear=()=>{anchor.removeAttribute('href');anchor.removeAttribute('download');anchor.setAttribute('aria-disabled','true');};
 const show=link=>{
  if(!link){clear();return;}
  anchor.setAttribute('href',link.url);anchor.setAttribute('download',link.filename);anchor.setAttribute('aria-disabled','false');
 };
 const activate=event=>{
  if(closed){event.preventDefault();return;}
  // Keep this synchronous: native download remains in the user's activation.
  let link;try{link=control.beginDownload();}catch{}
  show(link);if(!link)event.preventDefault();
 };
 const close=()=>{
  if(closed)return;closed=true;clear();
  anchor.removeEventListener('click',activate,true);anchor.removeEventListener('auxclick',activate,true);anchor.removeEventListener('contextmenu',activate,true);
  pageTarget?.removeEventListener('pagehide',pagehide);
 };
 const pagehide=()=>{close();control.close();onPageHide();};
 anchor.addEventListener('click',activate,true);anchor.addEventListener('auxclick',activate,true);anchor.addEventListener('contextmenu',activate,true);
 pageTarget?.addEventListener('pagehide',pagehide);
 clear();
 return Object.freeze({
  refresh(){if(closed)return;control.reconcile();const state=control.getState();show(state.phase==='ready'?state.link:null);},
  close,
 });
}
