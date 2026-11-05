#!/usr/bin/env python3
"""Matched offline application timing; keep cold/shape-first and warm samples distinct."""
import argparse,hashlib,json,os,pathlib,resource,shutil,signal,sys,time
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--backend',choices=['rocm','executorch-vulkan'],required=True);p.add_argument('--precision',choices=['fp16','fp32'],required=True);p.add_argument('--input',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);p.add_argument('--repeats',type=int,default=3);p.add_argument('--vulkan-shader-cache',choices=['enabled','disabled'],default='enabled');a=p.parse_args();assert 2<=a.repeats<=5
assert not a.output.exists();a.output.mkdir(parents=True)
os.environ['IMAGE_STUDIO_BACKEND']=a.backend;os.environ['HF_HUB_OFFLINE']='1';os.environ['OMP_NUM_THREADS']='2';os.environ['MESA_SHADER_CACHE_DISABLE']='true' if a.vulkan_shader_cache=='disabled' else 'false'
os.environ['MESA_SHADER_CACHE_DIR']=str(a.output.parent/'mesa-shader-cache');os.environ['MESA_SHADER_CACHE_MAX_SIZE']='128M'
affinity=sorted(os.sched_getaffinity(0));assert len(affinity)>=2;os.sched_setaffinity(0,set(affinity[:2]));signal.alarm(600);sys.path.insert(0,'/app')
import numpy as np,torch
from PIL import Image
import image_studio_gpu as gpu
from image_studio_backend import change_background
torch.set_num_threads(2)
if a.backend=='rocm':
 assert torch.version.hip and torch.cuda.is_available();assert torch.cuda.mem_get_info()[0]>45*1024**3
 repository,revision,size,_=gpu.MODELS[gpu.MODEL_NAME];gpu.MODELS[gpu.MODEL_NAME]=(repository,revision,size,torch.float32 if a.precision=='fp32' else torch.float16)
else:assert a.precision=='fp32' and torch.version.hip is None and not pathlib.Path('/dev/kfd').exists()
sha=lambda path:hashlib.file_digest(path.open('rb'),'sha256').hexdigest()
assert sha(a.input)=='239ab43acf4fd99e2a1910894cc2c6d1d5ac86509a74fdb63ac440d1b880959d'
image=Image.open(a.input).convert('RGB');pathlib.Path('/tmp/photos/exports').mkdir(parents=True,exist_ok=True)
r={'passed':False,'backend':a.backend,'precision':a.precision,'input_sha256':sha(a.input),'cpu_affinity':sorted(os.sched_getaffinity(0)),'torch_threads':torch.get_num_threads(),'torch':torch.__version__,'hip':torch.version.hip,'module_sha256':{x.name:sha(x) for x in pathlib.Path('/app').glob('image_studio_*.py')},'cases':[],'timing_scope':'change_background including preprocessing, inference, refinement when selected, rembg foreground recovery, composition, PNG writes; imports excluded','cache_policy':'Model cache retained per implementation; no OS page-cache flush; Vulkan shader disk cache mode recorded separately; runner subprocess remains per-call','limitations':['Different backend implementations and dependency builds; compare application alternatives, not isolated virtualization overhead','First sample of each case differs from subsequent warm samples; only first case is fully process/model cold','CPU affinity count matched at two; CPU placement and guest/host scheduler differ']}
r['vulkan_shader_cache']=a.vulkan_shader_cache if a.backend=='executorch-vulkan' else 'not-applicable'
r['birefnet_precision']=a.precision;r['vitmatte_precision']='fp32'
def usage():
 x=resource.getrusage(resource.RUSAGE_SELF);y=resource.getrusage(resource.RUSAGE_CHILDREN);return x.ru_utime+x.ru_stime+y.ru_utime+y.ru_stime
try:
 for side,refine in [(512,False),(512,True),(2000,True)]:
  rgb=image.resize((side,side),Image.Resampling.LANCZOS) if side!=2000 else image;original=np.asarray(rgb);case={'side':side,'refine':refine,'samples':[]};r['cases'].append(case)
  for iteration in range(a.repeats):
   before=usage();start=time.monotonic();paths=change_background(original,'#8EC5FF',refine);elapsed=time.monotonic()-start
   alpha=np.array(Image.open(paths[2]).convert('RGBA'));assert alpha.shape==(side,side,4);assert (alpha[:,:,3]==255).any() and (alpha[:,:,3]==0).any();assert np.array_equal(alpha[:,:,:3][alpha[:,:,3]==255],original[alpha[:,:,3]==255])
   case['samples'].append({'iteration':iteration,'elapsed_seconds':elapsed,'cpu_seconds_self_and_children':usage()-before,'self_max_rss_kib':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'child_max_rss_kib':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,'alpha_sha256':hashlib.sha256(alpha[:,:,3].tobytes()).hexdigest()})
   if iteration==a.repeats-1:
    shutil.copyfile(paths[0],a.output/('s'+str(side)+'-refine'+str(refine)+'-background.png'));shutil.copyfile(paths[2],a.output/('s'+str(side)+'-refine'+str(refine)+'-transparent.png'))
   shutil.rmtree(pathlib.Path(paths[0]).parent)
   (a.output/'result.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'phase':'sample',**{'side':side,'refine':refine},**case['samples'][-1]}),flush=True)
 if a.backend=='rocm':r['torch_gpu_max_allocated_bytes']=torch.cuda.max_memory_allocated();r['torch_gpu_max_reserved_bytes']=torch.cuda.max_memory_reserved()
 r['passed']=True
finally:
 (a.output/'result.json').write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps({'passed':r['passed'],'result':str(a.output/'result.json')}),flush=True)
