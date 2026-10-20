import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MAX_FRAME_TIMES,
  contactSheetArgs,
  contactSheetLayout,
  frameTimeLabel,
  normalizeFrameTimes,
} from "../src/jobs.mjs";
import { validate } from "./schema-validator.mjs";

const schemaPath = new URL("../protocol.schema.json", import.meta.url);
const workerSource = new URL("../src/worker.mjs", import.meta.url);
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const paramsFrame = schema.$defs.params_frame;

function rejectsParams(fn) {
  assert.throws(fn, (error) => error?.code === "E_PARAMS", "expected E_PARAMS");
}

test("normalizeFrameTimes canonicalizes to millisecond still names and sorts ascending", () => {
  assert.deepEqual(normalizeFrameTimes([2.5]), [2.5]);
  // The CLI still name is at-<toFixed(3)>s.png; the canonical value and the
  // duplicate identity both use that granularity.
  assert.deepEqual(normalizeFrameTimes([2.5, 0.25, 1]), [0.25, 1, 2.5]);
  assert.deepEqual(normalizeFrameTimes([1.23456]), [1.235]);
  assert.deepEqual(normalizeFrameTimes([0, 1.5, 2.25, 3]), [0, 1.5, 2.25, 3]);
  assert.equal(MAX_FRAME_TIMES, 4);
});

test("normalizeFrameTimes rejects empty, oversized, out-of-range, non-numeric and duplicate lists", () => {
  for (const value of [
    undefined,
    null,
    "1,2",
    {},
    [],
    [0, 1, 2, 3, 4],
    [-0.001],
    [3600],
    ["1"],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    // Both canonicalize to the same at-2.5s.png still.
    [2.5, 2.5004],
    [1, 1],
  ]) {
    rejectsParams(() => normalizeFrameTimes(value));
  }
});

test("frameTimeLabel matches the HyperFrames --keep still name format", () => {
  assert.equal(frameTimeLabel(2.5), "2.5");
  assert.equal(frameTimeLabel(1), "1");
  assert.equal(frameTimeLabel(0), "0");
  assert.equal(frameTimeLabel(0.25), "0.25");
  // Sub-millisecond input is rounded exactly like the CLI's toFixed(3) label.
  assert.equal(frameTimeLabel(1.0004), "1");
});

test("contactSheetLayout tiles at min(480, doc.width) with an even proportional height", () => {
  assert.deepEqual(contactSheetLayout(1280, 720, 2), {
    tileWidth: 480,
    tileHeight: 270,
    sheetWidth: 960,
    sheetHeight: 270,
  });
  assert.deepEqual(contactSheetLayout(1280, 720, 4), {
    tileWidth: 480,
    tileHeight: 270,
    sheetWidth: 1920,
    sheetHeight: 270,
  });
  // Narrow compositions are never upscaled.
  assert.deepEqual(contactSheetLayout(320, 180, 4), {
    tileWidth: 320,
    tileHeight: 180,
    sheetWidth: 1280,
    sheetHeight: 180,
  });
  // Odd rounding is reduced to an even tile height.
  assert.deepEqual(contactSheetLayout(1280, 723, 2), {
    tileWidth: 480,
    tileHeight: 270,
    sheetWidth: 960,
    sheetHeight: 270,
  });
  // The maximum sheet stays far below the 3840-wide bound.
  const widest = contactSheetLayout(3840, 2160, 4);
  assert.equal(widest.tileWidth, 480);
  assert.equal(widest.sheetWidth, 1920);
  assert.ok(widest.sheetHeight % 2 === 0);
  for (const height of [181, 333, 720, 721, 723, 1080, 2160]) {
    const layout = contactSheetLayout(1280, height, 2);
    assert.equal(layout.tileHeight % 2, 0, `tile height for ${height} is odd`);
    assert.ok(layout.tileHeight >= 2, `tile height for ${height} collapsed`);
    assert.ok(layout.sheetWidth <= 3840, `sheet width for ${height} exceeds 3840`);
  }
  rejectsParams(() => contactSheetLayout(1280, 720, 1));
  rejectsParams(() => contactSheetLayout(1280, 720, 5));
  rejectsParams(() => contactSheetLayout(0, 720, 2));
});

test("contactSheetArgs builds one hstack filter graph over the captured stills", () => {
  const frames = ["/tmp/job/frames/at-0.5s.png", "/tmp/job/frames/at-2s.png", "/tmp/job/frames/at-3.25s.png"];
  const layout = contactSheetLayout(1280, 720, frames.length);
  const args = contactSheetArgs(frames, layout, "/tmp/job/contact-sheet.png");
  assert.deepEqual(args.slice(0, 4), ["ffmpeg", "-y", "-v", "error"]);
  for (const frame of frames) {
    const index = args.indexOf(frame);
    assert.ok(index > 0 && args[index - 1] === "-i", `missing ffmpeg input ${frame}`);
  }
  const filterIndex = args.indexOf("-filter_complex");
  assert.ok(filterIndex > 0, "missing -filter_complex");
  const graph = args[filterIndex + 1];
  assert.ok(graph.includes("hstack=inputs=3"), "no horizontal stack for three stills");
  assert.ok(graph.includes("[0:v]scale=480:270"), "first still is not scaled to the tile size");
  assert.ok(graph.includes("[2:v]scale=480:270"), "third still is not scaled to the tile size");
  assert.ok(args.includes("-map") && args[args.indexOf("-map") + 1] === "[sheet]");
  assert.equal(args.at(-1), "/tmp/job/contact-sheet.png");
});

test("protocol schema requires exactly one of time or times and bounds the batch", () => {
  const base = { projectId: "demo", revision: "0".repeat(64) };
  assert.deepEqual(validate({ ...base, time: 2.5 }, paramsFrame, schema), []);
  assert.deepEqual(validate({ ...base, times: [0.5, 2.5] }, paramsFrame, schema), []);
  assert.deepEqual(validate({ ...base, time: 2.5, timeoutMs: 30000 }, paramsFrame, schema), []);
  assert.deepEqual(validate({ ...base, times: [1] }, paramsFrame, schema), []);
  assert.ok(validate(base, paramsFrame, schema).length > 0, "neither time nor times accepted");
  assert.ok(validate({ ...base, time: 1, times: [1] }, paramsFrame, schema).length > 0, "both time and times accepted");
  assert.ok(validate({ ...base, times: [] }, paramsFrame, schema).length > 0, "empty times accepted");
  assert.ok(validate({ ...base, times: [0, 1, 2, 3, 4] }, paramsFrame, schema).length > 0, "five times accepted");
  assert.ok(validate({ ...base, times: [3600] }, paramsFrame, schema).length > 0, "out-of-range time accepted");
  assert.ok(validate({ ...base, times: ["1"] }, paramsFrame, schema).length > 0, "string time accepted");
});

test("protocol schema jobView carries the batch times of a contact-sheet job", () => {
  const jobView = schema.$defs.jobView;
  const sample = {
    jobId: "11111111-1111-4111-8111-111111111111",
    projectId: "demo",
    revision: "0".repeat(64),
    kind: "frame",
    tools: {
      node: "v24.14.0",
      platform: "darwin",
      hyperframes: "0.8.167",
      sdk: "0.8.167",
      gsap: "3.15.0",
      fps: 30,
      browser: "unavailable",
      ffmpeg: "unavailable",
      ffprobe: "unavailable",
    },
    state: "running",
    stage: "sheet",
    progress: 0,
    times: [0.5, 2.5],
  };
  assert.deepEqual(validate(sample, jobView, schema), []);
  assert.ok(validate({ ...sample, times: [0.5] }, jobView, schema).length > 0, "a sheet job may not report one time");
});

test("worker frame dispatch wires times through the shared normalization", async () => {
  const source = await readFile(workerSource, "utf8");
  assert.ok(source.includes('"times"'), "worker frame params do not accept times");
  assert.ok(source.includes("normalizeFrameTimes(p.times)"), "worker does not normalize times");
  assert.ok(source.includes("Provide exactly one of time or times"), "worker does not enforce the time/times split");
});
