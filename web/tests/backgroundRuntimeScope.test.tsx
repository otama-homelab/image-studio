import {afterEach,expect,test,vi} from 'vitest';
import {createBackgroundRuntime} from '../src/background/runtime';
afterEach(()=>vi.unstubAllGlobals());
test('runtime capacity, inspect and clear use only the selected model configuration without initializing workers',async()=>{
 const worker=vi.fn();vi.stubGlobal('Worker',worker);
 const base='https://fixture.invalid/',file=(name:string,bytes:number)=>({url:base+name,bytes,sha256:'a'.repeat(64)});
 const source=(cacheNamespace:string,resources:ReturnType<typeof file>[])=>({cacheNamespace,resources});
 const primary={type:'prepare' as const,model:'hr' as const,modelVersion:'hr',source:source('image-studio-hr',[file('hr',1048576)])};
 const matte={type:'prepare' as const,model:'matte' as const,modelVersion:'hr',source:source('image-studio-matte',[file('matte',1048576)])};
 const variant={type:'prepare' as const,model:'modnet' as const,modelVersion:'light',source:source('image-studio-light',[file('light',3145728)])};
 const stored=new Map([['image-studio-hr',new Set([base+'hr'])],['image-studio-matte',new Set([base+'matte'])],['image-studio-light',new Set([base+'light',base+'unrelated'])]]),deleted:string[]=[];
 vi.stubGlobal('caches',{keys:async()=>[...stored.keys()],open:async(name:string)=>({keys:async()=>[...stored.get(name)!].map(url=>({url})),delete:async(url:string)=>{deleted.push(url);return stored.get(name)!.delete(url);}}),delete:vi.fn()});
 const url=new URL('https://fixture.invalid/worker.js'),runtime=createBackgroundRuntime({thumbnailWorker:url,modelWorker:url,foregroundWorker:url,exportWorker:url,prepareHr:primary,prepareMatte:matte,downloadDescription:'Primary scope',modelVariants:[{label:'Light',description:'Light model',prepareBackground:variant,modelWorker:url}]});
 expect(runtime.models?.[0].processingNotice).toContain('WebGPU対応GPUが必要');expect(runtime.models?.[0].processingNotice).not.toContain('CPU実行には対応していません');expect(runtime.models?.[1].processingNotice).toBeUndefined();
 expect(worker).not.toHaveBeenCalled();expect(runtime.models?.[0].downloadDescription).toContain('2MiB');expect(runtime.models?.[1].downloadDescription).toContain('3MiB');
 expect(await runtime.inspectCache!('hr')).toEqual({foundFiles:2,expectedFiles:2,expectedBytes:2097152,missingBytes:0});expect(await runtime.inspectCache!('light')).toEqual({foundFiles:1,expectedFiles:1,expectedBytes:3145728,missingBytes:0});
 await runtime.clearCache!('light');expect(deleted).toEqual([base+'light']);expect(stored.get('image-studio-hr')!.has(base+'hr')).toBe(true);expect(stored.get('image-studio-matte')!.has(base+'matte')).toBe(true);expect(stored.get('image-studio-light')!.has(base+'unrelated')).toBe(true);
 await expect(runtime.clearCache!('unknown')).rejects.toThrow('unknown-model-cache-scope');await expect(runtime.inspectCache!('light',{refine:true,backgroundMaskAvailable:false})).rejects.toThrow('refinement-cache-scope-unavailable');expect(worker).not.toHaveBeenCalled();
});

test('CPU HR plus matte notice gives a qualified measured reference without affecting other algorithms',()=>{
 const worker=vi.fn();vi.stubGlobal('Worker',worker);
 const url=new URL('https://fixture.invalid/worker.js');
 const prepareHr={type:'prepare' as const,model:'hr' as const,modelVersion:'gpu',source:{cacheNamespace:'image-studio-gpu',resources:[{url:'https://fixture.invalid/model',bytes:1,sha256:'b'.repeat(64)}]}};
 const prepareMatte={...prepareHr,model:'matte' as const};
 const common={thumbnailWorker:url,modelWorker:url,foregroundWorker:url,exportWorker:url,prepareHr,prepareMatte,downloadDescription:'Test'};
 const runtime=createBackgroundRuntime({...common,modelVariants:[{label:'CPU',description:'CPU',executionProvider:'wasm',prepareBackground:{...prepareHr,modelVersion:'cpu'},prepareMatte,modelWorker:url}]});
 const notice=runtime.models?.[1].processingNotice;
 expect(notice).toContain('CPUでは処理に長い時間');expect(notice).toContain('約6分22秒');expect(notice).toContain('2000×2000');expect(notice).toContain('2スレッド');expect(notice).toContain('初回のモデル取得');expect(notice).toContain('約6.3GiB');expect(notice).toContain('RSS合計');expect(notice).toContain('前景色処理');expect(notice).toContain('メモリ不足');expect(notice).not.toContain('GPUが必要');
 expect(createBackgroundRuntime({...common,executionProvider:'wasm'}).processingNotice).toBe(notice);
 expect(createBackgroundRuntime({...common,executionProvider:'wasm',prepareMatte:undefined}).processingNotice).toBeUndefined();
 expect(createBackgroundRuntime({...common,executionProvider:'wasm',prepareHr:{...prepareHr,model:'modnet'}}).processingNotice).toBeUndefined();
 expect(worker).not.toHaveBeenCalled();
});

test('single-model runtime derives capacity without storage or worker access',()=>{
 const worker=vi.fn(),storage=vi.fn();vi.stubGlobal('Worker',worker);vi.stubGlobal('caches',{keys:storage});
 const url=new URL('https://fixture.invalid/worker.js');
 const prepareHr={type:'prepare' as const,model:'hr' as const,modelVersion:'single',source:{cacheNamespace:'image-studio-single',resources:[{url:'https://fixture.invalid/model',bytes:1048577,sha256:'b'.repeat(64)}]}};
 const runtime=createBackgroundRuntime({thumbnailWorker:url,modelWorker:url,foregroundWorker:url,exportWorker:url,prepareHr,downloadDescription:'Old capacity must not be shown'});
 expect(runtime.models).toBeUndefined();expect(runtime.downloadDescription).toBe('この構成のモデル資源は約2MiBです。');
 expect(worker).not.toHaveBeenCalled();expect(storage).not.toHaveBeenCalled();
});

test('storage estimate is explicit, keeps its receiver and distinguishes unknown from zero',async()=>{
 const worker=vi.fn(),cache=vi.fn();vi.stubGlobal('Worker',worker);vi.stubGlobal('caches',{keys:cache});
 const storage={estimate:vi.fn(async function(this:unknown){expect(this).toBe(storage);return {usage:3,quota:10};})};
 vi.stubGlobal('navigator',{storage});
 const url=new URL('https://fixture.invalid/worker.js');
 const prepareHr={type:'prepare' as const,model:'hr' as const,modelVersion:'storage',source:{cacheNamespace:'image-studio-storage',resources:[{url:'https://fixture.invalid/model',bytes:1,sha256:'b'.repeat(64)}]}};
 const runtime=createBackgroundRuntime({thumbnailWorker:url,modelWorker:url,foregroundWorker:url,exportWorker:url,prepareHr,downloadDescription:'Storage test'});
 expect(storage.estimate).not.toHaveBeenCalled();
 expect(await runtime.estimateStorage!()).toEqual({usageBytes:3,quotaBytes:10,availableBytes:7});
 for(const result of [{usage:0,quota:0},{usage:10,quota:3}]){
  storage.estimate.mockResolvedValueOnce(result);
  expect((await runtime.estimateStorage!()).availableBytes).toBe(0);
 }
 for(const result of [{usage:undefined,quota:10},{usage:0,quota:NaN},{usage:-1,quota:10},{usage:0,quota:'10'}]){
  storage.estimate.mockResolvedValueOnce(result as any);
  await expect(runtime.estimateStorage!()).rejects.toThrow('storage-estimate-unavailable');
 }
 storage.estimate.mockRejectedValueOnce(Error('denied'));await expect(runtime.estimateStorage!()).rejects.toThrow('denied');
 vi.stubGlobal('navigator',{});await expect(runtime.estimateStorage!()).rejects.toThrow('storage-estimate-unavailable');
 expect(worker).not.toHaveBeenCalled();expect(cache).not.toHaveBeenCalled();
});

test('environment check follows CPU/GPU variant requirements without allocating devices or workers',()=>{
 const worker=vi.fn(),adapter=vi.fn(),estimate=vi.fn();
 vi.stubGlobal('Worker',worker);vi.stubGlobal('isSecureContext',true);vi.stubGlobal('navigator',{gpu:{requestAdapter:adapter},storage:{estimate}});
 const url=new URL('https://fixture.invalid/worker.js');
 const prepareHr={type:'prepare' as const,model:'hr' as const,modelVersion:'gpu',source:{cacheNamespace:'image-studio-gpu',resources:[{url:'https://fixture.invalid/model',bytes:1,sha256:'b'.repeat(64)}]}};
 const runtime=createBackgroundRuntime({thumbnailWorker:url,modelWorker:url,foregroundWorker:url,exportWorker:url,prepareHr,downloadDescription:'Environment',modelVariants:[{label:'CPU',description:'CPU',executionProvider:'wasm',prepareBackground:{...prepareHr,model:'modnet',modelVersion:'cpu'},modelWorker:url}]});
 expect(runtime.checkEnvironment!('gpu')).toEqual({mode:'gpu',missing:[]});
 vi.stubGlobal('navigator',{});vi.stubGlobal('isSecureContext',false);
 expect(runtime.checkEnvironment!('gpu').missing).toEqual(['安全な接続（HTTPS等）','WebGPU']);
 expect(runtime.checkEnvironment!('cpu')).toEqual({mode:'cpu',missing:[]});
 const common={thumbnailWorker:url,modelWorker:url,foregroundWorker:url,exportWorker:url,prepareBackground:{...prepareHr,model:'modnet' as const},downloadDescription:'CPU'};
 const cpu=createBackgroundRuntime({...common,executionProvider:'wasm'});expect(cpu.checkEnvironment!()).toEqual({mode:'cpu',missing:[]});
 expect(()=>createBackgroundRuntime({...common,executionProvider:'unknown' as any})).toThrow('unknown-background-execution-provider');
 vi.stubGlobal('Worker',undefined);expect(runtime.checkEnvironment!('cpu').missing).toEqual(['Worker']);
 expect(()=>runtime.checkEnvironment!('unknown')).toThrow('unknown-background-model');
 expect(worker).not.toHaveBeenCalled();expect(adapter).not.toHaveBeenCalled();expect(estimate).not.toHaveBeenCalled();
});

test('operation estimate follows base/refinement/mask reuse while cache deletion keeps full configuration scope',async()=>{
 const worker=vi.fn(),deleted:string[]=[];vi.stubGlobal('Worker',worker);
 vi.stubGlobal('caches',{keys:async()=>['image-studio-base','image-studio-matte'],open:async()=>({keys:async()=>[],delete:async(url:string)=>{deleted.push(url);return true;}}),delete:vi.fn()});
 const url=new URL('https://fixture.invalid/worker.js'),source=(name:string,bytes:number)=>({cacheNamespace:'image-studio-'+name,resources:[{url:'https://fixture.invalid/'+name,bytes,sha256:'a'.repeat(64)}]});
 const prepareHr={type:'prepare' as const,model:'hr' as const,modelVersion:'scope',source:source('base',32*1024**2)},prepareMatte={type:'prepare' as const,model:'matte' as const,modelVersion:'scope',source:source('matte',96*1024**2)};
 const runtime=createBackgroundRuntime({thumbnailWorker:url,modelWorker:url,foregroundWorker:url,exportWorker:url,trimapWorker:url,prepareHr,prepareMatte,downloadDescription:'Scope'});
 expect((await runtime.inspectCache!('scope')).missingBytes).toBe(128*1024**2);
 expect((await runtime.inspectCache!('scope',{refine:false,backgroundMaskAvailable:false})).missingBytes).toBe(32*1024**2);
 expect((await runtime.inspectCache!('scope',{refine:true,backgroundMaskAvailable:false})).missingBytes).toBe(128*1024**2);
 expect((await runtime.inspectCache!('scope',{refine:true,backgroundMaskAvailable:true})).missingBytes).toBe(96*1024**2);
 const keys=vi.spyOn(caches,'keys');keys.mockClear();
 expect(await runtime.inspectCache!('scope',{refine:false,backgroundMaskAvailable:true})).toEqual({foundFiles:0,expectedFiles:0,expectedBytes:0,missingBytes:0,downloadBytes:0});expect(keys).not.toHaveBeenCalled();
 expect(runtime.downloadDescription).toContain('輪郭補正用を含む');
 await runtime.clearCache!('scope');expect(deleted).toEqual(['https://fixture.invalid/base','https://fixture.invalid/matte']);expect(worker).not.toHaveBeenCalled();
});
