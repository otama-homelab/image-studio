"""Placement evidence must not silently accept a truncated or absent log."""
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('placement', Path(__file__).resolve().parents[1] / 'tools/summarize_browser_placement.py')
placement = importlib.util.module_from_spec(spec)
spec.loader.exec_module(placement)


class PlacementTest(unittest.TestCase):
    def test_checks_count_and_preserves_cpu_node(self):
        messages = ['Node(s) placed on [CPUExecutionProvider]. Number of nodes: 1',
                    'session_state.cc:1586 VerifyEachNodeIsAssignedToAnEp]   Shape (size_1)']
        lines = [json.dumps({'text': text}) for text in messages]
        result = placement.summarize(lines)
        self.assertEqual(result['providers']['CPUExecutionProvider']['operator_counts'], {'Shape': 1})
        with self.assertRaises(ValueError):
            placement.summarize(lines[:1])

    def test_absent_block_is_unknown(self):
        with self.assertRaises(ValueError):
            placement.summarize([json.dumps({'text': 'No output yet'})])

    def test_all_nodes_summary_without_names(self):
        lines = [json.dumps({'text': 'VerifyEachNodeIsAssignedToAnEp] All nodes placed on [WebGpuExecutionProvider]. Number of nodes: 7451'})]
        result = placement.summarize(lines)['providers']['WebGpuExecutionProvider']
        self.assertEqual(result['declared_nodes'],7451)
        self.assertFalse(result['node_names_available'])
        self.assertIsNone(result['operator_counts'])
        with self.assertRaises(ValueError):
            placement.summarize(lines+[json.dumps({'text':'VerifyEachNodeIsAssignedToAnEp] Conv (one_node)'})])
        with self.assertRaises(ValueError):
            placement.summarize(lines+[json.dumps({'text':'Node(s) placed on [CPUExecutionProvider]. Number of nodes: 0'})])


if __name__ == '__main__':
    unittest.main()
