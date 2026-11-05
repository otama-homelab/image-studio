import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {CropViewport} from '../src/CropViewport';

// Actual react-easy-crop component; only DOM layout/image decoding are simulated.
let stage=400;
beforeEach(()=>{
 stage=400;
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(()=>({width:stage,height:stage,x:0,y:0,top:0,left:0,right:stage,bottom:stage,toJSON:()=>({})}));
 vi.spyOn(HTMLElement.prototype,'offsetWidth','get').mockImplementation(()=>stage);
 vi.spyOn(HTMLElement.prototype,'offsetHeight','get').mockImplementation(()=>stage);
 vi.spyOn(HTMLImageElement.prototype,'naturalWidth','get').mockReturnValue(400);
 vi.spyOn(HTMLImageElement.prototype,'naturalHeight','get').mockReturnValue(400);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});

test('real cropper maps image coordinates to preview at two layout scales without reporting a user edit',async()=>{
 const onMove=vi.fn(),onReady=vi.fn();
 render(<CropViewport image="blob:fixture" outputWidth={354} outputHeight={472} frame={{range:50,horizontal:20,vertical:70}} guides squareGuide={false} onMove={onMove} onReady={onReady} onError={vi.fn()} invalidate={vi.fn()}/>);
 const image=screen.getByAltText('選択した写真');fireEvent.load(image);
 await waitFor(()=>expect(image.style.transform).toBe('translate(150px, -80px) rotate(0deg) scale(2)'));
 expect(onReady).toHaveBeenCalledWith(400,400);expect(onMove).not.toHaveBeenCalled();
 stage=200;fireEvent(window,new Event('resize'));
 await waitFor(()=>expect(image.style.transform).toBe('translate(75px, -40px) rotate(0deg) scale(2)'));
 expect(onMove).not.toHaveBeenCalled();
});

test('real cropper keyboard updates image-relative position and guide toggles preserve geometry',async()=>{
 const onMove=vi.fn(),invalidate=vi.fn();
 const props={image:'blob:fixture',outputWidth:354,outputHeight:472,frame:{range:50,horizontal:20,vertical:70},guides:true,squareGuide:false,onMove,onReady:vi.fn(),onError:vi.fn(),invalidate};
 const view=render(<CropViewport {...props}/>);const image=screen.getByAltText('選択した写真');fireEvent.load(image);
 await waitFor(()=>expect(image.style.transform).toContain('translate(150px, -80px)'));
 const target=screen.getByLabelText('写真の切り抜き枠');fireEvent.keyDown(target,{key:'ArrowRight'});fireEvent.keyUp(target,{key:'ArrowRight'});
 await waitFor(()=>expect(onMove).toHaveBeenCalled());
 const next=onMove.mock.calls.at(-1)?.[0];expect(next.range).toBeCloseTo(50,9);expect(next.horizontal).toBeCloseTo(19.8,9);expect(next.vertical).toBeCloseTo(70,9);expect(invalidate).toHaveBeenCalled();
 view.rerender(<CropViewport {...props} frame={next} guides={false}/>);
 await waitFor(()=>expect(image.style.transform).toContain('translate(151px, -80px)'));
 expect(target.classList.contains('portrait-guide')).toBe(false);
});

test('real cropper wheel zoom updates image-relative framing and invalidates prepared output',async()=>{
 const onMove=vi.fn(),invalidate=vi.fn();
 render(<CropViewport image="blob:fixture" outputWidth={354} outputHeight={472} frame={{range:50,horizontal:20,vertical:70}} guides={false} squareGuide={false} onMove={onMove} onReady={vi.fn()} onError={vi.fn()} invalidate={invalidate}/>);
 const image=screen.getByAltText('選択した写真');fireEvent.load(image);
 await waitFor(()=>expect(image.style.transform).toContain('scale(2)'));
 fireEvent.wheel(screen.getByLabelText('写真の切り抜き枠'),{deltaY:-100,clientX:200,clientY:200});
 await waitFor(()=>expect(onMove).toHaveBeenCalled());
 expect(onMove.mock.calls.at(-1)![0].range).toBeCloseTo(100/2.05,6);expect(invalidate).toHaveBeenCalled();
});

test('a drag remains an edit after an overlapping wheel gesture finishes',async()=>{
 const onMove=vi.fn();
 render(<CropViewport image="blob:fixture" outputWidth={354} outputHeight={472} frame={{range:50,horizontal:20,vertical:70}} guides={false} squareGuide={false} onMove={onMove} onReady={vi.fn()} onError={vi.fn()} invalidate={vi.fn()}/>);
 const image=screen.getByAltText('選択した写真');fireEvent.load(image);
 await waitFor(()=>expect(image.style.transform).toContain('scale(2)'));
 const target=screen.getByLabelText('写真の切り抜き枠');fireEvent.wheel(target,{deltaY:-100,clientX:200,clientY:200});
 fireEvent.mouseDown(target,{button:0,clientX:200,clientY:200});
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,300));});
 const count=onMove.mock.calls.length;fireEvent.mouseMove(document,{clientX:230,clientY:200});
 await waitFor(()=>expect(onMove.mock.calls.length).toBeGreaterThan(count));
 fireEvent.mouseUp(document);
});
