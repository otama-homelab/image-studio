import {useState} from 'react';
export type Framing={range:number;horizontal:number;vertical:number};
export type FrameAxis=keyof Framing;
export const initialFraming:Framing={range:100,horizontal:50,vertical:50};
export const axisMinimum=(axis:FrameAxis)=>axis==='range'?10:0;
const draftsFor=(value:Framing)=>({range:String(Math.round(value.range)),horizontal:String(Math.round(value.horizontal)),vertical:String(Math.round(value.vertical))});

/** Only form drafts live here; image geometry and pointer interaction stay in shared/library APIs. */
export function useFraming(invalidate:()=>void){
 const [value,setValue]=useState<Framing>(initialFraming),[drafts,setDrafts]=useState(draftsFor(initialFraming));
 const valid=(axis:FrameAxis)=>/^\d+$/.test(drafts[axis])&&Number(drafts[axis])>=axisMinimum(axis)&&Number(drafts[axis])<=100;
 const pending=(Object.keys(value) as FrameAxis[]).some(axis=>!valid(axis)||Number(drafts[axis])!==Math.round(value[axis]));
 function update(next:Framing){invalidate();setValue(next);setDrafts(draftsFor(next));}
 return {value,drafts,pending,valid,
  edit(axis:FrameAxis,text:string){invalidate();setDrafts(current=>({...current,[axis]:text}));},
  commit(axis:FrameAxis){if(!valid(axis))return;invalidate();setValue(current=>({...current,[axis]:Number(drafts[axis])}));setDrafts(current=>({...current,[axis]:String(Number(drafts[axis]))}));},
  restore(axis:FrameAxis){setDrafts(current=>({...current,[axis]:String(Math.round(value[axis]))}));},
  adjust(axis:FrameAxis,next:number){if(!Number.isInteger(next)||next<axisMinimum(axis)||next>100)return;invalidate();setValue(current=>({...current,[axis]:next}));setDrafts(current=>({...current,[axis]:String(next)}));},
  move(next:Framing){if((Object.keys(value) as FrameAxis[]).every(axis=>Math.abs(next[axis]-value[axis])<1e-10))return;update(next);},
  reset(){update(initialFraming);},
 };
}
