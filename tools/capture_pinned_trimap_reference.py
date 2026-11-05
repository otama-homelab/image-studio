"""Run only the app's make_trimap function with pinned private OpenCV; never import app models."""
import argparse,ast,hashlib,json,os,resource,time
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('opencv_root',type=Path);parser.add_argument('fixtures',type=Path);parser.add_argument('backend_source',type=Path);parser.add_argument('output',type=Path);args=parser.parse_args()
if args.output.exists():raise SystemExit('output-already-exists')
provenance=json.loads((args.opencv_root/'provenance.json').read_text())
if provenance['version']!='4.11.0.86' or not provenance['verified']:raise SystemExit('opencv-pin-mismatch')
for name in ['OPENBLAS_NUM_THREADS','OMP_NUM_THREADS','MKL_NUM_THREADS']:os.environ[name]='1'
os.environ['OPENCV_OPENCL_RUNTIME']='disabled'
resource.setrlimit(resource.RLIMIT_AS,(256*1024**2,256*1024**2));resource.setrlimit(resource.RLIMIT_CPU,(30,30))
def memory():
 values={}
 for line in Path('/proc/self/status').read_text().splitlines():
  if line.startswith(('VmRSS:','VmHWM:','VmSize:')):values[line.split(':')[0]+'KiB']=int(line.split()[1])
 return values
inherited_max_rss=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
memory_samples=[{'phase':'before-import',**memory()}]
started=time.monotonic()
import numpy as np
import cv2
if cv2.__version__!='4.11.0' or not Path(cv2.__file__).resolve().is_relative_to((args.opencv_root/'wheel').resolve()):raise SystemExit('wrong-opencv-import')
memory_samples.append({'phase':'after-import',**memory()})
cv2.setNumThreads(1);cv2.ocl.setUseOpenCL(False);assert not cv2.ocl.useOpenCL()
source=args.backend_source.read_text();tree=ast.parse(source)
functions=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='make_trimap'];assert len(functions)==1 and not functions[0].decorator_list
# Execute just this function AST. The source module's torch/transformers imports are never run.
namespace={'np':np,'cv2':cv2};exec(compile(ast.Module(body=functions,type_ignores=[]),str(args.backend_source),'exec'),namespace)
manifest=json.loads((args.fixtures/'report.json').read_text());assert manifest['status']=='auxiliary-native-captured'
os.umask(0o077);args.output.mkdir(mode=0o700);sha=lambda b:hashlib.sha256(b).hexdigest();cases=[]
for row in manifest['cases']:
 raw=(args.fixtures/(row['stem']+'-alpha.bin')).read_bytes();assert sha(raw)==row['alphaSha256'];assert len(raw)==row['width']*row['height']<=4096
 mask=np.frombuffer(raw,dtype=np.uint8).reshape(row['height'],row['width']);trimap=namespace['make_trimap'](mask)
 assert mask.tobytes()==raw;assert trimap.dtype==np.uint8 and trimap.shape==mask.shape
 radius=max(3,round(max(mask.shape)*0.006));kernel=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(radius*2+1,radius*2+1))
 assert set(np.unique(trimap)).issubset({0,128,255})
 fg=cv2.erode(cv2.threshold(mask,249,255,cv2.THRESH_BINARY)[1],kernel)
 bg=cv2.erode(cv2.threshold(mask,5,255,cv2.THRESH_BINARY_INV)[1],kernel)
 candidate=np.full(mask.shape,128,dtype=np.uint8);candidate[fg!=0]=255;candidate[bg!=0]=0
 assert np.array_equal(candidate,trimap), 'pinned-threshold-path-mismatch'
 reference=trimap.tobytes();(args.output/(row['stem']+'-alpha.bin')).write_bytes(raw);(args.output/(row['stem']+'-trimap.bin')).write_bytes(reference);(args.output/(row['stem']+'-kernel.bin')).write_bytes(kernel.tobytes())
 cases.append({**row,'radius':radius,'trimapSha256':sha(reference),'kernelSha256':sha(kernel.tobytes()),'foreground':int(np.count_nonzero(trimap==255)),'background':int(np.count_nonzero(trimap==0)),'unknown':int(np.count_nonzero(trimap==128)),'auxiliary46TrimapMatches':sha(reference)==row['trimapSha256'],'auxiliary46KernelMatches':sha(kernel.tobytes())==row['kernelSha256']})
memory_samples.append({'phase':'after-cases',**memory()})
report={'memorySamples':memory_samples,'inheritedMaxRssKiB':inherited_max_rss,'addressSpaceGuardBytes':256*1024**2,'status':'pinned-native-reference-captured','opencv':cv2.__version__,'package':provenance,'numpy':np.__version__,'makeTrimapSourceSha256':sha(ast.get_source_segment(source,functions[0]).encode()),'cases':cases,'openclEnabled':cv2.ocl.useOpenCL(),'opencvThreads':cv2.getNumThreads(),'elapsedSeconds':time.monotonic()-started,'maxRssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'limits':['Actual pinned native reference only; OpenCV.js/WASM and production integration unverified','Tiny synthetic masks, not all photos/maximum shapes/real quality acceptance','Address-space guard is not total host RAM guarantee; inherited rusage maxRSS predates imports, use proc VmRSS/VmHWM samples for this execution','No torch/transformers/model/GPU/browser imports or initialization']}
(args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'opencv':cv2.__version__,'cases':len(cases),'maxRssKiB':report['maxRssKiB'],'allAuxiliaryMatches':all(c['auxiliary46TrimapMatches'] and c['auxiliary46KernelMatches'] for c in cases)}))
