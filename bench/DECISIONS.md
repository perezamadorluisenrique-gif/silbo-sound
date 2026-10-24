# Decisions

Nobody was available to answer questions, so every judgement call is written down here with its reason.

## Scope and language

- **English** for the bench docs and page, because the brief was written in English and the file names it asked for are English. (The repo's older docs are in Spanish; I left them alone.)
- **Plain TypeScript on Node**, no NumPy/SciPy. The codec is TypeScript and Node ≥ 22.18 runs `.ts` directly, so the bench imports the real encoder/decoder with no wrapper, no build step and no second language in CI. SciPy wasn't installed either.
- **What is measured: the app's text path** — `planText()` (profile 1 «robusto», one MFSK frame) → channel → `decodeWindow()`, exactly what `app/worker.ts` runs. Files (OFDM, profile 2) and discreet mode (profile 3) are out of scope for the sweeps: texts are the core use, and each extra profile multiplies run time.
- The receiver decodes the whole captured buffer once instead of replaying the app's 14 s sliding window every 1.5 s. A text frame (≤ 4.4 s) always fits whole in one of the app's windows, so this is equivalent for success/failure and ~9× cheaper.

## Channel simulator

- **Independent DSP** (`bench/lib/dsp.ts`: own FFT, biquads, PRNG, resampler). `src/dsp` is part of the codec; if the channel shared it, a codec change could silently change the channel and the comparison between commits would be meaningless.
- **Not reusing `src/sim`** for the same reason, and because the brief asks for per-impairment strength sweeps that `src/sim` doesn't expose.
- **SNR definition**: in-band 500–8000 Hz (the codec's band, same as the repo's `CANAL.md`), relative to the emitted signal at the 1 m reference point. So distance and a microphone's roll-off lower the effective SNR against a fixed noise floor, which is what happens physically.
- **Baseline**: every condition carries a white noise floor at 30 dB in-band SNR (a quiet room with the phone at 1 m), a random 0.2–1.0 s lead before the frame, a random fractional-sample delay and 16-bit quantisation. The white-noise sweep replaces the floor; every other sweep adds to it. Without a floor, attenuations (distance, microphone) would be invisible because the decoder equalises them away.
- **Fixed order of the chain**: speaker nonlinearity → distance → reverb → café babble (acoustic) → microphone → clock drift → white floor (electronic) → ADC clip → dropouts → quantisation.
- **Room**: Sabine's critical distance with V = 100 m³ and the phones 0.5 m apart sets the direct-to-reverberant ratio from RT60 (RT60 0.3 s → +6.4 dB, 1 s → +1.1 dB, 2 s → −1.9 dB), so one strength parameter (RT60) moves both like a real room.
- **Distance**: 1/d spreading plus a 2nd-order low-pass at 16 kHz/√d (small-speaker beaming plus air absorption). The roll-off law is an assumption, flagged as such on the page.
- **Cheap microphone**: strength = upper cut-off (Hz) of a 4th-order band-pass from 300 Hz, plus a +5 dB resonance at 0.75× the cut-off. The brief's "~300–4000 Hz" is one point on the sweep.
- **Café noise** is synthesised (glottal pulse trains through moving vowel formants, fricatives, clinks, rumble); no recorded audio.
- **Each impairment draws from its own seeded random stream**, so enabling one impairment does not reshuffle the randomness of the others.
- **Late start** (`lateMs`) is measured from the start of the frame's preamble, not from the start of the app's audio buffer (which has 0.1 s of padding).
- **Speaker nonlinearity** is `tanh` with drive `k = 0.3·10^(dB/20)` plus a small even-order term and a 350 Hz high-pass, RMS-matched to the input. At 0 dB it is nearly linear (THD < 1 %), so the sweep starts from a clean speaker; an earlier `k = 10^(dB/20)` already produced ~6 % THD at "0 dB", which made the axis misleading.

## Experiments

- **Sweep ranges** were picked from a 6-message probe so each curve covers "always works" to "fails" (or the physically plausible end of the range when nothing fails: speaker and clipping up to 40 dB). Steps are not evenly spaced in value; the charts space them evenly and say so.
- **N = 200 per step** (brief default), lengths 16/64/140 characters in rotation (short chat, a sentence, a full SMS). 140 is below the app's text limit and keeps a frame under 4.4 s.
- **Messages and channel randomness are seeded per (sweep, value, message index)**, so two codec versions see exactly the same sound: comparisons between commits are paired, and the same seed reproduces the run bit for bit (timings aside).
- **"Limits"** are where the success rate first crosses 90 % and 50 %, linearly interpolated between steps. A dash means the rate never got there inside the tested range.
- **Worst realistic case** = loud café (babble as loud as the phone), RT60 1.2 s, 2 m apart, 300–4000 Hz microphone, speaker driven 12 dB into saturation, input 6 dB over full scale, ±200 ppm, one dropout per second. Each ingredient is individually something people run into; all at once is pessimistic but not absurd. Two milder scenarios (quiet office, café table) bracket it.
- **False detections** are measured on 14 s windows (the app's window length) of pure noise: white, babble, and the worst-case chain with no signal. Each window counts delivered payloads (a false message) and preamble detector alarms (each costs a header decode).
- **Late start**: in the first probe even 1 ms of missed preamble made decoding fail, so the sweep is kept despite being a step function: it is the clearest finding.
- **Ablations** (`bench/ablations.ts`) change the experiment, never the app: receiver-side tweaks are applied to the captured buffer in the bench, and alternative profiles go through the codec's own experiment hook (`mf.custom`, header id 15). They back the write-up's suggestions with paired numbers. In the leave-one-out on the scenarios, removing `distanceM` also puts the phones at the reverb model's default 0.5 m, so it removes both the extra path loss and part of the reverberation; the write-up reads it that way.
- Profile variants keep the header's symbol grid (N = 1024, G = 128, first bin 21): the decoder computes symbol positions from the header profile, so a longer guard interval can't be tested through the experiment hook without changing the codec.

## Results and page

- **File naming**: `bench/results/<sha>.json` for a clean tree; `-dirty` when the codec or measurement code had uncommitted changes (gitignored); a quick run never overwrites a full run of the same commit (it goes to `<sha>.quick.json`). The JSON carries hashes of the codec and of the measurement code, so `score` can tell whether a result still describes the current code.
- **Previous commit** for the comparison = the nearest first-parent ancestor of HEAD with a results file (full preferred). Differences are flagged with a two-proportion z-test (p < 0.05) per step, because at N = 200 a few points move by chance.
- **Page**: one self-contained HTML file (inline SVG, ~no JS except tooltips), Tinta tokens copied from `app/app.css`, light and dark. Current = blue solid line, previous = ochre dashed line with hollow dots (identity is never colour alone). Colours validated with the dataviz palette checker against both Tinta surfaces.
- **Deployment**: the existing Pages workflow deploys `dist/` (the app) on pushes to main, and a Pages deployment replaces the whole site. So the bench page is built into `dist/bench` by *both* workflows: `pages.yml` (app deploys keep /bench) and `bench.yml` (codec changes refresh it).
- **CI commits results only on main.** On other branches and PRs the workflow runs and uploads the JSON as an artifact; committing from CI to a work branch would race the people pushing to it. On PRs nothing is posted (no comment step, no PR write permission).
- `--quick` (N = 20) runs all sweeps, scenarios and a shorter false-detection test in ~2.5 min on 4 cores (GitHub's public-repo runners have 4).
