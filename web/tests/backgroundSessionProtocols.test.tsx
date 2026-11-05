import {beforeEach,expect,test,vi} from 'vitest';
import {createBrowserBackgroundSession} from '../src/background/browserSession';
import {createBackgroundSession} from '../src/background/session.mjs';
import {createWorkerClient} from '../../tools/browser-library-adapter/worker-client.mjs';
vi.mock('../src/background/session.mjs',()=>({createBackgroundSession:vi.fn(()=>({}))}));
vi.mock('../../tools/browser-library-adapter/worker-client.mjs',()=>({createWorkerClient:vi.fn(()=>({}))}));
beforeEach(()=>vi.clearAllMocks());
const url=new URL('https://fixture.invalid/worker.js');
const base={modelWorker:url,foregroundWorker:url,exportWorker:url,prepareHr:{type:'prepare' as const,model:'hr' as const,modelVersion:'primary'}};
test('unknown cancellation protocols fail before constructing a session or worker client',()=>{
 const invalid=[{modelCancellation:'unknown'},{foregroundCancellation:'unknown'},{trimapCancellation:'unknown'},{modelVariants:[{label:'Variant',description:'Test',modelWorker:url,prepareBackground:{type:'prepare',model:'lite',modelVersion:'variant'},modelCancellation:'unknown'}]}];
 for(const config of invalid)expect(()=>createBrowserBackgroundSession({...base,...config} as never)).toThrow(/invalid-.*-cancellation-protocol/);
 expect(createBackgroundSession).not.toHaveBeenCalled();expect(createWorkerClient).not.toHaveBeenCalled();
});
test.each([true,false])('variant cancellation uses its own capability, primary cooperative=%s',primaryCooperative=>{
 createBrowserBackgroundSession({...base,modelCancellation:primaryCooperative?'cooperative-model-cancel-v1':undefined,modelVariants:[{label:'Variant',description:'Test',modelWorker:url,prepareBackground:{type:'prepare',model:'lite',modelVersion:'variant'},modelCancellation:primaryCooperative?undefined:'cooperative-model-cancel-v1'}]});
 const wiring=vi.mocked(createBackgroundSession).mock.calls[0][0];
 wiring.createModelClient({modelVersion:'primary',gate:{},onEvent:()=>{}});
 wiring.createModelClient({modelVersion:'variant',gate:{},onEvent:()=>{}});
 const calls=vi.mocked(createWorkerClient).mock.calls;
 expect(typeof calls[0][0].stopWorker==='function').toBe(primaryCooperative);
 expect(typeof calls[1][0].stopWorker==='function').toBe(!primaryCooperative);
});
