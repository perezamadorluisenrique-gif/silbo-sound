# Silbo codec, as the bench sees it

Read from the code at commit `90460ec` (`src/modem/`, `src/fec/`, `src/dsp/`, `app/core.ts`). Nothing here changes the codec; this page is the bench's map of it.

## What the app actually sends for a text message

`app/core.ts` → `planText(text)`:

- Texts up to 300 UTF-8 bytes (`TEXT_MAX_BYTES`) go out as **one frame with profile 1 «robusto»** (`TEXT_PROFILE = 1`). Longer texts become a file (OFDM carousel, profile 2).
- Discreet mode sends profile 3 (near-ultrasound) instead.
- The frame is padded with 0.1 s of silence on both sides (`FRAME_GAP_S`).

The receiver (`app/worker.ts`) calls `decodeWindow(win, skip)` on a 14 s sliding window every 1.5 s; that calls `mfsk.decodeAny()`, which runs the phone-band and discreet-band receivers.

**The bench measures exactly this path**: `planText()` → channel → `decodeWindow()`. That is the path a user's text takes, so it is the one whose reliability matters.

## Frame (MFSK families, `src/modem/mfsk.ts`)

```
| up-chirp 4096 | gap 256 | header (10 symbols) | payload (n symbols) | gap 256 | down-chirp 4096 |
```

All at **48 kHz**.

| part | detail |
|---|---|
| Preamble | linear up-chirp 800→7800 Hz, 4096 samples (85 ms), 5 % cosine taper, amplitude 0.7. Found by normalised cross-correlation (NCC) after a 4th-order Butterworth band-pass 700–8000 Hz; threshold **0.15**. The earliest arrival reaching 60 % of the peak within 300 samples is taken as the direct path. The received chirp also gives the channel magnitude response \|H(f)\|² at every tone bin (equaliser). |
| Header | 4 bytes: `version<<4 \| profile`, length (16 bit), CRC-8 (poly 0x07). RS(12,4) over GF(256) (8 parity bytes), scrambled (LFSR seed 0x1d2b), always sent with the robust profile (10 symbols). |
| Payload | data + CRC-32 (IEEE), split into RS codewords of ≤ 255 bytes, byte-interleaved across codewords, scrambled (16-bit Galois LFSR, taps 0xB400, seed 0xace1). |
| Postamble | down-chirp 7800→800 Hz. Its arrival time versus the preamble gives the **clock ratio** (sender/receiver sample-rate mismatch), used to place every symbol window. Plausibility bound ±300 ppm. |

### Modulation: parallel MFSK with frequency hopping

- Symbol = guard **G = 128** + FFT window **N = 1024** samples = 1152 samples = **24 ms → 41.7 symbols/s**. Tones get 64-sample raised-cosine ramps that overlap the next guard. The window starts 32 samples before the end of the guard (`evalOffset = -32`).
- Bin spacing 48000/1024 = **46.875 Hz**, first bin 21 (**984 Hz**).
- In each symbol, `ng` groups each send **one of M = 4 tones** (2 bits per group). Consecutive symbols cycle through `H` disjoint hop sets (contiguous sub-bands, `block: true`) so echoes of the previous `H−1` symbols fall outside the bins being compared.
- Detection is non-coherent: energy per bin (one FFT), divided by an equaliser (chirp-based, then refined by the mean energy per bin over the payload, `binNorm`), and argmax per group. The ratio of best to second-best energy is the soft confidence of the byte.

| profile | id | groups × tones × hops | bits/symbol | band | RS parity / codeword | 140 B frame | net rate |
|---|---|---|---|---|---|---|---|
| rápido | 0 | 8 × 4 × 4 | 16 | 984–6937 Hz | 32 | 2.7 s | ~456 bit/s |
| **robusto (texts)** | **1** | **5 × 4 × 6** | **10** | **984–6563 Hz** | **48** | **4.3 s** | ~282 bit/s |
| archivo (OFDM) | 2 | — | — | 1000–7800 Hz | conv. K=7 r=1/2 ×2 | — | ~2.4 kbit/s |
| discreto | 3 | 3 × 4 × 3 | 6 | 17.63–19.31 kHz | 64 | 8.2 s | ~137 bit/s |

Profile 1, every symbol occupies one 20-bin (~940 Hz) sub-band; six sub-bands cover 984–6563 Hz.

## Error detection and correction

1. **Reed-Solomon** over GF(256), systematic (`src/fec/rs.ts`), Berlekamp-Massey with erasures. Profile 1: 48 parity bytes per codeword → corrects up to 24 byte errors, or up to 48 erasures.
2. **Erasure retries**: if errors-only decoding fails, the decoder retries with the ¼, ½, ¾ and (all − 4) least-confident bytes erased; each candidate is a guess.
3. **CRC-32** over the payload picks the right combination of codeword candidates (up to 64 combinations) and rejects miscorrections.
4. Header: RS(12,4) + CRC-8 + version nibble.

A frame that fails yields **nothing** (no partial text). So for this codec, a message is either delivered intact or lost; character errors in delivered text can only come from an undetected error (CRC-32 collision after RS miscorrection), which should be ~2⁻³².

## OFDM payload (profile 2, files only; `src/modem/ofdm.ts`)

N = 16384, cyclic prefix 2048, carriers 1000–7800 Hz, time-differential QPSK, rate-1/2 K=7 convolutional code with soft Viterbi, every coded bit sent twice, CRC-32. Same chirps and header. Not part of the text path, so not swept here.

## Entry points

| role | function | file |
|---|---|---|
| encode text (app path) | `planText(text, discreto?) → { audio: Float32Array @ 48 kHz, ... }` | `app/core.ts` |
| encode any profile | `encodeWith(bytes, id)` | `src/modem/mfsk.ts` |
| decode a window (app path) | `decodeWindow(win, skip) → { payloads, lastEnd }` | `app/core.ts` |
| decode one family | `decodeAll(rx, override?, threshold, family, skipBefore)` | `src/modem/mfsk.ts` |
| diagnostics | `txTones`, `rxTones` (hard tone decisions with known timing) | `src/modem/mfsk.ts` |

## Headless?

Yes, already. The codec is plain TypeScript with no DOM or Web Audio dependency, and Node ≥ 22.18 runs `.ts` directly (type stripping). The bench imports `app/core.ts` as is — **no wrapper was needed**, so there is no risk of the wrapper drifting from the app.

## Files that define the codec (CI trigger paths)

```
src/modem/**   src/fec/**   src/dsp/**   src/file/**   app/core.ts
```

`src/sim/**` is the project's older channel simulator and `app/main.ts` etc. are UI; they are not codec. The bench's own code (`bench/**`, except results and docs) also triggers the workflow, because a bench change changes the numbers.
