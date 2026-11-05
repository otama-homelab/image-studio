import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaperPdfExporter} from '../tools/browser-library-adapter/pdf-export.mjs';
import {PAPER_PIXELS} from '../tools/browser-library-adapter/paper-contract.mjs';
function fixture({badSize=false,fail=false}={}){
 const calls=[];const image={width:1500,height:1051,format:'rgb-u8',data:new ArrayBuffer(1500*1051*3)};
 const exporter=createPaperPdfExporter({exportPng:async(_,options)=>{calls.push({type:'png',options});return {bytes:Uint8Array.of(1,2,3),mime:'image/png'};},PDFDocument:{async create(options){
  calls.push({type:'create',options});if(fail)throw Error('private library payload');
  return {async embedPng(){calls.push({type:'embedPng'});return {width:badSize?1:1500,height:1051};},addPage(size){calls.push({type:'page',size});return {drawImage(_,options){calls.push({type:'draw',options});}};},async save(options){calls.push({type:'save',options});return new TextEncoder().encode('%PDF-1.7\n%%EOF');}};
 }}});
 return {image,exporter,calls};
}
test('one same-paper PNG fills a page with exact pixel-derived point dimensions',async()=>{
 const f=fixture(),file=await f.exporter(f.image,{kind:'paper',paper:'l'});
 assert.deepEqual(f.calls.map(c=>c.type),['png','create','embedPng','page','draw','save']);
 assert.deepEqual(f.calls.find(c=>c.type==='create').options,{updateMetadata:false});
 assert.deepEqual(f.calls.find(c=>c.type==='page').size,[360,252.24]);
 assert.deepEqual(f.calls.find(c=>c.type==='draw').options,{x:0,y:0,width:360,height:252.24});
 assert.equal(file.filename,'image-studio-paper-l.pdf');assert.equal(file.mime,'application/pdf');
});
test('paper sizes preserve D07 orientation and arrays are immutable',()=>{
 assert.deepEqual(PAPER_PIXELS.a4,[2480,3508]);assert.deepEqual(PAPER_PIXELS.l,[1500,1051]);
 assert.deepEqual(PAPER_PIXELS['2l'],[2102,1500]);assert.deepEqual(PAPER_PIXELS.postcard,[1181,1748]);
 assert.ok(Object.isFrozen(PAPER_PIXELS));assert.ok(Object.values(PAPER_PIXELS).every(Object.isFrozen));
});
test('wrong source dimensions are refused before encode and embedded mismatch is rejected',async()=>{
 const f=fixture();await assert.rejects(f.exporter({...f.image,width:2},{kind:'paper',paper:'a4'}),e=>e.code==='invalid-export-input');assert.equal(f.calls.length,0);
 const wrong=fixture({badSize:true});await assert.rejects(wrong.exporter(wrong.image,{kind:'paper',paper:'l'}),e=>e.code==='pdf-encode-failed');
 assert.equal(wrong.calls.some(c=>c.type==='page'),false);
});
test('dependency failures do not forward exception payloads',async()=>{
 const f=fixture({fail:true});await assert.rejects(f.exporter(f.image,{kind:'paper',paper:'l'}),e=>e.message==='pdf-encode-failed');
});
