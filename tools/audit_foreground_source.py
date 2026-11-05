"""Audit pinned PyMatting source without importing NumPy, Numba or the estimator."""
import argparse
import ast
import hashlib
import json
from pathlib import Path

EXPECTED = 'fd78cfb439940debc54c89a00638f025c0daef0bacc07fba393572787e9431ca'
parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
raw = args.source.read_bytes()
if hashlib.sha256(raw).hexdigest() != EXPECTED:
    raise SystemExit('foreground-source-sha-mismatch')
if args.output.exists():
    raise SystemExit('output-already-exists')
source = raw.decode()
tree = ast.parse(source)
functions = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)}
core = functions['_estimate_fb_ml']
public = functions['estimate_foreground_ml']
# Record source expressions, rather than guessing Numba's inferred scalar types.
assignments = []
for node in ast.walk(core):
    if isinstance(node, (ast.Assign, ast.AugAssign)):
        assignments.append({'line': node.lineno, 'statement': ast.get_source_segment(source, node)})
assignments.sort(key=lambda row: row['line'])
loops = []
def visit(node, nesting=()):
    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.For):
            row = {'line': child.lineno, 'target': ast.unparse(child.target), 'iterator': ast.unparse(child.iter), 'parents': list(nesting)}
            loops.append(row)
            visit(child, (*nesting, row['target']))
        else:
            visit(child, nesting)
visit(core)
report = {
    'status': 'source-audited', 'sourceSha256': EXPECTED,
    'coreDecorator': [ast.unparse(d) for d in core.decorator_list],
    'defaults': dict(zip([a.arg for a in public.args.args][-len(public.args.defaults):], [ast.literal_eval(d) for d in public.args.defaults])),
    'loops': loops, 'assignments': assignments,
    'floatLiterals': [{'line': n.lineno, 'value': n.value} for n in ast.walk(core) if isinstance(n, ast.Constant) and type(n.value) is float],
    'portRequirements': [
        'Preserve in-place y/x/channel traversal and left/right/up/down neighbor order; prange is not evidence that core is parallelized.',
        'Preserve FP32 array storage boundaries, including each b += update and mean-color accumulation; do not infer all scalar expressions are FP32.',
        'Obtain Numba inferred types/LLVM evidence before choosing C scalar precision or contraction/fast-math options.',
        'Preserve nearest integer coordinates and round-to-even level dimensions; verify pow/log2 level transitions against the actual compiled reference.',
        'Validate 1x1 reference behavior separately because n_levels is zero; no unapproved fallback.',
        'Do not replace the multilevel estimator with blur, division by alpha, or simultaneous Jacobi updates.',
    ],
    'logicalBufferAccounting': {
        'units': 'bytes, assuming float32 RGB and alpha; excludes allocator/runtime/temporary expression overhead',
        'inputCopiesAtFullResolution': '16 * originalPixels',
        'oneLevelArrays': '40 * levelPixels (image12 + alpha4 + F12 + B12)',
        'previousForegroundAndBackground': '24 * previousLevelPixels',
        'warning': 'Python local bindings can keep old level arrays alive during sequential reallocation. This is buffer accounting, not measured peak memory or an allocation cap.',
    },
    'limits': ['AST inspection only; no numeric reference execution, compiled type inference, C/WASM port, model, GPU, or browser', 'No NumPy/Numba imported'],
}
args.output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': report['status'], 'assignments': len(assignments), 'loops': len(loops), 'sourceSha256': EXPECTED}))
