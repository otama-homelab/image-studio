"""Tiny CPU planner/type diagnostic. No HR weights, photos or full inference.

Profiles an interleaved branch/accumulator graph under bounded memory. Results
are local CPU observations, not evidence of full HR or WebGPU memory savings.
"""
import argparse
from collections import Counter
import gc
import json
import os
from pathlib import Path
import resource
import time


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    repo=Path(__file__).resolve().parents[1]
    if args.output.exists() or args.output.resolve().is_relative_to(repo):
        parser.error('Choose a new private output directory')
    resource.setrlimit(resource.RLIMIT_AS,(1024**3,)*2)
    os.environ['OPENBLAS_NUM_THREADS']='1';os.environ['OMP_NUM_THREADS']='1'
    import numpy as np
    import onnx
    from onnx import helper as h,numpy_helper as nh,TensorProto as T
    import onnxruntime as ort
    args.output.mkdir(mode=0o700)
    report={'scope':'Tiny local native CPU planner/type diagnostic; no full HR or GPU inference',
            'ort':ort.__version__,'threads':1,'virtual_memory_limit_bytes':1024**3,'cases':[]}
    started=time.monotonic()
    for dtype,kind in [(np.float16,T.FLOAT16),(np.float32,T.FLOAT)]:
        rng=np.random.default_rng(36)
        nodes,weights=[],[]
        accumulator=None
        for i in range(8):
            w=f'w{i}';weights.append(nh.from_array(rng.uniform(-.1,.1,(8,8,1,1)).astype(dtype),w))
            nodes.extend([h.make_node('Conv',['x',w],[f'c{i}'],name=f'conv{i}',kernel_shape=[1,1]),
                          h.make_node('Relu',[f'c{i}'],[f'h{i}'],name=f'relu{i}')])
            if accumulator is None:accumulator=f'h{i}'
            else:
                nodes.append(h.make_node('Add',[accumulator,f'h{i}'],[f'a{i}'],name=f'add{i}'))
                accumulator=f'a{i}'
        model=h.make_model(h.make_graph(nodes,'interleaved-branches',
            [h.make_tensor_value_info('x',kind,[1,8,16,16])],
            [h.make_tensor_value_info(accumulator,kind,[1,8,16,16])],weights),
            opset_imports=[h.make_opsetid('',19)],ir_version=13)
        onnx.checker.check_model(model)
        x=rng.uniform(-1,1,(1,8,16,16)).astype(dtype)
        baseline=None
        for label,arena,pattern,order in [('default',True,True,'DEFAULT'),
                ('no_arena_pattern',False,False,'DEFAULT'),
                ('priority_based',False,False,'PRIORITY_BASED'),
                ('priority_basic',False,False,'PRIORITY_BASED'),
                ('memory_efficient',False,False,'MEMORY_EFFICIENT')]:
            tag=f'{np.dtype(dtype).name}-{label}'
            optimized=args.output/(tag+'.onnx')
            options=ort.SessionOptions()
            options.intra_op_num_threads=options.inter_op_num_threads=1
            options.enable_cpu_mem_arena=arena;options.enable_mem_pattern=pattern
            options.execution_order=getattr(ort.ExecutionOrder,order)
            options.graph_optimization_level=ort.GraphOptimizationLevel.ORT_ENABLE_BASIC if label=='priority_basic' else ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            options.log_severity_level=3
            options.optimized_model_filepath=str(optimized)
            options.enable_profiling=True;options.profile_file_prefix=str(args.output/tag)
            case={'dtype':np.dtype(dtype).name,'options':{'arena':arena,'pattern':pattern,'order':order,'optimization':'basic' if label=='priority_basic' else 'all'}}
            try:
                session=ort.InferenceSession(model.SerializeToString(),options,providers=['CPUExecutionProvider'])
                output=session.run(None,{'x':x})[0].copy()
                second=session.run(None,{'x':x})[0].copy()
                case['repeat_max_error']=float(np.max(np.abs(output.astype(np.float64)-second)))
                if baseline is None:baseline=output
                case['max_error_vs_dtype_default']=float(np.max(np.abs(output.astype(np.float64)-baseline)))
                case['providers']=session.get_providers()
                profile=Path(session.end_profiling())
                events=json.loads(profile.read_text())
                event_rows=[e for e in events if e.get('cat')=='Node' and e.get('ph')=='X' and e.get('args',{}).get('op_name')]
                case['profiled_node_events']=[{'name':e['name'],'op':e['args']['op_name'],
                    'provider':e['args'].get('provider'),'input_type_shape':e['args'].get('input_type_shape'),
                    'output_type_shape':e['args'].get('output_type_shape')} for e in event_rows]
                graph=onnx.load(optimized,load_external_data=False)
                case['optimized_ops']=dict(Counter(n.op_type for n in graph.graph.node))
                first_add=next((i for i,e in enumerate(event_rows) if e['args']['op_name']=='Add'),len(event_rows))
                case['conv_events_before_first_add']=sum(e['args']['op_name']=='Conv' for e in event_rows[:first_add])
                case['optimized_cast_targets']=[h.get_attribute_value(a) for n in graph.graph.node if n.op_type=='Cast' for a in n.attribute if a.name=='to']
                case['status']='tiny_graph_executed'
                if label=='priority_basic':
                    rt=ort.SessionOptions();rt.intra_op_num_threads=rt.inter_op_num_threads=1
                    rt.graph_optimization_level=ort.GraphOptimizationLevel.ORT_DISABLE_ALL
                    rt.execution_order=ort.ExecutionOrder.DEFAULT
                    rt.enable_cpu_mem_arena=False;rt.enable_mem_pattern=False
                    rt.enable_profiling=True;rt.profile_file_prefix=str(args.output/(tag+'-roundtrip'))
                    second_session=ort.InferenceSession(str(optimized),rt,providers=['CPUExecutionProvider'])
                    roundtrip=second_session.run(None,{'x':x})[0].copy()
                    ev=json.loads(Path(second_session.end_profiling()).read_text())
                    rows=[e for e in ev if e.get('cat')=='Node' and e.get('ph')=='X' and e.get('args',{}).get('op_name')]
                    boundary=next((i for i,e in enumerate(rows) if e['args']['op_name']=='Add'),len(rows))
                    case['serialized_roundtrip']={'max_error_vs_same_session':float(np.max(np.abs(roundtrip.astype(np.float64)-output))),
                        'conv_events_before_first_add':sum(e['args']['op_name']=='Conv' for e in rows[:boundary]),
                        'execution_order':'DEFAULT','optimization':'disabled','arena':False,'pattern':False,
                        'node_events':[e['name'] for e in rows]}
                    del second_session
                del session
            except Exception as error:
                case.update(status='rejected',error_type=type(error).__name__,error=str(error))
            report['cases'].append(case)
            gc.collect()
    report['seconds']=time.monotonic()-started
    report['status']='tiny_diagnostic_captured_not_full_model_accepted'
    (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'cases':[{'dtype':c['dtype'],'order':c['options']['order'],'status':c['status'],
                                'casts':c.get('optimized_cast_targets'),'error':c.get('error')} for c in report['cases']],
                      'seconds':report['seconds']}),flush=True)


if __name__=='__main__':main()
