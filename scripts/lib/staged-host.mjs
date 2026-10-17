/**
 * Load the Host implementation from an immutable development staging snapshot,
 * not from the current development worktree.
 *
 * Ownership evidence matters: a real-engine run must execute the exact Host
 * bytes that INTEGRITY.json records for this snapshot. This module verifies the
 * recorded source/config/patch/engine-package digests first, resolves the engine
 * packages from inside the staged bundle, and only then imports
 * `<staging>/bundle/host/bridge.js`.
 *
 * node_modules, worker artifacts/output and the fixture project are deliberately
 * not part of the source digest: normal edits/frames/outputs are mutable business
 * data, not code. A missing or mismatched recorded source file rejects the run.
 */

import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readJson(path, label) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (_error) {
    throw new Error(`staging ${label} is missing: ${path}`);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (_error) {
    throw new Error(`staging ${label} is not valid JSON: ${path}`);
  }
  return { bytes, value };
}

function relativeSafe(path) {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path) || path.includes('\0')) return false;
  const normalized = relative('.', path);
  return normalized !== '' && normalized.startsWith('..') === false && isAbsolute(normalized) === false;
}

function inside(root, path) {
  const pathRelative = relative(root, path);
  return pathRelative === '' || (pathRelative.startsWith('..') === false && isAbsolute(pathRelative) === false);
}

async function canonicalRoot(staging) {
  const root = await realpath(staging);
  const info = await stat(root);
  if (info.isDirectory() === false) throw new Error(`staging is not a directory: ${staging}`);
  return root;
}

/** Digest one snapshot tree; node_modules and caller-excluded mutable dirs are skipped. */
export async function digestTree(root, exclude) {
  const canonical = await canonicalRoot(root);
  const entries = [];
  async function walk(directory) {
    const { readdir } = await import('node:fs/promises');
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const path = join(directory, child.name);
      const rel = relative(canonical, path).split(sep).join('/');
      if (typeof exclude === 'function' && exclude(rel) === true) continue;
      if (child.isDirectory()) await walk(path);
      else if (child.isFile()) {
        const bytes = await readFile(path);
        entries.push({ path: rel, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  await walk(canonical);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function verifyEntries(stagingRoot, base, entries, label) {
  if (Array.isArray(entries) === false || entries.length === 0) throw new Error(`INTEGRITY.files.${label} is missing or empty`);
  const root = await realpath(base);
  if (inside(stagingRoot, root) === false) throw new Error(`INTEGRITY.files.${label} escapes the staging root`);
  const seen = new Set();
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || relativeSafe(entry.path) === false) {
      throw new Error(`INTEGRITY.files.${label} has an unsafe path`);
    }
    if (seen.has(entry.path)) throw new Error(`INTEGRITY.files.${label} repeats ${entry.path}`);
    seen.add(entry.path);
    const path = join(root, entry.path);
    let real;
    let info;
    try {
      real = await realpath(path);
      if (inside(stagingRoot, real) === false) throw new Error('escaped staging root');
      info = await stat(real);
    } catch (_error) {
      throw new Error(`staging ${label} source is missing or escapes its root: ${entry.path}`);
    }
    if (info.isFile() === false) throw new Error(`staging ${label} source is not a regular file: ${entry.path}`);
    const bytes = await readFile(real);
    if (bytes.length !== entry.bytes) throw new Error(`staging ${label} size mismatch: ${entry.path}`);
    if (sha256(bytes) !== entry.sha256) throw new Error(`staging ${label} digest mismatch: ${entry.path}`);
  }
  return seen;
}

function assertCommit(value, label) {
  if (typeof value !== 'string' || /^[0-9a-f]{7,40}$/.test(value) === false) throw new Error(`INTEGRITY.${label} is not a commit id`);
}

function resolveEngine(bundleRoot, name) {
  const requireFromBundle = createRequire(pathToFileURL(join(bundleRoot, 'index.js')));
  try {
    return requireFromBundle.resolve(name);
  } catch (_error) {
    throw new Error(`staged bundle cannot resolve ${name}; run scripts/stage-dev.mjs on the reviewed engine commit`);
  }
}

/**
 * Verify and load one staging snapshot.
 * @param staging - absolute staging directory produced by scripts/stage-dev.mjs.
 * @returns { VideoBridge, config, integrity, evidence } where evidence names the
 * actual Host module path/digest and the recorded root/engine commits.
 */
export async function loadStagedHost(staging) {
  if (typeof staging !== 'string' || isAbsolute(staging) === false) throw new Error('staging must be an absolute directory');
  const stagingRoot = await canonicalRoot(staging);
  const bundleRoot = await realpath(join(stagingRoot, 'bundle'));
  const engineClientRoot = await realpath(join(stagingRoot, 'engine-client'));
  const engineWorkerRoot = await realpath(join(stagingRoot, 'engine-worker'));

  const configInfo = await readJson(join(stagingRoot, 'config.json'), 'config');
  const integrityInfo = await readJson(join(stagingRoot, 'INTEGRITY.json'), 'INTEGRITY');
  const config = configInfo.value;
  const integrity = integrityInfo.value;
  if (config === null || typeof config !== 'object' || Array.isArray(config)) throw new Error('staging config must be an object');
  if (integrity === null || typeof integrity !== 'object' || Array.isArray(integrity)) throw new Error('INTEGRITY must be an object');

  assertCommit(integrity.rootCommit, 'rootCommit');
  assertCommit(integrity.engineCommit, 'engineCommit');
  if (integrity.versions === null || typeof integrity.versions !== 'object') throw new Error('INTEGRITY.versions is missing');
  if (typeof integrity.config?.sha256 !== 'string' || sha256(configInfo.bytes) !== integrity.config.sha256) {
    throw new Error('staging config digest does not match INTEGRITY.json');
  }
  const patchBytes = await readFile(join(bundleRoot, 'cordis.patch.yml'));
  if (typeof integrity.stagedBundlePatch?.sha256 !== 'string' || sha256(patchBytes) !== integrity.stagedBundlePatch.sha256) {
    throw new Error('staging bundle patch digest does not match INTEGRITY.json');
  }

  const bundleFiles = await verifyEntries(stagingRoot, bundleRoot, integrity.files?.bundle, 'bundle');
  await verifyEntries(stagingRoot, engineClientRoot, integrity.files?.engineClient, 'engineClient');
  await verifyEntries(stagingRoot, engineWorkerRoot, integrity.files?.engineWorker, 'engineWorker');
  if (bundleFiles.has('host/bridge.js') === false) throw new Error('INTEGRITY.files.bundle does not record host/bridge.js');
  if (bundleFiles.has('index.js') === false) throw new Error('INTEGRITY.files.bundle does not record index.js');

  const clientPackageInfo = await readJson(join(engineClientRoot, 'package.json'), 'engine client manifest');
  const workerPackageInfo = await readJson(join(engineWorkerRoot, 'package.json'), 'engine worker manifest');
  for (const [label, manifest, expected] of [
    ['client', clientPackageInfo.value, integrity.versions.client],
    ['worker', workerPackageInfo.value, integrity.versions.worker],
  ]) {
    if (manifest.version !== expected) throw new Error(`staging ${label} version mismatch: ${manifest.version} !== ${expected}`);
    if (expected === undefined || expected === null) throw new Error(`INTEGRITY.versions.${label} is missing`);
  }

  const clientEntry = resolveEngine(bundleRoot, 'dsh-video-engine-client');
  const workerEntry = resolveEngine(bundleRoot, 'dsh-video-engine-worker/worker');
  const workerManifest = resolveEngine(bundleRoot, 'dsh-video-engine-worker/package.json');
  for (const [label, path] of [['client entry', clientEntry], ['worker entry', workerEntry], ['worker manifest', workerManifest]]) {
    const real = await realpath(path);
    if (inside(stagingRoot, real) === false) throw new Error(`staged ${label} resolves outside the snapshot: ${path}`);
  }

  const bridgePath = join(bundleRoot, 'host', 'bridge.js');
  const bridgeReal = await realpath(bridgePath);
  if (inside(stagingRoot, bridgeReal) === false) throw new Error('staged Host bridge escapes the staging root');
  const bridgeBytes = await readFile(bridgeReal);
  let bridgeModule;
  try {
    bridgeModule = await import(pathToFileURL(bridgeReal).href);
  } catch (error) {
    throw new Error(`staged Host bridge could not be imported: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof bridgeModule.VideoBridge !== 'function') throw new Error('staged Host bridge does not export VideoBridge');

  return {
    VideoBridge: bridgeModule.VideoBridge,
    config,
    integrity,
    evidence: {
      staging: stagingRoot,
      hostModule: bridgeReal,
      hostModuleSha256: sha256(bridgeBytes),
      bundleIndex: join(bundleRoot, 'index.js'),
      rootCommit: integrity.rootCommit,
      engineCommit: integrity.engineCommit,
      stagedPatchSha256: integrity.stagedBundlePatch.sha256,
      configSha256: integrity.config.sha256,
      versions: integrity.versions,
      resolved: { clientEntry, workerEntry, workerManifest },
      integrityVerified: true,
    },
  };
}
