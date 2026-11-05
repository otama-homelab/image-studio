"""Package pinned candidate exports for the application's external model mount."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

PINS = {
    'birefnet': ('ZhengPeng7/BiRefNet_HR-matting', '5d6b6f8adcb5b417c871b1d84ceaae9871355b7f'),
    'vitmatte': ('hustvl/vitmatte-base-distinctions-646', 'b58373f8dbbfbeb58157456e2e4949f9f872aa18'),
}


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--birefnet', type=Path, required=True)
    parser.add_argument('--vitmatte', type=Path, required=True)
    parser.add_argument('--runner', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--texture-limits', type=int, nargs=3, required=True,
                        metavar=('X', 'Y', 'Z'), help='measured target GPU 3D texture limits')
    args = parser.parse_args()
    if min(args.texture_limits) <= 0:
        parser.error('Texture limits must be positive')
    if args.output.exists():
        parser.error('Choose a fresh output directory')
    manifest = {'format': 1, 'candidate': True, 'production_accepted': False,
                'runner_sha256': digest(args.runner),
                'texture_limits': args.texture_limits, 'models': {}}
    reports = {}
    for name, (repository, revision) in PINS.items():
        artifact = getattr(args, name)
        report = json.loads(artifact.with_suffix('.json').read_text())
        if (report.get('status') != 'exported_unvalidated'
                or report.get('model') != name
                or report.get('repository') != repository or report.get('revision') != revision
                or report.get('delegate_partitions', 0) < 1):
            raise ValueError(f'{name}: invalid export report')
        limits = report.get('texture_limits')
        if (not isinstance(limits, list) or len(limits) != 3
                or any(type(value) is not int or value <= 0 for value in limits)
                or any(value > maximum for value, maximum in zip(limits, args.texture_limits))):
            raise ValueError(f'{name}: explicit export texture limits must fit the target GPU')
        sha = digest(artifact)
        if sha != report.get('artifact_sha256'):
            raise ValueError(f'{name}: artifact checksum mismatch')
        if name == 'birefnet':
            if report['shape'] != [1, 3, 2048, 2048]:
                raise ValueError('BiRefNet must retain 2048px')
            if not report.get('wide_convolutions', {}).get('split_convolutions'):
                raise ValueError('BiRefNet requires the packed-weight width correction')
        elif not report.get('dynamic_spatial_sizes'):
            raise ValueError('ViTMatte must retain variable dimensions')
        manifest['models'][name] = dict(file=name+'.pte', sha256=sha,
            repository=repository, revision=revision, input_shape=report['shape'],
            dynamic_spatial_sizes=bool(report.get('dynamic_spatial_sizes')))
        reports[name] = report
    args.output.parent.mkdir(parents=True, exist_ok=True)
    size = sum(getattr(args, name).stat().st_size for name in PINS)
    if shutil.disk_usage(args.output.parent).free < size + 100*1024**2:
        raise OSError('Insufficient space for model bundle')
    args.output.mkdir()
    for name in PINS:
        shutil.copyfile(getattr(args, name), args.output/(name+'.pte'))
        (args.output/(name+'-export.json')).write_text(json.dumps(reports[name], indent=2)+'\n')
    (args.output/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps({'output': str(args.output), 'candidate': True, 'bytes': size}))


if __name__ == '__main__':
    main()
