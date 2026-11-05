"""Replace provably shape-preserving expand_copy with contiguous clone.

Vulkan clone supports dynamic shapes; expand_copy does not. Preserve copy and
layout semantics, and leave real broadcasting or unprovable shapes unchanged.
"""
import torch
from torch.fx import Node
from torch.fx.experimental.symbolic_shapes import statically_known_true
from executorch.exir.pass_base import PassBase, PassResult
from executorch.exir.dialects._ops import ops


class IdentityExpandAsClone(PassBase):
    def __init__(self):
        super().__init__()
        self.statistics = {'replaced': 0, 'preserved': 0}

    def call(self, graph_module):
        modified = False
        for node in graph_module.graph.nodes:
            if node.target != ops.edge.aten.expand_copy.default:
                continue
            value = node.args[0].meta.get('val')
            sizes = node.args[1]
            if not isinstance(value, torch.Tensor) or len(value.shape) != len(sizes):
                self.statistics['preserved'] += 1
                continue
            identical = True
            for actual, wanted in zip(value.shape, sizes):
                if isinstance(wanted, Node):
                    wanted = wanted.meta.get('val')
                if isinstance(wanted, int) and wanted == -1:
                    continue
                if not isinstance(wanted, (int, torch.SymInt)):
                    identical = False
                    break
                try:
                    if not statically_known_true(actual == wanted):
                        identical = False
                        break
                except (AssertionError, RuntimeError):
                    identical = False
                    break
            if identical:
                node.target = ops.edge.dim_order_ops._clone_dim_order.default
                node.args = (node.args[0],)
                node.kwargs = {'dim_order': list(range(len(value.shape)))}
                self.statistics['replaced'] += 1
                modified = True
            else:
                self.statistics['preserved'] += 1
        if modified:
            graph_module.graph.lint()
            graph_module.recompile()
        return PassResult(graph_module, modified)
