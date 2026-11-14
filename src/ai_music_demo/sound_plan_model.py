"""音效規劃的資料型別與 JSON 解析：場景組件、標籤、共用音效素材與規則檔。

純計算，不讀檔；呼叫端先把 JSON 讀成 dict 再交給這裡解析。
"""

import re
from dataclasses import dataclass
from typing import Any

AREA_TAG_PREFIX: str = "a_"


class SoundPlanFormatError(ValueError):
    """規則檔或組件快照的格式不合法。"""


@dataclass(frozen=True)
class ComponentTag:
    """頁面上的一個標籤：類別標籤（每個組件剛好一個）或區域標籤（可有多個）。"""

    tag_id: str
    chinese_name: str
    english_name: str

    @property
    def is_area_tag(self) -> bool:
        """區域標籤的 id 以 a_ 開頭。"""
        return self.tag_id.startswith(AREA_TAG_PREFIX)


@dataclass(frozen=True)
class SceneComponent:
    """場景裡的一個組件；tag_ids 的第一個是它的類別標籤。"""

    component_id: str
    chinese_name: str
    type_tag_id: str
    tag_ids: tuple[str, ...]


@dataclass(frozen=True)
class SoundAsset:
    """一組可被多個組件共用的音效素材；component_patterns 以正規表示式完整比對組件 id。"""

    asset_id: str
    chinese_name: str
    sound_description: str
    reusable_repository_effect: str
    component_patterns: tuple[str, ...]

    def matches_component(self, component_id: str) -> bool:
        """組件 id 是否完整符合任一個比對樣式。"""
        return any(re.fullmatch(pattern, component_id) for pattern in self.component_patterns)


@dataclass(frozen=True)
class BoundaryDecision:
    """使用者確認過的邊界組件決議（目前都是「不設計」）。"""

    component_id: str
    reason: str
    decided_on: str


@dataclass(frozen=True)
class SoundPlanRules:
    """一份 HTML 的音效規劃規則。"""

    report_file_name: str
    judgement_principle: str
    sound_assets: tuple[SoundAsset, ...]
    silent_reason_by_type: dict[str, str]
    boundary_decisions: tuple[BoundaryDecision, ...]


@dataclass(frozen=True)
class ComponentSnapshot:
    """某一版 HTML 執行時取出的完整標籤與組件清單。"""

    source_html_name: str
    tags: tuple[ComponentTag, ...]
    components: tuple[SceneComponent, ...]


def require_field(raw_object: dict[str, Any], field_name: str, context_label: str) -> Any:
    """取出必填欄位；缺少時指出是哪一筆資料。"""
    if field_name not in raw_object:
        raise SoundPlanFormatError(f"{context_label} 缺少欄位 {field_name}：{raw_object!r}")
    return raw_object[field_name]


def parse_sound_asset(raw_asset: dict[str, Any]) -> SoundAsset:
    """解析一筆音效素材，並確認每個比對樣式都是合法的正規表示式。"""
    patterns = tuple(require_field(raw_asset, "component_patterns", "音效素材"))
    if not patterns:
        raise SoundPlanFormatError(f"音效素材沒有任何比對樣式：{raw_asset!r}")
    for pattern in patterns:
        try:
            re.compile(pattern)
        except re.error as pattern_error:
            raise SoundPlanFormatError(f"比對樣式不合法：{pattern!r}") from pattern_error
    return SoundAsset(
        asset_id=require_field(raw_asset, "asset_id", "音效素材"),
        chinese_name=require_field(raw_asset, "chinese_name", "音效素材"),
        sound_description=require_field(raw_asset, "sound_description", "音效素材"),
        reusable_repository_effect=raw_asset.get("reusable_repository_effect", ""),
        component_patterns=patterns,
    )


def parse_sound_plan_rules(raw_rules: dict[str, Any]) -> SoundPlanRules:
    """解析規則檔；素材 id 重複時失敗。"""
    sound_assets = tuple(
        parse_sound_asset(raw_asset) for raw_asset in require_field(raw_rules, "sound_assets", "規則檔")
    )
    asset_identifiers = [asset.asset_id for asset in sound_assets]
    duplicated_identifiers = sorted({name for name in asset_identifiers if asset_identifiers.count(name) > 1})
    if duplicated_identifiers:
        raise SoundPlanFormatError(f"音效素材 id 重複：{duplicated_identifiers}")
    boundary_decisions = tuple(
        BoundaryDecision(
            component_id=require_field(raw_decision, "component_id", "邊界決議"),
            reason=require_field(raw_decision, "reason", "邊界決議"),
            decided_on=require_field(raw_decision, "decided_on", "邊界決議"),
        )
        for raw_decision in raw_rules.get("boundary_decisions", [])
    )
    return SoundPlanRules(
        report_file_name=require_field(raw_rules, "report_file_name", "規則檔"),
        judgement_principle=require_field(raw_rules, "judgement_principle", "規則檔"),
        sound_assets=sound_assets,
        silent_reason_by_type=dict(require_field(raw_rules, "silent_reason_by_type", "規則檔")),
        boundary_decisions=boundary_decisions,
    )


def parse_component_snapshot(raw_snapshot: dict[str, Any]) -> ComponentSnapshot:
    """解析組件快照 JSON（格式與 snapshot_to_json 的輸出相同）。"""
    tags = tuple(
        ComponentTag(
            tag_id=raw_tag["tag_id"], chinese_name=raw_tag["chinese_name"], english_name=raw_tag["english_name"]
        )
        for raw_tag in require_field(raw_snapshot, "tags", "組件快照")
    )
    components = tuple(
        SceneComponent(
            component_id=raw_component["component_id"],
            chinese_name=raw_component["chinese_name"],
            type_tag_id=raw_component["type_tag_id"],
            tag_ids=tuple(raw_component["tag_ids"]),
        )
        for raw_component in require_field(raw_snapshot, "components", "組件快照")
    )
    return ComponentSnapshot(
        source_html_name=require_field(raw_snapshot, "source_html_name", "組件快照"), tags=tags, components=components
    )


def snapshot_to_json(snapshot: ComponentSnapshot) -> dict[str, Any]:
    """把組件快照轉成可寫入檔案的 dict。"""
    return {
        "source_html_name": snapshot.source_html_name,
        "tags": [
            {"tag_id": tag.tag_id, "chinese_name": tag.chinese_name, "english_name": tag.english_name}
            for tag in snapshot.tags
        ],
        "components": [
            {
                "component_id": component.component_id,
                "chinese_name": component.chinese_name,
                "type_tag_id": component.type_tag_id,
                "tag_ids": list(component.tag_ids),
            }
            for component in snapshot.components
        ],
    }
