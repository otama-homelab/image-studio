"""Validate private ROCm capture receipts and emit image-free evidence."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image


def verify(directory):
    record = json.loads((directory / 'reference.json').read_text())
    if record['status'] != 'captured_not_accepted' or record['backend'] != 'rocm':
        raise ValueError('Reference capture did not finish on ROCm')
    if sorted(case['refine'] for case in record['cases']) != [False, True]:
        raise ValueError('Expected exactly one refine-off and refine-on case')
    checks = []
    for case in record['cases']:
        folder = directory / ('refine-on' if case['refine'] else 'refine-off')
        required = {name + '.png' for name in ['input-rgb', 'background', 'alpha', 'hr-alpha', 'trimap', 'transparent']}
        if not required.issubset(case['files']):
            raise ValueError('Required artifacts are missing from the hash receipt')
        for name, digest in case['files'].items():
            if Path(name).name != name:
                raise ValueError('Invalid artifact name')
            with (folder / name).open('rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != digest:
                    raise ValueError('Artifact SHA256 mismatch: ' + name)
        images = {}
        for name, mode in [('input-rgb', 'RGB'), ('background', 'RGB'), ('alpha', 'L'),
                           ('hr-alpha', 'L'), ('trimap', 'L'), ('transparent', 'RGBA')]:
            with Image.open(folder / (name + '.png')) as image:
                if image.mode != mode:
                    raise ValueError('Invalid mode: ' + name)
                images[name] = np.asarray(image)
        rgb, alpha, rgba = images['input-rgb'], images['alpha'], images['transparent']
        height, width = alpha.shape
        if any(image.shape[:2] != (height, width) for image in images.values()) or max(width, height) > 2000:
            raise ValueError('Invalid dimensions')
        if not np.array_equal(alpha, rgba[:, :, 3]):
            raise ValueError('Transparent PNG alpha differs from captured alpha')
        opaque = alpha == 255
        if not np.array_equal(rgb[opaque], rgba[:, :, :3][opaque]):
            raise ValueError('Opaque RGB was altered')
        trimap = images['trimap']
        if not np.isin(trimap, [0, 128, 255]).all():
            raise ValueError('Invalid trimap values')
        counts = {str(v): int(np.count_nonzero(trimap == v)) for v in [0, 128, 255]}
        if counts != case['trimap_counts']:
            raise ValueError('Trimap count mismatch')
        skipped = not counts['128'] or not counts['0'] or not counts['255']
        if not case['refine'] and not np.array_equal(alpha, images['hr-alpha']):
            raise ValueError('Refine-off alpha differs from HR')
        if case['refine']:
            if skipped:
                if not np.array_equal(alpha, images['hr-alpha']):
                    raise ValueError('Refinement skip did not preserve HR')
            elif np.any(alpha[trimap == 0] != 0) or np.any(alpha[trimap == 255] != 255):
                raise ValueError('Refinement changed definite regions')
        checks.append({'refine': case['refine'], 'dimensions': [width, height],
                       'seconds': case['seconds'], 'trimap_counts': counts,
                       'refinement_skipped': bool(skipped) if case['refine'] else None,
                       'sha_verified': True, 'rgba_alpha_verified': True, 'opaque_rgb_verified': True,
                       'peak_torch_allocated_bytes': case['peak_torch_allocated_bytes'],
                       'peak_torch_reserved_bytes': case['peak_torch_reserved_bytes']})
    face = record.get('face_geometry')
    if face is not None and (len(face) != 3 or not np.isfinite(face).all() or face[1] >= face[2]):
        raise ValueError('Invalid face geometry')
    return {'status': 'reference_integrity_verified_not_model_acceptance',
            'models': record['models'], 'gpu': record['gpu'], 'torch': record['torch'], 'hip': record['hip'],
            'dependencies': record['dependencies'], 'source_sha256': record['source_sha256'],
            'source_dimensions': record['source_dimensions'],
            'evaluation_resize': record.get('evaluation_resize'),
            'face_geometry_captured': face is not None, 'checks': checks}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = verify(args.reference)
    with args.output.open('x') as stream:
        stream.write(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'status': result['status'], 'dimensions': result['checks'][0]['dimensions']}))


if __name__ == '__main__':
    main()
