"""Tiny, synthetic EXIF orientation fixtures for later real-browser acceptance."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from PIL import Image, ImageOps, __version__
parser = argparse.ArgumentParser()
parser.add_argument('output', type=Path)
args = parser.parse_args()
if __version__ != '12.3.0':
    raise SystemExit('pillow-version-mismatch')
if args.output.exists():
    raise SystemExit('output-already-exists')
os.umask(0o077)
args.output.mkdir(mode=0o700)
width, height = 17, 11
raw = bytes((x * 37 + y * 59 + channel * 83) % 256
            for y in range(height) for x in range(width) for channel in range(3))
image = Image.frombytes('RGB', (width, height), raw)
sha = lambda data: hashlib.sha256(data).hexdigest()
rows = []
baseline = None
for orientation in range(1, 9):
    name = f'orientation-{orientation}.jpg'
    exif = Image.Exif()
    exif[274] = orientation
    image.save(args.output / name, format='JPEG', quality=95, subsampling=0, optimize=False, progressive=False, exif=exif)
    encoded = (args.output / name).read_bytes()
    with Image.open(args.output / name) as decoded:
        assert decoded.getexif()[274] == orientation
        assert decoded.size == (width, height)
        decoded.load()
        decoded_raw = decoded.convert('RGB').tobytes()
        if baseline is None:
            baseline = decoded_raw
        assert decoded_raw == baseline, 'EXIF must be the only decoded-image difference'
        oriented = ImageOps.exif_transpose(decoded).convert('RGB')
        expected_size = (height, width) if orientation >= 5 else (width, height)
        assert oriented.size == expected_size
        reference = oriented.tobytes()
        reference_name = f'orientation-{orientation}.rgb'
        (args.output / reference_name).write_bytes(reference)
        # Lossless display companion has no inherited EXIF and cannot rotate a second time.
        clean = Image.frombytes('RGB', oriented.size, reference)
        clean.save(args.output / f'orientation-{orientation}-reference.png')
        rows.append({'orientation': orientation, 'filename': name, 'fileBytes': len(encoded),
                     'fileSha256': sha(encoded), 'rawSize': [width, height],
                     'expectedSize': list(oriented.size), 'referenceFilename': reference_name,
                     'referenceRgbSha256': sha(reference), 'referenceRgbBytes': len(reference)})
report = {'status': 'reference-captured', 'pillow': __version__,
          'sourcePattern': '(x*37+y*59+channel*83)%256', 'sourceRgbSha256': sha(raw),
          'unorientedDecodedRgbSha256': sha(baseline), 'cases': rows,
          'limits': ['Synthetic JPEG RGB only; no ICC, CMYK, progressive or production photos',
                     'Pillow decode/transpose reference only; actual browser decode and pixel tolerance unverified',
                     'No GPU/model/browser/NumPy initialized']}
(args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': report['status'], 'cases': len(rows), 'size': [width, height]}))
