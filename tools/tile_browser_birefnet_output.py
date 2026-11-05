"""Experimental channel-streamed final Resize/Concat/1x1-Conv for pinned HR.

No channels, learned values or pixels are dropped. FP16 resize is preserved;
partial convolutions/sums use FP32, followed by a single FP16 output cast.
Structural and tiny tests cannot substitute for full numerical/GPU acceptance.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import resource
import time


def tile(model, *, resize_name, concat_name, conv_name, tile_channels=32):
    import numpy as np
    import onnx
    from onnx import helper as h, numpy_helper as nh
    if not 1 <= tile_channels <= 32:
        raise ValueError('Use 1..32 channels per tile')
    g = model.graph
    by_name = {n.name: n for n in g.node}
    resize, concat, conv = [by_name[name] for name in (resize_name, concat_name, conv_name)]
    if [n.op_type for n in (resize, concat, conv)] != ['Resize', 'Concat', 'Conv']:
        raise ValueError('Unexpected output block')
    if any(n.domain not in ('', 'ai.onnx') for n in (resize, concat, conv)):
        raise ValueError('Custom-domain output block is unsupported')
    shapes = {v.name: ([d.dim_value for d in v.type.tensor_type.shape.dim],v.type.tensor_type.elem_type)
              for v in list(g.input)+list(g.value_info)+list(g.output)
              if v.type.HasField('tensor_type') and v.type.tensor_type.HasField('shape') and
              all(d.HasField('dim_value') and d.dim_value > 0 for d in v.type.tensor_type.shape.dim)}
    shapes.update({v.name:(list(v.dims),v.data_type) for v in g.initializer})
    def shape(name):
        dims,kind = shapes[name]
        if kind != onnx.TensorProto.FLOAT16:
            raise ValueError('Expected FP16 block')
        return dims
    if len(concat.input)!=2 or len(concat.output)!=1 or len(conv.input)!=3 or len(conv.output)!=1 or len(resize.output)!=1:
        raise ValueError('Unexpected output block arity')
    if concat.input[0]!=resize.output[0] or conv.input[0]!=concat.output[0]:
        raise ValueError('Output block edges do not match')
    if {a.name:h.get_attribute_value(a) for a in concat.attribute} != {'axis':1}:
        raise ValueError('Concat must be channel-only')
    attrs={a.name:h.get_attribute_value(a) for a in conv.attribute}
    if attrs.get('group',1)!=1 or attrs.get('kernel_shape',[1,1])!=[1,1] or attrs.get('strides',[1,1])!=[1,1] or attrs.get('dilations',[1,1])!=[1,1] or attrs.get('pads',[0]*4)!=[0]*4 or attrs.get('auto_pad',b'NOTSET')!=b'NOTSET':
        raise ValueError('Only unpadded, single-group pointwise Conv is supported')
    if set(attrs)-{'group','kernel_shape','strides','dilations','pads','auto_pad'}:
        raise ValueError('Unknown Conv attribute')
    rattrs={a.name:h.get_attribute_value(a) for a in resize.attribute}
    if len(resize.input)!=4 or resize.input[1] or resize.input[2] or not resize.input[3] or 'axes' in rattrs:
        raise ValueError('Expected Resize with sizes, no ROI/scales/axes')
    if rattrs.get('mode')!=b'linear' or rattrs.get('coordinate_transformation_mode')!=b'align_corners' or rattrs.get('antialias',0)!=0:
        raise ValueError('Expected pinned linear align-corners Resize')
    xshape=shape(resize.input[0]);rshape=shape(resize.output[0]);other=shape(concat.input[1]);cshape=shape(concat.output[0]);wshape=shape(conv.input[1]);bshape=shape(conv.input[2]);oshape=shape(conv.output[0])
    if any(len(s)!=4 or s[0]!=1 for s in (xshape,rshape,other,cshape,oshape)):
        raise ValueError('Expected static batch1 NCHW')
    total=rshape[1]+other[1]
    if xshape[1]!=rshape[1] or rshape[2:]!=other[2:] or cshape!=[1,total,*rshape[2:]] or wshape!=[1,total,1,1] or bshape!=[1] or oshape!=[1,1,*rshape[2:]]:
        raise ValueError('Output block shape mismatch')
    for value, consumer in [(resize.output[0],concat),(concat.output[0],conv)]:
        consumers=[n.name for n in g.node if value in n.input]
        if consumers != [consumer.name] or value in {v.name for v in g.output}:
            raise ValueError('Intermediate output has another consumer')
    prefix='browser_output_tile__'
    if any(name.startswith(prefix) for n in g.node for name in list(n.input)+list(n.output)):
        raise ValueError('Tile namespace collision')
    if any(v.name.startswith(prefix) for v in g.initializer):
        raise ValueError('Tile initializer namespace collision')
    old_initializers={v.name:v.SerializeToString() for v in g.initializer}
    original_io=([v.SerializeToString() for v in g.input],[v.SerializeToString() for v in g.output])
    nodes,constants=[],[]
    def const(name, data):
        name=prefix+name
        constants.append(nh.from_array(np.asarray(data,dtype=np.int64),name))
        return name
    def op(kind, inputs, label, **kw):
        name=prefix+label
        nodes.append(h.make_node(kind,inputs,[name],name=name,**kw))
        return name
    axis=const('axis',[1]);step=const('step',[1]);accumulated=None;offset=0;tiles=[]
    for branch,source in enumerate([resize.input[0],concat.input[1]]):
        channels=[rshape[1],other[1]][branch]
        for first in range(0,channels,tile_channels):
            last=min(channels,first+tile_channels);label=f'{branch}_{first}'
            a,b=const('first_'+label,[first]),const('last_'+label,[last])
            feature=op('Slice',[source,a,b,axis,step],'feature_'+label)
            if branch==0:
                sizes=const('size_'+label,[1,last-first,*rshape[2:]])
                resized=copy.deepcopy(resize)
                resized.name=prefix+'resize_'+label
                resized.input[:]=[feature,'','',sizes]
                resized.output[:]=[prefix+'resized_'+label]
                nodes.append(resized);feature=resized.output[0]
            feature=op('Cast',[feature],'feature32_'+label,to=onnx.TensorProto.FLOAT)
            a,b=const('wfirst_'+label,[offset+first]),const('wlast_'+label,[offset+last])
            weight=op('Slice',[conv.input[1],a,b,axis,step],'weight_'+label)
            weight=op('Cast',[weight],'weight32_'+label,to=onnx.TensorProto.FLOAT)
            part=op('Conv',[feature,weight],'part_'+label,kernel_shape=[1,1])
            accumulated=part if accumulated is None else op('Add',[accumulated,part],'sum_'+label)
            tiles.append({'branch':branch,'first_channel':first,'end_channel':last,'weight_first':offset+first})
        offset+=channels
    bias=op('Cast',[conv.input[2]],'bias32',to=onnx.TensorProto.FLOAT)
    bias=op('Reshape',[bias,const('bias_shape',[1,1,1,1])],'bias')
    accumulated=op('Add',[accumulated,bias],'biased')
    nodes.append(h.make_node('Cast',[accumulated],[conv.output[0]],name=prefix+'output',to=onnx.TensorProto.FLOAT16))
    rewritten=[]
    for node in g.node:
        if node.name in (resize_name,concat_name):continue
        rewritten.extend(nodes if node.name==conv_name else [node])
    del g.node[:];g.node.extend(rewritten);g.initializer.extend(constants)
    removed={resize.output[0],concat.output[0]}
    infos=[v for v in g.value_info if v.name not in removed]
    del g.value_info[:];g.value_info.extend(infos)
    current={v.name:v.SerializeToString() for v in g.initializer}
    if any(current[k]!=v for k,v in old_initializers.items()) or original_io!=([v.SerializeToString() for v in g.input],[v.SerializeToString() for v in g.output]):
        raise ValueError('Source initializer or IO changed')
    return {'source_resize_shape':rshape,'source_concat_shape':cshape,'tile_channels':tile_channels,'tiles':tiles,
            'arithmetic':'FP16 per-channel resize, FP32 partial Conv/sums/bias, single FP16 output cast',
            'source_initializer_records_preserved':True,'source_model_io_preserved':True}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--onnx',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True,help='New ONNX filename in same private directory')
    args=parser.parse_args()
    repo=Path(__file__).resolve().parents[1]
    if args.output.exists() or args.output.with_suffix('.report.json').exists() or args.output.resolve().is_relative_to(repo) or args.output.parent.resolve()!=args.onnx.parent.resolve():
        parser.error('Choose a new private filename beside source; external data stays immutable')
    resource.setrlimit(resource.RLIMIT_AS,(1024**3,)*2);os.environ['OPENBLAS_NUM_THREADS']='1'
    from rewrite_browser_birefnet_deformconv import sha,DATA_SHA
    if sha(args.onnx)!='7338711120d416e90d47f73b7f117b96521882412f0f70eee536f0d09c4288b4':
        parser.error('Expected the pinned GridSample candidate')
    external=args.onnx.parent/'model.onnx.data'
    if external.is_symlink() or external.stat().st_nlink!=1 or sha(external)!=DATA_SHA:
        parser.error('External data must be SHA-verified, independent and immutable')
    import onnx
    model=onnx.load(args.onnx,load_external_data=False);started=time.monotonic()
    report={'scope':'Experimental full output-block structural rewrite; no inference','status':'started',
            'source_graph_sha256':sha(args.onnx),'external_data_sha256':DATA_SHA,'acceptance':'pending',
            'full_native_compared':False,'webgpu_executed':False}
    try:
        report.update(tile(model,resize_name='node_upsample_bilinear2d_20',concat_name='node_cat_20',conv_name='node_conv2d_81'))
        with args.output.open('xb') as writer:writer.write(model.SerializeToString())
        onnx.checker.check_model(str(args.output),full_check=False)
        report['graph']={'bytes':args.output.stat().st_size,'sha256':sha(args.output)}
        report['status']='structurally_checked_not_compared'
    except Exception as error:
        report['status']='failed';report['error_type']=type(error).__name__;raise
    finally:
        report['seconds']=time.monotonic()-started
        args.output.with_suffix('.report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report),flush=True)


if __name__=='__main__':main()
