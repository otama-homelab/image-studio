"""Compare captured browser float32 outputs with private ROCm reference alpha."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

from compare_browser_alpha import measure


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser-results', type=Path, required=True)
    parser.add_argument('--inputs', type=Path, required=True)
    parser.add_argument('--reference-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Choose a new output directory')
    browser = json.loads((args.browser_results / 'report.json').read_text())
    manifest = json.loads((args.inputs / 'inputs.json').read_text())
    cases = {case['id']: case for case in manifest['cases']}
    args.output.mkdir(parents=True, mode=0o700)
    report = {'status': 'measured_partial_not_accepted', 'browser_run_status': browser['status'],
              'browser_version': browser.get('browserVersion'), 'strict': browser['strict'], 'runs': []}
    previous = {}
    for run in browser['runs']:
        if run['state'] != 'complete':
            continue
        meta = run['report']
        case = cases[meta['caseId']]
        filename = run['outputFile']
        if Path(filename).name != filename:
            raise ValueError('Invalid output path')
        binary = (args.browser_results / filename).read_bytes()
        if hashlib.sha256(binary).hexdigest() != meta['outputSha256']:
            raise ValueError('Browser output SHA256 mismatch')
        actual = np.frombuffer(binary, dtype='<f4').reshape(meta['shape'])
        expected_shape = (1, 1, *case['shape'][2:])
        if actual.shape != expected_shape or not np.isfinite(actual).all():
            raise ValueError('Browser output shape/finite mismatch')
        width, height = case['original_size']
        alpha = np.rint(actual[0, 0, :height, :width] * 255).clip(0, 255).astype(np.uint8)
        reference = args.reference_root / meta['caseId'] / 'refine-on'
        with Image.open(reference / 'trimap.png') as image:
            trimap = np.asarray(image)
        with Image.open(reference / 'alpha.png') as image:
            expected = np.asarray(image)
        alpha[trimap == 0] = 0
        alpha[trimap == 255] = 255
        metrics = measure(expected, alpha, trimap)
        item = {'case_id': meta['caseId'], 'run_number': meta['runNumber'], 'shape': meta['shape'],
                'run_ms_including_readback': meta['runMsIncludingReadback'], 'metrics': metrics,
                'raw_min': float(actual.min()), 'raw_max': float(actual.max())}
        if meta['caseId'] in previous:
            item['repeat_raw_max_difference'] = float(np.abs(actual - previous[meta['caseId']]).max())
        else:
            previous[meta['caseId']] = actual.copy()
        Image.fromarray(alpha).save(args.output / (meta['caseId'] + '-run' + str(meta['runNumber']) + '.png'))
        report['runs'].append(item)
    if set(case['case_id'] for case in report['runs']) == set(cases):
        report['status'] = 'full_reference_metrics_measured_not_accepted'
    (args.output / 'report.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    print(json.dumps(report, indent=2, allow_nan=False))


if __name__ == '__main__':
    main()
