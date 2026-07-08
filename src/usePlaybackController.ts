import { useCallback, useEffect, useRef, useState } from "react";
import { clearAutoplayDailyFlag } from "./dailyRadio";
import {
  estimateChunkDurationMs,
  estimatePlaybackSafeFallbackMs,
  findResumeIndex,
  isSpeechSynthesisActive,
  logPlaybackState,
  stopSpeechSynthesis,
  sanitizeForDeviceSpeechSynthesis,
  type PlaybackMode,
  type PlaybackState,
} from "./playbackController";
import { resolveChineseVoice } from "./voiceSelection";

export type PlayRequest = {
  text: string;
  mode: PlaybackMode;
  autoplay?: boolean;
};

type UsePlaybackControllerArgs = {
  speed: number;
  voiceName: string;
  voices: SpeechSynthesisVoice[];
};

export function usePlaybackController({
  speed,
  voiceName,
  voices,
}: UsePlaybackControllerArgs) {
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [remainingMs, setRemainingMs] = useState(0);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(null);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(-1);
  const [totalChunks, setTotalChunks] = useState(0);

  const playbackStateRef = useRef<PlaybackState>("idle");
  const playGenerationRef = useRef(0);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const currentSpeakTextRef = useRef("");
  const playbackFullTextRef = useRef("");
  const speakStartedAtRef = useRef(0);
  const lastBoundaryCharIndexRef = useRef(0);
  const lastBoundaryAtRef = useRef(0);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isManualStopRef = useRef(false);
  const autoplaySessionRef = useRef(false);

  const transition = useCallback((next: PlaybackState) => {
    playbackStateRef.current = next;
    logPlaybackState(next);
    setPlaybackState(next);
  }, []);

  const clearAutoplay = useCallback(() => {
    const hadSession = autoplaySessionRef.current;
    autoplaySessionRef.current = false;
    clearAutoplayDailyFlag();
    if (hadSession) {
      console.log("[Player] autoplay cleared");
    }
  }, []);

  const clearPlaybackTimers = useCallback(() => {
    if (playbackFallbackTimerRef.current != null) {
      clearTimeout(playbackFallbackTimerRef.current);
      playbackFallbackTimerRef.current = null;
    }
    if (playbackPollTimerRef.current != null) {
      clearInterval(playbackPollTimerRef.current);
      playbackPollTimerRef.current = null;
    }
  }, []);

  const clearProgressTimer = useCallback(() => {
    if (progressTimerRef.current != null) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  const resetProgress = useCallback(() => {
    setPlaybackProgress(0);
    setRemainingMs(0);
    setCurrentChunkIndex(-1);
    setTotalChunks(0);
  }, []);

  const invalidateSession = useCallback(() => {
    playGenerationRef.current += 1;
    currentUtteranceRef.current = null;
    currentSpeakTextRef.current = "";
    playbackFullTextRef.current = "";
    clearPlaybackTimers();
    clearProgressTimer();
  }, [clearPlaybackTimers, clearProgressTimer]);

  const finishPlaybackNaturally = useCallback(async () => {
    if (isManualStopRef.current) return;
    invalidateSession();
    await stopSpeechSynthesis();
    setPlaybackMode(null);
    resetProgress();
    setPlaybackProgress(1);
    clearAutoplay();
    transition("completed");
  }, [clearAutoplay, invalidateSession, resetProgress, transition]);

  const handlePlaybackError = useCallback(async () => {
    if (isManualStopRef.current) return;
    playGenerationRef.current += 1;
    invalidateSession();
    await stopSpeechSynthesis();
    setPlaybackMode(null);
    resetProgress();
    clearAutoplay();
    transition("error");
  }, [clearAutoplay, invalidateSession, resetProgress, transition]);

  const runFallbackSafetyCheck = useCallback(
    (utterance: SpeechSynthesisUtterance, speakText: string, rate: number) => {
      if (currentUtteranceRef.current !== utterance) return;
      if (isManualStopRef.current) return;
      if (playbackStateRef.current === "paused") {
        playbackFallbackTimerRef.current = window.setTimeout(() => {
          runFallbackSafetyCheck(utterance, speakText, rate);
        }, 30_000);
        return;
      }
      if (isSpeechSynthesisActive()) {
        playbackFallbackTimerRef.current = window.setTimeout(() => {
          runFallbackSafetyCheck(utterance, speakText, rate);
        }, 30_000);
        return;
      }
      if (playbackStateRef.current !== "playing") return;
      void finishPlaybackNaturally();
    },
    [finishPlaybackNaturally]
  );

  const startPlaybackWatchdog = useCallback(
    (
      utterance: SpeechSynthesisUtterance,
      speakText: string,
      fullText: string,
      rate: number
    ) => {
      clearPlaybackTimers();
      const totalChars = Math.max(1, fullText.length || speakText.length);
      setRemainingMs(estimateChunkDurationMs(speakText, rate));

      playbackPollTimerRef.current = window.setInterval(() => {
        if (currentUtteranceRef.current !== utterance) return;
        if (isManualStopRef.current) return;
        if (playbackStateRef.current === "paused") return;

        const boundaryIdx = lastBoundaryCharIndexRef.current;
        if (boundaryIdx > 0) {
          const progress = Math.min(1, boundaryIdx / totalChars);
          setPlaybackProgress(progress);
          const remainChars = Math.max(0, totalChars - boundaryIdx);
          setRemainingMs(
            estimateChunkDurationMs("一".repeat(Math.max(1, remainChars)), rate)
          );
        }
      }, 400);

      playbackFallbackTimerRef.current = window.setTimeout(() => {
        runFallbackSafetyCheck(utterance, speakText, rate);
      }, estimatePlaybackSafeFallbackMs(speakText, rate));
    },
    [clearPlaybackTimers, runFallbackSafetyCheck]
  );

  const attachUtteranceHandlers = useCallback(
    (
      utterance: SpeechSynthesisUtterance,
      speakText: string,
      fullText: string,
      rate: number,
      generation: number
    ) => {
      utterance.onboundary = (ev) => {
        if (playGenerationRef.current !== generation) return;
        if (currentUtteranceRef.current !== utterance) return;
        const idx =
          typeof (ev as unknown as { charIndex?: unknown }).charIndex === "number"
            ? Number((ev as unknown as { charIndex: number }).charIndex)
            : NaN;
        if (!Number.isNaN(idx) && idx >= 0) {
          lastBoundaryCharIndexRef.current = idx;
          lastBoundaryAtRef.current = Date.now();
        }
      };

      utterance.onstart = () => {
        if (playGenerationRef.current !== generation) return;
        if (currentUtteranceRef.current !== utterance) return;
        if (playbackStateRef.current === "loading") {
          if (autoplaySessionRef.current) {
            clearAutoplay();
          }
          transition("playing");
        }
      };

      utterance.onend = () => {
        if (playGenerationRef.current !== generation) return;
        if (currentUtteranceRef.current !== utterance) return;
        if (isManualStopRef.current) return;
        if (playbackStateRef.current === "paused") return;
        void finishPlaybackNaturally();
      };

      utterance.onerror = () => {
        if (playGenerationRef.current !== generation) return;
        if (currentUtteranceRef.current !== utterance) return;
        if (isManualStopRef.current) return;
        void handlePlaybackError();
      };

      startPlaybackWatchdog(utterance, speakText, fullText, rate);
    },
    [finishPlaybackNaturally, handlePlaybackError, startPlaybackWatchdog, clearAutoplay, transition]
  );

  const speakText = useCallback(
    (text: string, fullText: string, rate: number, generation: number) => {
      const safeText = sanitizeForDeviceSpeechSynthesis(text);
      const selectedVoice = resolveChineseVoice(voices, voiceName);
      const utterance = new SpeechSynthesisUtterance(safeText);
      utterance.lang = "zh-TW";
      utterance.rate = rate;
      if (selectedVoice) utterance.voice = selectedVoice;

      currentUtteranceRef.current = utterance;
      currentSpeakTextRef.current = text;
      speakStartedAtRef.current = Date.now();
      lastBoundaryCharIndexRef.current = 0;
      lastBoundaryAtRef.current = Date.now();

      attachUtteranceHandlers(utterance, safeText, fullText, rate, generation);

      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        void handlePlaybackError();
      }

      window.setTimeout(() => {
        if (playGenerationRef.current !== generation) return;
        if (currentUtteranceRef.current !== utterance) return;
        if (playbackStateRef.current === "loading") {
          transition("playing");
        }
      }, 300);
    },
    [attachUtteranceHandlers, handlePlaybackError, transition, voiceName, voices]
  );

  const play = useCallback(
    async (request: PlayRequest) => {
      const current = playbackStateRef.current;
      if (current === "loading" || current === "playing") {
        return false;
      }

      const text = request.text.trim();
      if (!text) return false;

      const generation = ++playGenerationRef.current;
      isManualStopRef.current = false;

      if (request.autoplay) {
        autoplaySessionRef.current = true;
        console.log("[Player] autoplay started");
      }

      transition("loading");
      setPlaybackMode(request.mode);
      setPlaybackProgress(0);
      setRemainingMs(estimateChunkDurationMs(text, speed));
      setCurrentChunkIndex(0);
      setTotalChunks(0);
      playbackFullTextRef.current = text;

      await stopSpeechSynthesis();
      if (playGenerationRef.current !== generation) return false;

      speakText(text, text, speed, generation);
      return true;
    },
    [speakText, speed, transition]
  );

  const stop = useCallback(async () => {
    playGenerationRef.current += 1;
    isManualStopRef.current = true;
    invalidateSession();
    await stopSpeechSynthesis();
    isManualStopRef.current = false;
    setPlaybackMode(null);
    resetProgress();
    clearAutoplay();
    clearAutoplayDailyFlag();
    transition("stopped");
  }, [clearAutoplay, invalidateSession, resetProgress, transition]);

  const pause = useCallback(() => {
    if (playbackStateRef.current !== "playing") return;
    try {
      window.speechSynthesis.pause();
    } catch {
      /* ignore */
    }
    transition("paused");
  }, [transition]);

  const resume = useCallback(() => {
    if (playbackStateRef.current !== "paused") return;
    try {
      window.speechSynthesis.resume();
    } catch {
      /* ignore */
    }
    transition("playing");
  }, [transition]);

  const togglePlayPause = useCallback(
    (request: PlayRequest | null) => {
      const current = playbackStateRef.current;
      if (current === "loading" || current === "playing") {
        if (current === "playing") pause();
        return;
      }
      if (current === "paused") {
        resume();
        return;
      }
      if (request) {
        void play(request);
      }
    },
    [pause, play, resume]
  );

  const changeSpeed = useCallback(
    (newSpeed: number) => {
      const current = playbackStateRef.current;
      if (current !== "playing" && current !== "paused") return;

      const fullText = playbackFullTextRef.current || currentSpeakTextRef.current;
      const currentText = currentSpeakTextRef.current;
      if (!currentText.trim()) return;

      const boundaryIdx = lastBoundaryCharIndexRef.current;
      let approxIdx = boundaryIdx;
      if (!approxIdx || approxIdx <= 0) {
        const elapsedMs = Math.max(0, Date.now() - speakStartedAtRef.current);
        const estCharsPerMs =
          1 / Math.max(1, estimateChunkDurationMs("一".repeat(100), speed) / 100);
        approxIdx = Math.floor(elapsedMs * estCharsPerMs);
      }

      const resumeAt = findResumeIndex(currentText, approxIdx);
      const remain = currentText.slice(resumeAt).trim();
      if (!remain) {
        void finishPlaybackNaturally();
        return;
      }

      const generation = ++playGenerationRef.current;
      isManualStopRef.current = true;
      clearPlaybackTimers();
      void stopSpeechSynthesis().then(() => {
        isManualStopRef.current = false;
        if (playGenerationRef.current !== generation) return;
        transition("loading");
        speakText(remain, fullText, newSpeed, generation);
      });
    },
    [clearPlaybackTimers, finishPlaybackNaturally, speakText, speed, transition]
  );

  useEffect(() => {
    logPlaybackState("idle");
  }, []);

  return {
    playbackState,
    playbackProgress,
    remainingMs,
    playbackMode,
    currentChunkIndex,
    totalChunks,
    play,
    stop,
    pause,
    resume,
    togglePlayPause,
    changeSpeed,
    clearAutoplay,
  };
}

export type PlaybackController = ReturnType<typeof usePlaybackController>;
