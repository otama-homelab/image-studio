"""Build the tiny native diagnostic from previously fetched, hash-checked Pillow sources."""
import hashlib,json,pathlib,re,subprocess,sys,sysconfig
repo=pathlib.Path(__file__).parents[1];root=pathlib.Path(sys.argv[1]);output=pathlib.Path(sys.argv[2]);record=pathlib.Path(str(output)+'.build.json')
assert not output.exists() and not record.exists()
standalone='--standalone' in sys.argv[3:];thumbnail='--thumbnail' in sys.argv[3:]
include=repo/'tools/fixtures/pillow-standalone' if standalone else pathlib.Path(sysconfig.get_path('include'))
expected=json.loads((repo/'docs/browser/validation/2026-11-01-pillow-c-resize.json').read_text())['upstreamSha256']
for name,digest in expected.items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest,name
extra=(['-DPILLOW_THUMBNAIL',str(root/'Reduce.c')] if thumbnail else [])
if thumbnail:assert hashlib.sha256((root/'Reduce.c').read_bytes()).hexdigest()=='fad296682cd71c1c05bc9adb79c800192c41ed4ec4ebe988ed53e35e7cb95fe6'
command=['gcc','-std=c11','-O1','-fPIC','-shared','-Wall','-Wextra','-I'+str(root),'-I'+str(include),str(root/'Resample.c'),str(repo/'tools/fixtures/pillow_resize_host.c'),'-lm','-o',str(output)]+extra
dependencies=subprocess.run(['gcc','-std=c11','-MM','-I'+str(root),'-I'+str(include),str(root/'Resample.c'),str(repo/'tools/fixtures/pillow_resize_host.c')],capture_output=True,text=True,check=True).stdout
headers=sorted(set(re.findall(r'/[^\s\\:]+\.h',dependencies)))
if standalone:
 assert str(include/'Python.h') in headers
 assert not any('python3.' in path for path in headers)
result=subprocess.run(command,capture_output=True,text=True,check=True)
record.write_text(json.dumps({'command':command,'headerDependencies':headers,'headerMode':'standalone-type-shim' if standalone else 'python-development-headers','warnings':result.stderr,'thumbnail':thumbnail,'hostSha256':hashlib.sha256((repo/'tools/fixtures/pillow_resize_host.c').read_bytes()).hexdigest(),'binarySha256':hashlib.sha256(output.read_bytes()).hexdigest()},indent=2)+'\n')
print(json.dumps({'status':'built','binaryBytes':output.stat().st_size,'warningsRecorded':bool(result.stderr)}))
