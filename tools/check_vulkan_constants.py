"""Ensure a contiguous slice with a nonzero offset serializes its own values."""
import torch
from vulkan_constant_workaround import materialize_constant

base = torch.arange(60, dtype=torch.float32).reshape(3, 4, 5)
for tensor in [base, base[1], base[:1], base[:, :, 1:3], base.transpose(1, 2)]:
    actual = materialize_constant(tensor)
    torch.testing.assert_close(actual, tensor)
    assert actual.is_contiguous() and actual.storage_offset() == 0
    assert actual.untyped_storage().nbytes() == actual.numel() * actual.element_size()
assert materialize_constant(base) is base
print("Vulkan constant storage checks passed")
