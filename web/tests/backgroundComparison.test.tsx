import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
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
test('the image divider supports drag and keyboard',()=>{
 setup();const divider=screen.getByRole('slider',{name:'背景比較の境界線'});
 fireEvent(divider,new MouseEvent('pointerdown',{clientX:200,clientY:200,button:0,bubbles:true}));
 fireEvent(window,new MouseEvent('pointermove',{clientX:300,clientY:200,bubbles:true}));
 fireEvent(window,new MouseEvent('pointerup',{bubbles:true}));
 expect(divider.getAttribute('aria-valuenow')).toBe('75');
 fireEvent.keyDown(divider,{key:'ArrowLeft'});expect(divider.getAttribute('aria-valuenow')).toBe('74');
 expect(screen.getByAltText('背景編集前の写真').getAttribute('src')).toBe('blob:original');
 expect(screen.getByAltText('背景編集後の写真').getAttribute('src')).toBe('blob:result');
});
test('comparison has no external range or zoom controls and leaves wheel scrolling native',()=>{
 const view=setup();const viewport=screen.getByRole('region',{name:'背景比較の表示領域'});
 expect(screen.getAllByRole('slider')).toHaveLength(1);
 expect(view.container.querySelector('input[type="range"]')).toBeNull();
 expect(screen.queryByRole('combobox')).toBeNull();
 expect(screen.queryByRole('button',{name:'元の写真のみ'})).toBeNull();
 expect(screen.queryByRole('button',{name:'仕上がりのみ'})).toBeNull();
 expect(screen.queryByRole('button',{name:'全体表示に戻す'})).toBeNull();
 const wheel=new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true});
 fireEvent(viewport,wheel);expect(wheel.defaultPrevented).toBe(false);
 expect(screen.getByRole('slider',{name:'背景比較の境界線'}).getAttribute('aria-valuenow')).toBe('50');
});
