import {afterEach,expect,test} from 'vitest';
import {cleanup,render,screen,within} from '@testing-library/react';
import {EditorNavigation} from '../src/SiteChrome';
afterEach(cleanup);
for(const current of ['background','crop','print'] as const)test(`workflow navigation preserves destinations and identifies ${current}`,()=>{
 render(<EditorNavigation current={current}/>);
 const links=within(screen.getByRole('navigation',{name:'編集工程'})).getAllByRole('link');
 expect(links.map(link=>link.getAttribute('href'))).toEqual(['#/background','#/crop','#/print']);
 expect(links.filter(link=>link.getAttribute('aria-current')==='page').map(link=>link.getAttribute('href'))).toEqual([`#/${current}`]);
});
test('unconfigured background keeps the same destination with its availability label',()=>{
 render(<EditorNavigation current="crop" backgroundAvailable={false}/>);
 expect(screen.getByRole('link',{name:'背景編集（準備中）'}).getAttribute('href')).toBe('#/background');
});
