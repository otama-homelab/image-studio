/** Validate captured model documents without loading models or browser libraries. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export function readModelNoticeDocuments(root){
 const modelNoticeIndex=fs.readFileSync(path.join(root,'sources.json'));
 const modelNoticeSources=JSON.parse(modelNoticeIndex);
 if(modelNoticeSources.status!=='candidate_documents_only_not_a_distribution_approval'||!Array.isArray(modelNoticeSources.documents))throw Error('Candidate model notice index required');
 const modelNoticeFiles=new Map([['sources.json',modelNoticeIndex]]);
 for(const document of modelNoticeSources.documents){
  if(typeof document.file!=='string'||!/^[A-Za-z0-9.-]+\.txt$/.test(document.file)||modelNoticeFiles.has(document.file)||!/^[a-f0-9]{64}$/.test(document.sha256??''))throw Error('Invalid candidate model notice');
  const file=path.join(root,document.file);if(!fs.lstatSync(file).isFile())throw Error('Regular candidate model notice required');
  const bytes=fs.readFileSync(file);if(createHash('sha256').update(bytes).digest('hex')!==document.sha256||(document.bytes!==undefined&&bytes.length!==document.bytes))throw Error('Candidate model notice mismatch');
  modelNoticeFiles.set(document.file,bytes);
 }
 return {modelNoticeIndex,modelNoticeSources,modelNoticeFiles};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv.length!==2)throw Error('No runtime/model arguments accepted');
 const root=fileURLToPath(new URL('../docs/browser/model-notices/',import.meta.url));
 const {modelNoticeSources,modelNoticeFiles}=readModelNoticeDocuments(root);
 console.log(JSON.stringify({status:'candidate-model-documents-match-recorded-sha',documents:modelNoticeSources.documents.length,bytes:[...modelNoticeFiles.values()].reduce((sum,bytes)=>sum+bytes.length,0),distributionApproved:false}));
}
