import os,json,time,shutil,hashlib,runpy,sys,traceback
from pathlib import Path
import torch,numpy as np
from PIL import Image
sys.path.insert(0,'/app')
root=Path('/work');out=root/'artifacts';result={'scope':'Actual OCI image on Incus native-context; 512px and 2000px public skimage astronaut, actual container','passed':False,'harness_sha256':hashlib.file_digest(Path(__file__).open('rb'),'sha256').hexdigest()};started=time.monotonic()
try:
 torch.set_num_threads(2);assert torch.version.hip is None;assert not Path('/dev/kfd').exists()
 runpy.run_path('/app/prepare_models.py')
 import image_studio_executorch as engine
 real=engine.run_model;calls=[]
 def traced(name,tensor):
  start=time.monotonic();value=real(name,tensor);calls.append({'model':name,'input_shape':list(tensor.shape),'elapsed_seconds':time.monotonic()-start});(out/'inference-progress.json').write_text(json.dumps(calls));return value
 engine.run_model=traced;engine.load_configuration()
 from image_studio_backend import change_background
 from image_studio_ui import center_face,export_frame,print_layout
 Path('/tmp/photos/exports').mkdir(parents=True,exist_ok=True)
 rgb=Image.open(out/'astronaut.png').convert('RGB');original=np.array(rgb);outputs=[]
 for refine in (False,True):
  paths=change_background(original,'#8EC5FF',refine);background=Image.open(paths[0]);rgba=np.array(Image.open(paths[2]).convert('RGBA'));alpha=rgba[:,:,3];opaque=alpha==255
  assert rgba.shape==(512,512,4) and opaque.any() and (alpha==0).any()
  assert np.array_equal(rgba[:,:,:3][opaque],original[opaque])
  tag='refine-'+str(refine).lower();shutil.copyfile(paths[0],out/(tag+'-background.png'));shutil.copyfile(paths[2],out/(tag+'-transparent.png'))
  outputs.append({'refine':refine,'opaque_pixels':int(opaque.sum()),'transparent_pixels':int((alpha==0).sum()),'partial_pixels':int(((alpha>0)&(alpha<255)).sum())})
 assert any(c['model']=='vitmatte' and c['input_shape']==[1,4,512,512] for c in calls),'Refinement forward was not exercised'
 preset='履歴書・在留カード（30×40mm）';geometry=center_face(rgb,preset,30,40)
 assert all(np.isfinite(v) and 0<=v<=100 for v in geometry)
 cropped,path,_=export_frame(background,preset,30,40,*geometry);assert cropped.size==(354,472)
 shutil.copyfile(path,out/'cropped-300dpi.png');assert all(abs(x-300)<.1 for x in Image.open(path).info['dpi'])
 png,_,pdf,note=print_layout(Image.open(path),'A4（210×297mm）');assert Image.open(png).size==(2480,3508);assert Path(pdf).read_bytes().startswith(b'%PDF-')
 shutil.copyfile(png,out/'print-layout-300dpi.png');shutil.copyfile(pdf,out/'print-layout.pdf')
 large_input=Path('/reference/input.png')
 assert hashlib.file_digest(large_input.open('rb'),'sha256').hexdigest()=='239ab43acf4fd99e2a1910894cc2c6d1d5ac86509a74fdb63ac440d1b880959d'
 large_rgb=Image.open(large_input).convert('RGB');large_original=np.array(large_rgb)
 large_paths=change_background(large_original,'#8EC5FF',True)
 large_rgba=np.array(Image.open(large_paths[2]).convert('RGBA'));gold=np.array(Image.open('/reference/transparent.png').convert('RGBA'))
 assert large_rgba.shape==gold.shape==(2000,2000,4)
 large_alpha=large_rgba[:,:,3];large_opaque=large_alpha==255
 assert large_opaque.any() and (large_alpha==0).any()
 assert np.array_equal(large_rgba[:,:,:3][large_opaque],large_original[large_opaque])
 assert any(c['model']=='vitmatte' and c['input_shape']==[1,4,2016,2016] for c in calls),'Maximum-size refinement forward was not exercised'
 delta=np.abs(large_alpha.astype(np.int16)-gold[:,:,3].astype(np.int16))
 bg=np.array(Image.open(large_paths[0]).convert('RGB'));gold_bg=np.array(Image.open('/reference/background.png').convert('RGB'))
 bg_delta=np.abs(bg.astype(np.int16)-gold_bg.astype(np.int16))
 shutil.copyfile(large_paths[0],out/'large-background.png');shutil.copyfile(large_paths[2],out/'large-transparent.png')
 result['large_photo']={'input_sha256':hashlib.file_digest(large_input.open('rb'),'sha256').hexdigest(),'shape':list(large_rgba.shape),'max_alpha8_delta':int(delta.max()),'mean_alpha8_delta':float(delta.mean()),'alpha8_pixels_over_1_level':int((delta>1).sum()),'background_max_delta':int(bg_delta.max()),'background_mean_delta':float(bg_delta.mean()),'opaque_pixels':int(large_opaque.sum()),'opaque_rgb_preserved':True,'maximum_refinement_forward_exercised':True}
 result['calls']=calls
 assert int(delta.max())<=1,'Large-photo alpha differs by more than one 8bit level from ROCm FP32'
 assert int(bg_delta.max())<=1,'Large-photo background differs by more than one 8bit level from ROCm FP32'
 result.update(passed=True,backend=os.environ['IMAGE_STUDIO_BACKEND'],torch=torch.__version__,calls=calls,outputs=outputs,face_geometry=list(geometry),crop_size=list(cropped.size),print_size=[2480,3508],print_note=note)
except Exception as exc:result.update(error=str(exc),traceback=traceback.format_exc())
result['elapsed_seconds']=time.monotonic()-started;(out/'functional-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
if not result['passed']:sys.exit(1)
