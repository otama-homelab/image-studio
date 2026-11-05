import {createRef,useEffect,useRef} from 'react';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import App,{type EditorHandle} from '../src/App';
import Root from '../src/Root';

const mocks=vi.hoisted(()=>({inspect:vi.fn(),prepare:vi.fn(),invalidate:vi.fn(),cancel:vi.fn(),waitForIdle:vi.fn(),decode:vi.fn(),oldLoads:[] as Array<()=>void>,busyMode:null as null|'crop'|'original',saveState:{busy:false,error:'',phase:'idle',recovery:'retry',link:null as null|{id:string;url:string;mime:string;filename:string}}}));
vi.mock('../src/decodePreview',()=>({decodePreview:(...args:any[])=>mocks.decode(...args)}));
vi.mock('../src/export/useCropSave',()=>({useCropSave:(key:string)=>{
 const [mode,slot]=JSON.parse(key),file=mocks.saveState.link;
 const isBusy=mocks.saveState.busy&&slot==='paper-png'&&(!mocks.busyMode||mode===mocks.busyMode);
 const fileSlot=file?.filename.includes('-paper-')?(file.mime==='application/pdf'?'paper-pdf':'paper-png'):'crop';
 return {waitForIdle:()=>mocks.waitForIdle(),prepare:mocks.prepare,invalidate:mocks.invalidate,...mocks.saveState,link:fileSlot===slot?file:null,busy:isBusy,cancel:()=>{if(isBusy)mocks.cancel();},beginDownload:()=>true,getPreparedFile:()=>fileSlot===slot&&file?{bytes:Uint8Array.of(1,2),width:354,height:472,mime:file.mime,filename:file.filename}:null};
}}));
vi.mock('../src/imageInput',()=>({inspectImage:(...args:any[])=>mocks.inspect(...args)}));
// Deliberately emits no crop event for same-aspect preset changes, like the real library.
// Native decoding and cropper geometry are outside this UI contract test.
vi.mock('react-easy-crop',async importOriginal=>({...await importOriginal<typeof import('react-easy-crop')>(),default:function Cropper(props:any){
 const ref=useRef<HTMLImageElement|null>(null);
 useEffect(()=>{props.setImageRef(ref);props.setMediaSize({width:400,height:400,naturalWidth:400,naturalHeight:400});props.onCropSizeChange({width:Math.min(400,400*props.aspect),height:Math.min(400,400/props.aspect)});const finish=()=>{props.onCropAreaChange({x:10.125,y:5.125,width:60.125,height:60.125/props.aspect});props.onMediaLoaded({naturalWidth:400,naturalHeight:400});};mocks.oldLoads.push(finish);},[props.image,props.aspect]);
 return <><img ref={ref} src={props.image} alt="test preview"/><button onClick={props.mediaProps.onError}>fail media</button><button onClick={()=>mocks.oldLoads.at(-1)?.()}>finish media</button><button onClick={()=>{props.onInteractionStart();props.onCropAreaChange({x:10.125,y:5.125,width:60.125,height:60.125/props.aspect});props.onInteractionEnd();}}>drag photo</button></>;
}}));

const dialogDescriptors=Object.fromEntries(['showModal','close'].map(key=>[key,Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,key)]));
beforeEach(()=>{Object.defineProperties(HTMLDialogElement.prototype,{showModal:{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}},close:{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}}});let id=0;vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=>`blob:test-${++id}`),revokeObjectURL:vi.fn()}));history.replaceState(null,'','#/');mocks.busyMode=null;mocks.inspect.mockReset();mocks.inspect.mockResolvedValue({type:'png',width:400,height:400});mocks.prepare.mockReset();mocks.invalidate.mockReset();mocks.cancel.mockReset();mocks.waitForIdle.mockReset();mocks.waitForIdle.mockResolvedValue(undefined);mocks.decode.mockReset();mocks.decode.mockImplementation(async(blob,metadata)=>({url:URL.createObjectURL(blob),width:metadata.width,height:metadata.height}));mocks.oldLoads.length=0;Object.assign(mocks.saveState,{busy:false,error:'',phase:'idle',recovery:'retry',link:null});});
afterEach(()=>{cleanup();for(const [key,descriptor] of Object.entries(dialogDescriptors)){if(descriptor)Object.defineProperty(HTMLDialogElement.prototype,key,descriptor);else Reflect.deleteProperty(HTMLDialogElement.prototype,key);}vi.restoreAllMocks();vi.unstubAllGlobals();});
const saveButton=()=>screen.getByRole('button',{name:'PNGを作成'}) as HTMLButtonElement;
const expectNotSaveable=()=>{const button=screen.queryByRole('button',{name:'PNGを作成'}) as HTMLButtonElement|null;expect(button===null||button.disabled).toBe(true);};
async function choose(){fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['synthetic'],'fixture.png',{type:'image/png'})]}});await screen.findByAltText('test preview');await screen.findByText('写真の表示を確認しています…');}
function finish(){fireEvent.click(screen.getByRole('button',{name:'finish media'}));}

test('waits for decoded preview and preserves fractional crop coordinates',async()=>{
 render(<App/>);await choose();expectNotSaveable();finish();expect(saveButton().disabled).toBe(false);fireEvent.click(screen.getByRole('button',{name:'drag photo'}));fireEvent.click(saveButton());
 const request=mocks.prepare.mock.calls[0][0];expect(request.crop.x).toBeCloseTo(40.5,9);expect(request.crop.width).toBeCloseTo(240.5,9);expect(request.crop.height).toBeCloseTo(240.5/.75);expect(request.sourceWidth).toBe(400);
});
test('same-aspect purpose change remains saveable without a new geometry event',async()=>{
 render(<App/>);await choose();finish();fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('用途'),{target:{value:'4'}});expect(saveButton().disabled).toBe(false);fireEvent.click(saveButton());expect(mocks.prepare).toHaveBeenCalledOnce();
});
test('replacement ignores old media callbacks until new preview is ready',async()=>{
 render(<App/>);await choose();finish();const oldFinish=mocks.oldLoads[0];
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['next'],'next.png',{type:'image/png'})]}});fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));
 await waitFor(()=>expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-2'));
 // The new DOM can appear before the mock's passive effect registers its media
 // callback. Exercise the old callback only after the replacement is wired.
 await waitFor(()=>expect(mocks.oldLoads.at(-1)).not.toBe(oldFinish));
 expectNotSaveable();act(()=>oldFinish());expectNotSaveable();finish();expect(saveButton().disabled).toBe(false);
});

test('custom dimensions keep drafts separate and reject empty or out-of-range values',async()=>{
 render(<App/>);await choose();finish();fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('用途'),{target:{value:'4'}});
 const width=within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('幅 (mm)');
 fireEvent.change(width,{target:{value:''}});fireEvent.blur(width);expectNotSaveable();expect(width.getAttribute('aria-invalid')).toBe('true');fireEvent.click(saveButton());expect(mocks.prepare).not.toHaveBeenCalled();
 fireEvent.change(width,{target:{value:'153'}});fireEvent.keyDown(width,{key:'Enter'});expectNotSaveable();
 fireEvent.keyDown(width,{key:'Escape'});expect((width as HTMLInputElement).value).toBe('30');expect(saveButton().disabled).toBe(false);
 fireEvent.change(width,{target:{value:'50.8'}});expectNotSaveable();fireEvent.keyDown(width,{key:'Enter'});
 const height=within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('高さ (mm)');fireEvent.change(height,{target:{value:'50.8'}});fireEvent.blur(height);finish();fireEvent.click(saveButton());
 expect(mocks.prepare.mock.calls[0][0]).toMatchObject({width:600,height:600});
});

test('square preset exports 600px and oversized custom photo can recover by paper change',async()=>{
 render(<App/>);await choose();finish();fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('用途'),{target:{value:'3'}});finish();fireEvent.click(saveButton());expect(mocks.prepare.mock.calls[0][0]).toMatchObject({width:600,height:600});
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('用途'),{target:{value:'4'}});
 for(const label of ['幅 (mm)','高さ (mm)']){const input=within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(label);fireEvent.change(input,{target:{value:'152'}});fireEvent.blur(input);}
 finish();fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('形式'),{target:{value:'paper-png'}});expect(screen.getByRole('alert').textContent).toContain('用紙に収まりません');expectNotSaveable();
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('用紙'),{target:{value:'a4'}});expect(screen.queryByRole('alert')).toBeNull();expect(saveButton().disabled).toBe(false);
});

test('range and position controls produce original-image coordinates and block invalid drafts',async()=>{
 render(<App/>);await choose();finish();
 fireEvent.change(screen.getByRole('slider',{name:'写る範囲のスライダー'}),{target:{value:'50'}});
 fireEvent.change(screen.getByRole('slider',{name:'横位置のスライダー'}),{target:{value:'0'}});
 fireEvent.change(screen.getByRole('slider',{name:'縦位置のスライダー'}),{target:{value:'100'}});
 fireEvent.click(saveButton());expect(mocks.prepare.mock.calls.at(-1)?.[0].crop).toEqual({x:0,y:200,width:150,height:200});
 const horizontal=within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('横位置の数値（%）');fireEvent.change(horizontal,{target:{value:''}});fireEvent.keyDown(horizontal,{key:'Enter'});expectNotSaveable();fireEvent.click(saveButton());expect(mocks.prepare).toHaveBeenCalledTimes(1);
 fireEvent.keyDown(horizontal,{key:'Escape'});expect(saveButton().disabled).toBe(false);
 const range=within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('写る範囲の数値（%）');fireEvent.change(range,{target:{value:'9'}});fireEvent.blur(range);expectNotSaveable();
 fireEvent.change(range,{target:{value:'10'}});expectNotSaveable();fireEvent.blur(range);fireEvent.click(saveButton());expect(mocks.prepare.mock.calls.at(-1)?.[0].crop).toEqual({x:0,y:360,width:30,height:40});
 fireEvent.click(screen.getByRole('button',{name:'範囲と位置を戻す'}));fireEvent.click(saveButton());expect(mocks.prepare.mock.calls.at(-1)?.[0].crop).toEqual({x:50,y:0,width:300,height:400});
});

test('preset preserves position and uses rounded output-pixel aspect; guides do not change export',async()=>{
 render(<App/>);await choose();finish();
 fireEvent.change(screen.getByRole('slider',{name:'写る範囲のスライダー'}),{target:{value:'50'}});
 fireEvent.change(screen.getByRole('slider',{name:'横位置のスライダー'}),{target:{value:'100'}});
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('用途'),{target:{value:'2'}});
 fireEvent.click(saveButton());const before=mocks.prepare.mock.calls.at(-1)?.[0];expect(before).toMatchObject({width:283,height:354});expect(before.crop.height).toBe(200);expect(before.crop.width/before.crop.height).toBeCloseTo(283/354,12);expect(before.crop.x+before.crop.width).toBeCloseTo(400,9);
 fireEvent.click(screen.getByRole('checkbox',{name:'顔位置の目安線を表示'}));fireEvent.click(saveButton());expect(mocks.prepare.mock.calls.at(-1)?.[0]).toEqual(before);
});

test('plus and PageDown controls move without dragging; replacing photo resets framing only',async()=>{
 render(<App/>);await choose();finish();fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('用途'),{target:{value:'2'}});
 fireEvent.click(screen.getByRole('button',{name:'横位置を1%増やす（右へ）'}));expect((within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('横位置の数値（%）') as HTMLInputElement).value).toBe('51');
 fireEvent.keyDown(screen.getByRole('slider',{name:'写る範囲のスライダー'}),{key:'PageDown'});expect((within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('写る範囲の数値（%）') as HTMLInputElement).value).toBe('90');
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['next'],'next.png',{type:'image/png'})]}});fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));await waitFor(()=>expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-2'));finish();
 expect((within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('横位置の数値（%）') as HTMLInputElement).value).toBe('50');expect((within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('写る範囲の数値（%）') as HTMLInputElement).value).toBe('100');expect((within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('用途') as HTMLSelectElement).value).toBe('2');
});

test('direct print waits for the original preview and sends original dimensions with no crop',async()=>{
 render(<App/>);fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('写真の使い方'),{target:{value:'original'}});
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['synthetic'],'fixture.png',{type:'image/png'})]}});
 const image=await screen.findByAltText('印刷する写真');expectNotSaveable();Object.defineProperties(image,{naturalWidth:{value:354},naturalHeight:{value:472}});fireEvent.load(image);
 expect(saveButton().disabled).toBe(false);expect(screen.queryByLabelText('用途')).toBeNull();fireEvent.click(saveButton());
 const request=mocks.prepare.mock.calls.at(-1)?.[0];expect(request).toMatchObject({mode:'original',sourceWidth:354,sourceHeight:472,output:{kind:'paper',format:'png',paper:'l'}});expect(request).not.toHaveProperty('crop');expect(request).not.toHaveProperty('width');
});

test('invalid crop drafts do not block direct PDF printing and remain available when returning',async()=>{
 render(<App/>);await choose();finish();fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('用途'),{target:{value:'4'}});fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('幅 (mm)'),{target:{value:''}});expectNotSaveable();
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('写真の使い方'),{target:{value:'original'}});fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('形式'),{target:{value:'paper-pdf'}});
 const button=screen.getByRole('button',{name:'PDFを作成'}) as HTMLButtonElement;expect(button.disabled).toBe(false);fireEvent.click(button);expect(mocks.prepare.mock.calls.at(-1)?.[0]).toMatchObject({mode:'original',output:{kind:'paper',format:'pdf'}});
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('写真の使い方'),{target:{value:'crop'}});expect((within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('幅 (mm)') as HTMLInputElement).value).toBe('');expect((screen.getByRole('button',{name:'PDFを作成'}) as HTMLButtonElement).disabled).toBe(true);
});

test('replacing a direct-print photo creates a separate preview and cannot reuse old decode readiness',async()=>{
 render(<App/>);fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('写真の使い方'),{target:{value:'original'}});
 const picker=within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/);fireEvent.change(picker,{target:{files:[new File(['first'],'first.png',{type:'image/png'})]}});
 const oldImage=await screen.findByAltText('印刷する写真');Object.defineProperties(oldImage,{naturalWidth:{value:354},naturalHeight:{value:472}});fireEvent.load(oldImage);expect(saveButton().disabled).toBe(false);
 fireEvent.change(picker,{target:{files:[new File(['second'],'second.png',{type:'image/png'})]}});fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));await waitFor(()=>expect(screen.getByAltText('印刷する写真').getAttribute('src')).toBe('blob:test-2'));
 const next=screen.getByAltText('印刷する写真');expect(next).not.toBe(oldImage);expectNotSaveable();fireEvent.load(oldImage);expectNotSaveable();
 Object.defineProperties(next,{naturalWidth:{value:413},naturalHeight:{value:531}});fireEvent.load(next);fireEvent.click(saveButton());expect(mocks.prepare.mock.calls.at(-1)?.[0]).toMatchObject({mode:'original',sourceWidth:413,sourceHeight:531});
});

test('first-time journey reveals controls after photo selection and offers printing after preparation',async()=>{
 const view=render(<App/>);expect(screen.queryByLabelText('用途')).toBeNull();expect(screen.queryByLabelText('形式')).toBeNull();expect(screen.getByText('1 写真を選ぶ').getAttribute('aria-current')).toBe('step');
 await choose();finish();expect(screen.getByText('2 サイズと位置を調整').getAttribute('aria-current')).toBe('step');
 const settings=screen.getByRole('complementary',{name:'写真と設定'}),preview=screen.getByRole('region',{name:'写真プレビュー'}),output=screen.getByRole('region',{name:'作成して保存'});expect(settings.compareDocumentPosition(preview)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(preview.compareDocumentPosition(output)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 const hash=location.hash;fireEvent.click(screen.getByRole('link',{name:'写真と仕上がりを先に確認'}));expect(document.activeElement).toBe(screen.getByRole('heading',{name:'仕上がりを確認'}));expect(location.hash).toBe(hash);fireEvent.click(screen.getByRole('link',{name:'プレビューで確認する'}));expect(document.activeElement).toBe(screen.getByRole('heading',{name:'仕上がりを確認'}));expect(location.hash).toBe(hash);fireEvent.click(screen.getByRole('link',{name:'設定へ戻る'}));expect(document.activeElement).toBe(screen.getByRole('heading',{name:'写真と設定'}));expect(mocks.prepare).not.toHaveBeenCalled();
 mocks.saveState.link={id:'prepared',url:'blob:prepared-photo',mime:'image/png',filename:'image-studio-crop-300dpi.png'};mocks.saveState.phase='ready';view.rerender(<App/>);
 expect(screen.getByText('3 作成して保存').getAttribute('aria-current')).toBe('step');expect(screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href')).toBe('blob:prepared-photo');expect(screen.getByText(/ファイルの準備ができました/)).toBeTruthy();
 mocks.invalidate.mockImplementation(()=>{mocks.saveState.link=null;mocks.saveState.phase='stale';});fireEvent.click(screen.getByRole('button',{name:'このサイズで用紙に並べる'}));
 expect(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('用紙')).toBeTruthy();expect(screen.getByRole('figure',{name:'用紙のプレビュー'}).querySelector('image')?.getAttribute('href')).toBe('blob:test-1');expect(mocks.prepare).not.toHaveBeenCalled();expect(screen.queryByRole('link',{name:'PNGを保存'})).toBeNull();
});

test('DPI failure recovery stays at the output and returns to sizing without reselecting the photo',async()=>{
 const view=render(<App/>);await choose();finish();fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('写真の使い方'),{target:{value:'original'}});
 Object.assign(mocks.saveState,{error:'300dpiの写真を使用してください。',phase:'error',recovery:'crop'});view.rerender(<App/>);
 expect(screen.getByRole('alert').closest('.save-recovery')).not.toBeNull();mocks.invalidate.mockImplementation(()=>{mocks.saveState.error='';mocks.saveState.phase='idle';});
 fireEvent.click(screen.getByRole('button',{name:'サイズを整えるへ'}));expect((within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('写真の使い方') as HTMLSelectElement).value).toBe('crop');expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-1');expect(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('用途')).toBeTruthy();
});

test('index explains the sample image flow, requirements and licenses without starting image processing',()=>{
 render(<Root/>);expect(screen.getByRole('heading',{level:1,name:'写真を、使いたいかたちに。'})).toBeTruthy();expect(screen.getByRole('heading',{name:'操作で画像がどう変わるか'})).toBeTruthy();expect(screen.getByRole('heading',{name:'必要な環境・入力'})).toBeTruthy();expect(screen.getByRole('heading',{name:'制約・確認してほしいこと'})).toBeTruthy();
 expect(screen.getAllByText('Client-side processing').length).toBeGreaterThan(0);expect(screen.getByRole('link',{name:'アプリ本体：MIT License'}).getAttribute('href')).toBe('/LICENSE.txt');expect(screen.getByRole('link',{name:'アプリ本体：MIT License'}).getAttribute('target')).toBe('_blank');expect(screen.queryByRole('navigation',{name:'案内'})).toBeNull();
 const footer=screen.getByRole('contentinfo');expect(within(footer).getByRole('link',{name:'Star on GitHub'}).getAttribute('href')).toBe('https://github.com/otama-homelab/image-studio');expect(footer.textContent).toContain('Apache-2.0');expect(footer.textContent).toContain('搭載・配布していません');expect(mocks.prepare).not.toHaveBeenCalled();expect(URL.createObjectURL).not.toHaveBeenCalled();
});

test('index to editor and back preserves the selected photo and framing',async()=>{
 render(<Root/>);fireEvent.click(screen.getByRole('link',{name:'サイズを整える'}));await screen.findByRole('complementary',{name:'写真と設定'});await choose();finish();fireEvent.change(screen.getByRole('slider',{name:'写る範囲のスライダー'}),{target:{value:'80'}});
 fireEvent.click(within(screen.getByRole('banner')).getByRole('link',{name:'Image Studio'}));await screen.findByRole('heading',{level:1,name:'写真を、使いたいかたちに。'});expect(screen.queryByAltText('test preview')).toBeNull();
 fireEvent.click(screen.getByRole('link',{name:'サイズを整える'}));await screen.findByAltText('test preview');expect((within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('写る範囲の数値（%）') as HTMLInputElement).value).toBe('80');expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-1');expect(URL.createObjectURL).toHaveBeenCalledOnce();expect(mocks.prepare).not.toHaveBeenCalled();
});

test('direct print hash enters the original-size workflow and keeps cancellation reachable on the index',async()=>{
 history.replaceState(null,'','#/print');const view=render(<Root/>);await waitFor(()=>expect((within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('写真の使い方') as HTMLSelectElement).value).toBe('original'));
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['synthetic'],'fixture.png',{type:'image/png'})]}});const image=await screen.findByAltText('印刷する写真');Object.defineProperties(image,{naturalWidth:{value:354},naturalHeight:{value:472}});fireEvent.load(image);fireEvent.click(saveButton());expect(mocks.prepare.mock.calls.at(-1)?.[0].mode).toBe('original');
 mocks.saveState.busy=true;mocks.busyMode='original';view.rerender(<Root/>);fireEvent.click(within(screen.getByRole('banner')).getByRole('link',{name:'Image Studio'}));await screen.findByRole('heading',{level:1,name:'写真を、使いたいかたちに。'});await waitFor(()=>expect(screen.getByRole('button',{name:'中止'})).toBeTruthy());fireEvent.click(screen.getByRole('button',{name:'中止'}));expect(mocks.cancel).toHaveBeenCalledOnce();
});

test('failed candidate decode retains the old photo, file and framing',async()=>{
 render(<App/>);await choose();finish();fireEvent.change(screen.getByRole('slider',{name:'写る範囲のスライダー'}),{target:{value:'80'}});fireEvent.click(saveButton());const oldFile=mocks.prepare.mock.calls.at(-1)?.[0].file;
 mocks.decode.mockRejectedValueOnce(Error('native failed'));fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['broken'],'broken.png',{type:'image/png'})]}});fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));await screen.findByRole('alert');
 expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-1');expect((within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('写る範囲の数値（%）') as HTMLInputElement).value).toBe('80');expect(screen.getByRole('alert').textContent).toContain('元の写真と調整内容は保持');expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:test-1');fireEvent.click(saveButton());expect(mocks.prepare.mock.calls.at(-1)?.[0].file).toBe(oldFile);
});

test('cancelled decode settles before the latest selection starts and its late result cannot replace the photo',async()=>{
 render(<App/>);await choose();finish();let release!:(value:{url:string;width:number;height:number})=>void;
 mocks.decode.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['pending'],'pending.png',{type:'image/png'})]}});fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));await waitFor(()=>expect(mocks.decode).toHaveBeenCalledTimes(2));
 fireEvent.click(screen.getByRole('button',{name:'読み込みを中止'}));expect(screen.getByText(/写真の読み込みを中止しました/)).toBeTruthy();fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['latest'],'latest.png',{type:'image/png'})]}});fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));await act(async()=>{await Promise.resolve();});expect(mocks.decode).toHaveBeenCalledTimes(2);
 await act(async()=>{release({url:'blob:late',width:400,height:400});});await waitFor(()=>expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-2'));expect(mocks.decode).toHaveBeenCalledTimes(3);expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late');expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:test-1');finish();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1');
});

test('replacement cancellation preserves framing and ready download without decoding or invalidating',async()=>{
 const view=render(<App/>);await choose();finish();fireEvent.change(screen.getByRole('slider',{name:'写る範囲のスライダー'}),{target:{value:'80'}});
 mocks.saveState.link={id:'ready',url:'blob:ready',mime:'image/png',filename:'photo.png'};view.rerender(<App/>);mocks.invalidate.mockClear();
 const select=()=>fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['candidate'],'candidate.png',{type:'image/png'})]}});
 select();const dialog=screen.getByRole('dialog',{name:'写真を置き換えますか？'}) as HTMLDialogElement;expect(document.activeElement).toBe(screen.getByRole('button',{name:'今の写真を続ける'}));expect(mocks.decode).toHaveBeenCalledTimes(1);expect(mocks.invalidate).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'今の写真を続ける'}));expect(dialog.open).toBe(false);expect(screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href')).toBe('blob:ready');expect((within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('写る範囲の数値（%）') as HTMLInputElement).value).toBe('80');
 select();fireEvent(dialog,new Event('cancel',{bubbles:false,cancelable:true}));expect(dialog.open).toBe(false);expect(mocks.decode).toHaveBeenCalledTimes(1);expect(mocks.invalidate).not.toHaveBeenCalled();expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:test-1');
});

test('hiding the editor discards an unconfirmed replacement and does not reopen it',async()=>{
 const view=render(<App/>);await choose();fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['candidate'],'candidate.png',{type:'image/png'})]}});expect(screen.getByRole('dialog')).toBeTruthy();
 view.rerender(<App active={false}/>);expect(screen.queryByRole('dialog')).toBeNull();view.rerender(<App active/>);expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-1');expect(mocks.decode).toHaveBeenCalledTimes(1);
});

test('requests unload confirmation only while a photo is held, including the home route',async()=>{
 const view=render(<App/>);const warn=()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;};
 expect(warn()).toBe(false);await choose();expect(warn()).toBe(true);view.rerender(<App active={false}/>);expect(warn()).toBe(true);
 act(()=>window.dispatchEvent(new Event('pagehide')));expect(warn()).toBe(false);expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1');view.unmount();expect(warn()).toBe(false);
});

test('crop and print inputs/settings survive route changes independently without implicit transfer',async()=>{
 render(<Root/>);fireEvent.click(screen.getByRole('link',{name:'サイズを整える'}));await screen.findByRole('complementary',{name:'写真と設定'});await choose();finish();fireEvent.change(screen.getByRole('slider',{name:'写る範囲のスライダー'}),{target:{value:'80'}});
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('写真の使い方'),{target:{value:'original'}});await screen.findByRole('heading',{name:'写真を印刷する'});
 expect(screen.queryByAltText('印刷する写真')).toBeNull();expect(screen.queryByRole('button',{name:'PNGを作成'})).toBeNull();
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['independent-print'],'print.png',{type:'image/png'})]}});const image=await screen.findByAltText('印刷する写真');Object.defineProperties(image,{naturalWidth:{value:354},naturalHeight:{value:472}});fireEvent.load(image);fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('用紙'),{target:{value:'a4'}});
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('写真の使い方'),{target:{value:'crop'}});await screen.findByAltText('test preview');finish();expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-1');expect((screen.getByRole('slider',{name:'写る範囲のスライダー'}) as HTMLInputElement).value).toBe('80');
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('写真の使い方'),{target:{value:'original'}});await screen.findByAltText('印刷する写真');expect(screen.getByAltText('印刷する写真').getAttribute('src')).toBe('blob:test-2');expect((within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('用紙') as HTMLSelectElement).value).toBe('a4');expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:test-1');
 const ids=Array.from(document.querySelectorAll('[id]'),node=>node.id);expect(new Set(ids).size).toBe(ids.length);expect(document.activeElement).toBe(screen.getByRole('heading',{name:'写真を印刷する'}));
});

test('DPI recovery explicitly hands the print photo to crop, asks before replacing, and cancellation preserves both',async()=>{
 const view=render(<Root/>);fireEvent.click(screen.getByRole('link',{name:'サイズを整える'}));await screen.findByRole('complementary',{name:'写真と設定'});await choose();finish();fireEvent.change(screen.getByRole('slider',{name:'写る範囲のスライダー'}),{target:{value:'80'}});
 const go=(mode:string)=>fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('写真の使い方'),{target:{value:mode}});
 go('original');await screen.findByRole('heading',{name:'写真を印刷する'});fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['print-snapshot'],'print.png',{type:'image/png'})]}});const image=await screen.findByAltText('印刷する写真');Object.defineProperties(image,{naturalWidth:{value:354},naturalHeight:{value:472}});fireEvent.load(image);
 Object.assign(mocks.saveState,{error:'300dpiの写真を使用してください。',phase:'error',recovery:'crop'});view.rerender(<Root/>);mocks.invalidate.mockClear();fireEvent.click(screen.getByRole('button',{name:'サイズを整えるへ'}));expect(screen.getByRole('dialog',{name:'サイズ調整の写真を置き換えますか？'})).toBeTruthy();expect(location.hash).toBe('#/print');expect(mocks.decode).toHaveBeenCalledTimes(2);fireEvent.click(screen.getByRole('button',{name:'今の写真を続ける'}));expect(mocks.invalidate).not.toHaveBeenCalled();expect(mocks.decode).toHaveBeenCalledTimes(2);
 go('crop');await screen.findByAltText('test preview');finish();expect((screen.getByRole('slider',{name:'写る範囲のスライダー'}) as HTMLInputElement).value).toBe('80');go('original');await screen.findByAltText('印刷する写真');fireEvent.load(screen.getByAltText('印刷する写真')); // Remounted image receives its natural-size load below.
 const remounted=screen.getByAltText('印刷する写真');Object.defineProperties(remounted,{naturalWidth:{value:354},naturalHeight:{value:472}});fireEvent.load(remounted);
 fireEvent.click(screen.getByRole('button',{name:'サイズを整えるへ'}));fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));await screen.findByAltText('test preview');await waitFor(()=>expect(location.hash).toBe('#/crop'));finish();expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-3');expect((screen.getByRole('slider',{name:'写る範囲のスライダー'}) as HTMLInputElement).value).toBe('100');expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1');expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:test-2');
});

test('leaving during a recovery decode rejects the late candidate without changing route or crop input',async()=>{
 history.replaceState(null,'','#/print');const view=render(<Root/>);fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['print-photo'],'print.png',{type:'image/png'})]}});const image=await screen.findByAltText('印刷する写真');Object.defineProperties(image,{naturalWidth:{value:354},naturalHeight:{value:472}});fireEvent.load(image);
 Object.assign(mocks.saveState,{error:'300dpiの写真を使用してください。',phase:'error',recovery:'crop'});view.rerender(<Root/>);let release!:(value:{url:string;width:number;height:number})=>void;mocks.decode.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));fireEvent.click(screen.getByRole('button',{name:'サイズを整えるへ'}));await waitFor(()=>expect(mocks.decode).toHaveBeenCalledTimes(2));
 fireEvent.click(within(screen.getByRole('banner')).getByRole('link',{name:'Image Studio'}));await screen.findByRole('heading',{level:1,name:'写真を、使いたいかたちに。'});await act(async()=>{release({url:'blob:late-recovery',width:400,height:400});});expect(location.hash).toBe('#/');expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late-recovery');
 fireEvent.click(screen.getByRole('link',{name:'サイズを整える'}));await screen.findByRole('heading',{name:'サイズを整える'});expect(screen.queryByAltText('test preview')).toBeNull();expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:test-1');
});

test('replacement waits for its old export to settle and cancellation prevents a later decode from starting',async()=>{
 render(<App/>);await choose();finish();let finishOld!:()=>void;mocks.waitForIdle.mockImplementationOnce(()=>new Promise<void>(resolve=>{finishOld=resolve;}));
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['next'],'next.png',{type:'image/png'})]}});fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));await screen.findByText('前の処理の終了を待っています…');expect(mocks.decode).toHaveBeenCalledTimes(1);expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-1');
 fireEvent.click(screen.getByRole('button',{name:'読み込みを中止'}));await act(async()=>{finishOld();});expect(mocks.decode).toHaveBeenCalledTimes(1);expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:test-1');expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-1');
});

test('opening support from an export error preserves the route, photo and framing',async()=>{
 history.replaceState(null,'','#/crop');const view=render(<Root/>);await choose();finish();fireEvent.change(screen.getByRole('slider',{name:'写る範囲のスライダー'}),{target:{value:'80'}});Object.assign(mocks.saveState,{error:'画像ファイルを作れませんでした。',phase:'error'});view.rerender(<Root/>);mocks.invalidate.mockClear();
 fireEvent.click(screen.getByRole('button',{name:'端末情報を確認'}));expect(screen.getByRole('dialog',{name:'端末情報と診断'})).toBeTruthy();expect(location.hash).toBe('#/crop');fireEvent.click(screen.getByRole('button',{name:'閉じて元の画面に戻る'}));expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-1');expect((screen.getByRole('slider',{name:'写る範囲のスライダー'}) as HTMLInputElement).value).toBe('80');expect(mocks.invalidate).not.toHaveBeenCalled();expect(mocks.prepare).not.toHaveBeenCalled();
});

test('replacement uses the shared non-modal fallback and Escape still preserves the current photo',async()=>{
 Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');Reflect.deleteProperty(HTMLDialogElement.prototype,'close');render(<App/>);await choose();finish();mocks.invalidate.mockClear();fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['candidate'],'candidate.png',{type:'image/png'})]}});const dialog=screen.getByRole('dialog');expect(document.activeElement).toBe(screen.getByRole('button',{name:'今の写真を続ける'}));fireEvent.keyDown(dialog,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(mocks.decode).toHaveBeenCalledTimes(1);expect(mocks.invalidate).not.toHaveBeenCalled();expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-1');
});


test('first visible candidate failure restores the old file, framing and uncommitted draft',async()=>{
 render(<App/>);await choose();finish();fireEvent.change(screen.getByRole('slider',{name:'写る範囲のスライダー'}),{target:{value:'80'}});fireEvent.click(saveButton());const original=mocks.prepare.mock.calls.at(-1)?.[0].file;fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('横位置の数値（%）'),{target:{value:'3x'}});
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['candidate'],'candidate.png',{type:'image/png'})]}});fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));await waitFor(()=>expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-2'));const late=mocks.oldLoads.at(-1)!;expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:test-1');fireEvent.click(screen.getByRole('button',{name:'fail media'}));
 expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-1');expect((screen.getByRole('slider',{name:'写る範囲のスライダー'}) as HTMLInputElement).value).toBe('80');expect((within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('横位置の数値（%）') as HTMLInputElement).value).toBe('3x');expect(screen.getByRole('alert').textContent).toContain('元の写真と調整内容は保持');expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-2');expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:test-1');act(()=>late());expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-1');
 const input=within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText('横位置の数値（%）');fireEvent.change(input,{target:{value:'45'}});fireEvent.keyDown(input,{key:'Enter'});fireEvent.click(saveButton());expect(mocks.prepare.mock.calls.at(-1)?.[0].file).toBe(original);
});

test('old source URL is released only after first visible success and later media events do not reset framing',async()=>{
 const view=render(<App/>);await choose();finish();const oldFinish=mocks.oldLoads.at(-1);fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['candidate'],'candidate.png',{type:'image/png'})]}});fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));await waitFor(()=>expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-2'));expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:test-1');
 await waitFor(()=>expect(mocks.oldLoads.at(-1)).not.toBe(oldFinish));finish();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1');
 fireEvent.change(screen.getByRole('slider',{name:'写る範囲のスライダー'}),{target:{value:'75'}});finish();expect((screen.getByRole('slider',{name:'写る範囲のスライダー'}) as HTMLInputElement).value).toBe('75');view.unmount();expect((URL.revokeObjectURL as ReturnType<typeof vi.fn>).mock.calls.filter(([url])=>url==='blob:test-1')).toHaveLength(1);expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-2');
});

test('replacing an unverified candidate keeps the last verified photo for rollback',async()=>{
 render(<App/>);await choose();finish();fireEvent.change(screen.getByRole('slider',{name:'写る範囲のスライダー'}),{target:{value:'80'}});
 for(const [name,url] of [['second','blob:test-2'],['third','blob:test-3']]){fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File([name],name+'.png',{type:'image/png'})]}});fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));await waitFor(()=>expect(screen.getByAltText('test preview').getAttribute('src')).toBe(url));}
 expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-2');expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:test-1');fireEvent.click(screen.getByRole('button',{name:'fail media'}));expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-1');expect((screen.getByRole('slider',{name:'写る範囲のスライダー'}) as HTMLInputElement).value).toBe('80');expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-3');
});

test('first photo display failure releases the candidate and returns to empty selection',async()=>{
 render(<App/>);await choose();fireEvent.click(screen.getByRole('button',{name:'fail media'}));expect(screen.queryByAltText('test preview')).toBeNull();expect(screen.queryByLabelText('用途')).toBeNull();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1');expectNotSaveable();await choose();finish();expect(saveButton().disabled).toBe(false);
});

test('home cancellation during first visible verification restores the previous editor photo',async()=>{
 history.replaceState(null,'','#/crop');render(<Root/>);await choose();finish();fireEvent.change(screen.getByRole('slider',{name:'写る範囲のスライダー'}),{target:{value:'80'}});fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['candidate'],'candidate.png',{type:'image/png'})]}});fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));await waitFor(()=>expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-2'));
 fireEvent.click(within(screen.getByRole('banner')).getByRole('link',{name:'Image Studio'}));await screen.findByRole('heading',{level:1,name:'写真を、使いたいかたちに。'});fireEvent.click(screen.getByRole('button',{name:'中止'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'中止'})).toBeNull());fireEvent.click(screen.getByRole('link',{name:'サイズを整える'}));await screen.findByAltText('test preview');expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-1');expect((screen.getByRole('slider',{name:'写る範囲のスライダー'}) as HTMLInputElement).value).toBe('80');expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-2');expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:test-1');
});


test('oversized PNG admission failure preserves the previous photo and framing before native decoding',async()=>{
 render(<App/>);await choose();finish();fireEvent.change(screen.getByRole('slider',{name:'写る範囲のスライダー'}),{target:{value:'80'}});mocks.inspect.mockRejectedValueOnce(Error('png-dimensions-too-large'));
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['large-header'],'large.png',{type:'image/png'})]}});fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));const alert=await screen.findByRole('alert');expect(alert.textContent).toContain('各辺4,096px以内・総画素400万以下');expect(alert.textContent).toContain('元の写真と調整内容は保持');expect(mocks.decode).toHaveBeenCalledTimes(1);expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-1');expect((screen.getByRole('slider',{name:'写る範囲のスライダー'}) as HTMLInputElement).value).toBe('80');expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:test-1');
});

test('crop handoff becomes stale immediately when its own upstream background image changes',async()=>{
 const session=createRef<EditorHandle>();let upstreamCurrent=true;const view=render(<App sessionRef={session}/>);
 await act(async()=>{await session.current!.importPhoto(new File(['synthetic'],'background.png',{type:'image/png'}),()=>true,()=>upstreamCurrent);});await screen.findByAltText('test preview');finish();
 mocks.saveState.link={id:'crop',url:'blob:crop',mime:'image/png',filename:'image-studio-crop-300dpi.png'};view.rerender(<App sessionRef={session}/>);const transfer=session.current!.getCropArtifact();expect(transfer).not.toBeNull();expect(transfer!.isCurrent()).toBe(true);
 upstreamCurrent=false;expect(transfer!.isCurrent()).toBe(false);expect(session.current!.getCropArtifact()).toBeNull();
});

test.each([['image-dimensions-too-large','JPEGは各辺16,384px以内・総画素2,400万以下'],['image-file-too-large','ファイル容量の上限を超えています。20MiB以内']])('input failure %s explains the limiting resource before decoding and preserves the previous photo',async(code,message)=>{
 render(<App/>);await choose();finish();fireEvent.change(screen.getByRole('slider',{name:'写る範囲のスライダー'}),{target:{value:'80'}});mocks.inspect.mockRejectedValueOnce(Error(code));
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['large-header'],'private-name.jpg',{type:'image/jpeg'})]}});fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));
 const alert=await screen.findByRole('alert');expect(alert.textContent).toContain(message);expect(alert.textContent).toContain('元の写真と調整内容は保持');expect(alert.textContent).not.toContain('private-name');expect(mocks.decode).toHaveBeenCalledTimes(1);expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-1');expect((screen.getByRole('slider',{name:'写る範囲のスライダー'}) as HTMLInputElement).value).toBe('80');expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:test-1');
});

test.each(['image-dimensions-too-large','png-dimensions-too-large','image-file-too-large'])('header rejection %s preserves the prepared download without retiring export owners',async(code)=>{
 const view=render(<App/>);await choose();finish();Object.assign(mocks.saveState,{phase:'ready',link:{id:'ready',url:'blob:ready',mime:'image/png',filename:'photo.png'}});view.rerender(<App/>);mocks.invalidate.mockClear();mocks.waitForIdle.mockClear();mocks.inspect.mockRejectedValueOnce(Error(code));
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['bad'],'rejected.jpg',{type:'image/jpeg'})]}});fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));await screen.findByRole('alert');await waitFor(()=>expect(saveButton().disabled).toBe(false));
 expect(screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href')).toBe('blob:ready');expect(screen.getByAltText('test preview').getAttribute('src')).toBe('blob:test-1');expect(mocks.invalidate).not.toHaveBeenCalled();expect(mocks.waitForIdle).not.toHaveBeenCalled();expect(mocks.decode).toHaveBeenCalledTimes(1);expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:test-1');
});
test('cancelled header check cannot later invalidate a ready download or start a decode',async()=>{
 const view=render(<App/>);await choose();finish();Object.assign(mocks.saveState,{phase:'ready',link:{id:'ready',url:'blob:ready',mime:'image/png',filename:'photo.png'}});view.rerender(<App/>);mocks.invalidate.mockClear();let release!:(value:any)=>void;mocks.inspect.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['pending'],'pending.png',{type:'image/png'})]}});fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));await screen.findByText('画像を確認しています…');fireEvent.click(screen.getByRole('button',{name:'読み込みを中止'}));await act(async()=>release({type:'png',width:400,height:400}));
 expect(mocks.invalidate).not.toHaveBeenCalled();expect(mocks.decode).toHaveBeenCalledTimes(1);expect(screen.getByRole('link',{name:'PNGを保存'}).getAttribute('href')).toBe('blob:ready');
});

test('home shows the comparison and requirements without expanding details or starting processing',()=>{
 const worker=vi.fn(),fetch=vi.fn();vi.stubGlobal('Worker',worker);vi.stubGlobal('fetch',fetch);render(<Root/>);
 const image=screen.getByAltText('MODNetで自動処理した架空人物の透過作例');expect(image.getAttribute('src')).toBe('/examples/portrait-cutout-small.webp');expect(image.closest('details')).toBeNull();
 for(const name of ['必要な環境・入力','制約・確認してほしいこと'])expect(screen.getByRole('heading',{name}).closest('details')).toBeNull();
 expect(worker).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();expect(mocks.decode).not.toHaveBeenCalled();expect(mocks.prepare).not.toHaveBeenCalled();expect(URL.createObjectURL).not.toHaveBeenCalled();
});

test('home offers direct editor links without a navigation tab bar',()=>{
 history.replaceState(null,'','#/');render(<Root/>);
 expect(screen.queryByRole('navigation',{name:'案内'})).toBeNull();
 expect(screen.getByRole('link',{name:'サイズを整える'}).getAttribute('href')).toBe('#/crop');
 expect(screen.getByRole('link',{name:'印刷用に並べる'}).getAttribute('href')).toBe('#/print');
});
test.each([['#usage-title','usage-title'],['#requirements-title','requirements-title'],['#limitations-title','limitations-title'],['#usage','usage-title'],['#requirements','requirements-title'],['#limitations','limitations-title']])('home fragment %s opens the correct section and preserves a canonical bookmark',(fragment,id)=>{
 history.replaceState(null,'',fragment);render(<Root/>);expect(location.hash).toBe('#'+id);expect(document.activeElement).toBe(document.getElementById(id));
});
test('unknown fragments still return to the home route',()=>{
 history.replaceState(null,'','#unknown-qa');render(<Root/>);expect(location.hash).toBe('#/');expect(screen.getByRole('heading',{level:1,name:'写真を、使いたいかたちに。'})).toBeTruthy();
});

test.each([['crop',true],['crop',false],['original',true],['original',false]] as const)('origin invalidation before first visible %s success rolls back, prior photo=%s',async(mode,withPrevious)=>{
 const handle=createRef<EditorHandle>();render(<App requestedMode={mode} sessionRef={handle}/>);
 const alt=mode==='crop'?'test preview':'印刷する写真';
 const display=()=>{
  if(mode==='crop')finish();
  else{const image=screen.getByAltText(alt);Object.defineProperties(image,{naturalWidth:{configurable:true,value:400},naturalHeight:{configurable:true,value:400}});fireEvent.load(image);}
 };
 let oldUrl:string|null=null;
 if(withPrevious){
  fireEvent.change(within(screen.getByRole('complementary',{name:'写真と設定'})).getByLabelText(/写真を選/),{target:{files:[new File(['old'],'old.png',{type:'image/png'})]}});
  await screen.findByAltText(alt);
  // The image DOM can precede the mock cropper's passive effect that registers media callbacks.
  if(mode==='crop')await waitFor(()=>expect(mocks.oldLoads.length).toBeGreaterThan(0));
  display();oldUrl=screen.getByAltText(alt).getAttribute('src');
 }
 let current=true;
 await act(async()=>{expect(await handle.current!.importPhoto(new File(['candidate'],'transfer.png',{type:'image/png'}),()=>current,()=>current)).toBe(true);});
 const candidate=screen.getByAltText(alt).getAttribute('src');expect(candidate).not.toBe(oldUrl);
 const lateDisplay=mode==='crop'?mocks.oldLoads.at(-1):null;
 expectNotSaveable();current=false;display();
 expect(screen.getByRole('alert').textContent).toContain('元の画像が変更されました');
 expect(URL.revokeObjectURL).toHaveBeenCalledWith(candidate);
 if(withPrevious){
  expect(screen.getByAltText(alt).getAttribute('src')).toBe(oldUrl);
  expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(oldUrl);
  if(mode==='crop')act(()=>lateDisplay!());
  expect(screen.getByAltText(alt).getAttribute('src')).toBe(oldUrl);
 }else expect(screen.queryByAltText(alt)).toBeNull();
});

test('switching language preserves the photo, crop controls and current route',async()=>{
 history.replaceState(null,'','#/crop');render(<Root/>);await choose();finish();
 const image=screen.getByAltText('test preview').getAttribute('src');
 fireEvent.change(screen.getByRole('slider',{name:'横位置のスライダー'}),{target:{value:'30'}});
 fireEvent.change(screen.getByRole('combobox',{name:'表示言語'}),{target:{value:'en'}});
 await screen.findByRole('heading',{name:'Resize a photo'});
 expect(screen.getByAltText('test preview').getAttribute('src')).toBe(image);
 expect((screen.getByRole('slider',{name:'Horizontal position slider'}) as HTMLInputElement).value).toBe('30');
 expect(location.hash).toBe('#/crop');expect(document.documentElement.lang).toBe('en');expect(mocks.decode).toHaveBeenCalledOnce();
 fireEvent.change(screen.getByRole('combobox',{name:'Language'}),{target:{value:'ja'}});
 await screen.findByRole('heading',{name:'サイズを整える'});expect(screen.getByAltText('test preview').getAttribute('src')).toBe(image);
 expect((screen.getByRole('slider',{name:'横位置のスライダー'}) as HTMLInputElement).value).toBe('30');
});
