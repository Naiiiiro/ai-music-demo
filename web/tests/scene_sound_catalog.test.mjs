// scene_sound_catalog 與三個配方模組的測試：清單和評估規則一致、每個配方都產生合理的取樣、實錄清單涵蓋每一組。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse_recorded_sound_manifest } from "../recorded_sound_manifest.js";
import { CATALOG_GROUPS, RECOMMENDED_VERSIONS, SCENE_SOUND_CATALOG } from "../scene_sound_catalog.js";
import { SOUND_EFFECT_SCENES } from "../sound_effects.js";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOUND_RULES_PATH = join(REPOSITORY_ROOT, "sound_plans", "screw_press_separator", "sound_rules.json");
const SCENE_MANIFEST_PATH = join(REPOSITORY_ROOT, "web", "scene_recorded_sounds.json");
const TEST_SAMPLE_RATE = 8000;
const MAXIMUM_RENDER_SECONDS = 15;
const MINIMUM_RENDER_SECONDS = 1;
// 動物與人聲建議實錄，其餘建議合成
const EXPECTED_RECORDED_ASSET_IDS = Object.freeze([
  "ballgame", "cat_meow", "cattle_moo", "chicken_cluck", "crowd_chatter", "dog_bark", "duck_quack",
  "frog_chorus", "goose_honk", "hawk_call", "sheep_bleat", "snoring", "sparrow_chirp",
]);

const catalog_asset_ids = SCENE_SOUND_CATALOG.map((catalog_entry) => catalog_entry.asset_id);
const rendered_entries = SCENE_SOUND_CATALOG.filter((catalog_entry) => catalog_entry.synthesis_source.render_samples);

test("catalog covers exactly the shared assets of the sound plan rules", () => {
  const sound_rules = JSON.parse(readFileSync(SOUND_RULES_PATH, "utf8"));
  const rule_asset_ids = sound_rules.sound_assets.map((sound_asset) => sound_asset.asset_id);
  assert.equal(new Set(catalog_asset_ids).size, catalog_asset_ids.length);
  assert.deepEqual([...catalog_asset_ids].sort(), [...rule_asset_ids].sort());
});

test("only animal and human sounds are recommended as recordings", () => {
  const recorded_asset_ids = SCENE_SOUND_CATALOG.filter((catalog_entry) => catalog_entry.recommended_version === "recorded")
    .map((catalog_entry) => catalog_entry.asset_id);
  assert.deepEqual(recorded_asset_ids.sort(), [...EXPECTED_RECORDED_ASSET_IDS]);
});

test("every entry has a valid recommendation, reason and group", () => {
  const group_ids = CATALOG_GROUPS.map((catalog_group) => catalog_group.group_id);
  for (const catalog_entry of SCENE_SOUND_CATALOG) {
    assert.ok(RECOMMENDED_VERSIONS.includes(catalog_entry.recommended_version), catalog_entry.asset_id);
    assert.ok(catalog_entry.recommendation_reason.length > 0, catalog_entry.asset_id);
    assert.ok(group_ids.includes(catalog_entry.group_id), catalog_entry.asset_id);
  }
});

test("every entry has exactly one synthesis source and existing scenes exist", () => {
  for (const { asset_id, synthesis_source } of SCENE_SOUND_CATALOG) {
    const has_recipe = typeof synthesis_source.render_samples === "function";
    const has_existing_scene = typeof synthesis_source.existing_effect_name === "string";
    assert.ok(has_recipe !== has_existing_scene, asset_id);
    if (has_existing_scene) assert.ok(Object.hasOwn(SOUND_EFFECT_SCENES, synthesis_source.existing_effect_name), asset_id);
  }
});

for (const catalog_entry of rendered_entries) {
  test(`${catalog_entry.asset_id} renders a bounded, audible, deterministic clip`, () => {
    const rendered_samples = catalog_entry.synthesis_source.render_samples(TEST_SAMPLE_RATE);
    const rendered_seconds = rendered_samples.length / TEST_SAMPLE_RATE;
    assert.ok(rendered_seconds >= MINIMUM_RENDER_SECONDS && rendered_seconds <= MAXIMUM_RENDER_SECONDS, `${rendered_seconds} 秒`);
    let peak_value = 0;
    for (const sample_value of rendered_samples) {
      assert.ok(Number.isFinite(sample_value));
      peak_value = Math.max(peak_value, Math.abs(sample_value));
    }
    assert.ok(peak_value > 0.1 && peak_value <= 1, `峰值 ${peak_value}`);
    assert.deepEqual(catalog_entry.synthesis_source.render_samples(TEST_SAMPLE_RATE), rendered_samples);
  });
}

test("scene recording manifest has one recording for every catalog entry", () => {
  const raw_manifest = JSON.parse(readFileSync(SCENE_MANIFEST_PATH, "utf8"));
  const recordings_by_asset = parse_recorded_sound_manifest(raw_manifest, catalog_asset_ids);
  assert.deepEqual(Object.keys(recordings_by_asset).sort(), [...catalog_asset_ids].sort());
  assert.ok(raw_manifest.release_base_url.endsWith("/scene-assets-v1"));
});

test("rendered entries carry a level offset and only the diesel generator is turned down", () => {
  const offset_entries = rendered_entries.filter((catalog_entry) => catalog_entry.synthesis_source.level_offset_decibels !== 0);
  assert.ok(rendered_entries.every((catalog_entry) => Number.isFinite(catalog_entry.synthesis_source.level_offset_decibels)));
  assert.deepEqual(offset_entries.map((catalog_entry) => [catalog_entry.asset_id, catalog_entry.synthesis_source.level_offset_decibels]), [["diesel_generator", -6]]);
});
