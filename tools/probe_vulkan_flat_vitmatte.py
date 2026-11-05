#!/usr/bin/env python3
"""Compare the separate FP32 flat-index ViTMatte candidate at accepted shapes."""
import os,pathlib,sys,json,hashlib,time,subprocess,re
os.environ['MESA_SHADER_CACHE_DISABLE']='false';os.environ['MESA_SHADER_CACHE_DIR']='/work/cache';os.environ['MESA_SHADER_CACHE_MAX_SIZE']='128M';os.environ['HF_HUB_OFFLINE']='1';os.sched_setaffinity(0,set(sorted(os.sched_getaffinity(0))[:2]));sys.path.insert(0,'/app')
import torch,numpy as np
from PIL import Image
from transformers import VitMatteImageProcessor
from image_studio_executorch import load_configuration
torch.set_num_threads(2);assert os.getuid()==1000 and 990 in os.getgroups() and not pathlib.Path('/dev/kfd').exists();root=pathlib.Path('/work');out=root/'outputs';out.mkdir(exist_ok=False);runner,models=load_configuration();candidate=root/'candidate/vitmatte.pte';meta=json.loads((root/'candidate/vitmatte.json').read_text());sha=lambda p:hashlib.file_digest(p.open('rb'),'sha256').hexdigest();assert meta['flatten_relative_indices'] and not meta['force_fp16'] and meta['artifact_sha256']==sha(candidate)
image=Image.open('/reference/input.png').convert('RGB');processor=VitMatteImageProcessor.from_pretrained('hustvl/vitmatte-base-distinctions-646',revision='b58373f8dbbfbeb58157456e2e4949f9f872aa18');r={'passed':False,'scope':'FP32 full ViTMatte numerical regression and diagnostic one-shot timing; no full application acceptance','candidate_report':meta,'baseline_sha256':sha(models['vitmatte']),'runner_sha256':sha(runner),'cases':[]}
try:
 for height,width in [(1024,32),(256,512),(512,256),(512,512),(1024,512),(2016,2016)]:
  rgb=image.resize((width,height),Image.Resampling.LANCZOS);trimap=np.full((height,width),128,dtype=np.uint8);band=max(1,height//16);trimap[:band,:]=0;trimap[-band:,:]=255;value=processor(images=rgb,trimaps=Image.fromarray(trimap),return_tensors='pt',do_resize=False)['pixel_values'].numpy();assert list(value.shape)==[1,4,height,width];source=root/'input.bin';value.tofile(source);case={'shape':list(value.shape),'input_sha256':sha(source),'runs':[]};r['cases'].append(case);reference=None
  for kind,model in [('baseline',models['vitmatte']),('candidate',candidate)]:
   base=root/(kind+'-alpha');cmd=[str(runner),'--model_path='+str(model),'--inputs='+str(source),'--output_file='+str(base),'--input_shape='+','.join(str(x) for x in value.shape),'--cpu_threads=2','--print_output=none'];start=time.monotonic();p=subprocess.run(cmd,capture_output=True,text=True,timeout=210);log=p.stdout+p.stderr;(out/(str(height)+'x'+str(width)+'-'+kind+'.log')).write_text(log);row={'kind':kind,'exit_code':p.returncode,'wall_seconds':time.monotonic()-start,'execute_ms':[float(x) for x in re.findall(r'Iteration [0-9]+ of [0-9]+: ([0-9.]+) ms',log)]};case['runs'].append(row);assert p.returncode==0,log[-3000:];file=pathlib.Path(str(base)+'-0.bin');actual=np.fromfile(file,dtype=np.float32);assert actual.size==height*width and np.isfinite(actual).all();row['output_sha256']=hashlib.sha256(actual.tobytes()).hexdigest()
   if reference is None:reference=actual.copy()
   else:
    d=np.abs(actual-reference);case.update(max_abs_error=float(d.max()),mean_abs_error=float(d.mean()),outside_float_tolerance=int((d>5e-5+5e-5*np.abs(reference)).sum()),passed=bool(np.allclose(actual,reference,atol=5e-5,rtol=5e-5)));assert case['passed']
   file.unlink();(out/'result.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'shape':list(value.shape),**row}),flush=True)
  source.unlink()
 r['passed']=True
finally:(out/'result.json').write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps({'passed':r['passed']}),flush=True)
