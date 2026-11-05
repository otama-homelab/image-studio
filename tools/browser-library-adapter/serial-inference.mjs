import {foregroundRgbaResult} from './foreground-pixels.mjs';
export class SerialInferenceError extends Error {
 constructor(code){super(code);this.name='SerialInferenceError';this.code=code;}
}

/** Role sequencing only. makeTrimap must be the reference-compatible image operation. */
export function createSerialInference({registry,client,prepareHr,prepareBackground,prepareMatte,makeTrimap,recoverForeground,getBackgroundAlpha,onBackgroundAlpha}){
 if((prepareHr&&prepareBackground)||(prepareHr&&prepareHr.model!=='hr'))throw new SerialInferenceError('invalid-model-set');
 const background=prepareBackground??prepareHr;
 return async function execute(context,{isCurrent,workerGate}){
  const requireCurrent=()=>{if(!isCurrent())throw new SerialInferenceError('operation-stale');};
  requireCurrent();
  if(!['hr','modnet','portrait','lite'].includes(background?.model)||background.modelVersion!==context.key.modelVersion
   ||(context.refine&&(background.model!=='hr'||prepareMatte?.model!=='matte'||prepareMatte.modelVersion!==context.key.modelVersion||typeof makeTrimap!=='function')))throw new SerialInferenceError('invalid-model-set');
  const input=registry.get(context.rgbAssetId);
  if(input.format!=='rgb-u8'||input.width>2000||input.height>2000)throw new SerialInferenceError('invalid-input');
  const run=async(prepare,alphaId,trimap)=>{
   requireCurrent();await client.request(prepare);requireCurrent();
   const planes=registry.inferencePlanes(context.rgbAssetId,alphaId);
   const result=await client.request({type:'infer',key:context.key,...planes,refine:context.refine,...(trimap?{trimap}:{})});
   requireCurrent();await client.request({type:'dispose'});requireCurrent();return result;
  };
  const finish=async result=>{
   if(!recoverForeground)return result;
   requireCurrent();
   if(typeof recoverForeground!=='function'||result?.alpha?.layout!=='alpha-u8'||result.alpha.width!==input.width||result.alpha.height!==input.height||!(result.alpha.data instanceof ArrayBuffer)||result.alpha.data.byteLength!==input.width*input.height)throw new SerialInferenceError('invalid-alpha-result');
   const rgb=registry.copy(context.rgbAssetId);
   // Keep alpha for final commit; only job-owned copies go to the recovery Worker.
   const cutout=await recoverForeground({width:input.width,height:input.height,rgb:new Uint8Array(rgb.data),alpha:new Uint8Array(result.alpha.data.slice(0))},{workerGate});
   requireCurrent();
   return {...result,cutout:foregroundRgbaResult(cutout,input)};
  };
  // The application owns source/model invalidation; this layer validates pixels.
  const prior=getBackgroundAlpha?.(context);
  const validAlpha=alpha=>alpha?.layout==='alpha-u8'&&alpha.width===input.width&&alpha.height===input.height
   &&alpha.data instanceof ArrayBuffer&&alpha.data.byteLength===input.width*input.height;
  if(prior&&!validAlpha(prior))throw new SerialInferenceError('invalid-alpha-result');
  const hr=prior?{type:'result',key:context.key,alpha:prior}:await run(background);
  requireCurrent();
  if(!validAlpha(hr.alpha))throw new SerialInferenceError('invalid-alpha-result');
  if(!prior)onBackgroundAlpha?.(hr.alpha,context);

  if(!context.refine)return finish(hr);
  const trimap=await makeTrimap(hr.alpha,{workerGate});requireCurrent();
  if(!trimap||trimap.layout!=='trimap-u8'||trimap.width!==input.width||trimap.height!==input.height
   ||!(trimap.data instanceof ArrayBuffer)||trimap.data.byteLength!==input.width*input.height)throw new SerialInferenceError('invalid-trimap');
  const values=new Set(new Uint8Array(trimap.data));
  if([...values].some(value=>![0,128,255].includes(value)))throw new SerialInferenceError('invalid-trimap');
  if(!values.has(128)||!values.has(0)||!values.has(255))return finish(hr);
  const owner='serial-hr-'+crypto.randomUUID();
  const intermediate=registry.register({width:hr.alpha.width,height:hr.alpha.height,format:'alpha-u8',data:hr.alpha.data},owner);
  try{return await finish(await run(prepareMatte,intermediate.id,trimap));}
  finally{registry.release(intermediate.id,owner);}
 };
}
