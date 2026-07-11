/** 送審前驗證：點推播開啟 / 自動播放診斷 log（不改行為） */
export type PushOpenDebugFields = {
  phase?: string;
  raw_payload?: unknown;
  normalized_openInfo?: unknown;
  openTarget?: string | null;
  type?: string | null;
  radio_slot?: string | null;
  scriptId?: string | null;
  autoPlay?: boolean;
  audioReady?: boolean;
  audio_url_exists?: boolean;
  audio_url_prefix?: string | null;
  navigate_to_play_page?: boolean;
  authReady?: boolean;
  navigationReady?: boolean;
  appState?: string;
  parsedScriptId?: string | null;
  parsedRadioSlot?: string | null;
  parsedOpenTarget?: string | null;
  anchorPlayer_play_called?: boolean;
  play_promise_resolved?: boolean;
  play_promise_rejected?: boolean;
  play_error_name?: string | null;
  play_error_message?: string | null;
  fallback_button_shown?: boolean;
  shouldTryMp3?: boolean;
  script_date?: string | null;
};

export function logPushOpenReceived(fields: PushOpenDebugFields): void {
  console.log(JSON.stringify({ event: "push_open_received", ...fields }));
}

export function audioUrlPrefix(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 48);
}

export function playErrorFields(err: unknown): {
  play_error_name: string | null;
  play_error_message: string | null;
} {
  if (err instanceof Error) {
    return {
      play_error_name: err.name || null,
      play_error_message: err.message || null,
    };
  }
  return {
    play_error_name: null,
    play_error_message: String(err),
  };
}
