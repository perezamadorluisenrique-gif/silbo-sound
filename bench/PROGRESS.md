# Bench progress log

- 2026-10-24T04:40Z | start | read codec, wrote CODEC.md, DSP lib and channel simulator (10 impairments) | —
- 2026-10-24T04:55Z | R0 R1 | score.ts, page builder, bench.yml, pages.yml /bench, ablations.ts; quick run 2m25s on 4 cores | R0 PASS, R1 PASS
- 2026-10-24T05:15Z | R2 data | full N=200 sweep of 06ca291 in 24 min (4 workers): cliff points recorded in results/06ca291.json | ablations running
- 2026-10-24T13:59Z | R2 R5 | ablations (28 min, 15k trials): reverb explains the scenario failures; padding fixes late start; findings + 3 suggestions written; score: evidence keys extended with per-length rates | R2 PASS, R5 PASS
- 2026-10-24T14:41Z | R6 | late-start fix on bench/improve-late-start (04b6c11): full after-run identical except late start 0/200 -> 200/200 at every step; npm test 14/14, e2e 15/15; IMPROVE.md; page renders it | R6 PASS
- 2026-10-24T14:52Z | R6 (all) | previous-commit run 90460ec (identical, as expected); full ./bench/score: R0-R6 PASS, quick 147 s; RESULTS.md | done
