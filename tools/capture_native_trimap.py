"""Build/run a tiny system OpenCV probe, without Python cv2/NumPy/model imports."""
import argparse,hashlib,json,os,shlex,subprocess
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('output',type=Path);args=parser.parse_args()
if args.output.exists():raise SystemExit('output-already-exists')
version=subprocess.check_output(['pkg-config','--modversion','opencv4'],text=True).strip()
flags=shlex.split(subprocess.check_output(['pkg-config','--cflags','opencv4'],text=True))
os.umask(0o077);args.output.mkdir(mode=0o700)
source=Path(__file__).parent/'fixtures/trimap_native_probe.cpp';binary=args.output/'trimap-probe'
subprocess.run(['g++','-std=c++17','-O0',*flags,str(source),'-lopencv_imgproc','-lopencv_core','-o',str(binary)],check=True,timeout=30)
result=subprocess.run([str(binary),str(args.output)],check=True,capture_output=True,text=True,timeout=10,env={**os.environ,'OPENCV_OPENCL_RUNTIME':'disabled','OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1'})
report=json.loads(result.stdout);assert report['opencv']==version
for case in report['cases']:
 for name in ['alpha','trimap','kernel']:
  data=(args.output/f"{case['stem']}-{name}.bin").read_bytes();case[name+'Sha256']=hashlib.sha256(data).hexdigest()
report['sourceSha256']=hashlib.sha256(source.read_bytes()).hexdigest();report['limits']=['System OpenCV '+version+' auxiliary probe, not pinned opencv-python-headless4.11.0.86 or OpenCV.js acceptance','Native threshold/border equivalence only; real WASM overload/lifecycle still unverified','8 tiny cases, CPU one thread, OpenCL disabled; no GPU/model/browser/Python cv2 initialized']
(args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'opencv':version,'cases':len(report['cases'])}))
