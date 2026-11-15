/**
 * 音量對齊（純計算，不碰 Web Audio）：量出一段聲音「有聲部分」的平均音量，算出把它拉到共同目標所需的增益，
 * 合成版與實錄版才能用同樣的響度比較。
 *
 * 量法是 EBU R128／LUFS 的簡化版：切成 100 ms 的小窗算能量，先丟掉幾乎無聲的窗（絕對門檻），
 * 再丟掉比平均小 10 dB 以上的窗（相對門檻），剩下的窗取平均。這樣狗叫這種「短短幾聲加大段安靜」的錄音，
 * 不會因為安靜段把平均拉低而被放得過大。沒有做 K 加權（頻率加權），所以低頻很多的聲音聽起來會稍微偏大。
 */

const LOUDNESS_WINDOW_SECONDS = 0.1;
// 絕對門檻：能量低於 -70 dBFS 的窗當作無聲
const ABSOLUTE_GATE_ENERGY = 10 ** (-70 / 10);
// 相對門檻：比通過絕對門檻的平均能量小 10 dB 的窗也不算
const RELATIVE_GATE_RATIO = 10 ** (-10 / 10);
/** 所有音效對齊到的響度（有聲部分的 RMS），約 -20 dBFS，留空間給峰值。 */
export const TARGET_LOUDNESS_RMS = 0.1;
/**
 * 增益上限（+30 dB），避免把幾乎無聲的檔案放大成一片雜訊。
 * 實錄裡最小聲的是考古挖掘（約 -48 dBFS），需要 +28 dB 才到目標，所以上限不能再低。
 */
export const MAXIMUM_MATCHING_GAIN = 10 ** (30 / 20);

function require_channel_list(channel_list, sample_rate) {
  if (!Number.isInteger(sample_rate) || sample_rate <= 0) throw new RangeError(`sample_rate 必須是正整數，收到 ${sample_rate}`);
  if (channel_list.length === 0) throw new RangeError("channel_list 至少要有一個聲道");
  const channel_length = channel_list[0].length;
  if (channel_list.some((channel_samples) => channel_samples.length !== channel_length)) throw new RangeError("各聲道長度必須相同");
}

function window_energies(channel_list, sample_rate) {
  const window_length = Math.max(1, Math.round(LOUDNESS_WINDOW_SECONDS * sample_rate));
  const sample_count = channel_list[0].length;
  const energy_list = [];
  for (let window_start = 0; window_start < sample_count; window_start += window_length) {
    const window_end = Math.min(sample_count, window_start + window_length);
    let energy_sum = 0;
    for (const channel_samples of channel_list) {
      for (let sample_index = window_start; sample_index < window_end; sample_index += 1) energy_sum += channel_samples[sample_index] ** 2;
    }
    energy_list.push(energy_sum / ((window_end - window_start) * channel_list.length));
  }
  return energy_list;
}

const average_of = (value_list) => value_list.reduce((sum_value, list_value) => sum_value + list_value, 0) / value_list.length;

/**
 * 量測有聲部分的響度（RMS，線性值）。整段幾乎無聲時回傳 0。
 * @param {readonly Float32Array[]} channel_list 各聲道的取樣，長度必須相同
 * @param {number} sample_rate 取樣率，必須是正整數
 * @returns {number}
 */
export function measure_gated_loudness(channel_list, sample_rate) {
  require_channel_list(channel_list, sample_rate);
  if (channel_list[0].length === 0) return 0;
  const audible_energies = window_energies(channel_list, sample_rate).filter((window_energy) => window_energy > ABSOLUTE_GATE_ENERGY);
  if (audible_energies.length === 0) return 0;
  const relative_gate_energy = average_of(audible_energies) * RELATIVE_GATE_RATIO;
  return Math.sqrt(average_of(audible_energies.filter((window_energy) => window_energy >= relative_gate_energy)));
}

/**
 * 把這段聲音對齊到 TARGET_LOUDNESS_RMS 所需的增益，不超過 MAXIMUM_MATCHING_GAIN；無聲時回傳 1（不放大）。
 * @param {readonly Float32Array[]} channel_list
 * @param {number} sample_rate
 * @returns {number}
 */
export function loudness_matching_gain(channel_list, sample_rate) {
  const measured_loudness = measure_gated_loudness(channel_list, sample_rate);
  if (measured_loudness === 0) return 1;
  return Math.min(MAXIMUM_MATCHING_GAIN, TARGET_LOUDNESS_RMS / measured_loudness);
}
