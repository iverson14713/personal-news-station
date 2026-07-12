/**
 * Audio push-ready metadata + neutral push copy tests.
 * Usage: node scripts/test-audio-push-ready.mjs
 */

const MIN_PLAYABLE_AUDIO_BYTES = 8_192;

function estimateMp3DurationSeconds(byteLength) {
  if (!Number.isFinite(byteLength) || byteLength <= 0) return 0;
  return Math.max(1, Math.round((byteLength * 8) / 128_000));
}

function isAudioCacheHit(row, requestedVoice, requestedStyle) {
  if (!row.audio_url?.trim()) return false;
  if (row.audio_expires_at && new Date(row.audio_expires_at).getTime() <= Date.now()) {
    return false;
  }
  if ((row.audio_voice ?? "") !== requestedVoice) return false;
  if ((row.audio_style ?? "") !== requestedStyle) return false;
  return true;
}

function isRemoteProbePlayable(probe) {
  return probe.ok && probe.estimatedDurationSeconds > 0;
}

function pushCopy(slot, displayName, options) {
  const name = displayName?.trim() || "朋友";
  const minutes = options.durationMinutes;
  const audioReady =
    options.audioReady === true && options.hasAnchorAudio === true;
  const anchorName = options.anchorName?.trim();

  if (audioReady) {
    if (slot === "evening") {
      return {
        title: anchorName ? `🌙 ${name}，${anchorName} 已經準備好今晚的 AI 晚報` : "晚報",
        body:
          typeof minutes === "number" && minutes > 0
            ? `${minutes} 分鐘快速掌握重點`
            : "點一下立即開始收聽",
      };
    }
    return {
      title: anchorName ? `🎙️ ${name}，${anchorName} 已經準備好今天的 AI 早報` : "早報",
      body:
        typeof minutes === "number" && minutes > 0
          ? `濃縮成 ${minutes} 分鐘`
          : "點一下立即開始收聽",
    };
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

run("07:06 case: metadata miss when audio_url empty", () => {
  const row = {
    audio_url: null,
    audio_voice: "coral",
    audio_style: "news",
    audio_expires_at: null,
  };
  assert(isAudioCacheHit(row, "coral", "news") === false, "no url");
});

run("10:33 case: nova audio mismatches coral prefs", () => {
  const row = {
    audio_url: "https://example.com/a.mp3",
    audio_voice: "nova",
    audio_style: "news",
    audio_expires_at: new Date(Date.now() + 3600_000).toISOString(),
  };
  assert(isAudioCacheHit(row, "coral", "news") === false, "voice mismatch");
  assert(isAudioCacheHit(row, "nova", "news") === true, "nova match");
});

run("push copy without duration does not hardcode 3 minutes", () => {
  const copy = pushCopy("morning", "Wayne", {
    audioReady: true,
    hasAnchorAudio: true,
    anchorName: "Nova",
    durationMinutes: undefined,
  });
  assert(!copy.body.includes("3 分鐘"), copy.body);
  assert(copy.body.includes("點一下"), copy.body);
});

run("fallback push when audio not ready", () => {
  const copy = pushCopy("morning", "Wayne", {
    audioReady: false,
    hasAnchorAudio: false,
    anchorName: "Emily",
    durationMinutes: 3,
  });
  assert(copy.title === "📰 今日 AI 新聞已完成", copy.title);
  assert(!copy.title.includes("Emily"), copy.title);
});

run("remote probe rejects tiny files", () => {
  const probe = {
    ok: false,
    estimatedDurationSeconds: 0,
    contentLength: 100,
  };
  assert(!isRemoteProbePlayable(probe), "tiny file");
});

run("duration estimate from bytes", () => {
  const seconds = estimateMp3DurationSeconds(3_045_120);
  assert(seconds > 0, `seconds=${seconds}`);
  assert(seconds >= MIN_PLAYABLE_AUDIO_BYTES / 1000, "reasonable");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
