"""Rewrite the pinned HR graph only; never creates an inference session.

All original initializers and external bytes are retained. Candidate arithmetic
is FP32 inside each DeformConv replacement, with original FP16 output. It is
experimental and must pass full native and WebGPU quality/memory checks.
"""
import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import resource
import time

SOURCE_SHA = '6b7dcdd58e257ffebad013d3cf58b6f727457148d4eb1741f1399f87ec17f6e4'
DATA_SHA = '364eab4994414fb107c1ec7680dd98202ec4ddb3b8d3dcc87f5a5f887890bb7c'


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def copy_verified(source, target, expected_sha):
    """Independent regular file: ONNX rejects both symbolic and hard links."""
    digest = hashlib.sha256()
    with source.open('rb') as reader, target.open('xb') as writer:
        while chunk := reader.read(1024 * 1024):
            writer.write(chunk)
            digest.update(chunk)
    if digest.hexdigest() != expected_sha:
        raise ValueError('Copied external data SHA mismatch')
    if target.is_symlink() or target.stat().st_nlink != 1:
        raise ValueError('External data must be an independent regular file')


def rewrite(model, *, expected_count):
    """Replace supported static single-group nodes; reject ambiguous contracts."""
    import onnx
    from onnx import helper as h, compose
    from browser_deformconv_graph import build
    graph = model.graph
    original_initializers = {tensor.name: tensor.SerializeToString() for tensor in graph.initializer}
    original_io = ([v.SerializeToString() for v in graph.input], [v.SerializeToString() for v in graph.output])
    specs = {v.name: v for v in list(graph.input) + list(graph.value_info) + list(graph.output)}
    weights = {tensor.name: tensor for tensor in graph.initializer}
    names = {name for node in graph.node for name in list(node.input) + list(node.output)} | set(weights)

    def shape_and_kind(name):
        if name in weights:
            v = weights[name]
            return list(v.dims), v.data_type
        if name not in specs:
            raise ValueError(f'Missing shape/type: {name}')
        t = specs[name].type.tensor_type
        if not t.HasField('shape') or any(not d.HasField('dim_value') or d.dim_value <= 0 for d in t.shape.dim):
            raise ValueError(f'Need positive static shape: {name}')
        return [d.dim_value for d in t.shape.dim], t.elem_type

    nodes, constants, replacements = [], [], []
    for node in graph.node:
        if node.op_type != 'DeformConv' or node.domain not in ('', 'ai.onnx'):
            nodes.append(node)
            continue
        if len(node.input) != 5 or any(not i for i in node.input) or len(node.output) != 1:
            raise ValueError('Pinned HR replacement requires all five inputs and one output')
        attrs = {a.name: h.get_attribute_value(a) for a in node.attribute}
        if set(attrs) - {'group', 'offset_group', 'pads', 'strides', 'dilations', 'kernel_shape'}:
            raise ValueError(f'Unexpected DeformConv attributes: {attrs}')
        if attrs.get('group', 1) != 1 or attrs.get('offset_group', 1) != 1:
            raise ValueError('Grouped DeformConv needs a separate verified implementation')
        xshape, dtype = shape_and_kind(node.input[0])
        wshape, wtype = shape_and_kind(node.input[1])
        if dtype != onnx.TensorProto.FLOAT16 or dtype != wtype or xshape[0] != 1:
            raise ValueError('Pinned HR replacement requires batch1/FP16')
        if len(xshape) != 4 or len(wshape) != 4 or wshape[1] != xshape[1]:
            raise ValueError('Unexpected input/weight rank or channel shape')
        if attrs.get('kernel_shape', wshape[2:]) != wshape[2:]:
            raise ValueError('Kernel attribute/weight mismatch')
        pads, strides, dilations = attrs.get('pads', [0]*4), attrs.get('strides', [1]*2), attrs.get('dilations', [1]*2)
        if len(pads) != 4 or len(strides) != 2 or len(dilations) != 2 or min(strides+dilations) < 1 or min(pads) < 0:
            raise ValueError('Invalid spatial attributes')
        _, candidate, expected = build(xshape, wshape, dtype, pads=pads, strides=strides,
                                       dilations=dilations, mask=True, bias=True)
        for name, (_, expected_shape) in zip(node.input, expected):
            actual_shape, actual_kind = shape_and_kind(name)
            if actual_shape != list(expected_shape) or actual_kind != dtype:
                raise ValueError(f'Input shape/type mismatch: {name}')
        expected_output = [d.dim_value for d in candidate.graph.output[0].type.tensor_type.shape.dim]
        if shape_and_kind(node.output[0]) != (expected_output, dtype):
            raise ValueError('Output shape/type mismatch')
        prefix = f'browser_deform_{len(replacements):03d}__'
        if any(name.startswith(prefix) for name in names):
            raise ValueError('Replacement namespace collides with source graph')
        candidate = compose.add_prefix(candidate, prefix)
        mapping = {prefix + key: value for key, value in zip(['x', 'weight', 'offset', 'bias', 'mask'], node.input)}
        mapping[prefix + 'y'] = node.output[0]
        for item in candidate.graph.node:
            item.input[:] = [mapping.get(value, value) for value in item.input]
            item.output[:] = [mapping.get(value, value) for value in item.output]
            nodes.append(item)
        constants.extend(candidate.graph.initializer)
        replacements.append({'name': node.name, 'input_shape': xshape, 'weight_shape': wshape,
                             'output_shape': expected_output, 'nodes': len(candidate.graph.node)})
    if len(replacements) != expected_count:
        raise ValueError(f'Expected {expected_count} replacements, got {len(replacements)}')
    del graph.node[:]
    graph.node.extend(nodes)
    graph.initializer.extend(constants)
    # Byte equality here covers metadata and inline values; external file is SHA-checked by main.
    actual = {tensor.name: tensor.SerializeToString() for tensor in graph.initializer}
    if any(actual[name] != value for name, value in original_initializers.items()):
        raise ValueError('Original initializer changed')
    if original_io != ([v.SerializeToString() for v in graph.input], [v.SerializeToString() for v in graph.output]):
        raise ValueError('Original model IO changed')
    return replacements


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--onnx', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='New private directory outside repository')
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    if args.output.exists() or args.output.resolve().is_relative_to(repo):
        parser.error('Choose a new private output directory outside repository')
    resource.setrlimit(resource.RLIMIT_AS, (1024**3,) * 2)
    os.environ['OPENBLAS_NUM_THREADS'] = '1'
    os.environ['OMP_NUM_THREADS'] = '1'
    if sha(args.onnx) != SOURCE_SHA:
        parser.error('Source ONNX is not the pinned exported HR graph')
    source_data = args.onnx.parent / 'model.onnx.data'
    import onnx
    model = onnx.load(args.onnx, load_external_data=False)
    if next((i.version for i in model.opset_import if i.domain == ''), None) != 19:
        parser.error('Expected opset19')
    for tensor in model.graph.initializer:
        external = {entry.key: entry.value for entry in tensor.external_data}
        if external and external.get('location') != 'model.onnx.data':
            parser.error('Unexpected external data reference')
    args.output.mkdir(mode=0o700)
    report = {'status': 'started', 'scope': 'Full graph structural rewrite only, no inference',
              'source_graph_sha256': SOURCE_SHA, 'external_data_sha256': DATA_SHA,
              'precision': 'original FP16 IO/weights; FP32 sampling/accumulation inside replacements',
              'full_native_compared': False, 'webgpu_executed': False, 'acceptance': 'pending',
              'distribution_ready': False, 'virtual_memory_limit_bytes': 1024**3,
              'external_data_verified': False,
              'source_files_sha256': {name: sha(Path(__file__).parent / name) for name in
                 ['rewrite_browser_birefnet_deformconv.py', 'browser_deformconv_graph.py']}}
    started = time.monotonic()
    try:
        copy_verified(source_data, args.output / 'model.onnx.data', DATA_SHA)
        report['external_data_verified'] = True
        report['replacements'] = rewrite(model, expected_count=20)
        report['operators'] = dict(sorted(Counter(n.op_type for n in model.graph.node).items()))
        output = args.output / 'model.onnx'
        output.write_bytes(model.SerializeToString())
        onnx.checker.check_model(str(output), full_check=False)
        report['graph'] = {'bytes': output.stat().st_size, 'sha256': sha(output)}
        report['original_initializer_records_preserved'] = True
        report['original_io_preserved'] = True
        report['external_storage'] = 'independent regular file, byte-identical SHA, copied in 1MiB chunks'
        report['status'] = 'structurally_checked_not_compared'
    except Exception as error:
        report['status'] = 'failed'
        report['error_type'] = type(error).__name__
        raise
    finally:
        report['seconds'] = time.monotonic() - started
        report['peak_process_rss_bytes'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
        (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ['status', 'seconds', 'peak_process_rss_bytes', 'graph']}), flush=True)


if __name__ == '__main__':
    main()
