/** Validate transport planes; caller owns disposable copies, never registry originals. */
export function inferenceTransport(command){
 const invalid=()=>{throw new TypeError('invalid-input');};
 const key=command?.key,rgb=command?.rgb;
 if(command?.type!=='infer'||typeof command.refine!=='boolean'||!key||typeof key.inputId!=='string'||!key.inputId
  ||typeof key.modelVersion!=='string'||!key.modelVersion||!Number.isSafeInteger(key.inferenceRevision)||key.inferenceRevision<0)invalid();
 if(!rgb||!Number.isInteger(rgb.width)||!Number.isInteger(rgb.height)||rgb.width<1||rgb.height<1||rgb.width>2000||rgb.height>2000
  ||rgb.layout!=='rgb-u8-interleaved'||!(rgb.data instanceof ArrayBuffer)||rgb.data.byteLength!==rgb.width*rgb.height*3)invalid();
 const request={type:'infer',key:{inputId:key.inputId,inferenceRevision:key.inferenceRevision,modelVersion:key.modelVersion},
  rgb:{width:rgb.width,height:rgb.height,layout:rgb.layout,data:rgb.data},refine:command.refine};
 const transfer=[rgb.data];
 for(const [field,layout] of [['hrAlpha','alpha-u8'],['trimap','trimap-u8']])if(command[field]!==undefined){
  const plane=command[field];
  if(!plane||plane.width!==rgb.width||plane.height!==rgb.height||plane.layout!==layout
   ||!(plane.data instanceof ArrayBuffer)||plane.data.byteLength!==rgb.width*rgb.height)invalid();
  if(field==='trimap')for(const value of new Uint8Array(plane.data))if(value!==0&&value!==128&&value!==255)invalid();
  request[field]={width:plane.width,height:plane.height,layout:plane.layout,data:plane.data};transfer.push(plane.data);
 }
 if(new Set(transfer).size!==transfer.length)invalid();
 return {request,transfer};
}
