/** Map hash-wasm's published incremental API to the resource policy; no hash algorithm here. */
export function makeHashWasmFactory(createSHA256){
  if(typeof createSHA256!=='function')throw TypeError('Expected the published createSHA256 function');
  return async()=>{
    const hash=await createSHA256();hash.init();let finished=false;
    return {
      update(bytes){
        if(finished)throw Error('Hash already finalized');
        if(!(bytes instanceof Uint8Array))throw TypeError('Expected Uint8Array');
        hash.update(bytes);
      },
      digestHex(){if(finished)throw Error('Hash already finalized');finished=true;return hash.digest('hex');},
    };
  };
}
