# Next steps

The ladder is complete (R0–R6 pass). What remains is for the project owner; see `bench/RESULTS.md` → "What is left for you". In short:

1. Real-phone spot check (quiet office at 1 m and 2 m, café) to anchor the simulated numbers.
2. Decide on the late-start fix (branch `bench/improve-late-start`, ready) and on suggestions 2–3 (wire-format changes).
3. Merge the bench to main to publish `/bench` and enable automatic results commits.

Small things noticed, not done:
- The bench's TypeScript is outside the repo's `tsc` scope (tsconfig `include`). Type-checking it shows only TS 5.9 `Float32Array<ArrayBufferLike>` generic nits in `bench/channel/index.ts`. Fixing them changes the measurement-code hash, which forces new full runs, so it's best bundled with the next real channel change.
- `results/90460ec.json` records `codecRoot` as a local absolute path (`/home/user/base`), because it was measured from a worktree. It is informational only.

## Blockers

(none: nothing was denied during the run)
