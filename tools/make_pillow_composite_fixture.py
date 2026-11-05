"""Small synthetic RGBA, exact pinned Pillow reference; no models or inference imports."""
import sys
sys.path.insert(0,sys.argv[1])
import PIL
from PIL import Image
import json,base64
assert PIL.__version__=='12.3.0'
raw=bytes(v for a in range(256) for f in range(256) for v in (f,f,f,a))
image=Image.frombytes('RGBA',(256,256),raw)
cases=[]
for color in [(245,243,239),(255,255,255),(0,0,0),(32,96,192)]:
    result=Image.alpha_composite(Image.new('RGBA',image.size,(*color,255)),image).convert('RGB')
    cases.append({'color':color,'expectedRGB':base64.b64encode(result.tobytes()).decode()})
with open(sys.argv[2],'x') as f:
    json.dump({'pillow':PIL.__version__,'width':256,'height':256,'rgba':base64.b64encode(raw).decode(),'cases':cases},f)
