"""Small real-ORT comparisons of full attention and query-row chunks."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np
import onnx
from onnx import helper, TensorProto
import onnxruntime as ort

spec = importlib.util.spec_from_file_location('query_chunks', Path(__file__).parents[1] / 'tools/chunk_browser_vitmatte_queries.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class QueryChunksTest(unittest.TestCase):
    def test_mha_loop_keeps_unscaled_queries_full_keys_and_ragged_carry(self):
        for height,width in [(9,5),(17,5)]:
            count=height*width;shape=[1,count,64]
            inputs=[helper.make_tensor_value_info(n,TensorProto.FLOAT,s) for n,s in [('q',shape),('k',shape),('v',shape),('rh',[1,height,width,height,1]),('rw',[1,height,width,1,width])]]
            nodes=module.loop_mha_nodes('test','q','k','v','rh','rw','result')
            graph=helper.make_graph(nodes,'loop-mha',inputs,[helper.make_tensor_value_info('result',TensorProto.FLOAT,shape)])
            model=helper.make_model(graph,opset_imports=[helper.make_opsetid('',18),helper.make_opsetid('com.microsoft',1)],ir_version=10);onnx.checker.check_model(model)
            rng=np.random.default_rng(42);feed={value.name:rng.normal(0,.3,[d.dim_value for d in value.type.tensor_type.shape.dim]).astype(np.float32) for value in inputs}
            q,k,v=feed['q'],feed['k'],feed['v'];bias=(feed['rh']+feed['rw']).reshape(1,count,count)
            scores=(q*.125)@k.transpose(0,2,1)+bias;prob=np.exp(scores-scores.max(-1,keepdims=True));reference=(prob/prob.sum(-1,keepdims=True))@v
            options=ort.SessionOptions();options.intra_op_num_threads=options.inter_op_num_threads=1
            actual=ort.InferenceSession(model.SerializeToString(),options,providers=['CPUExecutionProvider']).run(None,feed)[0]
            np.testing.assert_allclose(actual,reference,atol=2e-6,rtol=2e-5)
            for wrong in [((q*.25)@k.transpose(0,2,1)+bias,v),(((q*.125)@k[:,:-1].transpose(0,2,1)+bias[:,:,:-1]),v[:,:-1])]:
                score,values=wrong;p=np.exp(score-score.max(-1,keepdims=True));bad=(p/p.sum(-1,keepdims=True))@values
                self.assertTrue(np.any(np.abs(bad-reference)>2e-6+2e-5*np.abs(reference)))
            body=helper.get_attribute_value(next(a for a in nodes[-1].attribute if a.name=='body'))
            mha=next(n for n in body.node if n.op_type=='MultiHeadAttention');self.assertEqual(list(mha.input[:3]),['test/slice_query','k','v']);self.assertFalse(any(n.op_type=='Slice' and n.input[0] in ['k','v'] for n in body.node))

    def test_mha_transform_rejects_unpinned_source(self):
        model=helper.make_model(helper.make_graph([], 'wrong', [], []))
        with self.assertRaises(ValueError):module.transform(model,attention_backend='mha')

    def test_full_keys_and_relative_terms_match_for_ragged_and_rectangular_shapes(self):
        for height, width in [(1, 1), (3, 5), (17, 3), (9, 11)]:
            with self.subTest(height=height, width=width):
                count = height * width
                inputs = [helper.make_tensor_value_info(name, TensorProto.FLOAT, shape) for name, shape in [
                    ('q', [1, count, 64]), ('k', [1, 64, count]), ('v', [1, count, 64]),
                    ('rh', [1, height, width, height, 1]), ('rw', [1, height, width, 1, width])]]
                output = helper.make_tensor_value_info('result', TensorProto.FLOAT, [1, count, 64])
                def constant(name, values):
                    return helper.make_node('Constant', [], [name], value=helper.make_tensor(name, TensorProto.INT64, [len(values)], values))
                full = [constant('shape5', [1, height, width, height, width]), constant('shape3', [1, count, count]),
                        helper.make_node('MatMul', ['q', 'k'], ['scores']), helper.make_node('Reshape', ['scores', 'shape5'], ['view']),
                        helper.make_node('Add', ['view', 'rh'], ['with_h']), helper.make_node('Add', ['with_h', 'rw'], ['with_w']),
                        helper.make_node('Reshape', ['with_w', 'shape3'], ['flat']), helper.make_node('Softmax', ['flat'], ['probability'], axis=-1),
                        helper.make_node('MatMul', ['probability', 'v'], ['result'])]
                chunked = module.chunk_attention_nodes('test', 'q', 'k', 'v', 'rh', 'rw', 'result', rows=8)
                rng = np.random.default_rng(42)
                feed = {value.name: rng.normal(0, .1, [d.dim_value for d in value.type.tensor_type.shape.dim]).astype(np.float32) for value in inputs}
                results = []
                for nodes in [full, chunked]:
                    model = helper.make_model(helper.make_graph(nodes, 'attention', inputs, [output]), opset_imports=[helper.make_opsetid('', 18)], ir_version=10)
                    onnx.checker.check_model(model)
                    options = ort.SessionOptions(); options.intra_op_num_threads = 1; options.inter_op_num_threads = 1
                    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
                    results.append(ort.InferenceSession(model.SerializeToString(), options, providers=['CPUExecutionProvider']).run(None, feed)[0])
                np.testing.assert_allclose(results[1], results[0], rtol=1e-5, atol=1e-6)
                self.assertEqual(results[1].shape, (1, count, 64))

    def test_invalid_chunk_sizes_reject_before_graph_creation(self):
        for rows in [0, -1, True, 1.5, 9]:
            with self.assertRaises(ValueError):
                module.chunk_attention_nodes('test', 'q', 'k', 'v', 'rh', 'rw', 'result', rows=rows)

if __name__ == '__main__':
    unittest.main()
