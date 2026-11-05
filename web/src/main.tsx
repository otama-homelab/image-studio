import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import Root from './Root';
import './style.css';
const root=createRoot(document.getElementById('root')!);
root.render(<StrictMode><Root/></StrictMode>);
if(__BACKGROUND_RELEASE__!==null){
 const config=__BACKGROUND_RELEASE__;
 void import('./background/releaseRuntime').then(({createReleaseBackgroundRuntime})=>{
  root.render(<StrictMode><Root backgroundRuntime={createReleaseBackgroundRuntime(config,location.origin)}/></StrictMode>);
 }).catch(()=>{
  root.render(<StrictMode><Root backgroundConfigurationFailed/></StrictMode>);
 });
}
