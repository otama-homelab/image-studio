"""Verify values, symbolic ranges, broadcasting and noncontiguous sources."""
import torch,json
from executorch.exir import to_edge
from executorch.exir.passes.cse_pass import CSEPass
from vulkan_identity_expand import IdentityExpandAsClone

torch.set_num_threads(2)
class Identity(torch.nn.Module):
 def forward(self,x):return x.expand(x.shape[0],x.shape[1]).sin()
class Broadcast(torch.nn.Module):
 def forward(self,x):return x.expand(4,x.shape[1]).sin()
class Noncontiguous(torch.nn.Module):
 def forward(self,x):return x.transpose(0,1).expand(x.shape[1],x.shape[0]).sin()
results=[]
for module,x,dynamic in [(Identity(),torch.randn(4,3),True),(Broadcast(),torch.randn(1,3),False),(Noncontiguous(),torch.randn(4,3),False)]:
 ep=torch.export.export(module,(x,),dynamic_shapes=({0:torch.export.Dim('batch',min=2,max=8)},) if dynamic else None)
 edge=to_edge(ep);before=str(edge.exported_program().range_constraints);p=IdentityExpandAsClone();edge=edge.transform([CSEPass(),p,CSEPass()]);after=str(edge.exported_program().range_constraints)
 assert before==after
 program=edge.exported_program().module()
 for value in ([torch.randn(n,3) for n in (2,4,8)] if dynamic else [x]):torch.testing.assert_close(program(value),module(value))
 results.append({'module':type(module).__name__,**p.statistics,'range_constraints_preserved':True})
assert results[0]['replaced']>0 and results[1]['preserved']>0 and results[2]['replaced']>0
print(json.dumps({'passed':True,'cases':results},indent=2))
