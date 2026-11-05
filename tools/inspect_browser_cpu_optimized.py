"""Save/inspect CPU-optimized metadata without invoking InferenceSession.run.

Outputs include trained weights and must remain in a private task directory.
The logical-size report is not a measurement of inference allocation/workspace.
"""
import argparse
from collections import Counter
import gc
import hashlib
import json
import os
from pathlib import Path
import resource
import time


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--onnx',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    repo=Path(__file__).resolve().parents[1]
    if args.output.exists() or ((repo/'.git').exists() and args.output.resolve().is_relative_to(repo)):
        p.error('Choose a new private task directory outside repository')
    os.environ['OPENBLAS_NUM_THREADS']='1';os.environ['OMP_NUM_THREADS']='1'
    resource.setrlimit(resource.RLIMIT_AS,(22*1024**3,)*2)
    import onnxruntime as ort
    args.output.mkdir(mode=0o700)
    report={'scope':'Session creation/optimized CPU graph metadata only; never executes model inference',
            'status':'started','ort':ort.__version__,'inference_executed':False,'threads':1,
            'runtime_options':{'optimization':'basic','execution_order':'priority','arena':False,'pattern':False},
            'memory_checkpoints':[]}
    def checkpoint(phase):
        row={'phase':phase}
        for line in Path('/proc/self/status').read_text().splitlines():
            if line.startswith('VmRSS:'):row['process_rss_bytes']=int(line.split()[1])*1024
        for name in ['memory.current','memory.peak','memory.max']:
            f=Path('/sys/fs/cgroup')/name
            if f.exists():row['cgroup_'+name]=f.read_text().strip()
        report['memory_checkpoints'].append(row)
        (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(row),flush=True)
    started=time.monotonic()
    try:
        with args.onnx.open('rb') as f:report['source_sha256']=hashlib.file_digest(f,'sha256').hexdigest()
        options=ort.SessionOptions();options.intra_op_num_threads=options.inter_op_num_threads=1
        options.execution_order=ort.ExecutionOrder.PRIORITY_BASED
        options.graph_optimization_level=ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
        options.enable_cpu_mem_arena=False;options.enable_mem_pattern=False
        optimized=args.output/'optimized.onnx'
        options.optimized_model_filepath=str(optimized)
        options.add_session_config_entry('session.optimized_model_external_initializers_file_name','optimized.data')
        options.add_session_config_entry('session.optimized_model_external_initializers_min_size_in_bytes','1024')
        checkpoint('session-create')
        session=ort.InferenceSession(str(args.onnx),options,providers=['CPUExecutionProvider'])
        report['providers']=session.get_providers()
        checkpoint('session-created-no-run')
        del session;gc.collect()
        checkpoint('session-released-no-run')
        import onnx
        report['onnx']=onnx.__version__
        from inspect_browser_onnx_memory import analyze
        graph=onnx.load(optimized,load_external_data=False)
        report['operators']=dict(Counter(n.op_type for n in graph.graph.node))
        report['cast_targets']=dict(Counter(onnx.TensorProto.DataType.Name(onnx.helper.get_attribute_value(a))
                                  for n in graph.graph.node if n.op_type=='Cast' for a in n.attribute if a.name=='to'))
        try:
            graph=onnx.shape_inference.infer_shapes(graph,strict_mode=True,data_prop=False)
            report['strict_shape_inference']='passed'
        except Exception as error:
            report['strict_shape_inference']='failed';report['shape_error']=str(error)
        report['logical_sizes']=analyze(graph,buffer_limit=6*1024**3,binding_limit=6*1024**3)
        report['size_limit_note']='CPU container budget used only as comparison; not a GPU binding limit'
        report['files']={}
        for f in args.output.iterdir():
            if f.name=='report.json':continue
            with f.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
            report['files'][f.name]={'bytes':f.stat().st_size,'sha256':digest}
        report['status']='cpu_metadata_captured_no_model_run'
    except Exception as error:
        report['status']='failed';report['error_type']=type(error).__name__;report['error']=str(error);raise
    finally:
        report['seconds']=time.monotonic()-started
        (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status':report['status'],'seconds':report['seconds'],'cast_targets':report['cast_targets']}),flush=True)


if __name__=='__main__':main()
