"""Private diagnostic WASM build; optional pinned local runtime fork with bounded growth."""
import hashlib,json,pathlib,subprocess,sys,tempfile
repo=pathlib.Path(__file__).resolve().parents[1]
compiler_root=pathlib.Path(sys.argv[1]).resolve();output=pathlib.Path(sys.argv[2]).resolve()
if output.exists() or pathlib.Path(str(output)+'.build.json').exists():raise SystemExit('output-already-exists')
reference=json.loads((repo/'docs/browser/validation/2026-11-01-pillow-wasm.json').read_text())['compiler']
compiler=compiler_root/'wcc'
assert hashlib.sha256(compiler.read_bytes()).hexdigest()==reference['binarySha256']
source=repo/'tools/fixtures/pymatting_ml_port.c'
assert hashlib.sha256(source.read_bytes()).hexdigest()=='c792f3221ebefa425b4752f62c00f8c470f9fa6a5e786dd8ee75d0afb7a684a0'
fork=pathlib.Path(sys.argv[3]).resolve() if len(sys.argv)>3 else None
runtime_root=fork or compiler_root
if fork:
 subprocess.run(['git','merge-base','--is-ancestor',reference['commit'],'HEAD'],cwd=fork,check=True,capture_output=True)
 assert subprocess.check_output(['git','diff',reference['commit'],'--name-only'],cwd=fork,text=True).splitlines()==['libsrc/_wasm/unistd/brk.c']
runtime=['libsrc/stdlib/malloc.c','libsrc/stdlib/calloc.c','libsrc/string/memcpy.c','libsrc/string/memset.c','libsrc/_wasm/unistd/brk.c','libsrc/math/finite.c']
for name in runtime:
 expected=reference['runtimeSha256'][name]
 if fork and name=='libsrc/_wasm/unistd/brk.c':expected='aa98f0fc3209c9cb617af9135b23351e2fee9b64d2ab543a564746af7e36e5de'
 assert hashlib.sha256((runtime_root/name).read_bytes()).hexdigest()==expected
commands=[]
def run(command,working_directory=compiler_root):
 commands.append(command)
 result=subprocess.run(command,cwd=working_directory,capture_output=True,text=True,timeout=20)
 if result.returncode:raise RuntimeError(result.stderr[-4000:])
with tempfile.TemporaryDirectory(prefix='foreground-objects-',dir=output.parent) as directory:
 temporary=pathlib.Path(directory)
 # Standard declarations absent from the diagnostic compiler's minimal math.h.
 # Implementations remain host Math imports, not substitute numerical kernels.
 wrapper=temporary/'foreground.c';wrapper.write_text('extern double fmin(double,double);\nextern double fmax(double,double);\n#include '+json.dumps(str(source))+'\n')
 objects=[]
 for index,item in enumerate([wrapper]+[runtime_root/name for name in runtime]):
  obj=temporary/f'{index}.o';run([str(compiler),'-c',str(item),'-o',str(obj)]);objects.append(str(obj))
 run([str(compiler),'-nostdlib','--entry-point=','--stack-size=65536','-e','pymatting_ml_rgb,malloc,free','-Wl,--allow-undefined',*objects,'-o','foreground.wasm'],working_directory=temporary)
 output.write_bytes((temporary/'foreground.wasm').read_bytes())
report={'status':'diagnostic-built','bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'compilerSha256':reference['binarySha256'],'commands':commands,'runtimeFork':{'baseCommit':reference['commit'],'headCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=fork,text=True).strip(),'diffSha256':hashlib.sha256(subprocess.check_output(['git','diff',reference['commit'],'--','libsrc/_wasm/unistd/brk.c'],cwd=fork)).hexdigest()} if fork else None,'limits':['Diagnostic allocator with optional fork growth hook; tiny fixtures only, not production acceptance','No browser/GPU/model execution or production adoption','Production upstream changes/builds require managed fork/release']}
pathlib.Path(str(output)+'.build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':report['status'],'bytes':report['bytes']}))
