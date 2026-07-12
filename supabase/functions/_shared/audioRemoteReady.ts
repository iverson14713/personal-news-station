/** Minimum MP3 size for a playable daily-radio clip (reject empty/error pages). */
export const MIN_PLAYABLE_AUDIO_BYTES = 8_192;

/** Rough duration estimate from MP3 byte size (~128kbps CBR heuristic). */
export function estimateMp3DurationSeconds(byteLength: number): number {
  if (!Number.isFinite(byteLength) || byteLength <= 0) return 0;
  const seconds = Math.round((byteLength * 8) / 128_000);
  return Math.max(1, seconds);
}

export type RemoteAudioProbe = {
  ok: boolean;
  httpStatus: number | null;
  contentType: string | null;
  contentLength: number | null;
  estimatedDurationSeconds: number;
  reason: string | null;
};

export async function probeRemoteAudioUrl(audioUrl: string): Promise<RemoteAudioProbe> {
  const url = audioUrl?.trim();
  if (!url) {
    return {
      ok: false,
      httpStatus: null,
      contentType: null,
      contentLength: null,
      estimatedDurationSeconds: 0,
      reason: "missing_url",
    };
  }

  try {
    let res = await fetch(url, { method: "HEAD" });
    if (!res.ok) {
      res = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-8191" },
      });
    }
    if (!res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        contentType: res.headers.get("content-type"),
        contentLength: null,
        estimatedDurationSeconds: 0,
        reason: `http_${res.status}`,
      };
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("audio") && !contentType.includes("mpeg")) {
      return {
        ok: false,
        httpStatus: res.status,
        contentType,
        contentLength: null,
        estimatedDurationSeconds: 0,
        reason: "invalid_content_type",
      };
    }

    const lengthHeader = res.headers.get("content-length");
    const contentLength =
      lengthHeader != null && Number.isFinite(Number(lengthHeader))
        ? Number(lengthHeader)
        : null;

    if (contentLength != null && contentLength < MIN_PLAYABLE_AUDIO_BYTES) {
      return {
        ok: false,
        httpStatus: res.status,
        contentType,
        contentLength,
        estimatedDurationSeconds: 0,
        reason: "content_too_small",
      };
    }

    const estimatedDurationSeconds =
      contentLength != null ? estimateMp3DurationSeconds(contentLength) : 1;

    return {
      ok: true,
      httpStatus: res.status,
      contentType,
      contentLength,
      estimatedDurationSeconds,
      reason: null,
    };
  } catch (error) {
    return {
      ok: false,
      httpStatus: null,
      contentType: null,
      contentLength: null,
      estimatedDurationSeconds: 0,
      reason: error instanceof Error ? error.message.slice(0, 120) : "fetch_failed",
    };
  }
}

export function isRemoteAudioProbePlayable(probe: RemoteAudioProbe): boolean {
  return probe.ok && probe.estimatedDurationSeconds > 0;
}
