#!/bin/bash
# install_deps.sh - One-shot dependency installer for pi-ultra-scout
# Run from repo root: ./scripts/install_deps.sh
# 
# This script installs all prerequisites on a fresh Windows machine (via Git Bash/WSL)
# For native Windows, run the PowerShell equivalents manually.

set -euo pipefail

echo "=========================================="
echo "pi-ultra-scout Dependency Installer"
echo "=========================================="
echo ""

# Detect OS
if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ -n "${WINDIR:-}" ]]; then
    IS_WINDOWS=1
    echo "Detected: Windows (Git Bash/MSYS)"
else
    IS_WINDOWS=0
    echo "Detected: Linux/macOS"
fi

# Helper: check if command exists
has_cmd() { command -v "$1" &> /dev/null; }

# Install Bun
if has_cmd bun; then
    echo "✅ Bun already installed: $(bun --version)"
else
    echo "📦 Installing Bun..."
    if [[ $IS_WINDOWS -eq 1 ]]; then
        # Windows: use PowerShell
        powershell.exe -Command "irm bun.sh/install.ps1 | iex"
    else
        curl -fsSL https://bun.sh/install | bash
    fi
    export PATH="$HOME/.bun/bin:$PATH"
    echo "✅ Bun installed: $(bun --version)"
fi

# Install pi
if has_cmd pi; then
    echo "✅ pi already installed: $(pi --version)"
else
    echo "📦 Installing pi coding agent..."
    bun add -g @earendil-works/pi-coding-agent
    echo "✅ pi installed: $(pi --version)"
fi

# Install llama.cpp (Windows: prefer scoop or manual)
if has_cmd llama-server; then
    echo "✅ llama.cpp already installed: $(llama-server --version 2>&1 | head -1)"
else
    echo "📦 Installing llama.cpp..."
    if [[ $IS_WINDOWS -eq 1 ]]; then
        if has_cmd scoop; then
            scoop install llama.cpp
        else
            echo "⚠️  Please install llama.cpp manually:"
            echo "   1. Download from https://github.com/ggerganov/llama.cpp/releases"
            echo "   2. Extract to C:\\llama.cpp\\"
            echo "   3. Add to PATH"
        fi
    else
        # Linux: build from source
        sudo apt-get update && sudo apt-get install -y build-essential cmake
        git clone https://github.com/ggerganov/llama.cpp /tmp/llama.cpp
        cd /tmp/llama.cpp && cmake -B build -DLLAMA_CURL=ON && cmake --build build --config Release -j$(nproc)
        sudo cp build/bin/llama-server /usr/local/bin/
        rm -rf /tmp/llama.cpp
    fi
    echo "✅ llama.cpp installed"
fi

# Install Python packages
echo "📦 Installing Python packages (matplotlib, pymupdf)..."
if [[ $IS_WINDOWS -eq 1 ]]; then
    python -m pip install --user matplotlib pymupdf
else
    pip3 install --user matplotlib pymupdf
fi
echo "✅ Python packages installed"

# Install pi-ultra-scout extension
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "📦 Installing pi-ultra-scout extension from $REPO_ROOT..."
pi extension add "$REPO_ROOT/extension"
echo "✅ Extension installed"

# Verify
echo ""
echo "=========================================="
echo "Verification"
echo "=========================================="
echo "Bun: $(bun --version)"
echo "pi: $(pi --version)"
echo "llama-server: $(llama-server --version 2>&1 | head -1)"
echo "Python: $(python --version 2>&1 || python3 --version)"
echo ""
echo "pi extensions:"
pi config get extensions
echo ""
echo "Available ultrawork tools:"
pi -p --provider llamacpp --model qwen3.8-27b "List tools by name" 2>&1 | grep -E 'research_dispatch|evidence_|reground_check|research_loop' || true
echo ""
echo "=========================================="
echo "✅ All dependencies installed!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Start llama.cpp router (see SETUP.md Step 4)"
echo "2. Install Playwright Chrome extension (SETUP.md Step 5)"
echo "3. Add token to ~/.pi/settings.json (SETUP.md Step 6)"
echo "4. Run test task (SETUP.md Step 8)"