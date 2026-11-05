"""Measure alpha parity without declaring acceptance before thresholds are set."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


def measure(reference, candidate, trimap):
    if reference.ndim != 2 or reference.shape != candidate.shape or reference.shape != trimap.shape:
        raise ValueError('Expected equal-size single-channel alpha and trimap arrays')
    if any(x.dtype != np.uint8 for x in [reference, candidate, trimap]):
        raise ValueError('Expected uint8 arrays; do not silently quantize floating predictions')
    if not np.isin(trimap, [0, 128, 255]).all():
        raise ValueError('Trimap must contain only 0, 128, 255')
    error = np.abs(reference.astype(np.float64) - candidate.astype(np.float64)) / 255.0

    def region(mask):
        values = error[mask]
        return {'pixels': int(values.size), 'mae': float(values.mean()) if values.size else None,
                'max_error': float(values.max()) if values.size else None}

    return {'status': 'measured_not_accepted', 'alpha_units': '0..1',
            'all': region(np.ones(reference.shape, dtype=bool)),
            'boundary': region(trimap == 128),
            'definite_foreground_violations': int(np.count_nonzero(candidate[trimap == 255] != 255)),
            'definite_background_violations': int(np.count_nonzero(candidate[trimap == 0] != 0))}


def localize(reference, candidate, trimap, tile_size=64, top_count=8):
    """Locate quantized alpha differences; coordinates are private diagnostic data."""
    summary = measure(reference, candidate, trimap)
    if type(tile_size) is not int or tile_size < 1 or type(top_count) is not int or top_count < 1:
        raise ValueError('Expected positive integer tile size and result count')
    signed = candidate.astype(np.int16) - reference.astype(np.int16)
    error = np.abs(signed)

    def region(mask):
        values = error[mask]
        return {'pixels': int(values.size), 'changed_pixels': int(np.count_nonzero(values)),
                'absolute_error_histogram_0_to_255': np.bincount(values, minlength=256).tolist(),
                'signed_bias_code_units': float(signed[mask].mean()) if values.size else None}

    regions = {'all': region(np.ones(reference.shape, dtype=bool)),
               'trimap_unknown': region(trimap == 128),
               'trimap_foreground': region(trimap == 255),
               'trimap_background': region(trimap == 0)}
    tiles = []
    height, width = reference.shape
    for y in range(0, height, tile_size):
        for x in range(0, width, tile_size):
            patch = error[y:y+tile_size, x:x+tile_size]
            total = int(patch.sum())
            if total:
                tiles.append({'box_xyxy': [x,y,min(x+tile_size,width),min(y+tile_size,height)],
                              'error_sum_code_units': total, 'pixels': int(patch.size),
                              'mae': float(patch.mean()/255), 'max_error_code_units': int(patch.max())})
    tiles.sort(key=lambda t: (-t['error_sum_code_units'], t['box_xyxy'][1], t['box_xyxy'][0]))
    return {'summary': summary, 'regions': regions, 'tile_size': tile_size,
            'worst_tiles_by_total_error': tiles[:top_count],
            'coordinate_convention': 'original alpha pixels, xyxy half-open',
            'scope': 'Diagnostic quantized alpha localization, not acceptance or visual review'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['reference', 'candidate', 'trimap', 'output']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--localize', action='store_true', help='Include private spatial error diagnostics')
    args = parser.parse_args()
    arrays = []
    for path in [args.reference, args.candidate, args.trimap]:
        with Image.open(path) as image:
            if image.mode != 'L':
                parser.error('Expected L-mode uint8 PNG; no implicit conversion')
            arrays.append(np.asarray(image))
    result = localize(*arrays) if args.localize else measure(*arrays)
    with args.output.open('x') as stream:
        stream.write(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps(result, allow_nan=False))


if __name__ == '__main__':
    main()
