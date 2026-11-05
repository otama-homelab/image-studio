"""Compare native reuse of Pillow's unmodified Resample.c against recorded Pillow RGB."""
import ctypes,hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1]);output=pathlib.Path(sys.argv[2]);assert not output.exists()
fixture=pathlib.Path(__file__).parents[1]/'docs/browser/validation/2026-11-01-pillow-resize-reference-v2.json'
reference=json.loads(fixture.read_text());library_path=pathlib.Path(sys.argv[3]) if len(sys.argv)>3 else root/'libpillow-resize-host.so'
library=ctypes.CDLL(str(library_path));build_path=pathlib.Path(str(library_path)+'.build.json')
header_mode=json.loads(build_path.read_text()).get('headerMode','python-development-headers') if build_path.exists() else 'python-development-headers'
u8=ctypes.c_ubyte;fp=ctypes.c_float
resize=library.pillow_resize_rgb;resize.argtypes=[ctypes.POINTER(u8),ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.POINTER(fp),ctypes.POINTER(u8)];resize.restype=ctypes.c_int
source=bytes.fromhex(reference['sourceRgbHex']);buffer=(u8*len(source)).from_buffer_copy(source);cases=[]
for case in reference['cases']:
 width,height=case['outputSize'];edges=case['box'] or [0,0,*reference['sourceSize']];dest=(u8*(width*height*3))()
 assert resize(buffer,*reference['sourceSize'],width,height,(fp*4)(*edges),dest)==0
 actual=bytes(dest);expected=bytes.fromhex(case['rgbHex']);assert actual==expected,case['name']
 assert bytes(buffer)==source
 cases.append({'name':case['name'],'rgbBytes':len(actual),'sha256':hashlib.sha256(actual).hexdigest(),'allComponentsExact':True,'sourceUnchanged':True})
# Full-size identity exercises upstream ImagingCopy and its adapter storage ownership.
dest=(u8*len(source))();assert resize(buffer,7,5,7,5,(fp*4)(0,0,7,5),dest)==0;assert bytes(dest)==source
for edges in [(-1,0,7,5),(0,0,8,5),(0,0,0,5),(0,0,float('nan'),5)]:
 assert resize(buffer,7,5,7,5,(fp*4)(*edges),dest)==-1
 assert bytes(dest)==source
report={'status':'passed','headerMode':header_mode,'scope':'Native RGB-only host adapter, unmodified upstream Pillow 12.3.0 filter code; not WASM/browser acceptance','cases':cases,'identityExact':True,'invalidBoxesRejectedBeforeOutputWrite':4,'upstreamSource':'https://github.com/python-pillow/Pillow/tree/12.3.0/src/libImaging','upstreamSha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.glob('*.h'))+[root/'Resample.c']},'hostAdapterSha256':hashlib.sha256((pathlib.Path(__file__).parent/'fixtures/pillow_resize_host.c').read_bytes()).hexdigest(),'limits':['Artificial 7x5 RGB only; no decode/ICC/EXIF/alpha, model preprocessing or full-size photo quality acceptance','Host allocator/error/section hooks are diagnostic, RGB-only, dimension cap 2048; not a production allocator or memory bound','Standalone build uses type-only shim; native struct/allocator ABI still needs WASM validation' if header_mode=='standalone-type-shim' else 'Native build uses Python development headers; no Python interpreter library required by filter code, WASM header/ABI isolation is still unresolved','No compiler install, WASM initialization, GPU/model/browser launch']}
with output.open('x') as out:json.dump(report,out,indent=2);out.write('\n')
print(json.dumps({'status':report['status'],'cases':len(cases),'allComponentsExact':True,'identityExact':True,'invalidBoxesRejected':4}))
