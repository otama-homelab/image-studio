"""Run real padded reference inputs on native ORT CPU; no WebGPU claims."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--onnx', type=Path, required=True)
    parser.add_argument('--inputs', type=Path, required=True)
    parser.add_argument('--reference-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--memory-gib', type=int, default=22, help='Process virtual-memory ceiling, not a GPU measurement')
    parser.add_argument('--staged', action='store_true', help='Diagnostic original-node evaluation; not whole-session acceptance')
    parser.add_argument('--case', action='append', dest='selected_cases', help='Explicit case IDs; default is the complete manifest')
    args = parser.parse_args()
    if args.output.exists() or not 1 <= args.threads <= 8 or not 1 <= args.memory_gib <= 24:
        parser.error('Need a new output directory, threads 1..8 and memory-gib 1..24')
    resource.setrlimit(resource.RLIMIT_AS, (args.memory_gib * 1024**3,) * 2)
    os.environ['OPENBLAS_NUM_THREADS'] = '1'
    import numpy as np
    import onnxruntime as ort
    from PIL import Image
    from compare_browser_alpha import measure
    args.output.mkdir(parents=True, mode=0o700)
    report = {'status': 'running', 'scope': 'Native ORT CPU vs ROCm uint8 reference; not browser acceptance',
              'ort': ort.__version__, 'cases': [], 'memory_limit_gib': args.memory_gib}
    try:
        manifest = json.loads((args.inputs / 'inputs.json').read_text())
        cases = manifest['cases']
        if len({c['id'] for c in cases}) != len(cases):
            raise ValueError('Duplicate input case IDs')
        if args.selected_cases:
            if not set(args.selected_cases) <= {c['id'] for c in cases}:
                raise ValueError('Unknown selected case ID')
            cases = [c for c in cases if c['id'] in args.selected_cases]
        report['selected_cases'] = [c['id'] for c in cases]
        report['complete_manifest_selected'] = len(cases) == len(manifest['cases'])
        options = ort.SessionOptions()
        options.intra_op_num_threads = args.threads
        options.inter_op_num_threads = 1
        if args.staged:
            import onnx
            from browser_native_staged import evaluate
            frozen = onnx.shape_inference.infer_shapes(onnx.load(args.onnx, load_external_data=False),
                                                       strict_mode=True, data_prop=False)
            report['execution'] = 'diagnostic_native_staged_complete_output_dependencies'
            report['providers'] = ['CPUExecutionProvider']
        else:
            session = ort.InferenceSession(str(args.onnx), sess_options=options, providers=['CPUExecutionProvider'])
            report['execution'] = 'whole_native_session'
            report['providers'] = session.get_providers()
            report['model_input_shape'] = session.get_inputs()[0].shape
        for case in cases:
            if Path(case['file']).name != case['file'] or Path(case['id']).name != case['id']:
                raise ValueError('Invalid input manifest path')
            data = (args.inputs / case['file']).read_bytes()
            if len(data) != case['bytes'] or hashlib.sha256(data).hexdigest() != case['sha256']:
                raise ValueError('Input SHA/length mismatch')
            tensor = np.frombuffer(data, dtype=np.float32).reshape(case['shape'])
            started = time.monotonic()
            print(json.dumps({'case': case['id'], 'phase': 'native-inference', 'shape': case['shape']}), flush=True)
            staged = None
            if args.staged:
                def node_checkpoint(row):
                    row = {'case_id': case['id'], **row}
                    (args.output / 'last-node.json').write_text(json.dumps(row)+'\n')
                    with (args.output / (case['id']+'-node-trace.jsonl')).open('a') as stream:
                        stream.write(json.dumps(row)+'\n')
                    if row['step'] % 128 == 0:
                        print(json.dumps(row), flush=True)
                result, staged = evaluate(frozen, {'pixel_values': tensor}, model_dir=args.onnx.parent,
                                          outputs=['alphas'], callback=node_checkpoint)
                output = result['alphas']
                del result
            else:
                output = session.run(['alphas'], {'pixel_values': tensor})[0]
            if output.dtype != np.float32 or output.shape != (1, 1, *tensor.shape[2:]) or not np.isfinite(output).all():
                raise ValueError('Output shape/finite validation failed')
            width, height = case['original_size']
            alpha = np.rint(output[0, 0, :height, :width] * 255).clip(0, 255).astype(np.uint8)
            reference = args.reference_root / case['id'] / 'refine-on'
            with Image.open(reference / 'trimap.png') as image:
                trimap = np.asarray(image)
            with Image.open(reference / 'alpha.png') as image:
                expected = np.asarray(image)
            alpha[trimap == 255] = 255
            alpha[trimap == 0] = 0
            measured = measure(expected, alpha, trimap)
            Image.fromarray(alpha).save(args.output / (case['id'] + '-alpha.png'))
            report['cases'].append({'id': case['id'], 'shape': case['shape'], 'staged_execution': staged,
                                    'seconds': time.monotonic() - started, 'metrics': measured,
                                    'peak_process_rss_bytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024})
            (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        report['status'] = ('full_reference_metrics_measured_not_accepted' if report['complete_manifest_selected']
                            else 'selected_reference_metrics_measured_not_accepted')
    except Exception as error:
        report['status'] = 'failed'
        report['error_type'] = type(error).__name__
        raise
    finally:
        (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
