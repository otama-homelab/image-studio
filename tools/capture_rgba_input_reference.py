"""All alpha byte values, with nonzero hidden colors; no photos or model imports."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from PIL import Image, __version__
parser=argparse.ArgumentParser();parser.add_argument('output',type=Path);args=parser.parse_args()
if __version__!='12.3.0':raise SystemExit('pillow-version-mismatch')
if args.output.exists():raise SystemExit('output-already-exists')
os.umask(0o077);args.output.mkdir(mode=0o700)
raw=bytes(value for alpha in range(256) for value in ((alpha*37+11)%256,(alpha*59+23)%256,(alpha*83+47)%256,alpha))
image=Image.frombytes('RGBA',(256,1),raw);image.save(args.output/'rgba.png')
reference=image.convert('RGB').tobytes();(args.output/'rgb.bin').write_bytes(reference)
with Image.open(args.output/'rgba.png') as loaded:assert loaded.tobytes()==raw
assert reference[:3]==bytes((11,23,47))
sha=lambda b:hashlib.sha256(b).hexdigest()
report={'pillow':__version__,'size':[256,1],'rgbaSha256':sha(raw),'pngSha256':sha((args.output/'rgba.png').read_bytes()),'rgbSha256':sha(reference),'policy':'Pillow convert RGB drops alpha without compositing; hidden RGB preserved','limits':['Synthetic RGBA8 PNG only; no ICC/EXIF/palette/grayscale/high-depth acceptance','No GPU/model/browser/NumPy imported']}
(args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
