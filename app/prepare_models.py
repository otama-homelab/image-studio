"""Preload pinned local models; no upstream application checkout is needed."""
from pathlib import Path
import urllib.request
from huggingface_hub import snapshot_download
for folder in ['kernels', 'db']:
    (Path('/cache/miopen') / folder).mkdir(parents=True, exist_ok=True)
# Only face detection and 106 landmarks are extracted; no identity model.
import hashlib
import zipfile
face_root = Path('/cache/insightface/models/antelopev2')
face_root.mkdir(parents=True, exist_ok=True)
face_models = {
    'scrfd_10g_bnkps.onnx': '5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91',
    '2d106det.onnx': 'f001b856447c413801ef5c42091ed0cd516fcd21f2d6b79635b1e733a7109dbf',
}
def valid_model(name, digest):
    p = face_root / name
    return p.exists() and hashlib.sha256(p.read_bytes()).hexdigest() == digest
if not all(valid_model(name,digest) for name,digest in face_models.items()):
    pack = Path('/cache/insightface-antelopev2.zip.tmp')
    urllib.request.urlretrieve('https://github.com/deepinsight/insightface/releases/download/v0.7/antelopev2.zip',pack)
    with pack.open('rb') as stream:
        digest = hashlib.file_digest(stream,'sha256').hexdigest()
    if digest != '8e182f14fc6e80b3bfa375b33eb6cff7ee05d8ef7633e738d1c89021dcf0c5c5':
        raise RuntimeError('InsightFace model archive checksum mismatch')
    with zipfile.ZipFile(pack) as archive:
        for name in face_models:
            (face_root/name).write_bytes(archive.read('antelopev2/'+name))
    pack.unlink()
    if not all(valid_model(name,digest) for name,digest in face_models.items()):
        raise RuntimeError('InsightFace model checksum mismatch')

snapshot_download('ZhengPeng7/BiRefNet_HR-matting',
                  revision='5d6b6f8adcb5b417c871b1d84ceaae9871355b7f',
                  allow_patterns=['*.py', 'config.json', 'model.safetensors', 'README.md'])

snapshot_download('hustvl/vitmatte-base-distinctions-646',
                  revision='b58373f8dbbfbeb58157456e2e4949f9f872aa18',
                  allow_patterns=['config.json', 'preprocessor_config.json', 'model.safetensors', 'README.md'])

print('Image Studio / rembg models prepared', flush=True)
