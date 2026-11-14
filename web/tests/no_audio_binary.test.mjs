// 守門測試：網頁版的音訊只能在瀏覽器現場產生，web/ 底下不得有任何音訊檔，頁面也不得引用音訊檔。
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const WEB_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUDIO_FILE_PATTERN = /\.(wav|m4a|aac|mp3|ogg|flac)$/i;

test("web directory contains no audio files", () => {
  const audio_file_paths = readdirSync(WEB_DIRECTORY, { recursive: true }).filter((relative_path) => AUDIO_FILE_PATTERN.test(relative_path));
  assert.deepEqual(audio_file_paths, []);
});

test("page does not reference audio files", () => {
  const page_source = readFileSync(join(WEB_DIRECTORY, "index.html"), "utf8");
  assert.doesNotMatch(page_source, /["'][^"']*\.(wav|m4a|aac|mp3|ogg|flac)["']/i);
});
