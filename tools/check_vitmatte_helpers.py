"""Compare equivalent export helpers with unmodified Transformers helpers."""
import torch
from transformers.models.vitdet import modeling_vitdet as original
from vitmatte_export_helpers import absolute_positions, relative_positions, relative_positions_flat, partition_windows

torch.set_num_threads(2)
torch.manual_seed(1906)
for height, width in [(2, 4), (14, 28), (32, 32), (64, 2)]:
    positions = torch.randn(1, 32 * 32 + 1, 8)
    expected = original.VitDetEmbeddings.get_absolute_positions(None, positions, True, height, width)
    actual = absolute_positions(None, positions, True, height, width)
    torch.testing.assert_close(actual, expected, atol=1e-6, rtol=1e-6)
    relative = torch.randn(27, 8)
    torch.testing.assert_close(relative_positions(height, height, relative),
                               original.get_rel_pos(height, height, relative), atol=1e-6, rtol=1e-6)
    torch.testing.assert_close(relative_positions_flat(height, height, relative),
                               relative_positions(height, height, relative), atol=0, rtol=0)
    hidden = torch.randn(2, height, width, 5)
    actual, sizes = partition_windows(hidden, 14)
    expected, expected_sizes = original.window_partition(hidden, 14)
    assert sizes == expected_sizes
    torch.testing.assert_close(actual, expected, atol=0, rtol=0)
print("ViTMatte export helper equivalence checks passed")

for side in (2, 14, 32, 64, 126, 128):
    positions = torch.randn(27, 64)
    torch.testing.assert_close(relative_positions_flat(side, side, positions),
                               relative_positions(side, side, positions), atol=0, rtol=0)
print("Flat relative-position gather matches the original at small and maximum sizes")
