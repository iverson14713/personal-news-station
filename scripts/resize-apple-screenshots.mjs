/**
 * 將 iPhone App Store 截圖標準化為 1242×2688（6.5 吋）
 * 等比放大置中，外圍以深色背景補滿，不裁切、不拉伸。
 */
import { access, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const OUT_DIR = path.join(root, "screenshots", "apple");

export const IPHONE_TARGET_W = 1242;
export const IPHONE_TARGET_H = 2688;

const SOURCE_SUBDIRS = ["iphone", "raw"];

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveSourcePath(index) {
  const fileName = `screenshot-${index}.png`;
  for (const sub of SOURCE_SUBDIRS) {
    const candidate = path.join(OUT_DIR, sub, fileName);
    if (await fileExists(candidate)) return candidate;
  }
  return path.join(OUT_DIR, fileName);
}

async function sampleBackgroundRgb(inputPath) {
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const samples = [];
  const points = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
    [Math.floor(width / 2), 0],
    [Math.floor(width / 2), height - 1],
  ];

  for (const [x, y] of points) {
    const i = (y * width + x) * channels;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  }

  const r = Math.round(samples.reduce((s, c) => s + c[0], 0) / samples.length);
  const g = Math.round(samples.reduce((s, c) => s + c[1], 0) / samples.length);
  const b = Math.round(samples.reduce((s, c) => s + c[2], 0) / samples.length);
  return { r, g, b };
}

/**
 * @param {string} inputPath
 * @param {string} outputPath
 */
export async function resizeIphoneScreenshot(inputPath, outputPath) {
  const meta = await sharp(inputPath).metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;
  if (!srcW || !srcH) {
    throw new Error(`Invalid image: ${inputPath}`);
  }

  const bg = await sampleBackgroundRgb(inputPath);
  const scale = Math.min(IPHONE_TARGET_W / srcW, IPHONE_TARGET_H / srcH);
  const newW = Math.max(1, Math.round(srcW * scale));
  const newH = Math.max(1, Math.round(srcH * scale));
  const left = Math.round((IPHONE_TARGET_W - newW) / 2);
  const top = Math.round((IPHONE_TARGET_H - newH) / 2);

  const resized = await sharp(inputPath)
    .resize(newW, newH, { kernel: sharp.kernel.lanczos3, fit: "fill" })
    .png()
    .toBuffer();

  const samePath = path.resolve(inputPath) === path.resolve(outputPath);
  const writePath = samePath ? `${outputPath}.tmp` : outputPath;

  await sharp({
    create: {
      width: IPHONE_TARGET_W,
      height: IPHONE_TARGET_H,
      channels: 3,
      background: bg,
    },
  })
    .composite([{ input: resized, left, top }])
    .png({ compressionLevel: 9 })
    .toFile(writePath);

  if (samePath) {
    await unlink(outputPath).catch(() => {});
    await rename(writePath, outputPath);
  }

  const outMeta = await sharp(outputPath).metadata();
  return {
    input: `${srcW}×${srcH}`,
    output: `${outMeta.width}×${outMeta.height}`,
    padded: srcW !== IPHONE_TARGET_W || srcH !== IPHONE_TARGET_H,
  };
}

export async function resizeAllIphoneScreenshots() {
  const results = [];
  for (let i = 1; i <= 5; i++) {
    const src = await resolveSourcePath(i);
    if (!(await fileExists(src))) {
      throw new Error(`Missing source: ${src}`);
    }
    const out = path.join(OUT_DIR, `screenshot-${i}.png`);
    const info = await resizeIphoneScreenshot(src, out);
    results.push({ index: i, src, out, ...info });
    console.log(`screenshot-${i}.png → ${info.output} (from ${info.input})`);
  }
  return results;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  resizeAllIphoneScreenshots().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
