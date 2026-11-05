import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec=importlib.util.spec_from_file_location('archives',Path(__file__).parents[1]/'tools/build_browser_model_archives.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ArchiveTest(unittest.TestCase):
 def fixture(self,root):
  payload=root/'payload';payload.write_bytes(b'model graph bytes')
  resource={'name':'stage-000/model.onnx','url':'http://127.0.0.1:17861/models/graph','bytes':payload.stat().st_size,'sha256':hashlib.sha256(payload.read_bytes()).hexdigest()}
  app={'scope':'local-validation-only-not-approved-for-distribution','distributionApproved':False,'appOrigin':'http://127.0.0.1:17861','mounts':[{'route':'/models/graph','source':str(payload),'bytes':resource['bytes'],'sha256':resource['sha256']}]}
  policy={'models':[{'model':'hr','modelVersion':'fixture-v1','resources':[resource]}]}
  return payload,app,policy
 def test_stored_zip_is_deterministic_and_preserves_each_model_file(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);payload,app,policy=self.fixture(root)
   first=module.build(root,app,policy,root/'one');second=module.build(root,app,policy,root/'two')
   self.assertEqual((root/'one/hr.zip').read_bytes(),(root/'two/hr.zip').read_bytes())
   with zipfile.ZipFile(root/'one/hr.zip') as z:
    self.assertEqual(z.namelist(),['stage-000/model.onnx']);self.assertEqual(z.read(z.namelist()[0]),payload.read_bytes());self.assertEqual(z.infolist()[0].compress_type,zipfile.ZIP_STORED)
   self.assertEqual(first['models'][0]['archive']['sha256'],second['models'][0]['archive']['sha256'])
   self.assertFalse(first['distributionApproved']);self.assertEqual(first['weightFilesCopiedOutsideArchives'],0)
 def test_hash_mismatch_does_not_leave_a_partial_package(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);payload,app,policy=self.fixture(root);payload.write_bytes(b'wrong graph bytes')
   with self.assertRaises(ValueError):module.build(root,app,policy,root/'out')
   self.assertFalse((root/'out').exists())
 def test_rejects_duplicate_names_traversal_symlinks_and_mismatched_mounts(self):
  for case in ['duplicate','traversal','symlink','mount']:
   with self.subTest(case=case),tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);payload,app,policy=self.fixture(root)
    if case=='duplicate':policy['models'][0]['resources']*=2
    if case=='traversal':policy['models'][0]['resources'][0]['name']='../model'
    if case=='symlink':link=root/'link';link.symlink_to(payload);app['mounts'][0]['source']=str(link)
    if case=='mount':app['mounts'][0]['sha256']='0'*64
    with self.assertRaises(ValueError):module.build(root,app,policy,root/'out')
    self.assertFalse((root/'out').exists())

if __name__=='__main__':unittest.main()
