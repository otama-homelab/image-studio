"""Private Pillow WASM build using verified source and a managed bounded runtime fork."""
import argparse,hashlib,json,pathlib,subprocess,tempfile
parser=argparse.ArgumentParser();parser.add_argument('compiler_root',type=pathlib.Path);parser.add_argument('sources',type=pathlib.Path);parser.add_argument('output',type=pathlib.Path);parser.add_argument('--bounded-growth',action='store_true');parser.add_argument('--runtime-fork',type=pathlib.Path);parser.add_argument('--bilinear',action='store_true');parser.add_argument('--thumbnail',action='store_true');parser.add_argument('--crop',action='store_true');parser.add_argument('--model-tall-order',action='store_true');args=parser.parse_args()
if args.model_tall_order and not args.bilinear:raise SystemExit('Model tall order requires --bilinear')
repo=pathlib.Path(__file__).resolve().parents[1];compiler_root=args.compiler_root.resolve();sources=args.sources.resolve();output=args.output.resolve();fork=args.runtime_fork.resolve() if args.runtime_fork else None
assert not output.exists() and not pathlib.Path(str(output)+'.build.json').exists()
if args.bounded_growth and not fork:raise SystemExit('Bounded build requires --runtime-fork; do not patch unmanaged upstream source')
if fork and not args.bounded_growth:raise SystemExit('Runtime fork requires --bounded-growth')
reference=json.loads((repo/'docs/browser/validation/2026-11-01-pillow-wasm.json').read_text())
for name,digest in reference['upstreamSha256'].items():assert hashlib.sha256((sources/name).read_bytes()).hexdigest()==digest,name
runtime_root=fork or compiler_root
if fork:
 subprocess.run(['git','merge-base','--is-ancestor',reference['compiler']['commit'],'HEAD'],cwd=fork,check=True,capture_output=True)
 assert subprocess.check_output(['git','diff',reference['compiler']['commit'],'--name-only'],cwd=fork,text=True).splitlines()==['libsrc/_wasm/unistd/brk.c']
for name,digest in reference['compiler']['runtimeSha256'].items():
 if fork and name=='libsrc/_wasm/unistd/brk.c':digest='aa98f0fc3209c9cb617af9135b23351e2fee9b64d2ab543a564746af7e36e5de'
 assert hashlib.sha256((runtime_root/name).read_bytes()).hexdigest()==digest,name
compiler=compiler_root/'wcc';assert hashlib.sha256(compiler.read_bytes()).hexdigest()==reference['compiler']['binarySha256']
if args.thumbnail:assert hashlib.sha256((sources/'Reduce.c').read_bytes()).hexdigest()=='fad296682cd71c1c05bc9adb79c800192c41ed4ec4ebe988ed53e35e7cb95fe6'
flags=(['-DPILLOW_MODEL_TALL_ORDER'] if args.model_tall_order else [])+(['-DPILLOW_THUMBNAIL'] if args.thumbnail else [])+['-D__BYTE_ORDER__=1234','-D__ORDER_LITTLE_ENDIAN__=1234','-I'+str(sources),'-I'+str(repo/'tools/fixtures/pillow-standalone')];commands=[]
def run(command,cwd=compiler_root):
 commands.append(command);subprocess.run(command,cwd=cwd,capture_output=True,text=True,check=True,timeout=20)
with tempfile.TemporaryDirectory(prefix='pillow-objects-',dir=output.parent) as directory:
 temporary=pathlib.Path(directory);objects=[]
 inputs=[sources/'Resample.c',repo/'tools/fixtures/pillow_resize_host.c']+([sources/'Reduce.c'] if args.thumbnail else [])+[runtime_root/name for name in reference['compiler']['runtimeSha256']]
 for index,source in enumerate(inputs):
  # Canonical source names also keep __FILE__ assertion strings free of host paths.
  local_source=temporary/f'part-{index}.c';local_source.write_bytes(source.read_bytes())
  obj=temporary/f'part-{index}.o';run([str(compiler),'-c',*flags,'-I'+str(compiler_root/'include'),'-I'+str(source.parent),local_source.name,'-o',obj.name],cwd=temporary);objects.append(str(obj))
 exports='pillow_resize_rgb,malloc,free'+(',pillow_crop_rgb' if args.crop else '')+(',pillow_resize_bilinear_rgb' if args.bilinear else '')+(',pillow_thumbnail_rgb' if args.thumbnail else '')
 run([str(compiler),'-nostdlib','--entry-point=','--stack-size=65536','-e',exports,'-Wl,--allow-undefined',*objects,'-o','pillow-resize.wasm'],cwd=temporary)
 binary=(temporary/'pillow-resize.wasm').read_bytes()
 for private_path in [repo,compiler_root,sources,output.parent,temporary,runtime_root]:
  if str(private_path).encode() in binary:raise SystemExit('Private source/build path embedded in artifact')
 output.write_bytes(binary)
report={'canonicalSourceNames':True,'privateSourcePathsAbsent':True,'commands':commands,'boundedGrowth':args.bounded_growth,'growthImport':'foreground_memory_grow' if fork else None,'modelTallOrder':args.model_tall_order,'bilinearExport':args.bilinear,'thumbnailExport':args.thumbnail,'cropExport':args.crop,'wasmSha256':hashlib.sha256(output.read_bytes()).hexdigest(),'bytes':output.stat().st_size,'hostSha256':hashlib.sha256((repo/'tools/fixtures/pillow_resize_host.c').read_bytes()).hexdigest(),'runtimeFork':{'baseCommit':reference['compiler']['commit'],'headCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=fork,text=True).strip(),'diffSha256':hashlib.sha256(subprocess.check_output(['git','diff',reference['compiler']['commit']],cwd=fork)).hexdigest()} if fork else None}
pathlib.Path(str(output)+'.build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':'built','bytes':output.stat().st_size,'bilinear':args.bilinear}))
