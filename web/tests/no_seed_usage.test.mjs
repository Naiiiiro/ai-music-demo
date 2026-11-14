// 守門測試：網頁版全部用寫定的規則與確定性的訊號合成，不得出現亂數種子或 Math.random。
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const WEB_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_FILE_PATTERN = /\.(js|html)$/;
const RANDOMNESS_PATTERN = /seed|Math\.random/i;

test("web sources use no random seed or Math.random", () => {
  const offending_paths = readdirSync(WEB_DIRECTORY)
    .filter((file_name) => SOURCE_FILE_PATTERN.test(file_name))
    .filter((file_name) => RANDOMNESS_PATTERN.test(readFileSync(join(WEB_DIRECTORY, file_name), "utf8")));
  assert.deepEqual(offending_paths, []);
});
