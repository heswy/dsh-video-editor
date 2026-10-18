import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gsapDist, sha256, systemFont } from "./util.mjs";

export const LOGO_COLOR = "#facc15";
export const SHOT_COLORS = ["#22d3ee", "#a3e635", "#f472b6", "#c084fc"];

async function ffmpegColor(path, color, width, height) {
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=${width}x${height}`,
    "-frames:v",
    "1",
    path,
  ]);
}

// Self-made test assets: flat colours make it possible to verify in decoded
// frames that the declared assets really reached the composition. No user
// material is copied into the spike.
export async function generateTestImages(dir) {
  await mkdir(dir, { recursive: true });
  const images = { logo: resolve(dir, "logo.png"), shots: [] };
  await ffmpegColor(images.logo, LOGO_COLOR, 140, 140);
  for (let index = 0; index < SHOT_COLORS.length; index++) {
    const path = resolve(dir, `shot-${index + 1}.png`);
    await ffmpegColor(path, SHOT_COLORS[index], 250, 150);
    images.shots.push(path);
  }
  const hashes = {};
  for (const [name, path] of Object.entries({
    logo: images.logo,
    ...Object.fromEntries(images.shots.map((p, i) => [`shot-${i + 1}`, p])),
  }))
    hashes[name] = sha256(await readFile(path));
  return { images, hashes };
}

export async function installProjectAssets(projectDir, images) {
  const assets = resolve(projectDir, "assets");
  await mkdir(assets, { recursive: true });
  for (const name of ["gsap.min.js", "MotionPathPlugin.min.js"])
    await copyFile(resolve(gsapDist, name), resolve(assets, name));
  await copyFile(systemFont, resolve(assets, "Heiti.ttc"));
  await copyFile(images.logo, resolve(assets, "logo.png"));
  for (let index = 0; index < images.shots.length; index++)
    await copyFile(images.shots[index], resolve(assets, `shot-${index + 1}.png`));
  return [
    "assets/gsap.min.js",
    "assets/Heiti.ttc",
    "assets/logo.png",
    ...images.shots.map((_, index) => `assets/shot-${index + 1}.png`),
  ];
}

export function projectAssets() {
  return [
    "assets/gsap.min.js",
    "assets/Heiti.ttc",
    "assets/logo.png",
    ...SHOT_COLORS.map((_, index) => `assets/shot-${index + 1}.png`),
  ];
}
