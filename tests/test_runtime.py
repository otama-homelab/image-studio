import json
from pathlib import Path
import sys
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))
from image_studio_runtime import RuntimeBusy, RuntimeGate, control_server


class GateTests(unittest.TestCase):
    def test_nested_gpu_work_finishes_after_outer_job_is_drained(self):
        gate = RuntimeGate()
        entered, proceed = threading.Event(), threading.Event()
        states = []
        @gate.job
        def inner():
            states.append(gate.status())
        @gate.job
        def outer():
            entered.set()
            if not proceed.wait(3):
                raise TimeoutError('test nested job release')
            inner()
        worker = threading.Thread(target=outer)
        worker.start()
        try:
            self.assertTrue(entered.wait(1))
            gate.drain()
        finally:
            proceed.set()
            worker.join(2)
        self.assertEqual(states, [{'accepting': False, 'active_jobs': 1}])
        self.assertEqual(gate.status(), {'accepting': False, 'active_jobs': 0})
        with self.assertRaises(RuntimeError):
            inner()

    def test_drain_waits_for_running_image_and_rejects_new_image(self):
        gate = RuntimeGate()
        entered, finish = threading.Event(), threading.Event()
        results = []
        @gate.job
        def image():
            entered.set()
            if not finish.wait(3):
                raise TimeoutError('test worker release')
            results.append('completed')
        worker = threading.Thread(target=image)
        worker.start()
        try:
            self.assertTrue(entered.wait(1))
            self.assertEqual(gate.drain(), {'accepting': False, 'active_jobs': 1})
            with self.assertRaises(RuntimeBusy):
                gate.release(lambda: results.append('unloaded'))
            with self.assertRaisesRegex(RuntimeError, '一時停止中'):
                image()
            self.assertEqual(results, [])
        finally:
            finish.set()
            worker.join(2)
        self.assertFalse(worker.is_alive())
        gate.release(lambda: results.append('unloaded'))
        self.assertEqual(results, ['completed', 'unloaded'])
        self.assertEqual(gate.status(), {'accepting': False, 'active_jobs': 0})
        gate.resume()
        self.assertTrue(gate.status()['accepting'])

    def test_failed_processing_releases_busy_count(self):
        gate = RuntimeGate()
        @gate.job
        def image():
            raise ValueError('processing failed')
        with self.assertRaises(ValueError):
            image()
        self.assertEqual(gate.status()['active_jobs'], 0)
        with self.assertRaises(RuntimeBusy):
            gate.release(lambda: None)

    def test_unload_failure_keeps_gate_closed(self):
        gate = RuntimeGate()
        gate.drain()
        def unload():
            raise ValueError('unload failed')
        with self.assertRaises(ValueError):
            gate.release(unload)
        self.assertFalse(gate.status()['accepting'])

    def test_resume_cannot_overlap_model_release(self):
        gate = RuntimeGate()
        gate.drain()
        entered, finish, resumed = threading.Event(), threading.Event(), threading.Event()
        def unload():
            entered.set()
            if not finish.wait(3):
                raise TimeoutError('test unload release')
        release = threading.Thread(target=lambda: gate.release(unload))
        resume = threading.Thread(target=lambda: (gate.resume(), resumed.set()))
        release.start()
        try:
            self.assertTrue(entered.wait(1))
            resume.start()
            self.assertFalse(resumed.wait(.05))
        finally:
            finish.set()
            release.join(2)
            if resume.ident is not None:
                resume.join(2)
        self.assertTrue(resumed.is_set())


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.gate = RuntimeGate()
        self.loaded = True
        def unload():
            self.loaded = False
        self.server = control_server(0, gate=self.gate, unload=unload,
                                     model_status=lambda: {'model_loaded': self.loaded})
        self.assertEqual(self.server.server_address[0], '127.0.0.1')
        self.base = 'http://127.0.0.1:' + str(self.server.server_address[1])
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)

    def request(self, path, method='POST', headers=None, data=None):
        request = Request(self.base + path, method=method, headers=headers or {}, data=data)
        try:
            response = urlopen(request, timeout=2)
        except HTTPError as error:
            response = error
        with response:
            return response.code, json.load(response)

    def test_normal_operator_flow_and_release_precondition(self):
        self.assertEqual(self.request('/release')[0], 409)
        self.assertTrue(self.loaded)
        self.assertFalse(self.request('/drain')[1]['accepting'])
        self.assertEqual(self.request('/release')[0], 200)
        code, state = self.request('/status', 'GET')
        self.assertEqual(code, 200)
        self.assertEqual(state, {'accepting': False, 'active_jobs': 0,
                                'model': {'model_loaded': False}})
        self.assertTrue(self.request('/resume')[1]['accepting'])

    def test_unknown_nonempty_and_cross_origin_requests_never_change_role(self):
        for path, headers, data in [('/unknown', {}, None),
                                     ('/drain', {'Origin': 'https://example.invalid'}, None),
                                     ('/drain', {}, b'{}')]:
            with self.subTest(path=path, headers=headers):
                self.assertIn(self.request(path, headers=headers, data=data)[0], (400, 404))
                self.assertTrue(self.gate.status()['accepting'])
        self.assertEqual(self.request('/drain', 'GET')[0], 404)


if __name__ == '__main__':
    unittest.main()
