/**
 * 場景音效的合成基本元件（純計算，不碰 Web Audio）：雜訊、振盪器、濾波器、包絡、泛音聲帶、敲擊共鳴。
 * 每個場景音效都由這些元件組成一段 Float32Array，再交給 sound_effects.start_rendered_effect 播放。
 * 全部是寫定的公式與 LFSR 雜訊，不用亂數；同樣的參數永遠得到同樣的取樣，Node 也能測試。
 */
import { smooth_interpolate } from "./effect_signals.js";
import { create_noise_register } from "./signal_generators.js";

// 濾波器係數每隔幾個取樣重算一次；頻率隨時間變化時，這個間隔短到聽不出階梯
const FILTER_UPDATE_INTERVAL_SAMPLES = 16;
// 截止頻率上限是取樣率的這個比例，避免超過 Nyquist 頻率讓濾波器失穩
const MAXIMUM_FILTER_FREQUENCY_RATIO = 0.45;
const MINIMUM_FILTER_FREQUENCY = 10;
const DEFAULT_QUALITY_FACTOR = Math.SQRT1_2;
// 黃金比例的小數部分：k × 0.618… 取小數，會在 0 到 1 之間平均散開又不重複，用來排「看起來不規則」的事件時間
const GOLDEN_RATIO_FRACTION = (Math.sqrt(5) - 1) / 2;
const DEFAULT_PEAK_LEVEL = 0.8;
const DEFAULT_EDGE_FADE_SECONDS = 0.02;

function require_positive_integer(parameter_value, parameter_name) {
  if (!Number.isInteger(parameter_value) || parameter_value <= 0) throw new RangeError(`${parameter_name} 必須是正整數，收到 ${parameter_value}`);
}

function require_positive_number(parameter_value, parameter_name) {
  if (!(parameter_value > 0)) throw new RangeError(`${parameter_name} 必須 > 0，收到 ${parameter_value}`);
}

function as_time_function(value_or_function) {
  return typeof value_or_function === "function" ? value_or_function : () => value_or_function;
}

/**
 * 建立一段全為 0 的取樣。
 * @param {number} sample_rate 取樣率，必須是正整數
 * @param {number} duration_seconds 長度（秒），必須 > 0
 * @returns {Float32Array} 長度為 sample_rate × duration_seconds（無條件進位）
 */
export function create_silent_samples(sample_rate, duration_seconds) {
  require_positive_integer(sample_rate, "sample_rate");
  require_positive_number(duration_seconds, "duration_seconds");
  return new Float32Array(Math.ceil(sample_rate * duration_seconds));
}

/**
 * 確定性的寬頻雜訊。skip_values 讓不同圖層從 LFSR 數列的不同位置開始，彼此聽起來不會一模一樣。
 * @param {number} sample_rate 取樣率
 * @param {number} duration_seconds 長度（秒）
 * @param {number} [skip_values=0] 開始前先丟掉幾個值，必須是非負整數
 * @returns {Float32Array} 值介於 ±1
 */
export function create_noise_samples(sample_rate, duration_seconds, skip_values = 0) {
  if (!Number.isInteger(skip_values) || skip_values < 0) throw new RangeError(`skip_values 必須是非負整數，收到 ${skip_values}`);
  const noise_samples = create_silent_samples(sample_rate, duration_seconds);
  const next_noise_value = create_noise_register();
  for (let skipped_count = 0; skipped_count < skip_values; skipped_count += 1) next_noise_value();
  for (let sample_index = 0; sample_index < noise_samples.length; sample_index += 1) noise_samples[sample_index] = next_noise_value();
  return noise_samples;
}

const WAVEFORM_FUNCTIONS = Object.freeze({
  sine: (cycle_phase) => Math.sin(2 * Math.PI * cycle_phase),
  sawtooth: (cycle_phase) => 2 * cycle_phase - 1,
  square: (cycle_phase) => (cycle_phase < 0.5 ? 1 : -1),
  triangle: (cycle_phase) => 1 - 4 * Math.abs(cycle_phase - 0.5),
});

/**
 * 振盪器：頻率可以是常數或「經過秒數 → Hz」的函式（相位連續累加，滑音不會爆音）。
 * @param {number} sample_rate 取樣率
 * @param {number} duration_seconds 長度（秒）
 * @param {number | ((elapsed_seconds: number) => number)} frequency_source 頻率
 * @param {"sine" | "sawtooth" | "square" | "triangle"} [waveform_name="sine"] 波形
 * @returns {Float32Array} 值介於 ±1
 */
export function create_oscillator_samples(sample_rate, duration_seconds, frequency_source, waveform_name = "sine") {
  if (!Object.hasOwn(WAVEFORM_FUNCTIONS, waveform_name)) throw new RangeError(`沒有這個波形：${waveform_name}`);
  const waveform_function = WAVEFORM_FUNCTIONS[waveform_name];
  const frequency_at_time = as_time_function(frequency_source);
  const oscillator_samples = create_silent_samples(sample_rate, duration_seconds);
  let cycle_phase = 0;
  for (let sample_index = 0; sample_index < oscillator_samples.length; sample_index += 1) {
    oscillator_samples[sample_index] = waveform_function(cycle_phase);
    cycle_phase = (cycle_phase + frequency_at_time(sample_index / sample_rate) / sample_rate) % 1;
  }
  return oscillator_samples;
}

function biquad_coefficients(filter_type, filter_frequency, quality_factor, gain_decibels, sample_rate) {
  const angular_frequency = (2 * Math.PI * filter_frequency) / sample_rate;
  const cosine_value = Math.cos(angular_frequency);
  const alpha_value = Math.sin(angular_frequency) / (2 * quality_factor);
  const shelf_amplitude = 10 ** (gain_decibels / 40);
  const coefficient_table = {
    lowpass: [(1 - cosine_value) / 2, 1 - cosine_value, (1 - cosine_value) / 2, 1 + alpha_value, -2 * cosine_value, 1 - alpha_value],
    highpass: [(1 + cosine_value) / 2, -(1 + cosine_value), (1 + cosine_value) / 2, 1 + alpha_value, -2 * cosine_value, 1 - alpha_value],
    bandpass: [alpha_value, 0, -alpha_value, 1 + alpha_value, -2 * cosine_value, 1 - alpha_value],
    peaking: [1 + alpha_value * shelf_amplitude, -2 * cosine_value, 1 - alpha_value * shelf_amplitude,
      1 + alpha_value / shelf_amplitude, -2 * cosine_value, 1 - alpha_value / shelf_amplitude],
  };
  const [feed_zero, feed_one, feed_two, back_zero, back_one, back_two] = coefficient_table[filter_type];
  return { feed_zero: feed_zero / back_zero, feed_one: feed_one / back_zero, feed_two: feed_two / back_zero,
    back_one: back_one / back_zero, back_two: back_two / back_zero };
}

const FILTER_TYPE_NAMES = Object.freeze(["lowpass", "highpass", "bandpass", "peaking"]);

/**
 * 二階濾波器（RBJ Audio EQ Cookbook 公式），截止頻率可以隨時間變化。bandpass 在中心頻率的增益是 0 dB。
 * @param {Float32Array} input_samples 輸入取樣（不會被修改）
 * @param {number} sample_rate 取樣率
 * @param {{filter_type: "lowpass" | "highpass" | "bandpass" | "peaking",
 *   frequency: number | ((elapsed_seconds: number) => number), quality_factor?: number, gain_decibels?: number}} filter_settings
 * @returns {Float32Array}
 */
export function apply_filter(input_samples, sample_rate, filter_settings) {
  const { filter_type, frequency, quality_factor = DEFAULT_QUALITY_FACTOR, gain_decibels = 0 } = filter_settings;
  if (!FILTER_TYPE_NAMES.includes(filter_type)) throw new RangeError(`沒有這種濾波器：${filter_type}`);
  require_positive_number(quality_factor, "quality_factor");
  const frequency_at_time = as_time_function(frequency);
  const maximum_frequency = sample_rate * MAXIMUM_FILTER_FREQUENCY_RATIO;
  const output_samples = new Float32Array(input_samples.length);
  let coefficients = null;
  let previous_input = 0;
  let older_input = 0;
  let previous_output = 0;
  let older_output = 0;
  for (let sample_index = 0; sample_index < input_samples.length; sample_index += 1) {
    if (sample_index % FILTER_UPDATE_INTERVAL_SAMPLES === 0) {
      const clamped_frequency = Math.min(maximum_frequency, Math.max(MINIMUM_FILTER_FREQUENCY, frequency_at_time(sample_index / sample_rate)));
      coefficients = biquad_coefficients(filter_type, clamped_frequency, quality_factor, gain_decibels, sample_rate);
    }
    const input_value = input_samples[sample_index];
    const output_value = coefficients.feed_zero * input_value + coefficients.feed_one * previous_input + coefficients.feed_two * older_input
      - coefficients.back_one * previous_output - coefficients.back_two * older_output;
    output_samples[sample_index] = output_value;
    older_input = previous_input;
    previous_input = input_value;
    older_output = previous_output;
    previous_output = output_value;
  }
  return output_samples;
}

/**
 * 依序套用多個濾波器。
 * @param {Float32Array} input_samples
 * @param {number} sample_rate
 * @param {readonly object[]} filter_chain 每個元素的格式同 apply_filter 的 filter_settings
 * @returns {Float32Array}
 */
export function apply_filter_chain(input_samples, sample_rate, filter_chain) {
  return filter_chain.reduce((chain_samples, filter_settings) => apply_filter(chain_samples, sample_rate, filter_settings), input_samples);
}

/**
 * 逐點乘上「經過秒數 → 倍率」的包絡，回傳新陣列。
 * @param {Float32Array} input_samples
 * @param {number} sample_rate
 * @param {(elapsed_seconds: number) => number} envelope_at_time
 * @returns {Float32Array}
 */
export function apply_envelope(input_samples, sample_rate, envelope_at_time) {
  return input_samples.map((sample_value, sample_index) => sample_value * envelope_at_time(sample_index / sample_rate));
}

/**
 * 把轉折點變成「秒數 → 數值」的函式，轉折之間用 smoothstep 平滑內插。
 * @param {readonly [number, number][]} time_value_pairs 依時間排序的 [秒數, 數值]
 * @returns {(elapsed_seconds: number) => number}
 */
export function smooth_curve(time_value_pairs) {
  if (time_value_pairs.length === 0) throw new RangeError("time_value_pairs 至少要有一個點");
  const timeline_points = time_value_pairs.map(([time_seconds, curve_value]) => ({ time_seconds, curve_value }));
  return (elapsed_seconds) => smooth_interpolate(timeline_points, elapsed_seconds, "curve_value");
}

/**
 * 敲擊類包絡：attack 秒內線性升到 1，之後依 decay 秒指數衰減（每 decay 秒剩 1/e）。
 * @param {number} attack_seconds 必須 >= 0
 * @param {number} decay_seconds 必須 > 0
 * @returns {(elapsed_seconds: number) => number}
 */
export function percussive_envelope(attack_seconds, decay_seconds) {
  if (!(attack_seconds >= 0)) throw new RangeError(`attack_seconds 必須 >= 0，收到 ${attack_seconds}`);
  require_positive_number(decay_seconds, "decay_seconds");
  return (elapsed_seconds) => {
    if (elapsed_seconds < 0) return 0;
    if (elapsed_seconds < attack_seconds) return elapsed_seconds / attack_seconds;
    return Math.exp(-(elapsed_seconds - attack_seconds) / decay_seconds);
  };
}

/**
 * 幾個不成整數比的慢速正弦相加，得到 0 到 1 之間、不規則但平滑的起伏（風、水流、人聲的強弱）。
 * @param {readonly number[]} component_frequencies 各成分的頻率（Hz）
 * @param {number} [phase_offset=0] 整體相位偏移，讓同一組頻率產生不同的起伏
 * @returns {(elapsed_seconds: number) => number}
 */
export function irregular_swell(component_frequencies, phase_offset = 0) {
  if (component_frequencies.length === 0) throw new RangeError("component_frequencies 至少要有一個頻率");
  return (elapsed_seconds) => {
    const sine_sum = component_frequencies.reduce((sum_value, component_frequency, component_index) =>
      sum_value + Math.sin(2 * Math.PI * component_frequency * elapsed_seconds + phase_offset * (component_index + 1)), 0);
    return 0.5 + sine_sum / (2 * component_frequencies.length);
  };
}

/**
 * 第 event_index 個事件在 0 到 1 之間的位置：黃金比例數列，平均散開但不規則，取代亂數。
 * @param {number} event_index 非負整數
 * @returns {number}
 */
export function golden_spread(event_index) {
  return (event_index * GOLDEN_RATIO_FRACTION) % 1;
}

/**
 * 把 source_samples 乘上 gain 後加進 target_samples 的 start_seconds 位置（就地修改 target_samples），超出範圍的部分捨棄。
 * @param {Float32Array} target_samples
 * @param {Float32Array} source_samples
 * @param {number} sample_rate
 * @param {number} start_seconds 可以是負數（前段被裁掉）
 * @param {number} [gain=1]
 * @returns {Float32Array} target_samples
 */
export function mix_into(target_samples, source_samples, sample_rate, start_seconds, gain = 1) {
  const start_index = Math.round(start_seconds * sample_rate);
  for (let source_index = Math.max(0, -start_index); source_index < source_samples.length; source_index += 1) {
    const target_index = start_index + source_index;
    if (target_index >= target_samples.length) break;
    target_samples[target_index] += gain * source_samples[source_index];
  }
  return target_samples;
}

/**
 * 敲擊共鳴（modal synthesis）：幾個各自指數衰減的正弦相加，鐘、金屬、木頭的聲音都靠不同的頻率比與衰減時間。
 * @param {number} sample_rate
 * @param {number} duration_seconds
 * @param {readonly {frequency: number, amplitude: number, decay_seconds: number}[]} resonance_modes
 * @returns {Float32Array}
 */
export function create_struck_resonance(sample_rate, duration_seconds, resonance_modes) {
  if (resonance_modes.length === 0) throw new RangeError("resonance_modes 至少要有一個");
  const resonance_samples = create_silent_samples(sample_rate, duration_seconds);
  const nyquist_frequency = sample_rate / 2;
  for (const resonance_mode of resonance_modes) {
    if (resonance_mode.frequency >= nyquist_frequency) continue;
    require_positive_number(resonance_mode.decay_seconds, "decay_seconds");
    for (let sample_index = 0; sample_index < resonance_samples.length; sample_index += 1) {
      const elapsed_seconds = sample_index / sample_rate;
      resonance_samples[sample_index] += resonance_mode.amplitude * Math.exp(-elapsed_seconds / resonance_mode.decay_seconds)
        * Math.sin(2 * Math.PI * resonance_mode.frequency * elapsed_seconds);
    }
  }
  return resonance_samples;
}

/**
 * 泛音聲帶來源（動物叫聲、人聲共用）：泛音依 1/k^spectral_tilt 遞減，tilt 越小聲音越粗、越沙啞；
 * 再加跟著聲帶開合起伏的氣音。音量包絡已套用，共鳴峰交給 apply_formants。
 * @param {number} sample_rate
 * @param {number} duration_seconds
 * @param {{pitch_at_time: (elapsed_seconds: number) => number, loudness_at_time: (elapsed_seconds: number) => number,
 *   spectral_tilt: number, breath_level: number, harmonic_count?: number}} voice_settings
 * @returns {Float32Array}
 */
export function create_voice_source(sample_rate, duration_seconds, voice_settings) {
  const { pitch_at_time, loudness_at_time, spectral_tilt, breath_level, harmonic_count = 30 } = voice_settings;
  const next_noise_value = create_noise_register();
  const voice_samples = create_silent_samples(sample_rate, duration_seconds);
  const nyquist_frequency = sample_rate / 2;
  let voice_phase = 0;
  for (let sample_index = 0; sample_index < voice_samples.length; sample_index += 1) {
    const elapsed_seconds = sample_index / sample_rate;
    const loudness = loudness_at_time(elapsed_seconds);
    const voice_frequency = pitch_at_time(elapsed_seconds);
    voice_phase = (voice_phase + voice_frequency / sample_rate) % 1;
    const noise_value = next_noise_value();
    if (loudness <= 0) continue;
    let harmonic_sum = 0;
    for (let harmonic_number = 1; harmonic_number <= harmonic_count && harmonic_number * voice_frequency < nyquist_frequency; harmonic_number += 1) {
      harmonic_sum += Math.sin(2 * Math.PI * harmonic_number * voice_phase) / harmonic_number ** spectral_tilt;
    }
    const breath_noise = breath_level * (0.5 + 0.5 * Math.cos(2 * Math.PI * voice_phase)) * noise_value;
    voice_samples[sample_index] = loudness * (harmonic_sum + breath_noise);
  }
  return voice_samples;
}

/**
 * 共鳴峰（formant）：聲源分別經過幾個 bandpass，再依各自的增益相加；頻率可以隨時間滑動（嘴型改變）。
 * @param {Float32Array} source_samples
 * @param {number} sample_rate
 * @param {readonly {frequency: number | ((elapsed_seconds: number) => number), quality_factor: number, relative_gain: number}[]} formant_list
 * @returns {Float32Array}
 */
export function apply_formants(source_samples, sample_rate, formant_list) {
  const formant_sum = new Float32Array(source_samples.length);
  for (const formant_settings of formant_list) {
    const formant_samples = apply_filter(source_samples, sample_rate,
      { filter_type: "bandpass", frequency: formant_settings.frequency, quality_factor: formant_settings.quality_factor });
    mix_into(formant_sum, formant_samples, sample_rate, 0, formant_settings.relative_gain);
  }
  return formant_sum;
}

/**
 * 收尾：頭尾各做一小段淡入淡出避免爆音，再把峰值正規化到 peak_level。全是 0 時原樣回傳。
 * @param {Float32Array} input_samples
 * @param {number} sample_rate
 * @param {number} [peak_level=0.8]
 * @returns {Float32Array}
 */
export function finish_samples(input_samples, sample_rate, peak_level = DEFAULT_PEAK_LEVEL) {
  const fade_samples = Math.min(Math.round(DEFAULT_EDGE_FADE_SECONDS * sample_rate), Math.floor(input_samples.length / 2));
  const faded_samples = input_samples.map((sample_value, sample_index) => {
    const distance_to_edge = Math.min(sample_index, input_samples.length - 1 - sample_index);
    return distance_to_edge < fade_samples ? sample_value * (distance_to_edge / fade_samples) : sample_value;
  });
  const peak_value = faded_samples.reduce((maximum_value, sample_value) => Math.max(maximum_value, Math.abs(sample_value)), 0);
  if (peak_value === 0) return faded_samples;
  return faded_samples.map((sample_value) => (sample_value / peak_value) * peak_level);
}
