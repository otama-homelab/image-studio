import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import Root from '../src/Root';
import {BackgroundEditor,type BackgroundRuntime} from '../src/background/BackgroundEditor';

beforeEach(()=>{let id=0;vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=>`blob:background-${++id}`),revokeObjectURL:vi.fn()}));history.replaceState(null,'','#/background');});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function setup({withCache=false,withModels=false,withRoot=false}={}){
 let changed:(state:any)=>void=()=>{};
 const state={modelId:'hr',refineAvailable:true,hasPhoto:false,hasResult:false,busy:false,blocked:false,closed:false,refine:false};
 const files=new Map<string,any>();
 const key=(options:any)=>JSON.stringify({kind:options.kind,backgroundColor:options.backgroundColor});
 const session={getState:()=>({...state}),setPhoto:vi.fn(()=>{state.hasPhoto=true;state.hasResult=false;files.clear();changed({...state});}),
  setModel(id:string){state.modelId=id;state.refineAvailable=id==='hr';state.refine=false;state.hasResult=false;files.clear();changed({...state});},
  setRefine(value:boolean){state.refine=value;state.hasResult=false;files.clear();changed({...state});},
  run:vi.fn(async()=>{state.hasResult=true;changed({...state});return {status:'committed'};}),
  save:vi.fn(async(options:any)=>{files.set(key(options),{bytes:Uint8Array.of(1,2,3),width:3,height:1,mime:'image/png',filename:`image-studio-${options.kind}.png`});return {status:'ready'};}),
  getPrepared:(options:any)=>files.get(key(options))??null,
  cancel:vi.fn(async()=>{}),close:vi.fn(async()=>{state.closed=true;}),
 };
 const runtime:BackgroundRuntime={createSession:vi.fn(callback=>{changed=callback;return session;}),decodePhoto:vi.fn(async()=>({width:3,height:1,format:'rgb-u8' as const,data:new ArrayBuffer(9)})),refineAvailable:true,downloadDescription:'評価用モデル構成。'};
 if(withModels)runtime.models=[{id:'hr',label:'高解像度',description:'高解像度のモデル',processingNotice:'高画質の処理時間に関する注意。',downloadDescription:'HR資源100MiB。'},{id:'light',label:'人物向け軽量',description:'人物用の小さいモデル',downloadDescription:'軽量資源20MiB。'}];
 if(withCache){runtime.inspectCache=vi.fn(async()=>({foundFiles:2,expectedFiles:6,expectedBytes:104,missingBytes:80}));runtime.clearCache=vi.fn(async()=>{});}
 const props={active:true,runtime,onCrop:vi.fn(),onRevision:vi.fn(),onActivity:vi.fn()};
 const view=render(withRoot?<Root backgroundRuntime={runtime}/>:<BackgroundEditor {...props}/>);
 return {view,runtime,session,...props,emitState:(value:any)=>changed({...state,...value})};
}
async function upload(){fireEvent.change(screen.getByLabelText('背景編集の写真を選ぶ'),{target:{files:[new File(['synthetic'],'portrait.png',{type:'image/png'})]}});await screen.findByAltText('背景編集前の写真');}

async function startBackground(){
 fireEvent.click(screen.getByRole('button',{name:'背景を除去してPNGを作成'}));
 if(screen.queryByRole('dialog',{name:'モデルを取得して処理しますか？'})){
  const start=screen.getByRole('button',{name:'取得・検証して処理を始める'});
  await waitFor(()=>expect(start.hasAttribute('disabled')).toBe(false));fireEvent.click(start);
 }
}

test('expired download explains recovery and recreates PNG without rerunning the model',async()=>{
 const f=setup();await upload();await startBackground();
 const saved=await screen.findByRole('link',{name:'透過PNGを保存'});
 vi.spyOn(f.session,'getPrepared').mockReturnValueOnce(null);
 expect(fireEvent.click(saved)).toBe(false);
 expect(screen.getByRole('alert').textContent).toContain('PNGを作り直してください');
 expect(screen.queryByRole('link',{name:'透過PNGを保存'})).toBeNull();
 expect(screen.queryByText('PNGを作成しました。仕上がりを確認して保存、またはサイズ調整へ進んでください。')).toBeNull();
 expect(screen.getByAltText('背景編集前の写真')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'選んだ背景でPNGを作成'}));
 await screen.findByRole('link',{name:'透過PNGを保存'});
 expect(screen.queryByRole('alert')).toBeNull();expect(f.session.run).toHaveBeenCalledOnce();
 expect(f.session.save).toHaveBeenCalledTimes(2);
});

test('unconfigured production route explains availability without starting browser image or GPU work',()=>{
 const worker=vi.fn(),fetch=vi.fn(),gpu=vi.fn();vi.stubGlobal('Worker',worker);vi.stubGlobal('fetch',fetch);vi.stubGlobal('navigator',{gpu:{requestAdapter:gpu}});
 render(<Root/>);expect(screen.getByRole('heading',{name:'背景編集は準備中です'})).toBeTruthy();
 expect(document.activeElement).toBe(screen.getByRole('heading',{name:'写真の背景を整える'}));
 expect(screen.queryByLabelText('背景編集の写真を選ぶ')).toBeNull();expect(worker).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();expect(gpu).not.toHaveBeenCalled();
});

test('photo to PNG and crop handoff; background color changes encode without model rerun and invalidate old transfer',async()=>{
 const f=setup();expect(f.runtime.createSession).not.toHaveBeenCalled();await upload();
 await startBackground();const saved=await screen.findByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/});
 expect(f.session.run).toHaveBeenCalledOnce();expect(f.session.save).toHaveBeenLastCalledWith({kind:'transparent'});
 fireEvent.click(screen.getByRole('button',{name:'白背景にしてサイズ調整へ'}));await waitFor(()=>expect(f.onCrop).toHaveBeenCalledOnce());const transfer=f.onCrop.mock.calls[0][0];expect(transfer.isCurrent()).toBe(true);expect(transfer.file.type).toBe('image/png');expect(f.session.save).toHaveBeenLastCalledWith({kind:'background',backgroundColor:[255,255,255]});expect(screen.getByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/})).toBe(saved);
 fireEvent.contextMenu(saved);const oldUrl=saved.getAttribute('href');
 fireEvent.change(screen.getByLabelText('背景色'),{target:{value:'white'}});
 expect(transfer.isCurrent()).toBe(false);expect(screen.getByRole('link',{name:'透過PNGを保存'})).toBe(saved);expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(oldUrl);
 fireEvent.click(screen.getByRole('button',{name:'選んだ背景でPNGを作成'}));await screen.findByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/});
 expect(f.session.run).toHaveBeenCalledOnce();expect(f.session.save).toHaveBeenLastCalledWith({kind:'background',backgroundColor:[255,255,255]});
 fireEvent.click(screen.getByLabelText('髪や服の輪郭を補正する'));expect(screen.queryByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/})).toBeNull();expect(screen.queryByRole('button',{name:'選んだ背景でPNGを作成'})).toBeNull();
});

test('cancelled model completion cannot encode, preview or transfer a late result',async()=>{
 const f=setup();await upload();let finish!:(value:{status:string})=>void;
 f.session.run.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 await startBackground();fireEvent.click(screen.getByRole('button',{name:'中止'}));
 await act(async()=>{finish({status:'committed'});});expect(f.session.cancel).toHaveBeenCalledOnce();expect(f.session.save).not.toHaveBeenCalled();expect(screen.queryByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/})).toBeNull();
});

test('pagehide aborts input and closes session, invalidating a previously transferred PNG',async()=>{
 const f=setup();await upload();await startBackground();await screen.findByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/});
 fireEvent.click(screen.getByRole('button',{name:'白背景にしてサイズ調整へ'}));await waitFor(()=>expect(f.onCrop).toHaveBeenCalledOnce());const transfer=f.onCrop.mock.calls[0][0];
 act(()=>window.dispatchEvent(new Event('pagehide')));await waitFor(()=>expect(f.session.close).toHaveBeenCalledOnce());
 expect(transfer.isCurrent()).toBe(false);expect(screen.queryByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/})).toBeNull();expect(screen.queryByAltText('背景編集前の写真')).toBeNull();
});

test('explicit cache actions preserve a prepared PNG and its crop handoff without rerunning the model',async()=>{
 const f=setup({withCache:true});expect(f.runtime.inspectCache).not.toHaveBeenCalled();await upload();
 await startBackground();await screen.findByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/});
 fireEvent.click(screen.getByRole('button',{name:'白背景にしてサイズ調整へ'}));await waitFor(()=>expect(f.onCrop).toHaveBeenCalledOnce());const transfer=f.onCrop.mock.calls[0][0];
 fireEvent.click(screen.getByText('モデルの保存データを整理する'));fireEvent.click(screen.getByRole('button',{name:'保存状況を確認'}));await screen.findByText(/キャッシュ内ファイル 2 \/ 6/);
 fireEvent.click(screen.getByRole('button',{name:'使用中モデルの保存データを削除'}));await screen.findByText(/使用中モデルの保存データを削除しました/);
 expect(f.runtime.clearCache).toHaveBeenCalledOnce();expect(transfer.isCurrent()).toBe(true);expect(screen.getByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/})).toBeTruthy();expect(f.session.run).toHaveBeenCalledOnce();
});

test('cache query late completion after pagehide cannot restore stale cache UI',async()=>{
 const f=setup({withCache:true});let finish!:(value:any)=>void;
 vi.mocked(f.runtime.inspectCache!).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 fireEvent.click(screen.getByText('モデルの保存データを整理する'));fireEvent.click(screen.getByRole('button',{name:'保存状況を確認'}));
 act(()=>window.dispatchEvent(new Event('pagehide')));await act(async()=>{finish({foundFiles:6,expectedFiles:6,expectedBytes:104});});
 expect(screen.queryByText(/キャッシュ内ファイル/)).toBeNull();expect(f.runtime.createSession).not.toHaveBeenCalled();
});


test('staged HR displays current completion and retains a reachable cancel action',async()=>{
 const f=setup();await upload();act(()=>f.emitState({busy:true,phase:'inference',modelRole:'hr',stageProgress:{completedStages:12,totalStages:46}}));
 expect(screen.getByRole('status').textContent).toContain('背景を除去しています…（12 / 46）');expect(screen.getByRole('button',{name:'中止'})).toBeTruthy();
 act(()=>f.emitState({busy:true,phase:'foreground',modelRole:'hr',stageProgress:{completedStages:46,totalStages:46}}));
 expect(screen.getByRole('status').textContent).toContain('透過部分の色を整えています');expect(screen.queryByText(/46 \/ 46/)).toBeNull();
});

test('switching model preserves photo and color but removes old download and replaces unavailable refinement with guidance',async()=>{
 const f=setup({withModels:true});await upload();fireEvent.change(screen.getByLabelText('背景色'),{target:{value:'blue'}});await startBackground();await screen.findByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/});
 const saved=screen.getByRole('link',{name:'背景付きPNGを保存'});fireEvent.change(screen.getByLabelText('背景除去モデル'),{target:{value:'hr'}});expect(screen.getByRole('link',{name:'背景付きPNGを保存'})).toBe(saved);expect(f.session.run).toHaveBeenCalledOnce();
 fireEvent.change(screen.getByLabelText('背景除去モデル'),{target:{value:'light'}});expect(screen.queryByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/})).toBeNull();expect(screen.getByAltText('背景編集前の写真')).toBeTruthy();expect((screen.getByLabelText('背景色') as HTMLSelectElement).value).toBe('blue');expect(screen.queryByLabelText('髪や服の輪郭を補正する')).toBeNull();expect(screen.getByText('このモデルは輪郭補正に対応していません。背景除去のみ行います。')).toBeTruthy();expect(screen.getByText('人物用の小さいモデル')).toBeTruthy();expect(f.runtime.decodePhoto).toHaveBeenCalledOnce();
});

 test('cancel during white handoff preserves transparent download and discards late completion',async()=>{
 const f=setup();await upload();await startBackground();
 const saved=await screen.findByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/});const href=saved.getAttribute('href');
 let finish!:(value:{status:string})=>void;
 f.session.save.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 fireEvent.click(screen.getByRole('button',{name:'白背景にしてサイズ調整へ'}));
 expect(screen.getByRole('button',{name:'白背景にしてサイズ調整へ'}).hasAttribute('disabled')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'中止'}));
 await act(async()=>{finish({status:'ready'});});
 expect(f.onCrop).not.toHaveBeenCalled();expect(f.session.run).toHaveBeenCalledOnce();
 expect(screen.getByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/}).getAttribute('href')).toBe(href);
 });


test('retained background mask presents refinement as the next action',async()=>{
 const f=setup();await upload();act(()=>f.emitState({hasPhoto:true,refine:true,hasBackgroundMask:true}));
 expect(screen.getByRole('button',{name:'輪郭を補正してPNGを作成'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'背景を除去してPNGを作成'})).toBeNull();
});


test.each([
 ['resource-access-denied','モデル配信先から取得を拒否されました。'],
 ['transport-failed','モデルを取得できませんでした。接続を確認して'],
 ['resource-rate-limited','モデル配信先が取得を一時的に制限しています。しばらく待ってから'],
 ['bytes-mismatch','モデルの内容を検証できませんでした。保存データを削除'],
 ['bytes-overflow','モデルの内容を検証できませんでした。保存データを削除'],
])('model resource failure %s offers actionable recovery while retaining the photo',async(reason,message)=>{
 const f=setup();await upload();const state=f.session.getState();
 vi.spyOn(f.session,'getState').mockReturnValue({...state,resourceError:reason} as any);
 f.session.run.mockRejectedValueOnce(Error('private source details'));
 await startBackground();
 expect((await screen.findByRole('alert')).textContent).toContain(message);
 expect(screen.getByAltText('背景編集前の写真')).toBeTruthy();expect(f.session.save).not.toHaveBeenCalled();
 expect(screen.queryByText(/private source details/)).toBeNull();
});

 test('cache actions and capacity follow the selected model and clear stale counts on switch',async()=>{
 const f=setup({withCache:true,withModels:true});expect(screen.getByText(/HR資源100MiB/)).toBeTruthy();
 fireEvent.click(screen.getByText('モデルの保存データを整理する'));fireEvent.click(screen.getByRole('button',{name:'保存状況を確認'}));await screen.findByText(/キャッシュ内ファイル 2 \/ 6/);expect(f.runtime.inspectCache).toHaveBeenLastCalledWith('hr');
 fireEvent.change(screen.getByLabelText('背景除去モデル'),{target:{value:'light'}});expect(screen.getByText(/軽量資源20MiB/)).toBeTruthy();expect(screen.queryByText(/HR資源100MiB/)).toBeNull();expect(screen.queryByText(/キャッシュ内ファイル/)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'使用中モデルの保存データを削除'}));await screen.findByText(/使用中モデルの保存データを削除しました/);expect(f.runtime.clearCache).toHaveBeenLastCalledWith('light');expect(f.runtime.inspectCache).toHaveBeenLastCalledWith('light');
 });

test('failed cache deletion or inspection invalidates old counts while keeping the prepared PNG',async()=>{
 const f=setup({withCache:true});await upload();
 await startBackground();const saved=await screen.findByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/});const url=saved.getAttribute('href');
 fireEvent.click(screen.getByText('モデルの保存データを整理する'));
 fireEvent.click(screen.getByRole('button',{name:'保存状況を確認'}));await screen.findByText(/キャッシュ内ファイル 2 \/ 6/);
 vi.mocked(f.runtime.clearCache!).mockRejectedValueOnce(Error('partial deletion private detail'));
 fireEvent.click(screen.getByRole('button',{name:'使用中モデルの保存データを削除'}));await screen.findByText(/モデルの保存データを操作できませんでした/);
 expect(screen.queryByText(/キャッシュ内ファイル/)).toBeNull();expect(screen.queryByText(/partial deletion/)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'保存状況を確認'}));await screen.findByText(/キャッシュ内ファイル 2 \/ 6/);
 vi.mocked(f.runtime.inspectCache!).mockRejectedValueOnce(Error('private inspection'));
 fireEvent.click(screen.getByRole('button',{name:'保存状況を確認'}));await screen.findByText(/モデルの保存データを操作できませんでした/);
 expect(screen.queryByText(/キャッシュ内ファイル/)).toBeNull();expect(screen.getByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/}).getAttribute('href')).toBe(url);expect(f.session.run).toHaveBeenCalledOnce();
});

test('before/after comparison changes display only and is removed when results become stale',async()=>{
 const f=setup();await upload();expect(screen.queryByRole('slider')).toBeNull();
 await startBackground();const saved=await screen.findByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/});
 const slider=screen.getByRole('slider',{name:'仕上がりの表示範囲'});expect(slider.getAttribute('aria-valuetext')).toContain('左50%');
 fireEvent.change(slider,{target:{value:'25'}});expect(slider.getAttribute('aria-valuetext')).toContain('左25%');
 fireEvent.click(screen.getByRole('button',{name:'元の写真のみ'}));expect((slider as HTMLInputElement).value).toBe('0');
 fireEvent.click(screen.getByRole('button',{name:'仕上がりのみ'}));expect((slider as HTMLInputElement).value).toBe('100');
 fireEvent.change(screen.getByRole('combobox',{name:'プレビューの倍率'}),{target:{value:'2'}});expect(screen.getByRole('region',{name:'背景比較の表示領域'}).tabIndex).toBe(0);
 fireEvent.change(screen.getByRole('combobox',{name:'プレビューの倍率'}),{target:{value:'fit'}});expect(screen.getByRole('region',{name:'背景比較の表示領域'}).tabIndex).toBe(-1);
 expect(screen.getByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/})).toBe(saved);expect(f.session.run).toHaveBeenCalledOnce();expect(f.session.save).toHaveBeenCalledOnce();
 fireEvent.change(screen.getByLabelText('背景色'),{target:{value:'white'}});expect(screen.getByRole('slider')).toBe(slider);expect(screen.getByRole('link',{name:'透過PNGを保存'})).toBe(saved);fireEvent.contextMenu(saved);expect(screen.getByRole('link',{name:'透過PNGを保存'})).toBe(saved);expect(f.session.run).toHaveBeenCalledOnce();expect(f.session.save).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByLabelText('髪や服の輪郭を補正する'));expect(screen.queryByRole('slider')).toBeNull();expect(screen.queryByAltText('背景編集後の写真')).toBeNull();
});

test('custom background color reuses inference and invalidates only generated PNG and handoff',async()=>{
 const f=setup();await upload();await startBackground();await screen.findByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/});
 fireEvent.change(screen.getByLabelText('背景色'),{target:{value:'custom'}});
 expect((screen.getByLabelText('指定する背景色') as HTMLInputElement).value).toBe('#f5f3ef');
 fireEvent.change(screen.getByLabelText('指定する背景色'),{target:{value:'#1234ab'}});
 expect(screen.getByRole('link',{name:'透過PNGを保存'})).toBeTruthy();expect(f.session.run).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole('button',{name:'選んだ背景でPNGを作成'}));await screen.findByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/});
 expect(f.session.save).toHaveBeenLastCalledWith({kind:'background',backgroundColor:[18,52,171]});
 fireEvent.click(screen.getByRole('button',{name:'このPNGをサイズ調整へ'}));await waitFor(()=>expect(f.onCrop).toHaveBeenCalledOnce());const transfer=f.onCrop.mock.calls[0][0];
 fireEvent.change(screen.getByLabelText('指定する背景色'),{target:{value:'#a0b0c0'}});expect(transfer.isCurrent()).toBe(false);expect(screen.queryByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/})).toBeNull();
 expect(f.session.run).toHaveBeenCalledOnce();expect(f.session.save).toHaveBeenCalledTimes(2);
});

test('explicit transparent export keeps selected background and uses white handoff based on exported kind',async()=>{
 const f=setup();await upload();fireEvent.change(screen.getByLabelText('背景色'),{target:{value:'red'}});
 await startBackground();await screen.findByRole('link',{name:'背景付きPNGを保存'});
 expect(f.session.save).toHaveBeenLastCalledWith({kind:'background',backgroundColor:[220,50,50]});
 fireEvent.click(screen.getByRole('button',{name:'透過PNGを作成'}));const transparent=await screen.findByRole('link',{name:'透過PNGを保存'});
 expect((screen.getByLabelText('背景色') as HTMLSelectElement).value).toBe('red');expect(f.session.save).toHaveBeenLastCalledWith({kind:'transparent'});expect(screen.queryByRole('link',{name:'背景付きPNGを保存'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'白背景にしてサイズ調整へ'}));await waitFor(()=>expect(f.onCrop).toHaveBeenCalledOnce());
 expect(f.session.save).toHaveBeenLastCalledWith({kind:'background',backgroundColor:[255,255,255]});expect(f.onCrop.mock.calls[0][0].file.name).toBe('image-studio-background.png');expect(screen.getByRole('link',{name:'透過PNGを保存'})).toBe(transparent);
 fireEvent.click(screen.getByRole('button',{name:'選んだ背景でPNGを作成'}));await screen.findByRole('link',{name:'背景付きPNGを保存'});
 expect(f.session.save).toHaveBeenLastCalledWith({kind:'background',backgroundColor:[220,50,50]});expect(f.session.run).toHaveBeenCalledOnce();
});

test('explicit storage check reports missing bytes and quota failure preserves a prepared PNG',async()=>{
 const f=setup({withCache:true});
 const estimate=vi.fn(async()=>({usageBytes:0,quotaBytes:0,availableBytes:0}));
 expect(estimate).not.toHaveBeenCalled();await upload();
 await startBackground();
 const saved=await screen.findByRole('link',{name:'透過PNGを保存'}),href=saved.getAttribute('href');f.runtime.estimateStorage=estimate;
 fireEvent.click(screen.getByRole('button',{name:'保存状況を確認'}));
 await screen.findByText('ブラウザ保存領域の空き見積り：約0MiB');
 expect(screen.getByText('未保存モデル資源の取得見積り：約1MiB')).toBeTruthy();
 expect(screen.getByText(/見積り上は保存領域が不足/)).toBeTruthy();
 estimate.mockRejectedValueOnce(Error('quota unavailable'));
 fireEvent.click(screen.getByRole('button',{name:'保存状況を確認'}));
 await screen.findByText('ブラウザ保存領域の空き容量を取得できませんでした。容量は不明です。');
 expect(screen.queryByText('ブラウザ保存領域の空き見積り：約0MiB')).toBeNull();
 expect(screen.getByText(/キャッシュ内ファイル 2 \/ 6/)).toBeTruthy();
 expect(screen.getByRole('link',{name:'透過PNGを保存'}).getAttribute('href')).toBe(href);
 expect(f.session.run).toHaveBeenCalledOnce();expect(f.session.save).toHaveBeenCalledOnce();
});

test('late storage estimate cannot restore cache information after pagehide',async()=>{
 const f=setup({withCache:true});let resolve!:(value:any)=>void;
 f.runtime.estimateStorage=()=>new Promise(done=>{resolve=done;});
 fireEvent.click(screen.getByRole('button',{name:'保存状況を確認'}));
 fireEvent(window,new Event('pagehide'));
 await act(async()=>{resolve({usageBytes:0,quotaBytes:1048576,availableBytes:1048576});});
 expect(screen.queryByText(/ブラウザ保存領域の空き見積り/)).toBeNull();
 expect(screen.queryByText(/キャッシュ内ファイル/)).toBeNull();
 expect(f.session.run).not.toHaveBeenCalled();
});

test('model preparation precedes photo selection and inspection starts no session, image decode or inference',async()=>{
 const f=setup({withCache:true,withModels:true});
 const panel=screen.getByRole('region',{name:'モデルの準備'}),photo=screen.getByLabelText('背景編集の写真を選ぶ');
 expect(panel.compareDocumentPosition(photo)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(panel.contains(screen.getByLabelText('背景除去モデル'))).toBe(true);
 expect(panel.contains(screen.getByRole('button',{name:'保存状況を確認'}))).toBe(true);
 expect(f.runtime.inspectCache).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'保存状況を確認'}));
 await screen.findByText(/キャッシュ内ファイル 2 \/ 6/);
 expect(f.runtime.inspectCache).toHaveBeenCalledWith('hr');
 expect(f.runtime.createSession).not.toHaveBeenCalled();expect(f.runtime.decodePhoto).not.toHaveBeenCalled();expect(f.session.run).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('背景除去モデル'),{target:{value:'light'}});
 expect(screen.queryByText(/キャッシュ内ファイル/)).toBeNull();
 expect(panel.textContent).toContain('軽量資源20MiB');
 expect(f.runtime.decodePhoto).not.toHaveBeenCalled();expect(f.session.run).not.toHaveBeenCalled();
});

test('acquisition consent returns without inference and requires a new explicit start',async()=>{
 const f=setup({withCache:true});await upload();
 fireEvent.click(screen.getByRole('button',{name:'背景を除去してPNGを作成'}));
 await screen.findByRole('dialog',{name:'モデルを取得して処理しますか？'});
 await waitFor(()=>expect(screen.getByRole('button',{name:'取得・検証して処理を始める'}).hasAttribute('disabled')).toBe(false));
 expect(f.session.run).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'写真と設定に戻る'}));
 expect(screen.queryByRole('dialog',{name:'モデルを取得して処理しますか？'})).toBeNull();
 expect(screen.getByAltText('背景編集前の写真')).toBeTruthy();expect(f.session.run).not.toHaveBeenCalled();
 await startBackground();await screen.findByRole('link',{name:'透過PNGを保存'});expect(f.session.run).toHaveBeenCalledOnce();
});

test('known insufficient storage blocks consent; late inspection after dismissal cannot start a model',async()=>{
 const f=setup({withCache:true});f.runtime.estimateStorage=async()=>({usageBytes:0,quotaBytes:0,availableBytes:0});await upload();
 fireEvent.click(screen.getByRole('button',{name:'背景を除去してPNGを作成'}));
 await screen.findByText('見積り上は保存領域が不足しています。戻って保存データを整理してください。');
 expect(screen.getByRole('button',{name:'取得・検証して処理を始める'}).hasAttribute('disabled')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'写真と設定に戻る'}));
 let resolve!:(value:any)=>void;f.runtime.estimateStorage=()=>new Promise(done=>{resolve=done;});
 fireEvent.click(screen.getByRole('button',{name:'背景を除去してPNGを作成'}));
 fireEvent.click(screen.getByRole('button',{name:'写真と設定に戻る'}));
 await act(async()=>{resolve({usageBytes:0,quotaBytes:1000,availableBytes:1000});});
 expect(screen.queryByRole('dialog',{name:'モデルを取得して処理しますか？'})).toBeNull();expect(f.session.run).not.toHaveBeenCalled();
});

test('changed output revision invalidates acquisition intent without running stale options',async()=>{
 const f=setup({withCache:true});await upload();
 fireEvent.click(screen.getByRole('button',{name:'背景を除去してPNGを作成'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'取得・検証して処理を始める'}).hasAttribute('disabled')).toBe(false));
 fireEvent.change(screen.getByLabelText('背景色'),{target:{value:'blue'}});
 fireEvent.click(screen.getByRole('button',{name:'取得・検証して処理を始める'}));
 expect(f.session.run).not.toHaveBeenCalled();expect(f.session.save).not.toHaveBeenCalled();
});

test('pagehide discards a pending acquisition intent and its late inspection',async()=>{
 const f=setup({withCache:true});await upload();let resolve!:(value:any)=>void;
 f.runtime.inspectCache=()=>new Promise(done=>{resolve=done;});
 fireEvent.click(screen.getByRole('button',{name:'背景を除去してPNGを作成'}));
 fireEvent(window,new Event('pagehide'));
 await act(async()=>{resolve({foundFiles:0,expectedFiles:6,expectedBytes:104,missingBytes:104});});
 expect(screen.queryByRole('dialog',{name:'モデルを取得して処理しますか？'})).toBeNull();
 expect(f.session.run).not.toHaveBeenCalled();expect(f.session.close).toHaveBeenCalledOnce();
});

test('missing required API rejects model acquisition before cache scan and inference while preserving photo',async()=>{
 const f=setup({withCache:true});f.runtime.checkEnvironment=vi.fn(()=>({mode:'gpu',missing:['WebGPU']}));await upload();
 fireEvent.click(screen.getByRole('button',{name:'背景を除去してPNGを作成'}));
 expect(screen.getByRole('alert').textContent).toContain('WebGPU');
 expect(f.runtime.inspectCache).not.toHaveBeenCalled();expect(f.session.run).not.toHaveBeenCalled();
 expect(screen.queryByRole('dialog',{name:'モデルを取得して処理しますか？'})).toBeNull();expect(screen.getByAltText('背景編集前の写真')).toBeTruthy();
});

test('Root route change closes preparation and ignores its late result; returning retains the photo',async()=>{
 const f=setup({withCache:true,withRoot:true});await upload();let resolve!:(value:any)=>void;
 vi.mocked(f.runtime.inspectCache!).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 fireEvent.click(screen.getByRole('button',{name:'背景を除去してPNGを作成'}));
 expect(screen.getByRole('dialog',{name:'モデルを取得して処理しますか？'})).toBeTruthy();
 act(()=>{history.replaceState(null,'','#/crop');window.dispatchEvent(new HashChangeEvent('hashchange'));});
 expect(screen.queryByRole('dialog',{name:'モデルを取得して処理しますか？'})).toBeNull();
 await act(async()=>{resolve({foundFiles:6,expectedFiles:6,expectedBytes:104,missingBytes:0});});
 act(()=>{history.replaceState(null,'','#/background');window.dispatchEvent(new HashChangeEvent('hashchange'));});
 expect(screen.getByAltText('背景編集前の写真')).toBeTruthy();expect(f.session.close).not.toHaveBeenCalled();
 expect(screen.queryByText(/キャッシュ内ファイル/)).toBeNull();expect(f.session.run).not.toHaveBeenCalled();
 await startBackground();await screen.findByRole('link',{name:'透過PNGを保存'});expect(f.session.run).toHaveBeenCalledOnce();
});

test('native dialog cancel preserves the previous PNG and photo without another inference',async()=>{
 const f=setup({withCache:true});await upload();await startBackground();
 const saved=await screen.findByRole('link',{name:'透過PNGを保存'}),href=saved.getAttribute('href');
 fireEvent.click(screen.getByRole('button',{name:'背景を除去してPNGを作成'}));
 fireEvent(screen.getByRole('dialog',{name:'モデルを取得して処理しますか？'}),new Event('cancel',{cancelable:true}));
 expect(screen.queryByRole('dialog',{name:'モデルを取得して処理しますか？'})).toBeNull();
 expect(screen.getByRole('link',{name:'透過PNGを保存'}).getAttribute('href')).toBe(href);expect(screen.getByAltText('背景編集前の写真')).toBeTruthy();
 expect(f.session.run).toHaveBeenCalledOnce();expect(f.session.save).toHaveBeenCalledOnce();
});

test('elapsed time uses monotonic wall time across stages and stops on idle and pagehide',async()=>{
 const f=setup();await upload();let clock=1000;const now=vi.spyOn(performance,'now').mockImplementation(()=>clock);
 vi.useFakeTimers({toFake:['setInterval','clearInterval']});
 try{
  act(()=>f.emitState({busy:true,phase:'model-load'}));expect(screen.getByText(/経過時間：0秒/).getAttribute('aria-live')).toBe('off');
  clock=13500;act(()=>vi.advanceTimersByTime(1000));expect(screen.getByText(/経過時間：12秒/)).toBeTruthy();
  act(()=>f.emitState({busy:true,phase:'inference'}));clock=18000;act(()=>vi.advanceTimersByTime(1000));expect(screen.getByText(/経過時間：17秒/)).toBeTruthy();
  act(()=>f.emitState({busy:false}));expect(screen.queryByText(/経過時間：/)).toBeNull();expect(vi.getTimerCount()).toBe(0);
  clock=20000;act(()=>f.emitState({busy:true,phase:'foreground'}));expect(screen.getByText(/経過時間：0秒/)).toBeTruthy();
  fireEvent(window,new Event('pagehide'));expect(screen.queryByText(/経過時間：/)).toBeNull();expect(vi.getTimerCount()).toBe(0);
  expect(f.session.run).not.toHaveBeenCalled();expect(f.session.save).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();now.mockRestore();}
});

test('pagehide stops the elapsed timer even while an inference promise is still unwinding',async()=>{
 const f=setup();await upload();let resolve!:(value:{status:string})=>void;
 f.session.run.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 vi.useFakeTimers({toFake:['setInterval','clearInterval']});
 try{
  fireEvent.click(screen.getByRole('button',{name:'背景を除去してPNGを作成'}));expect(vi.getTimerCount()).toBe(1);
  fireEvent(window,new Event('pagehide'));expect(vi.getTimerCount()).toBe(0);
  await act(async()=>{resolve({status:'committed'});});expect(f.session.save).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});

test('configured Root footer exposes supplied model notices without starting models or fetching license documents',()=>{
 const createSession=vi.fn(),decodePhoto=vi.fn(),fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 render(<Root backgroundRuntime={{createSession,decodePhoto,refineAvailable:false,downloadDescription:'Comparison',modelNoticesHref:'/validation-notices/model-candidates/MODEL_CANDIDATE_NOTICES.txt'}}/>);
 const footer=screen.getByRole('contentinfo'),link=screen.getByRole('link',{name:'検証モデルのライセンス・モデルカード・出典'});
 expect(footer.contains(link)).toBe(true);expect(link.getAttribute('href')).toBe('/validation-notices/model-candidates/MODEL_CANDIDATE_NOTICES.txt');
 expect(link.getAttribute('target')).toBe('_blank');expect(link.getAttribute('rel')).toContain('noopener');
 expect(footer.textContent).toContain('未採用分を含む比較候補');expect(footer.textContent).not.toContain('搭載・配布していません');
 expect(createSession).not.toHaveBeenCalled();expect(decodePhoto).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});

test.each([['unsupported-browser','必要なブラウザ機能'],['png-dimensions-too-large','各辺4,096px以内'],['image-file-too-large','20MiB以下'],['background-input-busy','ほかの画像処理'],['background-input-stop-failed','ページを再読み込み']])('replacement failure %s explains recovery and preserves existing photo and PNG',async(code,reason)=>{
 const f=setup();await upload();await startBackground();const saved=await screen.findByRole('link',{name:'透過PNGを保存'}),href=saved.getAttribute('href'),src=screen.getByAltText('背景編集前の写真').getAttribute('src'),revision=f.onRevision.mock.calls.length;
 vi.mocked(f.runtime.decodePhoto).mockRejectedValueOnce(Object.assign(Error('private-photo-sentinel'),{code}));
 fireEvent.change(screen.getByLabelText('背景編集の写真を選ぶ'),{target:{files:[new File(['invalid'],'replacement.png',{type:'image/png'})]}});
 fireEvent.click(screen.getByRole('button',{name:'写真を置き換える'}));const error=await screen.findByRole('alert');expect(error.textContent).toContain(reason);expect(error.textContent).toContain('保持しています');expect(error.textContent).not.toContain('private-photo-sentinel');
 expect(screen.getByRole('link',{name:'透過PNGを保存'}).getAttribute('href')).toBe(href);expect(screen.getByAltText('背景編集前の写真').getAttribute('src')).toBe(src);expect(f.session.setPhoto).toHaveBeenCalledOnce();expect(f.session.run).toHaveBeenCalledOnce();expect(f.session.save).toHaveBeenCalledOnce();expect(f.onRevision.mock.calls.length).toBe(revision);
});

test('configured index leads to model preparation without contradictory not-available copy or automatic work',async()=>{
 history.replaceState(null,'','#/');const createSession=vi.fn(),decodePhoto=vi.fn(),inspectCache=vi.fn(),fetch=vi.fn(),worker=vi.fn();
 vi.stubGlobal('fetch',fetch);vi.stubGlobal('Worker',worker);
 render(<Root backgroundRuntime={{createSession,decodePhoto,inspectCache,refineAvailable:false,downloadDescription:'比較用モデル構成。'}}/>);
 expect(screen.getByRole('link',{name:'背景を編集する（検証用）'}).getAttribute('href')).toBe('#/background');
 expect(screen.getByRole('heading',{name:'背景編集を試す（検証用）'})).toBeTruthy();
 expect(screen.queryByText(/現在のWeb版ではモデルを取得しません/)).toBeNull();expect(screen.queryByRole('heading',{name:'背景編集は準備中'})).toBeNull();
 expect(screen.getByText(/背景を編集する場合：モデルと保存状況を確認/)).toBeTruthy();
 fireEvent.click(screen.getByRole('link',{name:'モデルの準備へ進む'}));await screen.findByRole('region',{name:'モデルの準備'});
 expect(screen.getByLabelText('背景編集の写真を選ぶ')).toBeTruthy();expect(inspectCache).not.toHaveBeenCalled();expect(createSession).not.toHaveBeenCalled();expect(decodePhoto).not.toHaveBeenCalled();expect(worker).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});

test.each([
 {refine:false,mask:false,needed:32,quota:64,allowed:true},
 {refine:true,mask:false,needed:128,quota:64,allowed:false},
 {refine:true,mask:true,needed:96,quota:100,allowed:true},
])('preparation uses operation bytes independently of full cache view: refine=$refine mask=$mask',async item=>{
 const f=setup({withCache:true}),info=(mib:number)=>({foundFiles:0,expectedFiles:mib===128?2:1,expectedBytes:mib*1024**2,missingBytes:mib*1024**2});
 f.runtime.inspectCache=vi.fn(async(_id,selection)=>info(selection?(selection.refine?(selection.backgroundMaskAvailable?96:128):32):128));
 f.runtime.estimateStorage=async()=>({usageBytes:0,quotaBytes:item.quota*1024**2,availableBytes:item.quota*1024**2});
 await upload();fireEvent.click(screen.getByRole('button',{name:'保存状況を確認'}));await screen.findByText('未保存モデル資源の取得見積り：約128MiB');
 if(item.refine)fireEvent.click(screen.getByLabelText('髪や服の輪郭を補正する'));
 if(item.mask)act(()=>f.emitState({hasBackgroundMask:true}));
 fireEvent.click(screen.getByRole('button',{name:item.refine&&item.mask?'輪郭を補正してPNGを作成':'背景を除去してPNGを作成'}));
 await screen.findByText(`今回の処理で未保存のモデル資源：約${item.needed}MiB`);
 expect(f.runtime.inspectCache).toHaveBeenLastCalledWith('hr',{refine:item.refine,backgroundMaskAvailable:item.mask});
 const start=screen.getByRole('button',{name:'取得・検証して処理を始める'});expect(start.hasAttribute('disabled')).toBe(!item.allowed);expect(f.session.run).not.toHaveBeenCalled();
 expect(screen.getByText('未保存モデル資源の取得見積り：約128MiB')).toBeTruthy();
 if(item.allowed){fireEvent.click(start);await screen.findByRole('link',{name:'透過PNGを保存'});expect(f.session.run).toHaveBeenCalledOnce();}
});


test('device loss offers retry without exposing worker exceptions or losing the photo',async()=>{
 const f=setup();await upload();const state=f.session.getState();
 vi.spyOn(f.session,'getState').mockReturnValue({...state,inferenceError:'device-lost'} as any);f.session.run.mockRejectedValueOnce(Error('private gpu exception'));
 await startBackground();expect((await screen.findByRole('alert')).textContent).toContain('GPUとの接続が失われました');
 expect(screen.getByAltText('背景編集前の写真')).toBeTruthy();expect(f.session.save).not.toHaveBeenCalled();expect(screen.queryByText(/private gpu exception/)).toBeNull();
});

test('generic failure shows the retained refinement stage and fixed code while preserving recovery',async()=>{
 const f=setup({withModels:true});await upload();const state=f.session.getState();
 vi.spyOn(f.session,'getState').mockReturnValue({...state,phase:'idle',lastFailure:{phase:'inference',modelRole:'matte',code:'runtime-error'}} as any);
 f.session.run.mockRejectedValueOnce(Error('private exception body'));
 await startBackground();const alert=await screen.findByRole('alert');
 expect(alert.textContent).toContain('失敗した段階：輪郭補正');expect(alert.textContent).toContain('コード：runtime-error');
 expect(alert.textContent).not.toContain('private');expect(screen.getByAltText('背景編集前の写真')).toBeTruthy();
 expect(screen.getByRole('link',{name:'背景を変えずにサイズ調整'}).getAttribute('href')).toBe('#/crop');
 fireEvent.change(screen.getByLabelText('背景除去モデル'),{target:{value:'light'}});expect(screen.queryByRole('alert')).toBeNull();
});

test.each([
 {phase:'inference',modelRole:'hr',code:'private-code',label:'背景除去'},
 {phase:'private-phase',modelRole:'private-role',code:'private-code',label:'処理段階不明'},
])('failure details redact unknown codes and stage fields: $phase',async details=>{
 const f=setup();await upload();const state=f.session.getState();
 vi.spyOn(f.session,'getState').mockReturnValue({...state,lastFailure:details} as any);f.session.run.mockRejectedValueOnce(Error('private exception body'));
 await startBackground();const alert=await screen.findByRole('alert');
 expect(alert.textContent).toContain(`失敗した段階：${details.label}`);expect(alert.textContent).toContain('コード：runtime-error');expect(document.body.textContent).not.toContain('private-');
});

test('cache eviction during consent requires agreement to the increased download before inference',async()=>{
 const f=setup({withCache:true});
 const info=(missingBytes:number)=>({foundFiles:missingBytes?0:6,expectedFiles:6,expectedBytes:8*1024**2,missingBytes});
 f.runtime.inspectCache=vi.fn().mockResolvedValueOnce(info(0)).mockResolvedValue(info(8*1024**2));
 await upload();fireEvent.click(screen.getByRole('button',{name:'背景を除去してPNGを作成'}));
 await screen.findByText('今回の処理で未保存のモデル資源：約0MiB');
 fireEvent.click(screen.getByRole('button',{name:'取得・検証して処理を始める'}));
 await screen.findByText('保存状況が変わりました。取得量と空き容量を確認してください。');
 expect(screen.getByText('今回の処理で未保存のモデル資源：約8MiB')).toBeTruthy();expect(f.session.run).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'取得・検証して処理を始める'}));
 await screen.findByRole('link',{name:'透過PNGを保存'});expect(f.session.run).toHaveBeenCalledOnce();
});

test('dismissing consent during the final cache check prevents a late model start',async()=>{
 const f=setup({withCache:true});await upload();
 fireEvent.click(screen.getByRole('button',{name:'背景を除去してPNGを作成'}));
 await screen.findByText('今回の処理で未保存のモデル資源：約1MiB');
 let resolve!:(value:any)=>void;f.runtime.inspectCache=()=>new Promise(done=>{resolve=done;});
 fireEvent.click(screen.getByRole('button',{name:'取得・検証して処理を始める'}));
 await waitFor(()=>expect(resolve).toBeTypeOf('function'));
 fireEvent.click(screen.getByRole('button',{name:'写真と設定に戻る'}));
 await act(async()=>resolve({foundFiles:6,expectedFiles:6,expectedBytes:104,missingBytes:0}));
 expect(f.session.run).not.toHaveBeenCalled();expect(screen.queryByRole('dialog')).toBeNull();
});

test('lost cache inspection requires explicit consent to unknown download volume',async()=>{
 const f=setup({withCache:true});await upload();
 fireEvent.click(screen.getByRole('button',{name:'背景を除去してPNGを作成'}));
 await screen.findByText('今回の処理で未保存のモデル資源：約1MiB');
 f.runtime.inspectCache=vi.fn().mockRejectedValue(Error('private-storage-error'));
 fireEvent.click(screen.getByRole('button',{name:'取得・検証して処理を始める'}));
 await screen.findByText('保存状況を確認できませんでした。必要な取得量は不明です。');
 expect(f.session.run).not.toHaveBeenCalled();expect(screen.queryByText(/private-storage-error/)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'取得・検証して処理を始める'}));
 await screen.findByRole('link',{name:'透過PNGを保存'});expect(f.session.run).toHaveBeenCalledOnce();
});


test('generic Worker failure explains connectivity recovery and preserves the photo',async()=>{
 const f=setup();await upload();f.session.run.mockRejectedValueOnce(Error('private-worker-failure'));
 await startBackground();const alert=await screen.findByRole('alert');
 expect(alert.textContent).toContain('実行用プログラムの取得に接続が必要な場合があります');
 expect(alert.textContent).toContain('接続と端末情報を確認');expect(alert.textContent).not.toContain('private-worker-failure');
 expect(screen.getByAltText('背景編集前の写真')).toBeTruthy();expect(f.session.save).not.toHaveBeenCalled();
 await startBackground();await screen.findByRole('link',{name:'透過PNGを保存'});expect(f.session.run).toHaveBeenCalledTimes(2);
});

 test('selected algorithm notice disappears when switching to the lightweight model',async()=>{
 setup({withModels:true});expect(screen.getByText('高画質の処理時間に関する注意。')).toBeTruthy();
 await upload();fireEvent.change(screen.getByLabelText('背景除去モデル'),{target:{value:'light'}});
 expect(screen.queryByText('高画質の処理時間に関する注意。')).toBeNull();
 });


test('pending cancellation explains the wait and does not enable saving or publish a late result',async()=>{
 const f=setup();await upload();let finish!:(value:{status:string})=>void,stop!:()=>void;
 f.session.run.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 f.session.cancel.mockImplementationOnce(()=>new Promise(resolve=>{stop=resolve;}));
 await startBackground();fireEvent.click(screen.getByRole('button',{name:'中止'}));
 expect(screen.getByText('中止しています…終了の確認に時間がかかることがあります。')).toBeTruthy();
 expect(screen.getByRole('button',{name:'背景を除去してPNGを作成'}).hasAttribute('disabled')).toBe(true);
 expect(screen.queryByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/})).toBeNull();
 await act(async()=>{finish({status:'committed'});});expect(f.session.save).not.toHaveBeenCalled();
 expect(screen.queryByRole('link',{name:/^(?:透過|背景付き)PNGを保存$/})).toBeNull();
 await act(async()=>{stop();});expect(screen.getByText('処理を中止しました。写真を確認して、もう一度実行できます。')).toBeTruthy();
 expect(screen.getByAltText('背景編集前の写真')).toBeTruthy();
});


test('stopping acknowledgement stays beside the disabled cancel control without a duplicate notice',async()=>{
 const f=setup();await upload();let finish!:(value:{status:string})=>void,stop!:()=>void;
 f.session.run.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 f.session.cancel.mockImplementationOnce(()=>{f.emitState({phase:'stopping',busy:true});return new Promise(resolve=>{stop=resolve;});});
 await startBackground();fireEvent.click(screen.getByRole('button',{name:'中止'}));
 const control=screen.getByRole('button',{name:'中止しています…'});expect(control.hasAttribute('disabled')).toBe(true);
 const messages=screen.getAllByText('中止しています…終了の確認に時間がかかることがあります。');expect(messages).toHaveLength(1);
 expect(control.closest('section')?.contains(messages[0])).toBe(true);
 await act(async()=>{stop();finish({status:'stale'});});expect(f.session.save).not.toHaveBeenCalled();
});

test('global activity reflects pending background cancellation after navigating away',async()=>{
 const f=setup({withRoot:true});await upload();let finish!:(value:{status:string})=>void,stop!:()=>void;
 f.session.run.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 f.session.cancel.mockImplementationOnce(()=>{f.emitState({phase:'stopping',busy:true});return new Promise(resolve=>{stop=resolve;});});
 await startBackground();act(()=>{history.replaceState(null,'','#/crop');window.dispatchEvent(new HashChangeEvent('hashchange'));});
 fireEvent.click(screen.getByRole('button',{name:'中止'}));
 const pending=await screen.findByRole('button',{name:'中止しています…'});expect(pending.hasAttribute('disabled')).toBe(true);
 fireEvent.click(pending);expect(f.session.cancel).toHaveBeenCalledOnce();
 await act(async()=>{f.emitState({phase:'idle',busy:false});stop();finish({status:'stale'});});
 await waitFor(()=>expect(screen.queryByRole('button',{name:'中止しています…'})).toBeNull());expect(f.session.save).not.toHaveBeenCalled();
});

test('archive transfer estimate is separate from missing storage and does not block sufficient quota',async()=>{
 const f=setup({withCache:true});
 vi.mocked(f.runtime.inspectCache!).mockResolvedValue({foundFiles:2,expectedFiles:6,expectedBytes:128*1024**2,missingBytes:32*1024**2,downloadBytes:140*1024**2});
 f.runtime.estimateStorage=async()=>({usageBytes:0,quotaBytes:64*1024**2,availableBytes:64*1024**2});
 await upload();
 fireEvent.click(screen.getByRole('button',{name:'保存状況を確認'}));
 await screen.findByText('モデルのダウンロード見積り：約140MiB');
 expect(screen.getByText(/一部が未保存の場合も、まとめたファイル全体を再取得/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'背景を除去してPNGを作成'}));
 await screen.findByText('今回の処理で未保存のモデル資源：約32MiB');
 expect(screen.getByText('今回のモデルのダウンロード見積り：約140MiB')).toBeTruthy();
 const start=screen.getByRole('button',{name:'取得・検証して処理を始める'});
 expect((start as HTMLButtonElement).disabled).toBe(false);
 fireEvent.click(start);await waitFor(()=>expect(f.session.run).toHaveBeenCalledOnce());
});

test.each(['inference','export'] as const)('same-task %s clicks start only one operation and preserve its saved result',async(kind)=>{
 const f=setup();await upload();
 if(kind==='export'){
  await startBackground();await screen.findByRole('link',{name:'透過PNGを保存'});
  fireEvent.change(screen.getByLabelText('背景色'),{target:{value:'blue'}});
 }
 const operation=kind==='inference'?f.session.run:f.session.save;
 const original=operation.getMockImplementation()!;
 const finish:(()=>void)[]=[];
 operation.mockImplementation((...args:any[])=>new Promise(resolve=>{finish.push(()=>{resolve((original as any)(...args));});}) as any);
 operation.mockClear();
 const button=screen.getByRole('button',{name:kind==='inference'?'背景を除去してPNGを作成':'選んだ背景でPNGを作成'});
 act(()=>{button.click();button.click();});
 const started=operation.mock.calls.length;
 await act(async()=>{for(const resolve of finish)resolve();});
 expect(started).toBe(1);
 expect(await screen.findByRole('link',{name:kind==='inference'?'透過PNGを保存':'背景付きPNGを保存'})).toBeTruthy();
});

test('failed preparation releases same-task admission so the photo can be retried',async()=>{
 const f=setup();await upload();f.session.run.mockRejectedValueOnce(new Error('inference failed'));
 const button=screen.getByRole('button',{name:'背景を除去してPNGを作成'});
 act(()=>{button.click();button.click();});
 expect(await screen.findByRole('alert')).toBeTruthy();expect(f.session.run).toHaveBeenCalledOnce();
 fireEvent.click(button);
 expect(await screen.findByRole('link',{name:'透過PNGを保存'})).toBeTruthy();expect(f.session.run).toHaveBeenCalledTimes(2);
});

test('same-task file changes admit one decode and keep input busy until it settles',async()=>{
 const f=setup(),finish:(()=>void)[]=[];
 f.runtime.decodePhoto=vi.fn(()=>new Promise(resolve=>{finish.push(()=>resolve({width:3,height:1,format:'rgb-u8',data:new ArrayBuffer(9)}));}));
 const input=screen.getByLabelText('背景編集の写真を選ぶ') as HTMLInputElement;
 act(()=>{
  for(const name of ['first.png','second.png']){
   Object.defineProperty(input,'files',{configurable:true,value:[new File(['synthetic'],name,{type:'image/png'})]});
   input.dispatchEvent(new Event('change',{bubbles:true}));
  }
 });
 const started=vi.mocked(f.runtime.decodePhoto).mock.calls.length;
 expect(input.disabled).toBe(true);
 await act(async()=>{for(const resolve of finish)resolve();});
 expect(started).toBe(1);expect(await screen.findByAltText('背景編集前の写真')).toBeTruthy();expect(input.disabled).toBe(false);
 expect(f.session.setPhoto).toHaveBeenCalledOnce();expect(screen.queryByRole('alert')).toBeNull();
});

test.each(['resolve','reject'] as const)('cancelled photo decode cannot publish a late %s and allows a fresh photo',async(outcome)=>{
 const f=setup();let resolve!:(value:any)=>void,reject!:(error:Error)=>void,signal!:AbortSignal;
 vi.mocked(f.runtime.decodePhoto).mockImplementationOnce((_file,abort)=>{signal=abort;return new Promise((done,fail)=>{resolve=done;reject=fail;});});
 const input=screen.getByLabelText('背景編集の写真を選ぶ') as HTMLInputElement;
 fireEvent.change(input,{target:{files:[new File(['old'],'old.png',{type:'image/png'})]}});
 expect(input.disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'中止'}));expect(signal.aborted).toBe(true);
 await act(async()=>{if(outcome==='resolve')resolve({width:3,height:1,format:'rgb-u8',data:new ArrayBuffer(9)});else reject(new Error('private decoder details'));});
 expect(f.runtime.createSession).not.toHaveBeenCalled();expect(f.session.setPhoto).not.toHaveBeenCalled();
 expect(screen.queryByAltText('背景編集前の写真')).toBeNull();expect(screen.queryByRole('alert')).toBeNull();expect(URL.createObjectURL).not.toHaveBeenCalled();
 expect(input.disabled).toBe(false);await upload();expect(f.session.setPhoto).toHaveBeenCalledOnce();expect(await screen.findByAltText('背景編集前の写真')).toBeTruthy();
});

test.each(['handoff','inference','consent'] as const)('pending white handoff excludes same-task %s while retaining its transparent PNG',async(next)=>{
 const f=setup({withCache:next==='consent'});await upload();await startBackground();
 const link=await screen.findByRole('link',{name:'透過PNGを保存'}),href=link.getAttribute('href');
 const original=f.session.save.getMockImplementation()!,finish:(()=>void)[]=[];
 f.session.save.mockImplementation(options=>new Promise(resolve=>{finish.push(()=>resolve(original(options)));}));
 f.session.save.mockClear();f.session.run.mockClear();
 const handoff=screen.getByRole('button',{name:'白背景にしてサイズ調整へ'}),second=next==='handoff'?handoff:screen.getByRole('button',{name:'背景を除去してPNGを作成'});
 await act(async()=>{handoff.click();second.click();});
 const saves=f.session.save.mock.calls.length,runs=f.session.run.mock.calls.length;
 await act(async()=>{for(const resolve of finish)resolve();});
 expect(saves).toBe(1);expect(runs).toBe(0);expect(f.onCrop).toHaveBeenCalledOnce();expect(screen.queryByRole('dialog',{name:'モデルを取得して処理しますか？'})).toBeNull();
 expect(screen.getByRole('link',{name:'透過PNGを保存'}).getAttribute('href')).toBe(href);expect(screen.queryByRole('alert')).toBeNull();
});

test('pending inference excludes same-task handoff of its previous output',async()=>{
 const f=setup();await upload();await startBackground();await screen.findByRole('link',{name:'透過PNGを保存'});
 let finish!:(value:{status:string})=>void;f.session.run.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));f.session.save.mockClear();
 const run=screen.getByRole('button',{name:'背景を除去してPNGを作成'}),handoff=screen.getByRole('button',{name:'白背景にしてサイズ調整へ'});
 await act(async()=>{run.click();handoff.click();});
 const prematureSaves=f.session.save.mock.calls.length;
 await act(async()=>{finish({status:'committed'});});
 expect(prematureSaves).toBe(0);expect(f.onCrop).not.toHaveBeenCalled();expect(f.session.save).toHaveBeenCalledOnce();
 expect(await screen.findByRole('link',{name:'透過PNGを保存'})).toBeTruthy();
});

test('failed white handoff keeps its transparent PNG and allows retry',async()=>{
 const f=setup();await upload();await startBackground();const link=await screen.findByRole('link',{name:'透過PNGを保存'}),href=link.getAttribute('href');
 f.session.save.mockRejectedValueOnce(new Error('white export failed'));
 fireEvent.click(screen.getByRole('button',{name:'白背景にしてサイズ調整へ'}));await screen.findByRole('alert');
 expect(screen.getByRole('link',{name:'透過PNGを保存'}).getAttribute('href')).toBe(href);expect(f.onCrop).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'白背景にしてサイズ調整へ'}));await waitFor(()=>expect(f.onCrop).toHaveBeenCalledOnce());
 expect(screen.queryByRole('alert')).toBeNull();
});

test('model compatibility failure is beside the action controls before the photo preview',async()=>{
 const f=setup();await upload();f.runtime.checkEnvironment=()=>({mode:'gpu',missing:['WebGPU']});
 fireEvent.click(screen.getByRole('button',{name:'背景を除去してPNGを作成'}));
 const alert=screen.getByRole('alert'),settings=screen.getByRole('region',{name:'背景編集の設定'}),preview=screen.getByRole('region',{name:'背景編集のプレビュー'});
 expect(settings.contains(alert)).toBe(true);expect(alert.compareDocumentPosition(preview)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(screen.getAllByRole('alert')).toHaveLength(1);
 expect(f.session.run).not.toHaveBeenCalled();expect(screen.getByAltText('背景編集前の写真')).toBeTruthy();
});

test('white handoff failure stays with its prepared download rather than model controls',async()=>{
 const f=setup();await upload();await startBackground();await screen.findByRole('link',{name:'透過PNGを保存'});f.session.save.mockRejectedValueOnce(Error('fixture error'));
 fireEvent.click(screen.getByRole('button',{name:'白背景にしてサイズ調整へ'}));const alert=await screen.findByRole('alert'),output=screen.getByRole('region',{name:'背景編集の保存'});
 expect(output.contains(alert)).toBe(true);expect(screen.getAllByRole('alert')).toHaveLength(1);expect(screen.getByRole('link',{name:'透過PNGを保存'})).toBeTruthy();
});

test('model progress, elapsed time and verified bytes stay beside execution and cancel controls',async()=>{
 const f=setup();await upload();act(()=>f.emitState({busy:true,phase:'model-load',modelRole:'hr',resourceProgress:{storedBytes:1024**2,totalBytes:2*1024**2}}));
 const controls=screen.getByRole('region',{name:'背景編集の設定'});
 expect(controls.contains(screen.getByText('背景除去モデルを読み込み・検証しています…'))).toBe(true);
 expect(controls.contains(screen.getByText(/経過時間：0秒/))).toBe(true);expect(controls.contains(screen.getByText(/保存・検証済み 1.0 \/ 2.0 MiB/))).toBe(true);
 expect(controls.contains(screen.getByRole('button',{name:'中止'}))).toBe(true);
});

test('pending white export reports its progress and cancel action beside the retained download',async()=>{
 const f=setup();await upload();await startBackground();await screen.findByRole('link',{name:'透過PNGを保存'});
 let finish!:(value:{status:string})=>void;f.session.save.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 fireEvent.click(screen.getByRole('button',{name:'白背景にしてサイズ調整へ'}));const output=screen.getByRole('region',{name:'背景編集の保存'});
 const localProgress=output.contains(screen.getByText('PNGを作成しています…')),localClock=output.contains(screen.getByText(/経過時間：0秒/)),localCancel=output.contains(screen.getByRole('button',{name:'中止'}));
 fireEvent.click(screen.getByRole('button',{name:'中止'}));await act(async()=>{finish({status:'stale'});});
 expect(localProgress).toBe(true);expect(localClock).toBe(true);expect(localCancel).toBe(true);
 expect(output.contains(screen.getByText('処理を中止しました。写真を確認して、もう一度実行できます。'))).toBe(true);
 expect(screen.getByRole('link',{name:'透過PNGを保存'})).toBeTruthy();expect(f.onCrop).not.toHaveBeenCalled();
});


test('retained mask without refinement explains mask reuse before running',async()=>{
 const f=setup({withCache:true});await upload();act(()=>f.emitState({hasPhoto:true,refine:false,hasBackgroundMask:true}));
 fireEvent.click(screen.getByRole('button',{name:'補正せずにPNGを作成'}));
 expect(await screen.findByText('今回の処理：この写真の切り抜き情報を再利用（輪郭補正なし）')).toBeTruthy();
 expect(f.runtime.inspectCache).toHaveBeenLastCalledWith('hr',{refine:false,backgroundMaskAvailable:true});
 expect(f.session.run).not.toHaveBeenCalled();
});


test.each([['runtime change','photo'],['pagehide','photo'],['runtime change','model'],['pagehide','model']] as const)('retired session notifications after %s cannot overwrite a new session initialized by %s',async(transition,entry)=>{
 const f=setup({withModels:true});
 if(entry==='photo')await upload();
 else fireEvent.change(screen.getByLabelText('背景除去モデル'),{target:{value:'light'}});
 let changed:(state:any)=>void=()=>{};
 const state={modelId:'hr',refineAvailable:true,hasPhoto:false,hasResult:false,busy:false,blocked:false,closed:false,refine:false};
 const nextSession={...f.session,getState:()=>({...state}),setPhoto:vi.fn(()=>{state.hasPhoto=true;changed({...state});}),close:vi.fn(async()=>{})};
 const runtime={...f.runtime,createSession:vi.fn((callback:(state:any)=>void)=>{changed=callback;return nextSession;})};
 if(transition==='runtime change')f.view.rerender(<BackgroundEditor active runtime={runtime} onCrop={f.onCrop} onRevision={f.onRevision} onActivity={f.onActivity}/>);
 else{f.runtime.createSession=runtime.createSession;act(()=>dispatchEvent(new Event('pagehide')));}
 await upload();
 const run=screen.getByRole('button',{name:'背景を除去してPNGを作成'});
 expect(run.hasAttribute('disabled')).toBe(false);
 act(()=>f.emitState({closed:true,blocked:true,busy:true,phase:'stopping'}));
 expect(run.hasAttribute('disabled')).toBe(false);
 expect(screen.queryByRole('button',{name:'中止しています…'})).toBeNull();
 expect(screen.getByAltText('背景編集前の写真')).toBeTruthy();
});

test.each(['resolved','rejected'] as const)('retired cancellation %s does not report its outcome in a new session',async outcome=>{
 const f=setup();await upload();
 let finish!:(value:{status:string})=>void,stop!:()=>void,fail!:(error:Error)=>void;
 f.session.run.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 f.session.cancel.mockImplementationOnce(()=>new Promise<void>((resolve,reject)=>{stop=resolve;fail=reject;}));
 await startBackground();fireEvent.click(screen.getByRole('button',{name:'中止'}));
 await act(async()=>{finish({status:'cancelled'});});
 const state={modelId:'hr',refineAvailable:true,hasPhoto:true,hasResult:false,busy:false,blocked:false,closed:false,refine:false};
 const runtime={...f.runtime,createSession:vi.fn((changed:(state:any)=>void)=>({...f.session,getState:()=>state,setPhoto:()=>changed(state),close:vi.fn(async()=>{})}))};
 f.view.rerender(<BackgroundEditor active runtime={runtime} onCrop={f.onCrop} onRevision={f.onRevision} onActivity={f.onActivity}/>);
 await upload();
 await act(async()=>{if(outcome==='resolved')stop();else fail(Error('retired stop failure'));});
 expect(screen.queryByText('処理を中止しました。写真を確認して、もう一度実行できます。')).toBeNull();
 expect(screen.queryByRole('alert')).toBeNull();
 expect(screen.getByRole('button',{name:'背景を除去してPNGを作成'}).hasAttribute('disabled')).toBe(false);
});

test.each([['runtime change','resolve'],['runtime change','reject'],['pagehide','resolve'],['pagehide','reject']] as const)('retired photo decode after %s ignores late %s and permits selection after terminal',async(transition,outcome)=>{
 const f=setup();let resolve!:(value:any)=>void,reject!:(error:Error)=>void,signal!:AbortSignal;
 vi.mocked(f.runtime.decodePhoto).mockImplementationOnce((_file,abort)=>{signal=abort;return new Promise((done,fail)=>{resolve=done;reject=fail;});});
 fireEvent.change(screen.getByLabelText('背景編集の写真を選ぶ'),{target:{files:[new File(['synthetic'],'retired.png',{type:'image/png'})]}});
 expect((screen.getByLabelText('背景編集の写真を選ぶ') as HTMLInputElement).disabled).toBe(true);
 if(transition==='runtime change')f.view.rerender(<BackgroundEditor active runtime={{...f.runtime}} onCrop={f.onCrop} onRevision={f.onRevision} onActivity={f.onActivity}/>);
 else act(()=>dispatchEvent(new Event('pagehide')));
 expect(signal.aborted).toBe(true);
 await act(async()=>{if(outcome==='resolve')resolve({width:3,height:1,format:'rgb-u8',data:new ArrayBuffer(9)});else reject(Error('retired private decode failure'));});
 expect(f.runtime.createSession).not.toHaveBeenCalled();expect(f.session.setPhoto).not.toHaveBeenCalled();
 expect(screen.queryByAltText('背景編集前の写真')).toBeNull();expect(screen.queryByRole('alert')).toBeNull();
 expect((screen.getByLabelText('背景編集の写真を選ぶ') as HTMLInputElement).disabled).toBe(false);
 await upload();await startBackground();expect(await screen.findByRole('link',{name:'透過PNGを保存'})).toBeTruthy();
 expect(f.session.setPhoto).toHaveBeenCalledOnce();expect(f.session.run).toHaveBeenCalledOnce();
});
