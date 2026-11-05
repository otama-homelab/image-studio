"""Experimental FP32 accumulation/division for pinned HR spatial means.

Original FP16 inputs/results, learned parameters, dimensions and reduction axes
remain unchanged. Numerical and WebGPU validation are required before adoption.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import resource

SOURCE_SHA='3fbcfed0079e8a3b95bcba7c6bd2a8776a73c1e6681ab0aec51198bd24349006'


def promote(model):
    import onnx
    h=onnx.helper;T=onnx.TensorProto
    infos={v.name:v for v in list(model.graph.input)+list(model.graph.value_info)+list(model.graph.output)}
    weights={v.name:v for v in model.graph.initializer}
    occupied=set(infos)|set(weights)|{v for n in model.graph.node for v in list(n.input)+list(n.output)}
    result=copy.deepcopy(model);nodes=[];changes=[]
    for n in model.graph.node:
        if n.op_type!='ReduceMean':nodes.append(copy.deepcopy(n));continue
        if n.domain not in ('','ai.onnx') or len(n.input)!=2 or len(n.output)!=1:
            raise ValueError('Expected standard ReduceMean with explicit constant axes')
        src=infos[n.input[0]];dst=infos[n.output[0]]
        if src.type.tensor_type.elem_type!=T.FLOAT16 or dst.type.tensor_type.elem_type!=T.FLOAT16:
            raise ValueError('Expected original FP16 mean input and result')
        shape=[d.dim_value for d in src.type.tensor_type.shape.dim]
        if len(shape)!=4 or any(x<1 for x in shape):raise ValueError('Expected static positive NCHW')
        axes=weights.get(n.input[1])
        if axes is None or axes.external_data:raise ValueError('Expected inline constant reduction axes')
        axes=onnx.numpy_helper.to_array(axes).tolist()
        attrs={a.name:h.get_attribute_value(a) for a in n.attribute}
        if (not isinstance(axes,list) or len(axes)!=2 or any(type(x) is not int or not -4<=x<4 for x in axes)
                or {x%4 for x in axes}!={2,3} or attrs.get('keepdims',1)!=1 or attrs.get('noop_with_empty_axes',0)!=0):
            raise ValueError('Expected spatial-only mean with keepdims')
        if set(attrs)-{'keepdims','noop_with_empty_axes'}:raise ValueError('Unexpected mean attribute')
        prefix=f'plan36_mean_f32_{len(changes)}'
        names=[prefix+'_input',prefix+'_result']
        if any(x in occupied for x in names):raise ValueError('Diagnostic rewrite name collision')
        occupied.update(names)
        reduce=copy.deepcopy(n);reduce.input[0]=names[0];reduce.output[0]=names[1]
        nodes.extend([h.make_node('Cast',[n.input[0]],[names[0]],to=T.FLOAT,name=prefix+'_promote'),
                      reduce,h.make_node('Cast',[names[1]],[n.output[0]],to=T.FLOAT16,name=prefix+'_restore')])
        for original,name in [(src,names[0]),(dst,names[1])]:
            info=copy.deepcopy(original);info.name=name;info.type.tensor_type.elem_type=T.FLOAT
            result.graph.value_info.append(info)
        changes.append({'node':n.name,'input':n.input[0],'output':n.output[0],
                        'shape':shape,'axes':axes,'original_output_dtype':'float16'})
    if not changes:raise ValueError('No spatial FP16 means found')
    del result.graph.node[:];result.graph.node.extend(nodes)
    return result,changes


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--onnx',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();repo=Path(__file__).resolve().parents[1]
    resource.setrlimit(resource.RLIMIT_AS,(1024**3,)*2);os.environ['OPENBLAS_NUM_THREADS']='1'
    if (args.output.exists() or args.output.with_suffix('.report.json').exists()
            or args.output.resolve().is_relative_to(repo) or args.output.parent.resolve()!=args.onnx.parent.resolve()):
        parser.error('Choose a new private graph beside the original external data')
    from rewrite_browser_birefnet_deformconv import sha,DATA_SHA
    if sha(args.onnx)!=SOURCE_SHA:parser.error('Expected the pinned output-tiled candidate')
    data=args.onnx.parent/'model.onnx.data'
    if data.is_symlink() or data.stat().st_nlink!=1 or sha(data)!=DATA_SHA:
        parser.error('External data SHA/link check failed')
    import onnx
    original=onnx.load(args.onnx,load_external_data=False);result,changes=promote(original)
    if len(changes)!=5:raise ValueError('Expected exactly five original spatial means')
    for field in ['initializer','input','output']:
        if [v.SerializeToString() for v in getattr(original.graph,field)]!=[v.SerializeToString() for v in getattr(result.graph,field)]:
            raise ValueError('Original parameter/IO records changed')
    with args.output.open('xb') as stream:stream.write(result.SerializeToString())
    onnx.checker.check_model(str(args.output),full_check=False)
    report={'status':'structurally_checked_not_compared','source_graph_sha256':SOURCE_SHA,
            'external_data_sha256':DATA_SHA,'means':changes,'nodes':len(result.graph.node),
            'original_initializer_and_io_records_preserved':True,'graph':{'name':args.output.name,
            'bytes':args.output.stat().st_size,'sha256':sha(args.output)},
            'arithmetic':'FP32 mean accumulation/division, then original FP16 result',
            'native_compared':False,'webgpu_executed':False,'acceptance':'pending'}
    args.output.with_suffix('.report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))


if __name__=='__main__':main()
