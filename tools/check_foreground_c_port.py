"""Compare native C translation against saved actual JIT, without importing ML/Numba."""
import argparse,ctypes,hashlib,json,struct,subprocess,os
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('reference',type=Path);parser.add_argument('output',type=Path);args=parser.parse_args()
if args.output.exists():raise SystemExit('output-already-exists')
reference=json.loads((args.reference/'report.json').read_text());assert reference['status']=='captured';assert reference['sourceSha256']=='fd78cfb439940debc54c89a00638f025c0daef0bacc07fba393572787e9431ca';assert reference['versions']=={'numpy':'2.3.5','numba':'0.68.0','llvmlite':'0.50.0'}
os.umask(0o077);args.output.mkdir(mode=0o700);source=Path(__file__).parent/'fixtures/pymatting_ml_port.c';library=args.output/'foreground.so'
command=['gcc','-std=c11','-O1','-ffp-contract=off','-fno-fast-math','-fexcess-precision=standard','-shared','-fPIC',str(source),'-lm','-o',str(library)]
subprocess.run(command,check=True,timeout=20);lib=ctypes.CDLL(str(library));fn=lib.pymatting_ml_rgb;pointer=ctypes.POINTER(ctypes.c_float);fn.argtypes=[pointer,pointer,ctypes.c_int,ctypes.c_int,pointer,pointer];fn.restype=ctypes.c_int
cases=[]
for row in reference['cases']:
 w,h=row['width'],row['height'];n=w*h*3;rgb=(ctypes.c_float*n)(*row['inputRgb']);alpha=(ctypes.c_float*(w*h))(*row['inputAlpha']);f=(ctypes.c_float*n)();b=(ctypes.c_float*n)();before=bytes(rgb),bytes(alpha);code=fn(rgb,alpha,w,h,f,b);assert before==(bytes(rgb),bytes(alpha))
 case={'name':row['name'],'code':code}
 if row['status']=='reference-exception':assert row['exceptionType']=='ZeroDivisionError' and code==-2;case['referenceExceptionMatched']=True
 else:
  assert code==0
  for name,out in [('foreground',f),('background',b)]:
   expected=struct.pack('<'+'f'*n,*row[name]);actual=bytes(out);difference=max(abs(x-y) for x,y in zip(out,row[name]));case[name+'MaxDifference']=difference;case[name+'ByteExact']=actual==expected
 cases.append(case)
invalid=[]
for name,w,h,values in [('axis-limit',2001,1,[0.0]*6),('negative-height',2,-1,[0.0]*6),('nonfinite',2,1,[float('nan')]+[0.0]*5),('out-of-range',2,1,[2.0]+[0.0]*5)]:
 rgb=(ctypes.c_float*6)(*values);alpha=(ctypes.c_float*2)(0.0,1.0);f=(ctypes.c_float*6)(*[9.0]*6);b=(ctypes.c_float*6)(*[9.0]*6);assert fn(rgb,alpha,w,h,f,b)==-1;assert list(f)==[9.0]*6 and list(b)==[9.0]*6;invalid.append(name)
report={'invalidInputsRejectedWithoutOutputWrite':invalid,'compiler':subprocess.check_output(['gcc','--version'],text=True).splitlines()[0],'status':'compared','cases':cases,'allReturnedCasesByteExact':all(c.get('foregroundByteExact',True) and c.get('backgroundByteExact',True) for c in cases),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'compilerCommand':command,'limits':['Native C diagnostic translation, not WASM/production acceptance','Saved actual JIT tiny reference only; no models/Numba/GPU/browser initialized','2000px code bound is not memory/performance acceptance']}
report['status']='passed' if report['allReturnedCasesByteExact'] else 'mismatch'
(args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))

if not report['allReturnedCasesByteExact']:raise SystemExit('foreground-byte-mismatch')
