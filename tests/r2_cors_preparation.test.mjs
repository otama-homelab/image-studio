import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {prepareR2Cors} from '../tools/prepare_browser_r2_cors.mjs';

test('Wrangler policy allows exact production and preview origins to GET only',()=>{
 const input=['https://studio.example.com','https://preview.example.pages.dev','https://studio.example.com'];
 assert.deepEqual(prepareR2Cors(input),{rules:[{allowed:{origins:['https://preview.example.pages.dev','https://studio.example.com'],methods:['GET']}}]});
 assert.equal(input.length,3);
});
test('no implicit origin, wildcard, credentials, path, query or insecure origin',()=>{
 for(const value of [undefined,[],Array(33).fill('https://example.com'),[null],['*'],['https://*.pages.dev'],['http://localhost:5173'],['https://example.com/'],['https://example.com/path'],['https://example.com?x=1'],['https://example.com#x'],['https://user:secret@example.com'],[' https://example.com']])assert.throws(()=>prepareR2Cors(value));
});
test('CLI emits only importable JSON; errors do not echo supplied credentials',()=>{
 const file=new URL('../tools/prepare_browser_r2_cors.mjs',import.meta.url);
 const success=spawnSync(process.execPath,[file.pathname,'https://studio.example.com'],{encoding:'utf8'});
 assert.equal(success.status,0);assert.deepEqual(JSON.parse(success.stdout),prepareR2Cors(['https://studio.example.com']));assert.equal(success.stderr,'');
 const failure=spawnSync(process.execPath,[file.pathname,'https://user:private-sentinel@example.com'],{encoding:'utf8'});
 assert.equal(failure.status,1);assert.equal(failure.stdout,'');assert.ok(!failure.stderr.includes('private-sentinel'));
});
