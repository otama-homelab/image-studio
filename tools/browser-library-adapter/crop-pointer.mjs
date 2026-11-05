import {createCropDrag} from './crop-view.mjs';

/** Bind a borderless crop stage. Caller owns numeric controls, settings and touch-action CSS. */
export function bindCropPointer({element,getCrop,applyCrop,ResizeObserverClass=globalThis.ResizeObserver,onEnd=()=>{}}){
 let active=null,closed=false;
 const finish=()=>{
  const previous=active;active=null;
  if(previous)try{element.releasePointerCapture(previous.id);}catch{}
  if(previous&&!closed)onEnd();
 };
 const down=event=>{
  if(closed||active||event.isPrimary!==true||event.button!==0)return;
  let drag,bounds,settings;
  try{
   bounds=element.getBoundingClientRect();
   settings=getCrop();
   drag=createCropDrag(settings,{width:bounds.width,height:bounds.height},{x:event.clientX,y:event.clientY});
   element.setPointerCapture(event.pointerId);
  }catch{return;}
  active={id:event.pointerId,drag,width:bounds.width,height:bounds.height,horizontal:settings.horizontal??50,vertical:settings.vertical??50};
 };
 const move=event=>{
  if(!active||event.pointerId!==active.id)return;
  try{
   const job=active,next=job.drag.move(event.clientX,event.clientY);
   if(next.horizontal===job.horizontal&&next.vertical===job.vertical)return;
   applyCrop(next);job.horizontal=next.horizontal;job.vertical=next.vertical;
  }
  catch{finish();}
 };
 const up=event=>{
  if(!active||event.pointerId!==active.id)return;
  // pointerup may carry a final position for which no pointermove was delivered.
  move(event);finish();
 };
 const cancel=event=>{if(active&&event.pointerId===active.id)finish();};
 const handlers={pointerdown:down,pointermove:move,pointerup:up,pointercancel:cancel,lostpointercapture:cancel};
 for(const [type,handler] of Object.entries(handlers))element.addEventListener(type,handler);
 const observer=ResizeObserverClass?new ResizeObserverClass(()=>{
  if(!active)return;
  const bounds=element.getBoundingClientRect();
  if(bounds.width!==active.width||bounds.height!==active.height)finish();
 }):null;observer?.observe(element);
 return Object.freeze({
  /** Call before changing crop dimensions, replacing photos or moving to another screen. */
  end(){finish();},
  close(){if(closed)return;closed=true;finish();observer?.disconnect();for(const [type,handler] of Object.entries(handlers))element.removeEventListener(type,handler);},
  getState(){return Object.freeze({dragging:!!active,closed});},
 });
}
