/** Shared admission. A pipeline lease can delegate one Worker slot without releasing global ownership. */
export function createWorkerGate(){
 let active=null,blocked=false,state=Object.freeze({busy:false,blocked:false});
 const update=()=>{if(state.busy!==!!active||state.blocked!==blocked)state=Object.freeze({busy:!!active,blocked});};
 return Object.freeze({
  tryAcquire(){
   if(active||blocked)return null;
   const token={child:null,closing:false};active=token;update();let childGate;
   const finish=()=>{if(token.closing&&!token.child&&active===token)active=null;update();};
   return Object.freeze({
    release({failed=false}={}){
     if(token.closing||active!==token)return false;token.closing=true;blocked||=failed;finish();return true;
    },
    createChildGate(){
     if(childGate)return childGate;
     let snapshot;
     childGate=Object.freeze({
      getState(){
       const busy=!!token.child,unavailable=blocked||active!==token||token.closing;
       if(!snapshot||snapshot.busy!==busy||snapshot.blocked!==unavailable)snapshot=Object.freeze({busy,blocked:unavailable});return snapshot;
      },
      tryAcquire(){
       if(token.child||blocked||active!==token||token.closing)return null;
       const child={};token.child=child;
       return Object.freeze({release({failed=false}={}){
        if(token.child!==child)return false;token.child=null;blocked||=failed;finish();return true;
       }});
      },
     });return childGate;
    },
   });
  },
  getState(){return state;},
 });
}
