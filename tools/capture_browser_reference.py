"""Capture private ROCm reference artifacts through the existing application.

Run in the ROCm application environment. Never writes input/output into this repo.
No browser inference is performed or claimed by this tool.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import sys
import time


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--app-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'app')
    parser.add_argument('--color', default='#F5F3EF')
    parser.add_argument('--provenance', required=True, help='Local consent/generation record; not published')
    parser.add_argument('--include-face', action='store_true', help='Optional research-only face reference')
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--evaluation-size', type=int, nargs=2, metavar=('WIDTH', 'HEIGHT'),
                        help='Explicit resampling fixture before application preprocessing; not independent scene diversity')
    args = parser.parse_args()
    if not 1 <= args.threads <= 8:
        parser.error('threads must be between 1 and 8')
    if args.evaluation_size and any(not 1 <= value <= 4096 for value in args.evaluation_size):
        parser.error('evaluation-size edges must be between 1 and 4096')
    repo = Path(__file__).resolve().parents[1]
    output = args.output.resolve()
    if output == repo or repo in output.parents:
        parser.error('Reference output must be outside the repository')
    if output.exists():
        parser.error('Output must not exist; reference data is never overwritten')
    if not args.input.is_file():
        parser.error('Input file not found')
    if os.environ.get('IMAGE_STUDIO_BACKEND', 'rocm') != 'rocm':
        parser.error('Only the ROCm reference backend is accepted')
    os.environ['IMAGE_STUDIO_BACKEND'] = 'rocm'
    sys.path.insert(0, str(args.app_dir.resolve()))
    import numpy as np
    import torch
    from PIL import Image, ImageOps
    import image_studio_gpu as gpu
    import image_studio_refinement as refinement
    import image_studio_backend as backend

    if not torch.cuda.is_available() or not torch.version.hip:
        raise RuntimeError('ROCm GPU is required; CPU is not a reference substitute')
    torch.set_num_threads(args.threads)
    output.mkdir(parents=True, mode=0o700)
    record = {
        'status': 'running', 'backend': 'rocm', 'input_sha256': sha(args.input),
        'provenance': args.provenance, 'color': args.color,
        'torch': torch.__version__, 'hip': torch.version.hip,
        'gpu': torch.cuda.get_device_name(0),
        'threads': args.threads,
        'models': {},
        'source_sha256': {p.name: sha(p) for p in args.app_dir.glob('*.py')},
        'dependencies': {d: importlib.metadata.version(d) for d in
                         ['torch', 'torchvision', 'transformers', 'pillow', 'numpy', 'rembg']},
        'decode_contract': 'Pillow EXIF transpose + RGB, then numpy input to change_background; Gradio decode not covered',
        'evaluation_resize': {'size': args.evaluation_size, 'filter': 'Pillow LANCZOS'} if args.evaluation_size else None,
        'cases': [],
    }
    current = None
    original_predict = gpu.predict_mask
    original_refine = refinement.refine_alpha

    def capture_refine(rgb, mask):
        Image.fromarray(mask).save(current / 'hr-alpha.png')
        trimap = refinement.make_trimap(mask)
        Image.fromarray(trimap).save(current / 'trimap.png')
        return original_refine(rgb, mask)

    def capture_predict(rgb, *positional, **kwargs):
        rgb.save(current / 'input-rgb.png')
        mask = original_predict(rgb, *positional, **kwargs)
        Image.fromarray(mask).save(current / 'alpha.png')
        if not (current / 'hr-alpha.png').exists():
            Image.fromarray(mask).save(current / 'hr-alpha.png')
            Image.fromarray(refinement.make_trimap(mask)).save(current / 'trimap.png')
        return mask

    refinement.refine_alpha = capture_refine
    gpu.predict_mask = capture_predict
    Path('/tmp/photos/exports').mkdir(parents=True, exist_ok=True)
    try:
        from huggingface_hub import try_to_load_from_cache
        hr_repository, hr_revision, _, hr_dtype = gpu.MODELS[gpu.MODEL_NAME]
        for name, repository, revision, precision in [
            ('birefnet', hr_repository, hr_revision, str(hr_dtype)),
            ('vitmatte', refinement.REPOSITORY, refinement.REVISION, 'torch.float32'),
        ]:
            weight = try_to_load_from_cache(repository, 'model.safetensors', revision=revision)
            if not isinstance(weight, str) or not Path(weight).is_file():
                raise RuntimeError('Pinned weights must already be cached for reference capture')
            record['models'][name] = {'repository': repository, 'revision': revision,
                                      'precision': precision, 'weights_sha256': sha(weight)}
        with Image.open(args.input) as image:
            record['source_dimensions'] = list(image.size)
            decoded = ImageOps.exif_transpose(image).convert('RGB')
            if args.evaluation_size:
                decoded = decoded.resize(tuple(args.evaluation_size), Image.Resampling.LANCZOS)
            record['evaluation_input_dimensions'] = list(decoded.size)
            source = np.asarray(decoded)
        for refine in [False, True]:
            current = output / ('refine-on' if refine else 'refine-off')
            current.mkdir(mode=0o700)
            started = time.monotonic()
            torch.cuda.reset_peak_memory_stats()
            paths = backend.change_background(source, args.color, refine)
            shutil.copyfile(paths[1], current / 'background.png')
            shutil.copyfile(paths[2], current / 'transparent.png')
            trimap = np.asarray(Image.open(current / 'trimap.png'))
            record['cases'].append({
                'refine': refine, 'seconds': time.monotonic() - started,
                'peak_torch_allocated_bytes': torch.cuda.max_memory_allocated(),
                'peak_torch_reserved_bytes': torch.cuda.max_memory_reserved(),
                'trimap_counts': {str(v): int(np.count_nonzero(trimap == v)) for v in [0, 128, 255]},
                'files': {p.name: sha(p) for p in current.glob('*.png')},
            })
            (output / 'reference.json').write_text(json.dumps(record, indent=2) + '\n')
        if args.include_face:
            # Face crown estimation calls predict_mask again. It must not overwrite
            # refine-on artifacts after their hashes have been recorded.
            gpu.predict_mask = original_predict
            refinement.refine_alpha = original_refine
            import cv2
            from image_studio_face import head_geometry
            record['face_geometry'] = list(map(float, head_geometry(cv2.cvtColor(source, cv2.COLOR_RGB2BGR))))
        record['status'] = 'captured_not_accepted'
    except Exception as error:
        record['status'] = 'failed'
        record['error_type'] = type(error).__name__
        raise
    finally:
        gpu.predict_mask = original_predict
        refinement.refine_alpha = original_refine
        (output / 'reference.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps({'status': record['status'], 'cases': len(record['cases'])}))


if __name__ == '__main__':
    main()
