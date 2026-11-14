/**
 * 音效的訊號與控制曲線（純計算，不碰 Web Audio）：引擎的點火脈衝、車輛經過時的距離／方位／都卜勒、貓叫的聲帶來源。
 * 自然的聲音靠三件事：寬頻雜訊（輪胎、排氣、氣音）、不完全規律（各汽缸力道不同、顫音不等速）、
 * 平滑的變化（音量依距離、音高依速度連續改變，不是直線斜坡）。全部是寫定的公式與 LFSR 雜訊，不用亂數。
 */
import { create_noise_register } from "./signal_generators.js";

const SPEED_OF_SOUND_METERS_PER_SECOND = 343;
const FOUR_STROKE_REVOLUTIONS_PER_FIRING = 2;
const ENGINE_CYLINDER_COUNT = 4;
/** setValueCurveAtTime 用的控制曲線密度（每秒幾個點）。 */
export const CONTROL_CURVE_POINTS_PER_SECOND = 200;

function require_positive_integer(parameter_value, parameter_name) {
  if (!Number.isInteger(parameter_value) || parameter_value <= 0) throw new RangeError(`${parameter_name} 必須是正整數，收到 ${parameter_value}`);
}

function clamp_value(input_value, minimum_value, maximum_value) {
  return Math.min(maximum_value, Math.max(minimum_value, input_value));
}

/**
 * 在時間軸的轉折點之間用 smoothstep 內插：每段起訖的變化率為零，聽起來是「滑過去」而不是折線。
 * @param {readonly {time_seconds: number}[]} timeline_points 依時間排序的轉折點
 * @param {number} time_seconds 查詢時間；超出範圍時取最近一端的值
 * @param {string} value_name 要內插的欄位名稱
 * @returns {number}
 */
export function smooth_interpolate(timeline_points, time_seconds, value_name) {
  if (timeline_points.length === 0) throw new RangeError("timeline_points 至少要有一個點");
  if (time_seconds <= timeline_points[0].time_seconds) return timeline_points[0][value_name];
  for (let point_index = 1; point_index < timeline_points.length; point_index += 1) {
    const next_point = timeline_points[point_index];
    if (time_seconds <= next_point.time_seconds) {
      const previous_point = timeline_points[point_index - 1];
      const linear_progress = (time_seconds - previous_point.time_seconds) / (next_point.time_seconds - previous_point.time_seconds);
      const smooth_progress = linear_progress * linear_progress * (3 - 2 * linear_progress);
      return previous_point[value_name] + (next_point[value_name] - previous_point[value_name]) * smooth_progress;
    }
  }
  return timeline_points[timeline_points.length - 1][value_name];
}

/**
 * 把「時間 → 數值」的函式取樣成控制曲線，給 AudioParam.setValueCurveAtTime 用；頭尾兩點都包含在內。
 * @param {number} duration_seconds 曲線長度（秒），必須 > 0
 * @param {(elapsed_seconds: number) => number} value_at_time
 * @returns {Float32Array}
 */
export function sample_control_curve(duration_seconds, value_at_time) {
  if (!(duration_seconds > 0)) throw new RangeError(`duration_seconds 必須 > 0，收到 ${duration_seconds}`);
  const point_count = Math.max(2, Math.ceil(duration_seconds * CONTROL_CURVE_POINTS_PER_SECOND) + 1);
  return Float32Array.from({ length: point_count }, (_, point_index) => value_at_time((point_index / (point_count - 1)) * duration_seconds));
}

// ── 引擎 ─────────────────────────────────────────────

/**
 * 引擎時間軸：rpm 是轉速，throttle 是油門開度（0 到 1）。
 * 怠速 → 一檔催油 → 收油換檔、轉速掉 → 二檔再催 → 收油滑回怠速。
 */
export const ENGINE_RPM_POINTS = Object.freeze([
  { time_seconds: 0, rpm: 800, throttle: 0.15 },
  { time_seconds: 1.5, rpm: 820, throttle: 0.15 },
  { time_seconds: 1.8, rpm: 1100, throttle: 0.9 },
  { time_seconds: 3.4, rpm: 4200, throttle: 1 },
  { time_seconds: 3.65, rpm: 3300, throttle: 0.05 },
  { time_seconds: 3.95, rpm: 2600, throttle: 0.6 },
  { time_seconds: 5.5, rpm: 5000, throttle: 1 },
  { time_seconds: 5.75, rpm: 4300, throttle: 0 },
  { time_seconds: 7.2, rpm: 950, throttle: 0 },
  { time_seconds: 8, rpm: 800, throttle: 0.15 },
].map((rpm_point) => Object.freeze(rpm_point)));

// 四個汽缸的燃燒力道不完全一樣，這個固定的差異讓排氣聲有「噗噗噗」的起伏，而不是蜂鳴器般的純音
const CYLINDER_PULSE_BALANCE = Object.freeze([1, 0.82, 0.94, 0.76]);
// 每次點火的時間點前後偏移最多 4%（燃燒速度本來就不會每次一樣）
const FIRING_TIMING_WOBBLE = 0.04;
// 每個排氣脈衝的衰減時間 = 點火週期 × 這個比例，但不超過上限
const PULSE_DECAY_PERIOD_FRACTION = 0.3;
const MAXIMUM_PULSE_DECAY_SECONDS = 0.006;
// 沒踩油門時燃燒仍在，只是比較弱
const IDLE_PULSE_FLOOR = 0.35;
const PULSE_NOISE_DEPTH = 0.35;
const MECHANICAL_NOISE_LEVEL = 0.05;
const MECHANICAL_NOISE_REFERENCE_RPM = 6000;
const ENGINE_BRIGHTNESS_BASE_FREQUENCY = 250;

/**
 * 四行程引擎的點火頻率：每轉兩圈每個汽缸點火一次。
 * @param {number} rpm 每分鐘轉速，必須 > 0
 * @param {number} [cylinder_count] 汽缸數，預設 4
 * @returns {number} 點火頻率（Hz）
 */
export function rpm_to_firing_frequency(rpm, cylinder_count = ENGINE_CYLINDER_COUNT) {
  if (!(rpm > 0)) throw new RangeError(`rpm 必須 > 0，收到 ${rpm}`);
  return (rpm / 60) * (cylinder_count / FOUR_STROKE_REVOLUTIONS_PER_FIRING);
}

/**
 * 引擎聲的亮度（低通濾波的截止頻率）：轉速越高、油門越深，高頻越多。
 * @param {number} rpm
 * @param {number} throttle 0 到 1
 * @returns {number} Hz
 */
export function engine_brightness_frequency(rpm, throttle) {
  return ENGINE_BRIGHTNESS_BASE_FREQUENCY + rpm_to_firing_frequency(rpm) * (4 + 8 * clamp_value(throttle, 0, 1));
}

/**
 * 引擎的激發訊號：每次點火產生一個帶雜訊、快速衰減的排氣脈衝，再加一點跟著轉速變大的機械雜音。
 * 之後由 Web Audio 的濾波器加上排氣管共鳴。
 * @param {number} sample_rate 取樣率，必須是正整數
 * @param {readonly {time_seconds: number, rpm: number, throttle: number}[]} [rpm_points] 預設 ENGINE_RPM_POINTS
 * @returns {Float32Array} 長度為整條時間軸的取樣
 */
export function generate_engine_pulse_samples(sample_rate, rpm_points = ENGINE_RPM_POINTS) {
  require_positive_integer(sample_rate, "sample_rate");
  const next_noise_value = create_noise_register();
  const engine_samples = new Float32Array(Math.ceil(sample_rate * rpm_points[rpm_points.length - 1].time_seconds));
  let firing_phase = 0;
  let firing_threshold = 1;
  let firing_count = 0;
  let pulse_amplitude = 0;
  let pulse_decay_seconds = MAXIMUM_PULSE_DECAY_SECONDS;
  let pulse_age_seconds = 0;
  for (let sample_index = 0; sample_index < engine_samples.length; sample_index += 1) {
    const elapsed_seconds = sample_index / sample_rate;
    const rpm = smooth_interpolate(rpm_points, elapsed_seconds, "rpm");
    const throttle = smooth_interpolate(rpm_points, elapsed_seconds, "throttle");
    const firing_frequency = rpm_to_firing_frequency(rpm);
    firing_phase += firing_frequency / sample_rate;
    if (firing_phase >= firing_threshold) {
      firing_phase -= firing_threshold;
      firing_threshold = 1 + FIRING_TIMING_WOBBLE * next_noise_value();
      pulse_amplitude = CYLINDER_PULSE_BALANCE[firing_count % CYLINDER_PULSE_BALANCE.length] * (IDLE_PULSE_FLOOR + (1 - IDLE_PULSE_FLOOR) * throttle);
      pulse_decay_seconds = Math.min(MAXIMUM_PULSE_DECAY_SECONDS, PULSE_DECAY_PERIOD_FRACTION / firing_frequency);
      pulse_age_seconds = 0;
      firing_count += 1;
    }
    const pulse_value = pulse_amplitude * Math.exp(-pulse_age_seconds / pulse_decay_seconds);
    const mechanical_noise = MECHANICAL_NOISE_LEVEL * (rpm / MECHANICAL_NOISE_REFERENCE_RPM) * next_noise_value();
    engine_samples[sample_index] = pulse_value * (1 - PULSE_NOISE_DEPTH + PULSE_NOISE_DEPTH * next_noise_value()) + mechanical_noise;
    pulse_age_seconds += 1 / sample_rate;
  }
  return engine_samples;
}

// ── 車流 ─────────────────────────────────────────────

export const TRAFFIC_SCENE_SECONDS = 30;
// 超過這個距離就聽不到；音量以 REFERENCE_DISTANCE_METERS 為 1，依 1/距離 衰減
const AUDIBLE_RANGE_METERS = 80;
const REFERENCE_DISTANCE_METERS = 3.5;
// 在可聽範圍最外側這一段淡入淡出，避免突然出現
const EDGE_FADE_FRACTION = 0.25;
const MAXIMUM_PAN = 0.9;
// 空氣會吸收高頻：越遠越悶
const AIR_BRIGHTNESS_NEAR_FREQUENCY = 14000;
const AIR_BRIGHTNESS_HALF_DISTANCE_METERS = 8;
const AIR_BRIGHTNESS_MINIMUM_FREQUENCY = 600;
const AMBIENCE_BASE_LEVEL = 1;
const AMBIENCE_FADE_SECONDS = 1.5;

/**
 * 車流場景中每台車：closest_seconds 是最接近聽者的時間，lane_offset_meters 是車道離聽者多遠，
 * direction 為 1（左到右）或 -1（右到左），engine_frequency 是巡航時引擎的基頻。
 * 近車道（3.5 公尺）往右、遠車道（7.5 公尺）往左。
 */
export const TRAFFIC_PASSES = Object.freeze([
  { closest_seconds: 6, speed_meters_per_second: 13.9, lane_offset_meters: 3.5, direction: 1, engine_frequency: 42 },
  { closest_seconds: 9.5, speed_meters_per_second: 16.7, lane_offset_meters: 7.5, direction: -1, engine_frequency: 55 },
  { closest_seconds: 12.2, speed_meters_per_second: 12.5, lane_offset_meters: 3.5, direction: 1, engine_frequency: 38 },
  { closest_seconds: 15, speed_meters_per_second: 19.4, lane_offset_meters: 7.5, direction: -1, engine_frequency: 61 },
  { closest_seconds: 18.3, speed_meters_per_second: 15.3, lane_offset_meters: 3.5, direction: 1, engine_frequency: 47 },
  { closest_seconds: 21, speed_meters_per_second: 11.1, lane_offset_meters: 3.5, direction: 1, engine_frequency: 70 },
  { closest_seconds: 23.6, speed_meters_per_second: 17.5, lane_offset_meters: 7.5, direction: -1, engine_frequency: 52 },
  { closest_seconds: 24, speed_meters_per_second: 13.9, lane_offset_meters: 3.5, direction: 1, engine_frequency: 44 },
].map((traffic_pass) => Object.freeze(traffic_pass)));

/**
 * 一台車聽得到的時間範圍：從進入可聽距離到離開。
 * @returns {{start_seconds: number, end_seconds: number}}
 */
export function car_pass_window(traffic_pass) {
  const half_window_seconds = AUDIBLE_RANGE_METERS / traffic_pass.speed_meters_per_second;
  return { start_seconds: traffic_pass.closest_seconds - half_window_seconds, end_seconds: traffic_pass.closest_seconds + half_window_seconds };
}

/**
 * 某時間點一台車相對聽者的狀態。音量依 1/距離；左右位置依方位角；
 * 音高倍率依「距離變化的速度」連續計算（都卜勒），靠近時 > 1、遠離時 < 1，在最近點剛好等於 1。
 * @param {{closest_seconds: number, speed_meters_per_second: number, lane_offset_meters: number, direction: number}} traffic_pass
 * @param {number} time_seconds 場景時間
 * @returns {{distance_meters: number, gain: number, pan: number, pitch_ratio: number, brightness_frequency: number}}
 */
export function car_pass_state(traffic_pass, time_seconds) {
  const { closest_seconds, speed_meters_per_second, lane_offset_meters, direction } = traffic_pass;
  if (!(speed_meters_per_second > 0 && speed_meters_per_second < SPEED_OF_SOUND_METERS_PER_SECOND)) {
    throw new RangeError(`speed_meters_per_second 必須介於 0 與 ${SPEED_OF_SOUND_METERS_PER_SECOND} 之間，收到 ${speed_meters_per_second}`);
  }
  const offset_seconds = time_seconds - closest_seconds;
  const along_road_meters = direction * speed_meters_per_second * offset_seconds;
  const distance_meters = Math.hypot(along_road_meters, lane_offset_meters);
  const edge_fade = clamp_value((AUDIBLE_RANGE_METERS - Math.abs(along_road_meters)) / (EDGE_FADE_FRACTION * AUDIBLE_RANGE_METERS), 0, 1);
  const receding_speed = (speed_meters_per_second * speed_meters_per_second * offset_seconds) / distance_meters;
  return {
    distance_meters,
    gain: (REFERENCE_DISTANCE_METERS / Math.max(distance_meters, REFERENCE_DISTANCE_METERS)) * edge_fade * edge_fade,
    pan: MAXIMUM_PAN * (along_road_meters / distance_meters),
    pitch_ratio: SPEED_OF_SOUND_METERS_PER_SECOND / (SPEED_OF_SOUND_METERS_PER_SECOND + receding_speed),
    brightness_frequency: clamp_value(
      AIR_BRIGHTNESS_NEAR_FREQUENCY / (1 + distance_meters / AIR_BRIGHTNESS_HALF_DISTANCE_METERS), AIR_BRIGHTNESS_MINIMUM_FREQUENCY, AIR_BRIGHTNESS_NEAR_FREQUENCY),
  };
}

/**
 * 遠方車流的背景音量：兩個不同週期的緩慢起伏疊在一起，頭尾淡入淡出。
 * @param {number} time_seconds 場景時間
 * @returns {number} 0 到約 1.5
 */
export function traffic_ambience_level(time_seconds) {
  const swell = 1 + 0.3 * Math.sin((2 * Math.PI * time_seconds) / 11) + 0.2 * Math.sin((2 * Math.PI * time_seconds) / 4.3 + 1);
  const fade = clamp_value(Math.min(time_seconds, TRAFFIC_SCENE_SECONDS - time_seconds) / AMBIENCE_FADE_SECONDS, 0, 1);
  return AMBIENCE_BASE_LEVEL * swell * fade;
}

// ── 貓叫 ─────────────────────────────────────────────

export const MEOW_SECONDS = 1.05;
/** 音高：從低處滑上去、停一下，再慢慢落下（「喵——嗚」）。 */
export const MEOW_PITCH_POINTS = Object.freeze([
  { time_seconds: 0, frequency: 430 },
  { time_seconds: 0.18, frequency: 760 },
  { time_seconds: 0.45, frequency: 700 },
  { time_seconds: 0.8, frequency: 560 },
  { time_seconds: MEOW_SECONDS, frequency: 420 },
]);
/** 音量：嘴巴閉著的「m」很小聲，張開後最大，收尾漸弱。 */
export const MEOW_LOUDNESS_POINTS = Object.freeze([
  { time_seconds: 0, loudness: 0 },
  { time_seconds: 0.08, loudness: 0.4 },
  { time_seconds: 0.25, loudness: 1 },
  { time_seconds: 0.75, loudness: 0.75 },
  { time_seconds: MEOW_SECONDS, loudness: 0 },
]);
/** 嘴巴張開的程度：0 是閉著（只剩鼻音），1 是全開；決定低通濾波的截止頻率。 */
export const MEOW_MOUTH_POINTS = Object.freeze([
  { time_seconds: 0, opening: 0 },
  { time_seconds: 0.12, opening: 0.25 },
  { time_seconds: 0.3, opening: 1 },
  { time_seconds: 0.7, opening: 0.8 },
  { time_seconds: MEOW_SECONDS, opening: 0.15 },
]);
/** 三個共鳴峰（formant）從「i」經「a」滑到「u」；貓的聲道比人短，所以頻率比人聲高。 */
export const MEOW_FORMANT_PATHS = Object.freeze([
  { relative_gain: 1, frequency_points: [{ time_seconds: 0, frequency: 500 }, { time_seconds: 0.3, frequency: 1000 }, { time_seconds: MEOW_SECONDS, frequency: 600 }] },
  { relative_gain: 0.6, frequency_points: [{ time_seconds: 0, frequency: 2400 }, { time_seconds: 0.3, frequency: 1900 }, { time_seconds: MEOW_SECONDS, frequency: 1300 }] },
  { relative_gain: 0.3, frequency_points: [{ time_seconds: 0, frequency: 3800 }, { time_seconds: 0.3, frequency: 3400 }, { time_seconds: MEOW_SECONDS, frequency: 3000 }] },
]);
const MOUTH_CLOSED_FREQUENCY = 900;
const MOUTH_OPEN_EXTRA_FREQUENCY = 5000;
const VOICE_HARMONIC_COUNT = 24;
// 泛音每高一階衰減的冪次：聲帶振動的頻譜大約每八度掉 8 dB
const VOICE_SPECTRAL_TILT = 1.4;
// 兩個不成整數比的慢速顫音疊加，避免機器般的等速顫抖
const VIBRATO_COMPONENTS = Object.freeze([
  { hertz: 5.3, depth: 0.012, phase: 0 },
  { hertz: 7.9, depth: 0.007, phase: 1.3 },
]);
const BREATH_NOISE_LEVEL = 0.12;
const VOICE_PEAK_NORMALIZATION = 0.6;

/**
 * 嘴巴張開程度對應的低通截止頻率。
 * @param {number} mouth_opening 0 到 1
 * @returns {number} Hz
 */
export function mouth_opening_to_frequency(mouth_opening) {
  return MOUTH_CLOSED_FREQUENCY + MOUTH_OPEN_EXTRA_FREQUENCY * clamp_value(mouth_opening, 0, 1);
}

/**
 * 貓叫的聲帶來源：泛音依 1/k^1.4 遞減的週期波（像聲帶一開一合的氣流），
 * 音高帶有不等速的顫音，再加一點跟著聲帶開合起伏的氣音；音量包絡已經套好。
 * 共鳴峰與嘴型由 Web Audio 的濾波器處理。
 * @param {number} sample_rate 取樣率，必須是正整數
 * @returns {Float32Array} 長度為 MEOW_SECONDS 的取樣
 */
export function generate_meow_source_samples(sample_rate) {
  require_positive_integer(sample_rate, "sample_rate");
  const next_noise_value = create_noise_register();
  const voice_samples = new Float32Array(Math.ceil(sample_rate * MEOW_SECONDS));
  const nyquist_frequency = sample_rate / 2;
  let voice_phase = 0;
  for (let sample_index = 0; sample_index < voice_samples.length; sample_index += 1) {
    const elapsed_seconds = sample_index / sample_rate;
    const vibrato_ratio = VIBRATO_COMPONENTS.reduce(
      (ratio_sum, vibrato_component) => ratio_sum + vibrato_component.depth * Math.sin(2 * Math.PI * vibrato_component.hertz * elapsed_seconds + vibrato_component.phase), 1);
    const voice_frequency = smooth_interpolate(MEOW_PITCH_POINTS, elapsed_seconds, "frequency") * vibrato_ratio;
    voice_phase = (voice_phase + voice_frequency / sample_rate) % 1;
    let harmonic_sum = 0;
    for (let harmonic_number = 1; harmonic_number <= VOICE_HARMONIC_COUNT && harmonic_number * voice_frequency < nyquist_frequency; harmonic_number += 1) {
      harmonic_sum += Math.sin(2 * Math.PI * harmonic_number * voice_phase) / harmonic_number ** VOICE_SPECTRAL_TILT;
    }
    const breath_noise = BREATH_NOISE_LEVEL * (0.5 + 0.5 * Math.cos(2 * Math.PI * voice_phase)) * next_noise_value();
    const loudness = smooth_interpolate(MEOW_LOUDNESS_POINTS, elapsed_seconds, "loudness");
    voice_samples[sample_index] = VOICE_PEAK_NORMALIZATION * loudness * (harmonic_sum + breath_noise);
  }
  return voice_samples;
}
