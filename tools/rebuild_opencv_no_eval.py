"""Rebuild the reviewed no-eval OpenCV candidate from clean pinned source, one CPU only."""
import argparse, hashlib, json, os, pathlib, subprocess, sys
P=pathlib.Path
parser=argparse.ArgumentParser();parser.add_argument('source',type=P);parser.add_argument('sdk',type=P);parser.add_argument('review',type=P);parser.add_argument('output',type=P);parser.add_argument('--resume-configuration',action='store_true');args=parser.parse_args()
source,sdk,review=args.source.resolve(),args.sdk.resolve(),args.review.resolve();output=args.output.resolve()
if output.exists() and not args.resume_configuration:raise SystemExit('new output required')
if args.resume_configuration:
 prior=json.loads((output/'rebuild-report.json').read_text())
 if prior.get('status')!='failed' or prior.get('sourceCommit')!='31b0eeea0b44b370fd0712312df4214d4ae1b158' or (output/'bin/opencv.js').exists():raise SystemExit('matching failed configuration required')
 with (output/'failed-configure-report.json').open('x') as handle:json.dump(prior,handle,indent=2)
if os.name!='posix' or not hasattr(os,'sched_setaffinity'):raise SystemExit('Linux resource controls required')
os.nice(19);os.sched_setaffinity(0,{0})
def git(directory,*parts):return subprocess.check_output(['git','-C',str(directory),*parts],text=True).strip()
if git(source,'rev-parse','HEAD')!='31b0eeea0b44b370fd0712312df4214d4ae1b158' or git(source,'status','--porcelain'):raise SystemExit('clean pinned OpenCV source required')
if git(sdk,'rev-parse','HEAD')!='0b3bcbc3b005cbb811d48e497eabcc6846d43001' or git(sdk,'status','--porcelain'):raise SystemExit('pinned SDK required')
recipe=json.loads((review/'recipe.json').read_text());metadata=(review/'build-info-normalized.inc').read_bytes()
if hashlib.sha256(metadata).hexdigest()!=recipe['generatedBuildMetadata']['sha256'] or b'/home/yamato/' in metadata:raise SystemExit('reviewed canonical build metadata required')
expected=json.loads((review/'path-audit.json').read_text())
output.mkdir(exist_ok=args.resume_configuration);state={'status':'configuring','sourceCommit':git(source,'rev-parse','HEAD'),'sdkCommit':git(sdk,'rev-parse','HEAD'),'sameInstalledSdk':True,'canonicalBuildMetadataReused':True,'nice':os.getpriority(os.PRIO_PROCESS,0),'affinity':list(os.sched_getaffinity(0))}
def save(): (output/'rebuild-report.json').write_text(json.dumps(state,indent=2)+'\n')
def run(command,log):
 state['command']=command;save()
 with (output/log).open('x') as handle:subprocess.run(command,cwd=source,stdout=handle,stderr=subprocess.STDOUT,check=True)
envroot=sdk/'upstream/emscripten';emcmake=envroot/'emcmake';emcc=envroot/'emcc'
# emsdk activation creates this local configuration; do not alter shell profiles.
os.environ['EM_CONFIG']=str(sdk/'.emscripten');os.environ['EMSDK']=str(sdk);os.environ['EMSCRIPTEN']=str(envroot)
flags='-s DYNAMIC_EXECUTION=0 '+' '.join('-ffile-prefix-map='+str(actual)+'='+canonical for actual,canonical in [(source,'/opencv-build/opencv-4.11-csp-source-01'),(sdk,'/opencv-build/emsdk-3.1.64-01'),(output,'/opencv-build/opencv-4.11-csp-build-02')])
try:
 header=output/'modules/core/version_string.inc';header.parent.mkdir(parents=True,exist_ok=True);header.write_bytes(metadata)
 version=subprocess.check_output([str(emcc),'--version'],text=True);assert '3.1.64' in version;state['compilerVersion']=version
 run([str(emcmake),sys.executable,str(source/'platforms/js/build_js.py'),str(output),'--config_only','--build_flags='+flags,'--cmake_option=-DBUILD_LIST=core,imgproc,js','--cmake_option=-DOPENCV_SKIP_STATUS_FINALIZATION=ON'],'configure-retry.log' if args.resume_configuration else 'configure.log')
 state['status']='compiling';run(['cmake','--build',str(output),'--target','opencv.js','--parallel','1'],'compile.log')
 artifact=output/'bin/opencv.js';blob=artifact.read_bytes();state['artifactSha256']=hashlib.sha256(blob).hexdigest();state['expectedSha256']=expected['scriptSha256'];state['byteIdentity']=state['artifactSha256']==state['expectedSha256'];state['status']='built-byte-identical' if state['byteIdentity'] else 'built-different-requires-analysis';save()
except BaseException as error:
 state['status']='failed';state['errorType']=type(error).__name__;save();raise
