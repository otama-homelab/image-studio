"""Static root-graph tensor sizes; no session or tensor execution.

The liveness simulation assumes literal node order and fresh output allocations.
It is neither measured VRAM nor a bound on an ORT execution plan/workspaces.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
import os
from pathlib import Path
import resource
import time
import tempfile


def analyze(model, *, buffer_limit, binding_limit):
    import onnx
    sizes = {onnx.TensorProto.FLOAT: 4, onnx.TensorProto.FLOAT16: 2,
             onnx.TensorProto.BFLOAT16: 2, onnx.TensorProto.DOUBLE: 8,
             onnx.TensorProto.INT64: 8, onnx.TensorProto.UINT64: 8,
             onnx.TensorProto.INT32: 4, onnx.TensorProto.UINT32: 4,
             onnx.TensorProto.INT16: 2, onnx.TensorProto.UINT16: 2,
             onnx.TensorProto.INT8: 1, onnx.TensorProto.UINT8: 1,
             onnx.TensorProto.BOOL: 1, onnx.TensorProto.COMPLEX64: 8,
             onnx.TensorProto.COMPLEX128: 16}
    graph = model.graph
    tensors = {}

    def register(name, dtype, shape):
        known = dtype in sizes and shape is not None
        tensors[name] = {'name': name, 'dtype': onnx.TensorProto.DataType.Name(dtype),
                         'shape': shape, 'logical_bytes': math.prod(shape) * sizes[dtype] if known else None}

    for value in list(graph.input) + list(graph.value_info) + list(graph.output):
        if not value.type.HasField('tensor_type'):
            continue
        t = value.type.tensor_type
        shape = [d.dim_value for d in t.shape.dim] if t.HasField('shape') and all(
            d.HasField('dim_value') and d.dim_value >= 0 for d in t.shape.dim) else None
        register(value.name, t.elem_type, shape)
    for value in graph.initializer:
        register(value.name, value.data_type, list(value.dims))
    all_values = {name for node in graph.node for name in list(node.input)+list(node.output) if name}
    all_values.update(value.name for value in graph.input)
    unknown = sorted(name for name in all_values if name not in tensors or tensors[name]['logical_bytes'] is None)
    initializers = {v.name for v in graph.initializer}
    producer = {name: {'node': node.name, 'op': node.op_type} for node in graph.node for name in node.output}
    referenced = all_values | initializers | {v.name for v in graph.output}
    ranked = sorted((dict(t, producer=producer.get(t['name'])) for t in tensors.values() if t['logical_bytes'] is not None and t['name'] in referenced),
                    key=lambda t: t['logical_bytes'], reverse=True)
    persistent = sum(tensors[name]['logical_bytes'] or 0 for name in initializers)
    remaining = Counter(name for node in graph.node for name in node.input if name)
    # Keep final outputs alive even if the graph has no consumers for them.
    remaining.update(value.name for value in graph.output)
    live = {v.name for v in graph.input if v.name not in initializers}

    def bytes_of(names):
        return sum(tensors.get(name, {}).get('logical_bytes') or 0 for name in names)

    peak = {'known_activation_bytes': bytes_of(live), 'node': 'graph-inputs', 'index': -1}
    for index, node in enumerate(graph.node):
        live.update(name for name in node.output if name)
        current = bytes_of(live)
        if current > peak['known_activation_bytes']:
            peak = {'known_activation_bytes': current, 'node': node.name, 'index': index}
        for name in node.input:
            if name:
                remaining[name] -= 1
                if remaining[name] == 0:
                    live.discard(name)
        for name in node.output:
            if remaining[name] == 0:
                live.discard(name)
    maximum = ranked[0]['logical_bytes'] if ranked else None
    custom = [{'node': n.name, 'op': n.op_type, 'domain': n.domain} for n in graph.node if n.domain not in ('', 'ai.onnx')]
    return {'scope': 'Static logical tensor bytes, root graph only; not measured GPU/CPU allocation',
            'node_count': len(graph.node), 'known_tensor_count': len(ranked),
            'unknown_value_count': len(unknown), 'unknown_values': unknown,
            'custom_domain_nodes': custom, 'local_function_definitions': len(model.functions),
            'max_known_tensor_bytes': maximum, 'largest_tensors': ranked[:20],
            'target_limits': {'maxBufferSize': buffer_limit, 'maxStorageBufferBindingSize': binding_limit},
            'known_tensors_exceed_buffer': [t for t in ranked if t['logical_bytes'] > buffer_limit],
            'known_tensors_exceed_binding': [t for t in ranked if t['logical_bytes'] > binding_limit],
            'all_root_tensor_sizes_known': not unknown,
            'all_known_logical_tensors_within_limits': maximum is not None and maximum <= min(buffer_limit, binding_limit),
            'idealized_literal_order_liveness': {**peak, 'persistent_initializer_logical_bytes': persistent,
                'known_activation_plus_initializers': peak['known_activation_bytes']+persistent,
                'complete_root_shapes': not unknown,
                'assumptions': ['literal graph order', 'fresh output allocation', 'release after final consumer',
                    'all initializers persistent', 'unknown sizes contribute zero and are explicitly listed'],
                'omitted': ['EP partition and graph optimization', 'kernel workspace', 'allocator rounding/cache',
                    'CPU/GPU copies', 'upload buffers', 'device resources', 'function bodies', 'view aliasing']}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--onnx', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--buffer-limit', type=int, required=True)
    parser.add_argument('--binding-limit', type=int, required=True)
    args = parser.parse_args()
    if args.output.exists() or min(args.buffer_limit, args.binding_limit) < 1:
        parser.error('Choose a new report; require positive recorded target limits')
    resource.setrlimit(resource.RLIMIT_AS, (1024**3,) * 2)
    os.environ['OPENBLAS_NUM_THREADS'] = '1'
    import onnx
    started = time.monotonic()
    report = {'status': 'started', 'source_graph': args.onnx.name,
              'virtual_memory_limit_bytes': 1024**3, 'inference_executed': False}
    try:
        with args.onnx.open('rb') as stream:
            report['graph_sha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
        # Official path API avoids ModelProto -> Python bytes -> ModelProto copies.
        # Always give a separate output path: the default would overwrite the source.
        # Type/shape propagation only; no tensor data propagation or model session.
        with tempfile.TemporaryDirectory(prefix='image-studio-onnx-shapes-') as temporary:
            inferred = Path(temporary) / 'inferred.onnx'
            onnx.shape_inference.infer_shapes_path(args.onnx, inferred, strict_mode=True, data_prop=False)
            model = onnx.load(inferred, load_external_data=False)
            report.update(analyze(model, buffer_limit=args.buffer_limit, binding_limit=args.binding_limit))
        report['shape_inference_api'] = 'onnx.shape_inference.infer_shapes_path'

        report['status'] = 'static_shapes_measured_not_runtime_accepted'
    except Exception as error:
        report['status'] = 'failed'
        report['error_type'] = type(error).__name__
        report['error'] = str(error)
        raise
    finally:
        report['seconds'] = time.monotonic()-started
        report['peak_process_rss_bytes'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024
        args.output.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({key: report[key] for key in ['status', 'seconds', 'max_known_tensor_bytes', 'unknown_value_count', 'idealized_literal_order_liveness']}))


if __name__ == '__main__':
    main()
