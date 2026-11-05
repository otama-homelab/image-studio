"""Check channel partitioning against PyTorch, including bias and edge groups."""
import json
import torch
from vulkan_convolution_workaround import wide_convolution_decomposition

torch.set_num_threads(2)
torch.manual_seed(1906)
cases = []
for channels, kernel, stride, dilation, groups, limit in [
    (12, 3, 1, 1, 1, 24), (12, 3, 2, 2, 1, 24),
    (5, 3, 1, 1, 1, 12), (16, 1, 1, 1, 1, 8),
    (16, 3, 1, 1, 2, 128),
]:
    for use_bias in (False, True):
        x = torch.randn(1, channels, 13, 17)
        weight = torch.randn(6, channels // groups, kernel, kernel)
        bias = torch.randn(6) if use_bias else None
        padding = dilation * (kernel // 2)
        split, stats = wide_convolution_decomposition(limit)
        expected = torch.nn.functional.conv2d(x, weight, bias, stride, padding,
                                               dilation, groups)
        actual = split(x, weight, bias, [stride, stride], [padding, padding],
                       [dilation, dilation], groups)
        torch.testing.assert_close(actual, expected, atol=2e-5, rtol=5e-5)
        cases.append(dict(channels=channels, kernel=kernel, stride=stride,
                          dilation=dilation, groups=groups, bias=use_bias,
                          split_count=stats['split_convolutions'],
                          max_abs_error=(actual-expected).abs().max().item()))
# Grouped weights need a different partitioning rule: reject rather than corrupt.
split, _ = wide_convolution_decomposition(12)
try:
    split(torch.randn(1, 16, 8, 8), torch.randn(6, 8, 3, 3), groups=2)
except ValueError:
    pass
else:
    raise AssertionError('Oversized grouped convolution was accepted')
print(json.dumps({'passed': True, 'cases': cases,
                  'oversized_group_rejection': True}, indent=2))
