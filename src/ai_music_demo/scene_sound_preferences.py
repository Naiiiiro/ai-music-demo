"""場景音效偏好（web/scene_sound_preferences.json）的解析、更新與輸出，純計算、不碰檔案或網路。

偏好檔記錄使用者試聽後，每組素材選用「合成」還是「實錄」。沒有紀錄的素材沿用網頁清單的建議。
"""

import json
import re
from dataclasses import dataclass
from typing import Any

PREFERENCE_VERSIONS: frozenset[str] = frozenset({"synthesized", "recorded"})
UTC_TIMESTAMP_PATTERN: re.Pattern[str] = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


class PreferenceFormatError(ValueError):
    """偏好檔或更新請求的格式不符；訊息會指出是哪個欄位。"""


@dataclass(frozen=True)
class SoundPreference:
    """一組素材的選用結果。"""

    asset_id: str
    chosen_version: str
    updated_at: str


@dataclass(frozen=True)
class PreferenceUpdate:
    """網頁送來的一筆更新：把某組素材改成選用某個版本。"""

    asset_id: str
    chosen_version: str


@dataclass(frozen=True)
class PreferenceBook:
    """整份偏好檔，依 asset_id 排序。"""

    preferences: tuple[SoundPreference, ...]


def _require_known_asset(asset_id: Any, known_asset_ids: frozenset[str], field_location: str) -> str:
    """asset_id 必須是規則檔裡有的素材。"""
    if not isinstance(asset_id, str) or asset_id not in known_asset_ids:
        raise PreferenceFormatError(f"{field_location}.asset_id 不在素材清單裡：{asset_id!r}")
    return asset_id


def _require_version(chosen_version: Any, field_location: str) -> str:
    """chosen_version 只接受 synthesized 或 recorded。"""
    if chosen_version not in PREFERENCE_VERSIONS:
        raise PreferenceFormatError(
            f"{field_location}.chosen_version 必須是 synthesized 或 recorded，收到 {chosen_version!r}"
        )
    return chosen_version


def parse_preference_book(raw_book: Any, known_asset_ids: frozenset[str]) -> PreferenceBook:
    """解析偏好檔內容（json.loads 的結果）；格式不符丟出 PreferenceFormatError。"""
    if not isinstance(raw_book, dict) or not isinstance(raw_book.get("preferences"), list):
        raise PreferenceFormatError("偏好檔必須是含 preferences 陣列的物件")
    parsed_preferences: dict[str, SoundPreference] = {}
    for preference_index, raw_preference in enumerate(raw_book["preferences"]):
        field_location = f"preferences[{preference_index}]"
        if not isinstance(raw_preference, dict):
            raise PreferenceFormatError(f"{field_location} 必須是物件")
        asset_id = _require_known_asset(raw_preference.get("asset_id"), known_asset_ids, field_location)
        updated_at = raw_preference.get("updated_at")
        if not isinstance(updated_at, str) or not UTC_TIMESTAMP_PATTERN.fullmatch(updated_at):
            raise PreferenceFormatError(f"{field_location}.updated_at 必須是 UTC 時間（%Y-%m-%dT%H:%M:%SZ）")
        if asset_id in parsed_preferences:
            raise PreferenceFormatError(f"{field_location}.asset_id 重複：{asset_id}")
        chosen_version = _require_version(raw_preference.get("chosen_version"), field_location)
        parsed_preferences[asset_id] = SoundPreference(asset_id, chosen_version, updated_at)
    return PreferenceBook(tuple(sorted(parsed_preferences.values(), key=lambda preference: preference.asset_id)))


def parse_preference_update(raw_update: Any, known_asset_ids: frozenset[str]) -> PreferenceUpdate:
    """解析網頁送來的更新請求 {"asset_id": ..., "chosen_version": ...}；多餘的欄位視為錯誤。"""
    if not isinstance(raw_update, dict) or set(raw_update) != {"asset_id", "chosen_version"}:
        raise PreferenceFormatError("更新請求必須剛好有 asset_id 與 chosen_version 兩個欄位")
    return PreferenceUpdate(
        asset_id=_require_known_asset(raw_update["asset_id"], known_asset_ids, "request"),
        chosen_version=_require_version(raw_update["chosen_version"], "request"),
    )


def apply_preference_update(book: PreferenceBook, update: PreferenceUpdate, updated_at: str) -> PreferenceBook:
    """回傳套用更新後的新偏好檔：同一組素材只留最新一筆。"""
    if not UTC_TIMESTAMP_PATTERN.fullmatch(updated_at):
        raise PreferenceFormatError(f"updated_at 必須是 UTC 時間，收到 {updated_at!r}")
    kept_preferences = [preference for preference in book.preferences if preference.asset_id != update.asset_id]
    kept_preferences.append(SoundPreference(update.asset_id, update.chosen_version, updated_at))
    return PreferenceBook(tuple(sorted(kept_preferences, key=lambda preference: preference.asset_id)))


def preference_book_to_json(book: PreferenceBook) -> str:
    """輸出成偏好檔的文字（縮排兩格、結尾換行），內容固定排序，diff 才好讀。"""
    raw_book = {
        "preferences": [
            {
                "asset_id": preference.asset_id,
                "chosen_version": preference.chosen_version,
                "updated_at": preference.updated_at,
            }
            for preference in book.preferences
        ]
    }
    return json.dumps(raw_book, ensure_ascii=False, indent=2) + "\n"
