"""Build deterministic ZIP_STORED transport packs from a private model candidate.

Uses Python's standard ZIP writer, preserves model bytes, and never uploads.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
from urllib.parse import urlsplit
import zipfile


def digest_stream(stream, output=None):
    digest = hashlib.sha256()
    size = 0
    while chunk := stream.read(1024 * 1024):
        digest.update(chunk)
        size += len(chunk)
        if output is not None:
            output.write(chunk)
    return size, digest.hexdigest()


def stamp(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def build(root, app, policy, output):
    root = Path(root).resolve(strict=True)
    output = Path(output).absolute()
    if (not output.parent.resolve(strict=True).is_relative_to(root)
            or output.exists() or output.is_symlink()
            or app.get('scope') != 'local-validation-only-not-approved-for-distribution'
            or app.get('distributionApproved') is not False):
        raise ValueError('New private output and private candidate required')
    origin = urlsplit(app['appOrigin'])
    mounts = {item['route']: item for item in app['mounts']}
    if len(mounts) != len(app['mounts']):
        raise ValueError('Duplicate mounts')
    models = policy.get('models', [])
    if not models or len({item['model'] for item in models}) != len(models):
        raise ValueError('Explicit distinct model roles required')
    plans = []
    for model in models:
        role = model['model']
        files = model['resources']
        if role not in ['hr', 'matte', 'modnet', 'portrait', 'lite'] or not 1 <= len(files) <= 16384:
            raise ValueError('Invalid model archive')
        names = set()
        entries = []
        total = 22
        for item in files:
            name = item['name']
            if (not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_./-]+', name)
                    or name.startswith('/') or name.endswith('/') or '//' in name
                    or any(part in ['.', '..'] for part in name.split('/'))
                    or name in names or type(item['bytes']) is not int or item['bytes'] < 1
                    or not re.fullmatch(r'[a-f0-9]{64}', item['sha256'])):
                raise ValueError('Invalid archive entry')
            names.add(name)
            address = urlsplit(item['url'])
            mount = mounts.get(address.path)
            if ((address.scheme, address.netloc) != (origin.scheme, origin.netloc)
                    or address.query or address.fragment or not address.path.startswith('/models/')
                    or mount is None or any(mount[key] != item[key] for key in ['bytes', 'sha256'])):
                raise ValueError('Model resource differs from candidate mount')
            source = Path(mount['source'])
            if (source.is_symlink() or not stat.S_ISREG(source.stat().st_mode)
                    or not source.resolve(strict=True).is_relative_to(root)
                    or source.stat().st_size != item['bytes']):
                raise ValueError('Invalid model source')
            entries.append((item, source))
            total += item['bytes'] + 76 + 2 * len(name.encode('ascii'))
        # Current packs are below 1GB. Avoid implicit ZIP64 format changes.
        if total >= zipfile.ZIP64_LIMIT:
            raise ValueError('Split transport packs before requiring ZIP64')
        plans.append((model, entries, total))
    output.mkdir(mode=0o700)
    result = {'status': 'private-transport-packs-not-approved-for-distribution',
              'distributionApproved': False, 'format': 'zip-stored-v1',
              'weightFilesCopiedOutsideArchives': 0, 'models': []}
    try:
        for model, entries, expected_size in plans:
            archive = output / (model['model'] + '.zip')
            with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_STORED, allowZip64=False) as pack:
                for item, source in entries:
                    info = zipfile.ZipInfo(item['name'], date_time=(1980, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_STORED
                    info.create_system = 3
                    info.external_attr = 0o100644 << 16
                    info.file_size = item['bytes']
                    with os.fdopen(os.open(source, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
                        before = os.fstat(stream.fileno())
                        with pack.open(info, 'w') as destination:
                            actual = digest_stream(stream, destination)
                        if (actual != (item['bytes'], item['sha256'])
                                or stamp(before) != stamp(os.fstat(stream.fileno()))
                                or stamp(before) != stamp(source.stat())):
                            raise ValueError('Model source changed or failed SHA verification')
            archive.chmod(0o600)
            if archive.stat().st_size != expected_size:
                raise ValueError('Unexpected stored ZIP layout')
            with zipfile.ZipFile(archive) as pack:
                if pack.namelist() != [item['name'] for item, _ in entries]:
                    raise ValueError('Archive entry order changed')
                for item, _ in entries:
                    with pack.open(item['name']) as stream:
                        if digest_stream(stream) != (item['bytes'], item['sha256']):
                            raise ValueError('Restored archive entry differs from source')
            with archive.open('rb') as stream:
                size, sha256 = digest_stream(stream)
            result['models'].append({'model': model['model'], 'modelVersion': model['modelVersion'],
                                     'resources': model['resources'],
                                     'archive': {'file': archive.name, 'url': None,
                                                 'bytes': size, 'sha256': sha256}})
        (output / 'archives.candidate.json').write_text(json.dumps(result, indent=2) + '\n')
        return result
    except BaseException:
        shutil.rmtree(output)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('private_root', type=Path)
    parser.add_argument('candidate_manifest', type=Path)
    parser.add_argument('trusted_policy', type=Path)
    parser.add_argument('new_output', type=Path)
    args = parser.parse_args()
    result = build(args.private_root, json.loads(args.candidate_manifest.read_text()),
                   json.loads(args.trusted_policy.read_text()), args.new_output)
    print(json.dumps({'status': result['status'], 'models': [
        {'model': item['model'], 'files': len(item['resources']), **item['archive']}
        for item in result['models']], 'uploaded': False}))


if __name__ == '__main__':
    main()
