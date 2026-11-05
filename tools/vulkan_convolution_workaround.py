"""Keep Vulkan's packed convolution weights within the target texture width.

ExecuTorch 1.5.1 packs a regular conv's weights into a 2D image whose width is
align_up(input_channels_per_group, 4) * kernel_width. The 5760-channel BiRefNet
squeeze convolution exceeds RADV's 16384 limit. Sum channel partitions, applying
the bias once, without changing kernel, stride, padding or image resolution.
"""
import math
import torch


def wide_convolution_decomposition(max_texture_width=16384):
    statistics = {"texture_width_limit": max_texture_width,
                  "split_convolutions": 0, "partitions": []}

    def convolution(input, weight, bias=None, stride=(1, 1), padding=(0, 0),
                    dilation=(1, 1), groups=1):
        channels = weight.shape[1]
        width = weight.shape[-1]
        packed_width = ((channels + 3) // 4) * 4 * width

        def run(pixels, kernel, offset):
            return torch.ops.aten.convolution.default(
                pixels, kernel, offset, stride, padding, dilation, False, [0, 0], groups)

        if packed_width <= max_texture_width:
            return run(input, weight, bias)
        if groups != 1:
            raise ValueError("Oversized grouped Vulkan convolution is unsupported")
        max_channels = (max_texture_width // width // 4) * 4
        if max_channels < 4:
            raise ValueError("Convolution kernel exceeds the target texture width")
        pieces = math.ceil(channels / max_channels)
        chunk = math.ceil(channels / pieces / 4) * 4
        statistics["split_convolutions"] += 1
        statistics["partitions"].append({"input_channels": channels,
                                        "kernel_width": width, "chunk_channels": chunk})
        result = None
        for start in range(0, channels, chunk):
            end = min(start + chunk, channels)
            value = run(input[:, start:end], weight[:, start:end].contiguous(),
                        bias if start == 0 else None)
            result = value if result is None else result + value
        return result

    return convolution, statistics
