/**
 * 匯出 App Store 截圖（真實 UI）
 * iPhone: 1242×2688 → screenshots/apple/screenshot-{n}.png
 * iPad:   2064×2752 → screenshots/apple/ipad-{n}.png
 */
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { preview } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resizeAllIphoneScreenshots } from "./resize-apple-screenshots.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const OUT_DIR = path.join(root, "screenshots", "apple");
const PORT = 4174;
const HOST = "127.0.0.1";

const JOBS = [
  { device: "iphone", w: 1242, h: 2688, name: (i) => `screenshot-${i}.png` },
  { device: "ipad", w: 2064, h: 2752, name: (i) => `ipad-${i}.png` },
];

function runBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "build"], {
      cwd: root,
      shell: true,
      stdio: "inherit",
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("build failed"))));
  });
}

async function waitForServerReady(baseUrl, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server not ready: ${baseUrl}`);
}

async function main() {
  console.log("Building…");
  await runBuild();

  const previewServer = await preview({
    root,
    preview: { port: PORT, strictPort: true, host: HOST },
  });

  await new Promise((resolve, reject) => {
    const srv = previewServer.httpServer;
    if (!srv) return reject(new Error("no http server"));
    if (srv.listening) return resolve();
    srv.once("listening", resolve);
    srv.once("error", reject);
  });

  const base = `http://${HOST}:${PORT}`;
  await waitForServerReady(base);
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const job of JOBS) {
      for (let i = 1; i <= 5; i++) {
        const page = await browser.newPage({
          viewport: { width: job.w, height: job.h },
          deviceScaleFactor: 1,
        });
        const url = `${base}/app-store-screenshot/${job.device}/${i}`;
        await page.goto(url, { waitUntil: "load", timeout: 60_000 });
        await page.waitForSelector(`#screenshot-${job.device}-${i}`, { timeout: 30_000 });
        await page.waitForTimeout(400);
        const rawOut = path.join(OUT_DIR, "iphone", job.name(i));
        if (job.device === "iphone") {
          await mkdir(path.join(OUT_DIR, "iphone"), { recursive: true });
        }
        const out = job.device === "iphone" ? rawOut : path.join(OUT_DIR, job.name(i));
        await page.screenshot({ path: out, fullPage: false });
        const shotMeta = await page.evaluate(() => ({
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          dpr: window.devicePixelRatio,
        }));
        console.log(
          `Captured ${out} viewport=${job.w}×${job.h} window=${shotMeta.innerWidth}×${shotMeta.innerHeight} dpr=${shotMeta.dpr}`
        );
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await previewServer.close();
  }

  console.log("Normalizing iPhone screenshots to 1242×2688…");
  await resizeAllIphoneScreenshots();

  console.log(`Done. Output: ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
