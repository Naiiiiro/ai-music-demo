/**
 * 瀏覽器端作曲引擎：與 Python 版 composition_engine 相同的規則（I–V–vi–IV、寫定的旋律樂句、Euclidean 鼓組），
 * 純計算、不碰 Web Audio，讓 Node 也能測試。全部規則寫定，不用亂數，每次產生的曲子都一樣。
 */

export const STEPS_PER_BAR = 16;
export const BEATS_PER_BAR = 4;
const MAJOR_SCALE_STEPS = [0, 2, 4, 5, 7, 9, 11];
const POP_PROGRESSION_DEGREES = [0, 4, 5, 3];
const DEFAULT_ROOT_MIDI = 60;
// 旋律以和弦根音高一個八度為基準（7 個音階級數），落在 C5 附近
const MELODY_DEGREE_OFFSET = 7;
const MELODY_SLOT_STEPS = 2;
/**
 * 旋律樂句：每小節 8 個八分音符，數字是相對旋律基準的音階級數，null 是休止。
 * 偶數小節用「問句」往上走，奇數小節用「答句」往下收；每句第一個音是根音或五音，一定落在和弦音上。
 */
export const MELODY_PHRASES = Object.freeze([
  Object.freeze([0, 1, 2, null, 4, 2, 1, null]),
  Object.freeze([4, 2, 1, 2, 0, null, 0, null]),
]);
// pad 比和弦高一個八度（7 個音階級數），鋪在旋律上方
const PAD_DEGREE_OFFSET = 7;
const PLUCK_PULSE_COUNT = 5;
// 依序彈和弦的根音、三音、五音、高八度根音
const PLUCK_ARPEGGIO_OFFSETS = [0, 2, 4, 7];
// 第 2、4 拍的反拍
const CLAP_STEPS = [4, 12];

/**
 * Euclidean rhythm：把 pulse_count 個擊點平均分配到 step_count 格。
 * @param {number} pulse_count 擊點數
 * @param {number} step_count 總格數
 * @returns {boolean[]}
 */
export function euclidean_rhythm(pulse_count, step_count) {
  if (step_count <= 0) throw new RangeError(`step_count 必須 > 0，收到 ${step_count}`);
  if (pulse_count < 0 || pulse_count > step_count) throw new RangeError(`pulse_count 超出範圍：${pulse_count}`);
  return Array.from({ length: step_count }, (_, step_index) => (step_index * pulse_count) % step_count < pulse_count);
}

/**
 * 音階級數轉 MIDI 音高（自動跨八度）。
 * @param {number} root_midi 主音
 * @param {number} scale_degree 級數
 * @returns {number}
 */
export function scale_degree_to_midi(root_midi, scale_degree) {
  const octave_offset = Math.floor(scale_degree / 7);
  const degree_in_octave = ((scale_degree % 7) + 7) % 7;
  return root_midi + MAJOR_SCALE_STEPS[degree_in_octave] + octave_offset * 12;
}

/**
 * MIDI 音高轉頻率（Hz）。
 * @param {number} midi_note
 * @returns {number}
 */
export function midi_to_frequency(midi_note) {
  return 440 * 2 ** ((midi_note - 69) / 12);
}

function compose_harmony_events(chord_degree, root_midi) {
  const harmony_events = [];
  for (const third_offset of [0, 2, 4]) {
    harmony_events.push({ step_index: 0, length_steps: STEPS_PER_BAR, midi_note: scale_degree_to_midi(root_midi, chord_degree + third_offset),
      velocity: 0.25, instrument_name: "chord" });
    harmony_events.push({ step_index: 0, length_steps: STEPS_PER_BAR, midi_note: scale_degree_to_midi(root_midi, chord_degree + third_offset + PAD_DEGREE_OFFSET),
      velocity: 0.3, instrument_name: "pad" });
  }
  for (let beat_index = 0; beat_index < BEATS_PER_BAR; beat_index += 1) {
    harmony_events.push({ step_index: beat_index * 4, length_steps: 3.6, midi_note: scale_degree_to_midi(root_midi, chord_degree) - 12,
      velocity: 0.6, instrument_name: "bass" });
  }
  return harmony_events;
}

function compose_melody_events(bar_index, chord_degree, root_midi) {
  const melody_phrase = MELODY_PHRASES[bar_index % MELODY_PHRASES.length];
  return melody_phrase.flatMap((degree_offset, slot_index) => (degree_offset === null ? [] : [{
    step_index: slot_index * MELODY_SLOT_STEPS, length_steps: 1.9, velocity: 0.5, instrument_name: "lead",
    midi_note: scale_degree_to_midi(root_midi, chord_degree + MELODY_DEGREE_OFFSET + degree_offset),
  }]));
}

function compose_pluck_events(chord_degree, root_midi) {
  const hit_steps = euclidean_rhythm(PLUCK_PULSE_COUNT, STEPS_PER_BAR).flatMap((is_hit, step_index) => (is_hit ? [step_index] : []));
  return hit_steps.map((step_index, hit_order) => ({
    step_index, length_steps: 2, velocity: 0.35, instrument_name: "pluck",
    midi_note: scale_degree_to_midi(root_midi, chord_degree + PLUCK_ARPEGGIO_OFFSETS[hit_order % PLUCK_ARPEGGIO_OFFSETS.length]),
  }));
}

function compose_drum_events() {
  const drum_events = [];
  for (const [instrument_name, pulse_count, velocity] of [["kick", 4, 0.9], ["hat", 7, 0.3]]) {
    euclidean_rhythm(pulse_count, STEPS_PER_BAR).forEach((is_hit, step_index) => {
      if (is_hit) drum_events.push({ step_index, length_steps: 1, midi_note: 0, velocity, instrument_name });
    });
  }
  for (const step_index of CLAP_STEPS) drum_events.push({ step_index, length_steps: 1, midi_note: 0, velocity: 0.5, instrument_name: "clap" });
  return drum_events;
}

/**
 * 產生一小節的所有音符事件（以十六分音符格為時間單位）。
 * 樂器：chord、pad、bass（和聲）、lead（旋律）、pluck（琶音）、kick、hat、clap（鼓組）。
 * @param {number} bar_index 第幾小節，必須是非負整數
 * @param {number} [root_midi=60] 主音
 * @returns {{step_index: number, length_steps: number, midi_note: number, velocity: number, instrument_name: string}[]}
 */
export function compose_bar(bar_index, root_midi = DEFAULT_ROOT_MIDI) {
  if (!Number.isInteger(bar_index) || bar_index < 0) throw new RangeError(`bar_index 必須是非負整數，收到 ${bar_index}`);
  const chord_degree = POP_PROGRESSION_DEGREES[bar_index % POP_PROGRESSION_DEGREES.length];
  return [
    ...compose_harmony_events(chord_degree, root_midi),
    ...compose_melody_events(bar_index, chord_degree, root_midi),
    ...compose_pluck_events(chord_degree, root_midi),
    ...compose_drum_events(),
  ];
}
