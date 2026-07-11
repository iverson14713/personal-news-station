import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  AI_ANCHOR_PLAYBACK_RATES,
  AI_ANCHOR_STYLES,
  AI_ANCHOR_VOICES,
  AI_ANCHOR_VOLUME_PRESETS,
  formatAnchorPlaybackRate,
  isVolumePresetActive,
  type AiAnchorPlaybackRate,
  type AiAnchorStyle,
  type AiAnchorVoice,
  type AiAnchorVolumeGain,
} from "./aiAnchorSettings";

import type { ScriptAudioStaleReason } from "./aiAnchorSettings";
import type { DisplayScriptSource } from "./scriptAudioBinding";
import type { RadioSlot } from "./radioSlot";
import { useAiAnchorPlayer, useAiAnchorPlayerActions } from "./AiAnchorAudioProvider";
import { isCapacitorNativePlatform } from "./useAiAnchorAudioGain";

type AiAnchorBroadcastPanelProps = {
  anchor: AiAnchorVoice;
  style: AiAnchorStyle;
  playbackRate: AiAnchorPlaybackRate;
  onPlaybackRateChange: (rate: AiAnchorPlaybackRate) => void;
  volumeGain: AiAnchorVolumeGain;
  onVolumeGainChange: (gain: AiAnchorVolumeGain) => void;
  audioUrl: string | null;
  loading: boolean;
  error: string | null;
  staleReason: ScriptAudioStaleReason;
  onGenerate: () => void;
  autoPlay?: boolean;
  onAutoPlayHandled?: () => void;
  /** 推播開啟後 iOS 擋 autoplay 時由外層顯示手動播放 */
  forceManualPlayPrompt?: boolean;
  displayScriptSource?: DisplayScriptSource;
  radioSlot?: RadioSlot | null;
  scriptId?: string | null;
};

const panelStyles: Record<string, CSSProperties> = {
  section: {
    marginBottom: "12px",
    padding: "14px",
    borderRadius: "16px",
    background: "linear-gradient(145deg, rgba(13,148,136,.12), rgba(8,145,178,.08))",
    border: "1px solid rgba(45,212,191,.18)",
  },
  title: {
    fontSize: "15px",
    fontWeight: 900,
    color: "#F8FAFC",
    marginBottom: "4px",
  },
  subtitle: {
    fontSize: "12px",
    color: "#CBD5E1",
    lineHeight: 1.5,
    marginBottom: "10px",
  },
  metaRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginBottom: "12px",
  },
  metaChip: {
    fontSize: "11px",
    color: "#E2E8F0",
    background: "rgba(255,255,255,.06)",
    border: "1px solid rgba(255,255,255,.1)",
    borderRadius: "999px",
    padding: "4px 10px",
  },
  readyLabel: {
    fontSize: "12px",
    fontWeight: 800,
    color: "#5EEAD4",
    marginBottom: "8px",
  },
  loading: {
    fontSize: "13px",
    color: "#94A3B8",
    lineHeight: 1.5,
  },
  staleNote: {
    fontSize: "12px",
    color: "#FCD34D",
    lineHeight: 1.5,
    marginBottom: "10px",
  },
  primaryBtn: {
    background: "linear-gradient(135deg, #0D9488, #0891B2)",
    color: "white",
    border: "none",
    borderRadius: "12px",
    padding: "10px 16px",
    fontWeight: 800,
    fontSize: "13px",
    cursor: "pointer",
    width: "100%",
  },
  playTodayBtn: {
    background: "linear-gradient(135deg, #14B8A6, #06B6D4)",
    color: "white",
    border: "none",
    borderRadius: "14px",
    padding: "14px 18px",
    fontWeight: 900,
    fontSize: "15px",
    cursor: "pointer",
    width: "100%",
    marginBottom: "10px",
  },
  player: {
    width: "100%",
    marginBottom: "10px",
  },
  rateRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    alignItems: "center",
  },
  rateLabel: {
    fontSize: "11px",
    color: "#94A3B8",
    marginRight: "4px",
  },
  rateBtn: {
    background: "rgba(255,255,255,.06)",
    color: "#E2E8F0",
    border: "1px solid rgba(255,255,255,.12)",
    borderRadius: "999px",
    padding: "5px 10px",
    fontSize: "11px",
    fontWeight: 700,
    cursor: "pointer",
  },
  rateBtnActive: {
    background: "rgba(45,212,191,.18)",
    color: "#99F6E4",
    border: "1px solid rgba(45,212,191,.35)",
  },
  error: {
    marginTop: "8px",
    fontSize: "12px",
    color: "#FCA5A5",
    lineHeight: 1.45,
  },
  volumeHint: {
    width: "100%",
    marginTop: "6px",
    fontSize: "11px",
    color: "#94A3B8",
    lineHeight: 1.45,
  },
  proUpgradeCard: {
    marginBottom: "12px",
    padding: "18px 16px",
    borderRadius: "18px",
    background:
      "linear-gradient(155deg, rgba(13,148,136,.22) 0%, rgba(99,102,241,.18) 48%, rgba(15,23,42,.4) 100%)",
    border: "1px solid rgba(45,212,191,.28)",
    boxShadow: "0 12px 36px rgba(13,148,136,.12), inset 0 1px 0 rgba(255,255,255,.08)",
  },
  proUpgradeTitle: {
    fontSize: "17px",
    fontWeight: 900,
    color: "#F8FAFC",
    marginBottom: "8px",
    letterSpacing: "-0.02em",
  },
  proUpgradeLead: {
    fontSize: "13px",
    color: "#CBD5E1",
    lineHeight: 1.55,
    marginBottom: "14px",
  },
  proUpgradeFeatures: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    marginBottom: "16px",
  },
  proUpgradeFeature: {
    fontSize: "13px",
    color: "#E2E8F0",
    lineHeight: 1.45,
    fontWeight: 600,
  },
  proUpgradeCta: {
    background: "linear-gradient(135deg, #10B981 0%, #0D9488 55%, #0891B2 100%)",
    color: "#022C22",
    border: "none",
    borderRadius: "14px",
    padding: "13px 16px",
    fontWeight: 900,
    fontSize: "15px",
    cursor: "pointer",
    width: "100%",
    boxShadow: "0 8px 24px rgba(16,185,129,.32)",
  },
};

function staleMessage(reason: ScriptAudioStaleReason): string {
  if (reason === "voice") return "你已切換主播，需要重新生成語音。";
  if (reason === "style") return "你已切換播報風格，需要重新生成語音。";
  if (reason === "both") return "你已切換主播與播報風格，需要重新生成語音。";
  return "";
}

export function AiAnchorBroadcastPanel({
  anchor,
  style,
  playbackRate,
  onPlaybackRateChange,
  volumeGain,
  onVolumeGainChange,
  audioUrl,
  loading,
  error,
  staleReason,
  onGenerate,
  autoPlay = false,
  onAutoPlayHandled,
  forceManualPlayPrompt = false,
  displayScriptSource = "manual",
  radioSlot = null,
  scriptId: _scriptId = null,
}: AiAnchorBroadcastPanelProps) {
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const nativePlatform = isCapacitorNativePlatform();
  const anchorActions = useAiAnchorPlayerActions();

  const hasReadyAudio = Boolean(audioUrl && !staleReason && !loading);
  const showManualPlayButton = autoplayBlocked || forceManualPlayPrompt;
  const generateLabel = staleReason
    ? "重新生成 AI 真人語音"
    : displayScriptSource === "manual"
      ? "🎙️ 生成這篇 AI 真人語音"
      : "🎙️ 生成 AI 真人語音";
  const readyLabel =
    displayScriptSource === "server" && radioSlot === "evening"
      ? "🎧 晚報 AI 音訊已就緒"
      : displayScriptSource === "server"
        ? "🎧 早報 AI 音訊已就緒"
        : "🎧 這篇 AI 音訊已就緒";
  const playLabel =
    displayScriptSource === "server" && radioSlot === "evening"
      ? "▶ 播放晚報 AI 真人語音"
      : displayScriptSource === "server"
        ? "▶ 播放早報 AI 真人語音"
        : "▶ 播放 AI 真人語音";

  useEffect(() => {
    if (!hasReadyAudio || !audioUrl) {
      anchorActions.setAudioUrl(null);
      return;
    }
    anchorActions.setAudioUrl(audioUrl);
  }, [anchorActions, audioUrl, hasReadyAudio]);

  useEffect(() => {
    anchorActions.setPlaybackRate(playbackRate);
  }, [anchorActions, playbackRate]);

  const playerHostRef = useCallback(
    (node: HTMLDivElement | null) => {
      anchorActions.registerControlsHost(hasReadyAudio ? node : null);
    },
    [anchorActions, hasReadyAudio]
  );

  useEffect(() => {
    if (!autoPlay || !audioUrl || staleReason) return;
    void anchorActions
      .play(audioUrl)
      .then(() => {
        setAutoplayBlocked(false);
        onAutoPlayHandled?.();
      })
      .catch(() => {
        setAutoplayBlocked(true);
        onAutoPlayHandled?.();
      });
  }, [autoPlay, audioUrl, staleReason, onAutoPlayHandled, anchorActions]);

  const handleManualPlay = () => {
    if (!audioUrl) return;
    void anchorActions.play(audioUrl).then(() => setAutoplayBlocked(false));
  };

  const subtitle = useMemo(
    () => `今天由 ${anchor.name} 以「${style.name}」風格為你播報`,
    [anchor.name, style.name]
  );

  return (
    <div style={panelStyles.section}>
      <div style={panelStyles.title}>🎙 你的專屬 AI 主播</div>
      <div style={panelStyles.subtitle}>{subtitle}</div>

      <div style={panelStyles.metaRow}>
        <span style={panelStyles.metaChip}>主播：{anchor.name}</span>
        <span style={panelStyles.metaChip}>風格：{style.name}</span>
        <span style={panelStyles.metaChip}>語速：{formatAnchorPlaybackRate(playbackRate)}</span>
      </div>

      {loading ? (
        <div style={panelStyles.loading}>AI 真人語音生成中…</div>
      ) : hasReadyAudio ? (
        <>
          <div style={panelStyles.readyLabel}>{readyLabel}</div>
          {showManualPlayButton ? (
            <button type="button" onClick={handleManualPlay} style={panelStyles.playTodayBtn}>
              {playLabel}
            </button>
          ) : null}
          <div ref={playerHostRef} style={panelStyles.player} />
          <div style={panelStyles.rateRow}>
            <span style={panelStyles.rateLabel}>音量</span>
            {AI_ANCHOR_VOLUME_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onVolumeGainChange(preset.gain)}
                style={{
                  ...panelStyles.rateBtn,
                  ...(isVolumePresetActive(preset, volumeGain) ? panelStyles.rateBtnActive : {}),
                }}
              >
                {preset.label}
                {preset.id === "enhanced" ? " · 預設" : ""}
              </button>
            ))}
          </div>
          {nativePlatform ? (
            <div style={panelStyles.volumeHint}>
              此裝置暫不支援前端音量增強，目前以標準音量播放；音量增強將於後續由伺服器端處理。
            </div>
          ) : null}
          <div style={panelStyles.rateRow}>
            <span style={panelStyles.rateLabel}>播放速度</span>
            {AI_ANCHOR_PLAYBACK_RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => onPlaybackRateChange(rate)}
                style={{
                  ...panelStyles.rateBtn,
                  ...(playbackRate === rate ? panelStyles.rateBtnActive : {}),
                }}
              >
                {formatAnchorPlaybackRate(rate)}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {staleReason ? (
            <div style={panelStyles.staleNote}>{staleMessage(staleReason)}</div>
          ) : null}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onGenerate();
            }}
            style={panelStyles.primaryBtn}
          >
            {generateLabel}
          </button>
        </>
      )}

      {error ? <div style={panelStyles.error}>{error}</div> : null}
    </div>
  );
}

type AiAnchorSettingsFieldsProps = {
  anchorId: string;
  styleId: string;
  playbackRate: AiAnchorPlaybackRate;
  onAnchorChange: (id: string) => void;
  onStyleChange: (id: string) => void;
  onPlaybackRateChange: (rate: AiAnchorPlaybackRate) => void;
};

const AI_ANCHOR_PRO_FEATURES = [
  "真人 AI 主播",
  "五種主播聲音",
  "五種播報風格",
  "每日自動生成",
  "一鍵播放",
] as const;

export function AiAnchorProLockCard({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <div style={panelStyles.proUpgradeCard}>
      <div style={panelStyles.proUpgradeTitle}>🎙 AI 真人主播（Pro）</div>
      <div style={panelStyles.proUpgradeLead}>每天自動為你生成專屬 AI 新聞</div>
      <div style={panelStyles.proUpgradeFeatures}>
        {AI_ANCHOR_PRO_FEATURES.map((feature) => (
          <div key={feature} style={panelStyles.proUpgradeFeature}>
            ✓ {feature}
          </div>
        ))}
      </div>
      <button type="button" onClick={onUpgrade} style={panelStyles.proUpgradeCta}>
        立即升級 Pro
      </button>
    </div>
  );
}

export function AiAnchorSettingsIntro() {
  return (
    <p style={anchorIntroStyle}>
      每天早上 7:00、下午 5:00，AI 主播都會依照以下設定，
      <br />
      為你播報今日新聞。
    </p>
  );
}

const anchorIntroStyle: CSSProperties = {
  margin: "0 0 2px",
  fontSize: "13px",
  lineHeight: 1.55,
  color: "#94A3B8",
};

export function AiAnchorSettingsFields({
  anchorId,
  styleId,
  playbackRate,
  onAnchorChange,
  onStyleChange,
  onPlaybackRateChange,
}: Omit<AiAnchorSettingsFieldsProps, "voiceFeatureEnabled">) {
  return (
    <>
      <div style={{ fontSize: "12px", fontWeight: 800, color: "#E2E8F0", marginBottom: "8px", marginTop: "4px" }}>
        主播聲音
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "14px" }}>
        {AI_ANCHOR_VOICES.map((item) => {
          const selected = item.id === anchorId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onAnchorChange(item.id)}
              style={{
                textAlign: "left",
                background: selected ? "rgba(45,212,191,.14)" : "rgba(255,255,255,.04)",
                border: selected
                  ? "1px solid rgba(45,212,191,.35)"
                  : "1px solid rgba(255,255,255,.1)",
                borderRadius: "12px",
                padding: "10px 12px",
                cursor: "pointer",
                color: "#F8FAFC",
              }}
            >
              <div style={{ fontWeight: 800, fontSize: "13px" }}>
                {item.name}
                {item.id === "emily" ? " · 預設" : ""}
              </div>
              <div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "2px" }}>
                {item.description}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: "12px", fontWeight: 800, color: "#E2E8F0", marginBottom: "8px" }}>
        播報風格
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "14px" }}>
        {AI_ANCHOR_STYLES.map((item) => {
          const selected = item.id === styleId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onStyleChange(item.id)}
              style={{
                background: selected ? "rgba(45,212,191,.14)" : "rgba(255,255,255,.04)",
                border: selected
                  ? "1px solid rgba(45,212,191,.35)"
                  : "1px solid rgba(255,255,255,.1)",
                borderRadius: "999px",
                padding: "7px 12px",
                fontSize: "12px",
                fontWeight: 700,
                color: selected ? "#99F6E4" : "#E2E8F0",
                cursor: "pointer",
              }}
            >
              {item.name}
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: "12px", fontWeight: 800, color: "#E2E8F0", marginBottom: "8px" }}>
        播放速度
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {AI_ANCHOR_PLAYBACK_RATES.map((rate) => {
          const selected = rate === playbackRate;
          return (
            <button
              key={rate}
              type="button"
              onClick={() => onPlaybackRateChange(rate)}
              style={{
                background: selected ? "rgba(45,212,191,.14)" : "rgba(255,255,255,.04)",
                border: selected
                  ? "1px solid rgba(45,212,191,.35)"
                  : "1px solid rgba(255,255,255,.1)",
                borderRadius: "999px",
                padding: "7px 12px",
                fontSize: "12px",
                fontWeight: 700,
                color: selected ? "#99F6E4" : "#E2E8F0",
                cursor: "pointer",
              }}
            >
              {formatAnchorPlaybackRate(rate)}
              {rate === 1.0 ? " 預設" : ""}
            </button>
          );
        })}
      </div>
    </>
  );
}
