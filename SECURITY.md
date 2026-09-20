# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

**Do not open public issues for security vulnerabilities.**

Please report security vulnerabilities privately to: **security@brutc.dev**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes

We aim to respond within 48 hours and provide a fix timeline.

## Security Considerations

### Extension Trust Model

pi-ultra-scout is a **pi extension** — it runs with your full system permissions and can execute arbitrary code. This is by design (extensions are trusted code).

**Before installing:**
- Review the source code
- Verify the npm package signature
- Only install from trusted sources (`npm:pi-ultra-scout` or `git:github.com/brutc/pi-ultra-scout`)

### Playwright MCP Bridge

The `research_dispatch` tool uses the Playwright MCP Bridge Chrome extension to browse live documentation. This requires:
- A valid Chrome extension token stored in `~/.pi/settings.json`
- Desktop Chrome running with the extension installed

**The token provides access to your browser session.** Treat it like a password.

### llama.cpp Router

The local model router (`llama-server.exe`) binds to `0.0.0.0:1234` by default for Docker compatibility. This exposes the API on your local network.

**For production use:**
- Bind to `127.0.0.1` only: `--host 127.0.0.1`
- Use firewall rules to restrict access
- Consider authentication for the router API

### Evidence Artifacts

Evidence artifacts (`.pi/evidence/<claim_id>.json`) contain:
- Claim statements
- Source URLs
- Confidence scores
- Summaries

These are written to your local filesystem and are not transmitted externally by the extension.

### Network Access

The extension makes outbound connections to:
- `npmjs.com` — for package documentation
- `github.com` / `raw.githubusercontent.com` — for source code
- Your local llama.cpp router (`127.0.0.1:1234`)

No other external connections are made.

## Dependency Security

Runtime dependencies (bundled in package):
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-agent-core`
- `typebox`

These are pinned as peerDependencies and bundled by pi during installation.

## Updates

- Extension updates via `pi update --extensions`
- Base pi updates via `pi update --self`
- Model updates via llama.cpp releases

Monitor for security advisories in dependencies.