"""Partition the pinned CPU query-chunk ViTMatte graph into three official ORT sessions.

Only the two decoder cuts use ONNX Extractor: Loop lexical captures remain
inside the unchanged contiguous backbone prefix. No learned values change.
"""
import argparse
from pathlib import Path
from collections import Counter
import copy
import hashlib
import json
import shutil
import tempfile
import onnx
from onnx.utils import Extractor

SOURCE_SHA256 = 'fddb32c6769fdd08f07b7ef6d5097734ca00809319578b98d4cae4b0e8216dec'
EXTERNAL_SHA256 = 'a7307d78560ead989cb4eb432982ca19bb0cf54834070afe377ad7a0d1b9fcf6'
GPU_SOURCE_SHA256 = '04a55400dc2ef3c938b5bb5455155c4b34b7d97821dc87402a18b2027016bbde'


def validate_source_graph(binary):
    source_sha=hashlib.sha256(binary).hexdigest()
    if source_sha not in [SOURCE_SHA256,GPU_SOURCE_SHA256]:raise ValueError('Pinned source graph required')
    model=onnx.load_model_from_string(binary)
    if source_sha==GPU_SOURCE_SHA256:
        loops=[n for n in model.graph.node if n.op_type=='Loop']
        if len(loops)!=48 or sum(n.op_type=='Softmax' for n in model.graph.node)!=8 or any(sum(n.op_type=='MultiHeadAttention' for n in next(a.g for a in node.attribute if a.name=='body').node)!=1 for node in loops):raise ValueError('Pinned GPU Loop structure required')
    return model,source_sha


def partition(model):
    nodes = list(model.graph.node)
    infos = {v.name: v for v in [*model.graph.input, *model.graph.value_info, *model.graph.output]}
    cuts = [i for i, node in enumerate(nodes) if list(node.output) == ['add_13650']]
    if len(cuts) != 1 or 'add_13650' not in infos or 'relu_5' not in infos:
        raise ValueError('Missing or ambiguous phase boundary')
    prefix = copy.deepcopy(model)
    del prefix.graph.node[:]
    prefix.graph.node.extend(nodes[:cuts[0] + 1])
    del prefix.graph.output[:]
    prefix.graph.output.append(infos['add_13650'])

    def referenced(graph):
        result = {value for node in graph.node for value in node.input if value}
        for node in graph.node:
            for attribute in node.attribute:
                if attribute.type == onnx.AttributeProto.GRAPH:
                    result |= referenced(attribute.g)
        return result

    used = referenced(prefix.graph)
    initializers = [tensor for tensor in prefix.graph.initializer if tensor.name in used]
    del prefix.graph.initializer[:]
    prefix.graph.initializer.extend(initializers)
    live = used | {name for node in prefix.graph.node for name in node.output}
    values = [value for value in prefix.graph.value_info if value.name in live]
    del prefix.graph.value_info[:]
    prefix.graph.value_info.extend(values)
    # Extractor does not follow Loop lexical captures; only extract decoder cuts.
    stages = [prefix,
              Extractor(model).extract_model(['pixel_values', 'add_13650'], ['relu_5']),
              Extractor(model).extract_model(['pixel_values', 'relu_5'], ['alphas'])]
    original = Counter(node.name for node in nodes if node.op_type != 'Constant')
    actual = Counter(node.name for stage in stages for node in stage.graph.node if node.op_type != 'Constant')
    if actual != original:
        raise ValueError('Runtime node coverage changed')
    source_nodes = {node.name: node.SerializeToString() for node in nodes}
    for stage in stages:
        for node in stage.graph.node:
            if node.SerializeToString() != source_nodes[node.name]:
                raise ValueError('Source node record changed')
    return stages


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--onnx', type=Path, required=True)
    parser.add_argument('--external', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Need new output directory')
    binary = args.onnx.read_bytes()
    try:model,source_sha=validate_source_graph(binary)
    except ValueError as error:parser.error(str(error))
    external = args.external or args.onnx.parent / 'model.onnx.data'
    with external.open('rb') as stream:
        if external.name != 'model.onnx.data' or hashlib.file_digest(stream, 'sha256').hexdigest() != EXTERNAL_SHA256:
            parser.error('Pinned external weights required')
    stages = partition(model)
    records, outputs = [], []
    with tempfile.TemporaryDirectory(prefix='vitmatte-phases-check-') as temporary:
        temp = Path(temporary)
        if source_sha==SOURCE_SHA256:shutil.copyfile(external, temp / 'model.onnx.data')
        for i, stage in enumerate(stages):
            loaded = 0
            if i:
                for tensor in stage.graph.initializer:
                    if onnx.external_data_helper.uses_external_data(tensor):
                        onnx.external_data_helper.load_external_data_for_tensor(tensor, str(external.parent))
                        loaded += len(tensor.raw_data)
                        tensor.data_location = onnx.TensorProto.DEFAULT
                        del tensor.external_data[:]
                onnx.checker.check_model(stage)
            elif source_sha==GPU_SOURCE_SHA256:
                with tempfile.NamedTemporaryFile(dir=external.parent,prefix='.phase-check-',suffix='.onnx') as stream:
                    stream.write(stage.SerializeToString());stream.flush();onnx.checker.check_model(stream.name)
            else:
                (temp / 'model.onnx').write_bytes(stage.SerializeToString())
                onnx.checker.check_model(str(temp / 'model.onnx'))
            data = stage.SerializeToString()
            outputs.append(data)
            records.append({'phase': i, 'file': f'phase-{i}.onnx', 'bytes': len(data),
                            'sha256': hashlib.sha256(data).hexdigest(),
                            'inputs': [v.name for v in stage.graph.input],
                            'outputs': [v.name for v in stage.graph.output],
                            'nodes': len(stage.graph.node), 'externalWeightsRequired': i == 0,
                            'inlineExternalTensorBytes': loaded})
    args.output.mkdir(mode=0o700)
    for record, data in zip(records, outputs):
        (args.output / record['file']).write_bytes(data)
    report = {'status': 'three-phase-graphs-checked-not-inferred', 'sourceGraphSha256': source_sha,
              'externalSha256': EXTERNAL_SHA256, 'phases': records, 'runtimeNodesPreservedExactlyOnce': True,
              'nodeRecordsUnchanged': True, 'weightsRequantized': False, 'checkerTemporaryWeightCopyRemoved': True,
              'limits': ['Graph partition validation only; acceptance evidence belongs to fixed browser candidates.']}
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
