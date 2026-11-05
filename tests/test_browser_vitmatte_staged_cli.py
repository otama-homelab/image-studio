"""Tiny CLI integration; no learned models or HR inference."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

class StagedCLI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import numpy as np
            import onnx
            import onnxruntime
            from PIL import Image
        except ImportError:
            raise unittest.SkipTest('Use the pinned ONNX environment')
        cls.np,cls.onnx,cls.Image=np,onnx,Image

    def setUp(self):
        import hashlib
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.inputs=self.root/'inputs';self.inputs.mkdir()
        h=self.onnx.helper;T=self.onnx.TensorProto
        graph=h.make_graph([h.make_node('ReduceMean',['pixel_values','axes'],['alphas'],keepdims=1)],'tiny',
            [h.make_tensor_value_info('pixel_values',T.FLOAT,[1,4,32,32])],
            [h.make_tensor_value_info('alphas',T.FLOAT,[1,1,32,32])],[h.make_tensor('axes',T.INT64,[1],[1])])
        m=h.make_model(graph,opset_imports=[h.make_opsetid('',18)],ir_version=13)
        self.onnx.save(m,self.root/'model.onnx')
        data=self.np.full((1,4,32,32),.5,dtype=self.np.float32).tobytes();(self.inputs/'input.f32').write_bytes(data)
        cases=[]
        for name in ['first','second']:
            folder=self.root/name/'refine-on';folder.mkdir(parents=True)
            for file in ['alpha.png','trimap.png']:self.Image.fromarray(self.np.full((32,32),128,dtype=self.np.uint8)).save(folder/file)
            cases.append(dict(id=name,file='input.f32',shape=[1,4,32,32],dtype='float32',original_size=[32,32],bytes=len(data),sha256=hashlib.sha256(data).hexdigest()))
        (self.inputs/'inputs.json').write_text(json.dumps({'cases':cases}))

    def run_cli(self,out,*flags):
        tool=Path(__file__).resolve().parents[1]/'tools/compare_browser_vitmatte_native.py'
        return subprocess.run([sys.executable,str(tool),'--onnx',str(self.root/'model.onnx'),'--inputs',str(self.inputs),'--reference-root',str(self.root),'--output',str(out),'--threads','1',*flags],capture_output=True,text=True,timeout=30)

    def test_selected_case_whole_and_staged(self):
        for mode in ['whole','staged']:
            out=self.root/mode;flags=['--case','second']+(['--staged'] if mode=='staged' else [])
            p=self.run_cli(out,*flags);self.assertEqual(p.returncode,0,p.stderr)
            r=json.loads((out/'report.json').read_text())
            self.assertEqual(r['status'],'selected_reference_metrics_measured_not_accepted')
            self.assertEqual([c['id'] for c in r['cases']],['second'])
            self.assertEqual(r['cases'][0]['metrics']['all']['max_error'],0)
            if mode=='staged':self.assertEqual(r['cases'][0]['staged_execution']['executed_nodes'],1)

    def test_unknown_case_rejected(self):
        out=self.root/'unknown';p=self.run_cli(out,'--case','absent','--staged')
        self.assertNotEqual(p.returncode,0)
        self.assertIn('Unknown selected case ID',p.stderr)
        self.assertEqual(json.loads((out/'report.json').read_text())['status'],'failed')

if __name__=='__main__':unittest.main()
