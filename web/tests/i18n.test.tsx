import {afterEach,expect,test,vi} from 'vitest';
import i18n,{setLanguage,t} from '../src/i18n';
import ja from '../src/locales/ja.json';
import en from '../src/locales/en.json';
afterEach(async()=>{vi.restoreAllMocks();await i18n.changeLanguage('ja');});
test('Japanese and English catalogs have matching keys and interpolation parameters',()=>{
 expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort());
 for(const [key,value] of Object.entries(en)){
  expect(value.trim().length,key).toBeGreaterThan(0);
  expect([...value.matchAll(/\{\{(\w+)\}\}/g)].map(m=>m[1]).sort(),key).toEqual([...key.matchAll(/\{\{(\w+)\}\}/g)].map(m=>m[1]).sort());
  if(key!=='日本語')expect(value,key).not.toMatch(/[\u3040-\u30ff\u3400-\u9fff]/u);
 }
});
test('language selection updates document metadata and persists the preference',()=>{
 setLanguage('en');expect(document.documentElement.lang).toBe('en');expect(localStorage.getItem('image-studio-language')).toBe('en');expect(document.title).toContain('Photo resizing');
 expect(t('サイズを整える')).toBe('Resize a photo');
 setLanguage('ja');expect(document.documentElement.lang).toBe('ja');expect(t('Resize a photo')).toBe('サイズを整える');
});
test('formatted session notices can switch language without replacing their state',()=>{
 const original=t('この構成{{v0}}のモデル資源は約{{v1}}MiBです。',{v0:t('全体（輪郭補正用を含む）'),v1:125});
 setLanguage('en');const english=t(original);expect(english).toContain('125 MiB');expect(english).toContain('including edge refinement');expect(english).not.toMatch(/[\u3040-\u9fff]/u);
 setLanguage('ja');expect(t(english)).toBe(original);
});
test('stored concatenated failure notices retain stage and safe error code across switches',()=>{
 setLanguage('en');const value=t('処理を完了できませんでした。写真と設定を保持しています。実行用プログラムの取得に接続が必要な場合があります。接続と端末情報を確認して、もう一度実行してください。')+t(' 失敗した段階：{{v0}}（コード：{{v1}}）。',{v0:t('背景除去'),v1:'runtime-error'});
 expect(value).toContain('Background removal');setLanguage('ja');const translated=t(value);expect(translated).toContain('処理を完了できませんでした。');expect(translated).toContain('背景除去');expect(translated).toContain('runtime-error');
});
test('denied preference storage does not block language switching or alter unknown data',()=>{
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Denied','SecurityError');});
 setLanguage('en');expect(i18n.resolvedLanguage).toBe('en');expect(t('blob:private-photo')).toBe('blob:private-photo');const object={id:'private'};expect(t(object)).toBe(object);
});
