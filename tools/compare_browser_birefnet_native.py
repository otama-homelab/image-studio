"""Compare the exported full HR FP16 model against the ROCm reference on native CPU."""
import argparse
import gc
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import resource
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--onnx', type=Path, required=True)
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--prepared-input',type=Path,help='SHA-checked raw input captured by a previous run; avoids redoing preprocessing')
    parser.add_argument('--prepare-only',action='store_true',help='Save the exact Torch/vision input then exit without creating an ORT session')
    parser.add_argument('--execution-order',choices=['default','priority'],default='default')
    parser.add_argument('--optimization',choices=['all','basic','disabled'],default='all')
    parser.add_argument('--disable-cpu-arena',action='store_true')
    parser.add_argument('--disable-memory-pattern',action='store_true')
    parser.add_argument('--staged',action='store_true',help='Diagnostic native per-node evaluation of the complete output dependency graph; not a browser runtime')
    args = parser.parse_args()
    if args.output.exists() or not 1 <= args.threads <= 8:
        parser.error('Choose a new output directory; threads must be 1..8')
    resource.setrlimit(resource.RLIMIT_AS, (22 * 1024**3,) * 2)
    os.environ['OPENBLAS_NUM_THREADS'] = '1'
    import numpy as np
    from PIL import Image
    import onnxruntime as ort
    from compare_browser_alpha import measure
    torch = None
    args.output.mkdir(parents=True, mode=0o700)
    report = {'status': 'running', 'scope': 'Native full HR FP16 vs ROCm, not browser acceptance',
              'ort': ort.__version__, 'torch':importlib.metadata.version('torch'), 'numpy':np.__version__,
              'threads': args.threads, 'input_shape': [1, 3, 2048, 2048]}
    started = time.monotonic()
    def checkpoint(phase):
        report['phase'] = phase
        memory = {}
        try:
            for row in Path('/proc/self/status').read_text().splitlines():
                if row.startswith('VmRSS:'):memory['process_rss_bytes']=int(row.split()[1])*1024
            for key in ['memory.current','memory.peak','memory.max']:
                p=Path('/sys/fs/cgroup')/key
                if p.exists():memory['cgroup_'+key]=p.read_text().strip()
        except OSError:
            pass
        report.setdefault('memory_checkpoints',[]).append({'phase':phase,**memory})
        (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps({'phase':phase,'providers':report.get('providers'),**memory}),flush=True)
    try:
        folder = args.reference / 'refine-off'
        if args.prepared_input:
            from browser_prepared_hr_input import load_prepared
            sample,size,input_sha=load_prepared(args.prepared_input,reference_id=args.reference.name)
            with Image.open(folder/'input-rgb.png') as image:
                if list(image.size)!=size:raise ValueError('Prepared input/reference image size mismatch')
            report['input_source']='sha_verified_prepared_f16'
            report['prepared_input_sha256']=input_sha
        else:
            import torch
            from torchvision import transforms
            torch.set_num_threads(args.threads)
            with Image.open(folder / 'input-rgb.png') as image:
                size = list(image.size)
                sample = transforms.Compose([transforms.Resize((2048, 2048)), transforms.ToTensor(),
                                             transforms.Normalize([.485, .456, .406], [.229, .224, .225])])(
                                                 image.convert('RGB')).unsqueeze(0).half().numpy()
            report['input_source']='pillow_torchvision_preprocessing'
        data = np.ascontiguousarray(sample)
        data.tofile(args.output / 'input.f16')
        (args.output / 'inputs.json').write_text(json.dumps({'cases': [{
            'id': args.reference.name, 'file': 'input.f16', 'shape': list(data.shape), 'dtype': 'float16',
            'original_size': size, 'sha256': hashlib.sha256(data.tobytes()).hexdigest(), 'bytes': data.nbytes,
        }]}, indent=2) + '\n')
        if args.prepare_only:
            report['status']='input_prepared_no_inference'
            report['scope']='HR preprocessing only; no ONNX session or model inference'
            report['prepared_input_sha256']=hashlib.sha256(data.tobytes()).hexdigest()
            checkpoint('input-prepared')
            return
        options = ort.SessionOptions()
        options.intra_op_num_threads = args.threads
        options.inter_op_num_threads = 1
        options.execution_order = ort.ExecutionOrder.PRIORITY_BASED if args.execution_order=='priority' else ort.ExecutionOrder.DEFAULT
        options.graph_optimization_level = {'all':ort.GraphOptimizationLevel.ORT_ENABLE_ALL,
            'basic':ort.GraphOptimizationLevel.ORT_ENABLE_BASIC,'disabled':ort.GraphOptimizationLevel.ORT_DISABLE_ALL}[args.optimization]
        options.enable_cpu_mem_arena = not args.disable_cpu_arena
        options.enable_mem_pattern = not args.disable_memory_pattern
        report['session_options']={'execution_order':args.execution_order,'optimization':args.optimization,
                                   'cpu_arena':options.enable_cpu_mem_arena,'memory_pattern':options.enable_mem_pattern}
        session=None
        checkpoint('session-create')
        inference_started = time.monotonic()
        if args.staged:
            import onnx
            from browser_native_staged import evaluate
            frozen=onnx.load(args.onnx,load_external_data=False)
            frozen=onnx.shape_inference.infer_shapes(frozen,strict_mode=True,data_prop=False)
            report['execution']='diagnostic_native_staged_complete_output_dependencies'
            report['providers']=['CPUExecutionProvider']
            report['session_options']={'execution_order':'dependency_depth_per_node','optimization':'disabled_per_node','cpu_arena':False,'memory_pattern':False,'threads':1}
            checkpoint('native-staged-inference')
            def node_checkpoint(row):
                (args.output/'last-node.json').write_text(json.dumps(row)+'\n')
                with (args.output/'node-trace.jsonl').open('a') as stream:stream.write(json.dumps(row)+'\n')
                if row['step']%32==0:print(json.dumps(row),flush=True)
            result,staged=evaluate(frozen,{'pixels':data},model_dir=args.onnx.parent,outputs=['alpha'],callback=node_checkpoint)
            actual=result['alpha']
            report['staged_execution']=staged
            del result,frozen
        else:
            session = ort.InferenceSession(str(args.onnx), sess_options=options, providers=['CPUExecutionProvider'])
            report['providers']=session.get_providers()
            checkpoint('native-inference')
            print(json.dumps({'phase': 'native-inference', 'shape': list(data.shape)}), flush=True)
            inference_started = time.monotonic()
            actual = session.run(['alpha'], {'pixels': data})[0]
        report['inference_seconds'] = time.monotonic() - inference_started
        if actual.shape != (1, 1, 2048, 2048) or actual.dtype != np.float32 or not np.isfinite(actual).all():
            raise ValueError('Output shape/dtype/finite check failed')
        actual.tofile(args.output / 'alpha-2048.f32')
        # Own the small output independently of the ORT arena, then release the
        # full model before loading Torch for postprocessing. Prepared inputs
        # require no Torch or torchvision during model execution.
        detached = actual.copy()
        del actual,session
        gc.collect()
        actual = detached
        checkpoint('session-released')
        if torch is None:
            import torch
            torch.set_num_threads(args.threads)
        checkpoint('postprocessing')
        resized = torch.nn.functional.interpolate(torch.from_numpy(actual), size=(size[1], size[0]),
                                                   mode='bilinear', align_corners=False)[0, 0].numpy()
        alpha = np.rint(resized * 255).clip(0, 255).astype(np.uint8)
        with Image.open(folder / 'alpha.png') as image:
            expected = np.asarray(image)
        with Image.open(folder / 'trimap.png') as image:
            trimap = np.asarray(image)
        report['metrics'] = measure(expected, alpha, trimap)
        report['anchor_note'] = 'HR does not clamp trimap anchors; anchor violation counts are descriptive only'
        Image.fromarray(alpha).save(args.output / 'alpha.png')
        report['status'] = 'native_metrics_measured_not_accepted'
    except Exception as error:
        report['status'] = 'failed'
        report['error_type'] = type(error).__name__
        raise
    finally:
        report['seconds'] = time.monotonic() - started
        report['peak_process_rss_bytes'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
        (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
