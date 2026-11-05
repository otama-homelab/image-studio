import {createSingleSessionMaskInference} from './single-session-mask-inference.mjs';
/** Published fixed-square BiRefNet IO. Weight precision/provider belong to preparation. */
function createBirefnetInference(options,role){
 const size=role==='lite'?(options.inputSize??1024):1024;
 if(![512,1024].includes(size))throw Error('invalid-lite-input-size');
 return createSingleSessionMaskInference({...options,processorConfig:{do_resize:false,do_pad:false,do_rescale:true,do_normalize:true,
  image_mean:[.485,.456,.406],image_std:[.229,.224,.225],resample:2,size:{width:size,height:size}}},
 {role,inputName:'input_image',outputName:'output_image',sigmoid:true});
}
export const createPortraitInference=options=>createBirefnetInference(options,'portrait');
/** FP32 Lite IO; preparation selects native-DeformConv WASM or pinned static GridSample validation. */
export const createLiteInference=options=>createBirefnetInference(options,'lite');
