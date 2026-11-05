"""Equivalent ViTDet self-attention helpers with exportable spatial arithmetic.

Keep interpolation in the graph even at its identity size, avoid Python int()
specializing positional coordinates, and express window padding with one shared
ceil division so symbolic reshape equality is visible to the exporter.
"""
from contextlib import contextmanager, ExitStack
from unittest.mock import patch
import math
from types import MethodType
import torch
import torch.nn.functional as F


def absolute_positions(self, positions, has_cls_token, height, width):
    if has_cls_token:
        positions = positions[:, 1:]
    size = math.isqrt(positions.shape[1])
    if size * size != positions.shape[1]:
        raise ValueError("Absolute position embeddings must be square")
    # Portable CPU index kernels in the bicubic decomposition require NCHW.
    result = F.interpolate(positions.reshape(1, size, size, -1).permute(0, 3, 1, 2).contiguous(),
                           size=(height, width), mode="bicubic", align_corners=False)
    return result.permute(0, 2, 3, 1)


def _relative_position_tables(q_size, k_size, positions):
    if q_size != k_size:
        raise ValueError("This export helper is limited to ViTMatte self-attention")
    distance = 2 * q_size - 1
    resized = F.interpolate(positions.reshape(1, positions.shape[0], -1).permute(0, 2, 1).contiguous(),
                            size=distance, mode="linear", align_corners=False)
    resized = resized.reshape(-1, distance).permute(1, 0).contiguous()
    coordinates = torch.arange(q_size, device=positions.device)
    indices = coordinates[:, None] - coordinates[None, :] + q_size - 1
    return resized, indices


def relative_positions(q_size, k_size, positions):
    resized, indices = _relative_position_tables(q_size, k_size, positions)
    return resized[indices]


def relative_positions_flat(q_size, k_size, positions):
    """Use the supported 1-D gather without changing values or precision."""
    resized, indices = _relative_position_tables(q_size, k_size, positions)
    return resized[indices.reshape(-1)].reshape(q_size, k_size, resized.shape[-1])


def partition_windows(hidden, window_size):
    batch, height, width, channels = hidden.shape
    rows = (height + window_size - 1) // window_size
    columns = (width + window_size - 1) // window_size
    padded_height, padded_width = rows * window_size, columns * window_size
    hidden = F.pad(hidden, (0, 0, 0, padded_width - width, 0, padded_height - height))
    hidden = hidden.view(batch, rows, window_size, columns, window_size, channels)
    windows = hidden.permute(0, 1, 3, 2, 4, 5).contiguous().view(
        -1, window_size, window_size, channels)
    return windows, (padded_height, padded_width)


@contextmanager
def exportable_vitmatte(split_attention_heads=False, model=None, flatten_relative_indices=False):
    from transformers.models.vitdet import modeling_vitdet as vitdet
    with patch.object(vitdet.VitDetEmbeddings, "get_absolute_positions", absolute_positions), \
            patch.object(vitdet, "get_rel_pos", relative_positions_flat if flatten_relative_indices else relative_positions), \
            patch.object(vitdet, "window_partition", partition_windows):
        with ExitStack() as stack:
            if split_attention_heads:
                if model is None:
                    raise ValueError("Head splitting requires the model to identify global layers")
                for layer in model.modules():
                    if isinstance(layer, vitdet.VitDetLayer) and layer.window_size == 0:
                        stack.enter_context(patch.object(
                            layer.attention, "forward", MethodType(headwise_attention, layer.attention)))
            yield


def headwise_attention(self, hidden_state, output_attentions=False):
    """Compute independent heads separately, preserving relative position terms.

    A 2048px global attention map across all 12 heads exceeds a single Vulkan
    buffer's range. Each head has the same attention equation and learned
    parameters; separating heads reduces individual intermediate allocations.
    """
    from transformers.models.vitdet.modeling_vitdet import add_decomposed_relative_positions
    batch, height, width, _ = hidden_state.shape
    qkv = self.qkv(hidden_state).reshape(
        batch, height * width, 3, self.num_heads, -1).permute(2, 0, 3, 1, 4)
    queries, keys, values = qkv.unbind(0)
    heads, probabilities = [], []
    for head in range(self.num_heads):
        query = queries[:, head].contiguous()
        key = keys[:, head].contiguous()
        value = values[:, head].contiguous()
        scores = (query * self.scale) @ key.transpose(-2, -1)
        if self.use_relative_position_embeddings:
            scores = add_decomposed_relative_positions(
                scores, query, self.rel_pos_h, self.rel_pos_w,
                (height, width), (height, width))
        probability = scores.softmax(dim=-1)
        heads.append(probability @ value)
        if output_attentions:
            probabilities.append(probability)
    hidden_state = torch.stack(heads, dim=1).reshape(
        batch, self.num_heads, height, width, -1).permute(0, 2, 3, 1, 4)
    hidden_state = self.proj(hidden_state.reshape(batch, height, width, -1))
    return ((hidden_state, torch.stack(probabilities, dim=1))
            if output_attentions else (hidden_state,))
