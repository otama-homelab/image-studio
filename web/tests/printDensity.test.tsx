import {expect,test} from 'vitest';
import {jpegPrintDensity,pngPrintDensity} from '../src/export/printDensity';

// Metadata-only synthetic JPEG containers; no native image decoder is exercised here.
function jpeg({jfif,exif}:{jfif?:[number,number,number];exif?:[number,number,number]}={}){
 const parts:number[]=[255,216];
 const app=(marker:number,data:Uint8Array)=>parts.push(255,marker,(data.length+2)>>8,(data.length+2)&255,...data);
 if(jfif){const [unit,x,y]=jfif;app(224,Uint8Array.from([74,70,73,70,0,1,2,unit,x>>8,x&255,y>>8,y&255,0,0]));}
 if(exif){const [unit,x,y]=exif,bytes=new Uint8Array(6+66),view=new DataView(bytes.buffer,6);bytes.set([69,120,105,102,0,0]);view.setUint16(0,0x4949);view.setUint16(2,42,true);view.setUint32(4,8,true);view.setUint16(8,3,true);
  for(const [i,tag,type,value] of [[0,282,5,50],[1,283,5,58],[2,296,3,unit]]){const at=10+i*12;view.setUint16(at,tag,true);view.setUint16(at+2,type,true);view.setUint32(at+4,1,true);if(type===3)view.setUint16(at+8,value,true);else view.setUint32(at+8,value,true);}
  view.setUint32(50,x,true);view.setUint32(54,1,true);view.setUint32(58,y,true);view.setUint32(62,1,true);app(225,bytes);
 }
 parts.push(255,218,0,2,255,217);return Uint8Array.from(parts);
}
test('PNG metres become physical DPI; missing/unknown unit is explicit and invalid density is rejected',()=>{
 expect(pngPrintDensity({x:11811,y:11811,unit:1})).toEqual([299.9994,299.9994]);expect(pngPrintDensity()).toBeNull();expect(pngPrintDensity({x:72,y:72,unit:0})).toBeNull();
 expect(()=>pngPrintDensity({x:2835,y:2835,unit:1})).toThrow('unsupported-print-dpi');expect(()=>pngPrintDensity({x:0,y:11811,unit:1})).toThrow('invalid-print-metadata');expect(()=>pngPrintDensity({x:11811,y:11811,unit:2})).toThrow('invalid-print-metadata');
});
test('real exifr reads JFIF and EXIF, giving physical JFIF priority',async()=>{
 expect(await jpegPrintDensity(jpeg({jfif:[1,300,300]}))).toEqual([300,300]);expect(await jpegPrintDensity(jpeg({exif:[2,300,300]}))).toEqual([300,300]);
 expect(await jpegPrintDensity(jpeg({jfif:[1,300,300],exif:[2,72,72]}))).toEqual([300,300]);
 await expect(jpegPrintDensity(jpeg({jfif:[1,72,72],exif:[2,300,300]}))).rejects.toThrow('unsupported-print-dpi');
 expect(await jpegPrintDensity(jpeg({jfif:[0,1,1]}))).toBeNull();expect(await jpegPrintDensity(jpeg())).toBeNull();
});
test('non-300, unequal axes, invalid units and malformed JPEG metadata are not treated as absent',async()=>{
 await expect(jpegPrintDensity(jpeg({exif:[2,300,72]}))).rejects.toThrow('unsupported-print-dpi');
 await expect(jpegPrintDensity(jpeg({jfif:[1,0,300]}))).rejects.toThrow('invalid-print-metadata');
 await expect(jpegPrintDensity(jpeg({exif:[1,300,300]}))).rejects.toThrow('invalid-print-metadata');
 await expect(jpegPrintDensity(Uint8Array.from([255,216,255,225,0,40,69,120]))).rejects.toThrow('invalid-print-metadata');
});
