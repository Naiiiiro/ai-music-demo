/**
 * 場景音效配方（純計算）：水聲、機械運轉、鐘聲與號誌。每個函式吃取樣率，回傳一段已正規化的單聲道取樣。
 * 只用 synthesis_primitives 的元件與寫定的參數，不用亂數。
 */
import {
  apply_envelope,
  apply_filter,
  apply_filter_chain,
  create_noise_samples,
  create_oscillator_samples,
  create_silent_samples,
  create_struck_resonance,
  finish_samples,
  golden_spread,
  irregular_swell,
  mix_into,
  percussive_envelope,
  smooth_curve,
} from "./synthesis_primitives.js";

const AMBIENT_SECONDS = 8;

/** 短促的濾波雜訊爆裂：腳步、水滴、喀聲都用得到。 */
function noise_burst(sample_rate, burst_settings) {
  const { duration_seconds, attack_seconds, decay_seconds, filter_chain, skip_values = 0 } = burst_settings;
  const raw_noise = create_noise_samples(sample_rate, duration_seconds, skip_values);
  return apply_envelope(apply_filter_chain(raw_noise, sample_rate, filter_chain), sample_rate, percussive_envelope(attack_seconds, decay_seconds));
}

/** 水泡：頻率快速上滑的正弦，泡泡破掉時的「啵」。 */
function bubble_blip(sample_rate, start_frequency, blip_seconds) {
  const rising_pitch = (elapsed_seconds) => start_frequency * (1 + 2.5 * elapsed_seconds / blip_seconds);
  return apply_envelope(create_oscillator_samples(sample_rate, blip_seconds, rising_pitch), sample_rate, percussive_envelope(0.002, blip_seconds / 4));
}

function scatter_events(event_count, duration_seconds, render_event_at, target_samples, sample_rate) {
  for (let event_index = 0; event_index < event_count; event_index += 1) {
    const { event_samples, gain } = render_event_at(event_index);
    mix_into(target_samples, event_samples, sample_rate, golden_spread(event_index) * duration_seconds, gain);
  }
  return target_samples;
}

// ── 水聲 ─────────────────────────────────────────────

/** 渠道流水：中低頻寬頻雜訊緩慢起伏，加上零星的水泡聲。 */
export function render_flowing_water(sample_rate) {
  const water_bed = apply_filter_chain(create_noise_samples(sample_rate, AMBIENT_SECONDS), sample_rate, [
    { filter_type: "lowpass", frequency: 1800 }, { filter_type: "peaking", frequency: 450, quality_factor: 0.8, gain_decibels: 8 }]);
  const water_samples = apply_envelope(water_bed, sample_rate, (elapsed_seconds) => 0.6 + 0.4 * irregular_swell([0.31, 0.53, 0.87])(elapsed_seconds));
  scatter_events(70, AMBIENT_SECONDS, (event_index) => ({
    event_samples: bubble_blip(sample_rate, 380 + 500 * golden_spread(event_index + 7), 0.04), gain: 0.25 + 0.2 * golden_spread(event_index + 3),
  }), water_samples, sample_rate);
  return finish_samples(water_samples, sample_rate);
}

/** 尾水池出水翻騰：比流水更亮、更激烈，低頻有翻滾的轟聲。 */
export function render_tailrace_splash(sample_rate) {
  const splash_layer = apply_filter_chain(create_noise_samples(sample_rate, AMBIENT_SECONDS, 1000), sample_rate, [
    { filter_type: "highpass", frequency: 300 }, { filter_type: "lowpass", frequency: 6500 }]);
  const churning_splash = apply_envelope(splash_layer, sample_rate, (elapsed_seconds) => 0.4 + 0.6 * irregular_swell([1.7, 2.9, 4.3])(elapsed_seconds) ** 2);
  const rumble_layer = apply_filter(create_noise_samples(sample_rate, AMBIENT_SECONDS, 3000), sample_rate, { filter_type: "lowpass", frequency: 140 });
  const splash_samples = mix_into(churning_splash, rumble_layer, sample_rate, 0, 2.5);
  return finish_samples(splash_samples, sample_rate);
}

/** 海浪：每 6 秒一輪，浪湧起（低沉）→ 拍岸（明亮）→ 退去（沙沙聲逐漸變小）。 */
export function render_sea_waves(sample_rate) {
  const wave_seconds = 12;
  const wave_period_seconds = 6;
  const wave_progress = (elapsed_seconds) => (elapsed_seconds % wave_period_seconds) / wave_period_seconds;
  const wave_loudness = smooth_curve([[0, 0.25], [0.4, 0.7], [0.5, 1], [0.75, 0.45], [1, 0.25]]);
  const wave_brightness = smooth_curve([[0, 400], [0.4, 900], [0.5, 3500], [0.8, 1600], [1, 400]]);
  const surf_noise = apply_filter(create_noise_samples(sample_rate, wave_seconds), sample_rate,
    { filter_type: "lowpass", frequency: (elapsed_seconds) => wave_brightness(wave_progress(elapsed_seconds)) });
  const wave_samples = apply_envelope(surf_noise, sample_rate, (elapsed_seconds) => wave_loudness(wave_progress(elapsed_seconds)));
  const deep_swell = apply_filter(create_noise_samples(sample_rate, wave_seconds, 5000), sample_rate, { filter_type: "lowpass", frequency: 120 });
  return finish_samples(mix_into(wave_samples, deep_swell, sample_rate, 0, 1.5), sample_rate);
}

/** 噴水池：持續的高頻落水聲，加密集的水滴。 */
export function render_fountain_water(sample_rate) {
  const falling_water = apply_filter(create_noise_samples(sample_rate, AMBIENT_SECONDS, 700), sample_rate,
    { filter_type: "bandpass", frequency: 2800, quality_factor: 0.5 });
  const fountain_samples = apply_envelope(falling_water, sample_rate, (elapsed_seconds) => 0.8 + 0.2 * irregular_swell([0.7, 1.3])(elapsed_seconds));
  scatter_events(260, AMBIENT_SECONDS, (event_index) => ({
    event_samples: bubble_blip(sample_rate, 900 + 1800 * golden_spread(event_index + 11), 0.025), gain: 0.15 + 0.15 * golden_spread(event_index + 5),
  }), fountain_samples, sample_rate);
  return finish_samples(fountain_samples, sample_rate);
}

/** 阿基米德螺旋攪水：低頻轉動的轟聲，水聲隨葉片每 0.8 秒掃過一次而起伏。 */
export function render_screw_water_churn(sample_rate) {
  const blade_pass_hertz = 1.25;
  const sloshing_water = apply_filter(create_noise_samples(sample_rate, AMBIENT_SECONDS, 200), sample_rate,
    { filter_type: "bandpass", frequency: (elapsed_seconds) => 320 + 120 * Math.sin(2 * Math.PI * blade_pass_hertz * elapsed_seconds), quality_factor: 1.2 });
  const churn_samples = apply_envelope(sloshing_water, sample_rate,
    (elapsed_seconds) => 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(2 * Math.PI * blade_pass_hertz * elapsed_seconds)) ** 2);
  const rotation_rumble = apply_filter(create_oscillator_samples(sample_rate, AMBIENT_SECONDS, 38, "sawtooth"), sample_rate, { filter_type: "lowpass", frequency: 120 });
  return finish_samples(mix_into(churn_samples, rotation_rumble, sample_rate, 0, 0.35), sample_rate);
}

// ── 機械 ─────────────────────────────────────────────

const METAL_MODE_RATIOS = Object.freeze([1, 2.76, 5.4, 8.93]);

function metal_hit(sample_rate, base_frequency, decay_seconds) {
  return create_struck_resonance(sample_rate, decay_seconds * 4, METAL_MODE_RATIOS.map((mode_ratio, mode_index) => ({
    frequency: base_frequency * mode_ratio, amplitude: 1 / (mode_index + 1), decay_seconds: decay_seconds / (1 + mode_index * 0.6) })));
}

// 實錄（車床空轉）的特徵：低頻交流嗡鳴、2.1–3 kHz 一簇齒輪咬合音、2–8 kHz 的軸承與風扇嘶聲，
// 整體約每秒 2.8 次輕微起伏。嗡鳴照台灣電網用 60 Hz（鐵芯每週期伸縮兩次，所以 120 Hz 也很強）
const DRIVETRAIN_HUM_TONES = Object.freeze([{ frequency: 60, gain: 0.22 }, { frequency: 120, gain: 0.3 }, { frequency: 180, gain: 0.08 }, { frequency: 350, gain: 0.12 }]);
const DRIVETRAIN_GEAR_MESH_TONES = Object.freeze([
  { frequency: 2880, gain: 0.3 }, { frequency: 2770, gain: 0.17 }, { frequency: 2980, gain: 0.15 },
  { frequency: 2290, gain: 0.15 }, { frequency: 2130, gain: 0.13 },
]);
const DRIVETRAIN_WOBBLE_HERTZ = 2.8;

/** 傳動與發電：發電機與變壓器的交流嗡鳴墊底，增速齒輪箱的咬合嘯音與軸承嘶聲浮在上面，穩定運轉。 */
export function render_drivetrain_generator_hum(sample_rate) {
  const drivetrain_seconds = 8;
  const drivetrain_samples = create_silent_samples(sample_rate, drivetrain_seconds);
  for (const hum_tone of DRIVETRAIN_HUM_TONES) {
    mix_into(drivetrain_samples, create_oscillator_samples(sample_rate, drivetrain_seconds, hum_tone.frequency), sample_rate, 0, hum_tone.gain);
  }
  const gear_samples = create_silent_samples(sample_rate, drivetrain_seconds);
  for (const mesh_tone of DRIVETRAIN_GEAR_MESH_TONES) {
    mix_into(gear_samples, create_oscillator_samples(sample_rate, drivetrain_seconds, mesh_tone.frequency), sample_rate, 0, mesh_tone.gain);
  }
  const bearing_hiss = apply_filter_chain(create_noise_samples(sample_rate, drivetrain_seconds, 4300), sample_rate, [
    { filter_type: "highpass", frequency: 1600 }, { filter_type: "peaking", frequency: 4000, quality_factor: 0.6, gain_decibels: 6 }, { filter_type: "lowpass", frequency: 11000 }]);
  mix_into(gear_samples, bearing_hiss, sample_rate, 0, 0.9);
  const housing_rumble = apply_filter_chain(create_noise_samples(sample_rate, drivetrain_seconds, 7300), sample_rate, [
    { filter_type: "lowpass", frequency: 700 }, { filter_type: "highpass", frequency: 50 }]);
  mix_into(drivetrain_samples, housing_rumble, sample_rate, 0, 0.35);
  const wobbling_gears = apply_envelope(gear_samples, sample_rate, (elapsed_seconds) => 0.85 + 0.15 * Math.sin(2 * Math.PI * DRIVETRAIN_WOBBLE_HERTZ * elapsed_seconds));
  mix_into(drivetrain_samples, wobbling_gears, sample_rate, 0, 1.6);
  return finish_samples(drivetrain_samples, sample_rate);
}

function motor_whine(sample_rate, duration_seconds, frequency_curve) {
  return apply_filter(create_oscillator_samples(sample_rate, duration_seconds, frequency_curve, "sawtooth"), sample_rate, { filter_type: "lowpass", frequency: 900 });
}

/** 閘門升降：馬達啟動、鏈條規律喀喀聲、閘門打開後水流漸大，最後停住的「咚」。 */
export function render_sluice_gate_motor(sample_rate) {
  const gate_seconds = 8;
  const motor_speed = smooth_curve([[0, 0], [0.6, 1], [6.4, 1], [7, 0]]);
  const gate_samples = apply_envelope(motor_whine(sample_rate, gate_seconds, (elapsed_seconds) => 40 + 70 * motor_speed(elapsed_seconds)), sample_rate, motor_speed);
  const chain_click = { duration_seconds: 0.03, attack_seconds: 0.001, decay_seconds: 0.006, filter_chain: [{ filter_type: "bandpass", frequency: 3200, quality_factor: 2 }] };
  for (let click_seconds = 0.7; click_seconds < 6.4; click_seconds += 0.17) mix_into(gate_samples, noise_burst(sample_rate, chain_click), sample_rate, click_seconds, 0.5);
  const rising_flow = apply_envelope(apply_filter(create_noise_samples(sample_rate, gate_seconds, 2000), sample_rate, { filter_type: "lowpass", frequency: 1200 }),
    sample_rate, smooth_curve([[0, 0], [1, 0], [6.5, 0.9], [gate_seconds, 0.9]]));
  mix_into(gate_samples, rising_flow, sample_rate, 0, 0.8);
  mix_into(gate_samples, metal_hit(sample_rate, 95, 0.4), sample_rate, 6.9, 0.9);
  return finish_samples(gate_samples, sample_rate);
}

/** 攔污機：馬達運轉，耙齒刮過攔污柵的刮擦聲每 4 秒一輪，撈起後雜物掉進槽裡的「咚」。 */
export function render_trash_rake(sample_rate) {
  const rake_samples = apply_envelope(motor_whine(sample_rate, AMBIENT_SECONDS, 85), sample_rate, () => 0.35);
  const scrape_noise = apply_filter(create_noise_samples(sample_rate, AMBIENT_SECONDS, 1500), sample_rate, { filter_type: "bandpass", frequency: 2100, quality_factor: 1.5 });
  const scrape_cycle = (elapsed_seconds) => {
    const cycle_seconds = elapsed_seconds % 4;
    return cycle_seconds < 2.5 ? (0.5 + 0.5 * Math.sin(2 * Math.PI * 9 * elapsed_seconds)) * Math.sin((Math.PI * cycle_seconds) / 2.5) : 0;
  };
  mix_into(rake_samples, apply_envelope(scrape_noise, sample_rate, scrape_cycle), sample_rate, 0, 0.8);
  for (const thud_seconds of [2.8, 6.8]) {
    mix_into(rake_samples, noise_burst(sample_rate, { duration_seconds: 0.4, attack_seconds: 0.003, decay_seconds: 0.08, filter_chain: [{ filter_type: "lowpass", frequency: 260 }] }), sample_rate, thud_seconds, 2);
  }
  return finish_samples(rake_samples, sample_rate);
}

function beep_tone(sample_rate, beep_frequency, beep_seconds) {
  return apply_envelope(create_oscillator_samples(sample_rate, beep_seconds, beep_frequency, "square"), sample_rate,
    (elapsed_seconds) => Math.min(1, elapsed_seconds / 0.005, (beep_seconds - elapsed_seconds) / 0.005));
}

// 實錄（電動門開啟）的頻譜：兩條齒輪嘯音 530、649 Hz，機構噪音集中在 500 Hz–2 kHz，
// 每秒約 4.7 次的機械顫動；開頭有幾下繼電器與門閂的喀聲
const BARRIER_GEAR_TONES = Object.freeze([{ frequency: 649, gain: 1 }, { frequency: 530, gain: 0.55 }]);
const BARRIER_RATTLE_HERTZ = 4.7;

/** 柵欄與升降機：繼電器喀聲後馬達起動，齒輪嘯音加機構噪音持續運轉並帶顫動，最後停住的「咚」。 */
export function render_barrier_motor(sample_rate) {
  const barrier_seconds = 9;
  const motor_level = smooth_curve([[0, 0], [0.4, 0], [1.2, 1], [7.6, 1], [8.1, 0]]);
  const motor_samples = create_silent_samples(sample_rate, barrier_seconds);
  for (const gear_tone of BARRIER_GEAR_TONES) {
    const wavering_pitch = (elapsed_seconds) => gear_tone.frequency * (0.97 + 0.03 * motor_level(elapsed_seconds) + 0.004 * Math.sin(2 * Math.PI * 0.6 * elapsed_seconds));
    mix_into(motor_samples, create_oscillator_samples(sample_rate, barrier_seconds, wavering_pitch, "triangle"), sample_rate, 0, gear_tone.gain * 0.35);
  }
  const mechanism_noise = apply_filter_chain(create_noise_samples(sample_rate, barrier_seconds, 2200), sample_rate, [
    { filter_type: "bandpass", frequency: 1000, quality_factor: 0.5 }, { filter_type: "lowpass", frequency: 2200 }]);
  mix_into(motor_samples, mechanism_noise, sample_rate, 0, 2.2);
  const low_rumble = apply_filter(create_noise_samples(sample_rate, barrier_seconds, 5100), sample_rate, { filter_type: "lowpass", frequency: 260 });
  mix_into(motor_samples, low_rumble, sample_rate, 0, 1.6);
  const barrier_samples = apply_envelope(motor_samples, sample_rate,
    (elapsed_seconds) => motor_level(elapsed_seconds) * (0.88 + 0.12 * Math.sin(2 * Math.PI * BARRIER_RATTLE_HERTZ * elapsed_seconds)));
  const relay_click = { duration_seconds: 0.08, attack_seconds: 0.001, decay_seconds: 0.012, filter_chain: [{ filter_type: "bandpass", frequency: 1800, quality_factor: 1.2 }] };
  for (const [click_seconds, click_gain] of [[0.3, 0.8], [0.39, 0.5], [0.67, 0.6], [1.07, 0.4]]) {
    mix_into(barrier_samples, noise_burst(sample_rate, relay_click), sample_rate, click_seconds, click_gain);
  }
  mix_into(barrier_samples, metal_hit(sample_rate, 310, 0.12), sample_rate, 8.0, 0.6);
  return finish_samples(barrier_samples, sample_rate);
}

/**
 * 大型水平軸風機：實錄的能量集中在 63–500 Hz（1 kHz 以上掉 12 dB 以上），是低沉、持續的「呼——」，
 * 葉片掃過的起伏很淺（約每 1.8 秒一次、±2 dB），再疊上不規則的陣風。
 */
export function render_large_wind_turbine(sample_rate) {
  const turbine_seconds = 10;
  const rotor_noise = apply_filter_chain(create_noise_samples(sample_rate, turbine_seconds), sample_rate, [
    { filter_type: "lowpass", frequency: 600 }, { filter_type: "lowpass", frequency: 800 },
    { filter_type: "peaking", frequency: 180, quality_factor: 0.7, gain_decibels: 6 }, { filter_type: "highpass", frequency: 40 }]);
  const gust_swell = irregular_swell([0.13, 0.21, 0.37]);
  const turbine_samples = apply_envelope(rotor_noise, sample_rate,
    (elapsed_seconds) => (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.56 * elapsed_seconds)) * (0.7 + 0.3 * gust_swell(elapsed_seconds)));
  const blade_swish = apply_filter(create_noise_samples(sample_rate, turbine_seconds, 900), sample_rate, { filter_type: "bandpass", frequency: 350, quality_factor: 0.8 });
  mix_into(turbine_samples, apply_envelope(blade_swish, sample_rate, (elapsed_seconds) => (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.56 * elapsed_seconds)) ** 2), sample_rate, 0, 0.2);
  return finish_samples(turbine_samples, sample_rate);
}

// 實錄（eguaus 的風機雙耳錄音）：127 Hz 的機械嗡聲最突出，帶每秒約 26 次的粗糙顫動；
// 底下是 125 Hz 以下的低頻風壓，加上 1–4 kHz 平坦的嘶聲（約 -17 dB），偶爾有金屬碰撞聲
const VERTICAL_TURBINE_HUM_HERTZ = 127;
const VERTICAL_TURBINE_ROUGHNESS_HERTZ = 26.5;
const VERTICAL_TURBINE_CLINK_SECONDS = Object.freeze([2.1, 3.5, 7.9, 8.2, 8.6]);

/** 垂直軸風機：低沉的機械嗡聲與風壓為主，高頻嘶聲很淡，偶爾有金屬「叮、喀」，整體慢慢起伏。 */
export function render_vertical_wind_turbine(sample_rate) {
  const turbine_seconds = 10;
  const turbine_samples = create_silent_samples(sample_rate, turbine_seconds);
  for (const [harmonic_number, harmonic_gain] of [[1, 1], [2, 0.25], [3, 0.1]]) {
    mix_into(turbine_samples, create_oscillator_samples(sample_rate, turbine_seconds, VERTICAL_TURBINE_HUM_HERTZ * harmonic_number), sample_rate, 0, harmonic_gain);
  }
  const rough_hum = apply_envelope(turbine_samples, sample_rate,
    (elapsed_seconds) => 0.7 + 0.3 * Math.sin(2 * Math.PI * VERTICAL_TURBINE_ROUGHNESS_HERTZ * elapsed_seconds));
  const wind_pressure = apply_filter_chain(create_noise_samples(sample_rate, turbine_seconds, 600), sample_rate, [
    { filter_type: "lowpass", frequency: 120 }, { filter_type: "lowpass", frequency: 400 }]);
  mix_into(rough_hum, wind_pressure, sample_rate, 0, 9);
  const body_noise = apply_filter(create_noise_samples(sample_rate, turbine_seconds, 2900), sample_rate, { filter_type: "bandpass", frequency: 300, quality_factor: 0.7 });
  mix_into(rough_hum, body_noise, sample_rate, 0, 0.6);
  const air_hiss = apply_filter_chain(create_noise_samples(sample_rate, turbine_seconds, 1400), sample_rate, [
    { filter_type: "highpass", frequency: 700 }, { filter_type: "lowpass", frequency: 7000 }]);
  mix_into(rough_hum, air_hiss, sample_rate, 0, 0.45);
  for (const clink_seconds of VERTICAL_TURBINE_CLINK_SECONDS) mix_into(rough_hum, metal_hit(sample_rate, 1250, 0.05), sample_rate, clink_seconds, 0.12);
  const slow_swell = irregular_swell([0.2, 0.31]);
  return finish_samples(apply_envelope(rough_hum, sample_rate, (elapsed_seconds) => 0.6 + 0.4 * slow_swell(elapsed_seconds)), sample_rate);
}

/** 燃氣輪機、冷凍壓縮機：很低的轟鳴、50 Hz 諧波，加上隱約的渦輪高頻嘯聲。 */
export function render_industrial_drone(sample_rate) {
  const drone_samples = apply_filter(create_noise_samples(sample_rate, AMBIENT_SECONDS, 4000), sample_rate, { filter_type: "lowpass", frequency: 110 });
  const mains_harmonics = apply_filter(create_oscillator_samples(sample_rate, AMBIENT_SECONDS, 50, "sawtooth"), sample_rate, { filter_type: "lowpass", frequency: 260 });
  mix_into(drone_samples, mains_harmonics, sample_rate, 0, 0.25);
  mix_into(drone_samples, create_oscillator_samples(sample_rate, AMBIENT_SECONDS, 3150), sample_rate, 0, 0.012);
  return finish_samples(drone_samples, sample_rate);
}

/**
 * 引擎點火：依點火頻率排出一連串衰減的雜訊脈衝，各汽缸力道依 cylinder_balance 輪流。
 * 移動類的鐵牛車、機車、五分車也用這個函式，所以匯出。
 * @param {number} sample_rate
 * @param {number} duration_seconds
 * @param {{firing_hertz: (elapsed_seconds: number) => number, cylinder_balance: readonly number[], pulse_decay_seconds: number}} engine_settings
 * @returns {Float32Array}
 */
export function render_engine_firing(sample_rate, duration_seconds, engine_settings) {
  const { firing_hertz, cylinder_balance, pulse_decay_seconds } = engine_settings;
  const engine_samples = create_silent_samples(sample_rate, duration_seconds);
  const pulse_samples = noise_burst(sample_rate, { duration_seconds: pulse_decay_seconds * 5, attack_seconds: 0.0005, decay_seconds: pulse_decay_seconds,
    filter_chain: [{ filter_type: "lowpass", frequency: 1800 }], skip_values: 50 });
  let firing_index = 0;
  for (let firing_seconds = 0; firing_seconds < duration_seconds; firing_seconds += 1 / firing_hertz(firing_seconds)) {
    mix_into(engine_samples, pulse_samples, sample_rate, firing_seconds, cylinder_balance[firing_index % cylinder_balance.length]);
    firing_index += 1;
  }
  return engine_samples;
}

/** 柴油發電機：1500 rpm 四缸穩定運轉（點火 50 Hz），排氣共鳴加機械高頻。 */
export function render_diesel_generator(sample_rate) {
  const firing_samples = render_engine_firing(sample_rate, AMBIENT_SECONDS, { firing_hertz: () => 50, cylinder_balance: [1, 0.85, 0.95, 0.8], pulse_decay_seconds: 0.006 });
  const generator_samples = apply_filter_chain(firing_samples, sample_rate, [
    { filter_type: "peaking", frequency: 100, quality_factor: 1, gain_decibels: 9 }, { filter_type: "lowpass", frequency: 1400 }]);
  const alternator_whine = create_oscillator_samples(sample_rate, AMBIENT_SECONDS, 400);
  return finish_samples(mix_into(generator_samples, alternator_whine, sample_rate, 0, 0.02), sample_rate);
}

// ── 鐘聲與號誌 ─────────────────────────────────────────

/** 行人號誌：兩聲一組的「布穀」電子音反覆三次，接著倒數的急促嗶聲。 */
export function render_pedestrian_signal(sample_rate) {
  const signal_samples = create_silent_samples(sample_rate, 6);
  for (let call_index = 0; call_index < 3; call_index += 1) {
    const call_seconds = call_index * 1.1;
    mix_into(signal_samples, apply_envelope(create_oscillator_samples(sample_rate, 0.16, 1320, "triangle"), sample_rate, percussive_envelope(0.01, 0.08)), sample_rate, call_seconds);
    mix_into(signal_samples, apply_envelope(create_oscillator_samples(sample_rate, 0.25, 1050, "triangle"), sample_rate, percussive_envelope(0.01, 0.12)), sample_rate, call_seconds + 0.2);
  }
  for (let beep_seconds = 3.5; beep_seconds < 5.9; beep_seconds += 0.25) mix_into(signal_samples, beep_tone(sample_rate, 2400, 0.06), sample_rate, beep_seconds, 0.3);
  return finish_samples(signal_samples, sample_rate);
}

// 實錄的平交道警鈴：鈴錘每秒敲約 5.2 下，奇偶兩下力道不同（所以有 2.6 Hz 的起伏）；
// 主音 1553 Hz，其餘分音 2686、2099、1047、3308 Hz，各自比主音小 9 到 22 dB
const CROSSING_BELL_MODES = Object.freeze([
  { frequency: 1553, amplitude: 1, decay_seconds: 0.35 }, { frequency: 2686, amplitude: 0.35, decay_seconds: 0.2 },
  { frequency: 2099, amplitude: 0.16, decay_seconds: 0.25 }, { frequency: 1047, amplitude: 0.09, decay_seconds: 0.4 },
  { frequency: 3308, amplitude: 0.08, decay_seconds: 0.12 },
]);
const CROSSING_STRIKE_HERTZ = 5.2;

/** 平交道警鈴：鈴錘連續快速敲打，「噹噹噹噹」不間斷，強弱交替。 */
export function render_level_crossing_bell(sample_rate) {
  const bell_seconds = 8;
  const crossing_samples = create_silent_samples(sample_rate, bell_seconds);
  const single_strike = create_struck_resonance(sample_rate, 1.2, CROSSING_BELL_MODES);
  let strike_index = 0;
  for (let strike_seconds = 0.05; strike_seconds < bell_seconds - 0.4; strike_seconds += 1 / CROSSING_STRIKE_HERTZ) {
    mix_into(crossing_samples, single_strike, sample_rate, strike_seconds, strike_index % 2 === 0 ? 1 : 0.7);
    strike_index += 1;
  }
  return finish_samples(crossing_samples, sample_rate);
}

function tuned_bell(sample_rate, prime_frequency, ring_seconds, partial_list) {
  return create_struck_resonance(sample_rate, ring_seconds, partial_list.map((bell_partial) => ({
    frequency: prime_frequency * bell_partial.ratio, amplitude: bell_partial.amplitude, decay_seconds: bell_partial.decay_seconds })));
}

// 實錄（京都大德寺的寺鐘）：主音 1023 Hz，旁邊有一條差 5 Hz 的分音，兩者相疊產生每秒 5 次的「嗡嗡」拍頻；
// 2.6 kHz 與 4.5 kHz 一帶各有一對分音，衰減得比主音快。敲擊後約 0.85 秒掉 20 dB，之後留一段長尾音
const TEMPLE_BELL_MODES = Object.freeze([
  { frequency: 1023, amplitude: 1, decay_seconds: 1 }, { frequency: 1028.2, amplitude: 0.7, decay_seconds: 1.2 },
  { frequency: 2592, amplitude: 0.2, decay_seconds: 0.35 }, { frequency: 2606, amplitude: 0.18, decay_seconds: 0.3 },
  { frequency: 4525, amplitude: 0.08, decay_seconds: 0.18 }, { frequency: 4624, amplitude: 0.09, decay_seconds: 0.15 },
  { frequency: 4654, amplitude: 0.06, decay_seconds: 0.15 }, { frequency: 1023, amplitude: 0.06, decay_seconds: 3.5 },
]);

/** 廟宇鐘聲：木槌撞鐘的悶響後，帶拍頻的「噹——嗡嗡」餘韻，約每 4.7 秒撞一次。 */
export function render_temple_bell_drum(sample_rate) {
  const temple_seconds = 9.5;
  const temple_samples = create_silent_samples(sample_rate, temple_seconds);
  for (const strike_seconds of [0.1, 4.8]) {
    mix_into(temple_samples, create_struck_resonance(sample_rate, 4.6, TEMPLE_BELL_MODES), sample_rate, strike_seconds);
    mix_into(temple_samples, noise_burst(sample_rate, { duration_seconds: 0.15, attack_seconds: 0.001, decay_seconds: 0.02,
      filter_chain: [{ filter_type: "lowpass", frequency: 500 }] }), sample_rate, strike_seconds, 0.6);
  }
  const outdoor_air = apply_filter(create_noise_samples(sample_rate, temple_seconds, 3600), sample_rate, { filter_type: "lowpass", frequency: 60 });
  mix_into(temple_samples, outdoor_air, sample_rate, 0, 1.2);
  const distant_hiss = apply_filter(create_noise_samples(sample_rate, temple_seconds, 7700), sample_rate, { filter_type: "highpass", frequency: 5000 });
  return finish_samples(mix_into(temple_samples, distant_hiss, sample_rate, 0, 0.01), sample_rate);
}

// 實錄（整點報時的教堂鐘）：主音 546 Hz，其他分音相對主音的比例取自頻譜；鐘擺動時每秒敲一次，力道逐漸變小
const CHURCH_PRIME_FREQUENCY = 546;
const CHURCH_BELL_MEASURED_PARTIALS = Object.freeze([
  { ratio: 0.423, amplitude: 0.28, decay_seconds: 2 }, { ratio: 0.877, amplitude: 0.12, decay_seconds: 1.4 },
  { ratio: 1, amplitude: 1, decay_seconds: 1 }, { ratio: 1.667, amplitude: 0.3, decay_seconds: 0.8 },
  { ratio: 2.524, amplitude: 0.35, decay_seconds: 0.6 }, { ratio: 3.505, amplitude: 0.3, decay_seconds: 0.45 },
  { ratio: 4.595, amplitude: 0.22, decay_seconds: 0.35 }, { ratio: 5.747, amplitude: 0.35, decay_seconds: 0.3 },
  { ratio: 11.9, amplitude: 0.15, decay_seconds: 0.05 },
]);

/** 教堂鐘樓：鐘每秒敲一次、連敲十下，力道逐漸變小，餘韻彼此重疊。 */
export function render_church_bell(sample_rate) {
  const church_samples = create_silent_samples(sample_rate, 13);
  const single_strike = tuned_bell(sample_rate, CHURCH_PRIME_FREQUENCY, 5, CHURCH_BELL_MEASURED_PARTIALS);
  for (let strike_index = 0; strike_index < 10; strike_index += 1) {
    mix_into(church_samples, single_strike, sample_rate, 0.4 + strike_index * 1.0, 0.85 ** strike_index * (strike_index % 2 === 0 ? 1 : 0.8));
  }
  return finish_samples(church_samples, sample_rate);
}

// 西敏寺鐘聲整點的四個樂句（E 大調），台灣學校上下課鐘聲就是這一段；數字是 MIDI 音高
const WESTMINSTER_PHRASES = Object.freeze([[64, 68, 66, 59], [64, 66, 68, 64], [68, 64, 66, 59], [59, 66, 68, 64]]);
const WESTMINSTER_NOTE_SECONDS = 0.62;
const CHIME_PARTIALS = Object.freeze([
  { ratio: 1, amplitude: 1, decay_seconds: 1.4 }, { ratio: 2, amplitude: 0.35, decay_seconds: 0.8 },
  { ratio: 3, amplitude: 0.15, decay_seconds: 0.5 }, { ratio: 4.2, amplitude: 0.08, decay_seconds: 0.3 },
]);

/** 西敏寺鐘聲：四個樂句、十六個音，學校廣播系統的電子鐘音色。 */
export function render_westminster_chime(sample_rate) {
  const chime_seconds = (WESTMINSTER_PHRASES.length * 5) * WESTMINSTER_NOTE_SECONDS + 1.5;
  const chime_samples = create_silent_samples(sample_rate, chime_seconds);
  WESTMINSTER_PHRASES.forEach((phrase_notes, phrase_index) => {
    phrase_notes.forEach((midi_note, note_index) => {
      const note_frequency = 440 * 2 ** ((midi_note - 69) / 12);
      const note_seconds = (phrase_index * 5 + note_index) * WESTMINSTER_NOTE_SECONDS;
      mix_into(chime_samples, tuned_bell(sample_rate, note_frequency, 2, CHIME_PARTIALS), sample_rate, note_seconds);
    });
  });
  return finish_samples(chime_samples, sample_rate);
}
