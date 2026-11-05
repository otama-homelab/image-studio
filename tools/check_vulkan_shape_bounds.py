#!/usr/bin/env python3
"""Exercise correlated-bound correction and reject unsafe cancellation cases."""
import sympy
from torch.utils._sympy.functions import FloorDiv
from torch.utils._sympy.value_ranges import ValueRanges, bound_sympy
from torch.fx.experimental.symbolic_shapes import ShapeEnv
from vulkan_shape_bound_workaround import simplify_exact_divisions, exact_integer_shape_bounds
import executorch.exir.sym_util as util
import executorch.exir.passes.sym_shape_eval_pass as shape_pass

s=sympy.Symbol('s', integer=True);ranges={s:ValueRanges(2,64)}
expr=FloorDiv(2*s**2,s);simplified=simplify_exact_divisions(expr,ranges)
assert simplified==2*s
assert bound_sympy(expr,ranges).upper==4096
assert bound_sympy(simplified,ranges).upper==128
for value in range(2,65):assert expr.subs(s,value)==simplified.subs(s,value)
for expression,domain in [(expr,{s:ValueRanges(-2,2)}),
                           (FloorDiv(s+1,s),ranges),
                           (FloorDiv(s,2),ranges)]:
 assert simplify_exact_divisions(expression,domain)==expression
negative={s:ValueRanges(-64,-2)}
assert simplify_exact_divisions(expr,negative)==2*s
shape_env=ShapeEnv();shape_env.var_to_range[s]=ranges[s]
value=shape_env.create_symintnode(expr,hint=64)
original=util.eval_upper_bound;assert original(value)==4096
with exact_integer_shape_bounds() as stats:
 assert util.eval_upper_bound(value)==128
 assert shape_pass.eval_upper_bound(value)==128
 assert util.eval_upper_bound(64)==64
 assert stats['simplified_bound_calls']==2
assert util.eval_upper_bound is original and original(value)==4096
print('Exact integer shape bounds: correlated expression, full integer domain, unsafe cases, scoped restoration passed')
