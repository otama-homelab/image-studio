"""Execute the exact release functions with a CPU-only CUDA interface double."""
import ast
from pathlib import Path
import types
import unittest

APP = Path(__file__).resolve().parents[1] / 'app'


def functions(filename, names, namespace):
    tree = ast.parse((APP / filename).read_text())
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    if {node.name for node in nodes} != set(names):
        raise AssertionError('Release function missing')
    exec(compile(ast.Module(body=nodes, type_ignores=[]), filename, 'exec'), namespace)


class ModelReleaseTests(unittest.TestCase):
    def setup_release(self, initialized=True):
        events = []
        refiner = types.ModuleType('image_studio_refinement')
        refiner.model, refiner.processor = object(), object()
        functions('image_studio_refinement.py', {'unload_model'}, refiner.__dict__)
        def cache_release():
            self.assertIsNone(namespace['model'])
            self.assertIsNone(refiner.model)
            self.assertIsNone(refiner.processor)
            events.append('cache_release')
        namespace = {
            'model': object(), 'active_model': 'birefnet',
            'sys': types.SimpleNamespace(modules={'image_studio_refinement': refiner}),
            'os': types.SimpleNamespace(environ={}),
            'gc': types.SimpleNamespace(collect=lambda: events.append('gc')),
            'torch': types.SimpleNamespace(cuda=types.SimpleNamespace(
                is_initialized=lambda: initialized,
                synchronize=lambda: events.append('synchronize'), empty_cache=cache_release)),
        }
        functions('image_studio_gpu.py', {'unload_model', 'runtime_model_status'}, namespace)
        return namespace, refiner, events

    def test_release_clears_both_models_before_emptying_allocator(self):
        namespace, refiner, events = self.setup_release()
        self.assertEqual(namespace['runtime_model_status']()['models_loaded'],
                         {'birefnet': True, 'vitmatte': True})
        namespace['unload_model']()
        self.assertEqual(events, ['synchronize', 'gc', 'cache_release'])
        self.assertFalse(namespace['runtime_model_status']()['model_loaded'])
        self.assertIsNone(namespace['active_model'])

    def test_refiner_alone_counts_as_a_loaded_gpu_model(self):
        namespace, refiner, events = self.setup_release()
        namespace['model'] = None
        self.assertTrue(namespace['runtime_model_status']()['model_loaded'])
        namespace['unload_model']()
        self.assertFalse(namespace['runtime_model_status']()['model_loaded'])

    def test_release_before_cuda_initialization_does_not_initialize_device(self):
        namespace, refiner, events = self.setup_release(initialized=False)
        namespace['unload_model']()
        self.assertEqual(events, ['gc'])
        self.assertIsNone(refiner.model)


if __name__ == '__main__':
    unittest.main()
