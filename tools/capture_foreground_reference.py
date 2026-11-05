"""Capture actual pinned PyMatting JIT outputs/types in a provisioned CPU environment.

No fallback to undecorated Python: that would not prove Numba scalar semantics.
Output includes synthetic pixels only; never load user photos or ML models.
"""
import base64
import argparse
import hashlib
import importlib.util
import importlib.metadata
import io
import json
import os
from pathlib import Path
import resource
import sys
import time

EXPECTED = 'fd78cfb439940debc54c89a00638f025c0daef0bacc07fba393572787e9431ca'
parser = argparse.ArgumentParser()
parser.add_argument('--byte-alpha', action='store_true')
parser.add_argument('--dimension-matrix', action='store_true')
parser.add_argument('source', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
if hashlib.sha256(args.source.read_bytes()).hexdigest() != EXPECTED:
    raise SystemExit('foreground-source-sha-mismatch')
if args.output.exists():
    raise SystemExit('output-already-exists')
missing = [name for name in ('numpy', 'numba', 'llvmlite') if importlib.util.find_spec(name) is None]
if missing:
    raise SystemExit('reference-dependencies-missing: ' + ','.join(missing))
# Before imports/JIT: one thread and bounded CPU/address space. Not a total host RAM cap.
for name in ('OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'NUMBA_NUM_THREADS'):
    os.environ[name] = '1'
resource.setrlimit(resource.RLIMIT_CPU, (30, 30))
resource.setrlimit(resource.RLIMIT_AS, (512*1024**2, 512*1024**2))
os.umask(0o077)
args.output.mkdir(mode=0o700)
os.environ['NUMBA_CACHE_DIR'] = str(args.output / 'numba-cache')
expected_versions={'numpy':'2.3.5','numba':'0.68.0','llvmlite':'0.50.0'}
for name,expected in expected_versions.items():
    if importlib.metadata.version(name)!=expected:
        raise SystemExit('reference-version-mismatch: '+name)
def memory():
    return {line.split(':')[0]+'KiB':int(line.split()[1]) for line in Path('/proc/self/status').read_text().splitlines() if line.startswith(('VmRSS:','VmHWM:','VmSize:'))}
started=time.monotonic();memory_samples=[]
def stage(name):
    memory_samples.append({'phase':name,**memory()})
    (args.output/'stage.json').write_text(json.dumps({'status':'capturing','stage':name,'memorySamples':memory_samples},indent=2)+'\n')
    print(json.dumps({'stage':name,'memory':memory_samples[-1]}),flush=True)
stage('before-imports')
import numpy as np
import numba
import llvmlite
stage('after-imports')
spec = importlib.util.spec_from_file_location('pinned_foreground_reference', args.source.resolve())
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
# Executes the hash-checked source unchanged, including its actual decorators/signatures.
stage('before-source-jit')
spec.loader.exec_module(module)
stage('after-source-jit')
report = {'status': 'capturing', 'sourceSha256': EXPECTED,
          'versions': {'numpy': np.__version__, 'numba': numba.__version__, 'llvmlite': llvmlite.__version__},
          'cases': [], 'limits': ['Synthetic tiny CPU JIT reference only; no full photo, browser or WASM acceptance',
                                 'Address-space/CPU limits are process guards, not measured total RAM']}
cases=[('mixed', 7, 5, 'mixed'), ('opaque', 2, 2, 'opaque'), ('transparent', 2, 2, 'transparent'), ('unanchored', 3, 2, 'unanchored'), ('single', 1, 1, 'mixed')]
if args.dimension_matrix:
    cases += [(f'matrix-{w}x{h}',w,h,'mixed') for w,h in [(1,17),(17,1),(2,3),(3,2),(31,33),(33,31),(32,32),(9,37),(37,9)]]
report['fixtureModes']={'byteAlpha':args.byte_alpha,'dimensionMatrix':args.dimension_matrix}
for name, width, height, mode in cases:
    image = np.array([((x * 37 + y * 59 + c * 83) % 256) / 255.0
                      for y in range(height) for x in range(width) for c in range(3)], dtype=np.float64).reshape(height, width, 3)
    alpha = np.array([((x + 2 * y) % 5) / 4.0 for y in range(height) for x in range(width)], dtype=np.float64).reshape(height, width)
    if mode != 'mixed':
        alpha.fill({'opaque': 1.0, 'transparent': 0.0, 'unanchored': 0.5}[mode])
    if args.byte_alpha:
        alpha = np.rint(alpha * 255).astype(np.uint8).astype(np.float64) / 255.0
    original_image, original_alpha = image.copy(), alpha.copy()
    case = {'name': name, 'width': width, 'height': height, 'inputRgb': image.ravel().tolist(), 'inputAlpha': alpha.ravel().tolist()}
    try:
        foreground, background = module.estimate_foreground_ml(image, alpha, return_background=True)
    except Exception as error:
        case.update(status='reference-exception', exceptionType=type(error).__name__)
    else:
        if not np.isfinite(foreground).all() or not np.isfinite(background).all():
            raise RuntimeError('non-finite-reference')
        case.update(status='returned', foreground=foreground.ravel().tolist(), background=background.ravel().tolist(),
                    dtype=str(foreground.dtype), foregroundSha256=hashlib.sha256(foreground.tobytes()).hexdigest(),
                    backgroundSha256=hashlib.sha256(background.tobytes()).hexdigest())
    if args.byte_alpha and case['status']=='returned':
        rgb8 = np.rint(image*255).astype(np.uint8)
        alpha8 = np.rint(alpha*255).astype(np.uint8)
        rgba = np.clip(np.concatenate((foreground, alpha[:,:,None]),axis=2)*255,0,255).astype(np.uint8)
        rgba[:,:,:3][alpha8==255] = rgb8[alpha8==255]
        case['rgbaBase64'] = base64.b64encode(rgba.tobytes()).decode()
        case['rgbBase64'] = base64.b64encode(rgb8.tobytes()).decode()
        case['alphaBase64'] = base64.b64encode(alpha8.tobytes()).decode()
    assert np.array_equal(image, original_image) and np.array_equal(alpha, original_alpha)
    report['cases'].append(case)
    # Partial evidence survives a later failed/limited capture, without a success claim.
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
types = io.StringIO()
module._estimate_fb_ml.inspect_types(file=types)
(args.output / 'inferred-types.txt').write_text(types.getvalue())
llvm = module._estimate_fb_ml.inspect_llvm()
for index, text in enumerate(llvm.values()):
    (args.output / f'core-{index}.ll').write_text(text)
if any(case['status']!='returned' for case in report['cases'] if case['name']!='single'):
    raise RuntimeError('unexpected-reference-case-failure')
stage('after-cases')
report['memorySamples']=memory_samples
report['elapsedSeconds']=time.monotonic()-started
report['guards']={'addressSpaceBytes':512*1024**2,'cpuSeconds':30,'threads':1}
report['coreSignatures'] = [str(signature) for signature in module._estimate_fb_ml.signatures]
report['status'] = 'captured'
(args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': 'captured', 'cases': len(report['cases']), 'versions': report['versions']}))
