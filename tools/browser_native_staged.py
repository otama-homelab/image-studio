"""Native CPU diagnostic evaluator with one ORT node session at a time.

Executes every ancestor of requested outputs with original ONNX node semantics,
initializers and IO types. Intended to identify a failing operator and avoid
whole-session scheduling/retention. It is not the browser implementation and
does not prove whole-session performance or memory use.
"""
from collections import Counter
import copy
import gc
from pathlib import Path


def execution_order(model, outputs):
    nodes=list(model.graph.node)
    producers={name:i for i,n in enumerate(nodes) for name in n.output if name}
    parents={i:sorted({producers[x] for x in n.input if x in producers}) for i,n in enumerate(nodes)}
    heights={}
    for i in range(len(nodes)):
        if any(p>=i for p in parents[i]):
            raise ValueError('Expected an acyclic, topologically serialized graph')
        heights[i]=1+max((heights[p] for p in parents[i]),default=0)
    order,visited=[],set()
    for output in outputs:
        if output not in producers:
            raise ValueError('Requested output must be produced by a node')
        stack=[(producers[output],False)]
        while stack:
            i,done=stack.pop()
            if i in visited:continue
            if done:
                visited.add(i);order.append(i);continue
            stack.append((i,True))
            # Visit deeper dependency first: accumulator chains before a fresh
            # independent contribution. This is a heuristic, not a memory bound.
            for p in sorted(parents[i],key=lambda p:(heights[p],p)):
                if p not in visited:stack.append((p,False))
    return order


def evaluate(model, feeds, *, model_dir, outputs=None, callback=None):
    import numpy as np
    import onnx
    import onnxruntime as ort
    graph=model.graph
    outputs=outputs or [x.name for x in graph.output]
    order=execution_order(model,outputs)
    initializers={x.name:x for x in graph.initializer}
    if set(initializers)&{x.name for x in graph.input}:
        raise ValueError('Overridable initializers require an explicit feed policy')
    if set(feeds)!={x.name for x in graph.input}:
        raise ValueError('Feed names must match all source graph inputs')
    infos={x.name:x for x in list(graph.input)+list(graph.value_info)+list(graph.output)}
    for name,value in initializers.items():
        infos[name]=onnx.helper.make_tensor_value_info(name,value.data_type,list(value.dims))
        external={x.key:x.value for x in value.external_data}
        if external:
            location=external['location']
            if Path(location).name!=location or not (Path(model_dir)/location).is_file():
                raise ValueError('Invalid external initializer path')
    nodes=list(graph.node)
    for i in order:
        n=nodes[i]
        if any(a.type in (onnx.AttributeProto.GRAPH,onnx.AttributeProto.GRAPHS) for a in n.attribute):
            raise ValueError('Control-flow/implicit outer inputs require a separate evaluator')
        if n.op_type.startswith('Random') or n.op_type in ('Bernoulli','Multinomial'):
            raise ValueError('Staged RNG semantics are not supported')
        for name in list(n.input)+list(n.output):
            if name and name not in infos:
                raise ValueError(f'Missing source tensor type: {name}')
    remaining=Counter(name for i in order for name in nodes[i].input if name)
    remaining.update(outputs)
    values=dict(feeds)
    peak=0;executed=0
    options=ort.SessionOptions();options.intra_op_num_threads=options.inter_op_num_threads=1
    options.execution_order=ort.ExecutionOrder.DEFAULT
    options.graph_optimization_level=ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    options.enable_cpu_mem_arena=False;options.enable_mem_pattern=False
    options.log_severity_level=3
    options.add_session_config_entry('session.model_external_initializers_file_folder_path',str(Path(model_dir).resolve()))
    for step,i in enumerate(order):
        node=nodes[i]
        names=list(dict.fromkeys(x for x in node.input if x and x not in initializers))
        needed=[x for x in node.output if x and remaining[x]>0]
        if not needed:raise ValueError('Diagnostic order contains an unused operation')
        node_weights=[initializers[x] for x in dict.fromkeys(node.input) if x in initializers]
        single=onnx.helper.make_model(onnx.helper.make_graph([copy.deepcopy(node)],'native-staged-node',
            [copy.deepcopy(infos[x]) for x in names],[copy.deepcopy(infos[x]) for x in needed],
            [copy.deepcopy(x) for x in node_weights]),
            opset_imports=[copy.deepcopy(x) for x in model.opset_import],ir_version=model.ir_version)
        single.functions.extend(model.functions)
        live_bytes=sum(x.nbytes for x in values.values())
        if callback:callback({'phase':'before-node','step':step,'total':len(order),'node_index':i,
            'node':node.name,'op':node.op_type,'registry_logical_bytes':live_bytes})
        session=ort.InferenceSession(single.SerializeToString(),options,providers=['CPUExecutionProvider'])
        actual=session.run(needed,{x:values[x] for x in names})
        for name,array in zip(needed,actual):
            info=infos[name].type.tensor_type
            if array.dtype!=np.dtype(onnx.helper.tensor_dtype_to_np_dtype(info.elem_type)):
                raise ValueError(f'Unexpected dtype from node: {node.name}')
            if info.HasField('shape') and all(d.HasField('dim_value') for d in info.shape.dim):
                if list(array.shape)!=[d.dim_value for d in info.shape.dim]:
                    raise ValueError(f'Unexpected shape from node: {node.name}')
            values[name]=array
        peak=max(peak,sum(x.nbytes for x in values.values()))
        for name in node.input:
            if name:
                remaining[name]-=1
                if remaining[name]==0:values.pop(name,None)
        del actual,session,single
        executed+=1
        if step%64==0:gc.collect()
    return {name:values[name] for name in outputs},{'executed_nodes':executed,'source_nodes':len(nodes),
        'peak_registry_logical_bytes':peak,'note':'Registry tensor-byte sum only, not RSS/workspace/allocator memory',
        'providers':['CPUExecutionProvider'],'execution':'original node semantics, dependency-depth order, one native session per node'}
