"""Tiny native-only experiment for BiRefNet's single-group DeformConv.

Keep learned offsets, modulation mask, stride, padding, dilation and bias.
Sample and accumulate in FP32, cast back to the original dtype. This changes
arithmetic and requires full-model numerical acceptance before adoption.
Never loads learned weights or runs the full HR model/browser.
"""
import argparse
import json
import os
from pathlib import Path
import resource
import time


from browser_deformconv_graph import build


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Choose a new output JSON path')
    # Bound this diagnostic independently of the paused full-model runs.
    resource.setrlimit(resource.RLIMIT_AS, (1024**3,) * 2)
    os.environ['OPENBLAS_NUM_THREADS'] = '1'
    os.environ['OMP_NUM_THREADS'] = '1'
    import numpy as np
    import onnxruntime as ort
    from onnx import TensorProto
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    started = time.monotonic()
    result = {'scope': 'Tiny native CPU operator comparison only; not full model or WebGPU acceptance',
              'ort': ort.__version__, 'arithmetic': 'FP32 sampling and accumulation; original dtype output',
              'threads': 1, 'virtual_memory_limit_bytes': 1024**3, 'cases': []}
    rng = np.random.default_rng(36)
    for dtype, kind in [(np.float32, TensorProto.FLOAT), (np.float16, TensorProto.FLOAT16)]:
        for kh, kw, pads, strides, dilations, mask, bias in [
            (1, 1, [0]*4, [1, 1], [1, 1], True, True),
            (3, 3, [1]*4, [1, 1], [1, 1], True, True),
            (3, 3, [2, 1, 2, 1], [2, 1], [2, 1], True, True),
            (5, 5, [2]*4, [1, 1], [1, 1], True, False),
            (7, 7, [3]*4, [1, 1], [1, 1], True, True),
            (3, 3, [1]*4, [1, 1], [1, 1], False, False),
        ]:
            original, candidate, specs = build([1, 2, 7, 9], [3, 2, kh, kw], kind,
                pads=pads, strides=strides, dilations=dilations, mask=mask, bias=bias)
            feeds = {name: rng.uniform(-1, 1, dims).astype(dtype) for name, dims in specs}
            # Fractional offsets and excursions well outside the input, not only regular Conv.
            feeds['offset'] *= 3
            feeds['offset'].reshape(-1)[:8] = np.array([-20, -1, -.5, 0, .5, 1, 8, 20], dtype=dtype)
            if mask:
                feeds['mask'] = rng.uniform(-.25, 1.5, feeds['mask'].shape).astype(dtype)
            expected = ort.InferenceSession(original.SerializeToString(), options, providers=['CPUExecutionProvider']).run(None, feeds)[0]
            actual = ort.InferenceSession(candidate.SerializeToString(), options, providers=['CPUExecutionProvider']).run(None, feeds)[0]
            if expected.shape != actual.shape or not np.isfinite(actual).all():
                raise ValueError('Invalid candidate result')
            error = np.abs(expected.astype(np.float64) - actual.astype(np.float64))
            result['cases'].append({'dtype': np.dtype(dtype).name, 'kernel': [kh, kw],
                'pads': pads, 'strides': strides, 'dilations': dilations, 'mask': mask, 'bias': bias,
                'shape': list(actual.shape), 'mae': float(error.mean()), 'max_error': float(error.max()),
                'candidate_nodes': len(candidate.graph.node)})
    result['seconds'] = time.monotonic() - started
    result['peak_process_rss_bytes'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
    result['status'] = 'operator_differences_measured_not_accepted'
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'cases': len(result['cases']), 'seconds': result['seconds'],
                      'peak_rss_bytes': result['peak_process_rss_bytes'],
                      'max_error': max(c['max_error'] for c in result['cases'])}), flush=True)


if __name__ == '__main__':
    main()
