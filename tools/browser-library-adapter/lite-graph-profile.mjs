/** Pinned private comparison artifacts; known tensor minima are not total memory budgets. */
const profiles=Object.freeze({
 'grid-sample-static-1024':Object.freeze({bytes:199681624,sha256:'50a57872cc739192446da2a934159f957c81af8b5a161dfda8e3daa51660ca67',knownTensorBytes:503316480,shaderF16:false}),
 'grid-sample-static-1024-fp16':Object.freeze({bytes:101153519,sha256:'298799f1b70021a972e2fa85aa8811780d3c0305ae54ad185e5f41102dd27eb9',knownTensorBytes:251658240,shaderF16:true}),
});
export const liteGraphProfile=format=>typeof format==='string'&&Object.hasOwn(profiles,format)?profiles[format]:null;
