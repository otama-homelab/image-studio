"""Check attention equations, relative positions and optional attention outputs."""
import torch,json
from transformers import VitDetConfig
from transformers.models.vitdet.modeling_vitdet import VitDetAttention
from vitmatte_export_helpers import headwise_attention

torch.set_num_threads(2);torch.manual_seed(1906)
config=VitDetConfig(hidden_size=12,num_attention_heads=3,use_relative_position_embeddings=True)
m=VitDetAttention(config,input_size=(14,14)).eval()
with torch.no_grad():
 m.rel_pos_h.normal_(std=.2);m.rel_pos_w.normal_(std=.2)
 cases=[]
 for batch,h,w in [(1,4,5),(2,14,14),(1,32,16)]:
  x=torch.randn(batch,h,w,12)
  for attention in (False,True):
   expected=m(x,output_attentions=attention);actual=headwise_attention(m,x,attention)
   for a,e in zip(actual,expected):torch.testing.assert_close(a,e,atol=2e-6,rtol=2e-5)
   cases.append({'shape':list(x.shape),'output_attentions':attention,'max_abs_error':max((a-e).abs().max().item() for a,e in zip(actual,expected))})
print(json.dumps({'passed':True,'cases':cases},indent=2))
