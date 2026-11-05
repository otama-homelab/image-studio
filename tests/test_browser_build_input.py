import copy
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

spec=importlib.util.spec_from_file_location('build_input',Path(__file__).parents[1]/'tools/prepare_browser_build_input.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
sha=lambda body:hashlib.sha256(body).hexdigest()
TEST_DESCRIPTOR={
    'source_id':'sha256:'+'3'*64,
    'source':{'revision':'2'*40,'path':'releases/source-fixture/source/app-source.tar.gz','bytes':1234,'sha256':'4'*64},
    'archive':{'url':'https://huggingface.co/otama3/image-studio-models/resolve/'+'1'*40+'/releases/input-fixture/build-input.tar.gz','path':'releases/input-fixture/build-input.tar.gz','bytes':1,'sha256':'5'*64},
    'pairing':{'url':'https://huggingface.co/otama3/image-studio-models/resolve/'+'1'*40+'/releases/input-fixture/APP_RELEASE_PAIRING.json','bytes':1,'sha256':'6'*64},
    'member_count':3,
}


class BuildInputTests(unittest.TestCase):
    def fixture(self,extra=(),manifest_change=None):
        files={'release.json':b'{"config":"config.json"}', 'config.json':b'{}','LOCAL_VALIDATION_ONLY.json':b'{"distributionApproved":false}'}
        manifest={'files':[dict(path=name,bytes=len(body),sha256=sha(body)) for name,body in files.items()]}
        if manifest_change:manifest_change(manifest)
        metadata=json.dumps(manifest).encode();raw=io.BytesIO()
        with tarfile.open(fileobj=raw,mode='w') as archive:
            for name,body in list(('release-input/input/'+k,v) for k,v in files.items())+[('release-input/input-manifest.json',metadata)]+list(extra):
                item=tarfile.TarInfo(name) if isinstance(name,str) else name
                item.size=len(body);archive.addfile(item,io.BytesIO(body))
        compressed=gzip.compress(raw.getvalue());candidate=copy.deepcopy(TEST_DESCRIPTOR)
        candidate.update(member_count=len(files));candidate['archive'].update(bytes=len(compressed),sha256=sha(compressed))
        pair=dict(sourceArchive=candidate['source'],modelRuntimeRevision=candidate['source']['revision'],inputArchive=dict(path=candidate['archive']['path'],bytes=len(compressed),sha256=sha(compressed)),inputMembers=len(files),inputManifestSha256=sha(metadata),reviewBuild=dict(sourceId=candidate['source_id']))
        pair_body=json.dumps(pair).encode();candidate['pairing'].update(bytes=len(pair_body),sha256=sha(pair_body))
        bodies={candidate['pairing']['url']:pair_body,candidate['archive']['url']:compressed}
        return candidate,bodies,files

    def prepare(self,root,candidate,bodies):
        return module.prepare_build_input(root/'background-release',candidate=candidate,fetch_bytes=lambda url,limit:bodies[url])

    def test_valid_input_is_connected_and_private_marker_still_blocks_pages(self):
        candidate,bodies,files=self.fixture()
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.prepare(root,candidate,bodies)
            self.assertEqual({p.name:p.read_bytes() for p in (root/'background-release').iterdir()},files)
            code='import {checkDist} from "./web/scripts/check-dist.mjs"; await checkDist(process.argv[1]);'
            result=subprocess.run(['node','--input-type=module','-e',code,str(root/'background-release')],cwd=Path(__file__).parents[1],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0);self.assertIn('Local validation artifact must not be deployed',result.stderr)

    def test_fixed_model_input_can_be_reused_by_a_new_app_release(self):
        candidate,bodies,_=self.fixture()
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.prepare(root,candidate,bodies)
            code='import {createBuildInfo} from "./web/scripts/build-info.mjs"; console.log(JSON.stringify(createBuildInfo("./web",process.argv[1])));'
            repo=Path(__file__).parents[1]
            result=subprocess.run(['node','--input-type=module','-e',code,str(root/'background-release')],cwd=repo,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            info=json.loads(result.stdout)
            self.assertNotEqual(info['sourceId'],candidate['source_id'])
            self.assertEqual(info['appVersion'],(repo/'VERSION').read_text().strip())

    def test_network_failure_is_sanitized_and_leaves_no_input(self):
        candidate,_,_=self.fixture()
        def fail(url,limit):raise HTTPError(url,401,'token must not appear in diagnostics',{},None)
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'background-release'
            with self.assertRaisesRegex(module.InputPreparationError,'^anonymous-input-fetch-failed$'):
                module.prepare_build_input(target,candidate=candidate,fetch_bytes=fail)
            self.assertFalse(target.exists())

    def test_archive_and_pair_require_exact_size_and_sha(self):
        for selected,field in [('archive','bytes'),('archive','sha256'),('pairing','bytes'),('pairing','sha256')]:
            with self.subTest(selected=selected,field=field),tempfile.TemporaryDirectory() as directory:
                candidate,bodies,_=self.fixture();url=candidate[selected]['url'];body=bodies[url];bodies[url]=body+b'!' if field=='bytes' else bytes([body[0]^1])+body[1:]
                with self.assertRaisesRegex(module.InputPreparationError,'input-size-or-sha-mismatch'):self.prepare(Path(directory),candidate,bodies)
                self.assertFalse((Path(directory)/'background-release').exists())

    def test_invalid_tar_and_unsafe_names_links_types_duplicates_are_rejected(self):
        link=tarfile.TarInfo('release-input/input/link');link.type=tarfile.SYMTYPE;link.linkname='/outside'
        hard=tarfile.TarInfo('release-input/input/hard');hard.type=tarfile.LNKTYPE;hard.linkname='release-input/input/config.json'
        device=tarfile.TarInfo('release-input/input/device');device.type=tarfile.CHRTYPE
        cases=[('release-input/input/../../escape',b'x'),('/absolute',b'x'),('release-input/input\\escape',b'x'),('release-input/input/config.json',b'{}'),(link,b''),(hard,b''),(device,b'')]
        for entry in cases:
            with self.subTest(entry=str(entry[0])),tempfile.TemporaryDirectory() as directory:
                candidate,bodies,_=self.fixture(extra=[entry])
                with self.assertRaisesRegex(module.InputPreparationError,'invalid-input-archive'):self.prepare(Path(directory),candidate,bodies)
                self.assertFalse((Path(directory)/'background-release').exists())
        candidate,bodies,_=self.fixture();bodies[candidate['archive']['url']]=b'not a tar';candidate['archive'].update(bytes=9,sha256=sha(b'not a tar'))
        pair=json.loads(bodies[candidate['pairing']['url']]);pair['inputArchive'].update(bytes=9,sha256=sha(b'not a tar'));body=json.dumps(pair).encode();bodies[candidate['pairing']['url']]=body;candidate['pairing'].update(bytes=len(body),sha256=sha(body))
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(module.InputPreparationError,'invalid-input-archive'):self.prepare(Path(directory),candidate,bodies)

    def test_member_manifest_rejects_hash_mismatch_and_duplicate_entries(self):
        for change in [lambda m:m['files'][0].update(sha256='0'*64),lambda m:m['files'].append(m['files'][0])]:
            candidate,bodies,_=self.fixture(manifest_change=change)
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaisesRegex(module.InputPreparationError,'invalid-input-archive'):self.prepare(Path(directory),candidate,bodies)

    def test_review_source_or_model_pair_mismatch_is_not_accepted(self):
        for field in ['source','model']:
            candidate,bodies,_=self.fixture();pair=json.loads(bodies[candidate['pairing']['url']])
            if field=='source':pair['reviewBuild']['sourceId']='sha256:'+'0'*64
            else:pair['modelRuntimeRevision']='0'*40
            body=json.dumps(pair).encode();bodies[candidate['pairing']['url']]=body
            candidate['pairing'].update(bytes=len(body),sha256=sha(body))
            with self.subTest(field=field),tempfile.TemporaryDirectory() as directory:
                with self.assertRaisesRegex(module.InputPreparationError,'input-pair-mismatch'):self.prepare(Path(directory),candidate,bodies)

    def test_existing_destination_or_parent_symlink_is_preserved(self):
        candidate,bodies,_=self.fixture()
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);target=root/'background-release';target.mkdir();(target/'keep').write_bytes(b'unchanged')
            with self.assertRaisesRegex(module.InputPreparationError,'input-destination-exists'):self.prepare(root,candidate,bodies)
            self.assertEqual((target/'keep').read_bytes(),b'unchanged')
            (root/'link').symlink_to(root,target_is_directory=True)
            with self.assertRaisesRegex(module.InputPreparationError,'unsafe-input-parent'):
                module.prepare_build_input(root/'link/new',candidate=candidate,fetch_bytes=lambda url,limit:bodies[url])

    def test_atomic_publication_does_not_replace_a_racing_empty_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);staging=root/'staging';staging.mkdir();(staging/'data').write_bytes(b'checked');destination=root/'destination';destination.mkdir()
            with self.assertRaisesRegex(module.InputPreparationError,'input-destination-exists'):module.publish_no_replace(staging,destination)
            self.assertEqual(list(destination.iterdir()),[]);self.assertEqual((staging/'data').read_bytes(),b'checked')

    def test_anonymous_request_has_no_credentials_and_refuses_untrusted_redirects(self):
        class Response(io.BytesIO):
            def geturl(self):return TEST_DESCRIPTOR['archive']['url']
        class Opener:
            def open(self,request,timeout):
                self.request=request;return Response(b'abcd')
        opener=Opener()
        with patch.object(module.urllib.request,'build_opener',return_value=opener):
            self.assertEqual(module.download_fixed(TEST_DESCRIPTOR['archive']['url'],4),b'abcd')
        self.assertNotIn('Authorization',opener.request.headers);self.assertNotIn('Cookie',opener.request.headers)
        self.assertEqual(opener.request.headers.get('Accept-encoding'),'identity')
        for url in ['http://huggingface.co/file','https://127.0.0.1/file','https://huggingface.co.attacker.test/file','https://token@huggingface.co/file']:
            with self.assertRaises(module.InputPreparationError):module.FixedRedirect().redirect_request(opener.request,None,302,'',{},url)

    def test_external_release_descriptor_is_required_and_preserves_exact_pins(self):
        candidate,_,_=self.fixture()
        self.assertEqual(module.load_candidate(json.dumps(candidate)),candidate)
        for value in [None,'']:
            with self.assertRaisesRegex(module.InputPreparationError,'^build-input-descriptor-required$'):module.load_candidate(value)

    def test_external_descriptor_rejects_malformed_ambiguous_or_unfixed_metadata(self):
        candidate,_,_=self.fixture()
        changes=[lambda c:c['archive'].update(url=c['archive']['url'].replace('/otama3/','/otama/')),lambda c:c.update(Authorization='sensitive-test-value'),lambda c:c['archive'].update(bytes=-1),lambda c:c['archive'].update(bytes=True),lambda c:c['pairing'].update(sha256='bad'),lambda c:c['source'].update(revision='main'),lambda c:c.update(source_id='unfixed'),lambda c:c.update(member_count=0),lambda c:c['archive'].update(path='../escape'),lambda c:c['archive'].update(url=c['archive']['url'].replace('huggingface.co/otama','other.test/otama')),lambda c:c['archive'].update(url=c['archive']['url']+'?token=sensitive-test-value'),lambda c:c['pairing'].update(url=c['pairing']['url'].replace('1'*40,'7'*40))]
        invalid=['{sensitive-test-value','[]','{"source_id":1,"source_id":2}']
        for change in changes:
            value=copy.deepcopy(candidate);change(value);invalid.append(json.dumps(value))
        for value in invalid:
            with self.subTest(value=value[:40]),self.assertRaisesRegex(module.InputPreparationError,'^invalid-build-input-descriptor$'):
                module.load_candidate(value)


if __name__=='__main__':unittest.main()
