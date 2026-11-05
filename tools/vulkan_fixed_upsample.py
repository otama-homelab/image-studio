"""Opt in only fixed 2x, align_corners=False bilinear to existing resize code.

Upsample.cpp retains a constant reciprocal scale of 0.5 for this form. Dynamic
explicit output sizes and align_corners=True need different validation and stay
excluded. This registration is scoped to experimental export, not global setup.
"""
from contextlib import contextmanager
from copy import copy
from unittest.mock import patch


def fixed_double_bilinear(node):
    args = node.args
    return (len(args) == 4 and args[1] is None and args[2] is False
            and isinstance(args[3], (tuple, list))
            and all(type(value) in (int, float) for value in args[3])
            and tuple(args[3]) == (2.0, 2.0))


@contextmanager
def fixed_double_bilinear_resize():
    from executorch.backends.vulkan.op_registry import vulkan_supported_ops
    from executorch.exir.dialects._ops import ops
    key = ops.edge.aten.upsample_bilinear2d.vec
    original = vulkan_supported_ops[key]
    feature = copy(original)
    statistics = {'eligible_checks': 0, 'rejected_checks': 0}

    def supported(node):
        if not fixed_double_bilinear(node):
            statistics['rejected_checks'] += 1
            return False
        statistics['eligible_checks'] += 1
        return original.are_node_inputs_supported_fn(node)

    feature.supports_resize = True
    feature.are_node_inputs_supported_fn = supported
    with patch.dict(vulkan_supported_ops, {key: feature}):
        yield statistics
