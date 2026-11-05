"""Tiny synthetic Pillow resize oracle only. No ML/NumPy/browser imports."""
import hashlib,json,sys
from PIL import Image,__version__
assert __version__=='12.3.0', 'Use the pinned Pillow reference version'
source=bytes((i*37+(i//3)*11)%256 for i in range(7*5*3))
image=Image.frombytes('RGB',(7,5),source)
cases=[]
for name,size,box in [('down',(4,3),None),('up',(11,9),None),('fractional-crop',(4,3),(.25,.5,6.5,4.75)),('fractional-near-output',(6,4),(.25,.25,6.75,4.75))]:
 result=image.resize(size,Image.Resampling.LANCZOS,box=box)
 cases.append({'name':name,'outputSize':size,'box':box,'rgbHex':result.tobytes().hex(),'sha256':hashlib.sha256(result.tobytes()).hexdigest()})
report={'pillow':__version__,'scope':'Tiny deterministic RGB only, no decode, ICC, EXIF, alpha or full image acceptance','sourceSize':[7,5],'sourceRgbHex':source.hex(),'cases':cases}
with open(sys.argv[1],'x') as out:json.dump(report,out,indent=2);out.write('\n')
