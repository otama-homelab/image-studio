"""Small deterministic RGB differential matrix, existing Pillow vs standalone C reuse."""
import ctypes,hashlib,json,pathlib,sys
from PIL import Image,__version__
assert __version__=='12.3.0'
library_path=pathlib.Path(sys.argv[1]);output=pathlib.Path(sys.argv[2]);assert not output.exists()
u8=ctypes.c_ubyte;fp=ctypes.c_float
library=ctypes.CDLL(str(library_path));resize=library.pillow_resize_rgb
resize.argtypes=[ctypes.POINTER(u8),ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.c_int,ctypes.POINTER(fp),ctypes.POINTER(u8)];resize.restype=ctypes.c_int
cases=[]
for w,h in [(1,1),(1,7),(7,1),(7,5),(17,13)]:
 for pattern in ['constant','ramp','checker','edge']:
  data=bytearray()
  for y in range(h):
   for x in range(w):
    for c in range(3):
     value=([80,128,200][c] if pattern=='constant' else (x*37+y*59+c*83)%256 if pattern=='ramp' else (255 if (x+y+c)%2 else 0) if pattern=='checker' else (255 if x==0 or y==0 or x==w-1 or y==h-1 else c*61))
     data.append(value)
  source=bytes(data);image=Image.frombytes('RGB',(w,h),source)
  for ow,oh in [(1,1),(4,3),(11,9),(w,h)]:
   for fractional in [False,True]:
    box=(w*.125,h*.125,w*.875,h*.875) if fractional else (0,0,w,h)
    expected=image.resize((ow,oh),Image.Resampling.LANCZOS,box=box).tobytes()
    src=(u8*len(source)).from_buffer_copy(source);dest=(u8*(ow*oh*3))()
    assert resize(src,w,h,ow,oh,(fp*4)(*box),dest)==0
    actual=bytes(dest);assert actual==expected,(w,h,pattern,ow,oh,box)
    assert bytes(src)==source
    cases.append({'source':[w,h],'pattern':pattern,'output':[ow,oh],'box':box,'rgbSha256':hashlib.sha256(actual).hexdigest(),'differentComponents':0})
report={'status':'passed','pillow':__version__,'scope':'Small deterministic native differential RGB matrix, not WASM or full-photo acceptance','caseCount':len(cases),'allComponentsExact':True,'sourcesPreserved':True,'librarySha256':hashlib.sha256(library_path.read_bytes()).hexdigest(),'cases':cases,'limits':['No real photo, decode, EXIF/ICC/alpha or model input acceptance','Native libm/ABI only; browser WASM build still missing','All dimensions <=17; diagnostic 2048 cap is not approved for production originals','No GPU/model/browser initialized; low priority single core']}
with output.open('x') as out:json.dump(report,out,indent=2);out.write('\n')
print(json.dumps({k:report[k] for k in ['status','pillow','caseCount','allComponentsExact','sourcesPreserved']}))
