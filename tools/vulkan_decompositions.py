"""Exact inference decomposition for BiRefNet's ungrouped deformable convolution.

Vulkan's grid sampler supports border padding and align_corners=True. A one-pixel
zero border converts that operation to torchvision's zero-padded sampling,
including offsets outside the image. No learned offsets or masks are discarded.
"""
import torch
import torch.nn.functional as F


def deform_conv2d(input, weight, offset, mask, bias, stride_h, stride_w,
                  pad_h, pad_w, dilation_h, dilation_w, groups, offset_groups,
                  use_mask):
    if groups != 1 or offset_groups != 1:
        raise ValueError("Only BiRefNet's single-group deformable convolution is supported")
    _, _, height, width = input.shape
    out_height, out_width = offset.shape[-2:]
    kernel_h, kernel_w = weight.shape[-2:]
    padded = F.pad(input, (1, 1, 1, 1))
    yy = torch.arange(out_height, device=input.device, dtype=input.dtype).view(1, out_height, 1)
    xx = torch.arange(out_width, device=input.device, dtype=input.dtype).view(1, 1, out_width)
    result = None
    for ky in range(kernel_h):
        for kx in range(kernel_w):
            k = ky * kernel_w + kx
            y = yy * stride_h - pad_h + ky * dilation_h + offset[:, 2 * k]
            x = xx * stride_w - pad_w + kx * dilation_w + offset[:, 2 * k + 1]
            grid = torch.stack((2 * (x + 1) / (width + 1) - 1,
                                2 * (y + 1) / (height + 1) - 1), dim=-1)
            sampled = F.grid_sample(padded, grid, mode="bilinear",
                                    padding_mode="border", align_corners=True)
            if use_mask:
                sampled = sampled * mask[:, k:k + 1]
            # Vulkan packs constant conv weights from contiguous storage. A
            # strided kernel view must be materialized before serialization.
            kernel = weight[:, :, ky:ky + 1, kx:kx + 1].contiguous()
            part = F.conv2d(sampled, kernel)
            result = part if result is None else result + part
    if bias.numel():
        result = result + bias.view(1, -1, 1, 1)
    return result
