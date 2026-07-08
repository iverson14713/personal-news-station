import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AiAnchorPlaybackRate } from "./aiAnchorSettings";

export function logAiAnchorGlobalPlayer(label: string, data?: unknown): void {
  if (data !== undefined) {
    console.log(`[AiAnchorGlobalPlayer] ${label}`, data);
  } else {
    console.log(`[AiAnchorGlobalPlayer] ${label}`);
  }
}

export type AiAnchorPlayerState = {
  audioUrl: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  error: string | null;
};

type AiAnchorPlayerActions = {
  play: (url?: string | null) => Promise<void>;
  pause: () => void;
  stop: () => void;
  toggle: (url?: string | null) => Promise<void>;
  seek: (time: number) => void;
  setPlaybackRate: (rate: AiAnchorPlaybackRate) => void;
  setAudioUrl: (url: string | null) => void;
  registerControlsHost: (element: HTMLElement | null) => void;
  registerStopTts: (fn: (() => void) | null) => void;
  getIsPlaying: () => boolean;
};

export type AiAnchorPlayerApi = AiAnchorPlayerState & AiAnchorPlayerActions;

type AiAnchorPlayerContextValue = {
  state: AiAnchorPlayerState;
  actions: AiAnchorPlayerActions;
};

const AiAnchorPlayerContext = createContext<AiAnchorPlayerContextValue | null>(null);

function readMediaError(audio: HTMLAudioElement): string | null {
  const err = audio.error;
  if (!err) return null;
  return err.message || `MediaError code ${err.code}`;
}

function syncPlayingState(audio: HTMLAudioElement): boolean {
  return !audio.paused && !audio.ended;
}

export function AiAnchorAudioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hiddenHostRef = useRef<HTMLDivElement | null>(null);
  const controlsHostRef = useRef<HTMLElement | null>(null);
  const currentUrlRef = useRef<string | null>(null);
  const stopTtsRef = useRef<(() => void) | null>(null);
  const initOnceRef = useRef(false);
  const desiredPlaybackRateRef = useRef<AiAnchorPlaybackRate>(1);

  const [state, setState] = useState<AiAnchorPlayerState>({
    audioUrl: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    playbackRate: 1,
    volume: 1,
    error: null,
  });

  const syncFromAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setState((prev) => ({
      ...prev,
      audioUrl: currentUrlRef.current,
      isPlaying: syncPlayingState(audio),
      currentTime: audio.currentTime,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      playbackRate: audio.playbackRate,
      volume: audio.volume,
      error: readMediaError(audio),
    }));
  }, []);

  const repositionAudio = useCallback(() => {
    const audio = audioRef.current;
    const host = controlsHostRef.current ?? hiddenHostRef.current;
    if (!audio || !host) return;

    if (audio.parentElement !== host) {
      host.appendChild(audio);
    }

    const visible = Boolean(controlsHostRef.current);
    audio.controls = visible;
    if (visible) {
      audio.style.display = "block";
      audio.style.width = "100%";
      audio.style.marginBottom = "10px";
      audio.style.opacity = "1";
      audio.style.pointerEvents = "auto";
      audio.style.position = "static";
      audio.style.height = "auto";
    } else {
      audio.style.position = "absolute";
      audio.style.width = "0";
      audio.style.height = "0";
      audio.style.opacity = "0";
      audio.style.pointerEvents = "none";
      audio.style.margin = "0";
    }

    if (visible) {
      logAiAnchorGlobalPlayer("route changed but keep playing", {
        currentTime: audio.currentTime,
        paused: audio.paused,
      });
    }
  }, []);

  const registerControlsHost = useCallback(
    (element: HTMLElement | null) => {
      controlsHostRef.current = element;
      repositionAudio();
    },
    [repositionAudio]
  );

  const setAudioUrl = useCallback(
    (url: string | null) => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }

      const normalized = url?.trim() || null;
      audio.playbackRate = desiredPlaybackRateRef.current;
      if (normalized === currentUrlRef.current) {
        logAiAnchorGlobalPlayer("route changed but keep playing", {
          src: normalized,
          currentTime: audio.currentTime,
          playbackRate: audio.playbackRate,
        });
        syncFromAudio();
        return;
      }

      currentUrlRef.current = normalized;
      logAiAnchorGlobalPlayer("set src", normalized);

      if (!normalized) {
        audio.removeAttribute("src");
        audio.load();
      } else if (audio.src !== normalized && audio.currentSrc !== normalized) {
        audio.src = normalized;
      }

      syncFromAudio();
    },
    [syncFromAudio]
  );

  const ensureOutput = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 1;
    audio.muted = false;
    audio.playbackRate = desiredPlaybackRateRef.current;
  }, []);

  useEffect(() => {
    if (initOnceRef.current || !hiddenHostRef.current) return;
    initOnceRef.current = true;

    const audio = document.createElement("audio");
    audio.setAttribute("playsinline", "");
    audio.preload = "auto";
    audio.volume = 1;
    audio.muted = false;
    audio.playbackRate = desiredPlaybackRateRef.current;
    hiddenHostRef.current.appendChild(audio);
    audioRef.current = audio;

    logAiAnchorGlobalPlayer("init once");

    const onPlay = () => {
      ensureOutput();
      stopTtsRef.current?.();
      syncFromAudio();
      logAiAnchorGlobalPlayer("play", {
        currentTime: audio.currentTime,
        playbackRate: audio.playbackRate,
      });
      logAiAnchorGlobalPlayer("currentTime", audio.currentTime);
    };

    const onPause = () => {
      syncFromAudio();
      logAiAnchorGlobalPlayer("pause", { currentTime: audio.currentTime });
      logAiAnchorGlobalPlayer("currentTime", audio.currentTime);
    };

    const onEnded = () => syncFromAudio();
    const onTimeUpdate = () => syncFromAudio();
    const onLoadedMetadata = () => syncFromAudio();
    const onError = () => {
      syncFromAudio();
      logAiAnchorGlobalPlayer("error", readMediaError(audio));
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("error", onError);
    };
  }, [ensureOutput, syncFromAudio]);

  const play = useCallback(
    async (url?: string | null) => {
      const audio = audioRef.current;
      if (!audio) return;

      if (url !== undefined) {
        setAudioUrl(url);
      }

      ensureOutput();
      stopTtsRef.current?.();

      try {
        await audio.play();
        syncFromAudio();
        logAiAnchorGlobalPlayer("play", {
          currentTime: audio.currentTime,
          playbackRate: audio.playbackRate,
        });
      } catch (err) {
        syncFromAudio();
        const errName = err instanceof Error ? err.name : null;
        const errMessage = err instanceof Error ? err.message : String(err);
        logAiAnchorGlobalPlayer("error", {
          phase: "play",
          message: errMessage,
        });
        console.log(
          JSON.stringify({
            event: "anchor_player_play",
            play_promise_rejected: true,
            play_error_name: errName,
            play_error_message: errMessage,
          })
        );
        throw err;
      }
    },
    [ensureOutput, setAudioUrl, syncFromAudio]
  );

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    syncFromAudio();
    logAiAnchorGlobalPlayer("pause", { currentTime: audio.currentTime });
  }, [syncFromAudio]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    syncFromAudio();
    logAiAnchorGlobalPlayer("pause", { phase: "stop", currentTime: 0 });
  }, [syncFromAudio]);

  const toggle = useCallback(
    async (url?: string | null) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (syncPlayingState(audio)) {
        pause();
        return;
      }
      await play(url);
    },
    [pause, play]
  );

  const seek = useCallback(
    (time: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = Math.max(0, time);
      syncFromAudio();
    },
    [syncFromAudio]
  );

  const setPlaybackRate = useCallback(
    (rate: AiAnchorPlaybackRate) => {
      desiredPlaybackRateRef.current = rate;
      const audio = audioRef.current;
      if (!audio) {
        setState((prev) => ({ ...prev, playbackRate: rate }));
        return;
      }
      audio.playbackRate = rate;
      syncFromAudio();
    },
    [syncFromAudio]
  );

  const registerStopTts = useCallback((fn: (() => void) | null) => {
    stopTtsRef.current = fn;
  }, []);

  const getIsPlaying = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return false;
    return syncPlayingState(audio);
  }, []);

  const actions = useMemo<AiAnchorPlayerActions>(
    () => ({
      play,
      pause,
      stop,
      toggle,
      seek,
      setPlaybackRate,
      setAudioUrl,
      registerControlsHost,
      registerStopTts,
      getIsPlaying,
    }),
    [
      play,
      pause,
      stop,
      toggle,
      seek,
      setPlaybackRate,
      setAudioUrl,
      registerControlsHost,
      registerStopTts,
      getIsPlaying,
    ]
  );

  const contextValue = useMemo(
    () => ({
      state,
      actions,
    }),
    [state, actions]
  );

  return (
    <AiAnchorPlayerContext.Provider value={contextValue}>
      {children}
      <div
        ref={hiddenHostRef}
        aria-hidden
        style={{
          position: "absolute",
          width: 0,
          height: 0,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      />
    </AiAnchorPlayerContext.Provider>
  );
}

export function useAiAnchorPlayer(): AiAnchorPlayerApi {
  const ctx = useContext(AiAnchorPlayerContext);
  if (!ctx) {
    throw new Error("useAiAnchorPlayer must be used within AiAnchorAudioProvider");
  }
  return { ...ctx.state, ...ctx.actions };
}

export function useAiAnchorPlayerActions(): AiAnchorPlayerActions {
  const ctx = useContext(AiAnchorPlayerContext);
  if (!ctx) {
    throw new Error("useAiAnchorPlayerActions must be used within AiAnchorAudioProvider");
  }
  return ctx.actions;
}
