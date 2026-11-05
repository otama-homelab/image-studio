// @vitest-environment node
import {afterEach,expect,test,vi} from 'vitest';
import {stopCropWorker} from '../src/export/cropStop';
afterEach(()=>vi.useRealTimers());
class FakeWorker extends EventTarget{postMessage=vi.fn();terminate=vi.fn();}
test('only the matching cancellation acknowledgement permits termination',async()=>{const worker=new FakeWorker();let done=false;const pending=stopCropWorker(worker as unknown as Worker,{jobId:'one',cancel:true}).then(()=>{done=true;});expect(worker.postMessage).toHaveBeenCalledWith({type:'cancel-crop',jobId:'one'});worker.dispatchEvent(new MessageEvent('message',{data:{type:'crop-cancelled',jobId:'old'}}));await Promise.resolve();expect(done).toBe(false);expect(worker.terminate).not.toHaveBeenCalled();worker.dispatchEvent(new MessageEvent('message',{data:{type:'crop-cancelled',jobId:'one'}}));await pending;expect(worker.terminate).toHaveBeenCalledOnce();});
test('missing acknowledgement rejects and still requests termination',async()=>{vi.useFakeTimers();const worker=new FakeWorker();const pending=stopCropWorker(worker as unknown as Worker,{jobId:'one',cancel:true});const rejected=expect(pending).rejects.toThrow('worker-cancel-unconfirmed');await vi.advanceTimersByTimeAsync(10000);await rejected;expect(worker.terminate).toHaveBeenCalledOnce();});
