"""Extract original ancestors of one tensor for diagnostics, not model acceptance."""
import argparse
import copy
import hashlib
import json
from pathlib import Path


def extract(model, tensor):
    import onnx
    from browser_native_staged import execution_order
    infos = {v.name:v for v in list(model.graph.input)+list(model.graph.value_info)+list(model.graph.output)}
    if tensor not in infos:
        raise ValueError('Checkpoint needs original tensor type and shape metadata')
    info = infos[tensor]
    if info.type.tensor_type.elem_type not in (onnx.TensorProto.FLOAT, onnx.TensorProto.FLOAT16):
        raise ValueError('Checkpoint must be FP16 or FP32')
    dims = info.type.tensor_type.shape.dim
    if not dims or any(not d.HasField('dim_value') or d.dim_value < 1 for d in dims):
        raise ValueError('Checkpoint needs a fixed positive shape')
    indices = sorted(execution_order(model, [tensor]))
    nodes = [model.graph.node[i] for i in indices]
    used = {x for node in nodes for x in node.input if x}
    output_name = tensor
    result = copy.deepcopy(model)
    del result.graph.node[:]
    result.graph.node.extend(nodes)
    del result.graph.initializer[:]
    result.graph.initializer.extend(v for v in model.graph.initializer if v.name in used)
    del result.graph.output[:]
    out = copy.deepcopy(info)
    result.graph.output.append(out)
    # Retain metadata only for tensors still present in this diagnostic graph.
    live = used | {x for n in nodes for x in n.output}
    del result.graph.value_info[:]
    result.graph.value_info.extend(v for v in model.graph.value_info if v.name in live)
    return result, {'checkpoint_tensor':tensor,'original_source_nodes':len(model.graph.node),
                    'retained_original_nodes':len(indices),'observer_nodes':0,
                    'output_name':output_name,'output_shape':[d.dim_value for d in dims],
                    'output_dtype':'float16' if info.type.tensor_type.elem_type==onnx.TensorProto.FLOAT16 else 'float32',
                    'input_names':[v.name for v in model.graph.input],
                    'retained_initializers':len(result.graph.initializer),
                    'scope':'Original ancestor subgraph and output dtype; no observer arithmetic; not full-model acceptance'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--onnx',type=Path,required=True)
    parser.add_argument('--source-sha256',required=True)
    parser.add_argument('--tensor',required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--infer-types',action='store_true',help='Infer metadata for rewrite-generated tensors; original node/initializer records must remain identical')
    args=parser.parse_args()
    if args.output.exists() or args.output.with_suffix('.report.json').exists():
        parser.error('Choose new diagnostic output paths')
    if args.output.parent.resolve()!=args.onnx.parent.resolve():
        parser.error('Keep output beside source graph so original external data resolves without copies or links')
    binary=args.onnx.read_bytes();digest=hashlib.sha256(binary).hexdigest()
    if digest!=args.source_sha256:parser.error('Source graph SHA mismatch')
    import onnx
    source=onnx.load_model_from_string(binary)
    if args.infer_types:
        inferred=onnx.shape_inference.infer_shapes(source,strict_mode=True,data_prop=False)
        for before,after in [(source.graph.node,inferred.graph.node),(source.graph.initializer,inferred.graph.initializer)]:
            if [x.SerializeToString() for x in before]!=[x.SerializeToString() for x in after]:
                raise ValueError('Shape inference changed original computational records')
        source=inferred
    graph,report=extract(source,args.tensor)
    with args.output.open('xb') as stream:stream.write(graph.SerializeToString())
    onnx.checker.check_model(str(args.output),full_check=False)
    report.update(status='diagnostic_graph_checked_not_executed',source_graph_sha256=digest,
                  shape_metadata_inferred=args.infer_types,
                  graph={'name':args.output.name,'bytes':args.output.stat().st_size,
                         'sha256':hashlib.sha256(args.output.read_bytes()).hexdigest()})
    args.output.with_suffix('.report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))


if __name__=='__main__':main()
