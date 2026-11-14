"""實錄音檔來源清單（web/recorded_sounds.json）的解析與核對，純計算、不碰檔案或網路。

清單是版控裡唯一記錄實錄音檔的地方：音檔本身放在 GitHub Release 附件，部署時才下載，
下載後用清單裡的 SHA-256 核對內容，確保每次部署拿到的檔案都一樣。
"""

import hashlib
import re
from dataclasses import dataclass
from typing import Any

ASSET_FILE_NAME_PATTERN: re.Pattern[str] = re.compile(r"^[a-z0-9_]+\.mp3$")
SHA256_HEX_PATTERN: re.Pattern[str] = re.compile(r"^[0-9a-f]{64}$")
HTTPS_URL_PREFIX: str = "https://"
RECORDING_TEXT_FIELDS: tuple[str, ...] = (
    "effect_name",
    "asset_file_name",
    "sha256",
    "title",
    "author",
    "license_name",
    "license_url",
    "source_page_url",
)
RECORDING_URL_FIELDS: tuple[str, ...] = ("license_url", "source_page_url")


@dataclass(frozen=True)
class RecordedSound:
    """一個實錄音檔：存放位置、內容雜湊值與授權來源。"""

    effect_name: str
    asset_file_name: str
    sha256: str
    byte_size: int
    title: str
    author: str
    license_name: str
    license_url: str
    source_page_url: str


@dataclass(frozen=True)
class RecordedSoundManifest:
    """整份來源清單：Release 下載網址的前綴與所有實錄音檔。"""

    release_base_url: str
    recordings: tuple[RecordedSound, ...]

    def asset_download_url(self, recording: RecordedSound) -> str:
        """回傳某個音檔在 GitHub Release 的下載網址。"""
        return f"{self.release_base_url.rstrip('/')}/{recording.asset_file_name}"


class ManifestFormatError(ValueError):
    """來源清單格式不符；訊息會指出是哪一筆、哪個欄位。"""


def _require_https_url(field_value: str, field_location: str) -> None:
    """網址欄位只接受 https，避免部署時從未加密的來源下載。"""
    if not field_value.startswith(HTTPS_URL_PREFIX):
        raise ManifestFormatError(f"{field_location} 必須是 https 網址，收到 {field_value!r}")


def _parse_recording(raw_recording: Any, recording_index: int) -> RecordedSound:
    """把清單裡的一筆資料轉成 RecordedSound，任何欄位不合格就丟出 ManifestFormatError。"""
    location_prefix = f"recordings[{recording_index}]"
    if not isinstance(raw_recording, dict):
        raise ManifestFormatError(f"{location_prefix} 必須是物件")
    for field_name in RECORDING_TEXT_FIELDS:
        field_value = raw_recording.get(field_name)
        if not isinstance(field_value, str) or not field_value:
            raise ManifestFormatError(f"{location_prefix}.{field_name} 必須是非空字串")
    byte_size = raw_recording.get("byte_size")
    if not isinstance(byte_size, int) or isinstance(byte_size, bool) or byte_size <= 0:
        raise ManifestFormatError(f"{location_prefix}.byte_size 必須是正整數，收到 {byte_size!r}")
    if not ASSET_FILE_NAME_PATTERN.fullmatch(raw_recording["asset_file_name"]):
        raise ManifestFormatError(
            f"{location_prefix}.asset_file_name 只能用小寫英數與底線並以 .mp3 結尾，收到 {raw_recording['asset_file_name']!r}"
        )
    if not SHA256_HEX_PATTERN.fullmatch(raw_recording["sha256"]):
        raise ManifestFormatError(f"{location_prefix}.sha256 必須是 64 個小寫十六進位字元")
    for field_name in RECORDING_URL_FIELDS:
        _require_https_url(raw_recording[field_name], f"{location_prefix}.{field_name}")
    return RecordedSound(
        byte_size=byte_size, **{field_name: raw_recording[field_name] for field_name in RECORDING_TEXT_FIELDS}
    )


def parse_recorded_sound_manifest(raw_manifest: Any) -> RecordedSoundManifest:
    """解析 recorded_sounds.json 的內容（已由 json 模組讀成 Python 物件）。

    參數：raw_manifest 為 json.loads 的結果。
    回傳：RecordedSoundManifest。
    例外：格式不符時丟出 ManifestFormatError，訊息指出欄位位置。
    """
    if not isinstance(raw_manifest, dict):
        raise ManifestFormatError("來源清單最外層必須是物件")
    release_base_url = raw_manifest.get("release_base_url")
    if not isinstance(release_base_url, str):
        raise ManifestFormatError("release_base_url 必須是字串")
    _require_https_url(release_base_url, "release_base_url")
    raw_recordings = raw_manifest.get("recordings")
    if not isinstance(raw_recordings, list) or not raw_recordings:
        raise ManifestFormatError("recordings 必須是非空陣列")
    recordings = tuple(
        _parse_recording(raw_recording, recording_index) for recording_index, raw_recording in enumerate(raw_recordings)
    )
    asset_file_names = [recording.asset_file_name for recording in recordings]
    if len(set(asset_file_names)) != len(asset_file_names):
        raise ManifestFormatError(f"asset_file_name 不可重複：{asset_file_names}")
    return RecordedSoundManifest(release_base_url=release_base_url, recordings=recordings)


def content_matches_recording(file_content: bytes, recording: RecordedSound) -> bool:
    """檔案內容的大小與 SHA-256 是否都和清單記錄的一致。"""
    if len(file_content) != recording.byte_size:
        return False
    return hashlib.sha256(file_content).hexdigest() == recording.sha256
