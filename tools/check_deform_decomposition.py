"""Compare the proposed Vulkan-compatible math against torchvision on CPU."""
import json
import torch
from torchvision.ops import deform_conv2d as reference
from vulkan_decompositions import deform_conv2d

torch.set_num_threads(4)
torch.manual_seed(1906)
results = []
for kernel, stride, padding, dilation in [(1, 1, 0, 1), (3, 1, 1, 1),
                                          (3, 2, 2, 2), (5, 1, 2, 1)]:
    x = torch.randn(2, 3, 13, 17)
    w = torch.randn(4, 3, kernel, kernel)
    h = (13 + 2 * padding - dilation * (kernel - 1) - 1) // stride + 1
    width = (17 + 2 * padding - dilation * (kernel - 1) - 1) // stride + 1
    # Large offsets exercise pixels outside every image border.
    offsets = torch.randn(2, 2 * kernel * kernel, h, width) * 10
    mask = torch.rand(2, kernel * kernel, h, width) * 2
    for use_mask in (False, True):
        for use_bias in (False, True):
            bias = torch.randn(4) if use_bias else None
            expected = reference(x, offsets, w, bias, stride=stride,
                                 padding=padding, dilation=dilation,
                                 mask=mask if use_mask else None)
            actual = deform_conv2d(x, w, offsets, mask,
                                   bias if bias is not None else torch.empty(0),
                                   stride, stride, padding, padding, dilation,
                                   dilation, 1, 1, use_mask)
            torch.testing.assert_close(actual, expected, atol=5e-5, rtol=5e-5)
            results.append({"kernel": kernel, "stride": stride, "dilation": dilation,
                            "mask": use_mask, "bias": use_bias,
                            "max_abs_error": (actual - expected).abs().max().item()})
print(json.dumps({"passed": True, "cases": results}, indent=2))
