import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {BackgroundComparison} from '../src/background/BackgroundComparison';
import i18n from '../src/i18n';

beforeEach(()=>{
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(()=>({width:400,height:400,x:0,y:0,top:0,left:0,right:400,bottom:400,toJSON:()=>({})}));
 vi.spyOn(HTMLElement.prototype,'offsetWidth','get').mockReturnValue(400);
 vi.spyOn(HTMLElement.prototype,'offsetHeight','get').mockReturnValue(400);
 vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(400);
});
afterEach(async()=>{cleanup();vi.restoreAllMocks();await i18n.changeLanguage('ja');});
const setup=()=>render(<BackgroundComparison original="blob:original" result="blob:result" width={400} height={400}/>);
test('library divider drag and keyboard stay synchronized with the range control and endpoints',()=>{
 setup();const divider=screen.getByRole('slider',{name:'背景比較の境界線'}),range=screen.getByRole('slider',{name:'仕上がりの表示範囲'}) as HTMLInputElement;
 fireEvent(divider,new MouseEvent('pointerdown',{clientX:200,clientY:200,button:0,bubbles:true}));
 fireEvent(window,new MouseEvent('pointermove',{clientX:300,clientY:200,bubbles:true}));
 fireEvent(window,new MouseEvent('pointerup',{bubbles:true}));
 expect(range.value).toBe('75');expect(divider.getAttribute('aria-valuenow')).toBe('75');
 fireEvent.keyDown(divider,{key:'ArrowLeft'});expect(range.value).toBe('74');
 fireEvent.change(range,{target:{value:'25'}});expect(divider.getAttribute('aria-valuenow')).toBe('25');
 fireEvent.click(screen.getByRole('button',{name:'元の写真のみ'}));expect(range.value).toBe('0');
 fireEvent.click(screen.getByRole('button',{name:'仕上がりのみ'}));expect(range.value).toBe('100');
 expect(screen.getByAltText('背景編集前の写真').getAttribute('src')).toBe('blob:original');
 expect(screen.getByAltText('背景編集後の写真').getAttribute('src')).toBe('blob:result');
});
test('library wheel zoom and keyboard pan are display-only and reset restores fit',async()=>{
 const view=setup();const wrapper=view.container.querySelector('.comparison-zoom-wrapper')!;
 fireEvent.wheel(wrapper,{deltaY:-100,clientX:200,clientY:200});
 await waitFor(()=>expect((screen.getByRole('combobox',{name:'プレビューの倍率'}) as HTMLSelectElement).value).not.toBe('fit'));
 expect(screen.getByRole('region',{name:'背景比較の表示領域'}).tabIndex).toBe(0);
 fireEvent.keyDown(wrapper,{key:'ArrowRight'});
 expect(screen.getByAltText('背景編集後の写真').getAttribute('src')).toBe('blob:result');
 fireEvent.click(screen.getByRole('button',{name:'全体表示に戻す'}));
 await waitFor(()=>expect((screen.getByRole('combobox',{name:'プレビューの倍率'}) as HTMLSelectElement).value).toBe('fit'));
});
