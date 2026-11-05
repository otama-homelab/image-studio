import {afterEach,expect,test,vi} from 'vitest';
import {createReleaseBackgroundRuntime,type ReleaseBackgroundConfig} from '../src/background/releaseRuntime';
import * as runtimeModule from '../src/background/runtime';
const render=vi.hoisted(()=>vi.fn());
vi.mock('react-dom/client',()=>({createRoot:vi.fn(()=>({render}))}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML='';render.mockClear();});
const asset=(name:string)=>'/assets/'+'a'.repeat(64)+'/'+name;
function fixture():ReleaseBackgroundConfig{
 const command=(model:'hr'|'matte'|'modnet',modelVersion:string)=>({type:'prepare' as const,model,modelVersion,source:{cacheNamespace:'image-studio-'+modelVersion,resources:[{url:'https://huggingface.co/fixture/models/resolve/'+'b'.repeat(40)+'/'+modelVersion,bytes:100,sha256:'c'.repeat(64)}]}});
 return {workers:{model:asset('model-prepare-worker.js'),foreground:asset('foreground-worker.js'),export:asset('export-worker.js'),thumbnail:asset('thumbnail-worker.js'),trimap:asset('trimap-worker.js')},modelNoticesHref:asset('MODEL_NOTICES.txt'),executionProvider:'wasm',prepareBackground:command('modnet','light-cpu'),modelLabel:'軽量 CPU',downloadDescription:'軽量モデル',modelCancellation:'cooperative-model-cancel-v1',foregroundCancellation:'cooperative-foreground-cancel-v1',trimapCancellation:'cooperative-trimap-cancel-v1',modelVariants:[
  {modelWorker:asset('model-gpu.js'),label:'軽量 GPU',description:'軽量モデル',executionProvider:'webgpu',prepareBackground:command('modnet','light-gpu')},
  {modelWorker:asset('hr-gpu.js'),label:'高画質 GPU',description:'高画質モデル',executionProvider:'webgpu',prepareBackground:command('hr','hr-gpu'),prepareMatte:command('matte','matte-gpu')},
  {modelWorker:asset('hr-cpu.js'),label:'高画質 CPU',description:'高画質モデル',executionProvider:'wasm',prepareBackground:command('hr','hr-cpu'),prepareMatte:command('matte','matte-cpu')},
 ]};
}
test('release config resolves static assets at either origin and keeps four explicit models without starting work',()=>{
 const worker=vi.fn(),fetch=vi.fn();vi.stubGlobal('Worker',worker);vi.stubGlobal('fetch',fetch);
 const spy=vi.spyOn(runtimeModule,'createBackgroundRuntime'),config=fixture(),before=JSON.stringify(config);
 expect(createReleaseBackgroundRuntime(null,'https://app.invalid')).toBeUndefined();expect(spy).not.toHaveBeenCalled();
 for(const origin of ['https://preview.image-studio.pages.dev','https://image-studio.otama-playground.com']){
  const runtime=createReleaseBackgroundRuntime(config,origin)!;const options=spy.mock.calls.at(-1)![0];
  expect(options.modelWorker.href).toBe(origin+config.workers.model);expect(options.modelVariants?.[0].modelWorker.href).toBe(origin+config.modelVariants![0].modelWorker);
  expect(options.modelNoticesHref).toBe(origin+config.modelNoticesHref);expect(runtime.models).toHaveLength(4);
  expect(runtime.models?.[0].processingNotice).toBeUndefined();expect(runtime.models?.[1].processingNotice).toBeUndefined();
  expect(runtime.models?.[2].processingNotice).toContain('WebGPU対応GPU');expect(runtime.models?.[3].processingNotice).toContain('CPUでは処理に長い時間');
 }
 expect(JSON.stringify(config)).toBe(before);expect(worker).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
test('release config refuses private, unhashed, external, credential and query-bearing asset paths',()=>{
 for(const value of ['', 'http://%', '/validation-workers/'+'a'.repeat(64)+'/worker.js','/assets/latest/worker.js','https://outside.invalid'+asset('worker.js'),asset('worker.js')+'?key=secret',asset('worker.js')+'#x','https://user:secret@app.invalid'+asset('worker.js')]){
  const config=fixture();config.workers.model=value;expect(()=>createReleaseBackgroundRuntime(config,'https://app.invalid')).toThrow('invalid-release-asset');
 }
 const config=fixture();config.modelVariants![0].modelWorker='/arbitrary.js';expect(()=>createReleaseBackgroundRuntime(config,'https://app.invalid')).toThrow('invalid-release-asset');
 const notice=fixture();notice.modelNoticesHref='https://outside.invalid/NOTICE.txt';expect(()=>createReleaseBackgroundRuntime(notice,'https://app.invalid')).toThrow('invalid-release-asset');
});
for(const configured of [false,true])test('public main passes '+(configured?'configured runtime':'no runtime')+' into the existing Root',async()=>{
 vi.resetModules();vi.stubGlobal('__BACKGROUND_RELEASE__',configured?fixture():null);vi.stubGlobal('Worker',vi.fn());vi.stubGlobal('fetch',vi.fn());document.body.innerHTML='<div id="root"></div>';
 await import('../src/main');
 await vi.waitFor(()=>expect(render).toHaveBeenCalledTimes(configured?2:1));
 const root=render.mock.calls.at(-1)![0].props.children;
 if(configured)expect(root.props.backgroundRuntime.models).toHaveLength(4);else expect(root.props.backgroundRuntime).toBeUndefined();
 expect(Worker).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();expect('__imageStudioValidation' in window).toBe(false);
});


test('a failed release runtime still mounts manual tools with a fixed error flag',async()=>{
 vi.resetModules();const config=fixture();config.workers.model='/invalid.js';vi.stubGlobal('__BACKGROUND_RELEASE__',config);document.body.innerHTML='<div id="root"></div>';
 await import('../src/main');await vi.waitFor(()=>expect(render).toHaveBeenCalledTimes(2));
 const root=render.mock.calls.at(-1)![0].props.children;expect(root.props.backgroundRuntime).toBeUndefined();expect(root.props.backgroundConfigurationFailed).toBe(true);
});

for(const [ua,touch,mobile,expected] of [
 ['iPhone',5,undefined,2],['Android',5,undefined,2],['Macintosh',5,undefined,2],
 ['Windows NT',10,false,4],['Windows NT',0,undefined,4],['unknown',0,true,2],
] as const)test(`HR product availability: ${ua}/${touch}/${mobile}`,()=>{
 vi.stubGlobal('navigator',{userAgent:ua,maxTouchPoints:touch,userAgentData:{mobile}});
 const runtime=createReleaseBackgroundRuntime(fixture(),'https://app.invalid')!;
 expect(runtime.models).toHaveLength(expected);
 if(expected===2){
  expect(()=>runtime.checkEnvironment?.('hr-cpu')).toThrow('unknown-background-model');
  const session=runtime.createSession(()=>{});
  expect(()=>session.setModel?.('hr-cpu')).toThrow();
  void session.close();
 }
});
