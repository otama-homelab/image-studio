"""Generate tiny independent PNG references locally; never part of the web runtime."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import warnings


def grayscale(Image, args, version_text):
    records = []
    for mode in ('L', 'LA', 'L-tRNS'):
        for width, height, adam in ((1, 5, False), (3, 5, False), (9, 5, False), (9, 11, True)):
            gray = bytes((37*x + 61*y + 11) % 256 for y in range(height) for x in range(width))
            pixels = bytes(value for i, g in enumerate(gray) for value in (g, (0, 64, 128, 255)[i % 4])) if mode == 'LA' else gray
            file = args.output_dir / f'{mode.lower()}8-{width}x{height}{"-adam7" if adam else ""}.png'
            with Image.frombytes('LA' if mode == 'LA' else 'L', (width, height), pixels) as image:
                image.save(file, format='PNG', **({'transparency': 11} if mode == 'L-tRNS' else {}))
            if adam:
                subprocess.run([args.optipng, '-quiet', '-o1', '-nb', '-nc', '-np', '-i', '1', str(file)], check=True, capture_output=True)
            data = file.read_bytes()
            assert data[24] == 8 and data[25] == (4 if mode == 'LA' else 0) and data[28] == int(adam)
            with Image.open(file) as loaded:
                rgba = loaded.convert('RGBA').tobytes()
                rgb = loaded.convert('RGB').tobytes()
            expected = bytes(value for i, g in enumerate(gray) for value in (g, g, g, (0, 64, 128, 255)[i % 4] if mode == 'LA' else 0 if mode == 'L-tRNS' and g == 11 else 255))
            assert rgba == expected
            records.append({'file': file.name, 'width': width, 'height': height, 'mode': mode, 'depth': 8, 'interlace': int(adam), 'sha256': hashlib.sha256(data).hexdigest(), 'rgbaBase64': base64.b64encode(rgba).decode(), 'rgbSha256': hashlib.sha256(rgb).hexdigest()})
    manifest = {'generator': 'Pillow PNG writer; optipng/libpng for Adam7, preserving color type/depth', 'pillowVersion': Image.__version__, 'optipngVersion': version_text, 'generatorSource': 'tools/generate_indexed_png_fixtures.py --kind grayscale', 'source': 'Synthetic exact gray/alpha samples; no personal photos', 'fixtures': records}
    (args.output_dir / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps({'fixtures': len(records), 'bytes': sum((args.output_dir / item['file']).stat().st_size for item in records)}))


def load_pypng(args):
    if not args.pypng_root:
        raise RuntimeError('PyPNG reference requires --pypng-root')
    sys.path.insert(0, str(args.pypng_root))
    import png
    if png.__version__ != '0.20220715.0':
        raise RuntimeError('Reference requires PyPNG 0.20220715.0')
    return png


def rgb16(Image, args):
    png = load_pypng(args)
    records = []
    values = (0, 1, 255, 256, 257, 32767, 32768, 65534, 65535)
    alphas = (0, 1, 255, 256, 32767, 32768, 65535)
    for channels in (3, 4):
        for width, height, adam in ((1, 5, False), (3, 5, False), (9, 5, False), (9, 11, True)):
            samples = [alphas[p % len(alphas)] if c == 3 else values[(p*3+c*2+2) % len(values)] for p in range(width*height) for c in range(channels)]
            file = args.output_dir / f'{"rgb" if channels == 3 else "rgba"}16-{width}x{height}{"-adam7" if adam else ""}.png'
            rows = [samples[y*width*channels:(y+1)*width*channels] for y in range(height)]
            with file.open('wb') as output:
                png.Writer(width, height, greyscale=False, alpha=channels == 4, bitdepth=16, interlace=adam).write(output, rows)
            data = file.read_bytes()
            assert data[24] == 16 and data[25] == (2 if channels == 3 else 6) and data[28] == int(adam)
            with Image.open(file) as loaded:
                rgba = loaded.convert('RGBA').tobytes()
                rgb = loaded.convert('RGB').tobytes()
            expected = bytes((samples[p*channels+c] >> 8) if c < channels else 255 for p in range(width*height) for c in range(4))
            assert rgba == expected
            records.append({'file': file.name, 'width': width, 'height': height, 'channels': channels, 'depth': 16, 'interlace': int(adam), 'sha256': hashlib.sha256(data).hexdigest(), 'samples': samples, 'rgbaBase64': base64.b64encode(rgba).decode(), 'rgbSha256': hashlib.sha256(rgb).hexdigest()})
    manifest = {'generator': 'PyPNG writer; independent Pillow decoding and RGB/RGBA conversion', 'pypngVersion': png.__version__, 'pillowVersion': Image.__version__, 'generatorSource': 'tools/generate_indexed_png_fixtures.py --kind rgb16', 'source': 'Synthetic exact 16-bit samples; includes values around byte boundaries and hidden RGB', 'fixtures': records}
    (args.output_dir / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps({'fixtures': len(records), 'bytes': sum((args.output_dir / item['file']).stat().st_size for item in records)}))


def gray16(Image, args):
    png = load_pypng(args)
    values = (0, 1, 255, 256, 257, 32767, 32768, 65534, 65535)
    alphas = (0, 1, 255, 256, 32767, 32768, 65535)
    records = []
    for mode in ('L', 'LA', 'L-tRNS'):
        channels = 2 if mode == 'LA' else 1
        key = 257 if mode == 'L-tRNS' else None
        for width, height, adam in ((1, 5, False), (3, 5, False), (9, 5, False), (9, 11, True)):
            gray = [values[p % len(values)] for p in range(width*height)]
            samples = [v for p, g in enumerate(gray) for v in ((g, alphas[p % len(alphas)]) if channels == 2 else (g,))]
            rows = [samples[y*width*channels:(y+1)*width*channels] for y in range(height)]
            file = args.output_dir / f'{mode.lower()}16-{width}x{height}{"-adam7" if adam else ""}.png'
            with file.open('wb') as output:
                png.Writer(width, height, greyscale=True, alpha=channels == 2, bitdepth=16, interlace=adam, transparent=key).write(output, rows)
            data = file.read_bytes()
            assert data[24] == 16 and data[25] == (4 if channels == 2 else 0) and data[28] == int(adam)
            w, h, decoded, info = png.Reader(bytes=data).asRGBA()
            rgba16 = [list(row) for row in decoded]
            expected16 = [v for p, g in enumerate(gray) for v in (g, g, g, alphas[p % len(alphas)] if channels == 2 else 0 if g == key else 65535)]
            assert (w, h, info['bitdepth']) == (width, height, 16)
            assert [v for row in rgba16 for v in row] == expected16
            # Independent Pillow truecolor16 path avoids its I;16 -> RGB clamp.
            equivalent = io.BytesIO()
            png.Writer(width, height, greyscale=False, alpha=True, bitdepth=16).write(equivalent, rgba16)
            with Image.open(io.BytesIO(equivalent.getvalue())) as image:
                rgba = image.convert('RGBA').tobytes()
                rgb = image.convert('RGB').tobytes()
            with Image.open(io.BytesIO(data)) as legacy:
                original_rgb = legacy.convert('RGB').tobytes()
                original_rgba = legacy.convert('RGBA').tobytes()
            records.append({'file': file.name, 'width': width, 'height': height, 'channels': channels, 'mode': mode, 'depth': 16, 'interlace': int(adam), 'transparentKey': key, 'samples': samples, 'sha256': hashlib.sha256(data).hexdigest(), 'rgbaBase64': base64.b64encode(rgba).decode(), 'rgbSha256': hashlib.sha256(rgb).hexdigest(), 'originalPillowRgbSha256': hashlib.sha256(original_rgb).hexdigest(), 'originalPillowRgbaBase64': base64.b64encode(original_rgba).decode()})
    manifest = {'generator': 'PyPNG gray16 writer/16-bit RGBA expansion; equivalent truecolor16 PNG decoded by Pillow', 'pypngVersion': png.__version__, 'pillowVersion': Image.__version__, 'policy': 'Same upper-byte conversion as equivalent RGB/RGBA16; deliberately differs from Pillow direct I;16 clamp and tRNS behavior', 'generatorSource': 'tools/generate_indexed_png_fixtures.py --kind gray16', 'source': 'Synthetic boundary samples, hidden gray and full-precision transparency key257', 'fixtures': records}
    (args.output_dir / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps({'fixtures': len(records), 'bytes': sum((args.output_dir / item['file']).stat().st_size for item in records)}))


def gray_low(Image, args):
    png = load_pypng(args)
    records = []
    for depth in (1, 2, 4):
        count = 1 << depth
        for keyed in (False, True):
            for width, height, adam in ((1, 5, False), (3, 5, False), (9, 5, False), (9, 11, True)):
                samples = [(x+3*y) % count for y in range(height) for x in range(width)]
                rows = [samples[y*width:(y+1)*width] for y in range(height)]
                file = args.output_dir / f'l{depth}-{"key1-" if keyed else ""}{width}x{height}{"-adam7" if adam else ""}.png'
                with file.open('wb') as output:
                    png.Writer(width, height, greyscale=True, bitdepth=depth, interlace=adam, transparent=1 if keyed else None).write(output, rows)
                data = file.read_bytes()
                assert data[24] == depth and data[25] == 0 and data[28] == int(adam)
                w, h, rgba_rows, info = png.Reader(bytes=data).asRGBA8()
                rgba = bytes(v for row in rgba_rows for v in row)
                assert (w, h, info['bitdepth']) == (width, height, 8)
                expected = bytes(v for sample in samples for v in (sample*255//(count-1),)*3+(0 if keyed and sample == 1 else 255,))
                assert rgba == expected
                with Image.open(io.BytesIO(data)) as image:
                    rgb = image.convert('RGB').tobytes()
                    legacy_rgba = image.convert('RGBA').tobytes()
                assert rgb == bytes(v for i, v in enumerate(rgba) if i % 4 != 3)
                records.append({'file': file.name, 'width': width, 'height': height, 'depth': depth, 'interlace': int(adam), 'keyed': keyed, 'sha256': hashlib.sha256(data).hexdigest(), 'rgbaBase64': base64.b64encode(rgba).decode(), 'rgbSha256': hashlib.sha256(rgb).hexdigest(), 'originalPillowRgbaBase64': base64.b64encode(legacy_rgba).decode()})
    manifest = {'generator': 'PyPNG writer/RGBA8 reference; independent Pillow RGB reference', 'pypngVersion': png.__version__, 'pillowVersion': Image.__version__, 'generatorSource': 'tools/generate_indexed_png_fixtures.py --kind gray-low', 'policy': 'PNG transparency compares original samples; Pillow2/4bit direct RGBA may differ', 'source': 'Synthetic packed grayscale rows with padding and key1', 'fixtures': records}
    (args.output_dir / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps({'fixtures': len(records), 'bytes': sum((args.output_dir / item['file']).stat().st_size for item in records)}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pillow-root', type=Path)
    parser.add_argument('--optipng', default='optipng')
    parser.add_argument('--kind', choices=('indexed', 'grayscale', 'rgb16', 'gray16', 'gray-low'), default='indexed')
    parser.add_argument('--pypng-root', type=Path)
    parser.add_argument('--output-dir', type=Path)
    args = parser.parse_args()
    if args.pillow_root:
        sys.path.insert(0, str(args.pillow_root))
    from PIL import Image
    if Image.__version__ != '12.3.0':
        raise RuntimeError('Reference requires Pillow 12.3.0')
    if args.output_dir is None:
        args.output_dir = Path(__file__).resolve().parents[1] / 'web/tests/fixtures' / ('png-'+args.kind)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if args.kind == 'rgb16':
        rgb16(Image, args)
        return
    if args.kind == 'gray16':
        gray16(Image, args)
        return
    if args.kind == 'gray-low':
        gray_low(Image, args)
        return
    version = subprocess.run([args.optipng, '-version'], check=True, capture_output=True, text=True)
    version_text = (version.stdout + version.stderr).strip().splitlines()[0]
    if args.kind == 'grayscale':
        grayscale(Image, args, version_text)
        return
    records = []
    for depth in (1, 2, 4):
        count = 1 << depth
        colors = [((i * 37 + 11) % 256, (i * 67 + 23) % 256, (i * 97 + 41) % 256) for i in range(count)]
        table = [value for color in colors for value in color] + [0] * (768 - count * 3)
        alpha = [255] * count
        alpha[1] = 0
        if count > 2:
            alpha[-1] = 128
        for width, height, adam in ((1, 5, False), (3, 5, False), (9, 5, False), (9, 11, True)):
            pixels = bytes((x + 3 * y) % count for y in range(height) for x in range(width))
            with Image.frombytes('P', (width, height), pixels) as image:
                image.putpalette(table)
                file = args.output_dir / f'p{depth}-{width}x{height}{"-adam7" if adam else ""}.png'
                image.save(file, format='PNG', bits=depth, transparency=bytes(alpha))
            if adam:
                subprocess.run([args.optipng, '-quiet', '-o1', '-nb', '-nc', '-np', '-i', '1', str(file)], check=True, capture_output=True)
            data = file.read_bytes()
            assert data[24] == depth and data[25] == 3 and data[28] == int(adam)
            with Image.open(file) as loaded:
                rgba = loaded.convert('RGBA').tobytes()
                # Match the server's deliberate alpha discard, retaining palette RGB.
                with warnings.catch_warnings():
                    warnings.filterwarnings('ignore', message='Palette images with Transparency expressed in bytes.*', category=UserWarning)
                    rgb = loaded.convert('RGB').tobytes()
            expected = bytes(value for index in pixels for value in (*colors[index], alpha[index]))
            assert rgba == expected
            records.append({'file': file.name, 'width': width, 'height': height, 'depth': depth, 'interlace': int(adam), 'sha256': hashlib.sha256(data).hexdigest(), 'rgbaBase64': base64.b64encode(rgba).decode(), 'rgbSha256': hashlib.sha256(rgb).hexdigest()})
    manifest = {'generator': 'Pillow PNG writer; optipng/libpng for Adam7, preserving bit depth and palette', 'pillowVersion': Image.__version__, 'optipngVersion': version_text, 'generatorSource': 'tools/generate_indexed_png_fixtures.py', 'source': 'Synthetic exact small indices; no personal photos', 'fixtures': records}
    (args.output_dir / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Generated {len(records)} synthetic fixtures')


if __name__ == '__main__':
    main()
