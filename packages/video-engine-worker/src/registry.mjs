import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fail } from "./errors.mjs";

export const MAX_ASSET_BYTES = 8 * 1024 * 1024;
export const MAX_ASSETS = 16;
export const MAX_ASSET_TOTAL = 64 * 1024 * 1024;
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const IMAGE_EXT = /\.(png|jpe?g)$/i;
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export function inside(root, path) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export async function atomicWrite(path, data) {
  const temporary = resolve(
    dirname(path),
    `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  await writeFile(temporary, data);
  await rename(temporary, path);
}

export function generateProjectId() {
  return `proj-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

export function validateProjectId(value) {
  if (typeof value !== "string" || !PROJECT_ID.test(value))
    fail("E_PARAMS", "Invalid projectId");
  return value;
}

export function validateAssetName(value) {
  if (typeof value !== "string" || !ASSET_NAME.test(value) || !IMAGE_EXT.test(value))
    fail("E_PARAMS", "Invalid asset name");
  if (value.includes("..")) fail("E_PARAMS", "Invalid asset name");
  return value;
}

export function mediaTypeFor(name) {
  return /\.png$/i.test(name) ? "image/png" : "image/jpeg";
}

async function readRegistryFile(registryPath) {
  try {
    const parsed = JSON.parse(await readFile(registryPath, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      fail("E_CONFIGURATION", "Registry file is invalid", "startup");
    const projects = parsed.projects;
    if (projects === null || typeof projects !== "object" || Array.isArray(projects))
      fail("E_CONFIGURATION", "Registry projects are invalid", "startup");
    return { projects };
  } catch (error) {
    if (error.code === "ENOENT") return { projects: {} };
    if (error instanceof Error && error.code === "E_CONFIGURATION") throw error;
    fail("E_CONFIGURATION", "Registry file is unreadable", "startup");
  }
}

// Worker-managed projectsRoot: the registry file is the only project list and
// every entry must resolve inside projectsRoot.
export async function loadManagedRegistry(config) {
  await mkdir(config.projectsRoot, { recursive: true });
  const root = await realpath(config.projectsRoot);
  const registry = await readRegistryFile(config.registryPath);
  const projects = {};
  for (const [projectId, dir] of Object.entries(registry.projects)) {
    if (!PROJECT_ID.test(projectId))
      fail("E_CONFIGURATION", "Registry contains an invalid projectId", "startup");
    if (typeof dir !== "string" || !isAbsolute(dir))
      fail("E_CONFIGURATION", "Registry path is not absolute", "startup");
    let resolved;
    try {
      resolved = await realpath(dir);
    } catch {
      fail("E_CONFIGURATION", "Registry project is unavailable", "startup");
    }
    if (!inside(root, resolved))
      fail("E_CONFIGURATION", "Registry project escapes projectsRoot", "startup");
    projects[projectId] = resolved;
    await mkdir(resolved, { recursive: true });
  }
  return { projects, root, registryPath: config.registryPath, managed: true };
}

export async function addProjectToRegistry(config, projectId, projectDir) {
  const root = await realpath(config.projectsRoot);
  const resolved = await realpath(projectDir);
  if (!inside(root, resolved))
    fail("E_PATH", "Project escapes projectsRoot", "create");
  await withRegistryLock(config, async () => {
    const registry = await readRegistryFile(config.registryPath);
    registry.projects[projectId] = resolved;
    await atomicWrite(
      config.registryPath,
      JSON.stringify({ projects: registry.projects }, null, 2) + "\n",
    );
  });
}

// A single worker is the only registry writer, but requests are accepted
// concurrently, so creation and asset writes are serialized here.
const locks = new Map();
export function withProjectLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.then(fn);
  locks.set(
    key,
    next.catch(() => {}),
  );
  return next;
}
function withRegistryLock(config, fn) {
  return withProjectLock(`registry:${config.registryPath}`, fn);
}

export async function writeProjectFiles(projectDir, { html, manifest }) {
  await mkdir(resolve(projectDir, "assets"), { recursive: true });
  await writeFile(resolve(projectDir, "index.html.tmp"), html);
  await rename(resolve(projectDir, "index.html.tmp"), resolve(projectDir, "index.html"));
  await atomicWrite(
    resolve(projectDir, "project.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

export async function writeManifest(projectDir, manifest) {
  await atomicWrite(
    resolve(projectDir, "project.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

export async function createProjectDirectory(projectDir, { html, manifest }) {
  await mkdir(projectDir, { recursive: false });
  try {
    await writeProjectFiles(projectDir, { html, manifest });
  } catch (error) {
    await rm(projectDir, { recursive: true, force: true });
    throw error;
  }
}

export function imageSignature(bytes) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  return null;
}

export function countImageAssets(assets) {
  return assets.filter((name) => IMAGE_EXT.test(name)).length;
}

export function declaredAssetBytes(files) {
  let total = 0;
  for (const bytes of files.values()) total += bytes.length;
  return total;
}

export async function importAsset({
  config,
  projectDir,
  manifest,
  files,
  sourceName,
  name,
  mediaType,
}) {
  if (!config.assetInboxRoot)
    fail("E_CONFIGURATION", "No assetInboxRoot is configured", "asset");
  if (typeof sourceName !== "string" || !sourceName || sourceName.length > 256)
    fail("E_PARAMS", "Invalid sourceName");
  if (sourceName.includes("/") || sourceName.includes("\\") || sourceName.startsWith("."))
    fail("E_PARAMS", "sourceName must be a plain inbox file name");
  const inbox = await realpath(config.assetInboxRoot);
  let source;
  try {
    source = await realpath(resolve(inbox, sourceName));
  } catch {
    fail("E_ASSET_MISSING", "Inbox asset is unavailable", "asset");
  }
  if (!inside(inbox, source))
    fail("E_PATH", "Inbox asset escapes assetInboxRoot", "asset");
  let info;
  try {
    info = await stat(source);
  } catch {
    fail("E_ASSET_MISSING", "Inbox asset is unavailable", "asset");
  }
  if (!info.isFile()) fail("E_ASSET_MISSING", "Inbox asset is not a file", "asset");
  if (info.size > MAX_ASSET_BYTES) fail("E_LIMIT", "Asset exceeds 8 MiB", "asset");
  const bytes = await readFile(source);
  const signature = imageSignature(bytes);
  if (!signature) fail("E_PARAMS", "Only PNG/JPEG assets are supported", "asset");
  if (mediaType !== undefined && mediaType !== signature)
    fail("E_PARAMS", "mediaType does not match the asset signature", "asset");
  const targetName = validateAssetName(name ?? sourceName);
  if (!IMAGE_EXT.test(targetName)) fail("E_PARAMS", "Invalid asset name");
  const relativePath = `assets/${targetName}`;
  if (manifest.assets.includes(relativePath))
    fail("E_PARAMS", "Asset name already exists", "asset");
  const images = countImageAssets(manifest.assets);
  if (images >= MAX_ASSETS) fail("E_LIMIT", "Project has too many assets", "asset");
  const total = declaredAssetBytes(files) + bytes.length;
  if (total > MAX_ASSET_TOTAL)
    fail("E_LIMIT", "Project assets exceed 64 MiB", "asset");
  const target = resolve(projectDir, relativePath);
  if (!inside(await realpath(projectDir), await realpath(dirname(target))))
    fail("E_PATH", "Asset target escapes project", "asset");
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  try {
    await writeManifest(projectDir, {
      entry: manifest.entry,
      assets: [...manifest.assets, relativePath].sort(),
    });
  } catch (error) {
    await rm(target, { force: true });
    throw error;
  }
  return {
    path: relativePath,
    name: targetName,
    bytes: bytes.length,
    sha256: sha256(bytes),
    mediaType: signature,
  };
}

export { readRegistryFile };
