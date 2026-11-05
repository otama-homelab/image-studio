import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPagesHeaders} from './pages-headers.mjs';
test('manual Pages headers remain byte-identical and do not enable models or isolation',()=>{
 const headers=createPagesHeaders(false);
 assert.equal(headers,readFileSync(new URL('../public/_headers',import.meta.url),'utf8'));
 assert.ok(!headers.includes('huggingface.co'));assert.ok(!headers.includes('wasm-unsafe-eval'));assert.ok(!headers.includes('Cross-Origin-Embedder-Policy'));
});
test('model Pages headers allow only fixed HF delivery plus WASM and Blob Workers and retain restrictions',()=>{
 const headers=createPagesHeaders(true),csp=headers.split('\n').find(line=>line.includes('Content-Security-Policy:'));
 assert.ok(csp.includes("script-src 'self' 'wasm-unsafe-eval';"));assert.ok(csp.includes("worker-src 'self' blob:;"));
 assert.ok(csp.includes("connect-src 'self' https://huggingface.co https://us.aws.cdn.hf.co;"));
 assert.ok(!csp.includes("'unsafe-eval'"));assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp));assert.ok(!csp.includes('https:;'));
 for(const text of ["default-src 'none'","object-src 'none'","base-uri 'none'","form-action 'none'","frame-ancestors 'none'","img-src 'self' blob:",'Referrer-Policy: no-referrer','X-Content-Type-Options: nosniff','Permissions-Policy: camera=(), microphone=(), geolocation=()','Cross-Origin-Opener-Policy: same-origin','Cross-Origin-Embedder-Policy: require-corp','Cache-Control: public, max-age=31536000, immutable'])assert.ok(headers.includes(text),text);
 assert.ok(headers.split('\n').every(line=>line.length<=2000));
 for(const value of ['false',{},1,null])assert.throws(()=>createPagesHeaders(value));
});
