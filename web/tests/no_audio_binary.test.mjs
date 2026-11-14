// 守門測試：版控裡不得有任何音訊檔，頁面也不得直接寫死音訊檔網址。
// 實錄音檔放在 GitHub Release 附件，部署時才下載到 web/recorded_sounds/，所以這裡檢查的是「git 追蹤的檔案」，
// 不是磁碟上的檔案。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const WEB_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUDIO_FILE_PATTERN = /\.(wav|m4a|aac|mp3|ogg|flac)$/i;

const GIT_COMMAND_TIMEOUT_MILLISECONDS = 5000;

test("version control tracks no audio files", () => {
  const tracked_file_list = execFileSync("git", ["ls-files", "--full-name", ":/"], {
    cwd: WEB_DIRECTORY, encoding: "utf8", timeout: GIT_COMMAND_TIMEOUT_MILLISECONDS,
  });
  const tracked_audio_paths = tracked_file_list.split("\n").filter((tracked_path) => AUDIO_FILE_PATTERN.test(tracked_path));
  assert.deepEqual(tracked_audio_paths, []);
});

test("downloaded recording directory is ignored by version control", () => {
  const ignored_check = execFileSync("git", ["check-ignore", "recorded_sounds/cat_meow.mp3"], {
    cwd: WEB_DIRECTORY, encoding: "utf8", timeout: GIT_COMMAND_TIMEOUT_MILLISECONDS,
  });
  assert.match(ignored_check, /recorded_sounds\/cat_meow\.mp3/);
});

test("page does not reference audio files", () => {
  const page_source = readFileSync(join(WEB_DIRECTORY, "index.html"), "utf8");
  assert.doesNotMatch(page_source, /["'][^"']*\.(wav|m4a|aac|mp3|ogg|flac)["']/i);
});
