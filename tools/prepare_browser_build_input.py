"""Prepare the fixed anonymous HF build input, failing closed before artifact creation."""
import ctypes
import errno
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request

MAX_FILE=25*1024**2
MAX_EXPANDED=64*1024**2


class InputPreparationError(ValueError):pass


def _validate_candidate(candidate):
    try:
        if set(candidate)!={'source_id','source','archive','pairing','member_count'}:raise ValueError()
        if not re.fullmatch('sha256:[a-f0-9]{64}',candidate['source_id']):raise ValueError()
        if type(candidate['member_count']) is not int or not 1<=candidate['member_count']<=512:raise ValueError()
        for role,keys,limit in [('source',{'revision','path','bytes','sha256'},MAX_EXPANDED),('archive',{'url','path','bytes','sha256'},MAX_EXPANDED),('pairing',{'url','bytes','sha256'},65536)]:
            descriptor=candidate[role]
            if set(descriptor)!=keys or type(descriptor['bytes']) is not int or not 1<=descriptor['bytes']<=limit or not re.fullmatch('[a-f0-9]{64}',descriptor['sha256']):raise ValueError()
        if not re.fullmatch('[a-f0-9]{40}',candidate['source']['revision']):raise ValueError()
        _safe_path(candidate['source']['path']);_safe_path(candidate['archive']['path'])
        urls={}
        for role in ['archive','pairing']:
            match=re.fullmatch(r'https://huggingface\.co/otama3/image-studio-models/resolve/([a-f0-9]{40})/([A-Za-z0-9._/-]+)',candidate[role]['url'])
            if not match:raise ValueError()
            _safe_path(match[2]);urls[role]=match
        if urls['archive'][1]!=urls['pairing'][1] or urls['archive'][2]!=candidate['archive']['path']:raise ValueError()
        return candidate
    except (ValueError,KeyError,TypeError):raise InputPreparationError('invalid-build-input-descriptor') from None


def load_candidate(value):
    if value is None or value=='':raise InputPreparationError('build-input-descriptor-required')
    def unique(pairs):
        result=dict(pairs)
        if len(result)!=len(pairs):raise ValueError()
        return result
    try:
        if not isinstance(value,str) or len(value)>16384:raise ValueError()
        return _validate_candidate(json.loads(value,object_pairs_hook=unique))
    except (ValueError,TypeError):raise InputPreparationError('invalid-build-input-descriptor') from None


def _https_hub_url(value):
    try:
        url=urllib.parse.urlsplit(value);host=url.hostname or ''
        valid=(host=='huggingface.co' or host.endswith('.huggingface.co') or host=='hf.co' or host.endswith('.hf.co'))
        if url.scheme!='https' or not valid or url.username or url.password or url.port not in {None,443}:raise ValueError()
    except ValueError:raise InputPreparationError('untrusted-input-redirect') from None


class FixedRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,request,file,code,message,headers,newurl):
        _https_hub_url(newurl)
        return super().redirect_request(request,file,code,message,headers,newurl)


def download_fixed(url,limit):
    _https_hub_url(url)
    # No Hub SDK, environment token, Authorization, cookies or browser credentials.
    request=urllib.request.Request(url,headers={'Accept-Encoding':'identity'})
    with urllib.request.build_opener(FixedRedirect()).open(request,timeout=30) as response:
        _https_hub_url(response.geturl());return response.read(limit+1)


def _verified_fetch(descriptor,fetch_bytes):
    try:body=fetch_bytes(descriptor['url'],descriptor['bytes'])
    except InputPreparationError:raise
    except Exception:raise InputPreparationError('anonymous-input-fetch-failed') from None
    if len(body)!=descriptor['bytes'] or hashlib.sha256(body).hexdigest()!=descriptor['sha256']:
        raise InputPreparationError('input-size-or-sha-mismatch')
    return body


def _safe_path(name):
    path=PurePosixPath(name)
    if not name or '\\' in name or '\0' in name or path.is_absolute() or '..' in path.parts or path.as_posix()!=name:
        raise ValueError()
    return path


def _checked_members(body,pair,candidate):
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(body)) as zipped:expanded=zipped.read(MAX_EXPANDED+1)
        if len(expanded)>MAX_EXPANDED:raise ValueError()
        members={}
        with tarfile.open(fileobj=io.BytesIO(expanded),mode='r:') as archive:
            for member in archive:
                _safe_path(member.name)
                if (member.name in members or member.type not in {tarfile.REGTYPE,tarfile.AREGTYPE}
                    or member.linkname or member.sparse or member.size<0 or member.size>MAX_FILE):raise ValueError()
                members[member.name]=archive.extractfile(member).read(MAX_FILE+1)
                if len(members)>candidate['member_count']+1:raise ValueError()
        manifest_name='release-input/input-manifest.json';manifest_body=members[manifest_name]
        if hashlib.sha256(manifest_body).hexdigest()!=pair['inputManifestSha256']:raise ValueError()
        rows=json.loads(manifest_body)['files'];names=set();files={}
        if len(rows)!=candidate['member_count']:raise ValueError()
        for row in rows:
            name=row['path'];path=_safe_path(name)
            if name in names or type(row['bytes']) is not int or not 0<=row['bytes']<=MAX_FILE or not re.fullmatch('[a-f0-9]{64}',row['sha256']):raise ValueError()
            value=members['release-input/input/'+name]
            if len(value)!=row['bytes'] or hashlib.sha256(value).hexdigest()!=row['sha256']:raise ValueError()
            names.add(name);files[name]=value
        if set(members)!={manifest_name}|{'release-input/input/'+name for name in names}:raise ValueError()
        if any(parent.as_posix() in names for name in names for parent in PurePosixPath(name).parents if parent.as_posix()!='.'):raise ValueError()
        return files
    except (ValueError,KeyError,TypeError,AttributeError,OSError,EOFError,tarfile.TarError):
        raise InputPreparationError('invalid-input-archive') from None


def publish_no_replace(staging,destination):
    # Ubuntu CI: renameat2(RENAME_NOREPLACE) publishes the complete tree atomically.
    # A check followed by ordinary rename could overwrite a racing empty directory.
    libc=ctypes.CDLL(None,use_errno=True)
    try:rename=libc.renameat2
    except AttributeError:raise InputPreparationError('atomic-input-publication-unavailable') from None
    rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];rename.restype=ctypes.c_int
    if rename(-100,os.fsencode(staging),-100,os.fsencode(destination),1):
        error=ctypes.get_errno()
        raise InputPreparationError('input-destination-exists' if error in {errno.EEXIST,errno.ENOTEMPTY} else 'atomic-input-publication-failed')


def prepare_build_input(destination,*,candidate,fetch_bytes=download_fixed):
    candidate=_validate_candidate(candidate)
    destination=Path(destination).absolute()
    if os.path.lexists(destination):raise InputPreparationError('input-destination-exists')
    if not destination.parent.is_dir() or any(parent.is_symlink() for parent in [destination.parent,*destination.parent.parents]):
        raise InputPreparationError('unsafe-input-parent')
    try:
        pair=json.loads(_verified_fetch(candidate['pairing'],fetch_bytes))
        expected=candidate['archive']
        if (pair['sourceArchive']!=candidate['source'] or pair['modelRuntimeRevision']!=candidate['source']['revision']
            or any(pair['inputArchive'][key]!=expected[key] for key in ['path','bytes','sha256'])
            # source_id records the input's review build, not the current app release.
            or pair['inputMembers']!=candidate['member_count'] or pair['reviewBuild']['sourceId']!=candidate['source_id']):
            raise ValueError()
    except InputPreparationError:raise
    except (ValueError,KeyError,TypeError):raise InputPreparationError('input-pair-mismatch') from None
    files=_checked_members(_verified_fetch(candidate['archive'],fetch_bytes),pair,candidate)
    staging=Path(tempfile.mkdtemp(prefix='.background-release-',dir=destination.parent))
    try:
        for name,body in files.items():
            target=staging/name;target.parent.mkdir(parents=True,exist_ok=True)
            with target.open('xb') as stream:stream.write(body)
        publish_no_replace(staging,destination)
    finally:
        if staging.exists():shutil.rmtree(staging)


if __name__=='__main__':
    try:
        root=Path(__file__).resolve().parents[1]
        # Release metadata stays outside its own source snapshot to avoid hash cycles.
        candidate=load_candidate(os.environ.get('IMAGE_STUDIO_BUILD_INPUT'))
        prepare_build_input(root/'web/background-release',candidate=candidate)
        print('Fixed anonymous background input prepared; private marker preserved.')
    except InputPreparationError as error:
        print(str(error),file=sys.stderr);raise SystemExit(1)
