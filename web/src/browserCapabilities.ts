export type BrowserCapabilities={secureContext:boolean;worker:boolean;offscreenCanvas:boolean;imageBitmap:boolean;imageData:boolean;objectURLs:boolean;fileAPI:boolean;webgpuAPI:boolean;webAssembly:boolean;crossOriginIsolated:boolean};
// Presence checks only: no adapter/device, Worker, canvas, decoder or storage request.
export function readBrowserCapabilities():BrowserCapabilities{
 return {secureContext:globalThis.isSecureContext===true,worker:typeof Worker==='function',offscreenCanvas:typeof OffscreenCanvas==='function',imageBitmap:typeof createImageBitmap==='function',imageData:typeof ImageData==='function',objectURLs:typeof URL.createObjectURL==='function'&&typeof URL.revokeObjectURL==='function',fileAPI:typeof File==='function'&&typeof Blob==='function',webAssembly:typeof globalThis.WebAssembly?.instantiate==='function',webgpuAPI:typeof (navigator as Navigator&{gpu?:unknown}).gpu!=='undefined',crossOriginIsolated:globalThis.crossOriginIsolated===true};
}
export function createDiagnostic(capabilities:BrowserCapabilities,backgroundConfigured=false){
 if(typeof backgroundConfigured!=='boolean')throw Error('invalid-diagnostic-model-state');
 // Reconstruct a fixed schema, never serialize arbitrary browser/session objects.
 const features={secureContext:capabilities.secureContext===true,worker:capabilities.worker===true,offscreenCanvas:capabilities.offscreenCanvas===true,imageBitmap:capabilities.imageBitmap===true,imageData:capabilities.imageData===true,objectURLs:capabilities.objectURLs===true,fileAPI:capabilities.fileAPI===true,webgpuAPI:capabilities.webgpuAPI===true,webAssembly:capabilities.webAssembly===true,crossOriginIsolated:capabilities.crossOriginIsolated===true};
 const text=JSON.stringify({schemaVersion:4,appVersion:__APP_BUILD__.appVersion,buildId:__APP_BUILD__.sourceId,processing:'client-side',modelDistribution:backgroundConfigured?'private-validation-configured':'not-shipped',check:'main-thread-api-presence-only',features},null,2)+'\n';
 return {text,bytes:new TextEncoder().encode(text),mime:'application/json',filename:'image-studio-diagnostics.json'};
}
