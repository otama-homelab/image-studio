"""Preserve exact integer division correlations when bounding Vulkan shapes.

Only cancel a FloorDiv if polynomial division is exact over integers and the
constrained divisor cannot be zero. All other bounds retain upstream behavior.
This changes compiler allocation metadata, never GPU checks or model arithmetic.
"""
from contextlib import contextmanager
from unittest.mock import patch
import sympy
import torch
from torch.utils._sympy.functions import FloorDiv
from torch.utils._sympy.value_ranges import bound_sympy


def simplify_exact_divisions(expr, ranges):
    result = expr
    for part in sympy.postorder_traversal(expr):
        if not isinstance(part, FloorDiv):
            continue
        numerator, denominator = part.args
        try:
            divisor_range = bound_sympy(denominator, ranges)
            if not (divisor_range.lower > 0 or divisor_range.upper < 0):
                continue
            quotient = sympy.cancel(numerator / denominator)
            symbols = sorted(quotient.free_symbols, key=str)
            if any(symbol.is_integer is not True for symbol in symbols):
                continue
            if symbols:
                sympy.Poly(quotient, *symbols, domain=sympy.ZZ)
            elif quotient.is_Integer is not True:
                continue
            if sympy.expand(numerator - denominator * quotient) != 0:
                continue
        except (ValueError, TypeError, KeyError, sympy.polys.polyerrors.BasePolynomialError):
            continue
        result = result.subs(part, quotient)
    return result


@contextmanager
def exact_integer_shape_bounds():
    import executorch.exir.sym_util as util
    import executorch.exir.passes.sym_shape_eval_pass as shape_pass
    original = util.eval_upper_bound
    statistics = {'simplified_bound_calls': 0, 'expressions': {}}

    def evaluate(value):
        if not isinstance(value, torch.SymInt):
            return original(value)
        expr = value.node.expr
        ranges = value.node.shape_env.var_to_range
        simplified = simplify_exact_divisions(expr, ranges)
        if simplified == expr:
            return original(value)
        upper = bound_sympy(simplified, ranges).upper
        if not isinstance(upper, sympy.Integer):
            return original(value)
        statistics['simplified_bound_calls'] += 1
        statistics['expressions'][str(expr)] = str(simplified)
        return int(upper)

    with patch.object(util, 'eval_upper_bound', evaluate), \
            patch.object(shape_pass, 'eval_upper_bound', evaluate):
        yield statistics
