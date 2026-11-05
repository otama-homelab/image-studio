"""Materialize tensor views before ExecuTorch Vulkan serializes their storage.

ExecuTorch 1.5.1's serializer reads untyped_storage().data_ptr(), which ignores
a view's storage_offset(). contiguous() alone can return an already-contiguous
view with a nonzero offset. Clone such views into exact, zero-offset storage.
"""
from contextlib import contextmanager
from unittest.mock import patch
import torch


def materialize_constant(tensor):
    if (tensor.storage_offset() != 0 or not tensor.is_contiguous()
            or tensor.untyped_storage().nbytes() != tensor.numel() * tensor.element_size()):
        return tensor.clone(memory_format=torch.contiguous_format)
    return tensor


@contextmanager
def owned_constant_storage():
    from executorch.backends.vulkan.serialization.vulkan_graph_builder import VkGraphBuilder
    original = VkGraphBuilder.get_param_tensor
    statistics = {"materialized_views": 0}

    def get_param_tensor(self, node):
        tensor = original(self, node)
        materialized = materialize_constant(tensor)
        if materialized is not tensor:
            statistics["materialized_views"] += 1
        return materialized

    with patch.object(VkGraphBuilder, "get_param_tensor", get_param_tensor):
        yield statistics
