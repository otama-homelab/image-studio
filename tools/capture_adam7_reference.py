"""Generate tiny RGB/RGBA Adam7 PNGs using existing Pillow + system optipng/libpng."""
import argparse, hashlib, json, os, shutil, subprocess
from pathlib import Path
from PIL import Image, __version__
parser=argparse.ArgumentParser();parser.add_argument('output',type=Path);args=parser.parse_args()
if __version__!='12.3.0':raise SystemExit('pillow-version-mismatch')
if args.output.exists():raise SystemExit('output-already-exists')
optimizer=shutil.which('optipng')
if not optimizer:raise SystemExit('optipng-missing')
os.umask(0o077);args.output.mkdir(mode=0o700)
version=subprocess.run([optimizer,'-v'],capture_output=True,text=True,check=True)
sha=lambda b:hashlib.sha256(b).hexdigest();cases=[]
for channels,mode in [(3,'RGB'),(4,'RGBA')]:
 for width,height in [(1,1),(1,7),(7,1),(7,5),(17,11)]:
  name=f'{mode.lower()}-{width}x{height}';raw=bytes((x*37+y*59+c*83+11)%256 for y in range(height) for x in range(width) for c in range(channels))
  Image.frombytes(mode,(width,height),raw).save(args.output/(name+'-plain.png'))
  subprocess.run([optimizer,'-quiet','-o1','-nb','-nc','-np','-i','1','-out',str(args.output/(name+'.png')),str(args.output/(name+'-plain.png'))],check=True,capture_output=True,timeout=10)
  encoded=(args.output/(name+'.png')).read_bytes();assert encoded[28]==1 and encoded[24]==8
  with Image.open(args.output/(name+'.png')) as decoded:
   assert decoded.mode==mode and decoded.size==(width,height);assert decoded.tobytes()==raw
  (args.output/(name+'.bin')).write_bytes(raw)
  cases.append({'filename':name+'.png','referenceFilename':name+'.bin','width':width,'height':height,'channels':channels,'pngSha256':sha(encoded),'pixelSha256':sha(raw),'bytes':len(encoded)})
report={'status':'captured','pillow':__version__,'optipngVersion':(version.stdout+version.stderr).strip(),'cases':cases,'limits':['Tiny RGB/RGBA8 fixtures only; no large images/ICC/other bit depth acceptance','Optipng creates interlace, independent Pillow verifies all pixels','No GPU/model/browser/NumPy initialized']}
(args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'status':'captured','cases':len(cases)}))
