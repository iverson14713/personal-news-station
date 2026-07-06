import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { formatAnchorPlaybackRate } from "./aiAnchorSettings";
import { dismissKeyboardAfterInput } from "./keyboardSetup";
import { buildAnchorGreetingPreview } from "./playbackIntro";

type DisplayNameFieldProps = {
  savedValue: string;
  onSave: (value: string) => Promise<boolean>;
  onToast: (message: string, tone: "success" | "error") => void;
  anchorName?: string;
  styleName?: string;
  playbackRate?: number;
};

export function DisplayNameField({
  savedValue,
  onSave,
  onToast,
  anchorName,
  styleName,
  playbackRate,
}: DisplayNameFieldProps) {
  const [draft, setDraft] = useState(savedValue);
  const [saving, setSaving] = useState(false);
  const [previewOpacity, setPreviewOpacity] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setDraft(savedValue);
    }
  }, [savedValue]);

  useEffect(() => {
    return () => {
      if (previewFadeTimerRef.current) clearTimeout(previewFadeTimerRef.current);
    };
  }, []);

  const previewLine = useMemo(() => buildAnchorGreetingPreview(draft), [draft]);

  const previewMeta = useMemo(() => {
    const name = anchorName?.trim() || "Emily";
    const style = styleName?.trim() || "專業新聞";
    const rate = formatAnchorPlaybackRate(playbackRate ?? 1.0);
    return `${name} · ${style} · ${rate}`;
  }, [anchorName, styleName, playbackRate]);

  const flashPreviewCard = useCallback(() => {
    if (previewFadeTimerRef.current) clearTimeout(previewFadeTimerRef.current);
    setPreviewOpacity(0.35);
    previewFadeTimerRef.current = setTimeout(() => {
      setPreviewOpacity(1);
      previewFadeTimerRef.current = null;
    }, 50);
  }, []);

  const save = useCallback(async () => {
    if (saving) return;
    const trimmed = draft.trim();
    if (trimmed === savedValue.trim()) {
      await dismissKeyboardAfterInput(inputRef.current);
      return;
    }

    setSaving(true);
    try {
      const ok = await onSave(trimmed);
      if (ok) {
        await dismissKeyboardAfterInput(inputRef.current);
        onToast("✅ 已儲存", "success");
        flashPreviewCard();
      } else {
        onToast("儲存失敗，請稍後再試", "error");
      }
    } catch {
      onToast("儲存失敗，請稍後再試", "error");
    } finally {
      setSaving(false);
    }
  }, [draft, savedValue, saving, onSave, onToast, flashPreviewCard]);

  const handleFocus = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void save();
      }
    },
    [save]
  );

  const dirty = draft.trim() !== savedValue.trim();

  return (
    <div style={wrapperStyle}>
      <label style={labelStyle} htmlFor="pns-display-name">
        👋 主播怎麼稱呼你？
      </label>
      <p style={hintStyle}>AI 主播開場時會用這個稱呼你。</p>
      <div style={rowStyle}>
        <input
          ref={inputRef}
          id="pns-display-name"
          type="text"
          enterKeyHint="done"
          autoComplete="nickname"
          autoCorrect="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={"例如：\nWayne、小明、朋友、韋辰"}
          style={inputStyle}
        />
        <button
          type="button"
          aria-label="儲存主播稱呼"
          disabled={saving || !dirty}
          onClick={() => void save()}
          style={{
            ...saveBtnStyle,
            opacity: saving || !dirty ? 0.45 : 1,
          }}
        >
          {saving ? "…" : "✓"}
        </button>
      </div>
      <div
        style={{
          ...previewCardStyle,
          opacity: previewOpacity,
          transition: "opacity 220ms ease",
        }}
      >
        <div style={previewCardTitleStyle}>🗣️ AI 主播預覽</div>
        <div style={previewCardMetaStyle}>{previewMeta}</div>
        <p style={previewCardBodyStyle}>{previewLine}</p>
      </div>
      <p style={previewDisclaimerStyle}>
        此設定僅影響 AI 主播開場稱呼，
        <br />
        不會影響新聞內容。
        <br />
        實際播報將使用 AI 真人語音。
      </p>
    </div>
  );
}

const wrapperStyle: CSSProperties = {
  marginTop: "14px",
  marginBottom: "4px",
};

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: "13px",
  fontWeight: 700,
  color: "#CBD5E1",
};

const hintStyle: CSSProperties = {
  margin: "4px 0 0",
  color: "#94A3B8",
  fontSize: "13px",
  lineHeight: 1.45,
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  marginTop: "8px",
};

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  boxSizing: "border-box",
  background: "rgba(255,255,255,.08)",
  color: "white",
  border: "1px solid rgba(255,255,255,.12)",
  outline: "none",
  fontSize: "16px",
  lineHeight: 1.35,
  padding: "12px",
  borderRadius: "14px",
  WebkitTextSizeAdjust: "100%",
};

const saveBtnStyle: CSSProperties = {
  flexShrink: 0,
  width: "44px",
  height: "44px",
  borderRadius: "14px",
  border: "1px solid rgba(167,139,250,.45)",
  background: "rgba(124,58,237,.35)",
  color: "#E9D5FF",
  fontSize: "20px",
  fontWeight: 800,
  cursor: "pointer",
};

const previewCardStyle: CSSProperties = {
  marginTop: "12px",
  padding: "12px 14px",
  borderRadius: "14px",
  background: "rgba(255,255,255,.04)",
  border: "1px solid rgba(255,255,255,.06)",
};

const previewCardTitleStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  color: "#94A3B8",
  lineHeight: 1.4,
};

const previewCardMetaStyle: CSSProperties = {
  marginTop: "6px",
  fontSize: "11px",
  fontWeight: 600,
  color: "#64748B",
  lineHeight: 1.4,
};

const previewCardBodyStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: "12px",
  lineHeight: 1.55,
  color: "#64748B",
};

const previewDisclaimerStyle: CSSProperties = {
  margin: "10px 0 0",
  fontSize: "11px",
  lineHeight: 1.55,
  color: "#475569",
};
