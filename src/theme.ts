/**
 * App UI design tokens（深藍 / 紫藍新聞台風格）
 */
export const TOKENS = {
  bgPage:
    "radial-gradient(circle at top left, rgba(29,78,216,.22) 0, transparent 32%), linear-gradient(180deg, #020617 0%, #0F172A 100%)",
  primaryGradient: "linear-gradient(135deg, #2563EB 0%, #6366F1 55%, #7C3AED 100%)",
  cardBg: "rgba(15,23,42,.82)",
  cardBorder: "rgba(255,255,255,.1)",
  cardBorderActive: "rgba(129,140,248,.55)",
  textPrimary: "#F8FAFC",
  textSecondary: "#94A3B8",
  textMuted: "#64748B",
  ctaGreen: "linear-gradient(135deg, #059669 0%, #10B981 100%)",
  ctaPurple: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)",
  danger: "#EF4444",
  radiusLg: "20px",
  radiusMd: "14px",
  radiusPill: "999px",
  spacingSm: "8px",
  spacingMd: "14px",
  spacingLg: "20px",
  glowSelected: "0 0 0 1px rgba(129,140,248,.35), 0 8px 24px rgba(99,102,241,.18)",
} as const;

export function shortVoiceLabel(voiceName: string): string {
  const m = voiceName.match(/^([^（(]+)/);
  return (m?.[1] ?? voiceName).trim() || "系統";
}
