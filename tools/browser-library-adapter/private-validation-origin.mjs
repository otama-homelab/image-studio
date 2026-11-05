/** Explicit private-device validation only; never authorizes public deployment. */
export function isPrivateLanHttpsOrigin(value){
 try{
  const u=new URL(value);if(u.origin!==value||u.protocol!=='https:')return false;
  const parts=u.hostname.split('.');if(parts.length!==4||parts.some(p=>!/^\d{1,3}$/.test(p)||Number(p)>255))return false;
  const [a,b]=parts.map(Number);return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168);
 }catch{return false;}
}
export function isPrivateValidationOrigin(value,lan=false){
 try{const u=new URL(value);return lan===true?isPrivateLanHttpsOrigin(value):u.origin===value&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname);}catch{return false;}
}
