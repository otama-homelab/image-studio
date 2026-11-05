#!/usr/bin/env python3
"""Export narrow dynamic 2x bilinear probes; GPU parity remains unvalidated."""
import argparse, pathlib, json, hashlib
import torch
from executorch.exir import to_edge_transform_and_lower
from executorch.backends.vulkan.partitioner.vulkan_partitioner import VulkanPartitioner
from vulkan_fixed_upsample import fixed_double_bilinear_resize
from static_range_workaround import concrete_range_constraints

p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=pathlib.Path,required=True);args=p.parse_args();assert not args.output.exists();args.output.mkdir();torch.set_num_threads(2)
class Probe(torch.nn.Module):
 def __init__(self,wide=False):super().__init__();self.wide=wide
 def forward(self,x):
  if self.wide:x=x.repeat(1,256,1,1)
  return torch.nn.functional.interpolate(x,scale_factor=2.0,mode='bilinear',align_corners=False)
r={'scope':'Fixed scale 2, align_corners=False only; not full ViTMatte acceptance','models':{},'cases':[]}
for name,channels,maximum,example in [('spatial',3,1008,32),('channels',768,126,14)]:
 h=torch.export.Dim(name+'_height',min=2,max=maximum);w=torch.export.Dim(name+'_width',min=2,max=maximum)
 with torch.no_grad():
  ep=torch.export.export(Probe(name=='channels').eval(),(torch.zeros(1,3,example,example),),dynamic_shapes=({2:h,3:w},))
  with concrete_range_constraints(),fixed_double_bilinear_resize() as stats:
   lower=to_edge_transform_and_lower(ep,partitioner=[VulkanPartitioner({'require_dynamic_shapes':True,'texture_limits':(8192,8192,8192)})])
  program=lower.to_executorch();artifact=args.output/(name+'.pte')
  with artifact.open('wb') as f:program.write_to_file(f)
  remaining=[str(n.target) for n in lower.exported_program().graph.nodes if n.op=='call_function' and 'executorch_call_delegate' not in str(n.target)]
  assert not any('upsample' in op for op in remaining),remaining
  r['models'][name]={'sha256':hashlib.file_digest(artifact.open('rb'),'sha256').hexdigest(),'channels':channels,'input_channels':3,'maximum_input_height_width':maximum,'remaining_operators':remaining,'registration':stats,'cpu_buffer_sizes':[m.non_const_buffer_sizes for m in program.executorch_program.execution_plan]}
 shapes=[(2,2),(14,32),(32,14),(126,126),(1008,32),(32,1008),(1008,1008)] if name=='spatial' else [(2,2),(14,32),(32,14),(126,126)]
 for height,width in shapes:r['cases'].append({'model':name,'input_shape':[1,3,height,width],'output_shape':[1,channels,height*2,width*2],'seed':190700+len(r['cases'])})
(args.output/'metadata.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2))
