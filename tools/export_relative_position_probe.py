#!/usr/bin/env python3
"""Compare CPU-bound 2-D indexing to equivalent supported 1-D Vulkan gather."""
import argparse,pathlib,json,hashlib
import torch
from executorch.exir import to_edge_transform_and_lower
from executorch.backends.vulkan.partitioner.vulkan_partitioner import VulkanPartitioner
from vitmatte_export_helpers import relative_positions,relative_positions_flat
from static_range_workaround import concrete_range_constraints
from vulkan_constant_workaround import owned_constant_storage
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args();assert not a.output.exists();a.output.mkdir();torch.set_num_threads(2);torch.manual_seed(1906);positions=torch.randn(27,64);report={'scope':'Dynamic equivalent relative-position helper only; not full ViTMatte acceptance','models':{},'cases':[],'skip_delegate_internal_memory_planning':True}
class Probe(torch.nn.Module):
 def __init__(self,flat):super().__init__();self.flat=flat
 def forward(self,x):
  q=x.shape[2]-27;f=relative_positions_flat if self.flat else relative_positions
  return f(q,q,x[0,0,:27,:])
q=torch.export.Dim('side',min=2,max=128)
for name,flat in [('flat',True)]:
 with torch.no_grad():
  ep=torch.export.export(Probe(flat).eval(),(torch.zeros(1,1,59,64),),dynamic_shapes=({2:q+27},))
  with concrete_range_constraints(),owned_constant_storage():lower=to_edge_transform_and_lower(ep,partitioner=[VulkanPartitioner({'require_dynamic_shapes':True,'texture_limits':(8192,8192,8192),'skip_memory_planning':True})])
  program=lower.to_executorch();artifact=a.output/(name+'.pte')
  with artifact.open('wb') as f:program.write_to_file(f)
  g=lower.exported_program().graph;remaining=[str(n.target) for n in g.nodes if n.op=='call_function' and 'executorch_call_delegate' not in str(n.target)];report['models'][name]={'sha256':hashlib.file_digest(artifact.open('rb'),'sha256').hexdigest(),'remaining_operators':remaining,'cpu_buffer_sizes':[m.non_const_buffer_sizes for m in program.executorch_program.execution_plan]}
for side in [2,14,32,126,128]:
 x=torch.randn(1,1,side+27,64);x[0,0,:27,:]=positions;expected=Probe(False)(x);actual=Probe(True)(x);torch.testing.assert_close(actual,expected,atol=0,rtol=0);x.numpy().tofile(a.output/('input-'+str(side)+'.bin'));expected.detach().numpy().tofile(a.output/('expected-'+str(side)+'.bin'));report['cases'].append({'side':side,'input_shape':list(x.shape),'output_shape':list(expected.shape),'cpu_bit_identical':True})
(a.output/'metadata.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
