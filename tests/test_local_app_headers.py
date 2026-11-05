"""No server/browser/model is started: verify the local Worker CSP boundary."""
import importlib.util
import hashlib
import json
import tempfile
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('poc_server', Path(__file__).parents[1] / 'tools/browser-webgpu-poc/serve.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class LocalWorkerHeaders(unittest.TestCase):
    def test_private_lan_requires_explicit_https_matching_host_and_cpu_modnet(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entry = root / 'entry.html'
            entry.write_text('fixture')
            manifest = {'status': 'local-app-built-not-started', 'scope': 'local-validation-only-not-approved-for-distribution', 'distributionApproved': False, 'privateLanHttps': True, 'appOrigin': 'https://192.168.100.8:17863', 'backgroundModel': 'modnet', 'runtimeConfig': {'executionProvider': 'wasm'}, 'entry': '/local-validation.html', 'mounts': [{'route': '/local-validation.html', 'source': str(entry), 'bytes': 7}]}
            file = root / 'app.json'
            file.write_text(json.dumps(manifest))
            self.assertIn('/local-validation.html', server.local_app_routes(root, file, 17863, lan_host='192.168.100.8'))
            for host in [None, '192.168.100.9', '8.8.8.8']:
                with self.assertRaises(ValueError):
                    server.local_app_routes(root, file, 17863, lan_host=host)
            for key, value in [('privateLanHttps', False), ('backgroundModel', 'hr'), ('appOrigin', 'http://192.168.100.8:17863')]:
                changed = {**manifest, key: value}
                file.write_text(json.dumps(changed))
                with self.assertRaises(ValueError):
                    server.local_app_routes(root, file, 17863, lan_host='192.168.100.8')

    def test_js_eval_denied_and_verified_children_scoped_to_model_owner(self):
        model = '/validation-workers/' + 'a' * 64 + '/model-prepare-worker.js'
        self.assertNotIn("'unsafe-eval'", server.local_app_csp(model))
        self.assertIn("worker-src 'self' blob:;", server.local_app_csp(model))
        for route in ['/', '/local-validation.html', '/assets/app.js',
                      model.replace('model-prepare-worker', 'stage-worker'),
                      model.replace('model-prepare-worker', 'trimap-worker'),
                      model.replace('a' * 64, 'unverified'), model + '.extra']:
            self.assertNotIn("'unsafe-eval'", server.local_app_csp(route))
            self.assertIn("'wasm-unsafe-eval'", server.local_app_csp(route))
            self.assertIn("worker-src 'self';", server.local_app_csp(route))

    def test_runtime_cache_is_explicit_and_excludes_queries_models_and_documents(self):
        runtime = '/runtime/ort/1.31.1/' + 'a' * 64 + '/runtime.wasm'
        self.assertEqual(server.local_cache_control(runtime), 'no-store')
        self.assertEqual(server.local_cache_control(runtime, True), 'public, max-age=31536000, immutable')
        for route in ['/', '/local-validation.html', '/models/test/hr/model.onnx', '/inputs/photo.png', runtime + '?retry=1', runtime.replace('a' * 64, 'unpinned')]:
            self.assertEqual(server.local_cache_control(route, True), 'no-store')

    def test_runtime_cache_requires_matching_manifest_hash_and_actual_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime = root / 'runtime.wasm'
            runtime.write_bytes(b'wasm!')
            digest = hashlib.sha256(b'wasm!').hexdigest()
            entry = root / 'entry.html'
            entry.write_text('fixture')
            route = '/runtime/ort/1.31.1/' + digest + '/runtime.wasm'
            manifest = {'status': 'local-app-built-not-started', 'scope': 'local-validation-only-not-approved-for-distribution', 'distributionApproved': False, 'appOrigin': 'http://127.0.0.1:17861', 'entry': '/local-validation.html', 'mounts': [{'route': '/local-validation.html', 'source': str(entry), 'bytes': 7}, {'route': route, 'source': str(runtime), 'bytes': 5, 'sha256': digest}]}
            file = root / 'app.json'
            file.write_text(json.dumps(manifest))
            self.assertEqual(server.local_app_routes(root, file, 17861, True)[route], runtime)
            manifest['mounts'][1]['sha256'] = '0' * 64
            file.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'URL hash'):
                server.local_app_routes(root, file, 17861, True)
            manifest['mounts'][1]['sha256'] = digest
            file.write_text(json.dumps(manifest))
            runtime.write_bytes(b'other')
            with self.assertRaisesRegex(ValueError, 'Runtime bytes'):
                server.local_app_routes(root, file, 17861, True)
            self.assertEqual(server.local_app_routes(root, file, 17861)[route], runtime)


if __name__ == '__main__':
    unittest.main()
