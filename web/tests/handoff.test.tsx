import {useEffect,useRef} from 'react';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import Root from '../src/Root';
import {PAPER_PIXELS} from '../../tools/browser-library-adapter/paper-contract.mjs';
const io=vi.hoisted(()=>({generate:vi.fn(),decode:vi.fn()}));
vi.mock('../src/export/client',()=>({createCropExportClient:()=>({generate:io.generate,close:async()=>{}})}));
vi.mock('../src/decodePreview',()=>({decodePreview:(...args:any[])=>io.decode(...args)}));
vi.mock('../../tools/browser-library-adapter/image-preflight.mjs',()=>({createImagePreflight:()=>async()=>({type:'png',width:400,height:400})}));
vi.mock('react-easy-crop',async importOriginal=>({...await importOriginal<typeof import('react-easy-crop')>(),default:function Cropper(props:any){
 const ref=useRef<HTMLImageElement|null>(null);
 useEffect(()=>{props.setImageRef(ref);props.setMediaSize({width:400,height:400,naturalWidth:400,naturalHeight:400});props.onCropSizeChange({width:300,height:400});props.onMediaLoaded({naturalWidth:400,naturalHeight:400});},[props.image]);
 return <img ref={ref} src={props.image} alt="crop fixture"/>;
}}));
const originalDialog=Object.fromEntries(['showModal','close'].map(key=>[key,Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,key)]));
beforeEach(()=>{
 let next=0;vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=>`blob:handoff-${++next}`),revokeObjectURL:vi.fn()}));
 Object.defineProperties(HTMLDialogElement.prototype,{showModal:{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}},close:{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}}});
 history.replaceState(null,'','#/crop');io.generate.mockReset();io.decode.mockReset();io.decode.mockImplementation(async(blob,metadata)=>({url:URL.createObjectURL(blob),width:metadata.width,height:metadata.height}));
 io.generate.mockImplementation(async input=>{
  const paper=input.output.kind==='paper',pdf=input.output.format==='pdf';
  const [width,height]=paper?PAPER_PIXELS[input.output.paper]:[input.width,input.height];
  return {bytes:new Uint8Array([1,2,3]),width,height,mime:pdf?'application/pdf':'image/png',filename:paper?`image-studio-paper-${input.output.paper}${pdf?'.pdf':'-300dpi.png'}`:'image-studio-crop-300dpi.png'};
 });
});
afterEach(()=>{cleanup();for(const [key,descriptor] of Object.entries(originalDialog)){if(descriptor)Object.defineProperty(HTMLDialogElement.prototype,key,descriptor);else Reflect.deleteProperty(HTMLDialogElement.prototype,key);}vi.unstubAllGlobals();});
const settings=()=>within(screen.getByRole('complementary',{name:'写真と設定'}));
const navigate=(mode:'crop'|'original')=>fireEvent.change(settings().getByLabelText('写真の使い方'),{target:{value:mode}});
async function upload(){fireEvent.change(settings().getByLabelText(/写真を選/),{target:{files:[new File(['synthetic'],'fixture.png',{type:'image/png'})]}});await waitFor(()=>expect(screen.getByRole('button',{name:'PNGを作成'})).toBeTruthy());}
async function prepare(){await waitFor(()=>expect((screen.getByRole('button',{name:'PNGを作成'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'PNGを作成'}));await screen.findByRole('link',{name:'PNGを保存'});}
async function loadPrint(){const image=await screen.findByAltText('印刷する写真');Object.defineProperties(image,{naturalWidth:{value:354},naturalHeight:{value:472}});fireEvent.load(image);return image.getAttribute('src');}

test('real save hook hands its current PNG to print, blocks stale source and refreshes explicitly',async()=>{
 render(<Root/>);await upload();await prepare();const cropUrl=screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href');fireEvent.click(screen.getByRole('button',{name:'このサイズで用紙に並べる'}));const printUrl=await loadPrint();expect(location.hash).toBe('#/print');expect(io.generate).toHaveBeenCalledTimes(1);const transferred=await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=()=>reject(Error('fixture-read-failed'));reader.readAsArrayBuffer(io.decode.mock.calls[1][0]);});expect(Array.from(new Uint8Array(transferred))).toEqual([1,2,3]);
 await prepare();const printDownload=screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href');expect(io.generate.mock.calls.at(-1)?.[0].mode).toBe('original');expect(io.generate.mock.calls.at(-1)?.[0].file.type).toBe('image/png');
 navigate('crop');await screen.findByAltText('crop fixture');expect(screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href')).toBe(cropUrl);fireEvent.click(settings().getByLabelText('顔位置の目安線を表示'));fireEvent.change(settings().getByLabelText('形式'),{target:{value:'paper-png'}});fireEvent.change(settings().getByLabelText('用紙'),{target:{value:'a4'}});navigate('original');await loadPrint();expect(screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href')).toBe(printDownload);expect(screen.queryByText(/このプレビューは以前の画像です/)).toBeNull();navigate('crop');await screen.findByAltText('crop fixture');fireEvent.change(settings().getByLabelText('形式'),{target:{value:'crop'}});fireEvent.change(screen.getByRole('slider',{name:'横位置のスライダー'}),{target:{value:'30'}});
 navigate('original');await loadPrint();await screen.findByText(/このプレビューは以前の画像です/);expect(screen.getByAltText('印刷する写真').getAttribute('src')).toBe(printUrl);expect(screen.queryByRole('link',{name:'PNGを保存'})).toBeNull();expect((screen.getByRole('button',{name:'PNGを作成'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'最新画像を反映'}));expect(screen.getByText(/サイズ調整でPNGを作り直してから/)).toBeTruthy();expect(io.generate).toHaveBeenCalledTimes(2);
 navigate('crop');await screen.findByAltText('crop fixture');fireEvent.change(screen.getByRole('slider',{name:'横位置のスライダー'}),{target:{value:'50'}});navigate('original');await loadPrint();expect(screen.getByText(/このプレビューは以前の画像です/)).toBeTruthy();navigate('crop');await screen.findByAltText('crop fixture');await prepare();navigate('original');await loadPrint();fireEvent.click(screen.getByRole('button',{name:'最新画像を反映'}));expect(screen.getByRole('dialog',{name:'印刷する写真を置き換えますか？'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));await waitFor(()=>expect(screen.getByAltText('印刷する写真').getAttribute('src')).not.toBe(printUrl));await loadPrint();expect(screen.queryByText(/このプレビューは以前の画像です/)).toBeNull();expect((screen.getByRole('button',{name:'PNGを作成'}) as HTMLButtonElement).disabled).toBe(false);
});

test('cancelled handoff leaves independent print photo and its file ready; source edits do not invalidate it',async()=>{
 render(<Root/>);await upload();await prepare();navigate('original');await screen.findByRole('heading',{name:'写真を印刷する'});fireEvent.change(settings().getByLabelText(/写真を選/),{target:{files:[new File(['print-only'],'print.png',{type:'image/png'})]}});const oldUrl=await loadPrint();await prepare();const oldDownload=screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href');
 navigate('crop');await screen.findByAltText('crop fixture');fireEvent.click(screen.getByRole('button',{name:'このサイズで用紙に並べる'}));expect(screen.getByRole('dialog',{name:'印刷する写真を置き換えますか？'})).toBeTruthy();const decodes=io.decode.mock.calls.length;fireEvent.click(screen.getByRole('button',{name:'今の写真を続ける'}));expect(location.hash).toBe('#/crop');expect(io.decode).toHaveBeenCalledTimes(decodes);
 fireEvent.change(screen.getByRole('slider',{name:'横位置のスライダー'}),{target:{value:'30'}});navigate('original');await loadPrint();expect(screen.getByAltText('印刷する写真').getAttribute('src')).toBe(oldUrl);expect(screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href')).toBe(oldDownload);expect(screen.queryByText(/このプレビューは以前の画像です/)).toBeNull();
});

test('source edits while the recipient decodes prevent late handoff adoption',async()=>{
 render(<Root/>);await upload();await prepare();let release!:(value:{url:string;width:number;height:number})=>void;io.decode.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));fireEvent.click(screen.getByRole('button',{name:'このサイズで用紙に並べる'}));await waitFor(()=>expect(io.decode).toHaveBeenCalledTimes(2));
 fireEvent.change(screen.getByRole('slider',{name:'横位置のスライダー'}),{target:{value:'30'}});await act(async()=>{release({url:'blob:stale-handoff',width:354,height:472});});expect(location.hash).toBe('#/crop');expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:stale-handoff');expect(screen.getByRole('alert').textContent).toContain('画像を渡せませんでした');
 navigate('original');await screen.findByRole('heading',{name:'写真を印刷する'});expect(screen.queryByAltText('印刷する写真')).toBeNull();expect(io.generate).toHaveBeenCalledTimes(1);
});

test('PNG and PDF remain separate, failure preserves the other format, and paper changes keep the crop',async()=>{
 render(<Root/>);await upload();await prepare();const cropUrl=screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href');
 fireEvent.change(settings().getByLabelText('形式'),{target:{value:'paper-png'}});expect(screen.queryByRole('link',{name:'PNGを保存'})).toBeNull();await prepare();const pngUrl=screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href');
 fireEvent.change(settings().getByLabelText('形式'),{target:{value:'paper-pdf'}});expect(screen.getByRole('button',{name:'作成済みPNGに切り替える'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'PDFを作成'}));const pdfUrl=(await screen.findByRole('link',{name:'PDFを保存'})).getAttribute('href');expect(io.generate).toHaveBeenCalledTimes(3);
 fireEvent.click(screen.getByRole('button',{name:'作成済みPNGに切り替える'}));expect(screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href')).toBe(pngUrl);fireEvent.click(screen.getByRole('button',{name:'作成済みPDFに切り替える'}));expect(screen.getByRole('link',{name:'PDFを保存'}).getAttribute('href')).toBe(pdfUrl);expect(io.generate).toHaveBeenCalledTimes(3);
 io.generate.mockRejectedValueOnce(Error('synthetic PDF failure'));fireEvent.click(screen.getByRole('button',{name:'PDFを作成'}));await screen.findByText('画像ファイルを作れませんでした。写真を確認して、もう一度お試しください。');expect(screen.queryByRole('link',{name:'PDFを保存'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'作成済みPNGに切り替える'}));expect(screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href')).toBe(pngUrl);expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(pngUrl);
 fireEvent.change(settings().getByLabelText('用紙'),{target:{value:'a4'}});expect(screen.queryByRole('link',{name:'PNGを保存'})).toBeNull();expect(screen.queryByRole('button',{name:'作成済みPDFに切り替える'})).toBeNull();expect(URL.revokeObjectURL).toHaveBeenCalledWith(pngUrl);
 fireEvent.change(settings().getByLabelText('形式'),{target:{value:'crop'}});expect(screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href')).toBe(cropUrl);expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(cropUrl);
 fireEvent.change(screen.getByRole('slider',{name:'横位置のスライダー'}),{target:{value:'30'}});expect(screen.queryByRole('link',{name:'PNGを保存'})).toBeNull();expect(URL.revokeObjectURL).toHaveBeenCalledWith(cropUrl);
});

test('switching format during export retains the pending task and prevents a second creation',async()=>{
 render(<Root/>);await upload();fireEvent.change(settings().getByLabelText('形式'),{target:{value:'paper-png'}});let finish!:(value:any)=>void;io.generate.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));fireEvent.click(screen.getByRole('button',{name:'PNGを作成'}));expect(io.generate).toHaveBeenCalledOnce();
 fireEvent.change(settings().getByLabelText('形式'),{target:{value:'paper-pdf'}});const button=screen.getByRole('button',{name:'作成しています…'}) as HTMLButtonElement;expect(button.disabled).toBe(true);fireEvent.click(button);expect(io.generate).toHaveBeenCalledOnce();expect(io.generate.mock.calls[0][1].aborted).toBe(false);
 await act(async()=>{finish({bytes:new Uint8Array([1,2,3]),width:1500,height:1051,mime:'image/png',filename:'image-studio-paper-l-300dpi.png'});});expect(screen.getByRole('button',{name:'作成済みPNGに切り替える'})).toBeTruthy();expect(screen.queryByRole('link',{name:'PDFを保存'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'作成済みPNGに切り替える'}));expect(screen.getByRole('link',{name:'PNGを保存'})).toBeTruthy();expect(io.generate).toHaveBeenCalledOnce();
});

test('cancelling PDF from the index preserves the already prepared PNG',async()=>{
 render(<Root/>);await upload();fireEvent.change(settings().getByLabelText('形式'),{target:{value:'paper-png'}});await prepare();const pngUrl=screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href');fireEvent.change(settings().getByLabelText('形式'),{target:{value:'paper-pdf'}});
 io.generate.mockImplementationOnce((_input,signal:AbortSignal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true})));fireEvent.click(screen.getByRole('button',{name:'PDFを作成'}));fireEvent.click(within(screen.getByRole('banner')).getByRole('link',{name:'Image Studio'}));await screen.findByRole('heading',{level:1,name:'写真を、使いたいかたちに。'});fireEvent.click(screen.getByRole('button',{name:'中止'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'中止'})).toBeNull());
 fireEvent.click(screen.getByRole('link',{name:'サイズを整える'}));await screen.findByAltText('crop fixture');expect(screen.getByText('作成を中止しました。写真と設定はそのままです。もう一度作成できます。')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'作成済みPNGに切り替える'}));expect(screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href')).toBe(pngUrl);expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(pngUrl);
});

test('unavailable PDF module gives a connection recovery message while prepared PNG remains usable',async()=>{
 render(<Root/>);await upload();fireEvent.change(settings().getByLabelText('形式'),{target:{value:'paper-png'}});await prepare();const url=screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href');fireEvent.change(settings().getByLabelText('形式'),{target:{value:'paper-pdf'}});expect(screen.getByText('PDF用プログラムは作成時に読み込みます。接続が必要な場合があります。写真は送信しません。')).toBeTruthy();io.generate.mockRejectedValueOnce({code:'pdf-module-unavailable'});fireEvent.click(screen.getByRole('button',{name:'PDFを作成'}));await screen.findByText('PDF用の機能を読み込めませんでした。接続を確認して再試行するか、作成済みPNGに切り替えてください。写真と設定は保持しています。');fireEvent.click(screen.getByRole('button',{name:'作成済みPNGに切り替える'}));expect(screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href')).toBe(url);expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(url);expect(screen.getByAltText('crop fixture')).toBeTruthy();
});

test('pending export cancellation disables both the global and local cancel controls',async()=>{
 render(<Root/>);await upload();let finish!:()=>void;
 io.generate.mockImplementationOnce((_input,signal:AbortSignal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{finish=()=>reject(Error('aborted'));},{once:true})));
 fireEvent.click(screen.getByRole('button',{name:'PNGを作成'}));
 fireEvent.click(within(screen.getByRole('banner')).getByRole('link',{name:'Image Studio'}));
 await screen.findByRole('heading',{level:1,name:'写真を、使いたいかたちに。'});fireEvent.click(screen.getByRole('button',{name:'中止'}));
 expect((await screen.findByRole('button',{name:'中止しています…'})).hasAttribute('disabled')).toBe(true);
 fireEvent.click(screen.getByRole('link',{name:'編集へ戻る'}));await screen.findByAltText('crop fixture');
 expect(screen.getByRole('button',{name:'中止しています…'}).hasAttribute('disabled')).toBe(true);
 await act(async()=>{finish();});await waitFor(()=>expect(screen.queryByRole('button',{name:'中止しています…'})).toBeNull());
 expect(screen.queryByRole('link',{name:'PNGを保存'})).toBeNull();expect(screen.getByAltText('crop fixture')).toBeTruthy();
});

function backgroundHandoff(){
 const state={hasPhoto:false,hasResult:false,busy:false,blocked:false,closed:false,refine:false},files=new Map<string,any>();let notify=(value:any)=>{};
 const key=(options:any)=>JSON.stringify({kind:options.kind,backgroundColor:options.backgroundColor});
 const session={getState:()=>({...state}),setPhoto:()=>{state.hasPhoto=true;notify({...state});},setRefine:()=>{},
  run:vi.fn(async()=>{state.hasResult=true;notify({...state});return {status:'committed'};}),
  save:vi.fn(async(options:any)=>{files.set(key(options),{bytes:Uint8Array.from(options.kind==='background'?[4,5,6]:[1,2,3]),width:400,height:400,mime:'image/png',filename:'background.png'});return {status:'ready'};}),
  getPrepared:(options:any)=>files.get(key(options))??null,cancel:async()=>{},close:async()=>{state.closed=true;}};
 const runtime={createSession:(onChange:any)=>{notify=onChange;return session;},decodePhoto:async()=>({width:400,height:400,format:'rgb-u8' as const,data:new ArrayBuffer(400*400*3)}),refineAvailable:false,downloadDescription:'Controlled background fixture'};
 history.replaceState(null,'','#/background');render(<Root backgroundRuntime={runtime}/>);return session;
}
async function backgroundPng(){
 fireEvent.change(screen.getByLabelText('背景編集の写真を選ぶ'),{target:{files:[new File(['fixture'],'background.png',{type:'image/png'})]}});
 await screen.findByAltText('背景編集前の写真');fireEvent.click(screen.getByRole('button',{name:'背景を除去してPNGを作成'}));await screen.findByRole('link',{name:'透過PNGを保存'});
}

test('background white PNG crosses Root into crop and print; source edits invalidate downstream saving',async()=>{
 const session=backgroundHandoff();await backgroundPng();fireEvent.click(screen.getByRole('button',{name:'白背景にしてサイズ調整へ'}));
 await screen.findByAltText('crop fixture');expect(location.hash).toBe('#/crop');expect(session.save).toHaveBeenLastCalledWith({kind:'background',backgroundColor:[255,255,255]});
 const bytes=await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=()=>reject(Error('fixture-read'));reader.readAsArrayBuffer(io.decode.mock.calls[0][0]);});
 expect(Array.from(new Uint8Array(bytes))).toEqual([4,5,6]);
 await prepare();fireEvent.click(screen.getByRole('button',{name:'このサイズで用紙に並べる'}));await loadPrint();await prepare();
 expect(screen.getByRole('link',{name:'PNGを保存'})).toBeTruthy();expect(session.run).toHaveBeenCalledOnce();
 act(()=>{history.replaceState(null,'','#/background');window.dispatchEvent(new HashChangeEvent('hashchange'));});
 fireEvent.change(screen.getByLabelText('背景色'),{target:{value:'blue'}});
 act(()=>{history.replaceState(null,'','#/print');window.dispatchEvent(new HashChangeEvent('hashchange'));});
 await within(screen.getByRole('main')).findByText(/このプレビューは以前の画像です/);expect(screen.queryByRole('link',{name:'PNGを保存'})).toBeNull();expect(screen.getByRole('button',{name:'PNGを作成'}).hasAttribute('disabled')).toBe(true);expect(session.run).toHaveBeenCalledOnce();
});

test('background source changes while crop decodes reject the late image and retain the background PNG',async()=>{
 const session=backgroundHandoff();await backgroundPng();const href=screen.getByRole('link',{name:'透過PNGを保存'}).getAttribute('href');
 let finish!:(value:{url:string;width:number;height:number})=>void;io.decode.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 fireEvent.click(screen.getByRole('button',{name:'白背景にしてサイズ調整へ'}));await waitFor(()=>expect(io.decode).toHaveBeenCalledOnce());
 fireEvent.change(screen.getByLabelText('背景色'),{target:{value:'blue'}});
 await act(async()=>{finish({url:'blob:late-background-crop',width:400,height:400});});
 expect(location.hash).toBe('#/background');expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late-background-crop');expect(screen.getByRole('link',{name:'透過PNGを保存'}).getAttribute('href')).toBe(href);expect(session.run).toHaveBeenCalledOnce();
 act(()=>{history.replaceState(null,'','#/crop');window.dispatchEvent(new HashChangeEvent('hashchange'));});
 expect(screen.queryByAltText('crop fixture')).toBeNull();expect(io.generate).not.toHaveBeenCalled();
});

test('source changes after transfer adoption but before first display restore the independent print photo',async()=>{
 render(<Root/>);await upload();await prepare();navigate('original');await screen.findByRole('heading',{name:'写真を印刷する'});
 fireEvent.change(settings().getByLabelText(/写真を選/),{target:{files:[new File(['print-only'],'independent.png',{type:'image/png'})]}});
 const oldUrl=await loadPrint();navigate('crop');await screen.findByAltText('crop fixture');
 fireEvent.click(screen.getByRole('button',{name:'このサイズで用紙に並べる'}));
 fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));
 await waitFor(()=>expect(location.hash).toBe('#/print'));
 const candidate=screen.getByAltText('印刷する写真').getAttribute('src');expect(candidate).not.toBe(oldUrl);
 expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(oldUrl);
 navigate('crop');await screen.findByAltText('crop fixture');
 fireEvent.change(screen.getByRole('slider',{name:'横位置のスライダー'}),{target:{value:'30'}});
 navigate('original');await loadPrint();
 expect(screen.getByAltText('印刷する写真').getAttribute('src')).toBe(oldUrl);
 expect(URL.revokeObjectURL).toHaveBeenCalledWith(candidate);expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(oldUrl);
 expect(screen.getByRole('alert').textContent).toContain('元の画像が変更されました');
 expect(screen.queryByRole('link',{name:'PNGを保存'})).toBeNull();
 await prepare();expect(screen.getByRole('link',{name:'PNGを保存'})).toBeTruthy();
 expect(screen.queryByText(/このプレビューは以前の画像です/)).toBeNull();
});
