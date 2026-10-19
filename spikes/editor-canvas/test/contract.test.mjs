import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTRACT_VERSION,
  MAX_MESSAGE_BYTES,
  MessageLedger,
  RUNTIME_VERSION,
  compositionToScreen,
  computeStage,
  isOversizedMessage,
  proposedLayoutOp,
  screenToComposition,
  selectableFromCatalogue,
  validateCommand,
  validateEvent,
  validateTextCommit,
} from "../public/contract.js";

const INSTANCE = "inst-abc12345";
const NONCE = "a".repeat(32);

function command(type, payload = {}, extra = {}) {
  return {
    v: CONTRACT_VERSION,
    kind: "cmd",
    instanceId: INSTANCE,
    nonce: NONCE,
    seq: 1,
    type,
    payload,
    ...extra,
  };
}

function event(type, payload = {}, extra = {}) {
  return {
    v: CONTRACT_VERSION,
    kind: "evt",
    instanceId: INSTANCE,
    nonce: NONCE,
    seq: 1,
    type,
    replyTo: null,
    payload,
    ...extra,
  };
}

test("command validation is strict about version, keys, types and ranges", () => {
  assert.deepEqual(validateCommand(command("ping")), { ok: true });
  assert.deepEqual(validateCommand(command("seek", { time: 1.5 })), { ok: true });
  assert.deepEqual(validateCommand(command("hitTest", { x: 10, y: 20 })), { ok: true });
  const cases = [
    [{ ...command("ping"), v: 2 }, "E_VERSION"],
    [{ ...command("ping"), kind: "evt" }, "E_MALFORMED"],
    [{ ...command("ping"), instanceId: "bad id" }, "E_INSTANCE"],
    [{ ...command("ping"), nonce: "xyz" }, "E_NONCE"],
    [{ ...command("ping"), seq: 0 }, "E_SEQ"],
    [{ ...command("ping"), seq: 1.5 }, "E_SEQ"],
    [{ ...command("ping"), type: "exec" }, "E_TYPE"],
    [{ ...command("ping"), payload: null }, "E_PAYLOAD"],
    [command("seek", {}), "E_PAYLOAD"],
    [command("seek", { time: "1.5" }), "E_PAYLOAD"],
    [command("hitTest", { x: 10 }), "E_PAYLOAD"],
    [command("ping", {}, { session: "host" }), "E_MALFORMED"],
    [command("ping", { extra: true }), "E_PAYLOAD"],
    [{ ...command("ping"), payload: undefined }, "E_MALFORMED"],
  ];
  for (const [message, code] of cases)
    assert.equal(validateCommand(message).code, code, JSON.stringify(message));
});

test("event validation covers ready/state/hit/elements/error shapes", () => {
  assert.deepEqual(
    validateEvent(
      event("ready", {
        runtimeVersion: RUNTIME_VERSION,
        width: 1280,
        height: 720,
        duration: 11,
      }),
    ),
    { ok: true },
  );
  const hit = {
    stableId: "scene-1-title",
    sceneId: "scene-1",
    tag: "h1",
    text: "标题",
    rect: { x: 88, y: 196, width: 980, height: 72 },
    style: { fontSize: "64px" },
    stack: ["scene-1-title"],
  };
  assert.deepEqual(validateEvent(event("hit", { hit })), { ok: true });
  assert.deepEqual(validateEvent(event("hit", { hit: null })), { ok: true });
  assert.deepEqual(
    validateEvent(
      event("state", { time: 1, duration: 11, playing: false }, { replyTo: 1 }),
    ),
    { ok: true },
  );
  assert.equal(validateEvent(event("ready", { width: 1280 })).code, "E_PAYLOAD");
  assert.equal(
    validateEvent(
      event("state", { time: 1, duration: 11, playing: "no" }, { replyTo: 1 }),
    ).code,
    "E_PAYLOAD",
  );
  assert.equal(validateEvent(event("hit", { hit: { ...hit, rect: null } })).code, "E_PAYLOAD");
  assert.equal(validateEvent(event("hit", { hit: { ...hit, extra: 1 } })).code, "E_PAYLOAD");
  assert.equal(validateEvent(event("elements", { elements: "x" })).code, "E_PAYLOAD");
  assert.equal(validateEvent(event("error", { code: "E_TIME_RANGE" })).code, "E_PAYLOAD");
  assert.equal(validateEvent({ ...event("pong"), replyTo: undefined }).code, "E_MALFORMED");
});

test("message size and text limits are enforced", () => {
  assert.equal(isOversizedMessage({ blob: "x".repeat(MAX_MESSAGE_BYTES + 1) }), true);
  assert.equal(isOversizedMessage({ blob: "x".repeat(100) }), false);
});

test("ledger rejects wrong instance, nonce, source, stale seq and late responses", () => {
  const make = () => new MessageLedger({ instanceId: INSTANCE, nonce: NONCE });
  const ledger = make();
  const stateCommand = ledger.command("state");
  assert.equal(stateCommand.seq, 1);
  assert.equal(ledger.pendingCount(), 1);
  const stateEvent = event(
    "state",
    { time: 0.5, duration: 11, playing: false },
    { seq: 1, replyTo: 1 },
  );
  assert.equal(ledger.acceptEvent(stateEvent, { sourceOk: true }).accepted, true);
  assert.equal(ledger.pendingCount(), 0);

  // Same source/instance but a foreign instance id.
  assert.equal(
    ledger.acceptEvent({ ...event("seeked", { time: 1 }, { seq: 2 }), instanceId: "inst-other-1" }, { sourceOk: true }).code,
    "E_WRONG_INSTANCE",
  );
  assert.equal(
    ledger.acceptEvent(event("seeked", { time: 1 }, { seq: 2 }), { sourceOk: true }).code,
    "E_UNCORRELATED",
  );
  const seek = ledger.command("seek", { time: 2 });
  assert.equal(
    ledger.acceptEvent(event("seeked", { time: 2 }, { seq: 3, replyTo: seek.seq }), {
      sourceOk: false,
    }).code,
    "E_SOURCE_MISMATCH",
  );
  assert.equal(
    ledger.acceptEvent(
      { ...event("seeked", { time: 2 }, { seq: 4, replyTo: seek.seq }), nonce: "b".repeat(32) },
      { sourceOk: true },
    ).code,
    "E_NONCE",
  );
  // Stale sequence is dropped even if it references a live pending command.
  assert.equal(
    ledger.acceptEvent(event("seeked", { time: 2 }, { seq: 2, replyTo: seek.seq }), {
      sourceOk: true,
    }).code,
    "E_STALE_SEQ",
  );

  // A late response after the command expired is not confused with a new one.
  const late = make();
  const lateCommand = late.command("state");
  assert.deepEqual(late.expire(Date.now() + 10_000), [lateCommand.seq]);
  assert.equal(
    late.acceptEvent(event("state", { time: 1, duration: 11, playing: false }, { seq: 2, replyTo: lateCommand.seq }), {
      sourceOk: true,
    }).code,
    "E_LATE_RESPONSE",
  );

  const revoked = make();
  const pending = revoked.command("play");
  assert.deepEqual(revoked.revoke(), [pending.seq]);
  assert.equal(revoked.pendingCount(), 0);
  assert.equal(
    revoked.acceptEvent(event("playing", { time: 1 }, { seq: 2, replyTo: pending.seq }), {
      sourceOk: true,
    }).code,
    "E_INSTANCE_REVOKED",
  );
});

test("coordinate contract handles letterboxing and round-trips", () => {
  const composition = { width: 1280, height: 720 };
  const stageFor = (containerWidth, containerHeight) =>
    computeStage({
      containerWidth,
      containerHeight,
      compositionWidth: composition.width,
      compositionHeight: composition.height,
    });
  const wide = stageFor(1100, 700);
  assert.equal(wide.scale, 1100 / 1280);
  assert.equal(wide.left, 0);
  assert.equal(wide.top, (700 - 720 * (1100 / 1280)) / 2);
  // Narrow stage: 760/1280 < 640/720, so the horizontal scale wins and the
  // letterbox bars are above/below the 16:9 composition.
  const tall = stageFor(760, 640);
  assert.equal(tall.scale, 760 / 1280);
  assert.equal(tall.left, 0);
  assert.ok(Math.abs(tall.top - (640 - 720 * (760 / 1280)) / 2) < 1e-9);
  // Wide stage: 1600/1280 > 700/720, so vertical scale wins and the bars are
  // left/right of the composition.
  const pillar = stageFor(1600, 700);
  assert.equal(pillar.scale, 700 / 720);
  assert.equal(pillar.top, 0);
  assert.ok(Math.abs(pillar.left - (1600 - 1280 * (700 / 720)) / 2) < 1e-9);

  for (const stage of [wide, tall, pillar, stageFor(1280, 720)]) {
    for (const point of [
      { x: 0, y: 0 },
      { x: 88, y: 196 },
      { x: 1279, y: 719 },
    ]) {
      const screen = compositionToScreen(point, stage);
      const back = screenToComposition(screen, stage, composition);
      assert.ok(Math.abs(back.x - point.x) < 1e-9);
      assert.ok(Math.abs(back.y - point.y) < 1e-9);
      assert.equal(back.inside, true);
    }
  }
  const topMargin = screenToComposition(
    { x: 1100 / 2, y: wide.top / 2 },
    wide,
    composition,
  );
  assert.equal(topMargin.inside, false);
  const leftMargin = screenToComposition(
    { x: pillar.left / 2, y: 700 / 2 },
    pillar,
    composition,
  );
  assert.equal(leftMargin.inside, false);
  const outsideStage = screenToComposition({ x: 5, y: 5 }, stageFor(1280, 720), composition);
  assert.equal(outsideStage.inside, true);
});

test("host-side edit guards reject unknown ids, wrong capabilities and stale revisions", () => {
  const catalogue = [
    { stableId: "scene-1-title", sceneId: "scene-1", capabilities: ["text", "timing"] },
    { stableId: "scene-1-logo", sceneId: "scene-1", capabilities: [] },
  ];
  assert.equal(selectableFromCatalogue(null, catalogue).code, "E_NO_HIT");
  assert.equal(
    selectableFromCatalogue({ stableId: "unknown-id" }, catalogue).code,
    "E_UNKNOWN_STABLE_ID",
  );
  assert.equal(selectableFromCatalogue({ stableId: "scene-1-logo" }, catalogue).editableText, false);
  assert.deepEqual(
    validateTextCommit({
      stableId: "scene-1-title",
      text: "新标题",
      expectedRevision: "a".repeat(64),
      currentRevision: "a".repeat(64),
      catalogue,
    }),
    { ok: true, stableId: "scene-1-title", sceneId: "scene-1" },
  );
  assert.equal(
    validateTextCommit({
      stableId: "scene-1-title",
      text: "  ",
      expectedRevision: "a".repeat(64),
      currentRevision: "a".repeat(64),
      catalogue,
    }).code,
    "E_EMPTY_TEXT",
  );
  assert.equal(
    validateTextCommit({
      stableId: "scene-1-title",
      text: "x".repeat(2049),
      expectedRevision: "a".repeat(64),
      currentRevision: "a".repeat(64),
      catalogue,
    }).code,
    "E_TEXT_TOO_LONG",
  );
  assert.equal(
    validateTextCommit({
      stableId: "scene-1-title",
      text: "新标题",
      expectedRevision: "a".repeat(64),
      currentRevision: "b".repeat(64),
      catalogue,
    }).code,
    "E_STALE_REVISION",
  );
  assert.equal(
    validateTextCommit({
      stableId: "scene-1-logo",
      text: "x",
      expectedRevision: "a".repeat(64),
      currentRevision: "a".repeat(64),
      catalogue,
    }).code,
    "E_NOT_TEXT_EDITABLE",
  );
});

test("proposed typed layout op is explicit about composition-pixel units", () => {
  assert.deepEqual(
    proposedLayoutOp({
      stableId: "scene-1-title",
      box: { left: 120, top: 240, width: 900, height: 80 },
    }),
    {
      type: "layout",
      target: "scene-1-title",
      box: { left: 120, top: 240, width: 900, height: 80 },
      unit: "composition-px",
    },
  );
  assert.equal(proposedLayoutOp({ stableId: "x", box: { left: -1, top: 0, width: 10, height: 10 } }), null);
  assert.equal(proposedLayoutOp({ stableId: "x", box: { left: 0, top: 0, width: 10 } }), null);
  assert.equal(proposedLayoutOp({ stableId: "x", box: { left: "1", top: 0, width: 10, height: 10 } }), null);
});
