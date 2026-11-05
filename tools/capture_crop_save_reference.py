"""Synthetic photo geometry + Pillow crop reference, no ML/NumPy."""
import json,hashlib,sys
from PIL import Image,__version__
assert __version__=='12.3.0'
w,h=160,200;source=bytes((x*37+y*59+c*83)%256 for y in range(h) for x in range(w) for c in range(3))
tw,th=round(30/25.4*300),round(40/25.4*300)
ch=min(h,w/(tw/th))*73/100;cw=ch*(tw/th);left=(w-cw)*31/100;top=(h-ch)*67/100;box=[left,top,left+cw,top+ch]
result=Image.frombytes('RGB',(w,h),source).resize((tw,th),Image.Resampling.LANCZOS,box=box).tobytes()
report={'pillow':__version__,'sourceSize':[w,h],'sourcePattern':'(x*37+y*59+c*83)%256','sourceRgbSha256':hashlib.sha256(source).hexdigest(),'settings':{'widthMm':30,'heightMm':40,'range':73,'horizontal':31,'vertical':67},'box':box,'outputSize':[tw,th],'rgbSha256':hashlib.sha256(result).hexdigest(),'scope':'Synthetic raw RGB geometry and resize only, no real photo or decoder acceptance'}
with open(sys.argv[1],'x') as f:json.dump(report,f,indent=2);f.write('\n')
