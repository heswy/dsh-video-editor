#!/usr/bin/env node
/**
 * V1 M1 storage end-to-end checks (temporary HOME/dataRoot only).
 *
 * Every scenario runs against a throwaway HOME under the OS temp directory and,
 * where configured, an explicit temporary dataRoot. The check asserts the real
 * user data root (~/Movies/DSH Video) was never created.
 *
 * Coverage grows with the M1 tasks:
 *   M1-01 data root resolution/ensure/data-root-derived worker registry
 *   M1-02 legacy migration (idempotent, copy-only, migration.json, session merge)
 *   M1-03 registry/session-state/ui-state fault tolerance + quarantine
 *   M1-04 project.path / project.reveal (UI-only)
 *   M1-05 ui-state lastProjectId persistence
 *
 * Run: node scripts/test-v1-storage.mjs
 */

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { VideoBridge } from '../host/bridge.js';
import { readMigrationRecord, ensureDataRoot, readProjectsRegistry, readWorkerRegistry, resolveDataRoot } from '../host/data-root.js';
import { BridgeError } from '../host/errors.js';

const REAL_HOME = homedir();
const REAL_DATA_ROOT = join(REAL_HOME, 'Movies', 'DSH Video');
const PROJECT = 'demo';
const REVISION = 'a'.repeat(64);

let passes = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rejects(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected rejection');
}

async function run(name, fn) {
  try {
    await fn();
    passes += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Run one scenario with a throwaway HOME and a controlled environment.
 *
 * Every scenario starts with HOME=<temp> and both DSH_VIDEO_* overrides REMOVED,
 * so an inherited CI/Lead shell setting (for example
 * DSH_VIDEO_DATA_ROOT=/tmp/.../gate-data) can never leak into a "default data
 * root" assertion. A scenario that exercises env precedence sets them itself
 * inside the callback (options.keepEnv can opt out for a dedicated test).
 */
async function withTempHome(name, fn, options = {}) {
  const home = await mkdtemp(join(tmpdir(), `dsh-video-m1-${name}-`));
  const previous = {
    HOME: process.env.HOME,
    DSH_VIDEO_DATA_ROOT: process.env.DSH_VIDEO_DATA_ROOT,
    DSH_VIDEO_LEGACY_ROOTS: process.env.DSH_VIDEO_LEGACY_ROOTS,
  };
  process.env.HOME = home;
  if (options.keepEnv !== true) {
    delete process.env.DSH_VIDEO_DATA_ROOT;
    delete process.env.DSH_VIDEO_LEGACY_ROOTS;
  }
  try {
    return await fn(home);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(home, { recursive: true, force: true });
  }
}

/** WorkerClient double: records request/1 options, never spawns anything. */
class FakeClient {
  constructor(options) {
    this.options = options;
    this.state = 'running';
    this.requests = [];
    this.startCount = 0;
    this.disposeCount = 0;
    FakeClient.instances.push(this);
  }
  static reset() {
    FakeClient.instances = [];
  }
  async start() {
    this.startCount += 1;
    this.state = 'running';
    return { node: 'fake' };
  }
  async request(method, params) {
    this.requests.push({ method, params });
    if (method === 'doctor') return { ok: true, tools: {} };
    if (method === 'inspect' || method === 'open') {
      return { projectId: params.projectId, revision: REVISION, width: 1280, height: 720, duration: 5, elements: [], scenes: [], files: [] };
    }
    return { projectId: params.projectId };
  }
  debug() {
    return { state: this.state };
  }
  async dispose() {
    this.disposeCount += 1;
    this.state = 'disposed';
  }
}
FakeClient.instances = [];

function engineLoaderFor(workspace) {
  return async () => ({
    WorkerClient: class extends FakeClient {
      constructor(options) {
        super(options);
        workspace.clientOptions = options;
      }
    },
    workerEntry: workspace.workerEntry,
    workerVersion: '0.4.0',
    clientVersion: '0.4.0',
  });
}

async function makeWorkspace(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-video-m1-ws-'));
  const workerCwd = join(root, 'worker-cwd');
  await mkdir(workerCwd, { recursive: true });
  const workerEntry = join(root, 'worker.mjs');
  await writeFile(workerEntry, '// fake worker entry\n');
  const workspace = {
    root,
    workerCwd,
    workerEntry,
    clientOptions: null,
    config: Object.assign(
      {
        workerNode: process.execPath,
        workerCwd,
        // Legacy keys are still accepted but never override the data root.
        registryPath: join(root, 'legacy', 'registry.json'),
        artifactRoot: join(root, 'legacy', 'output'),
        allowedProjects: [PROJECT],
      },
      overrides.config || {}
    ),
  };
  workspace.ctx = {
    logger: { warn() {} },
    subprocess: { resolveExecutable: async (value) => value },
    connection: { fetch: { register: () => () => {} } },
    get: () => undefined,
  };
  workspace.engineLoader = engineLoaderFor(workspace);
  return workspace;
}

function makeBridge(workspace, rawConfig, settings = {}) {
  FakeClient.reset();
  return new VideoBridge({
    ctx: workspace.ctx,
    rawConfig: rawConfig === undefined ? workspace.config : rawConfig,
    engineLoader: workspace.engineLoader,
    ...(settings.spawn === undefined ? {} : { spawn: settings.spawn }),
  });
}

/** spawn double: records argv and resolves on the next tick like a real child. */
function makeSpawnSpy(options = {}) {
  const calls = [];
  const spawn = (command, args, spawnOptions) => {
    calls.push({ command, args, options: spawnOptions });
    const child = new EventEmitter();
    child.unref = () => {};
    setImmediate(() => {
      if (options.fail === true) child.emit('error', new Error('spawn failed'));
      else child.emit('spawn');
    });
    return child;
  };
  return { spawn, calls };
}

/**
 * Build one alpha.10/alpha.11-style staging data root (managed registries +
 * projects/ + session-state.json) entirely inside a temporary directory.
 */
async function makeLegacyStaging(root, options = {}) {
  const projectsRoot = join(root, 'projects');
  await mkdir(projectsRoot, { recursive: true });
  const projectIds = options.projectIds || [PROJECT, 'second-project'];
  const includeSessionState = options.sessionState !== false;
  const projects = {};
  for (const id of projectIds) {
    const directory = join(projectsRoot, id);
    if (options.missing && options.missing.includes(id)) {
      projects[id] = directory;
      continue;
    }
    await mkdir(join(directory, 'assets'), { recursive: true });
    await writeFile(join(directory, 'index.html'), `<!doctype html><title>${id}</title>`);
    await writeFile(join(directory, 'project.json'), JSON.stringify({ entry: 'index.html', assets: [], ...(options.titles ? { title: options.titles[id] } : {}) }, null, 2));
    await mkdir(join(directory, '.dsh-video', 'history'), { recursive: true });
    await writeFile(join(directory, '.dsh-video', 'history', 'state.json'), '{"historyCursor":0,"cursor":0,"seq":0}\n');
    projects[id] = directory;
  }
  const managed = join(root, 'managed');
  await mkdir(managed, { recursive: true });
  const innerRegistry = join(managed, 'projects.json');
  await writeFile(innerRegistry, JSON.stringify({ projects }, null, 2));
  const outputRoot = join(root, 'engine-worker', 'artifacts', 'output');
  await mkdir(outputRoot, { recursive: true });
  await writeFile(join(managed, 'registry.json'), JSON.stringify({ projectsRoot, registryPath: innerRegistry, outputRoot, assetInboxRoot: join(root, 'asset-inbox'), browserPath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }, null, 2));
  if (includeSessionState) {
    const bound = projectIds.filter((id) => !(options.missing && options.missing.includes(id)));
    const first = bound[0];
    await writeFile(join(root, 'session-state.json'), JSON.stringify({
      version: 1,
      projects: first === undefined ? {} : { [first]: { sessionIds: ['session-legacy-1'], activeSessionId: 'session-legacy-1', createdAt: 1000, updatedAt: 1000 } },
      sessions: first === undefined ? {} : { 'session-legacy-1': { projectId: first, createdAt: 1000 } },
    }, null, 2));
  }
  return { root, projectsRoot, projects, innerRegistry, outputRoot };
}

/** Rewrite absolute legacy paths inside a copied registry fixture. */
async function rewritePaths(file, from, to) {
  const textValue = await readFile(file, 'utf8');
  await writeFile(file, textValue.split(from).join(to));
}

/** Seed a stable data-root layout with registered project directories. */
async function seedDataRoot(home, projectIds, options = {}) {
  const root = join(home, options.dataRootName || 'stable-data');
  const ensured = await ensureDataRoot(root, options.ensure || {});
  const projects = {};
  for (const id of projectIds) {
    const directory = join(root, 'projects', id);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'index.html'), `<!doctype html><title>${id}</title>`);
    await writeFile(join(directory, 'project.json'), JSON.stringify({ entry: 'index.html', assets: [] }, null, 2));
    projects[id] = directory;
  }
  if (options.register !== false) {
    await writeFile(join(root, 'projects.json'), JSON.stringify({ version: 1, managed: true, projects }, null, 2));
  }
  return { root, paths: ensured.paths, projects };
}

function bridgeConfig(workspace, dataRoot) {
  return Object.assign({}, workspace.config, { dataRoot });
}

async function modeOf(path) {
  return (await stat(path)).mode & 0o777;
}

async function assertRealRootUntouched() {
  assert(existsSync(REAL_DATA_ROOT) === false, `the real user data root ${REAL_DATA_ROOT} must never be created by tests`);
}

async function main() {
  await run('M1-01: default data root is <home>/Movies/DSH Video and is created lazily', async () => {
    await withTempHome('default-root', async (home) => {
      const expectedRoot = join(home, 'Movies', 'DSH Video');
      assert(existsSync(expectedRoot) === false, 'data root was created before the first business request');
      const workspace = await makeWorkspace();
      const bridge = makeBridge(workspace);
      await bridge.invoke('doctor', {});
      assert(existsSync(expectedRoot) === true, 'first business request did not create the data root');
      for (const relative of ['', 'projects', 'asset-inbox', 'exports', 'cache', 'cache/output', 'session-cwd']) {
        const path = relative === '' ? expectedRoot : join(expectedRoot, relative);
        assert((await stat(path)).isDirectory() === true, `${relative || '.'} is not a directory`);
        assert((await modeOf(path)) === 0o700, `${relative || '.'} mode is not 0700`);
      }
      const projects = await readProjectsRegistry(join(expectedRoot, 'projects.json'));
      assert(projects.ok === true && projects.projects.size === 0, 'empty project map was not created');
      const worker = await readWorkerRegistry(join(expectedRoot, 'registry.json'));
      assert(worker.ok === true, 'worker managed registry was not created');
      assert(Object.keys(worker.value).sort().join(',') === 'assetInboxRoot,outputRoot,projectsRoot,registryPath', 'worker registry keys are not the frozen 5-key managed schema');
      assert(worker.value.projectsRoot === join(expectedRoot, 'projects'), 'worker registry projectsRoot is not under the data root');
      assert(worker.value.outputRoot === join(expectedRoot, 'cache', 'output'), 'worker registry outputRoot is not <dataRoot>/cache/output');
      const uiState = JSON.parse(await readFile(join(expectedRoot, 'ui-state.json'), 'utf8'));
      assert(uiState.version === 1 && uiState.lastProjectId === null, 'empty ui-state.json was not created');
      assert(workspace.clientOptions.registryPath === (await realpath(join(expectedRoot, 'registry.json'))), 'worker was not started with <dataRoot>/registry.json');
      await bridge.dispose();
      await assertRealRootUntouched();
      await rm(workspace.root, { recursive: true, force: true });
    });
  });

  await run('M1-01: DSH_VIDEO_DATA_ROOT overrides the default home location', async () => {
    await withTempHome('env-root', async (home) => {
      const custom = join(home, 'custom-video-root');
      process.env.DSH_VIDEO_DATA_ROOT = custom;
      const workspace = await makeWorkspace();
      const bridge = makeBridge(workspace);
      await bridge.invoke('doctor', {});
      assert(existsSync(join(custom, 'registry.json')) === true, 'env data root was not used');
      assert(existsSync(join(home, 'Movies', 'DSH Video')) === false, 'default data root was created despite the env override');
      await bridge.dispose();
      await rm(workspace.root, { recursive: true, force: true });
      await assertRealRootUntouched();
    });
  });

  await run('M1-01: Loader config dataRoot wins over the environment', async () => {
    await withTempHome('config-root', async (home) => {
      const fromConfig = join(home, 'config-root');
      const fromEnv = join(home, 'env-root');
      process.env.DSH_VIDEO_DATA_ROOT = fromEnv;
      const workspace = await makeWorkspace();
      const bridge = makeBridge(workspace, Object.assign({}, workspace.config, { dataRoot: fromConfig }));
      await bridge.invoke('doctor', {});
      assert(existsSync(join(fromConfig, 'ui-state.json')) === true, 'config dataRoot was not used');
      assert(existsSync(fromEnv) === false, 'env dataRoot was created despite config precedence');
      await bridge.dispose();
      await rm(workspace.root, { recursive: true, force: true });
      await assertRealRootUntouched();
    });
  });

  await run('M1-01: an old staging-style config starts and migrates its data root without touching the old paths', async () => {
    await withTempHome('legacy-config', async (home) => {
      const legacyRoot = join(home, 'old-staging');
      const projectsRoot = join(legacyRoot, 'projects');
      const projectDir = join(projectsRoot, PROJECT);
      await mkdir(projectDir, { recursive: true });
      await writeFile(join(projectDir, 'index.html'), '<!doctype html>');
      await mkdir(join(legacyRoot, 'managed'), { recursive: true });
      const innerRegistry = join(legacyRoot, 'managed', 'projects.json');
      await writeFile(innerRegistry, JSON.stringify({ projects: { [PROJECT]: projectDir } }, null, 2));
      const outerRegistry = join(legacyRoot, 'managed', 'registry.json');
      await writeFile(outerRegistry, JSON.stringify({ projectsRoot, registryPath: innerRegistry, outputRoot: join(legacyRoot, 'output') }, null, 2));
      await mkdir(join(legacyRoot, 'output'), { recursive: true });
      const legacySnapshot = await digestTree(legacyRoot);
      const workspace = await makeWorkspace();
      const config = Object.assign({}, workspace.config, {
        registryPath: outerRegistry,
        artifactRoot: join(legacyRoot, 'output'),
        projectsRoot,
        sessionStatePath: join(legacyRoot, 'session-state.json'),
        sessionCwd: join(legacyRoot, 'session-cwd'),
      });
      const bridge = makeBridge(workspace, config);
      await bridge.invoke('doctor', {});
      assert(existsSync(join(home, 'Movies', 'DSH Video', 'projects.json')) === true, 'legacy config did not prepare the stable data root');
      assert(JSON.stringify(await digestTree(legacyRoot)) === JSON.stringify(legacySnapshot), 'the legacy staging data was modified');
      assert(workspace.clientOptions.registryPath === (await realpath(join(home, 'Movies', 'DSH Video', 'registry.json'))), 'worker was pointed at the legacy registry instead of the data root');
      await bridge.dispose();
      await rm(workspace.root, { recursive: true, force: true });
      await assertRealRootUntouched();
    });
  });

  await run('M1-01: ensureDataRoot is idempotent and never rewrites existing bookkeeping files', async () => {
    await withTempHome('idempotent', async (home) => {
      const root = join(home, 'data-root');
      const first = await ensureDataRoot(root);
      assert(first.created.length > 0, 'first ensure did not report created entries');
      const before = await digestTree(root);
      const second = await ensureDataRoot(root);
      assert(second.created.length === 0, `second ensure created ${second.created.length} entries`);
      assert(JSON.stringify(await digestTree(root)) === JSON.stringify(before), 'ensureDataRoot rewrote existing files');
      await assertRealRootUntouched();
    });
  });

  await run('M1-02: staging projects and session mapping are copied into the data root once', async () => {
    await withTempHome('migration', async (home) => {
      const legacy = await makeLegacyStaging(join(home, 'old-staging'));
      const dataRoot = join(home, 'stable-data');
      const workspace = await makeWorkspace();
      const config = Object.assign({}, workspace.config, { dataRoot, legacyDataRoots: [legacy.root] });
      const bridge = makeBridge(workspace, config);
      await bridge.invoke('doctor', {});
      for (const id of Object.keys(legacy.projects)) {
        const target = join(dataRoot, 'projects', id);
        assert(existsSync(join(target, 'index.html')) === true, `${id} was not copied into the data root`);
        assert((await readFile(join(target, 'index.html'), 'utf8')).includes(id), `${id} content was not preserved`);
      }
      const projects = await readProjectsRegistry(join(dataRoot, 'projects.json'));
      assert(projects.ok === true && projects.projects.size === 2, `data-root project map has ${projects.ok ? projects.projects.size : 'error'} entries`);
      const migration = await readMigrationRecord(join(dataRoot, 'migration.json'));
      assert(migration.ok === true && migration.record !== null, 'migration.json was not written');
      assert(migration.record.sources.length === 1 && migration.record.sources[0].completed === true, 'migration source is not marked complete');
      assert(migration.record.sources[0].copied.length === 2, 'migration did not record both copied projects');
      const sessionState = JSON.parse(await readFile(join(dataRoot, 'session-state.json'), 'utf8'));
      assert(sessionState.sessions['session-legacy-1'] !== undefined, 'legacy session mapping was not merged');
      assert(sessionState.projects[Object.keys(legacy.projects)[0]].activeSessionId === 'session-legacy-1', 'legacy active session was not merged');
      assert(bridge.migrationStatus.status === 'complete' && bridge.migrationStatus.copied === 2, `unexpected migration status ${JSON.stringify(bridge.migrationStatus)}`);
      await bridge.dispose();
      // Idempotent: a second activation must not recopy or rewrite evidence.
      const before = JSON.parse(await readFile(join(dataRoot, 'migration.json'), 'utf8'));
      const digestBefore = await digestTree(join(dataRoot, 'projects'));
      const second = makeBridge(await makeWorkspace(), config);
      await second.invoke('doctor', {});
      const after = JSON.parse(await readFile(join(dataRoot, 'migration.json'), 'utf8'));
      assert(JSON.stringify(before.sources) === JSON.stringify(after.sources), 'a repeated run rewrote the migration evidence');
      assert(JSON.stringify(await digestTree(join(dataRoot, 'projects'))) === JSON.stringify(digestBefore), 'a repeated run changed the copied projects');
      await second.dispose();
      await rm(workspace.root, { recursive: true, force: true });
      await assertRealRootUntouched();
    });
  });

  await run('M1-02: a missing project is recorded and a later run retries without blocking the others', async () => {
    await withTempHome('migration-retry', async (home) => {
      const legacy = await makeLegacyStaging(join(home, 'old-staging'), { missing: ['second-project'] });
      const dataRoot = join(home, 'stable-data');
      const workspace = await makeWorkspace();
      const config = Object.assign({}, workspace.config, { dataRoot, legacyDataRoots: [legacy.root] });
      const first = makeBridge(workspace, config);
      await first.invoke('doctor', {});
      assert(existsSync(join(dataRoot, 'projects', PROJECT, 'index.html')) === true, 'the healthy project was not copied');
      assert(existsSync(join(dataRoot, 'projects', 'second-project')) === false, 'the missing project was invented');
      assert(first.migrationStatus.status === 'partial' && first.migrationStatus.errors >= 1, `expected a partial migration, saw ${JSON.stringify(first.migrationStatus)}`);
      await first.dispose();
      // Recreate the missing source and activate again: the failed source is retried.
      await makeLegacyStaging(join(home, 'old-staging'), { missing: [] });
      const second = makeBridge(await makeWorkspace(), config);
      await second.invoke('doctor', {});
      assert(existsSync(join(dataRoot, 'projects', 'second-project', 'index.html')) === true, 'the retry did not copy the previously missing project');
      assert(second.migrationStatus.status === 'complete', `retry did not complete: ${JSON.stringify(second.migrationStatus)}`);
      await second.dispose();
      await rm(workspace.root, { recursive: true, force: true });
      await assertRealRootUntouched();
    });
  });

  await run('M1-02: real alpha.11 staging project drill (read-only source copy)', async () => {
    const staging = join(REAL_HOME, 'Orange Field', 'Matterhorn', 'dsh-video-editor-worktrees', 'artifacts', 'p2-b', 'staging-alpha11-51b95dc');
    if (existsSync(join(staging, 'managed')) === false) {
      console.log('NOTE  real alpha.11 staging drill skipped: staging data is not available in this checkout');
      return;
    }
    await withTempHome('migration-real', async (home) => {
      // Copy the staging data into a temp legacy root: the real staging stays read-only.
      const legacy = join(home, 'legacy-alpha11');
      await cp(join(staging, 'managed'), join(legacy, 'managed'), { recursive: true });
      await cp(join(staging, 'projects'), join(legacy, 'projects'), { recursive: true });
      await cp(join(staging, 'session-state.json'), join(legacy, 'session-state.json'));
      // The copied registries still name the original absolute staging paths;
      // point them at the temporary copy so the drill runs on a self-contained root.
      for (const registryFile of [join(legacy, 'managed', 'projects.json'), join(legacy, 'managed', 'registry.json')]) {
        await rewritePaths(registryFile, staging, legacy);
      }
      const legacyDigest = await digestTree(legacy);
      const dataRoot = join(home, 'stable-data');
      const workspace = await makeWorkspace();
      const config = Object.assign({}, workspace.config, { dataRoot, legacyDataRoots: [legacy] });
      const bridge = makeBridge(workspace, config);
      await bridge.invoke('doctor', {});
      const projects = await readProjectsRegistry(join(dataRoot, 'projects.json'));
      assert(projects.ok === true, 'real drill data-root project map is unreadable');
      for (const id of projects.projects.keys()) {
        assert(existsSync(join(dataRoot, 'projects', id, 'index.html')) === true, `real project ${id} was not migrated`);
      }
      const realProject = [...projects.projects.keys()].find((id) => id.startsWith('proj-'));
      assert(typeof realProject === 'string', 'the real user project was not migrated');
      const migratedSessionState = JSON.parse(await readFile(join(dataRoot, 'session-state.json'), 'utf8'));
      assert(Object.keys(migratedSessionState.sessions).length >= 1, 'the real session mapping was not merged');
      assert(JSON.stringify(await digestTree(legacy)) === JSON.stringify(legacyDigest), 'the legacy staging data was modified');
      await bridge.dispose();
      await rm(workspace.root, { recursive: true, force: true });
      await assertRealRootUntouched();
    });
  });

  await run('M1-03: a corrupt project registry is rebuilt from the project directories on disk (scan fallback)', async () => {
    await withTempHome('corrupt-registry', async (home) => {
      const seeded = await seedDataRoot(home, [PROJECT]);
      const corruptLiteral = '{not a registry';
      await writeFile(seeded.paths.projectsRegistryPath, corruptLiteral);
      const workspace = await makeWorkspace();
      const bridge = makeBridge(workspace, bridgeConfig(workspace, seeded.root));
      const list = await bridge.invoke('project.list', {});
      assert(list.projects.length === 1 && list.projects[0].projectId === PROJECT, 'the disk scan did not rebuild the registry');
      const names = await readdir(seeded.root);
      const backups = names.filter((name) => name.startsWith('projects.json.corrupt-'));
      assert(backups.length === 1, 'corrupt registry bytes were not preserved');
      assert((await readFile(join(seeded.root, backups[0]), 'utf8')) === corruptLiteral, 'the preserved registry bytes were altered');
      const repaired = await readProjectsRegistry(seeded.paths.projectsRegistryPath);
      assert(repaired.ok === true && repaired.projects.has(PROJECT), 'the registry map was not rebuilt from the scan');
      const recovery = bridge.state().dataRoot.registryRecovery;
      assert(recovery !== null && recovery.projectsRegistry === 'scanned' && recovery.recoveredProjects === 1, `unexpected scan recovery ${JSON.stringify(recovery)}`);
      await bridge.dispose();
      await rm(workspace.root, { recursive: true, force: true });
      await assertRealRootUntouched();
    });
  });

  await run('M1-03: the scan fallback quarantines incomplete project directories', async () => {
    await withTempHome('corrupt-registry-incomplete', async (home) => {
      const seeded = await seedDataRoot(home, [PROJECT, 'incomplete-project']);
      await rm(join(seeded.projects['incomplete-project'], 'project.json'), { force: true });
      await writeFile(seeded.paths.projectsRegistryPath, '{broken');
      const workspace = await makeWorkspace();
      const bridge = makeBridge(workspace, bridgeConfig(workspace, seeded.root));
      const list = await bridge.invoke('project.list', {});
      const healthy = list.projects.find((item) => item.projectId === PROJECT);
      const incomplete = list.projects.find((item) => item.projectId === 'incomplete-project');
      assert(healthy !== undefined && healthy.quarantined === undefined, 'the healthy project was not recovered');
      assert(incomplete !== undefined && incomplete.quarantined === true, 'the incomplete directory was not quarantined');
      const denied = await rejects(() => bridge.invoke('open', { projectId: 'incomplete-project' }));
      assert(denied.code === 'E_PROJECT_UNAVAILABLE', 'the incomplete project was openable');
      await bridge.dispose();
      await rm(workspace.root, { recursive: true, force: true });
      await assertRealRootUntouched();
    });
  });

  await run('M1-03: a corrupt registry with no recoverable directories starts with an empty table', async () => {
    await withTempHome('corrupt-registry-empty', async (home) => {
      const seeded = await seedDataRoot(home, []);
      await writeFile(seeded.paths.projectsRegistryPath, '{not a registry');
      const workspace = await makeWorkspace();
      const bridge = makeBridge(workspace, bridgeConfig(workspace, seeded.root));
      const list = await bridge.invoke('project.list', {});
      assert(Array.isArray(list.projects) && list.projects.length === 0, 'an unrecoverable registry did not start empty');
      assert(bridge.state().dataRoot.registryRecovery !== null, 'registry recovery was not recorded');
      await bridge.dispose();
      await rm(workspace.root, { recursive: true, force: true });
      await assertRealRootUntouched();
    });
  });

  await run('M1-03: a corrupt project registry is restored from its last-known-good backup', async () => {
    await withTempHome('registry-backup', async (home) => {
      const seeded = await seedDataRoot(home, [PROJECT]);
      // First activation writes the .bak recovery copy; keep an explicit good copy.
      const setupWorkspace = await makeWorkspace();
      const setupBridge = makeBridge(setupWorkspace, bridgeConfig(setupWorkspace, seeded.root));
      await setupBridge.invoke('doctor', {});
      await setupBridge.dispose();
      await rm(setupWorkspace.root, { recursive: true, force: true });
      const goodMap = await readFile(seeded.paths.projectsRegistryPath, 'utf8');
      await writeFile(seeded.paths.projectsRegistryPath + '.bak', goodMap);
      await writeFile(seeded.paths.projectsRegistryPath, '{corrupt');
      const workspace = await makeWorkspace();
      const bridge = makeBridge(workspace, bridgeConfig(workspace, seeded.root));
      const list = await bridge.invoke('project.list', {});
      assert(list.projects.length === 1 && list.projects[0].projectId === PROJECT, 'the .bak project map was not restored');
      const repaired = await readProjectsRegistry(seeded.paths.projectsRegistryPath);
      assert(repaired.ok === true && repaired.source === 'file' && repaired.projects.has(PROJECT), 'the main registry was not repaired from the backup');
      await bridge.dispose();
      await rm(workspace.root, { recursive: true, force: true });
      await assertRealRootUntouched();
    });
  });

  await run('M1-03: a missing project directory is quarantined while other projects keep working', async () => {
    await withTempHome('quarantine', async (home) => {
      const OTHER = 'other-project';
      const seeded = await seedDataRoot(home, [PROJECT, OTHER]);
      await rm(seeded.projects[OTHER], { recursive: true, force: true });
      const workspace = await makeWorkspace();
      const bridge = makeBridge(workspace, bridgeConfig(workspace, seeded.root));
      const list = await bridge.invoke('project.list', {});
      const quarantineRow = list.projects.find((item) => item.projectId === OTHER);
      assert(quarantineRow !== undefined && quarantineRow.quarantined === true && quarantineRow.error === 'E_PROJECT_UNAVAILABLE', 'the missing project was not listed as quarantined');
      const healthy = list.projects.find((item) => item.projectId === PROJECT);
      assert(healthy !== undefined && healthy.quarantined === undefined, 'the healthy project was marked quarantined');
      const denied = await rejects(() => bridge.invoke('open', { projectId: OTHER }));
      assert(denied.code === 'E_PROJECT_UNAVAILABLE', `a quarantined project open did not fail typed: ${denied.code}`);
      const opened = await bridge.invoke('open', { projectId: PROJECT });
      assert(opened.projectId === PROJECT && typeof opened.revision === 'string', 'the healthy project could not be opened');
      // A quarantine row never changes the healthy project's availability.
      await bridge.dispose();
      await rm(workspace.root, { recursive: true, force: true });
      await assertRealRootUntouched();
    });
  });

  await run('M1-03: a corrupt worker registry is rebuilt from the data-root layout', async () => {
    await withTempHome('corrupt-worker-registry', async (home) => {
      const seeded = await seedDataRoot(home, [PROJECT]);
      const corruptLiteral = '{"projectsRoot":"relative"}';
      await writeFile(seeded.paths.registryPath, corruptLiteral);
      const workspace = await makeWorkspace();
      const bridge = makeBridge(workspace, bridgeConfig(workspace, seeded.root));
      await bridge.invoke('doctor', {});
      const rebuilt = await readWorkerRegistry(seeded.paths.registryPath);
      assert(rebuilt.ok === true && rebuilt.value.projectsRoot === seeded.paths.projectsRoot, 'the worker registry was not rebuilt from the data root');
      const names = await readdir(seeded.root);
      const backups = names.filter((name) => name.startsWith('registry.json.corrupt-'));
      assert(backups.length === 1 && (await readFile(join(seeded.root, backups[0]), 'utf8')) === corruptLiteral, 'corrupt worker registry evidence was not preserved');
      await bridge.dispose();
      await rm(workspace.root, { recursive: true, force: true });
      await assertRealRootUntouched();
    });
  });

  await run('M1-03: a corrupt session mapping is preserved and rebuilt as an empty v1 state', async () => {
    await withTempHome('corrupt-session', async (home) => {
      const seeded = await seedDataRoot(home, [PROJECT]);
      const corruptLiteral = '{broken session state';
      await writeFile(seeded.paths.sessionStatePath, corruptLiteral);
      const workspace = await makeWorkspace();
      const bridge = makeBridge(workspace, bridgeConfig(workspace, seeded.root));
      const list = await bridge.invoke('session.list', { projectId: PROJECT }, { source: 'http' });
      assert(list.enabled === true && Array.isArray(list.sessions) && list.sessions.length === 0, 'a corrupt session mapping was not rebuilt as empty');
      const names = await readdir(seeded.root);
      const backups = names.filter((name) => name.startsWith('session-state.json.corrupt-'));
      assert(backups.length === 1 && (await readFile(join(seeded.root, backups[0]), 'utf8')) === corruptLiteral, 'corrupt session mapping evidence was not preserved');
      const rebuilt = JSON.parse(await readFile(seeded.paths.sessionStatePath, 'utf8'));
      assert(rebuilt.version === 1 && Object.keys(rebuilt.projects).length === 0, 'the rebuilt session mapping is not an empty v1 state');
      await bridge.dispose();
      await rm(workspace.root, { recursive: true, force: true });
      await assertRealRootUntouched();
    });
  });

  await run('M1-03: a corrupt ui-state is reset to defaults and preserves the corrupt bytes', async () => {
    await withTempHome('corrupt-ui-state', async (home) => {
      const seeded = await seedDataRoot(home, [PROJECT]);
      const corruptLiteral = '{broken ui state';
      await writeFile(seeded.paths.uiStatePath, corruptLiteral);
      const workspace = await makeWorkspace();
      const bridge = makeBridge(workspace, bridgeConfig(workspace, seeded.root));
      await bridge.invoke('doctor', {});
      const state = bridge.uiState.get();
      assert(state.version === 1 && state.lastProjectId === null && state.layout === null, 'corrupt ui-state was not reset to defaults');
      const names = await readdir(seeded.root);
      const backups = names.filter((name) => name.startsWith('ui-state.json.corrupt-'));
      assert(backups.length === 1 && (await readFile(join(seeded.root, backups[0]), 'utf8')) === corruptLiteral, 'corrupt ui-state evidence was not preserved');
      assert(bridge.uiState.diagnose().recovered !== null, 'ui-state recovery was not recorded');
      await bridge.dispose();
      await rm(workspace.root, { recursive: true, force: true });
      await assertRealRootUntouched();
    });
  });

  await run('M1-01 follow-up: ensureDataRoot backfills a later-configured browserPath without losing other keys', async () => {
    await withTempHome('browser-backfill', async (home) => {
      const root = join(home, 'data-root');
      await ensureDataRoot(root);
      const before = await readWorkerRegistry(join(root, 'registry.json'));
      assert(before.ok === true && before.value.browserPath === undefined, 'a browserPath appeared before it was configured');
      await ensureDataRoot(root, { browserPath: '/Applications/Test Browser.app/Contents/MacOS/Test Browser' });
      const after = await readWorkerRegistry(join(root, 'registry.json'));
      assert(after.ok === true && after.value.browserPath === '/Applications/Test Browser.app/Contents/MacOS/Test Browser', 'browserPath was not backfilled');
      assert(after.value.projectsRoot === before.value.projectsRoot && after.value.outputRoot === before.value.outputRoot, 'backfill changed unrelated registry keys');
      await assertRealRootUntouched();
    });
  });

  await run('M1-04: project.path returns the authoritative realpath and never a UI-supplied path', async () => {
    await withTempHome('project-path', async (home) => {
      const seeded = await seedDataRoot(home, [PROJECT], { dataRootName: '数据 根 root' });
      const workspace = await makeWorkspace();
      const bridge = makeBridge(workspace, bridgeConfig(workspace, seeded.root));
      const result = await bridge.invoke('project.path', { projectId: PROJECT }, { source: 'http' });
      assert(result.projectId === PROJECT, 'project.path returned the wrong project id');
      assert(result.path === (await realpath(seeded.projects[PROJECT])), 'project.path did not return the canonical project directory');
      assert(result.path.includes('数据 根 root'), 'the space/CJK data root was not preserved in the returned path');
      // project.list keeps its path-free shape (the folder button asks separately).
      const list = await bridge.invoke('project.list', {});
      assert(list.projects.every((item) => Object.prototype.hasOwnProperty.call(item, 'path') === false), 'project.list leaked a filesystem path');
      // The model Tool can never see a Host path.
      const toolDenied = await rejects(() => bridge.invoke('project.path', { projectId: PROJECT }, { source: 'tool', agentSessionId: 'session-x' }));
      assert(toolDenied.code === 'E_METHOD', `project.path was reachable from the Tool: ${toolDenied.code}`);
      await bridge.dispose();
      await rm(workspace.root, { recursive: true, force: true });
      await assertRealRootUntouched();
    });
  });

  await run('M1-04: project.reveal uses argv form with a space/CJK path and fails typed', async () => {
    await withTempHome('project-reveal', async (home) => {
      const seeded = await seedDataRoot(home, [PROJECT], { dataRootName: '数据 根 root' });
      const workspace = await makeWorkspace();
      const spy = makeSpawnSpy();
      const bridge = makeBridge(workspace, bridgeConfig(workspace, seeded.root), { spawn: spy.spawn });
      const result = await bridge.invoke('project.reveal', { projectId: PROJECT }, { source: 'http' });
      assert(result.opened === true, 'project.reveal did not report an opened folder');
      assert(spy.calls.length === 1, `expected exactly one reveal spawn, saw ${spy.calls.length}`);
      const expected = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
      assert(spy.calls[0].command === expected, `unexpected reveal command ${spy.calls[0].command}`);
      assert(Array.isArray(spy.calls[0].args) && spy.calls[0].args.length === 1, 'reveal must pass the directory as one argv entry (no shell string)');
      assert(spy.calls[0].args[0] === (await realpath(seeded.projects[PROJECT])), 'reveal argv is not the canonical project directory');
      assert(spy.calls[0].args[0].includes(' '), 'the space-bearing path was not exercised');
      assert(spy.calls[0].options && spy.calls[0].options.detached === true && spy.calls[0].options.stdio === 'ignore', 'reveal child is not detached/ignored');
      const toolDenied = await rejects(() => bridge.invoke('project.reveal', { projectId: PROJECT }, { source: 'tool', agentSessionId: 'session-x' }));
      assert(toolDenied.code === 'E_METHOD', 'project.reveal was reachable from the Tool');
      await bridge.dispose();

      const failingSpy = makeSpawnSpy({ fail: true });
      const failing = makeBridge(await makeWorkspace(), bridgeConfig(await makeWorkspace(), seeded.root), { spawn: failingSpy.spawn });
      const failure = await rejects(() => failing.invoke('project.reveal', { projectId: PROJECT }, { source: 'http' }));
      assert(failure.code === 'E_REVEAL_FAILED', `reveal failure was not typed: ${failure.code}`);
      assert(failing.state().started === false, 'a failed reveal started the worker');
      await failing.dispose();
      // A quarantined project cannot reveal anything.
      const quarantineSeeded = await seedDataRoot(await mkdtemp(join(tmpdir(), 'dsh-m1-quarantine-')), [PROJECT]);
      await rm(quarantineSeeded.projects[PROJECT], { recursive: true, force: true });
      const quarantineWorkspace = await makeWorkspace();
      const quarantineBridge = makeBridge(quarantineWorkspace, bridgeConfig(quarantineWorkspace, quarantineSeeded.root));
      const unavailable = await rejects(() => quarantineBridge.invoke('project.path', { projectId: PROJECT }, { source: 'http' }));
      assert(unavailable.code === 'E_PROJECT_UNAVAILABLE', 'a missing project folder path was not typed unavailable');
      await quarantineBridge.dispose();
      await rm(quarantineWorkspace.root, { recursive: true, force: true });
      await rm(workspace.root, { recursive: true, force: true });
      await assertRealRootUntouched();
    });
  });

  await run('M1-05: ui.state.get/set persists the last project and layout, UI-only and revision-free', async () => {
    await withTempHome('ui-state', async (home) => {
      const seeded = await seedDataRoot(home, [PROJECT]);
      const registryBefore = await readFile(seeded.paths.projectsRegistryPath, 'utf8');
      const workspace = await makeWorkspace();
      const bridge = makeBridge(workspace, bridgeConfig(workspace, seeded.root));
      const initial = await bridge.invoke('ui.state.get', {}, { source: 'http' });
      assert(initial.version === 1 && initial.lastProjectId === null && initial.layout === null, 'ui.state.get did not return defaults');
      const saved = await bridge.invoke('ui.state.set', { patch: { lastProjectId: PROJECT } }, { source: 'http' });
      assert(saved.lastProjectId === PROJECT, 'ui.state.set did not persist lastProjectId');
      const layoutSaved = await bridge.invoke('ui.state.set', { patch: { layout: { aiPaneRatio: 0.61 } } }, { source: 'http' });
      assert(layoutSaved.layout !== null && Math.abs(layoutSaved.layout.aiPaneRatio - 0.61) < 0.001, 'ui.state.set did not persist the layout ratio');
      const unknown = await rejects(() => bridge.invoke('ui.state.set', { patch: { path: '/tmp/x' } }, { source: 'http' }));
      assert(unknown.code === 'E_UI_STATE_PARAMS', `unknown ui-state field was accepted: ${unknown.code}`);
      const toolDenied = await rejects(() => bridge.invoke('ui.state.set', { patch: { lastProjectId: PROJECT } }, { source: 'tool', agentSessionId: 'session-x' }));
      assert(toolDenied.code === 'E_METHOD', 'ui.state.set was reachable from the Tool');
      const toolGet = await rejects(() => bridge.invoke('ui.state.get', {}, { source: 'tool', agentSessionId: 'session-x' }));
      assert(toolGet.code === 'E_METHOD', 'ui.state.get was reachable from the Tool');
      await bridge.dispose();

      // A fresh activation restores the persisted panel state.
      const secondWorkspace = await makeWorkspace();
      const second = makeBridge(secondWorkspace, bridgeConfig(secondWorkspace, seeded.root));
      const restored = await second.invoke('ui.state.get', {}, { source: 'http' });
      assert(restored.lastProjectId === PROJECT, `lastProjectId did not survive a restart: ${restored.lastProjectId}`);
      assert(restored.layout !== null && Math.abs(restored.layout.aiPaneRatio - 0.61) < 0.001, 'the layout ratio did not survive a restart');
      await second.dispose();
      // UI state never touches user project data.
      assert((await readFile(seeded.paths.projectsRegistryPath, 'utf8')) === registryBefore, 'ui-state persistence rewrote the project registry');
      const uiStateFile = JSON.parse(await readFile(seeded.paths.uiStatePath, 'utf8'));
      assert(uiStateFile.lastProjectId === PROJECT && Math.abs(uiStateFile.layout.aiPaneRatio - 0.61) < 0.001, 'ui-state.json does not contain the persisted values');
      await rm(workspace.root, { recursive: true, force: true });
      await rm(secondWorkspace.root, { recursive: true, force: true });
      await assertRealRootUntouched();
    });
  });

  await run('M1-01: an inherited DSH_VIDEO_DATA_ROOT never leaks into default-root scenarios', async () => {
    // Simulate the Lead/CI shell: the process itself starts with the override set.
    process.env.DSH_VIDEO_DATA_ROOT = join(tmpdir(), 'dsh-video-forbidden-inherited-root-' + process.pid);
    try {
      await withTempHome('inherited-env', async (home) => {
        assert(process.env.DSH_VIDEO_DATA_ROOT === undefined, 'the isolated scenario left the inherited data-root env in place');
        const workspace = await makeWorkspace();
        const bridge = makeBridge(workspace);
        await bridge.invoke('doctor', {});
        assert(existsSync(join(home, 'Movies', 'DSH Video', 'registry.json')) === true, 'the inherited env leaked into the default data-root path');
        await bridge.dispose();
        await rm(workspace.root, { recursive: true, force: true });
        await assertRealRootUntouched();
      });
      // Inside the scenario the env still has priority over the default when set.
      await withTempHome('env-positive', async (home) => {
        const envRoot = join(home, 'env-preferred');
        process.env.DSH_VIDEO_DATA_ROOT = envRoot;
        const workspace = await makeWorkspace();
        const bridge = makeBridge(workspace);
        await bridge.invoke('doctor', {});
        assert(existsSync(join(envRoot, 'registry.json')) === true, 'the in-scenario env override did not win over the default');
        assert(existsSync(join(home, 'Movies', 'DSH Video')) === false, 'the default root was created despite the env override');
        await bridge.dispose();
        await rm(workspace.root, { recursive: true, force: true });
        await assertRealRootUntouched();
      });
    } finally {
      delete process.env.DSH_VIDEO_DATA_ROOT;
    }
  });

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exitCode = 1;
}

async function digestTree(root) {
  const entries = [];
  async function walk(directory) {
    const items = await readdir(directory, { withFileTypes: true });
    items.sort((left, right) => left.name.localeCompare(right.name));
    for (const item of items) {
      const path = join(directory, item.name);
      if (item.isDirectory()) await walk(path);
      else if (item.isFile()) {
        const bytes = await readFile(path);
        entries.push({ path, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
  }
  await walk(root);
  return entries;
}

await main();
