/**
 * Resolve the independent engine packages from the installed bundle, without
 * depending on another worktree, a node_modules layout, or a development path.
 *
 * The module base is injectable so contract tests (and the staging integration
 * check) can resolve the same packages exactly as an installed bundle would.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, isAbsolute, resolve } from 'node:path';
import { configurationError } from './errors.js';

const WORKER_PACKAGE = 'dsh-video-engine-worker';
const CLIENT_PACKAGE = 'dsh-video-engine-client';

function packageRoot(require, name) {
  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch (_error) {
    throw configurationError(
      `Engine package "${name}" is not resolvable from the installed bundle; install the complete snapshot before starting the worker`
    );
  }
}

function resolveWorkerEntry(require, workerEntry) {
  if (typeof workerEntry === 'string' && workerEntry.length > 0) {
    if (isAbsolute(workerEntry) === false) {
      throw configurationError('"workerEntry" must be an absolute path when configured');
    }
    return workerEntry;
  }
  try {
    return require.resolve(`${WORKER_PACKAGE}/worker`);
  } catch (_error) {
    throw configurationError(
      `Engine package "${WORKER_PACKAGE}" does not expose its worker entry; install the reviewed engine snapshot`
    );
  }
}

/**
 * @param options - optional `baseUrl` of the installed Host module (defaults to
 *   this module) and an optional absolute `workerEntry` override.
 * @returns resolved `WorkerClient`, worker entry and package versions.
 */
export async function loadEngine(options) {
  const settings = options || {};
  const baseUrl = settings.baseUrl === undefined ? import.meta.url : String(settings.baseUrl);
  let require;
  try {
    require = createRequire(baseUrl);
  } catch (_error) {
    throw configurationError('The installed bundle module base is not a file URL');
  }

  const clientRoot = packageRoot(require, CLIENT_PACKAGE);
  const workerRoot = packageRoot(require, WORKER_PACKAGE);
  const workerEntry = resolveWorkerEntry(require, settings.workerEntry);

  const workerManifestPath = resolve(workerRoot, 'package.json');
  const clientManifestPath = resolve(clientRoot, 'package.json');
  if (existsSync(workerManifestPath) === false || existsSync(clientManifestPath) === false) {
    throw configurationError('The engine package manifests are missing from the installed snapshot');
  }

  let clientEntry;
  try {
    clientEntry = require.resolve(CLIENT_PACKAGE);
  } catch (_error) {
    throw configurationError(`Engine package "${CLIENT_PACKAGE}" has no resolvable root export`);
  }

  let clientModule;
  try {
    clientModule = await import(pathToFileURL(clientEntry).href);
  } catch (_error) {
    throw configurationError(`Engine package "${CLIENT_PACKAGE}" could not be loaded`);
  }
  if (typeof clientModule.WorkerClient !== 'function') {
    throw configurationError(`Engine package "${CLIENT_PACKAGE}" does not export WorkerClient`);
  }

  const { readFile } = await import('node:fs/promises');
  let workerVersion = 'unknown';
  let clientVersion = 'unknown';
  try {
    workerVersion = JSON.parse(await readFile(workerManifestPath, 'utf8')).version || 'unknown';
    clientVersion = JSON.parse(await readFile(clientManifestPath, 'utf8')).version || 'unknown';
  } catch (_error) {
    throw configurationError('The engine package manifests could not be read');
  }

  return {
    WorkerClient: clientModule.WorkerClient,
    workerEntry,
    clientEntry: fileURLToPath(new URL(pathToFileURL(clientEntry).href)),
    workerVersion,
    clientVersion,
    baseUrl,
  };
}
