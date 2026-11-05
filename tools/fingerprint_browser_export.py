"""Fingerprint pinned ONNX exports while normalizing known non-execution metadata.

External tensor files remain bound by full SHA-256. No model is modified or run.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import onnx

TRACE = 'pkg.torch.onnx.stack_trace'
RANGES = 'pkg.torch.export.ExportedProgram.range_constraints'
ENTRY = re.compile(r'((?:\d+\*)?s\d+): VR\[(-?\d+), (-?\d+)\]')


def walk(message):
    yield message
    for field, value in message.ListFields():
        if field.message_type:
            for child in value if field.is_repeated else [value]:
                yield from walk(child)


def normalized_digest(model):
    copy = onnx.ModelProto()
    copy.CopyFrom(model)
    for message in walk(copy):
        if not hasattr(message, 'metadata_props'):
            continue
        kept = []
        for prop in message.metadata_props:
            if prop.key == TRACE:
                continue
            if prop.key == RANGES:
                entries = ENTRY.findall(prop.value)
                rendered = '{' + ', '.join(f'{k}: VR[{lo}, {hi}]' for k, lo, hi in entries) + '}'
                if rendered != prop.value or len({k for k, _, _ in entries}) != len(entries):
                    raise ValueError('Unsupported export range metadata')
                prop.value = '{' + ', '.join(f'{k}: VR[{lo}, {hi}]' for k, lo, hi in sorted(entries)) + '}'
            kept.append((prop.key, prop.value))
        del message.metadata_props[:]
        for key, value in kept:
            prop = message.metadata_props.add()
            prop.key, prop.value = key, value
    return hashlib.sha256(copy.SerializeToString(deterministic=True)).hexdigest()


def fingerprint(path):
    path = Path(path)
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 64 * 1024**2:
        raise ValueError('Regular bounded ONNX export required')
    data = path.read_bytes()
    model = onnx.load_model_from_string(data)
    root = path.resolve().parent
    external = {}
    for message in walk(model):
        if not isinstance(message, onnx.TensorProto) or message.data_location != onnx.TensorProto.EXTERNAL:
            continue
        locations = [p.value for p in message.external_data if p.key == 'location']
        if len(locations) != 1:
            raise ValueError('Explicit external tensor location required')
        location = locations[0]
        if not re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*', location) or any(p in ['.', '..'] for p in location.split('/')):
            raise ValueError('External tensor path must stay inside export directory')
        file = (root / location).resolve(strict=True)
        if not file.is_relative_to(root) or not file.is_file():
            raise ValueError('External tensor path must stay inside export directory')
        if location not in external:
            with file.open('rb') as stream:
                external[location] = {'bytes': file.stat().st_size, 'sha256': hashlib.file_digest(stream, 'sha256').hexdigest()}
    identity = {'normalizedModelSha256': normalized_digest(model),
                'externalData': dict(sorted(external.items()))}
    export_digest = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'schemaVersion': 1, 'rawModelSha256': hashlib.sha256(data).hexdigest(),
            **identity, 'exportSha256': export_digest,
            'normalization': 'known exporter stack traces removed; symbolic range keys sorted; other protobuf fields preserved'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('model', type=Path)
    args = parser.parse_args()
    print(json.dumps(fingerprint(args.model), indent=2))
