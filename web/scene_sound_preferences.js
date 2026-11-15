/**
 * 場景音效的使用者偏好（純計算，不碰網路）：每組素材最後選用「合成」還是「實錄」。
 * 偏好檔 scene_sound_preferences.json 在版控裡，由本機的 serve-scene-sounds 寫入；
 * 沒有偏好紀錄的素材沿用 scene_sound_catalog 的建議。
 */

export const SCENE_PREFERENCE_FILE_PATH = "./scene_sound_preferences.json";
export const SCENE_PREFERENCE_API_PATH = "./api/scene-sound-preferences";
export const PREFERENCE_VERSIONS = Object.freeze(["synthesized", "recorded"]);
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * 解析偏好檔，回傳「素材 id → 偏好紀錄」。未知的素材、版本或時間格式都視為錯誤。
 * @param {unknown} raw_preference_book 偏好檔經 JSON.parse 的結果
 * @param {readonly string[]} known_asset_ids 清單裡的素材 id
 * @returns {Readonly<Record<string, Readonly<{asset_id: string, chosen_version: string, updated_at: string}>>>}
 */
export function parse_preference_book(raw_preference_book, known_asset_ids) {
  if (!Array.isArray(raw_preference_book?.preferences)) throw new TypeError("preferences 必須是陣列");
  const preferences_by_asset = {};
  raw_preference_book.preferences.forEach((raw_preference, preference_index) => {
    const location_prefix = `preferences[${preference_index}]`;
    if (!known_asset_ids.includes(raw_preference?.asset_id)) throw new RangeError(`${location_prefix}.asset_id 不在清單裡：${raw_preference?.asset_id}`);
    if (!PREFERENCE_VERSIONS.includes(raw_preference.chosen_version)) throw new RangeError(`${location_prefix}.chosen_version 必須是 synthesized 或 recorded`);
    if (!UTC_TIMESTAMP_PATTERN.test(raw_preference.updated_at)) throw new TypeError(`${location_prefix}.updated_at 必須是 UTC 時間（…Z）`);
    if (Object.hasOwn(preferences_by_asset, raw_preference.asset_id)) throw new RangeError(`${location_prefix}.asset_id 重複：${raw_preference.asset_id}`);
    preferences_by_asset[raw_preference.asset_id] = Object.freeze({
      asset_id: raw_preference.asset_id, chosen_version: raw_preference.chosen_version, updated_at: raw_preference.updated_at });
  });
  return Object.freeze(preferences_by_asset);
}

/**
 * 某組素材目前選用的版本：有偏好紀錄就用紀錄，否則用建議。
 * @param {{asset_id: string, recommended_version: string}} catalog_entry
 * @param {Readonly<Record<string, {chosen_version: string}>>} preferences_by_asset
 * @returns {string}
 */
export function selected_version_of(catalog_entry, preferences_by_asset) {
  return preferences_by_asset[catalog_entry.asset_id]?.chosen_version ?? catalog_entry.recommended_version;
}

/**
 * 依目前的選用結果做統計：改選幾組、選用實錄的檔案合計多大。
 * @param {readonly {asset_id: string, recommended_version: string}[]} catalog_entries
 * @param {Readonly<Record<string, {chosen_version: string}>>} preferences_by_asset
 * @param {Readonly<Record<string, {byte_size: number}>>} recordings_by_asset
 * @returns {{recorded_count: number, synthesized_count: number, overridden_count: number, recorded_bytes: number}}
 */
export function summarize_selection(catalog_entries, preferences_by_asset, recordings_by_asset) {
  const selection_summary = { recorded_count: 0, synthesized_count: 0, overridden_count: 0, recorded_bytes: 0 };
  for (const catalog_entry of catalog_entries) {
    const chosen_version = selected_version_of(catalog_entry, preferences_by_asset);
    if (chosen_version !== catalog_entry.recommended_version) selection_summary.overridden_count += 1;
    if (chosen_version === "synthesized") {
      selection_summary.synthesized_count += 1;
      continue;
    }
    selection_summary.recorded_count += 1;
    selection_summary.recorded_bytes += recordings_by_asset[catalog_entry.asset_id]?.byte_size ?? 0;
  }
  return selection_summary;
}
