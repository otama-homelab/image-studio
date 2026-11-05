#!/usr/bin/env python3
"""Check the export registration is narrow and restores upstream defaults."""
from types import SimpleNamespace
from vulkan_fixed_upsample import fixed_double_bilinear, fixed_double_bilinear_resize
from executorch.backends.vulkan.op_registry import vulkan_supported_ops
from executorch.exir.dialects._ops import ops
key=ops.edge.aten.upsample_bilinear2d.vec
original=vulkan_supported_ops[key]
node=lambda args:SimpleNamespace(args=args)
assert fixed_double_bilinear(node(('tensor',None,False,[2.0,2.0])))
for args in [('tensor',[32,32],False,None),('tensor',None,True,[2.,2.]),
             ('tensor',None,False,[1.5,2.]),('tensor',None,False,[2.]),
             ('tensor',None,False,None)]:
 assert not fixed_double_bilinear(node(args))
with fixed_double_bilinear_resize() as stats:
 feature=vulkan_supported_ops[key]
 assert feature is not original and feature.supports_resize
 assert feature.are_node_inputs_supported_fn(node(('tensor',None,False,[2.,2.])))
 assert not feature.are_node_inputs_supported_fn(node(('tensor',None,True,[2.,2.])))
 assert stats=={'eligible_checks':1,'rejected_checks':1}
assert vulkan_supported_ops[key] is original and not original.supports_resize
print('Fixed bilinear registration: narrow eligibility and scoped restoration passed')
