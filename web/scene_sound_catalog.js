/**
 * 場景音效試聽清單：sound_plans/screw_press_separator 評估出的 42 組共用素材，每組標註建議用「實錄」還是「合成」。
 * 原則：盡量合成；動物與人聲這類難以用公式模仿的聲音才建議實錄。
 * 合成版有兩種來源：repo 既有的音效場景（sound_effects.SOUND_EFFECT_SCENES），或 scene_recipes_* 的配方。
 */
import * as machinery_recipes from "./scene_recipes_machinery.js";
import * as movement_recipes from "./scene_recipes_movement.js";
import * as creature_recipes from "./scene_recipes_creatures.js";

export const RECOMMENDED_VERSIONS = Object.freeze(["synthesized", "recorded"]);

export const CATALOG_GROUPS = Object.freeze([
  Object.freeze({ group_id: "water", group_title: "水聲" }),
  Object.freeze({ group_id: "machinery", group_title: "機械運轉" }),
  Object.freeze({ group_id: "signals", group_title: "鐘聲與號誌" }),
  Object.freeze({ group_id: "vehicles", group_title: "交通工具" }),
  Object.freeze({ group_id: "actions", group_title: "沒有人聲的動作" }),
  Object.freeze({ group_id: "animals", group_title: "動物" }),
  Object.freeze({ group_id: "people", group_title: "人聲" }),
]);

const SYNTHESIS_REASON = "可用雜訊、振盪器與濾波器組出來，不必下載音檔";
const ANIMAL_REASON = "動物叫聲的喉部細節與個體差異難以用公式模仿";
const HUMAN_REASON = "人聲（說話、喊叫、呼吸）難以用公式模仿";

function rendered_entry(asset_id, display_name, group_id, render_samples, recommended_version = "synthesized", recommendation_reason = SYNTHESIS_REASON) {
  return Object.freeze({ asset_id, display_name, group_id, recommended_version, recommendation_reason,
    synthesis_source: Object.freeze({ render_samples, level_offset_decibels: 0 }) });
}

/** 試聽後覺得響度對齊後仍偏大或偏小的合成版，在對齊增益之外再加減的分貝數。 */
function with_level_offset(catalog_entry, level_offset_decibels) {
  return Object.freeze({ ...catalog_entry, synthesis_source: Object.freeze({ ...catalog_entry.synthesis_source, level_offset_decibels }) });
}

function existing_scene_entry(asset_id, display_name, group_id, existing_effect_name, recommended_version, recommendation_reason) {
  return Object.freeze({ asset_id, display_name, group_id, recommended_version, recommendation_reason,
    synthesis_source: Object.freeze({ existing_effect_name }) });
}

/** 42 組素材，順序與評估報告第二節相同但依類別分組。 */
export const SCENE_SOUND_CATALOG = Object.freeze([
  rendered_entry("flowing_water", "渠道流水聲", "water", machinery_recipes.render_flowing_water),
  rendered_entry("tailrace_splash", "出水翻騰聲", "water", machinery_recipes.render_tailrace_splash),
  rendered_entry("sea_waves", "海浪聲", "water", machinery_recipes.render_sea_waves),
  rendered_entry("fountain_water", "噴水池水聲", "water", machinery_recipes.render_fountain_water),
  rendered_entry("screw_water_churn", "螺旋攪水聲", "water", machinery_recipes.render_screw_water_churn),
  rendered_entry("drivetrain_generator_hum", "傳動與發電聲", "machinery", machinery_recipes.render_drivetrain_generator_hum),
  rendered_entry("sluice_gate_motor", "閘門升降聲", "machinery", machinery_recipes.render_sluice_gate_motor),
  rendered_entry("trash_rake", "攔污耙運轉聲", "machinery", machinery_recipes.render_trash_rake),
  rendered_entry("barrier_motor", "柵欄與升降機馬達聲", "machinery", machinery_recipes.render_barrier_motor),
  rendered_entry("large_wind_turbine", "大型風機呼嘯聲", "machinery", machinery_recipes.render_large_wind_turbine),
  rendered_entry("vertical_wind_turbine", "垂直軸風機切風聲", "machinery", machinery_recipes.render_vertical_wind_turbine),
  rendered_entry("industrial_drone", "工業設備低頻運轉聲", "machinery", machinery_recipes.render_industrial_drone),
  // 2026-11-15 試聽：持續的低頻點火脈衝對齊後聽起來比實錄大聲，降 6 dB
  with_level_offset(rendered_entry("diesel_generator", "柴油發電機聲", "machinery", machinery_recipes.render_diesel_generator), -6),
  rendered_entry("pedestrian_signal", "行人號誌提示音", "signals", machinery_recipes.render_pedestrian_signal),
  rendered_entry("level_crossing_bell", "平交道警鈴", "signals", machinery_recipes.render_level_crossing_bell),
  rendered_entry("temple_bell_drum", "廟宇鐘鼓聲", "signals", machinery_recipes.render_temple_bell_drum),
  rendered_entry("church_bell", "教堂鐘聲", "signals", machinery_recipes.render_church_bell),
  rendered_entry("westminster_chime", "西敏寺鐘聲", "signals", machinery_recipes.render_westminster_chime),
  existing_scene_entry("road_traffic", "車流聲", "vehicles", "traffic", "synthesized", "沿用 repo 既有的車流合成"),
  existing_scene_entry("car_engine", "汽車引擎聲", "vehicles", "engine", "synthesized", "沿用 repo 既有的引擎合成"),
  rendered_entry("scooter_engine", "機車引擎聲", "vehicles", movement_recipes.render_scooter_engine),
  rendered_entry("tractor_engine", "鐵牛車引擎聲", "vehicles", movement_recipes.render_tractor_engine),
  rendered_entry("cane_train", "五分車行駛聲", "vehicles", movement_recipes.render_cane_train),
  rendered_entry("passenger_train", "臺鐵列車聲", "vehicles", movement_recipes.render_passenger_train),
  rendered_entry("bicycle_ride", "單車騎行聲", "vehicles", movement_recipes.render_bicycle_ride),
  rendered_entry("single_footsteps", "單人腳步聲", "actions", movement_recipes.render_single_footsteps),
  rendered_entry("excavation_work", "考古挖掘作業聲", "actions", movement_recipes.render_excavation_work),
  rendered_entry("flag_flap", "旗子拍動聲", "actions", movement_recipes.render_flag_flap),
  rendered_entry("bamboo_creak", "竹竿摩擦聲", "actions", movement_recipes.render_bamboo_creak),
  rendered_entry("cattle_moo", "牛叫聲", "animals", creature_recipes.render_cattle_moo, "recorded", ANIMAL_REASON),
  rendered_entry("sheep_bleat", "羊叫聲", "animals", creature_recipes.render_sheep_bleat, "recorded", ANIMAL_REASON),
  rendered_entry("goose_honk", "鵝叫聲", "animals", creature_recipes.render_goose_honk, "recorded", ANIMAL_REASON),
  rendered_entry("duck_quack", "鴨叫聲", "animals", creature_recipes.render_duck_quack, "recorded", ANIMAL_REASON),
  rendered_entry("chicken_cluck", "雞叫聲", "animals", creature_recipes.render_chicken_cluck, "recorded", ANIMAL_REASON),
  rendered_entry("frog_chorus", "蛙鳴", "animals", creature_recipes.render_frog_chorus, "recorded", ANIMAL_REASON),
  rendered_entry("sparrow_chirp", "麻雀叫聲", "animals", creature_recipes.render_sparrow_chirp, "recorded", ANIMAL_REASON),
  rendered_entry("hawk_call", "鷹啼", "animals", creature_recipes.render_hawk_call, "recorded", ANIMAL_REASON),
  rendered_entry("dog_bark", "狗叫聲", "animals", creature_recipes.render_dog_bark, "recorded", ANIMAL_REASON),
  existing_scene_entry("cat_meow", "貓叫聲", "animals", "cat", "recorded", ANIMAL_REASON),
  rendered_entry("crowd_chatter", "人群交談聲", "people", creature_recipes.render_crowd_chatter, "recorded", HUMAN_REASON),
  rendered_entry("snoring", "打呼聲", "people", creature_recipes.render_snoring, "recorded", HUMAN_REASON),
  rendered_entry("ballgame", "棒球比賽聲", "people", creature_recipes.render_ballgame, "recorded", "含裁判喊聲與觀眾歡呼，人聲難以用公式模仿"),
]);
