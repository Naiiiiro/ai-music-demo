/**
 * 場景音效配方（純計算）：動物叫聲與人聲。全部用「泛音聲帶 → 共鳴峰」的聲道模型逼近，
 * 這類聲音的細節（喉部的不規則、呼吸、個體差異）很難用公式模仿，所以清單建議用實錄；合成版只供對照。
 * 每個函式吃取樣率，回傳一段已正規化的單聲道取樣；不用亂數。
 */
import {
  apply_envelope,
  apply_filter,
  apply_formants,
  create_noise_samples,
  create_oscillator_samples,
  create_silent_samples,
  create_struck_resonance,
  create_voice_source,
  finish_samples,
  golden_spread,
  irregular_swell,
  mix_into,
  percussive_envelope,
  smooth_curve,
} from "./synthesis_primitives.js";

/**
 * 一聲叫聲：音高、音量、聲帶粗糙度與共鳴峰組合起來的一段取樣。
 * @param {number} sample_rate
 * @param {{call_seconds: number, pitch_points: [number, number][], loudness_points: [number, number][],
 *   spectral_tilt: number, breath_level: number, formant_list: object[], vibrato_hertz?: number, vibrato_depth?: number}} call_settings
 */
function vocal_call(sample_rate, call_settings) {
  const { call_seconds, pitch_points, loudness_points, spectral_tilt, breath_level, formant_list, vibrato_hertz = 0, vibrato_depth = 0 } = call_settings;
  const base_pitch = smooth_curve(pitch_points);
  const voice_source = create_voice_source(sample_rate, call_seconds, {
    pitch_at_time: (elapsed_seconds) => base_pitch(elapsed_seconds) * (1 + vibrato_depth * Math.sin(2 * Math.PI * vibrato_hertz * elapsed_seconds)),
    loudness_at_time: smooth_curve(loudness_points), spectral_tilt, breath_level,
  });
  return apply_formants(voice_source, sample_rate, formant_list);
}

function sequence_calls(sample_rate, total_seconds, call_placements) {
  const sequence_samples = create_silent_samples(sample_rate, total_seconds);
  for (const { call_samples, start_seconds, gain = 1 } of call_placements) mix_into(sequence_samples, call_samples, sample_rate, start_seconds, gain);
  return sequence_samples;
}

const formant = (frequency, quality_factor, relative_gain) => ({ frequency, quality_factor, relative_gain });

// ── 動物 ─────────────────────────────────────────────

/** 牛叫：低沉的「哞——」，閉著嘴的「m」打開成「oo」再收回。 */
export function render_cattle_moo(sample_rate) {
  const moo_call = vocal_call(sample_rate, {
    call_seconds: 2.6, pitch_points: [[0, 105], [0.5, 150], [1.8, 140], [2.6, 95]],
    loudness_points: [[0, 0], [0.3, 0.6], [0.8, 1], [2, 0.8], [2.6, 0]], spectral_tilt: 1.1, breath_level: 0.25,
    vibrato_hertz: 4.5, vibrato_depth: 0.01,
    formant_list: [formant(smooth_curve([[0, 300], [0.8, 650], [2.6, 400]]), 4, 1), formant(smooth_curve([[0, 800], [0.8, 1100], [2.6, 850]]), 5, 0.5), formant(2400, 6, 0.15)],
  });
  return finish_samples(sequence_calls(sample_rate, 3.2, [{ call_samples: moo_call, start_seconds: 0.2 }]), sample_rate);
}

/** 羊叫：「咩～」帶明顯的顫抖（每秒約 7 次的音量與音高抖動）。 */
export function render_sheep_bleat(sample_rate) {
  const bleat_settings = {
    call_seconds: 1.1, pitch_points: [[0, 300], [0.15, 360], [1.1, 320]], loudness_points: [[0, 0], [0.08, 1], [0.8, 0.8], [1.1, 0]],
    spectral_tilt: 1, breath_level: 0.3, vibrato_hertz: 7, vibrato_depth: 0.05,
    formant_list: [formant(800, 5, 1), formant(1750, 6, 0.6), formant(2700, 7, 0.25)],
  };
  const bleat_call = apply_envelope(vocal_call(sample_rate, bleat_settings), sample_rate, (elapsed_seconds) => 0.5 + 0.5 * Math.sin(2 * Math.PI * 7 * elapsed_seconds));
  return finish_samples(sequence_calls(sample_rate, 3, [{ call_samples: bleat_call, start_seconds: 0.1 }, { call_samples: bleat_call, start_seconds: 1.6, gain: 0.8 }]), sample_rate);
}

/** 鵝叫：短促、帶鼻音的「嘎、嘎」，聲帶很粗（泛音衰減慢）。 */
export function render_goose_honk(sample_rate) {
  const honk_call = vocal_call(sample_rate, {
    call_seconds: 0.32, pitch_points: [[0, 430], [0.1, 470], [0.32, 380]], loudness_points: [[0, 0], [0.03, 1], [0.25, 0.8], [0.32, 0]],
    spectral_tilt: 0.7, breath_level: 0.2, formant_list: [formant(950, 4, 1), formant(1650, 5, 0.8), formant(3000, 6, 0.3)],
  });
  return finish_samples(sequence_calls(sample_rate, 2.6, [0.1, 0.55, 0.9, 1.7].map((start_seconds, call_index) => ({ call_samples: honk_call, start_seconds, gain: 1 - 0.15 * (call_index % 2) }))), sample_rate);
}

/** 鴨叫：「呱呱呱」三聲一組，鼻音很重，音高往下掉；鴨群時疊多軌。 */
export function render_duck_quack(sample_rate) {
  const quack_call = vocal_call(sample_rate, {
    call_seconds: 0.24, pitch_points: [[0, 320], [0.24, 230]], loudness_points: [[0, 0], [0.02, 1], [0.18, 0.7], [0.24, 0]],
    spectral_tilt: 0.6, breath_level: 0.35, formant_list: [formant(1050, 4, 1), formant(2200, 4, 0.7), formant(3300, 6, 0.2)],
  });
  const quack_times = [0.1, 0.38, 0.66, 1.6, 1.85, 2.4];
  return finish_samples(sequence_calls(sample_rate, 3, quack_times.map((start_seconds, call_index) => ({ call_samples: quack_call, start_seconds, gain: 0.7 + 0.3 * golden_spread(call_index) }))), sample_rate);
}

/** 雞：公雞啼「喔喔喔——」四段音高，接著幾聲母雞的「咕、咕」。 */
export function render_chicken_cluck(sample_rate) {
  const crow_settings = { spectral_tilt: 0.8, breath_level: 0.3, vibrato_hertz: 9, vibrato_depth: 0.015,
    formant_list: [formant(1200, 3, 1), formant(2500, 4, 0.5), formant(3800, 5, 0.2)] };
  const crow_segments = [[0.18, 560, 600], [0.18, 650, 700], [0.22, 760, 800], [1.0, 820, 520]];
  const call_placements = [];
  let crow_cursor = 0.1;
  for (const [segment_seconds, start_pitch, end_pitch] of crow_segments) {
    call_placements.push({ start_seconds: crow_cursor, call_samples: vocal_call(sample_rate, { ...crow_settings, call_seconds: segment_seconds,
      pitch_points: [[0, start_pitch], [segment_seconds, end_pitch]], loudness_points: [[0, 0], [0.03, 1], [segment_seconds - 0.05, 0.85], [segment_seconds, 0]] }) });
    crow_cursor += segment_seconds + 0.04;
  }
  const cluck_call = vocal_call(sample_rate, { call_seconds: 0.09, pitch_points: [[0, 420], [0.09, 340]], loudness_points: [[0, 0], [0.01, 1], [0.09, 0]],
    spectral_tilt: 0.9, breath_level: 0.2, formant_list: [formant(700, 3, 1), formant(1500, 4, 0.5)] });
  for (const cluck_seconds of [2.4, 2.65, 2.8, 3.4, 3.6]) call_placements.push({ start_seconds: cluck_seconds, call_samples: cluck_call, gain: 0.6 });
  return finish_samples(sequence_calls(sample_rate, 4.2, call_placements), sample_rate);
}

/** 田間蛙鳴：五隻青蛙各自以每秒 25 到 40 次的脈衝「咯咯咯」，叫的時間錯開、重疊成合唱。 */
export function render_frog_chorus(sample_rate) {
  const chorus_seconds = 8;
  const chorus_samples = create_silent_samples(sample_rate, chorus_seconds);
  for (let frog_index = 0; frog_index < 5; frog_index += 1) {
    const pulse_hertz = 25 + 15 * golden_spread(frog_index + 1);
    const carrier_frequency = 450 + 500 * golden_spread(frog_index + 4);
    const croak_call = apply_envelope(apply_formants(create_oscillator_samples(sample_rate, 0.35, carrier_frequency, "sawtooth"), sample_rate,
      [formant(carrier_frequency * 1.5, 3, 1), formant(carrier_frequency * 3, 4, 0.4)]), sample_rate,
    (elapsed_seconds) => Math.sin((Math.PI * elapsed_seconds) / 0.35) * (0.5 + 0.5 * Math.sin(2 * Math.PI * pulse_hertz * elapsed_seconds)) ** 3);
    const repeat_seconds = 0.9 + 0.8 * golden_spread(frog_index + 2);
    for (let call_seconds = golden_spread(frog_index + 9) * repeat_seconds; call_seconds < chorus_seconds - 0.4; call_seconds += repeat_seconds) {
      mix_into(chorus_samples, croak_call, sample_rate, call_seconds, 0.5 + 0.5 * golden_spread(frog_index));
    }
  }
  return finish_samples(chorus_samples, sample_rate);
}

function chirp_sweep(sample_rate, chirp_seconds, pitch_points) {
  return apply_envelope(create_oscillator_samples(sample_rate, chirp_seconds, smooth_curve(pitch_points)), sample_rate,
    (elapsed_seconds) => Math.sin((Math.PI * elapsed_seconds) / chirp_seconds) ** 2);
}

/** 麻雀：一連串短促的「啾」，頻率在 3.5 到 5.5 kHz 之間快速上下滑，間隔不規則。 */
export function render_sparrow_chirp(sample_rate) {
  const chirp_seconds_total = 5;
  const sparrow_samples = create_silent_samples(sample_rate, chirp_seconds_total);
  for (let chirp_index = 0; chirp_index < 22; chirp_index += 1) {
    const peak_pitch = 4200 + 1300 * golden_spread(chirp_index + 3);
    const chirp_samples = chirp_sweep(sample_rate, 0.07 + 0.05 * golden_spread(chirp_index + 6), [[0, 3500], [0.03, peak_pitch], [0.12, peak_pitch * 0.85]]);
    mix_into(sparrow_samples, chirp_samples, sample_rate, golden_spread(chirp_index) * (chirp_seconds_total - 0.2), 0.6 + 0.4 * golden_spread(chirp_index + 1));
  }
  return finish_samples(sparrow_samples, sample_rate);
}

/** 鳳頭蒼鷹：高亢的「嘿——」由高往下滑，帶沙啞的氣音，兩聲。 */
export function render_hawk_call(sample_rate) {
  const hawk_call = vocal_call(sample_rate, {
    call_seconds: 0.8, pitch_points: [[0, 1900], [0.1, 2300], [0.8, 1500]], loudness_points: [[0, 0], [0.05, 1], [0.6, 0.7], [0.8, 0]],
    spectral_tilt: 1.3, breath_level: 0.6, harmonic_count: 4, formant_list: [formant(2300, 1.2, 1), formant(4500, 2, 0.3)],
  });
  return finish_samples(sequence_calls(sample_rate, 3, [{ call_samples: hawk_call, start_seconds: 0.1 }, { call_samples: hawk_call, start_seconds: 1.4, gain: 0.85 }]), sample_rate);
}

/** 狗叫：「汪！汪汪！」每聲很短、起音很猛，音高快速下掉，帶喉音雜訊。 */
export function render_dog_bark(sample_rate) {
  const bark_call = vocal_call(sample_rate, {
    call_seconds: 0.2, pitch_points: [[0, 560], [0.05, 520], [0.2, 340]], loudness_points: [[0, 0], [0.008, 1], [0.12, 0.6], [0.2, 0]],
    spectral_tilt: 0.75, breath_level: 0.7, formant_list: [formant(850, 3, 1), formant(1500, 4, 0.7), formant(2800, 5, 0.3)],
  });
  return finish_samples(sequence_calls(sample_rate, 2.4, [0.1, 0.9, 1.15].map((start_seconds) => ({ call_samples: bark_call, start_seconds }))), sample_rate);
}

// ── 人聲 ─────────────────────────────────────────────

// 五個母音（a、e、i、o、u）的前兩個共鳴峰（Hz），音節輪流換母音，聽起來像聽不清內容的說話聲
const VOWEL_FORMANT_PAIRS = Object.freeze([[730, 1090], [530, 1840], [300, 2250], [570, 840], [320, 920]]);

function babble_voice(sample_rate, duration_seconds, voice_index) {
  const base_pitch = 105 + 120 * golden_spread(voice_index + 2);
  const syllable_rate = 3.5 + 2 * golden_spread(voice_index + 5);
  const syllable_position = (elapsed_seconds) => elapsed_seconds * syllable_rate + 7 * golden_spread(voice_index);
  const vowel_at = (elapsed_seconds) => VOWEL_FORMANT_PAIRS[Math.floor(syllable_position(elapsed_seconds) * 1.7) % VOWEL_FORMANT_PAIRS.length];
  const phrase_swell = irregular_swell([0.23 + 0.05 * voice_index, 0.41], voice_index);
  const voice_source = create_voice_source(sample_rate, duration_seconds, {
    pitch_at_time: (elapsed_seconds) => base_pitch * (1 + 0.12 * Math.sin(2 * Math.PI * 0.7 * elapsed_seconds + voice_index)),
    loudness_at_time: (elapsed_seconds) => Math.max(0, Math.sin(Math.PI * (syllable_position(elapsed_seconds) % 1))) * (phrase_swell(elapsed_seconds) > 0.35 ? 1 : 0),
    spectral_tilt: 1.2, breath_level: 0.15, harmonic_count: 20,
  });
  return apply_formants(voice_source, sample_rate, [
    formant((elapsed_seconds) => vowel_at(elapsed_seconds)[0], 5, 1), formant((elapsed_seconds) => vowel_at(elapsed_seconds)[1], 7, 0.5)]);
}

function crowd_babble(sample_rate, duration_seconds, voice_count) {
  const babble_samples = create_silent_samples(sample_rate, duration_seconds);
  for (let voice_index = 0; voice_index < voice_count; voice_index += 1) mix_into(babble_samples, babble_voice(sample_rate, duration_seconds, voice_index), sample_rate, 0, 1 / voice_count);
  return babble_samples;
}

/** 人群交談：八個人同時說話（音高、語速、停頓各不相同），加上房間的底噪。 */
export function render_crowd_chatter(sample_rate) {
  const chatter_seconds = 8;
  const chatter_samples = crowd_babble(sample_rate, chatter_seconds, 8);
  const room_tone = apply_filter(create_noise_samples(sample_rate, chatter_seconds, 6100), sample_rate, { filter_type: "lowpass", frequency: 500 });
  return finish_samples(mix_into(chatter_samples, room_tone, sample_rate, 0, 0.03), sample_rate);
}

/** 打呼：吸氣時軟顎以每秒約 30 次振動（低沉的「呼嚕」），吐氣是輕的氣音；一個呼吸週期 4 秒。 */
export function render_snoring(sample_rate) {
  const snore_seconds = 8;
  const breath_phase = (elapsed_seconds) => (elapsed_seconds % 4) / 4;
  const inhale_level = smooth_curve([[0, 0], [0.1, 0.6], [0.35, 1], [0.45, 0], [1, 0]]);
  const exhale_level = smooth_curve([[0, 0], [0.5, 0], [0.6, 0.4], [0.9, 0], [1, 0]]);
  const palate_flutter = apply_filter(create_noise_samples(sample_rate, snore_seconds, 800), sample_rate, { filter_type: "lowpass", frequency: 650 });
  const snore_samples = apply_envelope(palate_flutter, sample_rate,
    (elapsed_seconds) => inhale_level(breath_phase(elapsed_seconds)) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 30 * elapsed_seconds)) ** 2);
  const exhale_air = apply_filter(create_noise_samples(sample_rate, snore_seconds, 1900), sample_rate, { filter_type: "bandpass", frequency: 1100, quality_factor: 0.8 });
  mix_into(snore_samples, apply_envelope(exhale_air, sample_rate, (elapsed_seconds) => exhale_level(breath_phase(elapsed_seconds))), sample_rate, 0, 0.4);
  return finish_samples(snore_samples, sample_rate);
}

function umpire_strike_call(sample_rate) {
  const strike_hiss = apply_envelope(apply_filter(create_noise_samples(sample_rate, 0.12, 4100), sample_rate, { filter_type: "highpass", frequency: 4000 }),
    sample_rate, smooth_curve([[0, 0], [0.04, 1], [0.12, 0]]));
  const strike_vowel = vocal_call(sample_rate, {
    call_seconds: 0.45, pitch_points: [[0, 190], [0.1, 230], [0.45, 150]], loudness_points: [[0, 0], [0.03, 1], [0.35, 0.8], [0.45, 0]],
    spectral_tilt: 0.9, breath_level: 0.2, formant_list: [formant(smooth_curve([[0, 750], [0.45, 350]]), 5, 1), formant(smooth_curve([[0, 1200], [0.45, 2200]]), 6, 0.6)],
  });
  return mix_into(mix_into(create_silent_samples(sample_rate, 0.8), strike_hiss, sample_rate, 0, 0.3), strike_vowel, sample_rate, 0.13);
}

/** 棒球比賽：觀眾嘈雜聲，裁判喊「Strike!」，接著球棒擊球的「鏘」與觀眾歡呼湧起。 */
export function render_ballgame(sample_rate) {
  const game_seconds = 9;
  const crowd_level = smooth_curve([[0, 0.5], [4.2, 0.5], [4.6, 1.6], [7, 1.3], [game_seconds, 0.7]]);
  const game_samples = apply_envelope(crowd_babble(sample_rate, game_seconds, 6), sample_rate, crowd_level);
  const cheer_noise = apply_filter(create_noise_samples(sample_rate, game_seconds, 5300), sample_rate, { filter_type: "bandpass", frequency: 1500, quality_factor: 0.6 });
  mix_into(game_samples, apply_envelope(cheer_noise, sample_rate, (elapsed_seconds) => 0.08 * crowd_level(elapsed_seconds) ** 2), sample_rate, 0);
  mix_into(game_samples, umpire_strike_call(sample_rate), sample_rate, 1.2, 0.6);
  const bat_crack = create_struck_resonance(sample_rate, 0.3, [{ frequency: 1750, amplitude: 1, decay_seconds: 0.03 }, { frequency: 3100, amplitude: 0.5, decay_seconds: 0.015 }]);
  const crack_snap = apply_envelope(create_noise_samples(sample_rate, 0.05, 7000), sample_rate, percussive_envelope(0.0005, 0.004));
  mix_into(game_samples, mix_into(bat_crack, crack_snap, sample_rate, 0, 1), sample_rate, 4.2, 0.8);
  return finish_samples(game_samples, sample_rate);
}
