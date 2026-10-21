/**
 * L3 staging test isolation for the V1 M1 stable data root.
 *
 * Since M1 the Host treats `dataRoot` as authoritative: when a staging config
 * has no dataRoot it resolves the user default (`~/Movies/DSH Video`) and may
 * migrate legacy staging projects. L3 scripts must never touch the real user
 * data root, so every staged bridge run gets:
 *   - a temporary base directory,
 *   - a dataRoot inside that base (`<base>/data`),
 *   - `legacyDataRoots` pointing only at the staging snapshot under test (its
 *     own read-only fixture), never at user data.
 *
 * Older (pre-M1) staging bundles reject unknown config keys, so the helpers are
 * capability-gated by the presence of `legacyDataRoots` in the recorded config
 * (M1 stage-dev always injects it; alpha.10/alpha.11 configs do not have it).
 */
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/** Whether a recorded staging config comes from an M1+ bundle (dataRoot aware). */
export function supportsDataRoot(config) {
  return config !== null && typeof config === 'object' && Object.prototype.hasOwnProperty.call(config, 'legacyDataRoots');
}

/** Real user data root path for this machine. */
export function realDataRootPath(home = homedir()) {
  return join(home, 'Movies', 'DSH Video');
}

/** Capture whether the real user data root exists and its mtime. */
export async function snapshotRealDataRoot() {
  const path = realDataRootPath();
  try {
    const info = await stat(path);
    return { path, exists: true, mtimeMs: info.mtimeMs };
  } catch (_error) {
    return { path, exists: false, mtimeMs: null };
  }
}

/** Fail the run if the real user data root was created or modified. */
export async function assertRealDataRootUnchanged(baseline) {
  const current = await snapshotRealDataRoot();
  if (current.path !== baseline.path) throw new Error('real data-root path changed during the test');
  if (current.exists !== baseline.exists) {
    throw new Error(`the real user data root ${baseline.path} was ${current.exists ? 'created' : 'removed'} by the test`);
  }
  if (current.exists === true && current.mtimeMs !== baseline.mtimeMs) {
    throw new Error(`the real user data root ${baseline.path} was modified by the test`);
  }
}

/** Create one disposable base directory for an isolated staged run. */
export async function prepareIsolatedBase(prefix) {
  return mkdtemp(join(tmpdir(), prefix || 'dsh-staged-data-'));
}

/**
 * Return a copy of a staging config that points at `<base>/data`.
 * Pre-M1 staging configs are returned unchanged (supported:false).
 */
export function isolateStagedConfig(config, options) {
  const settings = options || {};
  const base = settings.base;
  const stagingRoot = settings.stagingRoot;
  if (supportsDataRoot(config) === false) {
    return { supported: false, base: null, dataRoot: null, config };
  }
  if (typeof base !== 'string' || base.length === 0) throw new Error('isolateStagedConfig needs a base directory');
  const dataRoot = join(base, 'data');
  const { legacyDataRoots: _ignored, ...rest } = config;
  return {
    supported: true,
    base,
    dataRoot,
    config: {
      ...rest,
      dataRoot,
      legacyDataRoots: [stagingRoot],
    },
  };
}

/** Remove the disposable base directory (best effort). */
export async function disposeIsolatedBase(base) {
  if (typeof base !== 'string' || base.length === 0) return;
  await rm(base, { recursive: true, force: true });
}

/**
 * After a harness created its own prepared state root, assert the bridge data
 * root stayed inside the temporary base and the real user root is untouched.
 */
export async function assertStateRootIsolation(stateRoot) {
  if (stateRoot === null || typeof stateRoot !== 'object') return;
  const config = stateRoot.config;
  if (stateRoot.dataRootSupported === true) {
    if (typeof config.dataRoot !== 'string' || config.dataRoot.startsWith(stateRoot.base + '/') === false) {
      throw new Error('bridge dataRoot escaped the temporary test base');
    }
    if (Array.isArray(config.legacyDataRoots) && config.legacyDataRoots.some((root) => typeof root === 'string' && root.includes(homedir()) && root.includes('Movies') && root.includes('DSH Video'))) {
      throw new Error('legacyDataRoots points at the real user data root');
    }
  }
  if (stateRoot.realDataRootBaseline !== undefined) {
    await assertRealDataRootUnchanged(stateRoot.realDataRootBaseline);
  }
}
