"""Private CPU-only rembg comparison of an already captured browser alpha.

No inference is loaded. A supplied-mask session replaces model prediction.
Run in the pinned reference environment; outputs must stay outside the repo.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def recover(rgb, alpha):
    import numpy as np
    from PIL import Image
    from rembg import remove

    class SuppliedMask:
        def predict(self, image, *args, **kwargs):
            if image.size != alpha.size:
                raise ValueError('Session input dimensions changed')
            return [alpha.copy()]

    cutout = remove(rgb, session=SuppliedMask(), decontaminate=True,
                    alpha_matting=False, post_process_mask=False).convert('RGBA')
    rgba = np.array(cutout)
    mask = np.asarray(alpha)
    if rgba.shape != (rgb.height, rgb.width, 4) or not np.array_equal(rgba[:, :, 3], mask):
        raise ValueError('Recovered alpha changed')
    opaque = mask == 255
    rgba[:, :, :3][opaque] = np.asarray(rgb)[opaque]
    return Image.fromarray(rgba)


def metric(expected, actual, region=None):
    import numpy as np
    if expected.shape != actual.shape:
        raise ValueError('Comparison shape mismatch')
    delta = np.abs(expected.astype(np.int16) - actual.astype(np.int16))
    if region is not None:
        delta = delta[region]
    if not delta.size:
        return {'samples': 0, 'mae_255': None, 'max_255': None}
    return {'samples': int(delta.size), 'mae_255': float(delta.mean()),
            'max_255': int(delta.max())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', type=Path, required=True, help='One refine-off/on directory')
    parser.add_argument('--candidate-alpha', type=Path, required=True)
    parser.add_argument('--candidate-sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    source = Path(__file__).resolve()
    repo = next((p for p in source.parents if (p / '.git').exists()), None)
    destination = args.output.resolve()
    if destination.exists() or (repo is not None and (destination == repo or repo in destination.parents)):
        parser.error('Use a new private output directory outside the repo')
    if sha(args.candidate_alpha) != args.candidate_sha256:
        raise ValueError('Candidate alpha SHA mismatch')
    os.environ['OMP_NUM_THREADS'] = '1'
    os.environ['OPENBLAS_NUM_THREADS'] = '1'
    os.environ['NUMBA_NUM_THREADS'] = '1'
    import numpy as np
    from PIL import Image
    from rembg.bg import apply_background_color

    def load(path, mode):
        with Image.open(path) as image:
            if image.mode != mode:
                raise ValueError(f'Expected {mode} image')
            image.load()
            return image.copy()

    rgb = load(args.reference / 'input-rgb.png', 'RGB')
    alpha = load(args.reference / 'alpha.png', 'L')
    candidate = load(args.candidate_alpha, 'L')
    trimap = load(args.reference / 'trimap.png', 'L')
    reference_cutout = load(args.reference / 'transparent.png', 'RGBA')
    if any(image.size != rgb.size for image in [alpha, candidate, trimap, reference_cutout]):
        raise ValueError('Input dimensions differ')
    # Calibration is mandatory: do not attribute a changed reference environment to WebGPU.
    control = recover(rgb, alpha)
    if not np.array_equal(np.asarray(control), np.asarray(reference_cutout)):
        raise ValueError('Pinned postprocessing does not reproduce reference RGBA')
    actual = recover(rgb, candidate)
    unknown = np.asarray(trimap) == 128
    a = np.asarray(actual)
    r = np.asarray(reference_cutout)
    opaque = np.asarray(candidate) == 255
    if not np.array_equal(a[:, :, :3][opaque], np.asarray(rgb)[opaque]):
        raise ValueError('Opaque RGB not preserved')
    report = {'status': 'composite_measured_not_accepted',
              'candidate_alpha_sha256': args.candidate_sha256,
              'reference_files': {name: sha(args.reference / name) for name in
                                  ['input-rgb.png', 'alpha.png', 'trimap.png', 'transparent.png']},
              'versions': {name: importlib.metadata.version(name) for name in
                           ['rembg', 'pymatting', 'numpy', 'pillow']},
              'reference_rgba_calibration_pixel_exact': True,
              'opaque_rgb_preserved': True,
              'foreground_rgb_unknown': metric(r[:, :, :3], a[:, :, :3], unknown),
              'composites': {},
              'limitations': ['Native rembg postprocessing, not browser foreground kernel parity.',
                              'Generated evaluation scenes; no general real-photo acceptance.',
                              'Visual ROI review and justified acceptance threshold remain required.']}
    destination.mkdir(mode=0o700)
    actual.save(destination / 'candidate-transparent.png')
    for label, color in [('offwhite', (245, 243, 239, 255)), ('white', (255, 255, 255, 255)),
                         ('black', (0, 0, 0, 255)), ('blue', (32, 96, 192, 255))]:
        expected = apply_background_color(reference_cutout, color).convert('RGB')
        result = apply_background_color(actual, color).convert('RGB')
        expected.save(destination / f'{label}-reference.png')
        result.save(destination / f'{label}-candidate.png')
        report['composites'][label] = {
            'all': metric(np.asarray(expected), np.asarray(result)),
            'unknown': metric(np.asarray(expected), np.asarray(result), unknown)}
    (destination / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
