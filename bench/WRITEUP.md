## Question

When one phone plays a Silbo text message and another phone listens, how often does the exact text arrive, and which real-world sound problems break it first?

## Method

**What is tested.** This is the app's own text path, unchanged: `planText()` encodes the message as one MFSK frame (profile 1 «robusto», 10 bits per 24 ms symbol, 984–6563 Hz, Reed-Solomon with 48 parity bytes, CRC-32). The audio goes through a simulated acoustic channel, and the app's `decodeWindow()` decodes it. A message counts as delivered only if the decoded text is exactly the text that was sent. `bench/CODEC.md` describes the codec.

**The channel.** `bench/channel/` has ten impairments, each with one strength setting and its own seeded random stream. They are applied in physical order: speaker nonlinearity → distance → room reverb → café babble → cheap microphone → clock drift / start offset → white noise floor → input clipping → dropouts → 16-bit quantisation. Every condition includes a quiet-room noise floor (30 dB in-band SNR at 1 m), a random 0.2–1.0 s lead before the message and a random fractional-sample delay. All noise is synthesised; no recordings are used. Each impairment has a unit test that checks it does what its name says (`bench/test/channel.test.ts`). For example, the reverb test checks the requested RT60 and direct-to-reverberant ratio, and the drift test checks the requested ppm.

**The experiments.** Each impairment is swept on its own from harmless to destructive, with 200 random messages per step. Messages are 16, 64 or 140 characters long in rotation, drawn from an alphabet with accents and punctuation. There are also three combined scenarios (quiet office, café table, worst realistic case), and 10 minutes per noise type of message-free audio to count false messages. Each step's seed is fixed, so two codec versions are tested on exactly the same sound. Every rate comes with a 95 % Wilson interval. Besides the pass/fail rate, the bench records:

- the character error rate;
- whether the preamble was found within 10 ms of where it really is;
- the raw bit error rate of the tones before error correction, measured with perfect timing.

The raw bit error rate shows how close a step is to failing even while every message still gets through. The ablations (`bench/ablations.ts`) re-run selected conditions with a single change, on the same sound:

- a receiver-side change to the captured buffer;
- one impairment removed from a scenario;
- an alternative MFSK profile, sent through the codec's own experiment hook.

The app is never changed.

## Findings

(written from the full run below)

## Suggestions

(written from the ablations below)

## Limitations

- **It is a simulation.** No real phone, speaker, microphone or room was used. The models are standard textbook models (Sabine reverberation with an exponentially decaying noise tail, 1/d spreading, Butterworth band-limits, `tanh` saturation, Poisson dropouts). The unit tests check that each model does what it says, but not that it matches any particular phone. In particular:
  - Real phone speakers are directional and roll off steeply below ~500 Hz.
  - Real microphones apply automatic gain control and noise suppression, which this channel does not model. Noise suppression is designed to remove steady tones and could be worse than anything simulated here. The app asks the browser to turn it off, but some phones ignore that.
- **Distance high-frequency loss is an assumption** (a low-pass at 16 kHz/√d). Path loss against the fixed noise floor dominates anyway, so the distance limit mostly restates the white-noise limit in metres.
- **The room is one model room.** It has 100 m³ volume and a diffuse tail with no early-reflection pattern. Rooms of a different size or shape, and phones facing away from each other, will differ.
- **Only the text path is measured.** File transfer (OFDM), discreet mode (near-ultrasound) and multi-frame carousels are not swept.
- **The receiver decodes each capture once** instead of replaying the app's 14 s sliding window every 1.5 s. This gives the same pass/fail for a single text frame, but it does not measure the app's real-time CPU budget. Decode times are from Node on a server CPU, not from a phone.
- **Impairments are swept one at a time**, plus three hand-picked combinations. Interactions are only sampled, not mapped.
- **Statistical resolution.** With 200 messages per step, a rate of 100 % means the true rate is at least ~98 % (95 % confidence). Rarer failures than that are invisible. The quick CI run (20 per step) only catches large regressions.
