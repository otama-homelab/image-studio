import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import ja from './locales/ja.json';
import en from './locales/en.json';

export type Language='ja'|'en';
const storageKey='image-studio-language';
let initial:Language='en';
try{if(globalThis.localStorage?.getItem(storageKey)==='ja')initial='ja';}catch{/* Language selection also works without storage. */}
void i18n.use(initReactI18next).init({lng:initial,fallbackLng:'en',supportedLngs:['ja','en'],resources:{ja:{translation:ja},en:{translation:en}},keySeparator:false,nsSeparator:false,interpolation:{escapeValue:false},initAsync:false});

// Existing sessions retain formatted notice strings. Resolve either language at the UI boundary so a switch preserves those sessions.
const englishKeys=new Map(Object.entries(en).map(([key,value])=>[value,key]));
const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns=Object.entries(en).flatMap(([key,value])=>!key.includes('{{')?[]:[key,value].map(text=>{
 const names:string[]=[];let last=0,pattern='^';
 for(const match of text.matchAll(/\{\{(v\d+)\}\}/g)){pattern+=escape(text.slice(last,match.index))+'([\\s\\S]*?)';names.push(match[1]);last=match.index!+match[0].length;}
 return {key,names,regex:new RegExp(pattern+escape(text.slice(last))+'$'),specificity:text.replace(/\{\{v\d+\}\}/g,'').length};
})).sort((a,b)=>b.specificity-a.specificity);
const prefixes=Object.entries(en).flatMap(([key,value])=>key.includes('{{')?[]:[{text:key,key},{text:value,key}]).filter(item=>item.text.length>=24).sort((a,b)=>b.text.length-a.text.length);
function translate(value:string,values?:Record<string,unknown>,depth=0):string{
 const key=Object.hasOwn(ja,value)?value:englishKeys.get(value);
 if(key)return String(i18n.t(key,{...Object.fromEntries(Object.entries(values??{}).map(([k,v])=>[k,typeof v==='string'&&depth<8?translate(v,undefined,depth+1):v]))}));
 if(depth<8)for(const pattern of patterns){const match=pattern.regex.exec(value);if(match)return String(i18n.t(pattern.key,Object.fromEntries(pattern.names.map((name,index)=>[name,translate(match[index+1],undefined,depth+1)]))));}
 if(depth<8)for(const prefix of prefixes)if(value.startsWith(prefix.text)&&value.length>prefix.text.length)return String(i18n.t(prefix.key))+translate(value.slice(prefix.text.length),undefined,depth+1);
 return value;
}
export function t<T>(value:T,values?:Record<string,unknown>):T{return (typeof value==='string'?translate(value,values):value) as T;}
export function setLanguage(language:Language){void i18n.changeLanguage(language);}
function syncLanguage(){
 const language=i18n.resolvedLanguage==='en'?'en':'ja';
 if(typeof document!=='undefined'){
  document.documentElement.lang=language;document.title=`Image Studio | ${t('写真のサイズ調整・印刷')}`;
  document.querySelector('meta[name="description"]')?.setAttribute('content',t('写真のサイズ調整と印刷配置をブラウザ内で行うImage Studio。PNG/PDF保存に対応。'));
 }
 try{globalThis.localStorage?.setItem(storageKey,language);}catch{/* Do not block the editor when storage is denied. */}
}
i18n.on('languageChanged',syncLanguage);syncLanguage();
export default i18n;
