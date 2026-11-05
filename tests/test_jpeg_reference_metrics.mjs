import test from 'node:test';import assert from 'node:assert/strict';
import {measureJpegRgb} from '../tools/browser-library-adapter/jpeg-reference-metrics.mjs';
test('reports dimensions and channel errors without inventing acceptance',()=>{
 const image={width:1,height:1,format:'rgb-u8',data:Uint8Array.of(10,20,30).buffer};
 const result=measureJpegRgb(image,{width:1,height:1,data:Uint8Array.of(9,20,34)});assert.equal(result.maxChannelDifference,4);assert.equal(result.meanAbsoluteChannelDifference,5/3);assert.equal(result.changedChannels,2);assert.equal('passed' in result,false);
 assert.equal(measureJpegRgb(image,{width:2,height:1}).dimensionsMatch,false);
 assert.throws(()=>measureJpegRgb({...image,data:new ArrayBuffer(1)},{width:1,height:1,data:new Uint8Array(3)}));
});
