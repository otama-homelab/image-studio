import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deploymentBranch,verifyPagesProject} from './deployment-target.mjs';
test('trunk goes to preview and only a matching stable release tag goes to production',()=>{
 assert.equal(deploymentBranch('refs/heads/main','1.1.2'),'preview');
 assert.equal(deploymentBranch('refs/tags/v1.1.2','1.1.2'),'production');
 for(const ref of ['refs/heads/production','refs/pull/1/merge','refs/tags/v1.1.3','refs/tags/v1.1.2-beta.1','refs/tags/v01.1.2','refs/tags/v1.1.2;echo secret'])assert.throws(()=>deploymentBranch(ref,'1.1.2'));
});
test('Pages project must use the reserved production deployment branch before uploading',async()=>{
 let request;const args={accountId:'a'.repeat(32),token:'private-token',fetchImpl:async(url,init)=>{request={url,init};return Response.json({success:true,result:{name:'image-studio',production_branch:'production'}});}};
 await verifyPagesProject(args);assert.equal(request.init.redirect,'error');assert.equal(request.init.headers.Authorization,'Bearer private-token');assert.ok(request.url.endsWith('/pages/projects/image-studio'));
 for(const response of [new Response('private error',{status:403}),Response.json({success:true,result:{name:'image-studio',production_branch:'preview'}}),Response.json({success:true,result:{name:'other',production_branch:'production'}})]){
  await assert.rejects(verifyPagesProject({...args,fetchImpl:async()=>response}),e=>!e.message.includes('private'));
 }
 await assert.rejects(verifyPagesProject({...args,accountId:'../other'}));
});
