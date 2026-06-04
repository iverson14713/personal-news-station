/**
 * 匯出 App Store 截圖（1290×2796）
 * 用法：npm run screenshot:news
 */
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { preview } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const OUT_DIR = path.join(root, "screenshots", "news");
const PORT = 4173;
const W = 1290;
const H = 2796;

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

async function main() {
  console.log("Building…");
  await runBuild();

  const previewServer = await preview({
    root,
    preview: { port: PORT, strictPort: true },
  });
  previewServer.printUrls();

  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const base = `http://127.0.0.1:${PORT}`;

  try {
    for (let i = 1; i <= 5; i++) {
      const page = await browser.newPage({
        viewport: { width: W, height: H },
        deviceScaleFactor: 1,
      });
      await page.goto(`${base}/app-store-screenshot/news/${i}`, {
        waitUntil: "networkidle",
        timeout: 60_000,
      });
      await page.waitForSelector(`#screenshot-${i}`, { timeout: 15_000 });
      await page.waitForTimeout(400);
      const out = path.join(OUT_DIR, `news-${i}.png`);
      await page.screenshot({ path: out, fullPage: false });
      console.log(`Saved ${out}`);
      await page.close();
    }
  } finally {
    await browser.close();
    await previewServer.close();
  }

  console.log(`Done. Output: ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
