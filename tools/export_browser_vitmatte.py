"""Pinned ViTMatte ONNX export probe; synthetic parity is not final acceptance."""
import argparse
from collections import Counter
from contextlib import nullcontext
import hashlib
import importlib.metadata
import json
from pathlib import Path
import time
import traceback


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--weights', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--exportable-helpers', action='store_true')
    parser.add_argument('--headwise-attention', action='store_true',
                        help='Preserve every attention head while avoiding a single all-head global score buffer')
    parser.add_argument('--threads', type=int, default=2)
    args = parser.parse_args()
    if args.headwise_attention and not args.exportable_helpers:
        parser.error('headwise-attention requires exportable-helpers')
    if not 1 <= args.threads <= 8:
        parser.error('threads must be 1..8')
    if args.output.exists():
        parser.error('Choose a new output directory')
    expected = '0d1e43962bfc6daecec29a76b90194b51902ad0286dfaaf91e1b8a4f17d15348'
    if sha(args.weights / 'model.safetensors') != expected:
        parser.error('Pinned ViTMatte weight SHA256 mismatch')
    args.output.mkdir(parents=True, mode=0o700)
    report = {'status': 'started', 'model': 'hustvl/vitmatte-base-distinctions-646',
              'revision': 'b58373f8dbbfbeb58157456e2e4949f9f872aa18',
              'weights_sha256': expected, 'precision': 'float32', 'opset': 18,
              'exportable_helpers': args.exportable_helpers,
              'headwise_attention': args.headwise_attention,
              'browser_execution_verified': False, 'full_reference_set_verified': False,
              'versions': {name: importlib.metadata.version(name) for name in
                           ['torch', 'torchvision', 'transformers', 'onnx', 'onnxruntime', 'onnxscript']}}
    started = time.monotonic()
    try:
        import numpy as np
        import torch
        import onnx
        import onnxruntime as ort
        from transformers import VitMatteForImageMatting
        torch.set_num_threads(args.threads)
        torch.manual_seed(36)
        report['torch_build'] = torch.__version__
        report['phase'] = 'loading'
        net = VitMatteForImageMatting.from_pretrained(args.weights, local_files_only=True).float().eval()

        class Alpha(torch.nn.Module):
            def __init__(self, model):
                super().__init__()
                self.model = model

            def forward(self, pixel_values):
                return self.model(pixel_values=pixel_values).alphas

        wrapped = Alpha(net).eval()
        sample = torch.rand(1, 4, 512, 512)
        report['phase'] = 'pytorch-reference'
        with torch.inference_mode():
            original = wrapped(sample).numpy()
        context = nullcontext()
        if args.exportable_helpers:
            from vitmatte_export_helpers import exportable_vitmatte
            context = exportable_vitmatte(split_attention_heads=args.headwise_attention, model=net)
        with context, torch.inference_mode():
            candidate = wrapped(sample).numpy()
            report['helper_parity_512'] = {
                'mae': float(np.abs(original - candidate).mean()),
                'max_error': float(np.abs(original - candidate).max()),
            }
            report['phase'] = 'export'
            (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
            h = torch.export.Dim('height_blocks', min=1, max=64)
            w = torch.export.Dim('width_blocks', min=1, max=64)
            torch.onnx.export(wrapped, (sample,), args.output / 'model.onnx',
                              input_names=['pixel_values'], output_names=['alphas'],
                              opset_version=18, dynamo=True, external_data=True,
                              dynamic_shapes={'pixel_values': {2: 32*h, 3: 32*w}},
                              report=True, artifacts_dir=args.output)
        report['phase'] = 'onnx-check'
        onnx.checker.check_model(str(args.output / 'model.onnx'))
        graph = onnx.load(args.output / 'model.onnx', load_external_data=False)
        report['operators'] = dict(sorted(Counter((node.domain + ':' if node.domain else '') + node.op_type
                                                 for node in graph.graph.node).items()))
        report['inputs'] = [str(item) for item in graph.graph.input]
        report['phase'] = 'native-ort-cpu'
        options = ort.SessionOptions()
        options.intra_op_num_threads = args.threads
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(str(args.output / 'model.onnx'), sess_options=options,
                                       providers=['CPUExecutionProvider'])
        actual = session.run(['alphas'], {'pixel_values': sample.numpy()})[0]
        if actual.shape != original.shape or not np.isfinite(actual).all():
            raise RuntimeError('Native ORT output shape/finite check failed')
        difference = np.abs(actual - original)
        report['native_parity_512'] = {'mae': float(difference.mean()), 'max_error': float(difference.max())}
        report['files'] = {p.name: {'sha256': sha(p), 'bytes': p.stat().st_size}
                           for p in args.output.iterdir() if p.suffix in ['.onnx', '.data']}
        report['status'] = 'exported_synthetic_parity_measured_not_accepted'
    except Exception as error:
        report['status'] = 'failed'
        report['error_type'] = type(error).__name__
        (args.output / 'failure.txt').write_text(traceback.format_exc())
        raise
    finally:
        report['seconds'] = time.monotonic() - started
        (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
