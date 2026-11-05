/** Build-pinned same-origin assets; no query, credentials, mutable path or arbitrary host. */
export function releaseAssetPath(value,extension){
 if(!['js','txt'].includes(extension)||typeof value!=='string'||!new RegExp(`^/assets/[a-f0-9]{64}/[A-Za-z0-9][A-Za-z0-9._-]*\\.${extension}$`).test(value))throw Error('invalid-release-asset');
 return value;
}
