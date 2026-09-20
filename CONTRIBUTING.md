# Contributing to pi-ultra-scout

Thank you for contributing! This project follows the pi extension conventions and welcomes improvements.

## Development Setup

```bash
git clone https://github.com/brutc/pi-ultra-scout.git
cd pi-ultra-scout

# Install dependencies
cd extension && npm install

# Run tests
bun test ./ulw-analysis/probe_shapes.ts
bun test ./ulw-analysis/probe_evidence.ts

# Type-check
npx tsc --noEmit --strict --moduleResolution bundler ultrawork.ts
```

## Project Structure

- `extension/ultrawork.ts` — Main entry point (factory function)
- `extension/ultrawork/` — Core modules
- `extension/ulw-analysis/` — Probe tests
- `experiments/` — Reproducible ablation framework
- `grading/` — Deterministic grader
- `charts/` — Matplotlib figure generation
- `paper/` — 3-page PDF paper

## Code Style

- TypeScript strict mode (no `any`, no unused locals/params)
- Pure functions where possible
- Deterministic detectors (no model calls in hot path)
- Async factory for extension entry point

## Adding New Trust Shapes

1. Add regex pattern to `claim_shapes.ts` `detectRiskyShapes()`
2. Add corresponding prompt section to `TRUST_SHAPES_SECTION`
3. Add probe case to `ulw-analysis/probe_shapes.ts`
4. Update `EXPERIMENT.md` with new shape

## Testing

```bash
# Probe tests (fast, no router needed)
bun test ./ulw-analysis/probe_shapes.ts
bun test ./ulw-analysis/probe_evidence.ts

# Full integration tests (require llama.cpp router)
bun test ./ulw-analysis/smoke_dispatch.ts
bun test ./ulw-analysis/smoke_wiring.ts

# Experiment grading
cd ../grading && python3 grade.py ../experiments/runs
cd ../charts && python3 make_charts.py
```

## Submitting Changes

1. Fork the repo
2. Create a feature branch
3. Run all tests: `npm run test:all` (from extension dir)
3. Type-check: `npm run build`
4. Submit PR with clear description

## Reporting Issues

- Bug reports: include steps to reproduce, expected vs actual
- Feature requests: describe use case and expected behavior
- Security issues: see SECURITY.md

## License

By contributing, you agree your contributions will be licensed under MIT.