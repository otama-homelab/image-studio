"""CPU-only query-row chunks for the pinned headwise ViTMatte ONNX graph.

All keys, softmax normalization and decomposed relative-position terms remain.
No learned tensors change. This does not approve numerical quality or release.
"""
import argparse
from collections import defaultdict
import copy
import hashlib
import json
import shutil
import tempfile
from pathlib import Path

SOURCE_SHA256 = 'cf0d2103d49cc7e3938ce219d1bebfc623c2661c5e1309f9b97751df444c5592'
EXTERNAL_SHA256 = 'a7307d78560ead989cb4eb432982ca19bb0cf54834070afe377ad7a0d1b9fcf6'


def chunk_attention_nodes(prefix, query, key, value, relative_h, relative_w, output, rows=8):
    from onnx import helper as h, TensorProto as t
    if type(rows) is not int or not 1 <= rows <= 8:
        raise ValueError('Query chunk rows must be 1..8')
    def name(text): return prefix + '/' + text
    def node(op, inputs, out, **attributes):
        return h.make_node(op, inputs, [name(out)], name=name(out), **attributes)
    def constant(text, values, scalar=False, dtype=t.INT64):
        return node('Constant', [], text, value=h.make_tensor(name(text), dtype, [] if scalar else [len(values)], values))
    nodes = [constant('one', [1], True), constant('two', [2], True), constant('rows', [rows], True),
             constant('rows_minus_one', [rows - 1], True), constant('axis0', [0]), constant('axis1', [1]),
             constant('one_vec', [1]), constant('minus_one_vec', [-1]), constant('empty_shape', [1, 0, 64]),
             constant('true', [True], True, t.BOOL), node('Shape', [relative_h], 'relative_shape'),
             node('Gather', [name('relative_shape'), name('one')], 'height', axis=0),
             node('Gather', [name('relative_shape'), name('two')], 'width', axis=0),
             node('Add', [name('height'), name('rows_minus_one')], 'rounded_height'),
             node('Div', [name('rounded_height'), name('rows')], 'trip_count'),
             node('Mul', [name('height'), name('width')], 'tokens'),
             node('Unsqueeze', [name('tokens'), name('axis0')], 'tokens_vec'),
             node('ConstantOfShape', [name('empty_shape')], 'empty')]
    body = [node('Mul', [name('iteration'), name('rows')], 'start'),
            node('Add', [name('start'), name('rows')], 'proposed_end'),
            node('Min', [name('proposed_end'), name('height')], 'end'),
            node('Sub', [name('end'), name('start')], 'active_rows'),
            node('Mul', [name('start'), name('width')], 'query_start'),
            node('Mul', [name('end'), name('width')], 'query_end')]
    for text in ['start', 'end', 'query_start', 'query_end', 'active_rows', 'height', 'width']:
        body.append(node('Unsqueeze', [name(text), name('axis0')], text + '_vec'))
    for text, source, start, end in [('query', query, 'query_start_vec', 'query_end_vec'),
                                     ('rh', relative_h, 'start_vec', 'end_vec'), ('rw', relative_w, 'start_vec', 'end_vec')]:
        body.append(node('Slice', [source, name(start), name(end), name('axis1')], 'slice_' + text))
    body.extend([node('MatMul', [name('slice_query'), key], 'scores'),
                 node('Concat', [name('one_vec'), name('active_rows_vec'), name('width_vec'), name('height_vec'), name('width_vec')], 'shape5', axis=0),
                 node('Reshape', [name('scores'), name('shape5')], 'scores5'),
                 node('Add', [name('scores5'), name('slice_rh')], 'with_h'),
                 node('Add', [name('with_h'), name('slice_rw')], 'with_w'),
                 node('Concat', [name('one_vec'), name('minus_one_vec'), name('tokens_vec')], 'shape3', axis=0),
                 node('Reshape', [name('with_w'), name('shape3')], 'flat'),
                 node('Softmax', [name('flat')], 'probability', axis=-1),
                 node('MatMul', [name('probability'), value], 'block'),
                 node('Concat', [name('carry'), name('block')], 'next_carry', axis=1),
                 node('Identity', [name('condition')], 'next_condition')])
    graph = h.make_graph(body, name('body'), [h.make_tensor_value_info(name('iteration'), t.INT64, []),
                         h.make_tensor_value_info(name('condition'), t.BOOL, []),
                         h.make_tensor_value_info(name('carry'), t.FLOAT, [1, None, 64])],
                        [h.make_tensor_value_info(name('next_condition'), t.BOOL, []),
                         h.make_tensor_value_info(name('next_carry'), t.FLOAT, [1, None, 64])])
    nodes.append(h.make_node('Loop', [name('trip_count'), name('true'), name('empty')], [output], name=name('loop'), body=graph))
    return nodes


def loop_mha_nodes(prefix, query, key, value, relative_h, relative_w, output):
    from onnx import helper as h
    nodes=chunk_attention_nodes(prefix,query,key,value,relative_h,relative_w,output,rows=8)
    body=next(a.g for a in nodes[-1].attribute if a.name=='body');original=list(body.node)
    def name(value):return prefix+'/'+value
    def node(op,inputs,output,**attributes):return h.make_node(op,inputs,[name(output)],name=name(output),**attributes)
    start=next(i for i,n in enumerate(original) if n.output[0]==name('scores'))
    end=next(i for i,n in enumerate(original) if n.output[0]==name('block'))
    replacement=[node('Add',[name('slice_rh'),name('slice_rw')],'bias_grid'),
        node('Mul',[name('active_rows'),name('width')],'query_tokens'),
        node('Unsqueeze',[name('query_tokens'),name('axis0')],'query_tokens_vec'),
        node('Concat',[name('one_vec'),name('one_vec'),name('query_tokens_vec'),name('tokens_vec')],'bias_shape',axis=0),
        node('Reshape',[name('bias_grid'),name('bias_shape')],'attention_bias'),
        node('MultiHeadAttention',[name('slice_query'),key,value,'','',name('attention_bias')],'block',domain='com.microsoft',num_heads=1,scale=.125)]
    del body.node[:];body.node.extend(original[:start]+replacement+original[end+1:])
    return nodes


def transform_mha(model):
    from onnx import helper as h, numpy_helper
    if hashlib.sha256(model.SerializeToString()).hexdigest()!=SOURCE_SHA256:raise ValueError('Pinned source graph required')
    nodes=list(model.graph.node);producer={out:n for n in nodes for out in n.output};consumers=defaultdict(list)
    infos={v.name:v for v in model.graph.value_info};initializers={t.name:t for t in model.graph.initializer}
    for n in nodes:
        for value in n.input:consumers[value].append(n.name)
    removed=set();replacements={};records=[]
    for soft in nodes:
        if soft.op_type!='Softmax':continue
        dims=infos[soft.input[0]].type.tensor_type.shape.dim
        if len(dims)!=3 or dims[0].dim_value!=1:continue
        if not dims[1].dim_param or dims[1].dim_param!=dims[2].dim_param:raise ValueError('Unexpected global attention shape')
        flat=producer[soft.input[0]];aw=producer[flat.input[0]];ah=producer[aw.input[0]];view=producer[ah.input[0]];score=producer[view.input[0]]
        qm=producer[score.input[0]];kt=producer[score.input[1]]
        if [n.op_type for n in [flat,aw,ah,view,score,qm,kt]]!=['Reshape','Add','Add','Reshape','MatMul','Mul','Transpose']:raise ValueError('Unexpected attention path')
        uses=consumers[soft.output[0]]
        if len(uses)!=1:raise ValueError('Shared attention probability')
        final=next(n for n in nodes if n.name==uses[0])
        if final.op_type!='MatMul' or final.input[0]!=soft.output[0]:raise ValueError('Unexpected attention output')
        if numpy_helper.to_array(initializers[qm.input[1]]).item()!=.125:raise ValueError('Unscaled query requires original0.125 scale')
        if h.get_attribute_value(next(a for a in kt.attribute if a.name=='perm'))!=[0,2,1] or h.get_attribute_value(next(a for a in soft.attribute if a.name=='axis'))!=-1:raise ValueError('Full-key attention required')
        path={n.name for n in [qm,score,view,ah,aw,flat,soft,final]}
        if removed&path or any(c not in path for n in nodes if n.name in path-{final.name} for out in n.output for c in consumers[out]):raise ValueError('Shared attention intermediate')
        if set(consumers[kt.output[0]])=={score.name}:path.add(kt.name)
        prefix='private_loop_mha_'+soft.name
        replacements[final.name]=loop_mha_nodes(prefix,qm.input[0],kt.input[0],final.input[1],ah.input[1],aw.input[1],final.output[0])
        removed.update(path);records.append(dict(softmax=soft.name,removedNodes=[n.name for n in nodes if n.name in path],output=final.output[0]))
    if len(records)!=48:raise ValueError('Expected48 global attention heads')
    result=copy.deepcopy(model);del result.graph.node[:]
    for n in nodes:
        if n.name in replacements:result.graph.node.extend(replacements[n.name])
        elif n.name not in removed:result.graph.node.append(n)
    live={out for n in result.graph.node for out in n.output}|{t.name for t in result.graph.initializer}|{i.name for i in result.graph.input}
    kept=[v for v in result.graph.value_info if v.name in live];del result.graph.value_info[:];result.graph.value_info.extend(kept)
    if not any(x.domain=='com.microsoft' and x.version==1 for x in result.opset_import):result.opset_import.append(h.make_opsetid('com.microsoft',1))
    if [t.SerializeToString() for t in model.graph.initializer]!=[t.SerializeToString() for t in result.graph.initializer]:raise ValueError('Learned initializer changed')
    if {n.name:n.SerializeToString() for n in nodes if n.name not in removed}!={n.name:n.SerializeToString() for n in result.graph.node if n.name not in {m.name for r in replacements.values() for m in r}}:raise ValueError('Non-target node changed')
    if [v.SerializeToString() for v in model.graph.input]!=[v.SerializeToString() for v in result.graph.input] or [v.SerializeToString() for v in model.graph.output]!=[v.SerializeToString() for v in result.graph.output]:raise ValueError('Graph interface changed')
    return result,records


def transform(model, attention_backend='matmul'):
    """Replace only the pinned single-consumer full-attention paths, fail closed."""
    if attention_backend=='mha':return transform_mha(model)
    if attention_backend!='matmul':raise ValueError('Unsupported attention backend')
    from onnx import helper
    nodes = list(model.graph.node)
    producers = {out: i for i, node in enumerate(nodes) for out in node.output}
    consumers = defaultdict(list)
    for i, node in enumerate(nodes):
        for value in node.input:
            consumers[value].append(i)
    infos = {v.name: v for v in model.graph.value_info}
    removed, replacements, records = set(), {}, []
    def expect(value, op):
        index = producers[value]
        if nodes[index].op_type != op:
            raise ValueError('Unexpected attention path: ' + value)
        return index
    for index, softmax in enumerate(nodes):
        if softmax.op_type != 'Softmax':
            continue
        dims = infos[softmax.input[0]].type.tensor_type.shape.dim
        if len(dims) != 3 or dims[0].dim_value != 1:
            continue
        if dims[1].dim_param != dims[2].dim_param or not dims[1].dim_param:
            raise ValueError('Unexpected global attention shape')
        flatten = expect(softmax.input[0], 'Reshape')
        add_w = expect(nodes[flatten].input[0], 'Add')
        add_h = expect(nodes[add_w].input[0], 'Add')
        view = expect(nodes[add_h].input[0], 'Reshape')
        score = expect(nodes[view].input[0], 'MatMul')
        uses = consumers[softmax.output[0]]
        if len(uses) != 1 or nodes[uses[0]].op_type != 'MatMul' or nodes[uses[0]].input[0] != softmax.output[0]:
            raise ValueError('Shared attention probability')
        final = uses[0]
        path = {score, view, add_h, add_w, flatten, index, final}
        if removed & path or any(len(consumers[nodes[j].output[0]]) != 1 for j in path - {final}):
            raise ValueError('Shared attention intermediate')
        if helper.get_attribute_value(next(a for a in softmax.attribute if a.name == 'axis')) != -1:
            raise ValueError('Softmax must normalize all keys')
        q, k = nodes[score].input
        rh, rw = nodes[add_h].input[1], nodes[add_w].input[1]
        for value in [rh, rw]:
            if len(infos[value].type.tensor_type.shape.dim) != 5:
                raise ValueError('Relative position rank mismatch')
        replacements[final] = chunk_attention_nodes('cpu_query_chunk_' + str(len(records)), q, k, nodes[final].input[1], rh, rw, nodes[final].output[0])
        removed |= path
        records.append({'softmax': softmax.name, 'removedNodes': [nodes[j].name for j in sorted(path)], 'output': nodes[final].output[0]})
    if len(records) != 48:
        raise ValueError('Expected 48 global attention heads')
    result = copy.deepcopy(model)
    del result.graph.node[:]
    for i, node in enumerate(nodes):
        if i in replacements:
            result.graph.node.extend(replacements[i])
        elif i not in removed:
            result.graph.node.append(node)
    dead = {out for i in removed if i not in replacements for out in nodes[i].output}
    kept_infos = [v for v in result.graph.value_info if v.name not in dead]
    del result.graph.value_info[:]; result.graph.value_info.extend(kept_infos)
    if [x.SerializeToString() for x in model.graph.initializer] != [x.SerializeToString() for x in result.graph.initializer]:
        raise ValueError('Learned initializer changed')
    return result, records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--onnx', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--attention-backend',choices=['matmul','mha'],default='matmul')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Need new output directory')
    import onnx
    binary = args.onnx.read_bytes()
    if hashlib.sha256(binary).hexdigest() != SOURCE_SHA256:
        parser.error('Pinned source graph required')
    external = args.onnx.parent / 'model.onnx.data'
    with external.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != EXTERNAL_SHA256:
            parser.error('Pinned external weights required')
    model = onnx.load_model_from_string(binary)
    result, records = transform(model,attention_backend=args.attention_backend)
    # Use a regular one-link temporary file; keep the official hardlink guard.
    if args.attention_backend=='mha':
        with tempfile.NamedTemporaryFile(dir=external.parent,prefix='.loop-mha-check-',suffix='.onnx') as stream:
            stream.write(result.SerializeToString());stream.flush();onnx.checker.check_model(stream.name)
    else:
        with tempfile.TemporaryDirectory(prefix='vitmatte-query-check-') as directory:
            check_path = Path(directory) / 'model.onnx'
            check_path.write_bytes(result.SerializeToString())
            shutil.copyfile(external, Path(directory) / 'model.onnx.data')
            onnx.checker.check_model(str(check_path))
    args.output.mkdir(mode=0o700)
    target = args.output / 'model.onnx'; target.write_bytes(result.SerializeToString())
    report = {'status': ('gpu-loop-mha' if args.attention_backend=='mha' else 'cpu-query-chunks')+'-graph-checked-not-inferred', 'sourceGraphSha256': SOURCE_SHA256,
              'sourceExternalSha256': EXTERNAL_SHA256, 'graphSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
              'rowsPerChunk': 8, 'heads': records, 'initializerRecordsUnchanged': True, 'weightsCopied': False, 'externalWeightsRequired': str(external),
              'checkerTemporaryExternalBytes': 0 if args.attention_backend=='mha' else external.stat().st_size,
              'limits': ['CPU Loop candidate only; full model numerical, memory, browser, quality and source-release acceptance remain.']}
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'heads'}))

if __name__ == '__main__':
    main()
