// mixing_console 的單元測試，用假的 AudioContext 記錄接線，使用 Node 內建測試框架：node --test web/tests
import assert from "node:assert/strict";
import { test } from "node:test";
import { INSTRUMENT_VOICES } from "../instrument_voices.js";
import { INSTRUMENT_SEND_LEVELS, create_mixing_console, decibels_to_gain } from "../mixing_console.js";

function create_fake_node(node_kind, connection_edges) {
  const fake_node = {
    node_kind,
    gain: { value: 1 },
    delayTime: { value: 0 },
    threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 },
    connect(target_node) {
      connection_edges.push({ source_node: fake_node, target_node });
      return target_node;
    },
  };
  return fake_node;
}

function create_fake_audio_context() {
  const connection_edges = [];
  const fake_context = {
    sampleRate: 8000,
    destination: create_fake_node("destination", connection_edges),
    connection_edges,
    createGain: () => create_fake_node("gain", connection_edges),
    createDelay: () => create_fake_node("delay", connection_edges),
    createConvolver: () => create_fake_node("convolver", connection_edges),
    createDynamicsCompressor: () => create_fake_node("compressor", connection_edges),
    createBuffer: (channel_count, frame_count) => {
      const channel_data = new Float32Array(frame_count);
      return { getChannelData: () => channel_data };
    },
  };
  return fake_context;
}

function targets_of(fake_context, source_node) {
  return fake_context.connection_edges.filter((edge) => edge.source_node === source_node).map((edge) => edge.target_node);
}

function find_master_input(fake_context) {
  const limiter_node = fake_context.connection_edges.find((edge) => edge.target_node === fake_context.destination).source_node;
  return fake_context.connection_edges.find((edge) => edge.target_node === limiter_node).source_node;
}

function send_bus_kinds(fake_context, channel_node) {
  return targets_of(fake_context, channel_node)
    .filter((target_node) => target_node !== find_master_input(fake_context))
    .map((send_node) => targets_of(fake_context, send_node)[0].node_kind)
    .sort();
}

test("lead dry signal reaches master and sends to reverb and delay", () => {
  const fake_context = create_fake_audio_context();
  const mixing_console = create_mixing_console(fake_context, { delay_seconds: 0.27 });
  const lead_channel = mixing_console.instrument_input_for("lead");
  assert.ok(targets_of(fake_context, lead_channel).includes(find_master_input(fake_context)));
  assert.deepEqual(send_bus_kinds(fake_context, lead_channel), ["convolver", "delay"]);
});

test("bass and kick stay dry", () => {
  const fake_context = create_fake_audio_context();
  const mixing_console = create_mixing_console(fake_context, { delay_seconds: 0.27 });
  for (const instrument_name of ["bass", "kick"]) {
    assert.deepEqual(send_bus_kinds(fake_context, mixing_console.instrument_input_for(instrument_name)), []);
  }
});

test("effect buses return only to master", () => {
  const fake_context = create_fake_audio_context();
  create_mixing_console(fake_context, { delay_seconds: 0.27 });
  const master_input = find_master_input(fake_context);
  const convolver_node = fake_context.connection_edges.find((edge) => edge.source_node.node_kind === "convolver").source_node;
  assert.deepEqual(targets_of(fake_context, convolver_node), [master_input]);
});

test("unknown instrument throws instead of going silent", () => {
  const mixing_console = create_mixing_console(create_fake_audio_context(), { delay_seconds: 0.27 });
  assert.throws(() => mixing_console.instrument_input_for("reverbb"), RangeError);
});

test("delay outside zero to two seconds throws", () => {
  assert.throws(() => create_mixing_console(create_fake_audio_context(), { delay_seconds: 0 }), RangeError);
  assert.throws(() => create_mixing_console(create_fake_audio_context(), { delay_seconds: 2.5 }), RangeError);
});

test("decibels convert to amplitude gain", () => {
  assert.equal(decibels_to_gain(0), 1);
  assert.ok(Math.abs(decibels_to_gain(-20) - 0.1) < 1e-12);
});

test("every instrument voice has a mixing channel", () => {
  assert.deepEqual(Object.keys(INSTRUMENT_SEND_LEVELS).sort(), Object.keys(INSTRUMENT_VOICES).sort());
});

test("new instruments pad pluck clap send to reverb", () => {
  const fake_context = create_fake_audio_context();
  const mixing_console = create_mixing_console(fake_context, { delay_seconds: 0.27 });
  for (const instrument_name of ["pad", "pluck", "clap"]) {
    assert.ok(send_bus_kinds(fake_context, mixing_console.instrument_input_for(instrument_name)).includes("convolver"));
  }
});

test("mixing configuration is identical every time", () => {
  const first_context = create_fake_audio_context();
  const second_context = create_fake_audio_context();
  create_mixing_console(first_context, { delay_seconds: 0.27 });
  create_mixing_console(second_context, { delay_seconds: 0.27 });
  const gain_values_of = (fake_context) => fake_context.connection_edges.map((edge) => edge.source_node.gain.value);
  assert.deepEqual(gain_values_of(first_context), gain_values_of(second_context));
});
