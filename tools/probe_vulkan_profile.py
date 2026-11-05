#!/usr/bin/env python3
"""Check diagnostic-runner numerical parity before collecting per-shader ETDump."""
import os,pathlib,json,sys,subprocess,time,hashlib,re
os.environ['MESA_SHADER_CACHE_DISABLE']='false';os.environ['MESA_SHADER_CACHE_DIR']='/work/shader-cache';os.environ['MESA_SHADER_CACHE_MAX_SIZE']='128M';os.environ['HF_HUB_OFFLINE']='1';sys.path.insert(0,'/app');os.sched_setaffinity(0,set(sorted(os.sched_getaffinity(0))[:2]))
import torch,numpy as np
from PIL import Image
from torchvision import transforms
from transformers import VitMatteImageProcessor
from image_studio_executorch import load_configuration
assert os.getuid()==1000 and set(os.getgroups())=={990,1000} and not pathlib.Path('/dev/kfd').exists();torch.set_num_threads(2)
root=pathlib.Path('/work');out=root/'outputs';out.mkdir(exist_ok=False);release,models=load_configuration();profile=root/'profile-runner';metadata=json.loads((root/'profile-runner.json').read_text());sha=lambda p:hashlib.file_digest(p.open('rb'),'sha256').hexdigest();assert sha(profile)==metadata['sha256'];assert b'etdump_path' in profile.read_bytes()
image=Image.open('/reference/input.png').convert('RGB');processor=VitMatteImageProcessor.from_pretrained('hustvl/vitmatte-base-distinctions-646',revision='b58373f8dbbfbeb58157456e2e4949f9f872aa18');r={'passed':False,'scope':'Diagnostic profile runner parity and one-execution ETDump; component inputs not full app timings','release_sha256':sha(release),'profile_metadata':metadata,'cases':[]}
try:
 for name,side in [('birefnet',2048),('vitmatte',512),('vitmatte',2016)]:
  if name=='birefnet':value=transforms.Compose([transforms.Resize((2048,2048)),transforms.ToTensor(),transforms.Normalize([.485,.456,.406],[.229,.224,.225])])(image).unsqueeze(0).numpy()
  else:
   rgb=image.resize((side,side),Image.Resampling.LANCZOS);trimap=np.full((side,side),128,dtype=np.uint8);trimap[:16,:]=0;trimap[-16:,:]=255;value=processor(images=rgb,trimaps=Image.fromarray(trimap),return_tensors='pt',do_resize=False)['pixel_values'].numpy()
  source=root/'input.bin';value.tofile(source);case={'model':name,'shape':list(value.shape),'input_sha256':sha(source),'model_sha256':sha(models[name]),'runs':[]};r['cases'].append(case);reference=None
  for label,runner in [('release',release),('profile',profile)]:
   base=root/(name+'-'+str(side)+'-'+label);trace=out/(name+'-'+str(side)+'.etdp');cmd=[str(runner),'--model_path='+str(models[name]),'--inputs='+str(source),'--output_file='+str(base),'--num_executions=1','--cpu_threads=2','--print_output=none']
   if name=='vitmatte':cmd.append('--input_shape='+','.join(str(x) for x in value.shape))
   if label=='profile':cmd.append('--etdump_path='+str(trace))
   start=time.monotonic();p=subprocess.run(cmd,capture_output=True,text=True,timeout=210);wall=time.monotonic()-start;log=p.stdout+p.stderr;(out/(name+'-'+str(side)+'-'+label+'.log')).write_text(log);row={'kind':label,'exit_code':p.returncode,'wall_seconds':wall,'iteration_ms':[float(x) for x in re.findall(r'Iteration [0-9]+ of [0-9]+: ([0-9.]+) ms',log)]};case['runs'].append(row);assert p.returncode==0,log[-3000:]
   file=pathlib.Path(str(base)+'-0.bin');actual=np.fromfile(file,dtype=np.float32);assert actual.size==value.shape[2]*value.shape[3] and np.isfinite(actual).all();row['output_sha256']=hashlib.sha256(actual.tobytes()).hexdigest()
   if label=='release':reference=actual.copy()
   else:
    d=np.abs(actual-reference);case['max_abs_error']=float(d.max());case['outside_float_tolerance']=int((d>5e-5+5e-5*np.abs(reference)).sum());case['parity_passed']=bool(np.allclose(actual,reference,atol=5e-5,rtol=5e-5));assert case['parity_passed'];assert trace.is_file() and trace.stat().st_size>0;case['trace_file']=trace.name;case['trace_bytes']=trace.stat().st_size;case['trace_sha256']=sha(trace)
   file.unlink();(out/'result.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'model':name,'side':side,**row}),flush=True)
  source.unlink()
 r['passed']=True
finally:(out/'result.json').write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps({'passed':r['passed']}),flush=True)
