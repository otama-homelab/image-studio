"""Prepare exact processor inputs for native/browser ONNX comparison, privately."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--weights', type=Path, required=True)
    parser.add_argument('--references', type=Path, nargs='+', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Output already exists')
    from transformers import VitMatteImageProcessor
    import numpy as np
    from PIL import Image
    processor = VitMatteImageProcessor.from_pretrained(args.weights, local_files_only=True)
    args.output.mkdir(parents=True, mode=0o700)
    cases = []
    for reference in args.references:
        folder = reference / 'refine-on'
        with Image.open(folder / 'input-rgb.png') as rgb, Image.open(folder / 'trimap.png') as trimap:
            tensor = processor(images=rgb, trimaps=trimap, do_resize=False, return_tensors='np')['pixel_values']
            original_size = list(rgb.size)
        tensor = np.ascontiguousarray(tensor, dtype=np.float32)
        filename = reference.name + '.f32'
        tensor.tofile(args.output / filename)
        cases.append({'id': reference.name, 'file': filename, 'shape': list(tensor.shape),
                      'dtype': 'float32', 'original_size': original_size,
                      'sha256': hashlib.sha256(tensor.tobytes()).hexdigest(), 'bytes': tensor.nbytes})
    manifest = {'processor': 'VitMatteImageProcessor', 'do_resize': False,
                'transformers': importlib.metadata.version('transformers'),
                'preprocessor_config_sha256': hashlib.sha256((args.weights / 'preprocessor_config.json').read_bytes()).hexdigest(),
                'cases': cases}
    (args.output / 'inputs.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'status': 'prepared', 'cases': len(cases)}))


if __name__ == '__main__':
    main()
