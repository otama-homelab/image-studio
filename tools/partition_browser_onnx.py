"""Plan contiguous ONNX stages using the official Extractor; never execute a model.

Logical output work is a cut heuristic, not a GPU/RAM bound. Constant-only
ancestors stay inside each extracted graph instead of becoming runtime feeds.
"""
import argparse
import gc
from collections import Counter
import hashlib
import json
import math
import os
from pathlib import Path
import resource
import time


def plan_stages(model, target_bytes):
    import onnx
    if not isinstance(target_bytes, int) or target_bytes < 1:
        raise ValueError('Positive logical output work target required')
    if model.functions or model.graph.sparse_initializer:
        raise ValueError('Functions and sparse initializers require separate analysis')
    nodes = list(model.graph.node)
    initializers = {x.name: x for x in model.graph.initializer}
    inputs = {x.name for x in model.graph.input}
    if inputs & initializers.keys():
        raise ValueError('Overridable initializers are not supported')
    infos = {x.name: x for x in list(model.graph.input) + list(model.graph.value_info) + list(model.graph.output)}
    sizes = {}
    for name, info in infos.items():
        if not info.type.HasField('tensor_type'):
            raise ValueError('Tensor-only graph required')
        t = info.type.tensor_type
        if not t.HasField('shape') or any(not d.HasField('dim_value') or d.dim_value < 0 for d in t.shape.dim):
            raise ValueError('Static tensor shape required: ' + name)
        dtype = onnx.helper.tensor_dtype_to_np_dtype(t.elem_type)
        if dtype.kind in ('O', 'U', 'S'):
            raise ValueError('Fixed-width tensor type required')
        sizes[name] = math.prod(d.dim_value for d in t.shape.dim) * dtype.itemsize
    known = inputs | initializers.keys()
    constant = set(initializers)
    constant_nodes = set()
    last_use = {}
    producers = {}
    for i, node in enumerate(nodes):
        if node.domain not in ('', 'ai.onnx') or any(a.type in (onnx.AttributeProto.GRAPH, onnx.AttributeProto.GRAPHS) for a in node.attribute):
            raise ValueError('Root standard-ONNX graph required')
        if node.op_type.startswith('Random') or node.op_type in ('Dropout', 'Bernoulli', 'Multinomial'):
            raise ValueError('Stateful/stochastic nodes cannot be duplicated or repartitioned')
        if any(x not in known for x in node.input if x):
            raise ValueError('Topologically serialized graph required')
        for x in node.input:
            if x:
                last_use[x] = i
        for x in node.output:
            if x:
                if x in known or x not in sizes:
                    raise ValueError('Unique output with static metadata required: ' + x)
                producers[x] = i
                known.add(x)
        if all(x in constant for x in node.input if x):
            constant.update(x for x in node.output if x)
            constant_nodes.add(i)
    final = {x.name for x in model.graph.output}
    if not final or not final <= producers.keys():
        raise ValueError('Node-produced final outputs required')
    for x in final:
        last_use[x] = len(nodes)
    costs = [0 if i in constant_nodes else sum(sizes[x] for x in n.output if x) for i, n in enumerate(nodes)]
    ranges = []
    start = 0
    while start < len(nodes):
        # Prefer cuts with less readback within the latter half of each work window.
        work = 0
        live = set()
        live_bytes = 0
        choices = []
        i = start
        while i < len(nodes):
            if work and work + costs[i] > target_bytes:
                break
            work += costs[i]
            for x in nodes[i].output:
                if x and x not in constant and last_use.get(x, -1) > i:
                    live.add(x)
                    live_bytes += sizes[x]
            for x in set(nodes[i].input):
                if x in live and last_use.get(x) == i:
                    live.remove(x)
                    live_bytes -= sizes[x]
            if costs[i] and work >= target_bytes // 2:
                choices.append((live_bytes, -(i + 1), work))
            i += 1
        if i == len(nodes):
            end = i
        elif choices:
            _, negative_end, _ = min(choices)
            end = -negative_end
        else:
            end = i
        if end <= start:
            raise ValueError('Cannot advance stage boundary')
        ranges.append((start, end))
        start = end
    stages = []
    for start, end in ranges:
        internal = {x for n in nodes[start:end] for x in n.output if x}
        ports_in = sorted({x for n in nodes[start:end] for x in n.input if x and x not in internal and x not in constant})
        ports_out = sorted(x for x in internal if x not in constant and last_use.get(x, -1) >= end)
        runtime_indices = [i for i in range(start, end) if i not in constant_nodes]
        if not runtime_indices:
            continue
        if not ports_out:
            raise ValueError('Unused runtime nodes require source graph pruning')
        for name in ports_in + ports_out:
            if infos[name].type.tensor_type.elem_type not in (onnx.TensorProto.FLOAT, onnx.TensorProto.FLOAT16):
                raise ValueError('Stage boundary must keep non-floating metadata constant: ' + name)
        stages.append({'start': start, 'end': end, 'inputs': ports_in, 'outputs': ports_out,
                       'logical_input_bytes': sum(sizes[x] for x in ports_in),
                       'logical_output_bytes': sum(sizes[x] for x in ports_out),
                       'logical_output_work_bytes': sum(costs[start:end]),
                       'runtime_node_indices': runtime_indices})
    return stages, {'constant_node_indices': constant_nodes, 'tensor_sizes': sizes, 'infos': infos}


def extract_stages(model, stages, analysis):
    """Official extraction, with independent source-record and coverage checks."""
    import onnx
    extractor = onnx.utils.Extractor(model)
    source_nodes = {n.SerializeToString(): i for i, n in enumerate(model.graph.node)}
    if len(source_nodes) != len(model.graph.node):
        raise ValueError('Distinct source node records required')
    weights = {x.name: x.SerializeToString() for x in model.graph.initializer}
    covered = Counter()
    for stage in stages:
        part = extractor.extract_model(stage['inputs'], stage['outputs'])
        if part.ir_version != model.ir_version or list(part.opset_import) != list(model.opset_import):
            raise ValueError('Extractor changed IR/opset contract')
        indices = [source_nodes[n.SerializeToString()] for n in part.graph.node]
        runtime = [i for i in indices if i not in analysis['constant_node_indices']]
        if runtime != stage['runtime_node_indices']:
            raise ValueError('Extractor omitted or duplicated runtime computation across a cut')
        if any(weights[x.name] != x.SerializeToString() for x in part.graph.initializer):
            raise ValueError('Extractor changed initializer records')
        for value in list(part.graph.input) + list(part.graph.output):
            if value.SerializeToString() != analysis['infos'][value.name].SerializeToString():
                raise ValueError('Extractor changed boundary tensor metadata')
        covered.update(runtime)
        yield part
    expected = set(range(len(model.graph.node))) - analysis['constant_node_indices']
    if set(covered) != expected or any(n != 1 for n in covered.values()):
        raise ValueError('All source runtime nodes must occur exactly once')


def pack_stages(model, stages, analysis, source_dir, output):
    """Use ONNX external-data helpers; verify each logical initializer's exact bytes."""
    import onnx
    from onnx import external_data_helper as ext
    records = []
    for index, part in enumerate(extract_stages(model, stages, analysis)):
        for node in part.graph.node:
            for attr in node.attribute:
                if any(ext.uses_external_data(t) for t in [attr.t, *attr.tensors]):
                    raise ValueError('External attribute tensors require separate packing support')
        original_nodes = [n.SerializeToString() for n in part.graph.node]
        ext.load_external_data_for_model(part, str(source_dir))
        ext.convert_model_from_external_data(part)
        expected = {}
        for tensor in part.graph.initializer:
            raw = tensor.raw_data if tensor.HasField('raw_data') else onnx.numpy_helper.to_array(tensor).tobytes()
            expected[tensor.name] = (tensor.data_type, list(tensor.dims), hashlib.sha256(raw).hexdigest())
            del raw
        directory = output / f'stage-{index:03d}'
        directory.mkdir(mode=0o700)
        graph_file = directory / 'model.onnx'
        onnx.save_model(part, graph_file, save_as_external_data=True,
                        all_tensors_to_one_file=True, location='model.onnx.data',
                        size_threshold=1024, convert_attribute=False)
        if original_nodes != [n.SerializeToString() for n in part.graph.node]:
            raise ValueError('Packing changed computational node records')
        for tensor in part.graph.initializer:
            if ext.uses_external_data(tensor):
                info = ext.ExternalDataInfo(tensor)
                if info.location != 'model.onnx.data' or info.offset is None or info.length is None:
                    raise ValueError('Unexpected packed external storage')
                digest = hashlib.sha256()
                with (directory / info.location).open('rb') as stream:
                    stream.seek(info.offset)
                    left = info.length
                    while left:
                        chunk = stream.read(min(left, 1024**2))
                        if not chunk:
                            raise ValueError('Truncated packed initializer')
                        digest.update(chunk)
                        left -= len(chunk)
                signature = digest.hexdigest()
            else:
                raw = tensor.raw_data if tensor.HasField('raw_data') else onnx.numpy_helper.to_array(tensor).tobytes()
                signature = hashlib.sha256(raw).hexdigest()
                del raw
            if (tensor.data_type, list(tensor.dims), signature) != expected[tensor.name]:
                raise ValueError('Packed initializer bytes/dtype/shape changed')
        onnx.checker.check_model(str(graph_file), full_check=False)
        files = []
        for file in sorted(directory.iterdir()):
            with file.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            files.append({'name': str(file.relative_to(output)), 'bytes': file.stat().st_size, 'sha256': digest})
        records.append({'stage': index, 'checker_passed': True, 'logical_initializer_bytes_preserved': True, 'files': files})
        del part
        gc.collect()
    return records


def describe_tensor(value, size):
    import onnx
    t = value.type.tensor_type
    return {'name': value.name, 'dtype': onnx.TensorProto.DataType.Name(t.elem_type),
            'shape': [d.dim_value for d in t.shape.dim], 'logical_bytes': size}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--onnx', type=Path, required=True)
    parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--target-mib', type=int, default=4096)
    parser.add_argument('--pack', action='store_true', help='Pack verified stage artifacts with official ONNX external-data helpers')
    parser.add_argument('--external-sha256', help='Required source model.onnx.data SHA when packing')
    args = parser.parse_args()
    if args.output.exists() or args.target_mib < 1:
        parser.error('New output directory and positive work target required')
    os.environ['OPENBLAS_NUM_THREADS'] = '1'
    resource.setrlimit(resource.RLIMIT_AS, ((2048 if args.pack else 1536) * 1024**2,) * 2)
    import onnx
    started = time.monotonic()
    binary = args.onnx.read_bytes()
    if hashlib.sha256(binary).hexdigest() != args.source_sha256:
        parser.error('Source graph SHA mismatch')
    source = onnx.load_model_from_string(binary)  # external data is deliberately not loaded
    model = onnx.shape_inference.infer_shapes(source, strict_mode=True, data_prop=False)
    for a, b in [(source.graph.node, model.graph.node), (source.graph.initializer, model.graph.initializer)]:
        if [x.SerializeToString() for x in a] != [x.SerializeToString() for x in b]:
            raise ValueError('Shape inference changed computational records')
    if args.pack:
        if not args.external_sha256:
            parser.error('Packing requires fixed source external SHA')
        locations = {dict((e.key, e.value) for e in t.external_data).get('location') for t in model.graph.initializer if onnx.external_data_helper.uses_external_data(t)}
        if locations != {'model.onnx.data'}:
            parser.error('Expected the captured single external weight file')
        with (args.onnx.parent / 'model.onnx.data').open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != args.external_sha256:
                parser.error('Source external weight SHA mismatch')
    stages, analysis = plan_stages(model, args.target_mib * 1024**2)
    records = []
    for index, (stage, part) in enumerate(zip(stages, extract_stages(model, stages, analysis), strict=True)):
        records.append({**{k: v for k, v in stage.items() if k != 'runtime_node_indices'},
                        'stage': index, 'runtime_nodes': len(stage['runtime_node_indices']),
                        'constant_nodes': len(part.graph.node) - len(stage['runtime_node_indices']),
                        'graph_metadata_bytes': part.ByteSize(),
                        'initializer_logical_bytes': sum(math.prod(t.dims) * onnx.helper.tensor_dtype_to_np_dtype(t.data_type).itemsize for t in part.graph.initializer),
                        'ports': {kind: [describe_tensor(v, analysis['tensor_sizes'][v.name]) for v in getattr(part.graph, kind)] for kind in ('input', 'output')}})
        del part
        gc.collect()
    report = {'status': 'official-extractor-structure-verified-no-inference', 'onnx_version': onnx.__version__,
              'source_graph_sha256': args.source_sha256, 'source_nodes': len(model.graph.node),
              'constant_source_nodes': len(analysis['constant_node_indices']), 'stages': records,
              'stage_count': len(records), 'logical_output_work_target_bytes': args.target_mib * 1024**2,
              'total_readback_bytes': sum(s['logical_output_bytes'] for s in records),
              'total_upload_bytes': sum(s['logical_input_bytes'] for s in records),
              'total_initializer_logical_bytes': sum(s['initializer_logical_bytes'] for s in records),
              'runtime_nodes_preserved_exactly_once': True, 'initializer_records_preserved': True,
              'external_weight_bytes_read': 0, 'sessions_created': 0, 'gpu_requests': 0,
              'seconds': time.monotonic() - started, 'peak_rss_bytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
              'limits': ['Output work/cut sizes are not GPU/RAM allocation bounds', 'No learned weights loaded or files copied',
                         'Constant-only ancestors can be duplicated across stages; runtime node records are exact and disjoint',
                         'Graph metadata/external references checked structurally; full checker, packed artifacts, numerical/runtime/resource/quality acceptance remain',
                         'Boundary transfers include model tensors only; host registry peaks, GPU workspace, allocator and browser overhead omitted']}
    args.output.mkdir(mode=0o700)
    if args.pack:
        (args.output / 'report.json').write_text(json.dumps({**report, 'status': 'packing-not-complete'}, indent=2) + '\n')
        report['artifacts'] = pack_stages(model, stages, analysis, args.onnx.parent, args.output)
        report.update(status='packed-checked-not-executed', external_weight_bytes_read='Source SHA verified; per-stage selected tensors loaded by official helpers', source_external_sha256=args.external_sha256, seconds=time.monotonic()-started, peak_rss_bytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*1024)
        report['limits'] = [x for x in report['limits'] if not x.startswith(('No learned weights', 'Graph metadata/external'))] + ['Packed graphs/checker and per-initializer byte/dtype/shape equality verified; actual numerical/GPU/resource/quality acceptance remains']
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ['status', 'stage_count', 'total_readback_bytes', 'total_upload_bytes', 'total_initializer_logical_bytes', 'seconds', 'peak_rss_bytes']}))


if __name__ == '__main__':
    main()
