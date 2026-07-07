import type { ScriptAudioStaleReason } from "./aiAnchorSettings";

export type DisplayScriptSource = "server" | "manual";

export function buildServerScriptFingerprint(scriptId: string): string {
  return `server:${scriptId}`;
}

export function buildManualScriptFingerprint(savedAt: number, fp: string): string {
  return `manual:${savedAt}:${fp.slice(0, 48)}`;
}

export function isScriptAudioBound(
  boundFingerprint: string | null,
  currentFingerprint: string | null,
  audioUrl: string | null,
  staleReason: ScriptAudioStaleReason
): boolean {
  return Boolean(
    audioUrl?.trim() &&
      !staleReason &&
      boundFingerprint &&
      currentFingerprint &&
      boundFingerprint === currentFingerprint
  );
}
