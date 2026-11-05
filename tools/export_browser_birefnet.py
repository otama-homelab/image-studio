"""Export the pinned full 2048px HR model and compare native ORT CPU.

FP16 weights/input are preserved. No lightweight model or reduced resolution.
Artifacts contain private evaluation data and must stay outside the repository.
"""
import argparse
from collections import Counter
import gc
import hashlib
import importlib.metadata
import json
from pathlib import Path
import resource
import time
import traceback


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--weights', type=Path, required=True)
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--memory-gib', type=int, default=14)
    parser.add_argument('--export-only', action='store_true',
                        help='Capture the conversion graph independently of an already-running eager reference; never claim numerical acceptance')
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    if args.output.exists() or repo == args.output.resolve() or repo in args.output.resolve().parents:
        parser.error('Choose a new output directory outside the repository')
    if not 1 <= args.threads <= 8 or not 10 <= args.memory_gib <= 24:
        parser.error('threads must be 1..8; memory-gib must be 10..24')
    expected = 'a5a4de698739ea5e0e8bbab28e1b293dde95092b87a442d566cbc585c53cef55'
    if sha(args.weights / 'model.safetensors') != expected:
        parser.error('Pinned BiRefNet weight SHA256 mismatch')
    resource.setrlimit(resource.RLIMIT_AS, (args.memory_gib * 1024**3,) * 2)
    args.output.mkdir(parents=True, mode=0o700)
    report = {'status': 'started', 'model': 'ZhengPeng7/BiRefNet_HR-matting',
              'revision': '5d6b6f8adcb5b417c871b1d84ceaae9871355b7f', 'weights_sha256': expected,
              'precision': 'float16', 'input_shape': [1, 3, 2048, 2048], 'output': 'float32 sigmoid alpha',
              'opset': 19, 'browser_execution_verified': False,
              'export_only': args.export_only,
              'source_sha256': {p.name: sha(p) for p in args.weights.glob('*.py')},
              'versions': {name: importlib.metadata.version(name) for name in
                           ['torch', 'torchvision', 'transformers', 'onnx', 'onnxruntime', 'onnxscript']}}
    started = time.monotonic()

    def persist():
        report['seconds'] = time.monotonic() - started
        (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')

    try:
        import numpy as np
        import torch
        from torchvision import transforms
        from PIL import Image
        import onnx
        import onnxruntime as ort
        from transformers import AutoModelForImageSegmentation
        from compare_browser_alpha import measure
        torch.set_num_threads(args.threads)
        report['torch_build'] = torch.__version__
        report['phase'] = 'loading'
        persist()
        net = AutoModelForImageSegmentation.from_pretrained(
            args.weights, trust_remote_code=True, local_files_only=True,
            use_safetensors=True).half().eval()

        class Alpha(torch.nn.Module):
            def __init__(self, model):
                super().__init__()
                self.model = model

            def forward(self, pixels):
                return self.model(pixels)[-1].float().sigmoid()

        wrapper = Alpha(net).eval()
        with Image.open(args.reference / 'refine-off/input-rgb.png') as image:
            size = image.size
            sample = transforms.Compose([transforms.Resize((2048, 2048)), transforms.ToTensor(),
                                         transforms.Normalize([.485, .456, .406], [.229, .224, .225])])(
                                             image.convert('RGB')).unsqueeze(0).half()
        report['phase'] = 'pytorch-reference'
        persist()
        with torch.inference_mode():
            reference = None if args.export_only else wrapper(sample).numpy()
            report['phase'] = 'export'
            persist()
            torch.onnx.export(wrapper, (sample,), args.output / 'model.onnx', input_names=['pixels'],
                              output_names=['alpha'], opset_version=19, dynamo=True, external_data=True,
                              report=True, artifacts_dir=args.output)
        onnx.checker.check_model(str(args.output / 'model.onnx'))
        graph = onnx.load(args.output / 'model.onnx', load_external_data=False)
        report['operators'] = dict(sorted(Counter(n.op_type for n in graph.graph.node).items()))
        report['files'] = {p.name: {'bytes': p.stat().st_size, 'sha256': sha(p)}
                           for p in args.output.iterdir() if p.suffix in ['.onnx', '.data']}
        if args.export_only:
            report['status'] = 'exported_not_compared'
            report['phase'] = 'onnx-check'
            return
        del wrapper, net, graph
        gc.collect()
        report['phase'] = 'native-ort-cpu'
        persist()
        options = ort.SessionOptions()
        options.intra_op_num_threads = args.threads
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(str(args.output / 'model.onnx'), sess_options=options,
                                       providers=['CPUExecutionProvider'])
        actual = session.run(['alpha'], {'pixels': sample.numpy()})[0]
        if actual.shape != reference.shape or not np.isfinite(actual).all():
            raise ValueError('Native ORT shape/finite validation failed')
        difference = np.abs(actual - reference)
        report['native_vs_pytorch'] = {'mae': float(difference.mean()), 'max_error': float(difference.max())}
        resized = torch.nn.functional.interpolate(torch.from_numpy(actual), size=(size[1], size[0]),
                                                   mode='bilinear', align_corners=False)[0, 0].numpy()
        candidate = np.rint(resized * 255).clip(0, 255).astype(np.uint8)
        with Image.open(args.reference / 'refine-off/alpha.png') as image:
            expected_alpha = np.asarray(image)
        with Image.open(args.reference / 'refine-off/trimap.png') as image:
            trimap = np.asarray(image)
        report['native_vs_rocm_uint8'] = measure(expected_alpha, candidate, trimap)
        Image.fromarray(candidate).save(args.output / 'native-alpha.png')
        report['files'] = {p.name: {'bytes': p.stat().st_size, 'sha256': sha(p)}
                           for p in args.output.iterdir() if p.suffix in ['.onnx', '.data']}
        report['status'] = 'native_comparison_measured_not_accepted'
    except Exception as error:
        report['status'] = 'failed'
        report['error_type'] = type(error).__name__
        (args.output / 'failure.txt').write_text(traceback.format_exc())
        raise
    finally:
        report['peak_process_rss_bytes'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
        persist()


if __name__ == '__main__':
    main()
