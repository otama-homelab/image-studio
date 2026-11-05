"""Loopback-only, GET-only model PoC server with an explicit file allowlist."""
import argparse
import ipaddress
import ssl
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
from pathlib import Path
from urllib.parse import urlsplit


HR_INPUT_SHA256 = {
    'reference-01': 'bf6ff495d0c1f2dab6d7fd6d17f6eb397b6475b72f8a177a65c762fb5f5a92ee',
    'reference-portrait-2000': 'f56506c012f1f35dddf2d1b392875bcc8ba3f2c4325903ebce2d7bee26bb5f41',
    'reference-landscape-2000': '6c6268c9fd9a6d03952ed2c2a15d21a766bd90ec0d20115534534b6efee997e5',
    'reference-square-2000': '45523c0acb4483c878342e2aa4a3693871f33c1c619ac26495b660bfd3da70e2',
    'reference-thumbnail-2001': 'd1284b1f655e648b2a43c78127725181de7766dc65d3a04dc294e70de14cffa8',
}


def model_contract(root, contract, model_dir=None, hr_input_set='original', checkpoint=None):
    """Return an explicit diagnostic contract; never infer precision from a filename."""
    if contract in ('birefnet-output-tiles-01','birefnet-fp32-means-01'):
        model_dir = model_dir or 'onnx-birefnet-grid-03'
        report = {
            'model-output-tiles-01.onnx': {'bytes': 9756195,
                'sha256': '3fbcfed0079e8a3b95bcba7c6bd2a8776a73c1e6681ab0aec51198bd24349006'},
            'model.onnx.data': {'bytes': 447632368,
                'sha256': '364eab4994414fb107c1ec7680dd98202ec4ddb3b8d3dcc87f5a5f887890bb7c'},
        }
        if contract=='birefnet-fp32-means-01':
            del report['model-output-tiles-01.onnx']
            report['model-fp32-means-01.onnx']={'bytes':9757686,
                'sha256':'584924efc01f490d3393eeff623fcfb0d807120e878d32a4b130a61f80aa1e41'}
        if hr_input_set not in ('original', 'full-reference'):
            raise ValueError('Unknown HR input set')
        inputs = root / ('birefnet-inputs-01' if hr_input_set == 'full-reference' else 'birefnet-native-reference-01')
        precision, input_name, output_name, channels = 'float16', 'pixels', 'alpha', 3
    elif contract == 'vitmatte':
        if hr_input_set != 'original':
            raise ValueError('HR input selection is only for the BiRefNet contract')
        model_dir = model_dir or 'onnx-vitmatte-02'
        if Path(model_dir).name != model_dir:
            raise ValueError('model-dir must be a directory name within artifacts')
        receipt = json.loads((root / model_dir / 'report.json').read_text())
        if (receipt['status'] != 'exported_synthetic_parity_measured_not_accepted'
                or receipt['model'] != 'hustvl/vitmatte-base-distinctions-646'):
            raise ValueError('Expected the completed ViTMatte export contract')
        report = receipt['files']
        inputs = root / 'vitmatte-inputs-01'
        precision, input_name, output_name, channels = 'float32', 'pixel_values', 'alphas', 4
    else:
        raise ValueError('Unknown model contract')
    if Path(model_dir).name != model_dir:
        raise ValueError('model-dir must be a directory name within artifacts')
    cases = json.loads((inputs / 'inputs.json').read_text())['cases']
    if not cases or len({x['id'] for x in cases}) != len(cases):
        raise ValueError('Expected unique, nonempty input cases')
    if precision == 'float16':
        expected_ids = set(HR_INPUT_SHA256) if hr_input_set == 'full-reference' else {'reference-01'}
        if {c['id'] for c in cases} != expected_ids:
            raise ValueError('Incomplete or unexpected HR reference cases')
    for case in cases:
        shape = case['shape']
        if (case['dtype'] != precision or len(shape) != 4 or shape[:2] != [1, channels]
                or any(type(x) is not int or x <= 0 for x in shape)
                or case['bytes'] != shape[0]*shape[1]*shape[2]*shape[3]*(2 if precision == 'float16' else 4)):
            raise ValueError('Input tensor contract mismatch')
        if precision == 'float16' and (shape != [1,3,2048,2048]
                or case['sha256'] != HR_INPUT_SHA256[case['id']]):
            raise ValueError('Expected the captured full HR reference input')
    config = {'runtimeVersion': '1.31.1', 'modelId': model_dir.removeprefix('onnx-'),
              'contract': contract, 'precision': precision, 'inputName': input_name,
              'outputName': output_name, 'cases': cases,
              'scope': 'Local diagnostic PoC, not production acceptance'}
    if contract=='birefnet-fp32-means-01':
        config['modelId']+='-fp32-means-01'
    if checkpoint is not None:
        if contract not in ('birefnet-output-tiles-01','birefnet-fp32-means-01') or hr_input_set!='original':
            raise ValueError('Checkpoint diagnostics require the single original HR input')
        if Path(checkpoint).name!=checkpoint or Path(checkpoint).suffix!='.onnx':
            raise ValueError('Checkpoint must be an ONNX basename in the model directory')
        receipt=json.loads((root/model_dir/Path(checkpoint).with_suffix('.report.json')).read_text())
        expected_source_sha=next(info['sha256'] for name,info in report.items() if name.endswith('.onnx'))
        if (receipt['status']!='diagnostic_graph_checked_not_executed' or receipt['observer_nodes']!=0
                or receipt['source_graph_sha256']!=expected_source_sha
                or receipt['input_names']!=['pixels'] or receipt['graph']['name']!=checkpoint
                or receipt['output_dtype'] not in ('float16','float32')):
            raise ValueError('Checkpoint provenance/type contract mismatch')
        report={checkpoint:receipt['graph'],'model.onnx.data':report['model.onnx.data']}
        config['outputName']=receipt['output_name']
        config['diagnosticCheckpoint']=receipt
        config['modelId']+='-checkpoint-'+Path(checkpoint).stem
        config['scope']='Intermediate original-dtype diagnostic; not full-model or alpha acceptance'
    return root / model_dir, report, inputs, config


def mount_contract(routes, model, model_files, inputs, config, input_prefix='/inputs/'):
    model_id = config['modelId']
    files = []
    for name, info in model_files.items():
        if Path(name).name != name or (model / name).stat().st_size != info['bytes']:
            raise ValueError('Invalid model receipt')
        url = '/models/' + model_id + '/' + name
        routes[url] = model / name
        files.append({'name': name, 'url': url, **info})
    for case in config['cases']:
        name = case['file']
        if Path(name).name != name or (inputs / name).stat().st_size != case['bytes']:
            raise ValueError('Invalid input receipt')
        case['url'] = input_prefix + name
        routes[case['url']] = inputs / name
    config['files'] = files
    return config



def local_app_csp(route):
    # Native MODNet and HR+Matte complete without JavaScript eval. Only the
    # model owner creates SHA-verified standalone stage Workers from Blob URLs.
    children = " blob:" if re.fullmatch(r'/validation-workers/[a-f0-9]{64}/model-prepare-worker\.js', route) else ''
    return ("default-src 'none'; script-src 'self' 'wasm-unsafe-eval'"
            + "; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; worker-src 'self'" + children
            + "; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")


RUNTIME_HASH_ROUTE = re.compile(r'/runtime/ort/[^/]+/([a-f0-9]{64})/[^/]+\.(?:wasm|mjs)')


def local_cache_control(request_path, cache_runtime=False):
    address = urlsplit(request_path)
    if cache_runtime and not address.query and not address.fragment and RUNTIME_HASH_ROUTE.fullmatch(address.path):
        return 'public, max-age=31536000, immutable'
    return 'no-store'


def private_lan_ip(host):
    try:
        address = ipaddress.IPv4Address(host)
        return any(address in ipaddress.IPv4Network(network) for network in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))
    except (ValueError, TypeError):
        return False


def local_app_routes(root, manifest_file, port, cache_runtime=False, lan_host=None):
    """Read a build-generated allowlist without starting a server or reading model bytes."""
    root = root.resolve()
    manifest_file = manifest_file.resolve()
    if not manifest_file.is_relative_to(root):
        raise ValueError('Local app manifest must stay in private artifacts')
    manifest = json.loads(manifest_file.read_text())
    origin = urlsplit(manifest['appOrigin'])
    origin_allowed = (manifest.get('privateLanHttps') is True and origin.scheme == 'https' and origin.hostname == lan_host and private_lan_ip(lan_host)) if lan_host else (origin.scheme == 'http' and origin.hostname in ('localhost', '127.0.0.1', '[::1]'))
    if (manifest.get('status') != 'local-app-built-not-started'
            or manifest.get('scope') != 'local-validation-only-not-approved-for-distribution'
            or manifest.get('distributionApproved') is not False
            or not origin_allowed
            or origin.port != port or origin.username or origin.password or origin.path
            or origin.query or origin.fragment):
        raise ValueError('Expected exact loopback local validation origin/port')
    if lan_host and (manifest.get('runtimeConfig', {}).get('executionProvider') != 'wasm' or manifest.get('backgroundModel') != 'modnet' or manifest.get('runtimeConfig', {}).get('modelVariants')):
        raise ValueError('Private LAN requires CPU-only MODNet')
    routes = {}
    for item in manifest['mounts']:
        route, source = item['route'], Path(item['source']).resolve()
        if (not route.startswith('/') or urlsplit(route).path != route or route in routes
                or not source.is_relative_to(root) or not source.is_file()
                or source.stat().st_size != item['bytes']):
            raise ValueError('Invalid local validation mount')
        runtime = RUNTIME_HASH_ROUTE.fullmatch(route) if cache_runtime else None
        if runtime:
            if item.get('sha256') != runtime.group(1):
                raise ValueError('Runtime URL hash must match the declared artifact')
            with source.open('rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != runtime.group(1):
                    raise ValueError('Runtime bytes differ from immutable URL')
        routes[route] = source
    if manifest.get('entry') != '/local-validation.html' or manifest['entry'] not in routes:
        raise ValueError('Missing local validation entry')
    return routes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--port', type=int, default=17861)
    parser.add_argument('--model-dir')
    parser.add_argument('--contract', choices=['vitmatte', 'birefnet-output-tiles-01','birefnet-fp32-means-01'], default='vitmatte')
    parser.add_argument('--hr-input-set', choices=['original', 'full-reference'], default='original')
    parser.add_argument('--lifecycle', action='store_true', help='Allowlist both fixed models for serial lifecycle measurement')
    parser.add_argument('--checkpoint', help='Explicit diagnostic ONNX basename with a source-pinned receipt')
    parser.add_argument('--local-app', type=Path, help='Build-generated private app manifest; GET-only loopback validation')
    parser.add_argument('--cross-origin-isolated', action='store_true', help='Explicit local-app COOP/COEP for bounded WASM CPU threading')
    parser.add_argument('--cache-runtime', action='store_true', help='Explicit local-app experiment: cache only hash-verified runtime URLs; default remains no-store')
    parser.add_argument('--lan-host', help='Explicit RFC1918 IPv4; requires private LAN manifest and TLS')
    parser.add_argument('--tls-cert', type=Path)
    parser.add_argument('--tls-key', type=Path)
    args = parser.parse_args()
    if args.lan_host and (not args.local_app or not private_lan_ip(args.lan_host) or not args.tls_cert or not args.tls_key):
        parser.error('Private LAN requires explicit RFC1918 host, local app, TLS cert and key')
    if (args.tls_cert or args.tls_key) and not args.lan_host:
        parser.error('TLS options require explicit private LAN mode')
    source = Path(__file__).resolve().parent
    root = args.artifacts.resolve()
    if args.local_app and (args.lifecycle or args.checkpoint or args.model_dir):
        parser.error('--local-app does not accept model PoC overrides')
    if args.cross_origin_isolated and not args.local_app:
        parser.error('Cross-origin isolation requires --local-app')
    if args.cache_runtime and not args.local_app:
        parser.error('--cache-runtime requires --local-app')
    routes = {}
    configs = {}
    if args.local_app:
        routes = local_app_routes(root, args.local_app, args.port, args.cache_runtime, args.lan_host)
    else:
        runtime = root / 'runtime-packages/ort-web-1.31.1/package/dist'
        model, model_files, inputs, config = model_contract(root, args.contract, args.model_dir, args.hr_input_set, args.checkpoint)
        for name in ['probe.html', 'probe-worker.js', 'model.html', 'model-page.js', 'model-worker.js',
                 'cache.html', 'cache-worker.mjs', 'stored-model.mjs', 'verified-stream.mjs', 'sha256.mjs',
                 'lifecycle.html', 'lifecycle-page.js', 'warm-session.html']:
            routes['/' + name] = source / name
        for path in runtime.iterdir():
            if path.suffix in ['.mjs', '.wasm']:
                routes['/runtime/' + path.name] = path
        mount_contract(routes, model, model_files, inputs, config)
        configs = {'/config.json': config}
    if args.lifecycle:
        if args.contract != 'birefnet-fp32-means-01' or args.checkpoint:
            parser.error('--lifecycle requires the full birefnet-fp32-means-01 contract')
        other_model, other_files, other_inputs, other_config = model_contract(root, 'vitmatte', 'onnx-vitmatte-03')
        mount_contract(routes, other_model, other_files, other_inputs, other_config, '/inputs/lifecycle-matte/')
        configs.update({'/configs/hr.json': config, '/configs/matte.json': other_config})
    config_payloads = {route: json.dumps(value).encode() for route, value in configs.items()}

    class Handler(BaseHTTPRequestHandler):
        def end_headers(self):
            if args.cross_origin_isolated:
                self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
                self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
            super().end_headers()

        def do_GET(self):
            route = urlsplit(self.path).path
            if route == '/':
                route = '/local-validation.html' if args.local_app else '/model.html'
            if route in config_payloads:
                config_bytes = config_payloads[route]
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(config_bytes)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(config_bytes)
                return
            path = routes.get(route)
            if path is None or not path.is_file():
                self.send_error(404)
                return
            content_type = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
                            '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json',
                            '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
                            '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'}.get(path.suffix, 'application/octet-stream')
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(path.stat().st_size))
            self.send_header('Cache-Control', local_cache_control(self.path, args.cache_runtime))
            self.send_header('X-Content-Type-Options', 'nosniff')
            if args.local_app:
                self.send_header('Content-Security-Policy', local_app_csp(route))
                self.send_header('Referrer-Policy', 'no-referrer')
            self.end_headers()
            try:
                with path.open('rb') as stream:
                    while chunk := stream.read(1024 * 1024):
                        self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass  # User cancelled a fetch/Worker; no server retry.

    host = args.lan_host or '127.0.0.1'
    httpd = ThreadingHTTPServer((host, args.port), Handler)
    if args.lan_host:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(args.tls_cert, args.tls_key)
        httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    print('Local model PoC at ' + ('https' if args.lan_host else 'http') + '://' + host + ':' + str(args.port), flush=True)
    httpd.serve_forever()


if __name__ == '__main__':
    main()
