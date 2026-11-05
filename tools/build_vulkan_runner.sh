#!/usr/bin/env bash
# Build a standalone Linux runner without replacing system GPU drivers.
set -euo pipefail
tool_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
build_root=${1:?Usage: build_vulkan_runner.sh NEW_BUILD_ROOT EXPORT_PYTHON [release|profile]}
export_python=${2:?Pass the Python executable in the export environment}
build_mode=${3:-release}
case "$build_mode" in
    release) cmake_profile_args=(-DEXECUTORCH_ENABLE_EVENT_TRACER=OFF -DEXECUTORCH_BUILD_DEVTOOLS=OFF) ;;
    profile) cmake_profile_args=(-DEXECUTORCH_ENABLE_EVENT_TRACER=ON -DEXECUTORCH_BUILD_DEVTOOLS=ON) ;;
    *) echo "Choose release or profile" >&2; exit 1 ;;
esac
if [[ -e "$build_root" ]]; then
    echo "Build root already exists; choose a fresh path" >&2
    exit 1
fi
mkdir -p "$build_root"
build_root=$(realpath "$build_root")
# Preserve a venv's executable path: resolving its symlink loses the venv.
if [[ "$export_python" != /* ]]; then
    export_python="$PWD/$export_python"
fi
[[ -x "$export_python" ]]
sdk_version=1.4.363.0
sdk_sha=197962f5cbf80baf2775a03336a01cee7c8745686c65aaa70d3f751ade4d7e43
curl --fail --location --retry 2 \
    "https://sdk.lunarg.com/sdk/download/$sdk_version/linux/vulkan_sdk.tar.xz" \
    -o "$build_root/sdk.tar.xz"
printf '%s  %s\n' "$sdk_sha" "$build_root/sdk.tar.xz" | sha256sum --check
mkdir "$build_root/sdk"
tar -xJf "$build_root/sdk.tar.xz" -C "$build_root/sdk" --wildcards \
    '*/x86_64/bin/glslc' '*/x86_64/lib/libshaderc*'
sdk_root="$build_root/sdk/$sdk_version/x86_64"
export PATH="$sdk_root/bin:$(dirname "$export_python"):$PATH"
export LD_LIBRARY_PATH="$sdk_root/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
git clone --depth 1 --branch v1.5.1 https://github.com/pytorch/executorch.git "$build_root/executorch"
[[ $(git -C "$build_root/executorch" rev-parse HEAD) == 3b60683923245cf472b7323426920e15623ba361 ]]
git -C "$build_root/executorch" apply --check "$tool_dir/patches/executorch-1.5.1-gelu.patch"
git -C "$build_root/executorch" apply "$tool_dir/patches/executorch-1.5.1-gelu.patch"
git -C "$build_root/executorch" apply --check "$tool_dir/patches/executorch-1.5.1-diagnostics.patch"
git -C "$build_root/executorch" apply "$tool_dir/patches/executorch-1.5.1-diagnostics.patch"
git -C "$build_root/executorch" apply --check "$tool_dir/patches/executorch-1.5.1-input-shape.patch"
git -C "$build_root/executorch" apply "$tool_dir/patches/executorch-1.5.1-input-shape.patch"
git -C "$build_root/executorch" apply --check "$tool_dir/patches/executorch-1.5.1-high-rank-views.patch"
git -C "$build_root/executorch" apply "$tool_dir/patches/executorch-1.5.1-high-rank-views.patch"
git -C "$build_root/executorch" apply --check "$tool_dir/patches/executorch-1.5.1-buffer-prepack.patch"
git -C "$build_root/executorch" apply "$tool_dir/patches/executorch-1.5.1-buffer-prepack.patch"
git -C "$build_root/executorch" apply --check "$tool_dir/patches/executorch-1.5.1-layernorm-dispatch.patch"
git -C "$build_root/executorch" apply "$tool_dir/patches/executorch-1.5.1-layernorm-dispatch.patch"
git -C "$build_root/executorch" apply --check "$tool_dir/patches/executorch-1.5.1-algorithm-include.patch"
git -C "$build_root/executorch" apply "$tool_dir/patches/executorch-1.5.1-algorithm-include.patch"
git -C "$build_root/executorch" apply --check "$tool_dir/patches/executorch-1.5.1-convolution-limits.patch"
git -C "$build_root/executorch" apply "$tool_dir/patches/executorch-1.5.1-convolution-limits.patch"
git -C "$build_root/executorch" apply --check "$tool_dir/patches/executorch-1.5.1-image-limits.patch"
git -C "$build_root/executorch" apply "$tool_dir/patches/executorch-1.5.1-image-limits.patch"
git -C "$build_root/executorch" apply --check "$tool_dir/patches/executorch-1.5.1-leading-squeeze.patch"
git -C "$build_root/executorch" apply "$tool_dir/patches/executorch-1.5.1-leading-squeeze.patch"
if [[ "$build_mode" == profile ]]; then
    git -C "$build_root/executorch" apply --check "$tool_dir/patches/executorch-1.5.1-profile-querypool.patch"
    git -C "$build_root/executorch" apply "$tool_dir/patches/executorch-1.5.1-profile-querypool.patch"
fi
# Fetch the dependencies used by this Vulkan/portable runner. Optional backends
# (including optimized CPU kernels/Eigen) are disabled below; fetching all
# submodules needlessly makes their upstream services a build dependency.
runner_submodules=(
    backends/vulkan/third-party/Vulkan-Headers
    backends/vulkan/third-party/VulkanMemoryAllocator
    backends/vulkan/third-party/volk
    backends/xnnpack/third-party/FP16
    backends/xnnpack/third-party/FXdiv
    backends/xnnpack/third-party/cpuinfo
    backends/xnnpack/third-party/pthreadpool
    third-party/flatbuffers
    third-party/flatcc
    third-party/gflags
    third-party/json
    third-party/pocketfft
)
git -C "$build_root/executorch" submodule update --init --recursive -- "${runner_submodules[@]}"
cmake -S "$build_root/executorch" -B "$build_root/build" \
    -DCMAKE_BUILD_TYPE=Release -DEXECUTORCH_BUILD_VULKAN=ON \
    -DEXECUTORCH_BUILD_KERNELS_OPTIMIZED=OFF -DEXECUTORCH_BUILD_XNNPACK=OFF \
    -DBUILD_TESTING=OFF \
    -DEXECUTORCH_BUILD_EXECUTOR_RUNNER=ON -DEXECUTORCH_ENABLE_LOGGING=ON \
    -DPYTHON_EXECUTABLE="$export_python" -DGLSLC_PATH="$sdk_root/bin/glslc" \
    "${cmake_profile_args[@]}"
cmake --build "$build_root/build" --target executor_runner --parallel 2
sha256sum "$build_root/build/executor_runner"
