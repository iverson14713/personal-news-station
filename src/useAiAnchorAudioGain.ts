import { useEffect, type RefObject } from "react";

export function logAiAnchorAudio(label: string, data?: unknown): void {
  if (data !== undefined) {
    console.log(`[AiAnchorAudio] ${label}`, data);
  } else {
    console.log(`[AiAnchorAudio] ${label}`);
  }
}

/** iOS / Capacitor 原生殼：前端 GainNode 已停用，音量增強改由 server 端處理。 */
export function isCapacitorNativePlatform(): boolean {
  try {
    const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor;
    return Boolean(cap?.isNativePlatform?.());
  } catch {
    return false;
  }
}

function ensureNativeAudioOutput(audio: HTMLAudioElement): void {
  audio.volume = 1.0;
  audio.muted = false;
  logAiAnchorAudio("volume", audio.volume);
  logAiAnchorAudio("muted", audio.muted);
  logAiAnchorAudio("currentTime", audio.currentTime);
}

/**
 * 僅確保 AI 主播 <audio> 以原生輸出播放（volume=1.0、muted=false）。
 * 不使用 Web Audio / GainNode，避免 iOS Capacitor 無聲。
 */
export function useAiAnchorAudioGain(
  audioRef: RefObject<HTMLAudioElement | null>,
  audioUrl: string | null,
  enabled: boolean
) {
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !enabled || !audioUrl) return;

    logAiAnchorAudio("audio src", audio.currentSrc || audio.src || audioUrl);
    ensureNativeAudioOutput(audio);

    const onCanPlay = () => {
      logAiAnchorAudio("canplay");
      ensureNativeAudioOutput(audio);
    };

    const onPlay = () => {
      logAiAnchorAudio("play clicked");
      ensureNativeAudioOutput(audio);
    };

    const onPlaying = () => {
      logAiAnchorAudio("play resolved");
      ensureNativeAudioOutput(audio);
    };

    const onError = () => {
      const mediaError = audio.error;
      logAiAnchorAudio("error", {
        code: mediaError?.code ?? null,
        message: mediaError?.message ?? null,
      });
    };

    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("error", onError);
    };
  }, [audioRef, audioUrl, enabled]);
}
