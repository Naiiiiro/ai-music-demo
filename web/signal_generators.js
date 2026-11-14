/**
 * 訊號產生器（純計算，不碰 Web Audio）：非整數倍頻方波疊加、LFSR 雜訊、reverb 脈衝響應、Karplus-Strong 撥弦。
 * 全部是確定性的數學公式，不用亂數；同樣的參數永遠得到同樣的取樣，Node 也能測試。
 */

// 衰減到 -60 dB（振幅 1/1000）所需的時間定義為殘響長度，ln(1000) ≈ 6.9
const SIXTY_DECIBEL_DECAY_FACTOR = Math.log(1000);
// 每繞一圈保留的能量比例；越接近 1，撥弦尾音越長
const PLUCK_DAMPING_FACTOR = 0.996;
// Schroeder reverb：四條並聯 comb filter 的延遲彼此互質，回聲才不會疊在同一時間點
const REVERB_COMB_DELAYS_SECONDS = Object.freeze([0.0297, 0.0371, 0.0411, 0.0437]);
const REVERB_ALLPASS_DELAYS_SECONDS = Object.freeze([0.005, 0.0017]);
const REVERB_ALLPASS_GAIN = 0.7;

/**
 * TR-808 腳踏鈸的六個方波頻率（Hz）。彼此不成整數倍，疊起來沒有明確音高，聽起來像金屬。
 */
export const METALLIC_PARTIAL_FREQUENCIES = Object.freeze([205.3, 304.4, 369.6, 522.7, 540, 800]);

function require_positive_integer(parameter_value, parameter_name) {
  if (!Number.isInteger(parameter_value) || parameter_value <= 0) throw new RangeError(`${parameter_name} 必須是正整數，收到 ${parameter_value}`);
}

function require_positive_number(parameter_value, parameter_name) {
  if (!(parameter_value > 0)) throw new RangeError(`${parameter_name} 必須 > 0，收到 ${parameter_value}`);
}

/**
 * 把幾個頻率的方波疊在一起，再除以個數，讓振幅保持在 ±1 內。用來取代白噪音：沒有亂數，但頻譜一樣密。
 * @param {number} sample_rate 取樣率，必須是正整數
 * @param {number} duration_seconds 長度（秒），必須 >= 0
 * @param {readonly number[]} partial_frequencies 各方波的頻率（Hz），至少一個，每個都必須 > 0
 * @returns {Float32Array} 長度為 sample_rate × duration_seconds（無條件進位）的取樣
 */
export function generate_inharmonic_samples(sample_rate, duration_seconds, partial_frequencies) {
  require_positive_integer(sample_rate, "sample_rate");
  if (!(duration_seconds >= 0)) throw new RangeError(`duration_seconds 必須 >= 0，收到 ${duration_seconds}`);
  if (partial_frequencies.length === 0) throw new RangeError("partial_frequencies 至少要有一個頻率");
  partial_frequencies.forEach((partial_frequency) => require_positive_number(partial_frequency, "partial_frequency"));
  return Float32Array.from({ length: Math.ceil(sample_rate * duration_seconds) }, (_, sample_index) => {
    const elapsed_seconds = sample_index / sample_rate;
    const square_sum = partial_frequencies.reduce(
      (sum_value, partial_frequency) => sum_value + Math.sign(Math.sin(2 * Math.PI * partial_frequency * elapsed_seconds)), 0);
    return square_sum / partial_frequencies.length;
  });
}

function apply_comb_filter(input_samples, delay_samples, feedback_gain) {
  const output_samples = new Float32Array(input_samples.length);
  for (let sample_index = 0; sample_index < input_samples.length; sample_index += 1) {
    const delayed_value = sample_index >= delay_samples ? output_samples[sample_index - delay_samples] : 0;
    output_samples[sample_index] = input_samples[sample_index] + feedback_gain * delayed_value;
  }
  return output_samples;
}

function apply_allpass_filter(input_samples, delay_samples, allpass_gain) {
  const output_samples = new Float32Array(input_samples.length);
  for (let sample_index = 0; sample_index < input_samples.length; sample_index += 1) {
    const delayed_input = sample_index >= delay_samples ? input_samples[sample_index - delay_samples] : 0;
    const delayed_output = sample_index >= delay_samples ? output_samples[sample_index - delay_samples] : 0;
    output_samples[sample_index] = -allpass_gain * input_samples[sample_index] + delayed_input + allpass_gain * delayed_output;
  }
  return output_samples;
}

/**
 * 產生 reverb 的脈衝響應：單一脈衝經過 Schroeder 網路（四條並聯 comb filter，再串兩個 allpass filter），
 * 每條 comb 的回授量設成在 decay_seconds 時衰減到 -60 dB；最後把峰值正規化到 1。
 * @param {number} sample_rate 取樣率，必須是正整數
 * @param {number} decay_seconds 殘響長度（秒），必須 > 0
 * @returns {Float32Array} 長度為 sample_rate × decay_seconds（無條件進位）的取樣
 */
export function generate_impulse_samples(sample_rate, decay_seconds) {
  require_positive_integer(sample_rate, "sample_rate");
  require_positive_number(decay_seconds, "decay_seconds");
  const unit_impulse = new Float32Array(Math.ceil(sample_rate * decay_seconds));
  unit_impulse[0] = 1;
  let impulse_samples = new Float32Array(unit_impulse.length);
  for (const comb_delay_seconds of REVERB_COMB_DELAYS_SECONDS) {
    const feedback_gain = Math.exp((-SIXTY_DECIBEL_DECAY_FACTOR * comb_delay_seconds) / decay_seconds);
    const comb_samples = apply_comb_filter(unit_impulse, Math.max(1, Math.round(comb_delay_seconds * sample_rate)), feedback_gain);
    comb_samples.forEach((sample_value, sample_index) => { impulse_samples[sample_index] += sample_value; });
  }
  for (const allpass_delay_seconds of REVERB_ALLPASS_DELAYS_SECONDS) {
    impulse_samples = apply_allpass_filter(impulse_samples, Math.max(1, Math.round(allpass_delay_seconds * sample_rate)), REVERB_ALLPASS_GAIN);
  }
  const peak_value = impulse_samples.reduce((maximum_value, sample_value) => Math.max(maximum_value, Math.abs(sample_value)), 0);
  return impulse_samples.map((sample_value) => sample_value / peak_value);
}

/**
 * Karplus-Strong 撥弦：一個週期的鋸齒波放進長度等於一個週期的環形緩衝，每繞一圈取相鄰平均並衰減，
 * 高頻先消失，聽起來像吉他或豎琴。
 * Web Audio 的回授迴圈最短延遲是 128 個取樣，高音做不出來，所以在這裡直接算好取樣。
 * @param {number} frequency 音高（Hz），必須 > 0 且低於取樣率的一半
 * @param {number} sample_rate 取樣率，必須是正整數
 * @param {number} duration_seconds 長度（秒），必須 > 0
 * @returns {Float32Array}
 */
export function generate_pluck_samples(frequency, sample_rate, duration_seconds) {
  require_positive_integer(sample_rate, "sample_rate");
  require_positive_number(duration_seconds, "duration_seconds");
  if (!(frequency > 0 && frequency < sample_rate / 2)) throw new RangeError(`frequency 必須介於 0 與 ${sample_rate / 2} 之間，收到 ${frequency}`);
  const period_samples = Math.max(2, Math.round(sample_rate / frequency));
  const ring_buffer = Float32Array.from({ length: period_samples }, (_, ring_index) => (2 * ring_index) / (period_samples - 1) - 1);
  const pluck_samples = new Float32Array(Math.ceil(sample_rate * duration_seconds));
  for (let sample_index = 0; sample_index < pluck_samples.length; sample_index += 1) {
    const ring_index = sample_index % ring_buffer.length;
    const next_ring_index = (ring_index + 1) % ring_buffer.length;
    pluck_samples[sample_index] = ring_buffer[ring_index];
    ring_buffer[ring_index] = PLUCK_DAMPING_FACTOR * 0.5 * (ring_buffer[ring_index] + ring_buffer[next_ring_index]);
  }
  return pluck_samples;
}

// 31 位元 Galois LFSR（線性回授移位暫存器，多項式 x^31 + x^28 + 1，週期 2^31 − 1）。
// 老遊戲機（例如 NES）的雜訊聲道就是這樣做：固定的起始狀態加上位元運算，沒有亂數，每次輸出都一樣。
const NOISE_REGISTER_TAP_MASK = 0x48000000;
const NOISE_REGISTER_START_STATE = 0x2f6e2b1;
// 每個輸出值由 4 個位元組成，幅度有 9 階，比單一位元的 ±1 柔和
const NOISE_BITS_PER_VALUE = 4;

/**
 * 建立一個確定性的雜訊產生器：每呼叫一次回傳下一個介於 ±1 的值，頻譜接近白噪音。
 * 每次建立都從同一個狀態開始，所以同樣的呼叫順序永遠得到同樣的數列。
 * @returns {() => number}
 */
export function create_noise_register() {
  let register_state = NOISE_REGISTER_START_STATE;
  return function next_noise_value() {
    let bit_sum = 0;
    for (let bit_index = 0; bit_index < NOISE_BITS_PER_VALUE; bit_index += 1) {
      const output_bit = register_state & 1;
      register_state >>>= 1;
      if (output_bit) register_state ^= NOISE_REGISTER_TAP_MASK;
      bit_sum += output_bit;
    }
    return (2 * bit_sum) / NOISE_BITS_PER_VALUE - 1;
  };
}

/**
 * 產生一段確定性的寬頻雜訊（輪胎、風切、呼吸聲的來源）。
 * @param {number} sample_rate 取樣率，必須是正整數
 * @param {number} duration_seconds 長度（秒），必須 > 0
 * @returns {Float32Array} 長度為 sample_rate × duration_seconds（無條件進位），值介於 ±1
 */
export function generate_noise_samples(sample_rate, duration_seconds) {
  require_positive_integer(sample_rate, "sample_rate");
  require_positive_number(duration_seconds, "duration_seconds");
  const next_noise_value = create_noise_register();
  return Float32Array.from({ length: Math.ceil(sample_rate * duration_seconds) }, () => next_noise_value());
}
