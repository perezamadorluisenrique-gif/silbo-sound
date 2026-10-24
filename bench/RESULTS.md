# Bench results

A summary of the reliability bench for Silbo's text messages. The full story with charts is the results page (`bench/site/`, published at `/bench` on the project's GitHub Pages once this is merged to main). The research write-up is `bench/WRITEUP.md`, and the reasons behind every judgement call are in `bench/DECISIONS.md`.

## What `./bench/score` confirms

SCORE_PLACEHOLDER

## Reproduce

```sh
npm ci                                   # Node ≥ 22.18; no other installs
node --test bench/test/*.test.ts         # channel unit tests (13)
node bench/run.ts --quick                # all sweeps, N=20 per step, ~2.5 min on 4 cores
node bench/run.ts                        # full run, N=200 per step, ~25 min on 4 cores
node bench/ablations.ts                  # paired ablations behind the suggestions, ~28 min
node bench/site/build.ts                 # results page -> bench/site/out/index.html
./bench/score                            # ladder R0-R6 -> bench/SCORE.txt
```

The same seed reproduces a run bit for bit, timings aside (`--seed`, default 1). `--only awgn,reverb` limits the run to some sweeps. `--codec <dir> --sha <sha>` measures another checkout's codec with today's channel. That is how `results/90460ec.json` (main before the bench) was made:

```sh
git worktree add --detach ../base 90460ec
node bench/run.ts --codec ../base --sha 90460ec
```

## Key findings, in plain words

1. **Echo is what breaks messages, not noise.** In a quiet office with the phones 1 m apart, about 9 in 10 messages arrive. At a café table it's about 1 in 5, and in a loud, echoey room 2 m apart none do. In every case it's the room's echo: remove it and nearly every message arrives. Putting the phones closer together (about 0.5 m) fixes most of it today.
2. **Long messages are the first to go.** A 140-character text fails long before a 16-character one, because the error-correction budget is fixed rather than growing with the message.
3. **Starting to listen a hair late loses the message.** If the receiving phone starts listening during the first 85 ms of the message, the message is lost. A one-line fix on the receiving side solves this completely (tested on branch `bench/improve-late-start`).
4. **Noise, cheap microphones, distorted speakers, clipping, clock drift and audio glitches** are all handled with a wide margin at realistic levels.
5. **It never delivers the wrong text and never invents a message from noise.** In 16,800 test messages and 30 minutes of pure noise, a message either arrived exactly or not at all.

## What is left for you

- **Real-phone check.** Every number here comes from a simulated channel. A short session with two real phones would anchor it: a quiet office at 1 m and 2 m, and a café. In particular, it would show whether some phones' noise suppression ignores the app's request to turn it off.
- **Decide on the suggestions** in `bench/WRITEUP.md`:
  1. Merge the late-start fix from `bench/improve-late-start`. It is receiver only and backward-compatible; the before/after is in `bench/IMPROVE.md`.
  2. A reverb-hardened profile with 7 hop sets. This changes the wire format, so check microphone bandwidth first.
  3. Parity that scales with message length.
- **Merge to main** to publish the page at `/bench` and start the automatic results commits. On PRs, the workflow only uploads the results as an artifact.
