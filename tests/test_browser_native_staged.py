"""Tiny whole-session vs staged semantic checks; no HR inference."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))


class StagedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import numpy as np
            import onnx
            import onnxruntime as ort
        except ImportError:
            raise unittest.SkipTest('Use the pinned ONNX environment')
        cls.np,cls.onnx,cls.ort=np,onnx,ort

    def fixture(self):
        h,T=self.onnx.helper,self.onnx.TensorProto
        nodes=[];weights=[];acc=None
        for i in range(4):
            weights.append(self.onnx.numpy_helper.from_array(self.np.array([i+.25],dtype=self.np.float32),f'w{i}'))
            nodes.append(h.make_node('Mul',['x',f'w{i}'],[f'p{i}'],name=f'part{i}'))
            if acc is None:acc=f'p{i}'
            else:nodes.append(h.make_node('Add',[acc,f'p{i}'],[f'a{i}'],name=f'add{i}'));acc=f'a{i}'
        model=h.make_model(h.make_graph(nodes,'accumulator',[h.make_tensor_value_info('x',T.FLOAT,[1,4])],
            [h.make_tensor_value_info(acc,T.FLOAT,[1,4])],weights),opset_imports=[h.make_opsetid('',19)],ir_version=13)
        return self.onnx.shape_inference.infer_shapes(model),{'x':self.np.array([[-1,0,.5,1]],dtype=self.np.float32)}

    def test_staged_matches_whole_session_and_streams_accumulator(self):
        from browser_native_staged import evaluate
        model,feeds=self.fixture();events=[]
        options=self.ort.SessionOptions();options.intra_op_num_threads=options.inter_op_num_threads=1
        options.graph_optimization_level=self.ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        expected=self.ort.InferenceSession(model.SerializeToString(),options,providers=['CPUExecutionProvider']).run(None,feeds)[0]
        actual,report=evaluate(model,feeds,model_dir='.',callback=events.append)
        self.np.testing.assert_array_equal(actual['a3'],expected)
        self.assertEqual([e['node'] for e in events],['part1','part0','add1','part2','add2','part3','add3'])
        self.assertEqual(report['executed_nodes'],len(model.graph.node))

    def test_external_initializers_are_resolved_without_copying_them_into_model(self):
        from browser_native_staged import evaluate
        model,feeds=self.fixture()
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'model.onnx'
            self.onnx.save_model(model,path,save_as_external_data=True,all_tensors_to_one_file=True,location='weights.data',size_threshold=0)
            model=self.onnx.load(path,load_external_data=False)
            self.assertTrue(all(x.external_data for x in model.graph.initializer))
            actual,_=evaluate(model,feeds,model_dir=folder)
            self.np.testing.assert_array_equal(actual['a3'],feeds['x']*7)

    def test_missing_source_metadata_is_rejected(self):
        from browser_native_staged import evaluate
        model,feeds=self.fixture();del model.graph.value_info[:]
        with self.assertRaises(ValueError):evaluate(model,feeds,model_dir='.')


if __name__=='__main__':unittest.main()
