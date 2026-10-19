import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fail } from "./errors.mjs";
import { atomicWrite, sha256 } from "./registry.mjs";

const HISTORY_DIR = ".dsh-video/history";
export const MAX_ENTRIES = 64;
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export function historyPaths(projectDir) {
  const dir = resolve(projectDir, HISTORY_DIR);
  return {
    dir,
    snapshots: resolve(dir, "snapshots"),
    entries: resolve(dir, "entries.jsonl"),
    ops: resolve(dir, "ops.jsonl"),
    state: resolve(dir, "state.json"),
  };
}

async function readLines(path) {
  try {
    const text = await readFile(path, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readState(projectDir) {
  try {
    return JSON.parse(await readFile(historyPaths(projectDir).state, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function appendLine(path, value) {
  const { appendFile } = await import("node:fs/promises");
  await appendFile(path, JSON.stringify(value) + "\n");
}

function now() {
  return new Date().toISOString();
}

async function saveState(projectDir, state) {
  await atomicWrite(historyPaths(projectDir).state, JSON.stringify(state) + "\n");
}

export async function ensureHistory(projectDir, { revision, html }) {
  const existing = await readState(projectDir);
  if (existing) return existing;
  const paths = historyPaths(projectDir);
  await mkdir(paths.snapshots, { recursive: true });
  await atomicWrite(resolve(paths.snapshots, `${revision}.html`), html);
  const entry = {
    historyCursor: 0,
    revision,
    actor: "system",
    kind: "init",
    summary: "initial content",
    at: now(),
  };
  await atomicWrite(paths.entries, JSON.stringify(entry) + "\n");
  const state = { historyCursor: 0, cursor: 0, seq: 0 };
  await saveState(projectDir, state);
  return state;
}

async function readHistory(projectDir) {
  const state = await readState(projectDir);
  const entries = await readLines(historyPaths(projectDir).entries);
  const ops = await readLines(historyPaths(projectDir).ops);
  return { state, entries, ops };
}

export async function recordWrite(
  projectDir,
  {
    before,
    after,
    actor = "human",
    kind = "edit",
    sceneId = null,
    summary = "",
    operationId = null,
  },
) {
  await ensureHistory(projectDir, before);
  const { state, entries, ops } = await readHistory(projectDir);
  const paths = historyPaths(projectDir);
  if (state.cursor < entries.length - 1) entries.splice(state.cursor + 1);
  if (after.revision !== (entries[state.cursor]?.revision ?? null)) {
    await atomicWrite(resolve(paths.snapshots, `${after.revision}.html`), after.html);
    entries.push({
      historyCursor: state.historyCursor + 1,
      revision: after.revision,
      actor,
      kind,
      sceneId,
      summary,
      operationId,
      at: now(),
    });
  }
  const historyCursor = state.historyCursor + 1;
  await atomicWrite(
    paths.entries,
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
  await appendLine(paths.ops, {
    historyCursor,
    actor,
    kind,
    sceneId,
    summary,
    operationId,
    from: before.revision,
    to: after.revision,
    at: now(),
  });
  const cursor = entries.length - 1;
  const pruned = await prune(projectDir, entries, cursor);
  await saveState(projectDir, {
    historyCursor,
    cursor: pruned.cursor,
    seq: ops.length + 1,
  });
  return { historyCursor, cursor: pruned.cursor };
}

async function prune(projectDir, entries, cursor) {
  const paths = historyPaths(projectDir);
  let bytes = 0;
  const sizes = new Map();
  for (const entry of entries) {
    try {
      sizes.set(entry.revision, (await stat(resolve(paths.snapshots, `${entry.revision}.html`))).size);
    } catch {
      sizes.set(entry.revision, 0);
    }
  }
  for (const size of sizes.values()) bytes += size;
  while (
    entries.length > 1 &&
    (entries.length > MAX_ENTRIES || bytes > MAX_SNAPSHOT_BYTES)
  ) {
    const removed = entries.shift();
    bytes -= sizes.get(removed.revision) ?? 0;
    if (!entries.some((entry) => entry.revision === removed.revision))
      await rm(resolve(paths.snapshots, `${removed.revision}.html`), { force: true });
    cursor = Math.max(0, cursor - 1);
  }
  return { cursor };
}

export async function listHistory(projectDir, { limit = 20 } = {}) {
  const state = await readState(projectDir);
  if (!state) return { initialized: false, entries: [], historyCursor: null, cursor: null, canUndo: false, canRedo: false };
  const { entries, ops } = await readHistory(projectDir);
  const paths = historyPaths(projectDir);
  let snapshotBytes = 0;
  for (const entry of entries) {
    try {
      snapshotBytes += (await stat(resolve(paths.snapshots, `${entry.revision}.html`))).size;
    } catch {}
  }
  return {
    initialized: true,
    historyCursor: state.historyCursor,
    cursor: state.cursor,
    canUndo: state.cursor > 0,
    canRedo: state.cursor < entries.length - 1,
    entries: entries.slice(-Math.min(Math.max(limit, 1), 64)),
    ops: ops.slice(-Math.min(Math.max(limit, 1), 64)),
    snapshotBytes,
    maxEntries: MAX_ENTRIES,
    maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
  };
}

async function readSnapshot(projectDir, revision) {
  const paths = historyPaths(projectDir);
  try {
    return await readFile(resolve(paths.snapshots, `${revision}.html`), "utf8");
  } catch {
    fail("E_BASE_MISSING", "History snapshot is unavailable", "history");
  }
}

export async function loadSnapshot(projectDir, revision) {
  return readSnapshot(projectDir, revision);
}

async function applyCursor(projectDir, { direction, actor }) {
  const state = await readState(projectDir);
  if (!state) fail("E_BASE_MISSING", "History is not initialized", "history");
  const { entries, ops } = await readHistory(projectDir);
  const targetIndex = state.cursor + direction;
  if (targetIndex < 0 || targetIndex >= entries.length)
    fail("E_PARAMS", direction < 0 ? "Nothing to undo" : "Nothing to redo", "history");
  const target = entries[targetIndex];
  const html = await readSnapshot(projectDir, target.revision);
  await atomicWrite(resolve(projectDir, "index.html"), html);
  const historyCursor = state.historyCursor + 1;
  await appendLine(historyPaths(projectDir).ops, {
    historyCursor,
    actor,
    kind: direction < 0 ? "undo" : "redo",
    sceneId: null,
    summary: `${direction < 0 ? "undo" : "redo"} to ${target.revision.slice(0, 12)}`,
    operationId: null,
    from: entries[state.cursor].revision,
    to: target.revision,
    at: now(),
  });
  await saveState(projectDir, {
    historyCursor,
    cursor: targetIndex,
    seq: ops.length + 1,
  });
  return { html, entry: target, historyCursor, cursor: targetIndex };
}

export async function undo(projectDir, { actor = "human" } = {}) {
  return applyCursor(projectDir, { direction: -1, actor });
}
export async function redo(projectDir, { actor = "human" } = {}) {
  return applyCursor(projectDir, { direction: 1, actor });
}
export { sha256 };

// Operations that change declared assets but not the entry HTML (asset.import)
// are recorded for audit/historyCursor, but they do not create an undoable
// content entry in v1.
export async function recordOp(
  projectDir,
  { actor = "human", kind = "op", sceneId = null, summary = "", operationId = null, from = null, to = null },
) {
  const state = await readState(projectDir);
  if (!state) fail("E_BASE_MISSING", "History is not initialized", "history");
  const historyCursor = state.historyCursor + 1;
  await appendLine(historyPaths(projectDir).ops, {
    historyCursor,
    actor,
    kind,
    sceneId,
    summary,
    operationId,
    from,
    to,
    at: now(),
  });
  await saveState(projectDir, { ...state, historyCursor });
  return { historyCursor };
}
