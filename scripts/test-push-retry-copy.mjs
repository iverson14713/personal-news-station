/**
 * Push retry audio-ready + copy routing tests.
 * Usage: npm run test:push-retry-copy
 */

function isAudioCacheHit(row, requestedVoice, requestedStyle) {
  if (!row.audio_url?.trim()) return false;
  if (row.audio_expires_at && new Date(row.audio_expires_at).getTime() <= Date.now()) {
    return false;
  }
  if ((row.audio_voice ?? "") !== requestedVoice) return false;
  if ((row.audio_style ?? "") !== requestedStyle) return false;
  return true;
}

function pushCopy(slot, displayName, options) {
  const name = displayName?.trim() || "朋友";
  const minutes = options.durationMinutes ?? 3;
  const audioReady =
    options.audioReady === true && options.hasAnchorAudio === true;
  const anchorName = options.anchorName?.trim();

  if (audioReady) {
    if (slot === "evening") {
      const title = anchorName
        ? `🌙 ${name}，${anchorName} 已經準備好今晚的 AI 晚報`
        : `🌙 ${name}，你的 AI 主播已準備好。`;
      return {
        title,
        body: `今天的重要新聞都整理好了，${minutes} 分鐘快速掌握重點。`,
      };
    }
    return {
      title: anchorName
        ? `🎙️ ${name}，${anchorName} 已經準備好今天的 AI 早報`
        : `🎙️ ${name}，你的 AI 主播已準備好。`,
      body: `今天整理了你關心的新聞，濃縮成 ${minutes} 分鐘，點一下立即開始收聽。`,
    };
  }

  if (slot === "evening") {
    return { title: "🌆 今日 AI 新聞已完成", body: "可開啟 App 閱讀" };
  }
  return { title: "📰 今日 AI 新聞已完成", body: "可開啟 App 閱讀" };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let passed = 0;
let failed = 0;

function run(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}

run("retry bug: missing voice/style makes audioReady false", () => {
  const row = {
    audio_url: "https://example.com/a.mp3",
    audio_voice: "alloy",
    audio_style: "calm",
    audio_expires_at: new Date(Date.now() + 3600_000).toISOString(),
  };
  assert(isAudioCacheHit(row, undefined, undefined) === false, "undefined voice/style");
});

run("retry fix: matching voice/style makes audioReady true", () => {
  const row = {
    audio_url: "https://example.com/a.mp3",
    audio_voice: "alloy",
    audio_style: "calm",
    audio_expires_at: new Date(Date.now() + 3600_000).toISOString(),
  };
  assert(isAudioCacheHit(row, "alloy", "calm") === true, "matching cache");
});

run("evening retry uses anchor copy when audioReady", () => {
  const copy = pushCopy("evening", "Wayne", {
    audioReady: true,
    hasAnchorAudio: true,
    anchorName: "小晴",
    durationMinutes: 3,
  });
  assert(copy.title.includes("AI 晚報"), copy.title);
  assert(!copy.title.includes("今日 AI 新聞已完成"), copy.title);
});

run("evening retry falls back only when audio not ready", () => {
  const copy = pushCopy("evening", "Wayne", {
    audioReady: false,
    hasAnchorAudio: false,
    anchorName: "小晴",
    durationMinutes: 3,
  });
  assert(copy.title === "🌆 今日 AI 新聞已完成", copy.title);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
