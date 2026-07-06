import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";

type ToastState = {
  message: string;
  tone: "success" | "error";
} | null;

let showToastImpl: ((message: string, tone: "success" | "error") => void) | null = null;

export function showSettingsToast(message: string, tone: "success" | "error" = "success") {
  showToastImpl?.(message, tone);
}

export function SettingsToastHost() {
  const [toast, setToast] = useState<ToastState>(null);

  const show = useCallback((message: string, tone: "success" | "error") => {
    setToast({ message, tone });
  }, []);

  useEffect(() => {
    showToastImpl = show;
    return () => {
      showToastImpl = null;
    };
  }, [show]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        ...hostStyle,
        ...(toast.tone === "error" ? hostStyleError : hostStyleSuccess),
      }}
    >
      {toast.message}
    </div>
  );
}

const hostStyle: CSSProperties = {
  position: "fixed",
  left: "50%",
  bottom: "calc(88px + env(safe-area-inset-bottom, 0px))",
  transform: "translateX(-50%)",
  zIndex: 10060,
  maxWidth: "min(340px, calc(100vw - 32px))",
  padding: "12px 18px",
  borderRadius: "14px",
  fontSize: "15px",
  fontWeight: 700,
  textAlign: "center",
  boxShadow: "0 12px 40px rgba(0,0,0,.35)",
  pointerEvents: "none",
  animation: "fadeIn 0.2s ease",
};

const hostStyleSuccess: CSSProperties = {
  color: "#ECFDF5",
  background: "rgba(6, 78, 59, 0.92)",
  border: "1px solid rgba(52, 211, 153, 0.35)",
};

const hostStyleError: CSSProperties = {
  color: "#FEF2F2",
  background: "rgba(127, 29, 29, 0.92)",
  border: "1px solid rgba(248, 113, 113, 0.35)",
};
