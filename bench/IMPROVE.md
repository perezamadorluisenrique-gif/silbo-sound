# R6: late-start fix, before and after

**What:** suggestion 1 from `bench/WRITEUP.md`. Every receive window gets one preamble (4096 samples, 85 ms) of silence in front before decoding. The change only affects the receiver: the transmitted sound, the wire format and old receivers are unaffected.

**Why this one:** it was the most promising of the three by evidence per unit of cost and risk:
- The ablation showed a complete fix (0 % → 100 % at every lateness tested).
- It costs no airtime and is backward-compatible.
- It is a 7-line change in one function, `decodeWindow()` in `app/core.ts`.

Suggestion 2 (7 hop sets) has a larger reach but changes the wire format and hurts band-limited microphones, so it needs a product decision and real-phone checks first. Suggestion 3 also changes the wire format.

**Where:** branch `bench/improve-late-start`. Commit 04b6c11 is the codec change on its own, logged as a codec change in its message.

**Runs:** both are full runs (N=200 per step, seed 1) with the same measurement code (bench hash `e096cc1b00180b3e`), on identical sound:

- before: `06ca291.json` (codec `4abd51acfa93ab6d`)
- after: `04b6c11.json` (codec `4da6e0045d9e228a`)

| | before | after |
|---|---|---|
| late start 1 ms | 0/200 | **200/200** |
| late start 5 ms | 0/200 | **200/200** |
| late start 20 ms | 0/200 | **200/200** |
| late start 40 ms | 0/200 | **200/200** |
| late start 80 ms | 0/200 | **200/200** |
| every other sweep step (78 steps), all 3 scenarios | — | identical, message for message |
| false messages from 30 min of noise | 0 | 0 |
| preamble alarms on noise (white / babble / worst) | 1 / 0 / 1 | 1 / 0 / 1 |
| decode time per 14 s noise window | 332–337 ms | 343–355 ms |

The decode-time difference is within machine noise. The after-run shared the CPU with another full run, and padding adds only 0.6 % more samples to a 14 s window. The repo's own unit tests (`npm test`, 14 tests) and `tsc --noEmit` pass on the branch.

**The app's live path:** the bench decodes each capture once. The app's real path slides a 14 s window every 1.5 s, and the padding shifts `lastEnd` and the skip point by the pad length. The repo's browser e2e suite (`npm run e2e`) covers that path. It passes 15/15 on the branch, including:
- a 140-character text received intact through the app's receive screen;
- a 10 KB photo whose frames arrive across several overlapping windows.
