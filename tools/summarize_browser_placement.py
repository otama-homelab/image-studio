"""Extract complete native ORT EP placement blocks from browser console JSONL."""
import argparse
from collections import Counter
import json
from pathlib import Path
import re


def summarize(lines):
    providers = {}
    current = None
    kernels = Counter()
    for line in lines:
        text = json.loads(line)['text']
        header = re.search(r'(Node\(s\)|All nodes) placed on \[([^]]+)\]\. Number of nodes: (\d+)', text)
        if header:
            current = header[2]
            if current in providers:
                raise ValueError('Multiple sessions in one log; split the observations before comparing')
            providers[current] = {'declared_nodes': int(header[3]), 'nodes': [],
                                  'all_nodes_summary': header[1] == 'All nodes'}
        elif 'VerifyEachNodeIsAssignedToAnEp]' in text:
            node = re.search(r'VerifyEachNodeIsAssignedToAnEp\]\s+(\S+) \((.+)\)$', text)
            if node and current:
                providers[current]['nodes'].append({'operator': node[1], 'name': node[2]})
        kernel = re.search(r'webgpu_context\.cc:\d+ Run\] Starting program "([^"\[]+)', text)
        if kernel:
            kernels[kernel[1]] += 1
    if not providers:
        raise ValueError('No placement block found; absence is not proof of no CPU nodes')
    if len(providers) > 1 and any(p['all_nodes_summary'] for p in providers.values()):
        raise ValueError('Conflicting all-nodes and multiple-provider placement summaries')
    for provider in providers.values():
        if provider['all_nodes_summary'] and not provider['nodes']:
            provider['node_names_available'] = False
            provider['operator_counts'] = None
            continue
        if len(provider['nodes']) != provider['declared_nodes']:
            raise ValueError('Truncated placement block')
        provider['node_names_available'] = True
        provider['operator_counts'] = dict(sorted(Counter(n['operator'] for n in provider['nodes']).items()))
    return {'scope': 'One optimized browser ORT session; GPU dispatch counts include completed and failed runs',
            'providers': providers, 'gpu_dispatch_operator_counts': dict(sorted(kernels.items()))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--console', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    result = summarize(args.console.read_text().splitlines())
    with args.output.open('x') as stream:
        stream.write(json.dumps(result, indent=2) + '\n')
    print(json.dumps({name: {'nodes': p['declared_nodes'], 'operators': p['operator_counts']}
                      for name, p in result['providers'].items()}, indent=2))


if __name__ == '__main__':
    main()
