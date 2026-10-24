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
