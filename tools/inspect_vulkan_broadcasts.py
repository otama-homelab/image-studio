#!/usr/bin/env python3
"""Inspect serialized Vulkan binary-op shapes without running a GPU.

This catches inconsistent compile-time bounds, not runtime numerical correctness.
"""
import argparse
import dataclasses
import hashlib
import json
from pathlib import Path

from executorch.exir._serialize._program import _extract_delegate_payload
from executorch.backends.vulkan.serialization.vulkan_graph_serialize import (
    extract_vk_flatbuffer, flatbuffer_to_vk_graph,
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('model', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('output already exists')
    data = args.model.read_bytes()
    report = {'model_sha256': hashlib.sha256(data).hexdigest(),
              'scope': 'Serialized shape consistency only; no GPU execution or accuracy acceptance',
              'delegates': []}
    index = 0
    while (payload := _extract_delegate_payload(data, 'Vulkan', index)) is not None:
        graph = flatbuffer_to_vk_graph(extract_vk_flatbuffer(payload))
        row = {'index': index, 'binary_operators_checked': 0, 'inconsistent': []}
        for op in graph.chain:
            if op.name not in ('aten.add.Tensor', 'aten.sub.Tensor', 'aten.mul.Tensor', 'aten.div.Tensor'):
                continue
            left, right, output = (graph.values[i].value for i in (op.args[0], op.args[1], op.args[-1]))
            if not all(hasattr(v, 'dims') for v in (left, right, output)):
                continue
            row['binary_operators_checked'] += 1
            a, b = list(left.dims), list(right.dims)
            rank = max(len(a), len(b))
            a, b = [1] * (rank-len(a)) + a, [1] * (rank-len(b)) + b
            valid = all(x == y or x == 1 or y == 1 for x, y in zip(a,b))
            expected = [max(x,y) for x,y in zip(a,b)] if valid else None
            if not valid or expected != list(output.dims):
                row['inconsistent'].append({'operator': dataclasses.asdict(op),
                    'left': left.dims, 'right': right.dims, 'output': output.dims,
                    'broadcast_shape': expected})
        report['delegates'].append(row)
        index += 1
    report['passed'] = bool(report['delegates']) and all(not d['inconsistent'] for d in report['delegates'])
    args.output.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'passed': report['passed'], 'delegates': index,
                      'inconsistent': sum(len(d['inconsistent']) for d in report['delegates'])}))


if __name__ == '__main__':
    main()
