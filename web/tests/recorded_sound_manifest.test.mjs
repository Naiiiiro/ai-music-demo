// recorded_sound_manifest 的單元測試（純計算、不連網）：node --test web/tests
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse_recorded_sound_manifest, recording_file_url } from "../recorded_sound_manifest.js";
import { SOUND_EFFECT_SCENES } from "../sound_effects.js";

const MANIFEST_FILE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "recorded_sounds.json");
const KNOWN_EFFECT_NAMES = Object.keys(SOUND_EFFECT_SCENES);

function build_raw_recording(field_overrides = {}) {
  return {
    effect_name: "cat",
    asset_file_name: "cat_meow.mp3",
    title: "Cat meow",
    author: "someone",
    license_name: "CC0 1.0",
    license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
    source_page_url: "https://freesound.org/people/someone/sounds/1/",
    ...field_overrides,
  };
}

test("repository manifest has one recording for every synthesized effect", () => {
  const raw_manifest = JSON.parse(readFileSync(MANIFEST_FILE_PATH, "utf8"));
  const recordings_by_effect = parse_recorded_sound_manifest(raw_manifest, KNOWN_EFFECT_NAMES);
  assert.deepEqual(Object.keys(recordings_by_effect).sort(), [...KNOWN_EFFECT_NAMES].sort());
});

test("recording file url stays on the same site", () => {
  assert.equal(recording_file_url({ asset_file_name: "cat_meow.mp3" }), "./recorded_sounds/cat_meow.mp3");
});

test("unknown effect name is rejected", () => {
  const raw_manifest = { recordings: [build_raw_recording({ effect_name: "dog" })] };
  assert.throws(() => parse_recorded_sound_manifest(raw_manifest, KNOWN_EFFECT_NAMES), RangeError);
});

test("duplicate effect name is rejected", () => {
  const raw_manifest = { recordings: [build_raw_recording(), build_raw_recording({ asset_file_name: "cat_two.mp3" })] };
  assert.throws(() => parse_recorded_sound_manifest(raw_manifest, KNOWN_EFFECT_NAMES), /重複/);
});

test("path traversal in asset file name is rejected", () => {
  const raw_manifest = { recordings: [build_raw_recording({ asset_file_name: "../index.mp3" })] };
  assert.throws(() => parse_recorded_sound_manifest(raw_manifest, KNOWN_EFFECT_NAMES), /asset_file_name/);
});

test("non https source link is rejected", () => {
  const raw_manifest = { recordings: [build_raw_recording({ source_page_url: "javascript:alert(1)" })] };
  assert.throws(() => parse_recorded_sound_manifest(raw_manifest, KNOWN_EFFECT_NAMES), /source_page_url/);
});

test("missing recordings array is rejected", () => {
  assert.throws(() => parse_recorded_sound_manifest({}, KNOWN_EFFECT_NAMES), TypeError);
});
