/**
 * 混音台（Web Audio 基礎設施）：send/return 架構。
 * 每個樂器有自己的通道，乾聲直接進總輸出；另外按比例「送出」到共用的 reverb、delay 匯流排，
 * 匯流排只回送效果聲。總輸出經過 limiter 再到喇叭。
 * 只有一種固定配置；reverb 的脈衝響應由 Schroeder 濾波器網路現場算出，不載入任何音訊檔。
 */
import { generate_impulse_samples } from "./signal_generators.js";

const MASTER_VOLUME_DECIBELS = -3;
const LIMITER_THRESHOLD_DECIBELS = -1;
const LIMITER_RATIO = 20;
const LIMITER_ATTACK_SECONDS = 0.003;
const LIMITER_RELEASE_SECONDS = 0.1;
const REVERB_DECAY_SECONDS = 2.5;
const DELAY_FEEDBACK_GAIN = 0.35;
const MAXIMUM_DELAY_SECONDS = 2;

/**
 * 每個樂器的送出量（dB）；null 代表不送。
 * 貝斯與大鼓不送效果，低頻才不會糊在一起；pad 送最多殘響，撥弦與主旋律再加一點 delay。
 */
export const INSTRUMENT_SEND_LEVELS = Object.freeze({
  chord: Object.freeze({ reverb_send_decibels: -10, delay_send_decibels: null }),
  pad: Object.freeze({ reverb_send_decibels: -4, delay_send_decibels: null }),
  pluck: Object.freeze({ reverb_send_decibels: -12, delay_send_decibels: -14 }),
  clap: Object.freeze({ reverb_send_decibels: -10, delay_send_decibels: null }),
  bass: Object.freeze({ reverb_send_decibels: null, delay_send_decibels: null }),
  lead: Object.freeze({ reverb_send_decibels: -14, delay_send_decibels: -12 }),
  kick: Object.freeze({ reverb_send_decibels: null, delay_send_decibels: null }),
  hat: Object.freeze({ reverb_send_decibels: -18, delay_send_decibels: null }),
});

/**
 * 分貝轉成振幅倍率。
 * @param {number} decibel_value 分貝值
 * @returns {number} 振幅倍率（0 dB = 1）
 */
export function decibels_to_gain(decibel_value) {
  return 10 ** (decibel_value / 20);
}

function create_master_section(audio_context) {
  const limiter_node = audio_context.createDynamicsCompressor();
  limiter_node.threshold.value = LIMITER_THRESHOLD_DECIBELS;
  limiter_node.knee.value = 0;
  limiter_node.ratio.value = LIMITER_RATIO;
  limiter_node.attack.value = LIMITER_ATTACK_SECONDS;
  limiter_node.release.value = LIMITER_RELEASE_SECONDS;
  limiter_node.connect(audio_context.destination);
  const master_input = audio_context.createGain();
  master_input.gain.value = decibels_to_gain(MASTER_VOLUME_DECIBELS);
  master_input.connect(limiter_node);
  return master_input;
}

function create_reverb_bus(audio_context, master_input) {
  const impulse_samples = generate_impulse_samples(audio_context.sampleRate, REVERB_DECAY_SECONDS);
  const impulse_buffer = audio_context.createBuffer(1, impulse_samples.length, audio_context.sampleRate);
  impulse_buffer.getChannelData(0).set(impulse_samples);
  const convolver_node = audio_context.createConvolver();
  convolver_node.buffer = impulse_buffer;
  convolver_node.connect(master_input);
  return convolver_node;
}

function create_delay_bus(audio_context, master_input, delay_seconds) {
  const delay_node = audio_context.createDelay(MAXIMUM_DELAY_SECONDS);
  delay_node.delayTime.value = delay_seconds;
  const feedback_node = audio_context.createGain();
  feedback_node.gain.value = DELAY_FEEDBACK_GAIN;
  delay_node.connect(feedback_node).connect(delay_node);
  delay_node.connect(master_input);
  return delay_node;
}

function connect_send(audio_context, channel_node, send_decibels, bus_input) {
  if (send_decibels === null) return;
  const send_node = audio_context.createGain();
  send_node.gain.value = decibels_to_gain(send_decibels);
  channel_node.connect(send_node).connect(bus_input);
}

/**
 * 建立整個混音台並接好線。音訊節點隨 audio_context.close() 一起釋放，不需要另外清理。
 * @param {BaseAudioContext} audio_context 即時或離線的 Web Audio context
 * @param {{delay_seconds: number}} mixing_options delay_seconds 是 delay 的間隔，必須介於 0 與 2 秒之間
 * @returns {{instrument_input_for: (instrument_name: string) => AudioNode}}
 *   instrument_input_for 回傳該樂器通道的輸入節點；樂器名稱不存在時丟出 RangeError，避免悄悄沒聲音
 */
export function create_mixing_console(audio_context, mixing_options) {
  const { delay_seconds } = mixing_options;
  if (!(delay_seconds > 0 && delay_seconds <= MAXIMUM_DELAY_SECONDS)) {
    throw new RangeError(`delay_seconds 必須介於 0 與 ${MAXIMUM_DELAY_SECONDS} 之間，收到 ${delay_seconds}`);
  }
  const master_input = create_master_section(audio_context);
  const reverb_input = create_reverb_bus(audio_context, master_input);
  const delay_input = create_delay_bus(audio_context, master_input, delay_seconds);
  const channel_nodes = new Map();
  for (const [instrument_name, send_levels] of Object.entries(INSTRUMENT_SEND_LEVELS)) {
    const channel_node = audio_context.createGain();
    channel_node.connect(master_input);
    connect_send(audio_context, channel_node, send_levels.reverb_send_decibels, reverb_input);
    connect_send(audio_context, channel_node, send_levels.delay_send_decibels, delay_input);
    channel_nodes.set(instrument_name, channel_node);
  }
  return {
    instrument_input_for(instrument_name) {
      const channel_node = channel_nodes.get(instrument_name);
      if (!channel_node) throw new RangeError(`混音台沒有樂器通道：${instrument_name}`);
      return channel_node;
    },
  };
}
