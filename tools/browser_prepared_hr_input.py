"""Validate already-captured HR preprocessing without importing Torch/vision."""
import hashlib
import json
from pathlib import Path


def load_prepared(folder, *, reference_id):
    import numpy as np
    manifest=json.loads((folder/'inputs.json').read_text())
    if len(manifest['cases'])!=1:
        raise ValueError('Expected exactly one captured HR input')
    case=manifest['cases'][0]
    if case['id']!=reference_id or Path(case['file']).name!=case['file']:
        raise ValueError('Prepared input ID/path mismatch')
    if case['dtype']!='float16' or case['shape']!=[1,3,2048,2048] or case['bytes']!=1*3*2048*2048*2:
        raise ValueError('Prepared input contract mismatch')
    size=case['original_size']
    if len(size)!=2 or any(type(v) is not int or v<1 or v>2000 for v in size):
        raise ValueError('Invalid original dimensions')
    data=(folder/case['file']).read_bytes()
    if len(data)!=case['bytes'] or hashlib.sha256(data).hexdigest()!=case['sha256']:
        raise ValueError('Prepared input length/SHA mismatch')
    sample=np.frombuffer(data,dtype=np.float16).reshape(case['shape'])
    if not np.isfinite(sample).all():
        raise ValueError('Nonfinite prepared input')
    return sample,size,case['sha256']
