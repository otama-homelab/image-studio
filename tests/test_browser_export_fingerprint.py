import importlib.util
from pathlib import Path
import tempfile
import unittest
import onnx
from onnx import helper, TensorProto

spec=importlib.util.spec_from_file_location('export_fingerprint',Path(__file__).parents[1]/'tools/fingerprint_browser_export.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def model():
 return helper.make_model(helper.make_graph([helper.make_node('Identity',['x'],['y'])],'graph',[helper.make_tensor_value_info('x',TensorProto.FLOAT,[1])],[helper.make_tensor_value_info('y',TensorProto.FLOAT,[1])]))

class FingerprintTests(unittest.TestCase):
 def test_only_known_export_metadata_is_normalized(self):
  a=model();b=model()
  for m,text,ranges in [(a,'/old/torch.py','{s2: VR[1, 8], s1: VR[1, 8]}'),(b,'/new/torch.py','{s1: VR[1, 8], s2: VR[1, 8]}')]:
   p=m.graph.node[0].metadata_props.add();p.key='pkg.torch.onnx.stack_trace';p.value=text
   p=m.graph.metadata_props.add();p.key='pkg.torch.export.ExportedProgram.range_constraints';p.value=ranges
  self.assertEqual(module.normalized_digest(a),module.normalized_digest(b))
  b.graph.node[0].op_type='Relu';self.assertNotEqual(module.normalized_digest(a),module.normalized_digest(b))
 def test_bounds_unknown_metadata_and_malformed_ranges_are_not_ignored(self):
  a=model();b=model();p=b.graph.metadata_props.add();p.key='other';p.value='changed'
  self.assertNotEqual(module.normalized_digest(a),module.normalized_digest(b))
  a=model();b=model()
  for m,hi in [(a,8),(b,9)]:
   p=m.graph.metadata_props.add();p.key='pkg.torch.export.ExportedProgram.range_constraints';p.value=f'{{s1: VR[1, {hi}]}}'
  self.assertNotEqual(module.normalized_digest(a),module.normalized_digest(b))
  a=model();b=model();a.graph.initializer.append(helper.make_tensor('constant',TensorProto.FLOAT,[1],[1.]));b.graph.initializer.append(helper.make_tensor('constant',TensorProto.FLOAT,[1],[2.]))
  self.assertNotEqual(module.normalized_digest(a),module.normalized_digest(b))
  for value in ['{s1: VR[1, 8], s1: VR[1, 8]}','untrusted()']:
   b=model();p=b.graph.metadata_props.add();p.key='pkg.torch.export.ExportedProgram.range_constraints';p.value=value
   with self.assertRaises(ValueError):module.normalized_digest(b)
 def test_external_bytes_are_bound_and_paths_cannot_escape(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);m=model();t=m.graph.initializer.add();t.name='weights';t.data_type=TensorProto.FLOAT;t.dims.append(1);t.data_location=TensorProto.EXTERNAL
   p=t.external_data.add();p.key='location';p.value='weights.data';(root/'weights.data').write_bytes(b'1234');path=root/'model.onnx';onnx.save(m,path)
   a=module.fingerprint(path);(root/'weights.data').write_bytes(b'4321');b=module.fingerprint(path)
   self.assertNotEqual(a['externalData'],b['externalData']);self.assertNotEqual(a['exportSha256'],b['exportSha256'])
   t.external_data[0].value='../private';onnx.save(m,path)
   with self.assertRaises(ValueError):module.fingerprint(path)

if __name__=='__main__':unittest.main()
