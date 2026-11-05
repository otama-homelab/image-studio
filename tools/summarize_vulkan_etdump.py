#!/usr/bin/env python3
"""Summarize verified profile traces without adding nested CPU/GPU timing domains."""
import argparse,json,pathlib,collections,statistics,re,hashlib
from executorch.devtools.etdump.serialize import deserialize_from_etdump_flatcc
p=argparse.ArgumentParser(description=__doc__);p.add_argument('artifact_dir',type=pathlib.Path);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args();assert not a.output.exists();result=json.loads((a.artifact_dir/'result.json').read_text());assert result['passed'];summary={'scope':'Recorded dispatch-duration sums and CPU scope durations; not end-to-end GPU utilization','profile_metadata':result['profile_metadata'],'cases':[],'limitations':['Instrumentation can perturb scheduling; absolute profiled times are not production timings','GPU event durations can overlap and CPU scopes nest; do not add them as disjoint wall time','ViTMatte input uses synthetic anchored trimap; component attribution is not full real-photo app timing']}
for case in result['cases']:
 assert case['parity_passed'];path=a.artifact_dir/case['trace_file'];assert hashlib.file_digest(path.open('rb'),'sha256').hexdigest()==case['trace_sha256'];trace=deserialize_from_etdump_flatcc(path.read_bytes());row={'model':case['model'],'shape':case['shape'],'parity_max_abs_error':case['max_abs_error'],'blocks':[]}
 for block in trace.run_data:
  gpu=collections.defaultdict(list);operators=collections.defaultdict(list);slow=[];cpu=collections.defaultdict(list);invalid=[];examples=[]
  for event in block.events or []:
   e=event.profile_event
   if e is None:continue
   name=e.delegate_debug_id_str or e.name or '<unnamed>';duration=e.end_time-e.start_time
   if duration<0:invalid.append({'name':name,'start':e.start_time,'end':e.end_time});continue
   if len(examples)<8:examples.append({'name':name,'start':e.start_time,'end':e.end_time})
   payload=None
   if name.startswith('{'):
    try:payload=json.loads(name)
    except json.JSONDecodeError:pass
   match=re.match(r'^\{([^,]+),\s*"dispatch_id"',name)
   if isinstance(payload,dict) and isinstance(payload.get('kernel_name'),str):
    kernel=payload['kernel_name'];gpu[kernel].append(duration);op=payload.get('operator',{});opname=op.get('name','<unknown>') if isinstance(op,dict) else str(op);operators[opname].append(duration);slow.append({'kernel':kernel,'operator':op,'dispatch_id':payload.get('dispatch_id'),'duration_ms':duration/1e6})
   elif match:gpu[match.group(1)].append(duration)
   else:cpu[name].append(duration)
  def totals(mapping):return sorted([{'name':n,'count':len(v),'sum_ms':sum(v)/1e6,'max_ms':max(v)/1e6,'median_ms':statistics.median(v)/1e6} for n,v in mapping.items()],key=lambda x:x['sum_ms'],reverse=True)
  gs=totals(gpu);cs=totals(cpu);total=sum(x['sum_ms'] for x in gs)
  for v in gs:v['share_of_recorded_dispatch_duration_sum']=v['sum_ms']/total if total else None
  row['blocks'].append({'name':block.name,'profile_event_count':sum(len(v) for v in gpu.values())+sum(len(v) for v in cpu.values()),'gpu_dispatch_event_count':sum(len(v) for v in gpu.values()),'gpu_dispatch_duration_sum_ms':total,'gpu_shaders':gs,'gpu_operators':totals(operators),'slowest_dispatches':sorted(slow,key=lambda x:x['duration_ms'],reverse=True)[:15],'cpu_scopes':cs,'invalid_profile_events':invalid,'example_events':examples})
 assert any(b['gpu_dispatch_event_count'] for b in row['blocks']),'No GPU dispatch events decoded';assert not any(b['invalid_profile_events'] for b in row['blocks']),'Invalid timing intervals';summary['cases'].append(row)
a.output.write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps({'output':str(a.output),'cases':[{'model':c['model'],'shape':c['shape'],'blocks':[{'name':b['name'],'top_gpu_shaders':b['gpu_shaders'][:5],'top_cpu_scopes':b['cpu_scopes'][:5]} for b in c['blocks']]} for c in summary['cases']]},indent=2))
