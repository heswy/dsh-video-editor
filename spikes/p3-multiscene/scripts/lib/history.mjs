import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { writeJson, readJson } from "./util.mjs";
import { readProjectSnapshot, writeEntryAtomic } from "./doc.mjs";

const HISTORY_DIR = ".dsh-video/history";
const MAX_ENTRIES = 64;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

function historyPaths(projectDir) {
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

async function appendLine(path, value) {
  await appendFile(path, JSON.stringify(value) + "\n");
}

function now() {
  return new Date().toISOString();
}

export async function initHistory(projectDir) {
  const paths = historyPaths(projectDir);
  await mkdir(paths.snapshots, { recursive: true });
  try {
    return await readJson(paths.state);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const snapshot = await readProjectSnapshot(projectDir);
  const html = snapshot.files.get("index.html");
  const rev = snapshot.revision;
  await writeFile(resolve(paths.snapshots, `${rev}.html`), html);
  await appendLine(paths.entries, {
    seq: 0,
    revision: rev,
    bytes: html.length,
    actor: "system",
    kind: "init",
    summary: "initial revision",
    at: now(),
  });
  const state = { cursor: 0, seq: 0 };
  await writeJson(paths.state, state);
  return state;
}

async function readHistory(projectDir) {
  const paths = historyPaths(projectDir);
  const [entries, ops, state] = await Promise.all([
    readLines(paths.entries),
    readLines(paths.ops),
    readJson(paths.state),
  ]);
  return { paths, entries, ops, state };
}

export async function listHistory(projectDir) {
  const { entries, ops, state, paths } = await readHistory(projectDir);
  const snapshotBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  return {
    state,
    entries,
    ops: ops.slice(-32),
    opCount: ops.length,
    snapshotBytes,
    maxEntries: MAX_ENTRIES,
    maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
    path: paths.dir,
  };
}

async function currentRevision(projectDir) {
  const snapshot = await readProjectSnapshot(projectDir);
  return snapshot.revision;
}

export async function recordRevision(
  projectDir,
  html,
  { actor = "human", kind = "content", summary = "", sceneId, operationId } = {},
) {
  const { paths, entries, ops, state } = await readHistory(projectDir);
  const from = entries[state.cursor]?.revision ?? null;
  await writeEntryAtomic(projectDir, html);
  // History stores the same content-addressed project revision the worker
  // reports (entry + declared asset bytes), not just the entry HTML hash.
  const rev = (await readProjectSnapshot(projectDir)).revision;

  // A new write after undo replaces the redo branch.
  if (state.cursor < entries.length - 1) {
    entries.splice(state.cursor + 1);
  }
  let cursor = state.cursor;
  if (rev !== from) {
    const existing = entries.findIndex((entry) => entry.revision === rev);
    if (existing >= 0) cursor = existing;
    else {
      entries.push({
        seq: entries.length,
        revision: rev,
        bytes: html.length,
        actor,
        kind,
        summary,
        at: now(),
      });
      await writeFile(resolve(paths.snapshots, `${rev}.html`), html);
      cursor = entries.length - 1;
    }
  }
  const seq = ops.length;
  await appendLine(paths.ops, {
    seq,
    kind,
    actor,
    summary,
    sceneId: sceneId ?? null,
    operationId: operationId ?? null,
    from,
    to: rev,
    at: now(),
  });
  cursor = await pruneHistory(paths, entries, cursor);
  await rewriteEntries(paths, entries);
  const stateNext = { cursor: Math.min(cursor, entries.length - 1), seq };
  await writeJson(paths.state, stateNext);
  return { revision: rev, cursor: stateNext.cursor, entries: entries.length };
}

async function pruneHistory(paths, entries, cursor) {
  while (
    entries.length > MAX_ENTRIES ||
    entries.reduce((sum, entry) => sum + entry.bytes, 0) > MAX_SNAPSHOT_BYTES
  ) {
    if (entries.length <= 1) break;
    const removed = entries.shift();
    if (!entries.some((entry) => entry.revision === removed.revision))
      await rm(resolve(paths.snapshots, `${removed.revision}.html`), { force: true });
    cursor = Math.max(0, cursor - 1);
  }
  return cursor;
}

async function rewriteEntries(paths, entries) {
  await writeFile(
    paths.entries,
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
}

async function restore(projectDir, revision) {
  const { paths } = await readHistory(projectDir);
  const html = await readFile(resolve(paths.snapshots, `${revision}.html`));
  await writeEntryAtomic(projectDir, html);
  return html;
}

export async function undo(projectDir, { actor = "human" } = {}) {
  const { paths, entries, ops, state } = await readHistory(projectDir);
  if (state.cursor <= 0) return { ok: false, reason: "nothing to undo" };
  const target = entries[state.cursor - 1];
  const html = await restore(projectDir, target.revision);
  const current = entries[state.cursor];
  await appendLine(paths.ops, {
    seq: ops.length,
    kind: "undo",
    actor,
    summary: `undo to ${target.revision.slice(0, 12)}`,
    from: current.revision,
    to: target.revision,
    at: now(),
  });
  await writeJson(paths.state, { cursor: state.cursor - 1, seq: ops.length });
  return {
    ok: true,
    revision: target.revision,
    revisionBefore: current.revision,
    note: "content-addressed revision: undo restores the earlier content hash; the action is appended to history",
    htmlBytes: html.length,
  };
}

export async function redo(projectDir, { actor = "human" } = {}) {
  const { paths, entries, ops, state } = await readHistory(projectDir);
  if (state.cursor + 1 >= entries.length)
    return { ok: false, reason: "nothing to redo" };
  const target = entries[state.cursor + 1];
  const html = await restore(projectDir, target.revision);
  const current = entries[state.cursor];
  await appendLine(paths.ops, {
    seq: ops.length,
    kind: "redo",
    actor,
    summary: `redo to ${target.revision.slice(0, 12)}`,
    from: current.revision,
    to: target.revision,
    at: now(),
  });
  await writeJson(paths.state, { cursor: state.cursor + 1, seq: ops.length });
  return { ok: true, revision: target.revision, revisionBefore: current.revision, htmlBytes: html.length };
}

export async function historySurfaceRevision(projectDir) {
  return currentRevision(projectDir);
}

export { rewriteEntries };
