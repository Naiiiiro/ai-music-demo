/**
 * 實錄音檔來源清單（recorded_sounds.json）的解析，純計算、不碰網路，可在 Node 測試。
 * 清單在版控裡；音檔本身部署時才由 fetch-recorded-sounds 從 GitHub Release 下載到 recorded_sounds/。
 */

export const RECORDED_SOUND_MANIFEST_PATH = "./recorded_sounds.json";
export const RECORDED_SOUND_DIRECTORY = "./recorded_sounds";

const ASSET_FILE_NAME_PATTERN = /^[a-z0-9_]+\.mp3$/;
const REQUIRED_TEXT_FIELDS = Object.freeze([
  "effect_name", "asset_file_name", "title", "author", "license_name", "license_url", "source_page_url",
]);
const LINK_FIELDS = Object.freeze(["license_url", "source_page_url"]);

function parse_recording(raw_recording, recording_index) {
  const location_prefix = `recordings[${recording_index}]`;
  if (typeof raw_recording !== "object" || raw_recording === null) throw new TypeError(`${location_prefix} 必須是物件`);
  for (const field_name of REQUIRED_TEXT_FIELDS) {
    if (typeof raw_recording[field_name] !== "string" || raw_recording[field_name] === "") {
      throw new TypeError(`${location_prefix}.${field_name} 必須是非空字串`);
    }
  }
  if (!ASSET_FILE_NAME_PATTERN.test(raw_recording.asset_file_name)) {
    throw new TypeError(`${location_prefix}.asset_file_name 格式不符：${raw_recording.asset_file_name}`);
  }
  for (const field_name of LINK_FIELDS) {
    if (!raw_recording[field_name].startsWith("https://")) throw new TypeError(`${location_prefix}.${field_name} 必須是 https 網址`);
  }
  return Object.freeze(Object.fromEntries(REQUIRED_TEXT_FIELDS.map((field_name) => [field_name, raw_recording[field_name]])));
}

/**
 * 解析來源清單，回傳「音效名稱 → 實錄資料」的對照表。
 * @param {unknown} raw_manifest recorded_sounds.json 經 JSON.parse 的結果
 * @param {string[]} known_effect_names 頁面上有的音效名稱；清單裡出現其他名稱視為錯誤
 * @returns {Readonly<Record<string, Readonly<object>>>}
 */
export function parse_recorded_sound_manifest(raw_manifest, known_effect_names) {
  if (!Array.isArray(raw_manifest?.recordings)) throw new TypeError("recordings 必須是陣列");
  const recordings_by_effect = {};
  raw_manifest.recordings.forEach((raw_recording, recording_index) => {
    const recording = parse_recording(raw_recording, recording_index);
    if (!known_effect_names.includes(recording.effect_name)) throw new RangeError(`沒有這個音效：${recording.effect_name}`);
    if (Object.hasOwn(recordings_by_effect, recording.effect_name)) throw new RangeError(`音效重複：${recording.effect_name}`);
    recordings_by_effect[recording.effect_name] = recording;
  });
  return Object.freeze(recordings_by_effect);
}

/**
 * 實錄音檔在網站上的相對網址（與網頁同一個網站，不連第三方）。
 * @param {{asset_file_name: string}} recording
 * @returns {string}
 */
export function recording_file_url(recording) {
  return `${RECORDED_SOUND_DIRECTORY}/${recording.asset_file_name}`;
}
