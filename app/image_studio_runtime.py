"""Local operator control for draining GPU jobs before a role handoff."""
from functools import wraps
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading


class RuntimeBusy(RuntimeError):
    pass


class RuntimeGate:
    def __init__(self):
        self._lock = threading.RLock()
        self._accepting = True
        self._active = 0
        self._thread = threading.local()

    def status(self, model_status=None):
        with self._lock:
            result = {'accepting': self._accepting, 'active_jobs': self._active}
            if model_status is not None:
                result['model'] = model_status()
            return result

    def job(self, function=None, *, paused_error=RuntimeError):
        if function is None:
            return lambda target: self.job(target, paused_error=paused_error)
        @wraps(function)
        def wrapped(*args, **kwargs):
            with self._lock:
                depth = getattr(self._thread, 'depth', 0)
                if depth == 0 and not self._accepting:
                    raise paused_error('画像処理は一時停止中です。画像用GPUへ切り替えてから再実行してください。')
                if depth == 0:
                    self._active += 1
                self._thread.depth = depth + 1
            try:
                return function(*args, **kwargs)
            finally:
                with self._lock:
                    self._thread.depth -= 1
                    if self._thread.depth == 0:
                        self._active -= 1
        return wrapped

    def drain(self):
        with self._lock:
            self._accepting = False
            return self.status()

    def release(self, unload):
        with self._lock:
            if self._accepting or self._active:
                raise RuntimeBusy('Stop admission and wait for active jobs before unloading')
            # Hold the gate while unloading so resume cannot overlap it.
            unload()
            return self.status()

    def resume(self):
        with self._lock:
            if self._active:
                raise RuntimeBusy('Wait for active jobs before resuming')
            self._accepting = True
            return self.status()


runtime = RuntimeGate()


def control_server(port, *, gate, unload, model_status):
    """Construct a loopback-only server; caller starts its daemon thread.

    No Service or external route should expose this port. Control is disabled
    unless the application explicitly enables it. GPU role ownership and kernel
    caps remain the external operator's responsibility.
    """
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def respond(self, code, value):
            body = json.dumps(value).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path != '/status':
                self.respond(404, {'error': 'Unknown runtime operation'})
                return
            try:
                self.respond(200, gate.status(model_status))
            except Exception:
                self.respond(500, {'error': 'Runtime status unavailable'})

        def do_POST(self):
            if self.headers.get('Origin') or self.headers.get('Transfer-Encoding') or self.headers.get('Content-Length', '0') != '0':
                self.close_connection = True
                self.respond(400, {'error': 'Runtime operations require an empty local request'})
                return
            try:
                if self.path == '/drain':
                    status = gate.drain()
                elif self.path == '/release':
                    status = gate.release(unload)
                elif self.path == '/resume':
                    status = gate.resume()
                else:
                    self.respond(404, {'error': 'Unknown runtime operation'})
                    return
                self.respond(200, status)
            except RuntimeBusy as error:
                self.respond(409, {'error': str(error), **gate.status()})
            except Exception:
                # Keep the gate drained on failed release; do not expose internals.
                self.respond(500, {'error': 'Runtime operation failed', **gate.status()})

    return ThreadingHTTPServer(('127.0.0.1', port), Handler)
