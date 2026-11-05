"""Tiny analytical oracle; stdlib only, no torch/numpy/model initialization."""
import json
import struct
import sys
from fractions import Fraction as F

def f32(x):
    return struct.unpack('<f', struct.pack('<f', float(x)))[0]

def quantize(x):
    return max(0, min(255, round(f32(f32(x) * 255))))

cases = []
for ih, iw, oh, ow in [(1,1,3,5),(1,3,1,7),(3,1,7,1),(2,2,5,7),(3,5,2,3),(5,3,7,2),(3,3,3,3),(5,7,1,1)]:
    data = [F((i * 7 + 5) % 17, 16) for i in range(ih*iw)]
    expected = []
    for y in range(oh):
        fy=max(F(0), min(F(ih-1), F((2*y+1)*ih,2*oh)-F(1,2)))
        y0=fy.numerator//fy.denominator; y1=min(y0+1,ih-1); wy=fy-y0
        for x in range(ow):
            fx=max(F(0),min(F(iw-1),F((2*x+1)*iw,2*ow)-F(1,2)))
            x0=fx.numerator//fx.denominator; x1=min(x0+1,iw-1); wx=fx-x0
            expected.append(f32(sum(data[yy*iw+xx]*weight for yy,xx,weight in [(y0,x0,(1-wy)*(1-wx)),(y0,x1,(1-wy)*wx),(y1,x0,wy*(1-wx)),(y1,x1,wy*wx)])))
    cases.append(dict(inputShape=[1,ih,iw],outputSize=[oh,ow],input=list(map(float,data)),expected=expected,expectedU8=list(map(quantize,expected))))
values=[f32(x) for x in [-0.1,0,0.5,1,1.1]+[(i+0.5)/255 for i in range(255)]]
with open(sys.argv[1],'x') as f:
    json.dump(dict(oracle='Exact rational half-pixel/clamp bilinear + IEEE float32 output; not an executed PyTorch oracle',cases=cases,quantization=dict(input=values,expected=list(map(quantize,values)))),f,indent=2)
