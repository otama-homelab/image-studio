import type {MouseEvent} from 'react';
export function focusSection(event:MouseEvent<HTMLAnchorElement>,id:string){event.preventDefault();document.getElementById(id)?.focus();}
