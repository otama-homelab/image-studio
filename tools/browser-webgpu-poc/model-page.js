const elements = Object.fromEntries(['load','run','cancel','strict','case','result','model-info','save-output','save-report']
  .map(id => [id,document.getElementById(id)]));
window.modelPoc = {state:'initializing',events:[],report:null,output:null};
let config;
let worker;
let generation = 0;
let jobNumber = 0;
function display(data) { elements.result.textContent = JSON.stringify(data,null,2); }
function stop() { ++generation; worker?.terminate(); worker = undefined; elements.run.disabled = true; elements.cancel.disabled = true; }
function save(data,type,name) {
  const url = URL.createObjectURL(new Blob([data],{type}));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url),60000);
}
elements.load.onclick = () => {
  stop();
  const token = generation;
  worker = new Worker('./model-worker.js?v='+Date.now(),{type:'module'});
  window.modelPoc = {state:'loading',events:[],report:null,output:null};
  elements.load.disabled = true; elements.cancel.disabled = false;
  elements['save-output'].disabled = true; elements['save-report'].disabled = true;
  worker.onmessage = ({data}) => {
    if (generation !== token) return;
    if (data.output) { window.modelPoc.output = data.output; delete data.output; }
    window.modelPoc.events.push(data);
    window.modelPoc.report = data;
    if (data.type === 'ready') {
      window.modelPoc.state = 'ready'; elements.run.disabled = false; elements.load.disabled = false;
    } else if (data.type === 'result') {
      window.modelPoc.state = 'complete'; elements.run.disabled = false; elements.load.disabled = false;
      elements['save-output'].disabled = false;
    } else if (data.type === 'diagnostic-result') {
      window.modelPoc.state = 'complete'; elements.run.disabled = false; elements.load.disabled = false;
      elements['save-output'].disabled = true;
    } else if (data.type === 'error' || data.type === 'device-lost') {
      window.modelPoc.state = 'error'; elements.run.disabled = true; elements.load.disabled = false;
      elements['save-output'].disabled = true;
    }
    elements['save-report'].disabled = false;
    display(data);
  };
  worker.onerror = event => {
    if (generation !== token) return;
    window.modelPoc.state = 'error';
    window.modelPoc.report = {type:'error',message:event.message};
    elements.load.disabled = false; elements.run.disabled = true; display(window.modelPoc.report);
  };
  worker.postMessage({type:'load',config,strict:elements.strict.checked,jobId:++jobNumber});
};
elements.run.onclick = () => {
  window.modelPoc.state = 'running'; window.modelPoc.output = null;
  elements.run.disabled = true; elements.load.disabled = true; elements['save-output'].disabled = true;
  worker.postMessage({type:'run',caseId:elements.case.value,jobId:++jobNumber});
};
elements.cancel.onclick = () => {
  stop(); window.modelPoc.state = 'cancelled'; window.modelPoc.output = null;
  elements.load.disabled = false; elements['save-output'].disabled = true; display({type:'cancelled'});
};
elements['save-output'].onclick = () => save(window.modelPoc.output,'application/octet-stream',config.modelId+'-alpha.f32');
elements['save-report'].onclick = () => save(JSON.stringify(window.modelPoc,null,2),'application/json','webgpu-report.json');
try {
  const response = await fetch('/config.json');
  if (!response.ok) throw new Error('manifest HTTP '+response.status);
  config = await response.json();
  for (const item of config.cases) {
    const option = document.createElement('option'); option.value = item.id;
    option.textContent = item.id+' / '+item.shape.join(' × '); elements.case.append(option);
  }
  elements['model-info'].textContent = config.modelId+' / '+config.files.reduce((sum,file)=>sum+file.bytes,0)+' bytes';
  window.modelPoc.state = 'idle'; elements.load.disabled = false;
} catch (error) { window.modelPoc.state = 'error'; display({message:error.message}); }
