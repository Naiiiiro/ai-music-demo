// browser_composer 的單元測試，使用 Node 內建測試框架：node --test web/tests
import assert from "node:assert/strict";
import { test } from "node:test";
import { MELODY_PHRASES, compose_bar, euclidean_rhythm, scale_degree_to_midi } from "../browser_composer.js";

test("euclidean 4 in 16 is four on the floor", () => {
  const hit_positions = euclidean_rhythm(4, 16).flatMap((is_hit, step_index) => (is_hit ? [step_index] : []));
  assert.deepEqual(hit_positions, [0, 4, 8, 12]);
});

test("euclidean invalid input throws", () => {
  assert.throws(() => euclidean_rhythm(1, 0), RangeError);
  assert.throws(() => euclidean_rhythm(9, 8), RangeError);
});

test("scale degree wraps octaves both ways", () => {
  assert.equal(scale_degree_to_midi(60, 7), 72);
  assert.equal(scale_degree_to_midi(60, -1), 59);
});

test("melody notes stay in C major scale", () => {
  const major_pitch_classes = new Set([0, 2, 4, 5, 7, 9, 11]);
  for (let bar_index = 0; bar_index < 16; bar_index += 1) {
    for (const note_event of compose_bar(bar_index)) {
      if (note_event.instrument_name === "lead") assert.ok(major_pitch_classes.has(note_event.midi_note % 12));
    }
  }
});

function events_of(instrument_name, bar_index = 0) {
  return compose_bar(bar_index).filter((note_event) => note_event.instrument_name === instrument_name);
}

test("clap lands on beats two and four", () => {
  assert.deepEqual(events_of("clap").map((note_event) => note_event.step_index), [4, 12]);
});

test("pad holds the chord triad one octave above for the whole bar", () => {
  const chord_notes = events_of("chord").map((note_event) => note_event.midi_note);
  const pad_events = events_of("pad");
  assert.deepEqual(pad_events.map((note_event) => note_event.midi_note), chord_notes.map((midi_note) => midi_note + 12));
  assert.ok(pad_events.every((note_event) => note_event.step_index === 0 && note_event.length_steps === 16));
});

test("pluck arpeggiates chord tones on euclidean five in sixteen", () => {
  const pluck_events = events_of("pluck", 1);
  assert.deepEqual(pluck_events.map((note_event) => note_event.step_index), [0, 4, 7, 10, 13]);
  // 第 2 小節是 V 級（G 和弦）：G4、B4、D5、G5，再回到 G4
  assert.deepEqual(pluck_events.map((note_event) => note_event.midi_note), [67, 71, 74, 79, 67]);
});

test("same bar always composes the same events", () => {
  assert.deepEqual(compose_bar(5), compose_bar(5));
});

test("melody follows the question and answer phrases", () => {
  // 第 1 小節 C 和弦問句：C5 D5 E5 休 G5 E5 D5 休；第 2 小節 G 和弦答句：D6 B5 A5 B5 G5 休 G5 休
  assert.deepEqual(events_of("lead", 0).map((note_event) => note_event.midi_note), [72, 74, 76, 79, 76, 74]);
  assert.deepEqual(events_of("lead", 1).map((note_event) => note_event.midi_note), [86, 83, 81, 83, 79, 79]);
});

test("melody rests sit on the fixed slots of each phrase", () => {
  MELODY_PHRASES.forEach((melody_phrase, phrase_index) => {
    const expected_steps = melody_phrase.flatMap((degree_offset, slot_index) => (degree_offset === null ? [] : [slot_index * 2]));
    assert.deepEqual(events_of("lead", phrase_index).map((note_event) => note_event.step_index), expected_steps);
  });
});

test("melody downbeat lands on a chord tone in every bar of the progression", () => {
  for (let bar_index = 0; bar_index < 4; bar_index += 1) {
    const chord_pitch_classes = new Set(events_of("chord", bar_index).map((note_event) => note_event.midi_note % 12));
    const downbeat_note = events_of("lead", bar_index).find((note_event) => note_event.step_index === 0);
    assert.ok(downbeat_note && chord_pitch_classes.has(downbeat_note.midi_note % 12));
  }
});

test("invalid bar index throws", () => {
  assert.throws(() => compose_bar(-1), RangeError);
  assert.throws(() => compose_bar(1.5), RangeError);
});
