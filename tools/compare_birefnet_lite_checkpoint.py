"""Read-only provenance check for the pinned native-DeformConv BiRefNet lite export.
No remote code/model inference. Reconstruct exported constants from safetensors.
"""
import os
os.environ['OPENBLAS_NUM_THREADS']='1'
from pathlib import Path
import json,onnx,numpy as np,resource,argparse,hashlib
from safetensors.numpy import load_file
args=argparse.ArgumentParser(description=__doc__)
for name in ['model','checkpoint','output','model-sha256','checkpoint-sha256']:args.add_argument('--'+name,required=True)
a=args.parse_args();model_path=Path(a.model);checkpoint_path=Path(a.checkpoint);output=Path(a.output)
if output.exists():raise SystemExit('Choose new output')
def sha(path):
 digest=hashlib.sha256()
 with path.open('rb') as stream:
  while chunk:=stream.read(1024*1024):digest.update(chunk)
 return digest.hexdigest()
if sha(model_path)!=a.model_sha256 or sha(checkpoint_path)!=a.checkpoint_sha256:raise SystemExit('Source SHA mismatch')
m=onnx.load(model_path,load_external_data=False)
if any(t.external_data for t in m.graph.initializer):raise SystemExit('Self-contained model required')
weights=load_file(checkpoint_path);init={t.name:onnx.numpy_helper.to_array(t) for t in m.graph.initializer};direct=[];generated=set()
for name,value in init.items():
 key=name.removeprefix('net.')
 if key not in weights:generated.add(name);continue
 source=weights[key]
 if value.shape!=source.shape or value.dtype!=source.dtype or value.tobytes()!=source.tobytes():raise SystemExit('Direct named weight mismatch: '+key)
 direct.append(key)
results={}

def prefix(node):
 parts=node.name.strip('/').split('/')[1:-1];clean=[]
 for i,v in enumerate(parts):
  if i+1<len(parts) and parts[i+1].startswith(v+'.'):continue
  clean.append(v)
 return '.'.join(clean)
def compare(name,value,rule,source):
 a=init[name];same=a.shape==value.shape
 if not same:raise ValueError((name,a.shape,value.shape))
 diff=np.abs(a-value);results[name]={'rule':rule,'source':source,'shape':list(a.shape),'exact':a.tobytes()==value.tobytes(),'differentElements':int(np.count_nonzero(diff)),'maxAbsoluteError':float(diff.max()),'meanAbsoluteError':float(diff.mean())}
for node in m.graph.node:
 names=[n for n in node.input if n in generated]
 if not names or node.op_type=='Identity':continue
 base=prefix(node)
 if node.op_type=='MatMul':
  key=base+'.weight';compare(names[0],weights[key].T.copy(),'linear-weight-transpose',[key])
 elif node.op_type=='Add':
  base=base.replace('attn_1','attn');table=base+'.relative_position_bias_table';index=base+'.relative_position_index';ids=weights[index];n=ids.shape[0];value=weights[table][ids.reshape(-1)].reshape(n,n,-1).transpose(2,0,1)[None].copy();compare(names[0],value,'relative-position-table-gather-reshape-transpose',[table,index])
 elif node.op_type=='Conv':
  if base.endswith('.conv_in'):bn=base[:-7]+'bn_in'
  elif base.endswith('.conv_out'):bn=base[:-8]+'bn_out'
  elif base.endswith('.conv1'):bn=base[:-5]+'bn1'
  elif base.endswith('.global_avg_pool.1') or '.gdt_convs_' in base:bn=base[:-1]+str(int(base[-1])+1)
  else:raise ValueError(base)
  w=weights[base+'.weight'];bias=weights.get(base+'.bias',np.zeros(w.shape[0],dtype=np.float32));scale=weights[bn+'.weight']/np.sqrt(weights[bn+'.running_var']+np.float32(1e-5));neww=w*scale.reshape((-1,)+(1,)*(w.ndim-1));newb=(bias-weights[bn+'.running_mean'])*scale+weights[bn+'.bias'];compare(node.input[1],neww,'conv-batchnorm-fold-eps-1e-5-numpy',[base,bn]);compare(node.input[2],newb,'conv-batchnorm-fold-eps-1e-5-numpy',[base,bn])
 else:raise ValueError(node.op_type)
r={'status':'initializer-value-correspondence-measured','modelSha256':a.model_sha256,'checkpointSha256':a.checkpoint_sha256,'directNamedExactCount':len(direct),'onnxInitializers':len(init),'generatedCount':len(generated),'mappedCount':len(results),'exactCount':sum(v['exact'] for v in results.values()),'unmapped':sorted(generated-results.keys()),'results':results,'maxRssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'limitations':['This export is checked by direct/transformed raw byte equality; full graph/PyTorch output equivalence remains separate.','Source revision provenance and full graph equivalence are not established.','No model inference or remote Python source execution.']};output.write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({k:r[k] for k in ['generatedCount','mappedCount','exactCount','unmapped','maxRssKiB']}));print(json.dumps({name:max(v['maxAbsoluteError'] for v in results.values() if v['rule']==name) for name in {v['rule'] for v in results.values()}}))
