import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {thumbnailSize} from '../tools/browser-library-adapter/thumbnail-size.mjs';
import {resizeTransport} from '../tools/browser-library-adapter/resize-transport.mjs';
test('thumbnail dimensions match pinned Pillow results, including portrait rounding and extreme aspect ratios',()=>{
 const reference=JSON.parse(fs.readFileSync(new URL('../docs/browser/validation/2026-11-01-pillow-thumbnail-wasm.json',import.meta.url)));
 for(const item of reference.cases){const size=thumbnailSize(...item.source);assert.deepEqual([size.width,size.height],item.output);}
 assert.deepEqual(thumbnailSize(31,17),{width:31,height:17});
 assert.throws(()=>thumbnailSize(16385,1));assert.throws(()=>thumbnailSize(6000,4001));
});
test('large originals require explicit thumbnail and exact full-image aspect-preserving dimensions',()=>{
 const image={width:4001,height:3,format:'rgb-u8',data:new ArrayBuffer(4001*3*3)},size=thumbnailSize(image.width,image.height);
 assert.throws(()=>resizeTransport(image,size));
 assert.equal(resizeTransport(image,{...size,thumbnail:true}).options.thumbnail,true);
 assert.throws(()=>resizeTransport(image,{width:20,height:1,thumbnail:true}));
 assert.throws(()=>resizeTransport(image,{...size,thumbnail:true,box:[1,0,4001,3]}));
});
