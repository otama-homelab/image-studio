"""Keep symbolic padding on CPU until Vulkan accepts dynamic integer lists."""
from contextlib import contextmanager
from unittest.mock import patch


@contextmanager
def cpu_dynamic_padding():
    from executorch.backends.vulkan.partitioner.vulkan_partitioner import VulkanSupportedOperators
    from executorch.exir.dialects._ops import ops
    original = VulkanSupportedOperators.is_node_supported
    statistics = {"dynamic_padding_cpu_nodes": 0}

    def supported(self, submodules, node):
        if node.target == ops.edge.aten.constant_pad_nd.default:
            padding = node.args[1]
            if not isinstance(padding, (list, tuple)) or any(type(value) is not int for value in padding):
                statistics["dynamic_padding_cpu_nodes"] += 1
                return False
        return original(self, submodules, node)

    with patch.object(VulkanSupportedOperators, "is_node_supported", supported):
        yield statistics
