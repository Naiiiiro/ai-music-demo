// sound_effects 不碰 Web Audio 部分的單元測試，使用 Node 內建測試框架：node --test web/tests
import assert from "node:assert/strict";
import { test } from "node:test";
import { SOUND_EFFECT_SCENES, start_sound_effect } from "../sound_effects.js";

test("sound effect scenes are engine traffic and cat", () => {
  assert.deepEqual(Object.keys(SOUND_EFFECT_SCENES).sort(), ["cat", "engine", "traffic"]);
});

test("unknown sound effect throws before touching web audio", () => {
  assert.throws(() => start_sound_effect("dog", () => {}), RangeError);
});
