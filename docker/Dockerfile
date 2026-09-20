# pi-ultra-scout clean-environment test image
# Mirrors a fresh Linux install: Node 22 + Bun + pi + Chromium (for the
# headless playwright browser used by the research_dispatch child).
#
#   docker build -t pi-scout-clean -f docker/Dockerfile .
#   docker run --rm -v "$PWD/docker/artifacts:/art" \
#     -e NVIDIA_API_KEY="nvapi-..." pi-scout-clean bash /workspace/docker/run_test.sh
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV BUN_INSTALL=/root/.bun
ENV PATH=$BUN_INSTALL/bin:$PATH

# Node 22 (pi enableCompileCache) + base tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git python3 python3-pip python3-venv wget gnupg \
    lsb-release software-properties-common unzip \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Bun + pi
RUN curl -fsSL https://bun.sh/install | bash
RUN $BUN_INSTALL/bin/bun add -g @earendil-works/pi-coding-agent

# Playwright MCP (the browser backend for the research_dispatch child) + Chromium
RUN $BUN_INSTALL/bin/bun add -g @playwright/mcp \
    && npx -y playwright install --with-deps chromium 2>&1 | tail -8

# The test harness (run_test.sh + the headless playwright-bridge)
COPY docker/ /workspace/docker/
WORKDIR /workspace
CMD ["bash"]
