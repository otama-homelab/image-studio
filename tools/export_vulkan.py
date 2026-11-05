"""Export the existing matting models; never replace production on failure.

This is a conversion probe, not evidence of GPU execution or image parity.
Run in an isolated CPU export environment. Weights and artifacts stay outside
the repository. BiRefNet keeps its production 2048px input; ViTMatte accepts an
explicit padded input size for operator-coverage investigation.
"""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import traceback
from contextlib import nullcontext, ExitStack


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", choices=["birefnet", "vitmatte"])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--height", type=int, default=2048)
    parser.add_argument("--width", type=int, default=2048)
    parser.add_argument("--strict", action="store_true",
                        help="use Dynamo strict capture instead of torch.export's default")
    parser.add_argument("--fuse-vitmatte-bn", action="store_true",
                        help="fold eval Conv/BatchNorm pairs and check synthetic-input parity")
    parser.add_argument("--decompose-deform-conv", action="store_true",
                        help="lower BiRefNet deformable convolution to sampling and convolution")
    parser.add_argument("--static-range-workaround", action="store_true",
                        help="avoid mixed FakeTensor mode checks only for fully concrete graphs")
    parser.add_argument("--save-capture", type=Path,
                        help="save the pre-decomposition torch.export program for diagnostics")
    parser.add_argument("--constant-propagation", action="store_true",
                        help="materialize constant weight slices before Vulkan lowering")
    parser.add_argument("--owned-vulkan-constants", action="store_true",
                        help="materialize constant views with nonzero storage offsets")
    parser.add_argument("--dynamic-vitmatte", action="store_true",
                        help="capture variable spatial sizes in multiples of 32, up to 2048")
    parser.add_argument("--capture-only", action="store_true",
                        help="stop after torch.export; does not create a deployable PTE")
    parser.add_argument("--exportable-vitmatte-helpers", action="store_true",
                        help="use equivalent positional/padding helpers for dynamic capture")
    parser.add_argument("--rank4-only", action="store_true",
                        help="keep transformations involving rank > 4 tensors on CPU")
    parser.add_argument("--save-transformed-capture", type=Path,
                        help="save the decomposed/constant-folded graph before lowering")
    parser.add_argument("--split-wide-convolutions", action="store_true",
                        help="split channel sums when packed weights exceed 16384 texels")
    parser.add_argument("--split-vitmatte-attention-heads", action="store_true",
                        help="compute attention heads separately to limit Vulkan allocation size")
    parser.add_argument("--fixed-double-bilinear-resize", action="store_true",
                        help="experimental GPU resize for fixed2 bilinear with align_corners=False")
    parser.add_argument("--exact-integer-shape-bounds", action="store_true",
                        help="experimental exact FloorDiv cancellation before shape allocation bounds")
    parser.add_argument("--flatten-relative-indices", action="store_true",
                        help="experimental equivalent 1-D gather for ViTMatte relative positions")
    parser.add_argument("--load-capture", type=Path,
                        help="reuse a pinned BiRefNet torch.export capture without downloading weights")
    parser.add_argument("--weights-from-capture", type=Path,
                        help="recover strict ViTMatte state from a pinned capture and recapture helpers")
    parser.add_argument("--capture-sha256", help="required SHA256 for capture reuse or recovered weights")
    parser.add_argument("--force-fp16", action="store_true",
                        help="experimental FP16 Vulkan storage/compute; requires new numerical validation")
    parser.add_argument("--texture-limits", type=int, nargs=3, metavar=("X", "Y", "Z"),
                        help="target GPU 3D texture limits; oversized tensors use buffers")
    args = parser.parse_args()
    if args.fixed_double_bilinear_resize and not (args.model == "vitmatte" and args.dynamic_vitmatte):
        parser.error("--fixed-double-bilinear-resize requires dynamic ViTMatte")
    if args.load_capture and args.weights_from_capture:
        parser.error("choose capture reuse or recovered weights, not both")
    capture_source = args.load_capture or args.weights_from_capture
    if capture_source:
        if not args.capture_sha256:
            parser.error("capture input requires --capture-sha256")
        if args.load_capture and args.model != "birefnet":
            parser.error("--load-capture currently requires BiRefNet")
        if args.weights_from_capture and args.model != "vitmatte":
            parser.error("--weights-from-capture currently requires ViTMatte")
        with capture_source.open("rb") as stream:
            actual_capture_sha = hashlib.file_digest(stream, "sha256").hexdigest()
        if actual_capture_sha != args.capture_sha256:
            parser.error("capture SHA256 mismatch")
    elif args.capture_sha256:
        parser.error("--capture-sha256 requires a capture input")
    if args.texture_limits is not None and min(args.texture_limits) <= 0:
        parser.error("texture limits must be positive")
    if min(args.height, args.width) <= 0 or args.height % 32 or args.width % 32:
        parser.error("input dimensions must be positive multiples of 32")
    if args.model == "birefnet" and (args.height, args.width) != (2048, 2048):
        parser.error("BiRefNet must retain the production 2048px input")
    if args.dynamic_vitmatte and args.model != "vitmatte":
        parser.error("dynamic capture is currently limited to ViTMatte")
    if args.split_vitmatte_attention_heads and (args.model != "vitmatte" or not args.exportable_vitmatte_helpers):
        parser.error("head splitting requires ViTMatte export helpers")
    if args.flatten_relative_indices and (args.model != "vitmatte" or not args.exportable_vitmatte_helpers):
        parser.error("flat relative indices require ViTMatte export helpers")
    args.output.mkdir(parents=True, exist_ok=True)
    artifact = args.output / f"{args.model}-{args.height}x{args.width}.pte"
    report_path = artifact.with_suffix(".json")
    if artifact.exists() or report_path.exists():
        parser.error("choose a fresh output directory; existing evidence is preserved")
    report = {
        "model": args.model, "shape": [1, 3, args.height, args.width],
        "status": "started", "gpu_execution_verified": False,
        "image_parity_verified": False,
        "strict_capture": args.strict,
        "dynamic_spatial_sizes": args.dynamic_vitmatte,
        "texture_limits": args.texture_limits,
        "force_fp16": args.force_fp16,
        "flatten_relative_indices": args.flatten_relative_indices,
    }
    try:
        import torch
        from transformers import AutoModelForImageSegmentation, VitMatteForImageMatting, VitMatteConfig
        from executorch.backends.vulkan.partitioner.vulkan_partitioner import VulkanPartitioner
        from executorch.exir import to_edge_transform_and_lower

        torch.set_num_threads(4)
        report["versions"] = {name: importlib.metadata.version(name) for name in
                              ("torch", "executorch", "transformers", "timm")}
        if args.load_capture:
            import torchvision  # register operators referenced by the capture
            report.update(stage="load_capture", capture_path=str(args.load_capture),
                          capture_sha256=actual_capture_sha,
                          repository="ZhengPeng7/BiRefNet_HR-matting",
                          revision="5d6b6f8adcb5b417c871b1d84ceaae9871355b7f")
            exported = torch.export.load(args.load_capture)
            names = {x.arg.name for x in exported.graph_signature.input_specs
                     if x.kind.name == "USER_INPUT"}
            users = [n for n in exported.graph.nodes
                     if n.op == "placeholder" and n.name in names]
            if len(users) != 1 or tuple(users[0].meta["val"].shape) != (1, 3, args.height, args.width):
                raise ValueError("Capture input does not match the declared BiRefNet shape")
            report["shape"] = [1, 3, args.height, args.width]
            print("Pinned BiRefNet capture loaded", flush=True)
        else:
            if args.model == "birefnet":
                repository = "ZhengPeng7/BiRefNet_HR-matting"
                revision = "5d6b6f8adcb5b417c871b1d84ceaae9871355b7f"
                net = AutoModelForImageSegmentation.from_pretrained(
                    repository, revision=revision, code_revision=revision,
                    trust_remote_code=True, use_safetensors=True,
                ).float().eval()

                class Wrapper(torch.nn.Module):
                    def __init__(self, inner):
                        super().__init__()
                        self.inner = inner

                    def forward(self, pixels):
                        return self.inner(pixels)[-1].float().sigmoid()

                inputs = (torch.zeros(1, 3, args.height, args.width),)
            else:
                repository = "hustvl/vitmatte-base-distinctions-646"
                revision = "b58373f8dbbfbeb58157456e2e4949f9f872aa18"
                source_capture = None
                if args.weights_from_capture:
                    source_capture = torch.export.load(args.weights_from_capture)
                    state = source_capture.state_dict
                    if not state or not all(k.startswith("inner.") for k in state):
                        raise ValueError("Expected Wrapper.inner state in the pinned ViTMatte capture")
                    config = VitMatteConfig.from_pretrained(repository, revision=revision, local_files_only=True)
                    net = VitMatteForImageMatting(config).float().eval()
                    net.load_state_dict({k[len("inner."):]: v for k, v in state.items()}, strict=True, assign=True)
                    report.update(weights_capture_path=str(args.weights_from_capture),
                                  weights_capture_sha256=actual_capture_sha,
                                  recovered_state_count=len(state))
                else:
                    net = VitMatteForImageMatting.from_pretrained(
                        repository, revision=revision, use_safetensors=True,
                    ).float().eval()

                class Wrapper(torch.nn.Module):
                    def __init__(self, inner):
                        super().__init__()
                        self.inner = inner

                    def forward(self, pixels):
                        return self.inner(pixel_values=pixels, return_dict=False)[0]

                # ViTMatte's processor appends the trimap as a fourth channel.
                inputs = (torch.zeros(1, 4, args.height, args.width),)
            report.update(repository=repository, revision=revision,
                          shape=list(inputs[0].shape), stage="torch.export")
            net.requires_grad_(False)
            with torch.no_grad():
                if args.fuse_vitmatte_bn:
                    if args.model != "vitmatte":
                        raise ValueError("BatchNorm workaround is restricted to ViTMatte")
                    report["stage"] = "eval_batchnorm_fusion"
                    reference = Wrapper(net)(inputs[0])
                    count = 0
                    for module in list(net.modules()):
                        if type(module).__name__ == "VitMatteBasicConv3x3":
                            module.conv = torch.nn.utils.fusion.fuse_conv_bn_eval(
                                module.conv, module.batch_norm)
                            module.batch_norm = torch.nn.Identity()
                            count += 1
                        elif isinstance(module, torch.nn.Sequential):
                            children = list(module.named_children())
                            for (conv_name, conv), (bn_name, bn) in zip(children, children[1:]):
                                if isinstance(conv, torch.nn.Conv2d) and isinstance(bn, torch.nn.BatchNorm2d):
                                    module._modules[conv_name] = torch.nn.utils.fusion.fuse_conv_bn_eval(conv, bn)
                                    module._modules[bn_name] = torch.nn.Identity()
                                    count += 1
                    actual = Wrapper(net)(inputs[0])
                    report["eval_batchnorm_fusion"] = {
                        "pairs": count,
                        "synthetic_max_abs_error": (actual - reference).abs().max().item(),
                        "synthetic_parity": torch.allclose(actual, reference, atol=1e-4, rtol=1e-4),
                    }
                    if not report["eval_batchnorm_fusion"]["synthetic_parity"]:
                        raise RuntimeError("Eval BatchNorm folding changed synthetic output")
                    del reference, actual
                report["stage"] = "torch.export"
                print("Capturing model with torch.export", flush=True)
                dynamic_shapes = None
                if args.dynamic_vitmatte:
                    dynamic_shapes = ({
                        2: 32 * torch.export.Dim("height_units", min=1, max=64),
                        3: 32 * torch.export.Dim("width_units", min=1, max=64),
                    },)
                capture_context = nullcontext()
                if args.exportable_vitmatte_helpers:
                    if args.model != "vitmatte":
                        raise ValueError("ViTMatte helpers require the ViTMatte model")
                    from vitmatte_export_helpers import exportable_vitmatte
                    capture_context = exportable_vitmatte(args.split_vitmatte_attention_heads, net, args.flatten_relative_indices)
                with capture_context:
                    if args.weights_from_capture:
                        report["stage"] = "recovered_weight_cpu_parity"
                        generator = torch.Generator().manual_seed(1907)
                        check_input = torch.randn(1, 4, 32, 32, generator=generator)
                        reference = source_capture.module()(check_input)
                        actual = Wrapper(net)(check_input)
                        passed = torch.allclose(actual, reference, atol=5e-5, rtol=5e-5)
                        report["recovered_weight_cpu_parity"] = {
                            "input_shape": list(check_input.shape),
                            "max_abs_error": (actual-reference).abs().max().item(),
                            "passed": passed,
                        }
                        if not passed:
                            raise RuntimeError("Recovered ViTMatte weights failed capture CPU parity")
                        del source_capture, reference, actual, check_input, state
                        print("Recovered ViTMatte weights match pinned capture on CPU", flush=True)
                    report["stage"] = "torch.export"
                    exported = torch.export.export(Wrapper(net).eval(), inputs,
                                                  strict=args.strict, dynamic_shapes=dynamic_shapes)
                report["exportable_vitmatte_helpers"] = args.exportable_vitmatte_helpers
                report["split_attention_heads"] = args.split_vitmatte_attention_heads
                print("torch.export capture complete", flush=True)
        with torch.no_grad():
            if args.save_capture:
                if args.save_capture.exists():
                    raise FileExistsError(args.save_capture)
                torch.export.save(exported, args.save_capture)
            if args.capture_only:
                capture = args.save_capture or artifact.with_suffix(".pt2")
                if not args.save_capture:
                    torch.export.save(exported, capture)
                report.update(status="captured_unvalidated", capture_path=str(capture))
                return
            if args.decompose_deform_conv:
                from vulkan_decompositions import deform_conv2d
                report["stage"] = "deform_decomposition"
                print("Decomposing deformable convolutions", flush=True)
                exported = exported.run_decompositions({
                    torch.ops.torchvision.deform_conv2d.default: deform_conv2d,
                })
                report["deform_conv_decomposed"] = True
            if args.split_wide_convolutions:
                from vulkan_convolution_workaround import wide_convolution_decomposition
                split, statistics = wide_convolution_decomposition()
                exported = exported.run_decompositions({torch.ops.aten.conv2d.default: split})
                report["wide_convolutions"] = statistics
            report["operators"] = sorted({str(n.target) for n in exported.graph.nodes
                                           if n.op == "call_function"})
            if args.constant_propagation:
                from executorch.exir.passes.constant_prop_pass import constant_prop_pass
                exported = constant_prop_pass(exported)
                report["constant_propagation"] = True
            if args.save_transformed_capture:
                if args.save_transformed_capture.exists():
                    raise FileExistsError(args.save_transformed_capture)
                torch.export.save(exported, args.save_transformed_capture)
            report["stage"] = "vulkan_lowering"
            print("Lowering Vulkan partitions", flush=True)
            if args.static_range_workaround:
                from static_range_workaround import concrete_range_constraints
                context = concrete_range_constraints()
            else:
                context = nullcontext(None)
            with ExitStack() as stack:
                workaround = stack.enter_context(context)
                if args.fixed_double_bilinear_resize:
                    from vulkan_fixed_upsample import fixed_double_bilinear_resize
                    report["fixed_double_bilinear_resize"] = stack.enter_context(fixed_double_bilinear_resize())
                if args.exact_integer_shape_bounds:
                    from vulkan_shape_bound_workaround import exact_integer_shape_bounds
                    report["exact_integer_shape_bounds"] = stack.enter_context(exact_integer_shape_bounds())
                if args.owned_vulkan_constants:
                    from vulkan_constant_workaround import owned_constant_storage
                    report["owned_vulkan_constants"] = stack.enter_context(owned_constant_storage())
                if args.rank4_only:
                    from vulkan_rank_workaround import rank4_only
                    report["rank4_only"] = stack.enter_context(rank4_only())
                if args.dynamic_vitmatte:
                    from vulkan_dynamic_padding_workaround import cpu_dynamic_padding
                    report["dynamic_padding_cpu"] = stack.enter_context(cpu_dynamic_padding())
                transforms = []
                if args.split_vitmatte_attention_heads:
                    from executorch.exir.passes.cse_pass import CSEPass
                    from vulkan_identity_expand import IdentityExpandAsClone
                    cleanup = IdentityExpandAsClone()
                    transforms = [CSEPass(), cleanup, CSEPass()]
                    report["identity_expands"] = cleanup.statistics
                compile_options = {}
                if args.force_fp16:
                    compile_options["force_fp16"] = True
                if args.dynamic_vitmatte:
                    compile_options["require_dynamic_shapes"] = True
                if args.texture_limits is not None:
                    compile_options["texture_limits"] = tuple(args.texture_limits)
                lowered = to_edge_transform_and_lower(
                    exported, transform_passes=transforms,
                    partitioner=[VulkanPartitioner(compile_options or None)],
                )
                report["static_range_workaround"] = workaround
            graph = lowered.exported_program().graph
            delegates = [n for n in graph.nodes if n.op == "call_function"
                         and "executorch_call_delegate" in str(n.target)]
            report["delegate_partitions"] = len(delegates)
            report["remaining_operators"] = sorted({str(n.target) for n in graph.nodes
                                                     if n.op == "call_function"
                                                     and n not in delegates})
            if not delegates:
                raise RuntimeError("No Vulkan partitions; refusing a CPU-only artifact")
            report["stage"] = "serialization"
            program = lowered.to_executorch()
            report["cpu_buffer_sizes"] = [method.non_const_buffer_sizes
                                           for method in program.executorch_program.execution_plan]
            with artifact.open("wb") as stream:
                program.write_to_file(stream)
        report.update(status="exported_unvalidated",
                      artifact_sha256=hashlib.sha256(artifact.read_bytes()).hexdigest())
    except Exception as exc:
        report.update(status="failed", error_type=type(exc).__name__, error=str(exc),
                      traceback=traceback.format_exc())
        raise
    finally:
        report_path.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
