"""Scoped workaround for mixed FakeTensor modes in static ExecuTorch graphs.

There are no range constraints to update if *every* tensor size, stride and
offset, and every scalar value is concrete. Symbolic graphs always retain the
upstream implementation and its checks. This changes compiler metadata only,
not operators or weights; runtime numerical validation is still required.
"""
from contextlib import contextmanager
from unittest.mock import patch
import torch
from torch.utils._pytree import tree_leaves


@contextmanager
def concrete_range_constraints():
    import executorch.exir.pass_manager as manager

    original = manager._get_updated_range_constraints
    statistics = {"static_graph_checks": 0, "symbolic_graph_checks": 0}

    def update(graph_module):
        values = [node.meta.get("val") for node in graph_module.graph.nodes]
        for value in tree_leaves(values):
            if isinstance(value, (torch.SymInt, torch.SymFloat, torch.SymBool)):
                statistics["symbolic_graph_checks"] += 1
                return original(graph_module)
            if isinstance(value, torch.Tensor):
                dimensions = (*value.shape, *value.stride(), value.storage_offset())
                if any(isinstance(dim, torch.SymInt) for dim in dimensions):
                    statistics["symbolic_graph_checks"] += 1
                    return original(graph_module)
        statistics["static_graph_checks"] += 1
        return {}

    with patch.object(manager, "_get_updated_range_constraints", update):
        yield statistics
