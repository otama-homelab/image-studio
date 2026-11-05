import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {trimapRadius} from './browser-library-adapter/opencv-trimap.mjs';
const [directory,output]=process.argv.slice(2);if(!output||fs.existsSync(output))throw Error('Need probe directory and new report');
const source=JSON.parse(fs.readFileSync(path.join(directory,'report.json'),'utf8'));assert.ok(['auxiliary-native-captured','pinned-native-reference-captured'].includes(source.status));if(source.status==='pinned-native-reference-captured')assert.equal(source.opencv,'4.11.0');assert.equal(source.cases.length,8);
const sha=data=>createHash('sha256').update(data).digest('hex');
for(const row of source.cases){
 assert.equal(trimapRadius(row.width,row.height),row.radius);const alpha=fs.readFileSync(path.join(directory,row.stem+'-alpha.bin')),trimap=fs.readFileSync(path.join(directory,row.stem+'-trimap.bin')),kernel=fs.readFileSync(path.join(directory,row.stem+'-kernel.bin'));
 for(const [name,data] of [['alpha',alpha],['trimap',trimap],['kernel',kernel]])assert.equal(sha(data),row[name+'Sha256']);assert.equal(alpha.length,row.width*row.height);assert.equal(trimap.length,alpha.length);assert.equal(kernel.length,(row.radius*2+1)**2);
 assert.ok(trimap.every(v=>v===0||v===128||v===255));assert.equal(trimap.filter(v=>v===255).length,row.foreground);assert.equal(trimap.filter(v=>v===0).length,row.background);assert.equal(trimap.filter(v=>v===128).length,row.unknown);assert.equal(row.thresholdPathsEqual,true);
}
const report={status:source.status==='pinned-native-reference-captured'?'pinned-native-contract-checked':'auxiliary-contract-checked',reference:source,jsRadiusAllMatch:true,fixtureIntegrityVerified:true,limits:source.limits};fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:report.status,cases:source.cases.length,opencv:source.opencv}));
