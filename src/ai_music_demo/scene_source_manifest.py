"""場景 HTML 來源清單（sound_plans/*/scene_source.json）的解析與核對，純計算、不碰檔案或網路。

場景 HTML 約 4 MB，比照實錄音檔放在 GitHub Release 附件；版控只留這份清單，
評估前下載並用 SHA-256 核對，確保每次評估的是同一版頁面。
"""

import hashlib
import re
from dataclasses import dataclass
from typing import Any

SCENE_FILE_NAME_PATTERN: re.Pattern[str] = re.compile(r"^[a-z0-9_-]+\.html$")
SHA256_HEX_PATTERN: re.Pattern[str] = re.compile(r"^[0-9a-f]{64}$")
HTTPS_URL_PREFIX: str = "https://"


class SceneSourceFormatError(ValueError):
    """場景來源清單格式不符；訊息會指出是哪個欄位。"""


@dataclass(frozen=True)
class SceneSource:
    """一份場景 HTML：Release 下載位置、檔名與內容雜湊值。"""

    release_base_url: str
    asset_file_name: str
    sha256: str
    byte_size: int

    @property
    def download_url(self) -> str:
        """這份 HTML 在 GitHub Release 的下載網址。"""
        return f"{self.release_base_url.rstrip('/')}/{self.asset_file_name}"


def require_text_field(raw_source: dict[str, Any], field_name: str) -> str:
    """取出非空字串欄位。"""
    field_value = raw_source.get(field_name)
    if not isinstance(field_value, str) or not field_value:
        raise SceneSourceFormatError(f"{field_name} 必須是非空字串，收到 {field_value!r}")
    return field_value


def parse_scene_source(raw_source: Any) -> SceneSource:
    """解析 scene_source.json 的內容；檔名只接受單一層的 .html，避免寫到資料夾以外。"""
    if not isinstance(raw_source, dict):
        raise SceneSourceFormatError("場景來源清單最外層必須是物件")
    release_base_url = require_text_field(raw_source, "release_base_url")
    asset_file_name = require_text_field(raw_source, "asset_file_name")
    sha256 = require_text_field(raw_source, "sha256")
    byte_size = raw_source.get("byte_size")
    if not release_base_url.startswith(HTTPS_URL_PREFIX):
        raise SceneSourceFormatError(f"release_base_url 必須是 https 網址，收到 {release_base_url!r}")
    if not SCENE_FILE_NAME_PATTERN.fullmatch(asset_file_name):
        raise SceneSourceFormatError(
            f"asset_file_name 只能用小寫英數、底線、連字號並以 .html 結尾，收到 {asset_file_name!r}"
        )
    if not SHA256_HEX_PATTERN.fullmatch(sha256):
        raise SceneSourceFormatError("sha256 必須是 64 個小寫十六進位字元")
    if not isinstance(byte_size, int) or isinstance(byte_size, bool) or byte_size <= 0:
        raise SceneSourceFormatError(f"byte_size 必須是正整數，收到 {byte_size!r}")
    return SceneSource(release_base_url, asset_file_name, sha256, byte_size)


def content_matches_scene(file_content: bytes, scene_source: SceneSource) -> bool:
    """檔案內容的大小與 SHA-256 是否都和清單記錄的一致。"""
    if len(file_content) != scene_source.byte_size:
        return False
    return hashlib.sha256(file_content).hexdigest() == scene_source.sha256
