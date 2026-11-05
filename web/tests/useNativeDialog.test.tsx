import {useRef,useState} from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {useNativeDialog} from '../src/useNativeDialog';
const original=Object.fromEntries(['showModal','close'].map(key=>[key,Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,key)]));
let nativeClose:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 nativeClose=vi.fn(function(this:HTMLDialogElement){this.removeAttribute('open');});
 Object.defineProperties(HTMLDialogElement.prototype,{showModal:{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}},close:{configurable:true,value:nativeClose}});
});
afterEach(()=>{cleanup();for(const [key,value] of Object.entries(original)){if(value)Object.defineProperty(HTMLDialogElement.prototype,key,value);else Reflect.deleteProperty(HTMLDialogElement.prototype,key);}});
function Fixture({trigger=true,externalClose=false}:{trigger?:boolean;externalClose?:boolean}){
 const [open,setOpen]=useState(false),heading=useRef<HTMLHeadingElement>(null);
 const dialog=useNativeDialog(open&&!externalClose,()=>setOpen(false),heading);
 return <><div hidden><h1 tabIndex={-1}>非表示の画面</h1></div><main tabIndex={-1}><h1 tabIndex={-1}>現在の画面</h1>{trigger&&<button onClick={()=>setOpen(true)}>開く</button>}<button>別の操作</button><dialog ref={dialog.ref} onCancel={dialog.onCancel} onKeyDown={dialog.onKeyDown}><h2 ref={heading} tabIndex={-1}>補助情報</h2><button onClick={dialog.dismiss}>閉じる</button></dialog></main></>;
}
function fallback(){Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');Reflect.deleteProperty(HTMLDialogElement.prototype,'close');}
function open(){const trigger=screen.getByRole('button',{name:'開く'});trigger.focus();fireEvent.click(trigger);expect(document.activeElement).toBe(screen.getByRole('heading',{name:'補助情報'}));return trigger;}

test('non-modal fallback restores the opener on close and Escape without repeated cleanup stealing focus',()=>{
 fallback();const view=render(<Fixture/>);
 for(const escape of [false,true]){
  const trigger=open();if(escape)fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});else fireEvent.click(screen.getByRole('button',{name:'閉じる'}));
  expect(document.activeElement).toBe(trigger);expect(screen.queryByRole('dialog')).toBeNull();
  const other=screen.getByRole('button',{name:'別の操作'});other.focus();view.rerender(<Fixture/>);expect(document.activeElement).toBe(other);
 }
});
test('valid native opener restoration stays delegated to HTMLDialogElement.close',()=>{
 render(<Fixture/>);const trigger=open(),focus=vi.spyOn(trigger,'focus');fireEvent.click(screen.getByRole('button',{name:'閉じる'}));expect(nativeClose).toHaveBeenCalledOnce();expect(focus).not.toHaveBeenCalled();
});
test.each(['native','fallback'] as const)('%s close returns to the visible page heading when the opener disappears or becomes unavailable',mode=>{
 if(mode==='fallback')fallback();
 for(const unavailable of ['removed','hidden','disabled']){
  const view=render(<Fixture/>);const trigger=open();if(unavailable==='removed')view.rerender(<Fixture trigger={false}/>);else if(unavailable==='hidden')trigger.hidden=true;else (trigger as HTMLButtonElement).disabled=true;
  fireEvent.click(screen.getByRole('button',{name:'閉じる'}));expect(document.activeElement).toBe(screen.getByRole('heading',{name:'現在の画面'}));view.unmount();
 }
});
test('pagehide closes fallback without manually focusing a disappearing page',()=>{
 fallback();render(<Fixture/>);const trigger=open(),focus=vi.spyOn(trigger,'focus'),heading=vi.spyOn(screen.getByRole('heading',{name:'現在の画面'}),'focus');act(()=>window.dispatchEvent(new Event('pagehide')));expect(screen.queryByRole('dialog')).toBeNull();expect(focus).not.toHaveBeenCalled();expect(heading).not.toHaveBeenCalled();
});
test('external closure does not steal focus after the user moves outside a non-modal fallback',()=>{
 fallback();const view=render(<Fixture/>);open();const other=screen.getByRole('button',{name:'別の操作'});other.focus();view.rerender(<Fixture externalClose/>);expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(other);
});
