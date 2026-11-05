#!/usr/bin/env python3
"""Compare a separate experimental FP16 BiRefNet PTE to the accepted FP32 PTE."""
import os,pathlib,json,sys,time,subprocess,hashlib,re
os.environ['MESA_SHADER_CACHE_DISABLE']='false';os.environ['MESA_SHADER_CACHE_DIR']='/work/shader-cache';os.environ['MESA_SHADER_CACHE_MAX_SIZE']='128M';sys.path.insert(0,'/app')
affinity=sorted(os.sched_getaffinity(0));os.sched_setaffinity(0,set(affinity[:2]))
import torch,numpy as np
from PIL import Image
from torchvision import transforms
from image_studio_executorch import load_configuration
assert os.getuid()==1000 and not pathlib.Path('/dev/kfd').exists();torch.set_num_threads(2)
runner,models=load_configuration();root=pathlib.Path('/work');out=root/'outputs';out.mkdir(exist_ok=False);candidate=root/'candidate/birefnet.pte';report=json.loads((root/'candidate/birefnet.json').read_text());sha=lambda p:hashlib.file_digest(p.open('rb'),'sha256').hexdigest();assert report['force_fp16'] and report['artifact_sha256']==sha(candidate)
r={'executed':False,'accepted_under_existing_float_tolerance':False,'candidate_sha256':sha(candidate),'candidate_report':report,'scope':'BiRefNet-only public-photo input, accepted FP32 PTE versus experimental FP16 PTE; no full application acceptance','runs':[]}
try:
 image=Image.open('/reference/input.png').convert('RGB');value=transforms.Compose([transforms.Resize((2048,2048)),transforms.ToTensor(),transforms.Normalize([.485,.456,.406],[.229,.224,.225])])(image).unsqueeze(0).numpy();source=root/'input.bin';value.tofile(source);r['input_sha256']=sha(source);reference=None
 for label,model,count in [('fp32',models['birefnet'],1),('fp16',candidate,3)]:
  base=root/label;start=time.monotonic();p=subprocess.run([str(runner),'--model_path='+str(model),'--inputs='+str(source),'--output_file='+str(base),'--num_executions='+str(count),'--cpu_threads=2','--print_output=none'],capture_output=True,text=True,timeout=150);wall=time.monotonic()-start;log=p.stdout+p.stderr;(out/(label+'.log')).write_text(log)
  row={'label':label,'count':count,'wall_seconds':wall,'exit_code':p.returncode,'iteration_ms':[float(x) for x in re.findall(r'Iteration [0-9]+ of [0-9]+: ([0-9.]+) ms',log)]};r['runs'].append(row)
  if p.returncode:raise RuntimeError('Candidate runner failed: '+log[-2000:])
  file=pathlib.Path(str(base)+'-0.bin');actual=np.fromfile(file,dtype=np.float32);row['elements']=int(actual.size);row['nonfinite']=int((~np.isfinite(actual)).sum());assert actual.size==2048*2048 and row['nonfinite']==0
  if reference is None:reference=actual.copy()
  else:
   d=np.abs(actual-reference);a=(actual*255).round().clip(0,255).astype(np.int16);b=(reference*255).round().clip(0,255).astype(np.int16);d8=np.abs(a-b);r['comparison']={'max_abs':float(d.max()),'mean_abs':float(d.mean()),'outside_atol_rtol_5e5':int((d>5e-5+5e-5*np.abs(reference)).sum()),'alpha8_max_delta':int(d8.max()),'alpha8_mean_delta':float(d8.mean()),'alpha8_fraction_over_1':float((d8>1).mean()),'alpha_outside_unit_interval':int(((actual<0)|(actual>1)).sum())};r['accepted_under_existing_float_tolerance']=bool(np.allclose(actual,reference,atol=5e-5,rtol=5e-5))
  file.unlink();(out/'result.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(row),flush=True)
 source.unlink();r['executed']=True
finally:(out/'result.json').write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps(r),flush=True)
