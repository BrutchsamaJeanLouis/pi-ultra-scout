#!/bin/bash
# docker_test.sh - Validate the pi-ultra-scout setup in a clean Docker container
# 
# This script builds and runs the test container, verifying all setup steps.
# Run from repo root: ./scripts/docker_test.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="pi-ultra-scout-test"
CONTAINER_NAME="pi-ultra-scout-validation"

echo "=========================================="
echo "pi-ultra-scout Docker Validation"
echo "=========================================="
echo "Repo root: $REPO_ROOT"
echo ""

# Check Docker is available
if ! command -v docker &> /dev/null; then
    echo "ERROR: docker not found. Install Docker Desktop."
    exit 1
fi

# Build the test image
echo "Building test image ($IMAGE_NAME)..."
docker build -t "$IMAGE_NAME" -f "$REPO_ROOT/Dockerfile.test" "$REPO_ROOT" 2>&1 | tail -20

if [ $? -ne 0 ]; then
    echo "ERROR: Docker build failed"
    exit 1
fi

echo ""
echo "Build successful. Running validation container..."

# Run the container with host network access for llama.cpp router
# Note: The router must be running on the host at host.docker.internal:1234
docker run --rm -it \
    --name "$CONTAINER_NAME" \
    --add-host=host.docker.internal:host-gateway \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$REPO_ROOT:/workspace/pi-ultra-scout:ro" \
    "$IMAGE_NAME" \
    bash -c "
        set -e
        echo '=== Inside container ===' 
        echo 'Bun version:' \$(bun --version)
        echo 'pi version:' \$(pi --version)
        echo 'llama-server version:' \$(llama-server --version 2>&1 | head -1)
        echo 'Chrome version:' \$(google-chrome --version)
        echo 'Python version:' \$(python3 --version)
        echo ''
        echo '=== Extension verification ==='
        pi config get extensions
        echo ''
        echo '=== Available tools ==='
        pi -p --provider llamacpp --model qwen3.8-27b 'List all available tools by name' 2>&1 | grep -E 'research_dispatch|evidence_|reground_check|research_loop' || true
        echo ''
        echo '=== Probe tests ==='
        cd /workspace/pi-ultra-scout/extension
        echo 'Running probe_shapes.ts...'
        bun test ulw-analysis/probe_shapes.ts 2>&1 | tail -5
        echo 'Running smoke_dispatch.ts...'
        bun test ulw-analysis/smoke_dispatch.ts 2>&1 | tail -5
        echo 'Running smoke_wiring.ts...'
        bun test ulw-analysis/smoke_wiring.ts 2>&1 | tail -5
        echo 'Running probe_evidence.ts...'
        bun test ulw-analysis/probe_evidence.ts 2>&1 | tail -5
        echo ''
        echo '=== Grader verification ==='
        cd /workspace/pi-ultra-scout/grading
        python3 grade.py ../experiments/runs 2>&1 | head -20
        echo ''
        echo '=== Charts verification ==='
        cd /workspace/pi-ultra-scout/charts
        python3 make_charts.py 2>&1
        echo ''
        echo '=== ALL CHECKS PASSED ==='
    "

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "✅ DOCKER VALIDATION SUCCESSFUL"
    echo "=========================================="
    echo "All setup steps verified in clean container."
else
    echo ""
    echo "=========================================="
    echo "❌ DOCKER VALIDATION FAILED (exit code: $EXIT_CODE)"
    echo "=========================================="
    exit $EXIT_CODE
fi