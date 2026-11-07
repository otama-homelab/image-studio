declare module 'fast-png-decoder' {const Decoder:any;export default Decoder;}
declare module 'fast-png-keyword' {export const readKeyword:any;}
declare module 'pako-adler32' {const adler32:any;export default adler32;}
declare module 'image-studio-local-config' {
 const config:{privateLanHttps?:boolean;executionProvider?:'webgpu'|'wasm';scope:string;distributionApproved:boolean;appOrigin:string;modelResourceBytes:number;
  foregroundCancellation?:'cooperative-foreground-cancel-v1';trimapCancellation?:'cooperative-trimap-cancel-v1';
  modelLabel?:string;modelNoticesHref?:string;modelCancellation?:'cooperative-model-cancel-v1';
  prepareHr?:{type:'prepare';model:'hr';modelVersion:string;[field:string]:unknown};
  prepareBackground?:{type:'prepare';model:'modnet'|'portrait'|'lite'|'rvm';modelVersion:string;[field:string]:unknown};
  prepareMatte?:{type:'prepare';model:'matte';modelVersion:string;[field:string]:unknown};
  modelVariants?:{defaultRefine?:boolean;executionProvider?:'webgpu'|'wasm';modelCancellation?:'cooperative-model-cancel-v1';label:string;description:string;modelWorker:string;prepareBackground:{type:'prepare';model:'hr'|'modnet'|'portrait'|'lite'|'rvm';modelVersion:string;[field:string]:unknown};prepareMatte?:{type:'prepare';model:'matte';modelVersion:string;[field:string]:unknown}}[];
  workers:{model:string;foreground:string;export:string;thumbnail:string;trimap?:string}};
 export default config;
}
