import {Sha256} from './sha256.mjs';

export function validateArtifact(file, origin) {
  if(!file || !Number.isSafeInteger(file.bytes) || file.bytes<1 || !/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid artifact contract');
  const url=new URL(file.url,origin);
  if(url.origin!==origin || !url.pathname.startsWith('/models/') || url.username || url.password || url.search || url.hash)throw Error('Artifact URL outside diagnostic allowlist');
  return url.href;
}

/** Caller owns storage rollback. Never collects a complete artifact in RAM. */
export async function verifyStream(stream, file, {write=async()=>{}, signal, progress=()=>{}}={}) {
  const hash=new Sha256();let bytes=0;
  const reader=stream.getReader();
  try {
    for(;;) {
      signal?.throwIfAborted();
      const {value,done}=await reader.read();
      signal?.throwIfAborted();
      if(done)break;
      if(!(value instanceof Uint8Array)||bytes+value.length>file.bytes)throw Error('Artifact exceeds expected bytes');
      hash.update(value);await write(value);bytes+=value.length;progress(bytes);
    }
    if(bytes!==file.bytes)throw Error('Artifact shorter than expected bytes');
    const sha256=hash.digestHex();
    if(sha256!==file.sha256)throw Error('Artifact SHA mismatch');
    return {bytes,sha256};
  } catch(error) {
    try {await reader.cancel();}catch{}
    throw error;
  } finally {reader.releaseLock();}
}
