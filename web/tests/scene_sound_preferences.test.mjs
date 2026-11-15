// scene_sound_preferences 的單元測試（純計算）與版控裡偏好檔的格式檢查。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SCENE_SOUND_CATALOG } from "../scene_sound_catalog.js";
import { parse_preference_book, selected_version_of, summarize_selection } from "../scene_sound_preferences.js";

const PREFERENCE_FILE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "scene_sound_preferences.json");
const KNOWN_ASSET_IDS = Object.freeze(["dog_bark", "flowing_water"]);
const CATALOG_ENTRIES = Object.freeze([
  { asset_id: "dog_bark", recommended_version: "recorded" },
  { asset_id: "flowing_water", recommended_version: "synthesized" },
]);
const build_preference = (field_overrides = {}) => ({ asset_id: "dog_bark", chosen_version: "synthesized", updated_at: "2026-11-15T10:00:00Z", ...field_overrides });

test("repository preference file parses against the catalog", () => {
  const raw_preference_book = JSON.parse(readFileSync(PREFERENCE_FILE_PATH, "utf8"));
  assert.doesNotThrow(() => parse_preference_book(raw_preference_book, SCENE_SOUND_CATALOG.map((catalog_entry) => catalog_entry.asset_id)));
});

test("preference overrides the recommendation and missing preference keeps it", () => {
  const preferences_by_asset = parse_preference_book({ preferences: [build_preference()] }, KNOWN_ASSET_IDS);
  assert.equal(selected_version_of(CATALOG_ENTRIES[0], preferences_by_asset), "synthesized");
  assert.equal(selected_version_of(CATALOG_ENTRIES[1], preferences_by_asset), "synthesized");
  assert.equal(selected_version_of(CATALOG_ENTRIES[0], {}), "recorded");
});

test("summary counts overrides and only selected recordings", () => {
  const recordings_by_asset = { dog_bark: { byte_size: 100 }, flowing_water: { byte_size: 900 } };
  const preferences_by_asset = parse_preference_book({ preferences: [build_preference({ asset_id: "flowing_water", chosen_version: "recorded" })] }, KNOWN_ASSET_IDS);
  assert.deepEqual(summarize_selection(CATALOG_ENTRIES, preferences_by_asset, recordings_by_asset),
    { recorded_count: 2, synthesized_count: 0, overridden_count: 1, recorded_bytes: 1000 });
  assert.deepEqual(summarize_selection(CATALOG_ENTRIES, {}, recordings_by_asset),
    { recorded_count: 1, synthesized_count: 1, overridden_count: 0, recorded_bytes: 100 });
});

const INVALID_PREFERENCES = Object.freeze([
  ["unknown asset", build_preference({ asset_id: "unicorn" }), RangeError],
  ["unknown version", build_preference({ chosen_version: "both" }), RangeError],
  ["local time", build_preference({ updated_at: "2026-11-15T18:00:00+08:00" }), TypeError],
]);

for (const [scenario_name, raw_preference, expected_error] of INVALID_PREFERENCES) {
  test(`${scenario_name} is rejected`, () => {
    assert.throws(() => parse_preference_book({ preferences: [raw_preference] }, KNOWN_ASSET_IDS), expected_error);
  });
}

test("duplicate asset and missing list are rejected", () => {
  assert.throws(() => parse_preference_book({ preferences: [build_preference(), build_preference()] }, KNOWN_ASSET_IDS), RangeError);
  assert.throws(() => parse_preference_book({}, KNOWN_ASSET_IDS), TypeError);
});
