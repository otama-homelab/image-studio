#!/usr/bin/env python3
"""Measure per-process setup versus repeated model execution; not application timing."""
import os,pathlib,sys,time,json,subprocess,re,hashlib,resource
os.environ['MESA_SHADER_CACHE_DISABLE']='false';os.environ['MESA_SHADER_CACHE_DIR']='/work/shader-cache';os.environ['MESA_SHADER_CACHE_MAX_SIZE']='128M';os.environ['HF_HUB_OFFLINE']='1'
affinity=sorted(os.sched_getaffinity(0));assert len(affinity)>=2;os.sched_setaffinity(0,set(affinity[:2]));sys.path.insert(0,'/app')
import torch,numpy as np
from PIL import Image
from torchvision import transforms
from transformers import VitMatteImageProcessor
from image_studio_executorch import load_configuration
assert os.getuid()==1000 and set(os.getgroups())=={990,1000};assert not pathlib.Path('/dev/kfd').exists();torch.set_num_threads(2)
root=pathlib.Path('/work');art=root/'outputs';art.mkdir(exist_ok=False);runner,models=load_configuration();image=Image.open('/reference/input.png').convert('RGB');processor=VitMatteImageProcessor.from_pretrained('hustvl/vitmatte-base-distinctions-646',revision='b58373f8dbbfbeb58157456e2e4949f9f872aa18')
r={'passed':False,'scope':'Runner one execution versus three executions in one loaded process; not end-to-end app or exact real trimap performance','runner_sha256':hashlib.file_digest(runner.open('rb'),'sha256').hexdigest(),'runner_has_iteration_log':b'Iteration %' in runner.read_bytes(),'runner_has_load_log':b'Model loaded in' in runner.read_bytes(),'cpu_affinity':sorted(os.sched_getaffinity(0)),'cases':[]}
try:
 for name,side in [('birefnet',2048),('vitmatte',512),('vitmatte',2016)]:
  if name=='birefnet':value=transforms.Compose([transforms.Resize((2048,2048)),transforms.ToTensor(),transforms.Normalize([.485,.456,.406],[.229,.224,.225])])(image).unsqueeze(0).numpy()
  else:
   rgb=image.resize((side,side),Image.Resampling.LANCZOS);trimap=np.full((side,side),128,dtype=np.uint8);trimap[:16,:]=0;trimap[-16:,:]=255;value=processor(images=rgb,trimaps=Image.fromarray(trimap),return_tensors='pt',do_resize=False)['pixel_values'].numpy()
  assert value.dtype==np.float32;path=root/(name+'-'+str(side)+'-input.bin');value.tofile(path);case={'model':name,'shape':list(value.shape),'input_sha256':hashlib.file_digest(path.open('rb'),'sha256').hexdigest(),'input_description':'Public image BiRefNet preprocessing' if name=='birefnet' else 'Public RGB with synthetic anchored trimap; shape fixed','runs':[]};r['cases'].append(case);reference=None
  for count in [1,3]:
   out=root/(name+'-'+str(side)+'-'+str(count));cmd=[str(runner),'--model_path='+str(models[name]),'--inputs='+str(path),'--output_file='+str(out),'--num_executions='+str(count),'--cpu_threads=2','--print_output=none']
   if name=='vitmatte':cmd.append('--input_shape='+','.join(str(x) for x in value.shape))
   start=time.monotonic();done=subprocess.run(cmd,capture_output=True,text=True,timeout=240);elapsed=time.monotonic()-start;log=done.stdout+done.stderr;(art/(name+'-'+str(side)+'-'+str(count)+'.log')).write_text(log);assert done.returncode==0,log[-3000:]
   output=pathlib.Path(str(out)+'-0.bin');actual=np.fromfile(output,dtype=np.float32);assert actual.size==value.shape[2]*value.shape[3] and np.isfinite(actual).all()
   if reference is None:reference=actual.copy();error=0.0
   else:error=float(np.max(np.abs(actual-reference)));assert np.allclose(actual,reference,atol=5e-5,rtol=5e-5)
   total=re.findall(r'Model executed successfully.*?in ([0-9.]+) ms',log);iterations=re.findall(r'Iteration [0-9]+ of [0-9]+: ([0-9.]+) ms',log);loads=re.findall(r'Model loaded in ([0-9.]+) ms',log)
   row={'count':count,'wall_seconds':elapsed,'reported_total_execute_ms':float(total[-1]) if total else None,'reported_iteration_ms':[float(x) for x in iterations],'reported_load_ms':float(loads[-1]) if loads else None,'max_delta_vs_one_execution':error,'output_sha256':hashlib.sha256(actual.tobytes()).hexdigest(),'self_max_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'child_max_rss_kib':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss};case['runs'].append(row);output.unlink();(art/'result.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'phase':'run','model':name,'side':side,**row}),flush=True)
  path.unlink()
 r['passed']=True
finally:(art/'result.json').write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps({'passed':r['passed']}),flush=True)
