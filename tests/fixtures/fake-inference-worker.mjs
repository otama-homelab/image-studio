export class FakeWorker {
 listeners=new Map();sent=[];terminated=0;
 addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
 removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
 postMessage(message,transfer){this.sent.push({message,transfer});}
 terminate(){this.terminated++;}
 emit(type,data){for(const fn of [...this.listeners.get(type)||[]])fn(type==='message'?{data}:{message:'private runtime payload'});}
 reply(payload){this.emit('message',{workerId:this.sent.at(-1).message.workerId,jobId:this.sent.at(-1).message.jobId,...payload});}
}
