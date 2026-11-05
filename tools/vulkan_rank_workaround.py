"""Keep operations touching rank > 4 tensors on portable CPU kernels.

The current Vulkan runtime's uniform-data path rejects higher ranks even when
some operators advertise support. Keep reshapes/permutations around windowed
attention on CPU until that path has separate runtime acceptance.
"""
from contextlib import contextmanager
from unittest.mock import patch
import torch
from torch.utils._pytree import tree_leaves


@contextmanager
def rank4_only():
    from executorch.backends.vulkan.partitioner.vulkan_partitioner import VulkanSupportedOperators
    original = VulkanSupportedOperators.is_node_supported
    statistics = {"rejected_high_rank_nodes": 0}

    def supported(self, submodules, node):
        values = [node.meta.get("val")]
        for argument in tree_leaves((node.args, node.kwargs)):
            if isinstance(argument, torch.fx.Node):
                values.append(argument.meta.get("val"))
        if any(isinstance(value, torch.Tensor) and value.ndim > 4
               for value in tree_leaves(values)):
            statistics["rejected_high_rank_nodes"] += 1
            return False
        return original(self, submodules, node)

    with patch.object(VulkanSupportedOperators, "is_node_supported", supported):
        yield statistics
