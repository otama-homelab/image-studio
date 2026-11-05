/** One Pages CSP per response; overlapping CSP values would be combined and intersect. */
export function createPagesHeaders(background=false){
 if(typeof background!=='boolean')throw Error('Explicit background header mode required');
 const csp=["default-src 'none'",`script-src 'self'${background?" 'wasm-unsafe-eval'":''}`,"style-src 'self' 'unsafe-inline'","img-src 'self' blob:","font-src 'self'",`connect-src 'self'${background?' https://huggingface.co https://us.aws.cdn.hf.co':''}`,`worker-src 'self'${background?' blob:':''}`,"object-src 'none'","base-uri 'none'","form-action 'none'","frame-ancestors 'none'"].join('; ');
 return `# Static Pages responses only; no Pages Functions are used.
/*
  Content-Security-Policy: ${csp}
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
${background?'  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n':''}
# Vite-generated, content-hashed resources only. Unhashed files keep Pages defaults.
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;
}
