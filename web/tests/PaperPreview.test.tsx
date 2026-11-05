import {afterEach,expect,test} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {PaperPreview} from '../src/PaperPreview';
import {paperLayout} from '../../tools/browser-library-adapter/print-geometry.mjs';
afterEach(cleanup);
test('paper photo preview uses the export layout and fractional source crop without repeated image nodes',()=>{
 const layout=paperLayout({paper:'a4',photoWidth:354,photoHeight:472,dpi:[300,300]});
 const {container}=render(<PaperPreview layout={layout} picture={{url:'blob:local-photo',width:1601,height:2000,crop:{x:50.5,y:0,width:1500,height:2000}}}/>);
 expect(screen.getByRole('img',{name:'用紙に36枚を配置する目安'}).getAttribute('viewBox')).toBe('0 0 2480 3508');
 const pattern=container.querySelector('pattern')!;expect(pattern.getAttribute('x')).toBe('90');expect(pattern.getAttribute('y')).toBe('250');expect(pattern.getAttribute('width')).toBe('389');expect(pattern.getAttribute('height')).toBe('507');
 expect(pattern.querySelector('svg')!.getAttribute('viewBox')).toBe('50.5 0 1500 2000');expect(container.querySelectorAll('image')).toHaveLength(1);expect(container.querySelector('image')!.getAttribute('href')).toBe('blob:local-photo');
 const occupied=container.querySelector('svg > rect[fill^="url"]')!;expect(occupied.getAttribute('width')).toBe('2299');expect(occupied.getAttribute('height')).toBe('3007');
});
test('tiny photos keep a constant preview structure and photo changes replace the local URL',()=>{
 const layout=paperLayout({paper:'a4',photoWidth:1,photoHeight:1,dpi:null}),picture={url:'blob:first',width:1,height:1,crop:{x:0,y:0,width:1,height:1}};
 const view=render(<PaperPreview layout={layout} picture={picture}/>);expect(layout.count).toBeGreaterThan(6000);expect(view.container.querySelectorAll('image')).toHaveLength(1);
 view.rerender(<PaperPreview layout={layout} picture={{...picture,url:'blob:second'}}/>);expect(view.container.querySelector('image')!.getAttribute('href')).toBe('blob:second');expect(view.container.innerHTML).not.toContain('blob:first');
});
test('prepared PNG uses the existing download URL and returning to a draft removes it',()=>{
 const layout=paperLayout({paper:'l',photoWidth:354,photoHeight:472,dpi:null}),view=render(<PaperPreview layout={layout} pngUrl="blob:prepared"/>);
 expect(screen.getByRole('img',{name:'作成済みの用紙PNG'}).getAttribute('src')).toBe('blob:prepared');expect(view.container.querySelector('svg')).toBeNull();
 view.rerender(<PaperPreview layout={layout}/>);expect(screen.queryByRole('img',{name:'作成済みの用紙PNG'})).toBeNull();expect(view.container.innerHTML).not.toContain('blob:prepared');
});
