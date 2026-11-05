import test from 'node:test';
import assert from 'node:assert/strict';
import {createImageRegistry} from '../tools/browser-library-adapter/image-registry.mjs';
import {createAlphaCommitter} from '../tools/browser-library-adapter/alpha-commit.mjs';
import {createInferenceOperation} from '../tools/browser-library-adapter/inference-operation.mjs';

test('cancelled pipeline completion cannot replace a newer registered alpha with the same input key',async()=>{
 const registry=createImageRegistry(),input=registry.register({width:1,height:1,format:'rgb-u8',data:new ArrayBuffer(3)},'session');
 const current={rgbAssetId:input.id,key:{inputId:'input-1',inferenceRevision:1,modelVersion:'set-1'},refine:false};
 const committer=createAlphaCommitter({registry,getCurrent:()=>current}),finishes=[];let stopped=0;
 const operation=createInferenceOperation({getCurrent:()=>current,committer,cancelOwned:()=>{stopped++;},execute:()=>new Promise(r=>finishes.push(r))});
 const result=value=>({key:{...current.key},alpha:{width:1,height:1,layout:'alpha-u8',data:Uint8Array.of(value).buffer}});
 const old=operation.start();await operation.cancel();const fresh=operation.start();
 finishes[1](result(255));const accepted=await fresh;assert.equal(accepted.status,'committed');
 finishes[0](result(0));assert.equal((await old).status,'cancelled');
 assert.equal(committer.get().image.id,accepted.image.id);assert.deepEqual([...new Uint8Array(registry.copy(accepted.image.id).data)],[255]);
 assert.equal(stopped,1);committer.close();registry.release(input.id,'session');
});
