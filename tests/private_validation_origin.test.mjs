import {test} from 'node:test';import assert from 'node:assert/strict';
import {isPrivateValidationOrigin as allowed} from '../tools/browser-library-adapter/private-validation-origin.mjs';
test('private device HTTPS requires explicit RFC1918 origin; loopback stays separate',()=>{
 for(const origin of ['https://192.168.100.8:17863','https://10.0.0.2','https://172.16.0.2','https://172.31.255.254']){assert.equal(allowed(origin,true),true);assert.equal(allowed(origin),false);}
 for(const origin of ['http://192.168.100.8:17863','https://8.8.8.8','https://172.32.0.1','https://169.254.1.1','https://example.com','https://user:pw@192.168.1.1','https://192.168.1.1/path','https://192.168.1.1/','https://[::1]'])assert.equal(allowed(origin,true),false,origin);
 assert.equal(allowed('http://127.0.0.1:17861'),true);assert.equal(allowed('https://127.0.0.1',true),false);
});
