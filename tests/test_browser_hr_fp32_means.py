from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))

class FP32Means(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            import numpy as np
            import onnx
            import onnxruntime as ort
        except ImportError:
            raise unittest.SkipTest('Use the pinned ONNX environment')
        cls.np,cls.onnx,cls.ort=np,onnx,ort

    def fixture(self,size=512,axes=(2,3)):
        o=self.onnx;h=o.helper;T=o.TensorProto
        return h.make_model(h.make_graph([h.make_node('ReduceMean',['x','axes'],['y'],keepdims=1,name='mean')],
            'tiny',[h.make_tensor_value_info('x',T.FLOAT16,[1,2,size,size])],
            [h.make_tensor_value_info('y',T.FLOAT16,[1,2,1,1])],
            [h.make_tensor('axes',T.INT64,[2],list(axes))]),opset_imports=[h.make_opsetid('',19)],ir_version=13)

    def test_large_reduction_native_parity_and_original_records(self):
        from promote_browser_hr_means import promote
        for size in [256,512]:
            with self.subTest(size=size):
                source=self.fixture(size,axes=(-1,-2) if size==512 else (2,3));snapshot=source.SerializeToString();result,changes=promote(source)
                self.assertEqual(source.SerializeToString(),snapshot)
                for field in ['initializer','input','output']:
                    self.assertEqual([v.SerializeToString() for v in getattr(source.graph,field)],
                                     [v.SerializeToString() for v in getattr(result.graph,field)])
                self.assertEqual(len(changes),1)
                options=self.ort.SessionOptions();options.intra_op_num_threads=options.inter_op_num_threads=1
                options.graph_optimization_level=self.ort.GraphOptimizationLevel.ORT_DISABLE_ALL
                data=self.np.ones((1,2,size,size),dtype=self.np.float16);data[:,1]=-2
                original=self.ort.InferenceSession(snapshot,options,providers=['CPUExecutionProvider']).run(None,{'x':data})[0]
                actual=self.ort.InferenceSession(result.SerializeToString(),options,providers=['CPUExecutionProvider']).run(None,{'x':data})[0]
                self.np.testing.assert_array_equal(actual,original)
                self.np.testing.assert_array_equal(actual.reshape(-1),[1,-2])
                self.assertEqual(actual.dtype,self.np.float16)
                self.onnx.checker.check_model(result)

    def test_reject_different_axes_and_dtypes(self):
        from promote_browser_hr_means import promote
        with self.assertRaises(ValueError):promote(self.fixture(axes=(1,3)))
        m=self.fixture();m.graph.input[0].type.tensor_type.elem_type=self.onnx.TensorProto.FLOAT
        with self.assertRaises(ValueError):promote(m)

if __name__=='__main__':unittest.main()
