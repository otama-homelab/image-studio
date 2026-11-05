import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import Root from '../src/Root';
import {readBrowserCapabilities,createDiagnostic} from '../src/browserCapabilities';
const originalDialog=Object.fromEntries(['showModal','close'].map(key=>[key,Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype,key)]));
let worker:ReturnType<typeof vi.fn>,canvas:ReturnType<typeof vi.fn>,bitmap:ReturnType<typeof vi.fn>,adapter:ReturnType<typeof vi.fn>,fetchMock:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 worker=vi.fn();canvas=vi.fn();bitmap=vi.fn();adapter=vi.fn();fetchMock=vi.fn();
 vi.stubGlobal('Worker',worker);vi.stubGlobal('OffscreenCanvas',canvas);vi.stubGlobal('createImageBitmap',bitmap);vi.stubGlobal('navigator',{gpu:{requestAdapter:adapter},userAgent:'private-browser-sentinel'});vi.stubGlobal('fetch',fetchMock);vi.stubGlobal('isSecureContext',true);vi.stubGlobal('crossOriginIsolated',false);let id=0;vi.stubGlobal('URL',{createObjectURL:vi.fn(()=>`blob:diagnostic-${++id}`),revokeObjectURL:vi.fn()});
 Object.defineProperties(HTMLDialogElement.prototype,{showModal:{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}},close:{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}}});history.replaceState(null,'','#/crop');
});
afterEach(()=>{cleanup();for(const [key,descriptor] of Object.entries(originalDialog)){if(descriptor)Object.defineProperty(HTMLDialogElement.prototype,key,descriptor);else Reflect.deleteProperty(HTMLDialogElement.prototype,key);}vi.unstubAllGlobals();});
const expectPassive=()=>{expect(worker).not.toHaveBeenCalled();expect(canvas).not.toHaveBeenCalled();expect(bitmap).not.toHaveBeenCalled();expect(adapter).not.toHaveBeenCalled();expect(fetchMock).not.toHaveBeenCalled();};

test('API presence checks and fixed diagnostic schema do not serialize arbitrary browser/session details',()=>{
 const caps=readBrowserCapabilities();expect(caps).toEqual({secureContext:true,worker:true,offscreenCanvas:true,imageBitmap:true,imageData:typeof ImageData==='function',objectURLs:true,fileAPI:true,webgpuAPI:true,webAssembly:true,crossOriginIsolated:false});expectPassive();
 const injected={...caps,filename:'private-photo-sentinel.jpg',url:'blob:private-photo-sentinel',pixels:[1,2,3],userAgent:navigator.userAgent};const file=createDiagnostic(injected);const parsed=JSON.parse(file.text);
 expect(Object.keys(parsed).sort()).toEqual(['appVersion','buildId','check','features','modelDistribution','processing','schemaVersion']);expect(parsed.schemaVersion).toBe(4);expect(parsed.buildId).toBe(__APP_BUILD__.sourceId);expect(parsed.buildId).toMatch(/^sha256:[a-f0-9]{64}$/);expect(createDiagnostic(caps).text).toBe(file.text);expect(parsed.features).toEqual(caps);expect(file.text).not.toContain('private-');expect(file.filename).toBe('image-studio-diagnostics.json');expect(file.mime).toBe('application/json');expect(new TextDecoder().decode(file.bytes)).toBe(file.text);expect(file.bytes.length).toBeLessThan(4096);expect(URL.createObjectURL).not.toHaveBeenCalled();expectPassive();
});

test('support leaves the route unchanged, previews explicit JSON and respects download grace on panel close',()=>{
 const view=render(<Root/>);expect(URL.createObjectURL).not.toHaveBeenCalled();fireEvent.click(within(screen.getByRole('contentinfo')).getByRole('button',{name:'端末情報と診断'}));const dialog=screen.getByRole('dialog',{name:'端末情報と診断'});expect(location.hash).toBe('#/crop');expect(document.activeElement).toBe(within(dialog).getByRole('heading',{name:'端末情報と診断'}));expect(URL.createObjectURL).not.toHaveBeenCalled();expectPassive();
 fireEvent.click(within(dialog).getByRole('button',{name:'診断情報を作成'}));const link=within(dialog).getByRole('link',{name:'診断JSONを保存'});expect(link.getAttribute('download')).toBe('image-studio-diagnostics.json');const text=within(dialog).getByLabelText('保存する診断情報').textContent??'';expect(JSON.parse(text).modelDistribution).toBe('not-shipped');expect(text).not.toContain('blob:');expect(text).not.toContain('private-browser');expect(URL.createObjectURL).toHaveBeenCalledOnce();expectPassive();
 fireEvent.contextMenu(link);fireEvent.click(within(dialog).getByRole('button',{name:'閉じて元の画面に戻る'}));expect(screen.queryByRole('dialog')).toBeNull();expect(location.hash).toBe('#/crop');expect(URL.revokeObjectURL).not.toHaveBeenCalled();view.unmount();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:diagnostic-1');
});

test('missing API explanation and JSON failure stay local; Escape/pagehide clear the panel and unused URL',()=>{
 vi.stubGlobal('Worker',undefined);render(<Root/>);const open=()=>fireEvent.click(within(screen.getByRole('contentinfo')).getByRole('button',{name:'端末情報と診断'}));open();expect(screen.getByRole('alert').textContent).toContain('Worker APIが見つかりません');
 (URL.createObjectURL as ReturnType<typeof vi.fn>).mockImplementationOnce(()=>{throw Error('private-photo-sentinel');});fireEvent.click(screen.getByRole('button',{name:'診断情報を作成'}));expect(screen.queryByRole('link',{name:'診断JSONを保存'})).toBeNull();expect(screen.getByText('診断情報を作れませんでした。画面内の端末情報を確認してください。')).toBeTruthy();expect(document.body.textContent).not.toContain('private-photo-sentinel');
 fireEvent.click(screen.getByRole('button',{name:'診断情報を作成'}));fireEvent(screen.getByRole('dialog'),new Event('cancel',{cancelable:true}));expect(screen.queryByRole('dialog')).toBeNull();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:diagnostic-1');open();fireEvent.click(screen.getByRole('button',{name:'診断情報を作成'}));act(()=>window.dispatchEvent(new Event('pagehide')));expect(screen.queryByRole('dialog')).toBeNull();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:diagnostic-2');expect(adapter).not.toHaveBeenCalled();expect(fetchMock).not.toHaveBeenCalled();
});

test('support remains readable without native modal methods and can close without changing route',()=>{
 Reflect.deleteProperty(HTMLDialogElement.prototype,'showModal');Reflect.deleteProperty(HTMLDialogElement.prototype,'close');render(<Root/>);const trigger=within(screen.getByRole('contentinfo')).getByRole('button',{name:'端末情報と診断'});trigger.focus();fireEvent.click(trigger);expect(screen.getByRole('dialog',{name:'端末情報と診断'})).toBeTruthy();fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(trigger);expect(location.hash).toBe('#/crop');expectPassive();
});

test('configured diagnostic uses only a fixed status and never serializes runtime labels, URLs or session details',()=>{
 const createSession=vi.fn(),decodePhoto=vi.fn();
 const view=render(<Root backgroundRuntime={{createSession,decodePhoto,refineAvailable:false,downloadDescription:'private-photo-sentinel',modelLabel:'private-photo-sentinel',modelNoticesHref:'https://private-photo-sentinel.invalid/license'}}/>);
 fireEvent.click(within(screen.getByRole('contentinfo')).getByRole('button',{name:'端末情報と診断'}));
 const dialog=screen.getByRole('dialog',{name:'端末情報と診断'});expect(dialog.textContent).toContain('非公開検証用のモデル構成が接続されています');
 fireEvent.click(within(dialog).getByRole('button',{name:'診断情報を作成'}));
 const text=within(dialog).getByLabelText('保存する診断情報').textContent??'',parsed=JSON.parse(text);
 expect(parsed.schemaVersion).toBe(4);expect(parsed.modelDistribution).toBe('private-validation-configured');
 expect(text).not.toContain('private-photo-sentinel');expect(text).not.toContain('private-browser-sentinel');expect(text).not.toContain('https:');
 expect(createSession).not.toHaveBeenCalled();expect(decodePhoto).not.toHaveBeenCalled();expectPassive();
 view.rerender(<Root/>);expect(screen.queryByRole('link',{name:'診断JSONを保存'})).toBeNull();
 expect(screen.getByRole('dialog',{name:'端末情報と診断'}).textContent).toContain('モデルは未搭載');
 fireEvent.click(screen.getByRole('button',{name:'診断情報を作成'}));
 expect(JSON.parse(screen.getByLabelText('保存する診断情報').textContent??'').modelDistribution).toBe('not-shipped');
});

test('diagnostic rejects non-boolean model state before serializing arbitrary input',()=>{
 const serialize=vi.fn(()=>({filename:'private-photo-sentinel'}));
 expect(()=>createDiagnostic(readBrowserCapabilities(),{toJSON:serialize} as any)).toThrow('invalid-diagnostic-model-state');
 expect(serialize).not.toHaveBeenCalled();expectPassive();
});

test('WebAssembly reporting checks API presence without compiling or instantiating',()=>{
 const instantiate=vi.fn(),compile=vi.fn();vi.stubGlobal('WebAssembly',{instantiate,compile});
 expect(readBrowserCapabilities().webAssembly).toBe(true);expect(JSON.parse(createDiagnostic(readBrowserCapabilities()).text).features.webAssembly).toBe(true);
 expect(instantiate).not.toHaveBeenCalled();expect(compile).not.toHaveBeenCalled();
 vi.stubGlobal('WebAssembly',undefined);const caps=readBrowserCapabilities();expect(caps.webAssembly).toBe(false);
 expect(JSON.parse(createDiagnostic(caps).text).features.webAssembly).toBe(false);
 render(<Root backgroundRuntime={{createSession:vi.fn(),decodePhoto:vi.fn(),refineAvailable:false,downloadDescription:'fixture'}}/>);
 fireEvent.click(within(screen.getByRole('contentinfo')).getByRole('button',{name:'端末情報と診断'}));
 expect(screen.getByRole('dialog').textContent).toContain('WebAssembly APIが見つかりません');expectPassive();
});

test('release runtime failure keeps the manual editor and print route available with a fixed recovery notice',()=>{
 render(<Root backgroundConfigurationFailed/>);
 expect(screen.getByRole('alert').textContent).toContain('背景機能を読み込めませんでした。');
 expect(screen.getByRole('heading',{name:'写真を、必要なサイズに整える'})).toBeTruthy();
 expect(within(screen.getByRole('heading',{name:'写真を、必要なサイズに整える'}).closest('.app') as HTMLElement).getByLabelText('写真を選ぶ')).toBeTruthy();
 act(()=>{location.hash='#/print';dispatchEvent(new HashChangeEvent('hashchange'));});
 expect(screen.getByRole('heading',{name:'加工済み写真を、用紙に並べる'})).toBeTruthy();
 expect(within(screen.getByRole('heading',{name:'加工済み写真を、用紙に並べる'}).closest('.app') as HTMLElement).getByLabelText('写真を選ぶ')).toBeTruthy();expectPassive();
});
