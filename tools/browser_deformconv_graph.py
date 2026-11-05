"""Experimental ONNX DeformConv decomposition; no implicit full-model execution."""

def build(shape, weight_shape, kind, *, pads, strides, dilations, mask=True, bias=True):
    import numpy as np
    import onnx
    from onnx import TensorProto, helper as h, numpy_helper as nh
    n, channels, height, width = shape
    outputs, weight_channels, kh, kw = weight_shape
    if n != 1 or channels != weight_channels:
        raise ValueError('Experiment supports batch=1, group=offset_group=1 only')
    oh = (height + pads[0] + pads[2] - dilations[0] * (kh - 1) - 1) // strides[0] + 1
    ow = (width + pads[1] + pads[3] - dilations[1] * (kw - 1) - 1) // strides[1] + 1
    if min(oh, ow) < 1:
        raise ValueError('Invalid spatial output')
    specs = [('x', shape), ('weight', weight_shape), ('offset', [n, 2*kh*kw, oh, ow])]
    if bias:
        specs.append(('bias', [outputs]))
    if mask:
        specs.append(('mask', [n, kh*kw, oh, ow]))
    inputs = [h.make_tensor_value_info(name, kind, dims) for name, dims in specs]
    output = h.make_tensor_value_info('y', kind, [n, outputs, oh, ow])
    original_inputs = ['x', 'weight', 'offset', 'bias' if bias else '']
    if mask:
        original_inputs.append('mask')
    original = h.make_model(h.make_graph([
        h.make_node('DeformConv', original_inputs, ['y'], strides=strides,
                    pads=pads, dilations=dilations, group=1, offset_group=1)
    ], 'original-tiny-deform', inputs, [output]),
        opset_imports=[h.make_opsetid('', 19)], ir_version=13)
    nodes, initializers = [], []

    def const(name, data, dtype):
        initializers.append(nh.from_array(np.asarray(data, dtype=dtype), name))
        return name

    def op(kind, args, name, **attrs):
        nodes.append(h.make_node(kind, args, [name], name=name, **attrs))
        return name

    x = op('Cast', ['x'], 'x32', to=TensorProto.FLOAT)
    w = op('Cast', ['weight'], 'w32', to=TensorProto.FLOAT)
    offset = op('Cast', ['offset'], 'offset32', to=TensorProto.FLOAT)
    modulation = op('Cast', ['mask'], 'mask32', to=TensorProto.FLOAT) if mask else None
    const('two_over_size', [2/width, 2/height], np.float32)
    const('minus_one', -1, np.float32)
    accumulated = None
    for ky in range(kh):
        for kx in range(kw):
            k = ky*kw+kx
            base_x = np.arange(ow)[None, :] * strides[1] - pads[1] + kx*dilations[1]
            base_y = np.arange(oh)[:, None] * strides[0] - pads[0] + ky*dilations[0]
            coordinates = []
            for axis, base, channel in [('x', base_x, 2*k+1), ('y', base_y, 2*k)]:
                index = const(f'i_{k}_{axis}', [channel], np.int64)
                delta = op('Gather', [offset, index], f'delta_{k}_{axis}', axis=1)
                delta = op('Transpose', [delta], f'transpose_{k}_{axis}', perm=[0, 2, 3, 1])
                base_name = const(f'base_{k}_{axis}', base[None, :, :, None], np.float32)
                coordinates.append(op('Add', [delta, base_name], f'position_{k}_{axis}'))
            xy = op('Concat', coordinates, f'xy_{k}', axis=3)
            # align_corners=False: normalize pixel center x as (x+.5)*2/W-1.
            half = const(f'half_{k}', .5, np.float32)
            centers = op('Add', [xy, half], f'center_{k}')
            normalized = op('Mul', [centers, 'two_over_size'], f'normalized_{k}')
            grid = op('Add', [normalized, 'minus_one'], f'grid_{k}')
            sample = op('GridSample', [x, grid], f'sample_{k}', mode='bilinear', padding_mode='zeros', align_corners=0)
            if mask:
                index = const(f'mask_i_{k}', [k], np.int64)
                m = op('Gather', [modulation, index], f'modulation_{k}', axis=1)
                sample = op('Mul', [sample, m], f'masked_{k}')
            wi = const(f'weight_y_{k}', [ky], np.int64)
            row = op('Gather', [w, wi], f'weight_row_{k}', axis=2)
            wi = const(f'weight_x_{k}', [kx], np.int64)
            kernel = op('Gather', [row, wi], f'kernel_{k}', axis=3)
            part = op('Conv', [sample, kernel], f'part_{k}', kernel_shape=[1, 1])
            accumulated = part if accumulated is None else op('Add', [accumulated, part], f'sum_{k}')
    if bias:
        b = op('Cast', ['bias'], 'bias32', to=TensorProto.FLOAT)
        bshape = const('bias_shape', [1, outputs, 1, 1], np.int64)
        b = op('Reshape', [b, bshape], 'bias_broadcast')
        accumulated = op('Add', [accumulated, b], 'biased')
    op('Cast', [accumulated], 'y', to=kind)
    candidate = h.make_model(h.make_graph(nodes, 'decomposed-tiny-deform', inputs, [output], initializers),
                             opset_imports=[h.make_opsetid('', 19)], ir_version=13)
    onnx.checker.check_model(original)
    onnx.checker.check_model(candidate)
    return original, candidate, specs

