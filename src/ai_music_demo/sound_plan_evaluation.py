"""依規則評估每個組件要不要設計音效、共用哪些素材，並統計去重後的數量與版本差異。

純計算：輸入是解析好的快照與規則，輸出是 SoundPlanEvaluation。
"""

import re
from dataclasses import dataclass

from ai_music_demo.sound_plan_model import (
    BoundaryDecision,
    ComponentSnapshot,
    ComponentTag,
    SceneComponent,
    SoundAsset,
    SoundPlanFormatError,
    SoundPlanRules,
)

UNLISTED_SILENT_REASON: str = "沒有列入任何音效素材"


@dataclass(frozen=True)
class TagEvaluation:
    """一個標籤底下，建議設計與不設計音效的組件。"""

    tag: ComponentTag
    designed_components: tuple[SceneComponent, ...]
    silent_components: tuple[SceneComponent, ...]


@dataclass(frozen=True)
class VersionDifference:
    """和上一份快照相比，新增與移除的組件。"""

    added_components: tuple[SceneComponent, ...]
    removed_components: tuple[SceneComponent, ...]


@dataclass(frozen=True)
class SoundPlanEvaluation:
    """整份 HTML 的評估結果。"""

    snapshot: ComponentSnapshot
    rules: SoundPlanRules
    assets_by_component: dict[str, tuple[SoundAsset, ...]]
    tag_evaluations: tuple[TagEvaluation, ...]
    version_difference: VersionDifference | None
    rule_warnings: tuple[str, ...]

    @property
    def designed_components(self) -> tuple[SceneComponent, ...]:
        """去重後需設計音效的組件。"""
        return tuple(c for c in self.snapshot.components if self.assets_by_component[c.component_id])

    @property
    def designed_count_with_duplicates(self) -> int:
        """各標籤「建議設計」直接相加的數量（同一組件會被重複計算）。"""
        return sum(len(tag_evaluation.designed_components) for tag_evaluation in self.tag_evaluations)

    def components_using_asset(self, asset: SoundAsset) -> tuple[SceneComponent, ...]:
        """使用某個音效素材的組件。"""
        return tuple(c for c in self.snapshot.components if asset in self.assets_by_component[c.component_id])

    def silent_reason(self, component: SceneComponent) -> str:
        """不設計音效的理由：邊界決議優先，其次是類別預設理由。"""
        for decision in self.rules.boundary_decisions:
            if decision.component_id == component.component_id:
                return decision.reason
        return self.rules.silent_reason_by_type.get(component.type_tag_id, UNLISTED_SILENT_REASON)


def match_component_assets(
    components: tuple[SceneComponent, ...], sound_assets: tuple[SoundAsset, ...]
) -> dict[str, tuple[SoundAsset, ...]]:
    """找出每個組件用到的音效素材；沒有素材代表不設計音效。"""
    return {
        component.component_id: tuple(
            asset for asset in sound_assets if asset.matches_component(component.component_id)
        )
        for component in components
    }


def ensure_boundary_decisions_are_silent(
    boundary_decisions: tuple[BoundaryDecision, ...], assets_by_component: dict[str, tuple[SoundAsset, ...]]
) -> None:
    """邊界決議是「不設計」，同一組件卻符合某個素材時，規則互相矛盾，直接失敗。"""
    for decision in boundary_decisions:
        conflicting_assets = assets_by_component.get(decision.component_id, ())
        if conflicting_assets:
            asset_names = [asset.asset_id for asset in conflicting_assets]
            raise SoundPlanFormatError(f"邊界決議 {decision.component_id} 為不設計，卻符合音效素材 {asset_names}")


def collect_rule_warnings(snapshot: ComponentSnapshot, rules: SoundPlanRules) -> tuple[str, ...]:
    """找出在這一版 HTML 已經失效的規則：比對不到組件的樣式、找不到組件的邊界決議。"""
    component_identifiers = [component.component_id for component in snapshot.components]
    warnings: list[str] = []
    for asset in rules.sound_assets:
        for pattern in asset.component_patterns:
            if not any(re.fullmatch(pattern, identifier) for identifier in component_identifiers):
                warnings.append(f"音效素材 {asset.asset_id} 的樣式 `{pattern}` 比對不到任何組件")
    for decision in rules.boundary_decisions:
        if decision.component_id not in component_identifiers:
            warnings.append(f"邊界決議的組件 {decision.component_id} 已不在這一版 HTML")
    return tuple(warnings)


def compare_snapshots(previous_snapshot: ComponentSnapshot, current_snapshot: ComponentSnapshot) -> VersionDifference:
    """以組件 id 比較兩份快照。"""
    previous_identifiers = {component.component_id for component in previous_snapshot.components}
    current_identifiers = {component.component_id for component in current_snapshot.components}
    return VersionDifference(
        added_components=tuple(c for c in current_snapshot.components if c.component_id not in previous_identifiers),
        removed_components=tuple(c for c in previous_snapshot.components if c.component_id not in current_identifiers),
    )


def evaluate_tag(
    tag: ComponentTag, components: tuple[SceneComponent, ...], assets_by_component: dict[str, tuple[SoundAsset, ...]]
) -> TagEvaluation:
    """把一個標籤底下的組件分成建議設計與不設計兩組。"""
    tagged_components = tuple(component for component in components if tag.tag_id in component.tag_ids)
    return TagEvaluation(
        tag=tag,
        designed_components=tuple(c for c in tagged_components if assets_by_component[c.component_id]),
        silent_components=tuple(c for c in tagged_components if not assets_by_component[c.component_id]),
    )


def evaluate_sound_plan(
    snapshot: ComponentSnapshot, rules: SoundPlanRules, previous_snapshot: ComponentSnapshot | None
) -> SoundPlanEvaluation:
    """評估整份快照；previous_snapshot 為 None 時不計算版本差異。"""
    assets_by_component = match_component_assets(snapshot.components, rules.sound_assets)
    ensure_boundary_decisions_are_silent(rules.boundary_decisions, assets_by_component)
    ordered_tags = tuple(tag for tag in snapshot.tags if not tag.is_area_tag) + tuple(
        tag for tag in snapshot.tags if tag.is_area_tag
    )
    return SoundPlanEvaluation(
        snapshot=snapshot,
        rules=rules,
        assets_by_component=assets_by_component,
        tag_evaluations=tuple(evaluate_tag(tag, snapshot.components, assets_by_component) for tag in ordered_tags),
        version_difference=None if previous_snapshot is None else compare_snapshots(previous_snapshot, snapshot),
        rule_warnings=collect_rule_warnings(snapshot, rules),
    )
