export const AUDIO_BUCKET = "news-audio";

export const MS_DAY = 24 * 60 * 60 * 1000;

export const AUDIO_RETENTION_MS = {
  free: MS_DAY,
  pro: 7 * MS_DAY,
  favorited: 30 * MS_DAY,
} as const;

export function computeAudioExpiresAt(
  isPro: boolean,
  isFavorited: boolean,
  from = new Date()
): string {
  let retentionMs = AUDIO_RETENTION_MS.free;
  if (isFavorited) {
    retentionMs = AUDIO_RETENTION_MS.favorited;
  } else if (isPro) {
    retentionMs = AUDIO_RETENTION_MS.pro;
  }
  return new Date(from.getTime() + retentionMs).toISOString();
}

export function audioStoragePath(scriptId: string): string {
  return `audio/${scriptId}.mp3`;
}
