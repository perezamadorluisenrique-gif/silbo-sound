// What the bench measures: one sweep per impairment, a few composite scenarios and the
// false-detection tests. Values were chosen so each sweep spans "harmless" to "past the cliff"
// (calibrated once with a 6-message probe, see DECISIONS.md); they are not tuned per commit.
import type { Condition } from './channel/index.ts';
import { Rng } from './lib/dsp.ts';

export interface Sweep {
  id: string;
  label: string;
  param: string; // axis label
  unit: string;
  values: number[];
  /** direction in which the impairment gets worse along `values` */
  worse: 'up' | 'down';
  cond(v: number, rng: Rng): Condition;
  note: string;
}

const sign = (rng: Rng) => (rng.next() < 0.5 ? -1 : 1);

export const SWEEPS: Sweep[] = [
  { id: 'awgn', label: 'White noise', param: 'in-band SNR', unit: 'dB', values: [30, 10, 0, -3, -5, -6, -7, -8, -9, -10, -12], worse: 'down', cond: (v) => ({ awgnDb: v }), note: 'Stationary white noise floor (replaces the 30 dB baseline floor).' },
  { id: 'babble', label: 'Café babble', param: 'in-band SNR', unit: 'dB', values: [10, 0, -6, -12, -15, -18, -21, -24], worse: 'down', cond: (v) => ({ babbleDb: v }), note: 'Six synthetic talkers, dish clinks and rumble, added acoustically (before the microphone).' },
  { id: 'distance', label: 'Distance', param: 'distance', unit: 'm', values: [0.5, 1, 4, 8, 16, 20, 24, 28, 32, 40], worse: 'up', cond: (v) => ({ distanceM: v }), note: '1/d spreading and a low-pass at 16 kHz/√d, against the fixed 30 dB (at 1 m) floor; free field.' },
  { id: 'reverb', label: 'Room reverb', param: 'RT60', unit: 's', values: [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4], worse: 'up', cond: (v) => ({ rt60: v }), note: 'Synthetic impulse response; DRR from Sabine (100 m³ room, phones 0.5 m apart).' },
  { id: 'mic', label: 'Cheap microphone', param: 'upper cut-off', unit: 'Hz', values: [8000, 5000, 4000, 3000, 2500, 2000, 1750, 1500, 1250], worse: 'down', cond: (v) => ({ micHiHz: v }), note: '4th-order band-pass 300 Hz to the cut-off, +5 dB resonance at 0.75× cut-off.' },
  { id: 'speaker', label: 'Speaker nonlinearity', param: 'drive', unit: 'dB', values: [0, 6, 12, 18, 24, 30, 40], worse: 'up', cond: (v) => ({ speakerDb: v }), note: 'Asymmetric soft saturation (tanh + even-order term) and a 350 Hz high-pass.' },
  { id: 'clip', label: 'Input clipping', param: 'peak over full scale', unit: 'dB', values: [0, 6, 12, 20, 30, 40], worse: 'up', cond: (v) => ({ clipDb: v }), note: 'Received peak this far above the ADC full scale, hard-clipped.' },
  { id: 'drift', label: 'Clock drift', param: '|offset|', unit: 'ppm', values: [0, 100, 300, 600, 1000, 2000, 4000], worse: 'up', cond: (v, rng) => ({ ppm: v * sign(rng) }), note: 'Receiver sample clock off by ±ppm (sign random per message), plus a fractional start delay.' },
  { id: 'late', label: 'Late start', param: 'preamble missed', unit: 'ms', values: [0, 1, 5, 20, 40, 80], worse: 'up', cond: (v) => ({ lateMs: v }), note: 'The receiver starts recording this long after the 85 ms preamble began.' },
  { id: 'dropouts', label: 'Dropouts', param: 'rate', unit: 'gaps/s', values: [0, 1, 2, 4, 6, 8, 10, 12, 16], worse: 'up', cond: (v) => ({ dropoutsPerS: v }), note: 'Silent 5–40 ms gaps (audio glitches), Poisson-distributed.' },
];

export interface Scenario {
  id: string;
  label: string;
  cond(rng: Rng): Condition;
  note: string;
}

export const SCENARIOS: Scenario[] = [
  { id: 'quiet', label: 'Quiet office', cond: () => ({ rt60: 0.4, distanceM: 1 }), note: 'Two phones 1 m apart on a desk, RT60 0.4 s, quiet floor.' },
  { id: 'cafe', label: 'Café table', cond: (rng) => ({ babbleDb: 5, rt60: 0.8, distanceM: 1, micHiHz: 5000, ppm: 100 * sign(rng) }), note: 'Café noise at +5 dB, RT60 0.8 s, 1 m, mid-range microphone, ±100 ppm.' },
  {
    id: 'worst',
    label: 'Worst realistic case',
    cond: (rng) => ({ babbleDb: 0, rt60: 1.2, distanceM: 2, micHiHz: 4000, speakerDb: 12, clipDb: 6, ppm: 200 * sign(rng), dropoutsPerS: 1 }),
    note: 'Loud café (babble as loud as the phone), RT60 1.2 s, 2 m apart, 300–4000 Hz microphone with resonance, speaker driven 12 dB into saturation, input 6 dB over full scale, ±200 ppm, one dropout per second.',
  },
];

export interface FalseTest {
  id: string;
  label: string;
  cond: Condition;
}
export const FALSE_TESTS: FalseTest[] = [
  { id: 'white', label: 'White noise', cond: { awgnDb: 0 } },
  { id: 'babble', label: 'Café babble', cond: { babbleDb: -6 } },
  { id: 'worst', label: 'Worst-case chain, no signal', cond: { babbleDb: 0, micHiHz: 4000, clipDb: 6, dropoutsPerS: 1 } },
];

/** Characters of random test messages: Spanish text with accents, digits and punctuation. */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz      ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:!?¿¡áéíóúñüÁÉÑ';
export function randomText(len: number, rng: Rng): string {
  const a = [...ALPHABET];
  let s = '';
  for (let i = 0; i < len; i++) s += a[rng.int(a.length)];
  return s;
}
export const LENGTHS = [16, 64, 140];
