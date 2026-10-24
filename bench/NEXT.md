# Next steps

1. Wait for the full run of `bench/improve-late-start` (worktree `/home/user/improve`), then write `bench/IMPROVE.md` (R6).
2. Full run of main's tip (90460ec, pre-bench codec) as the "previous commit" for the page comparison (R3).
3. Run `./bench/score`, write `bench/RESULTS.md`, and update the PR.

Small things noticed, not done:
- The bench's TypeScript is outside the repo's `tsc` scope (tsconfig `include`). Type-checking it shows only TS 5.9 `Float32Array<ArrayBufferLike>` generic nits in `bench/channel/index.ts`. Fixing them would change the measurement-code hash and force a new full run, so they were left alone.

## Blockers

(none)
