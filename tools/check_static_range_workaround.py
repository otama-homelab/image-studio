"""Check the metadata workaround keeps symbolic-range validation intact."""
import torch
from torch._subclasses.fake_tensor import FakeTensorMode
import executorch.exir.pass_manager as manager
from static_range_workaround import concrete_range_constraints

graph = torch.fx.Graph()
a, b = graph.placeholder("a"), graph.placeholder("b")
a.meta["val"] = FakeTensorMode().from_tensor(torch.ones(2, 3))
b.meta["val"] = FakeTensorMode().from_tensor(torch.ones(2, 3))
graph.output(a)
module = torch.fx.GraphModule({}, graph)
with concrete_range_constraints() as statistics:
    assert manager._get_updated_range_constraints(module) == {}
    assert statistics["static_graph_checks"] == 1

program = torch.export.export(
    torch.nn.Identity(), (torch.ones(3, 4),),
    dynamic_shapes=({0: torch.export.Dim("batch", min=2, max=8)},),
)
original = manager._get_updated_range_constraints
expected = original(program.graph_module)
assert expected
with concrete_range_constraints() as statistics:
    assert manager._get_updated_range_constraints(program.graph_module) == expected
    assert statistics["symbolic_graph_checks"] == 1
assert manager._get_updated_range_constraints is original
print("Concrete metadata and symbolic range preservation checks passed")
