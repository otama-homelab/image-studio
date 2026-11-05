import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const directories=execFileSync('npm',['ls','--omit=dev','--parseable','--all'],{encoding:'utf8'}).trim().split('\n').slice(1);
const parts=directories.map(directory=>{
 const pkg=JSON.parse(readFileSync(join(directory,'package.json'),'utf8'));
 const filenames=readdirSync(directory).filter(name=>/^(?:licen[cs]e|(?:thirdparty)?notices?(?:text)?|copyright(?:notice)?)(?:\.(?:txt|md))?$/i.test(name)).sort();
 if(!filenames.some(name=>/^licen[cs]e(?:\.(?:txt|md))?$/i.test(name)))throw Error('Missing license: '+pkg.name);
 return `${pkg.name} ${pkg.version}\n${filenames.map(name=>`${name}\n${readFileSync(join(directory,name),'utf8')}`).join('\n\n')}`;
});
const adler=readFileSync('node_modules/pako/lib/zlib/adler32.js','utf8');parts.push('pako Adler-32 source notice\n'+adler.slice(0,adler.indexOf('function adler32(')));
writeFileSync('public/THIRD_PARTY_NOTICES.txt',parts.join('\n\n'));
writeFileSync('public/LICENSE.txt',readFileSync('../LICENSE','utf8'));
