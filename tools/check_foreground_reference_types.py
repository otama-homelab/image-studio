"""Validate captured real JIT data/type evidence without loading NumPy/Numba again."""
import argparse,hashlib,json,math,re,struct
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('reference',type=Path);parser.add_argument('output',type=Path);args=parser.parse_args()
if args.output.exists():raise SystemExit('output-already-exists')
report=json.loads((args.reference/'report.json').read_text());assert report['status']=='captured';assert report['versions']=={'numpy':'2.3.5','numba':'0.68.0','llvmlite':'0.50.0'}
assert report['sourceSha256']=='fd78cfb439940debc54c89a00638f025c0daef0bacc07fba393572787e9431ca'
sha=lambda b:hashlib.sha256(b).hexdigest();cases=[]
for row in report['cases']:
 case={k:row[k] for k in ['name','width','height','status']}
 if row['name']=='single':assert row['exceptionType']=='ZeroDivisionError';case['exceptionType']=row['exceptionType']
 else:
  assert row['status']=='returned' and row['dtype']=='float32';count=row['width']*row['height']*3
  for field in ['foreground','background']:
   values=row[field];assert len(values)==count and all(math.isfinite(x) and 0<=x<=1 for x in values)
   encoded=struct.pack('<'+'f'*count,*values);assert list(struct.unpack('<'+'f'*count,encoded))==values;assert sha(encoded)==row[field+'Sha256'];case[field+'Sha256']=sha(encoded)
 cases.append(case)
text=(args.reference/'inferred-types.txt').read_text();facts={}
expected={'a0':'float32','a1':'float64','a00':'float32','a00.2':'float32','a01':'float64','a11':'float64','a11.2':'float64','da':'float32','determinant':'float64','inv_det':'float64','b00':'float64','b01':'float64','b11':'float64','F_c':'float64','B_c':'float64'}
for name,dtype in expected.items():
 lines=[line.strip() for line in text.splitlines() if re.search(r'#\s+'+re.escape(name)+r' = .*:: '+dtype+r'$',line)]
 assert lines,(name,dtype);facts[name]={'type':dtype,'evidence':lines[0]}
result={'status':'actual-jit-reference-and-types-verified','versions':report['versions'],'cases':cases,'scalarTypes':facts,'memorySamples':report['memorySamples'],'guards':report['guards'],'elapsedSeconds':report['elapsedSeconds'],'artifacts':{name:sha((args.reference/name).read_bytes()) for name in ['report.json','inferred-types.txt','core-0.ll']},'limits':['Pinned CPU JIT evidence only, not C/WASM estimator equivalence','Four returned tiny cases plus observed single-pixel exception; full photos/2000px/quality/performance unaccepted','No NumPy/Numba/model/GPU/browser loaded by this verification tool']}
args.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':result['status'],'scalarTypes':len(facts),'cases':len(cases)}))
