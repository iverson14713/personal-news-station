export type AiHighlight = {
  level: string;
  title: string;
  summary: string;
};

export type ParsedAiSummary = {
  script: string;
  highlights: AiHighlight[];
};

function stripMarkdownJsonFence(text: string): string {
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  return s;
}

export function looksLikeRawSummaryJson(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("{")) return false;
  return (
    (t.includes('"highlights"') || t.includes("'highlights'")) &&
    (t.includes('"script"') || t.includes("'script'"))
  );
}

function extractJsonObjectSubstring(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function coerceHighlights(raw: unknown): AiHighlight[] {
  if (!Array.isArray(raw)) return [];
  const out: AiHighlight[] = [];
  for (const row of raw.slice(0, 8)) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const level = String(o.level ?? "").slice(0, 32);
    const title = String(o.title ?? "").slice(0, 300);
    const summary = String(o.summary ?? "").slice(0, 1200);
    if (!title && !summary) continue;
    out.push({
      level: level || "ℹ️一般",
      title: title || "重點",
      summary,
    });
  }
  return out;
}

function parseSummaryObject(o: Record<string, unknown>): ParsedAiSummary | null {
  const scriptRaw = o.script ?? o.Script;
  const script =
    typeof scriptRaw === "string"
      ? scriptRaw.trim()
      : typeof scriptRaw === "number"
        ? String(scriptRaw)
        : "";
  if (!script) return null;
  if (looksLikeRawSummaryJson(script)) {
    const nested = tryParseSummaryJsonText(script);
    if (nested?.script) return nested;
    return null;
  }
  return {
    script,
    highlights: coerceHighlights(o.highlights ?? o.Highlights),
  };
}

export function tryParseSummaryJsonText(text: string): ParsedAiSummary | null {
  const cleaned = stripMarkdownJsonFence(text);
  const candidates = [cleaned, extractJsonObjectSubstring(cleaned)].filter(
    Boolean
  ) as string[];

  for (const candidate of candidates) {
    try {
      const o = JSON.parse(candidate) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) {
        const parsed = parseSummaryObject(o as Record<string, unknown>);
        if (parsed?.script) return parsed;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

/** 統一從 AI 回傳內容取出可顯示／可朗讀的新聞稿（絕不回傳 JSON 原文） */
export function extractDisplayScript(aiResponse: unknown): string {
  if (aiResponse == null) return "";
  if (typeof aiResponse !== "string") {
    if (typeof aiResponse === "object" && !Array.isArray(aiResponse)) {
      const o = aiResponse as Record<string, unknown>;
      if (typeof o.script === "string") {
        return extractDisplayScript(o.script);
      }
    }
    return "";
  }

  const text = stripMarkdownJsonFence(aiResponse);
  if (!text) return "";

  const parsed = tryParseSummaryJsonText(text);
  if (parsed?.script) return parsed.script;

  if (looksLikeRawSummaryJson(text)) {
    return "";
  }

  return text;
}

/** 從 API payload 或原始字串解析 script + highlights */
export function parseAiSummaryContent(
  scriptField: unknown,
  highlightsField?: unknown
): ParsedAiSummary {
  const existingHighlights = Array.isArray(highlightsField)
    ? (highlightsField as AiHighlight[])
    : [];

  const fromField = extractDisplayScript(scriptField);
  const parsedFromRaw =
    typeof scriptField === "string" ? tryParseSummaryJsonText(scriptField) : null;

  const script = fromField || parsedFromRaw?.script || "";
  const highlights =
    existingHighlights.length > 0
      ? existingHighlights
      : parsedFromRaw?.highlights ?? [];

  return { script, highlights };
}

const VAGUE_REFERENCE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /這位球員/g, label: "這位球員" },
  { pattern: /該名球員/g, label: "該名球員" },
  { pattern: /某球員/g, label: "某球員" },
  { pattern: /某位球員/g, label: "某位球員" },
  { pattern: /這位人士/g, label: "這位人士" },
  { pattern: /某公司/g, label: "某公司" },
  { pattern: /該公司/g, label: "該公司" },
  { pattern: /某家公司/g, label: "某家公司" },
  { pattern: /該幣種/g, label: "該幣種" },
  { pattern: /這種幣/g, label: "這種幣" },
  { pattern: /某重砲手/g, label: "某重砲手" },
  { pattern: /這位重砲手/g, label: "這位重砲手" },
  { pattern: /該事件/g, label: "該事件" },
  { pattern: /這項政策/g, label: "這項政策" },
  { pattern: /這個市場/g, label: "這個市場" },
];

/** 偵測模糊代稱，僅 console.warn，不阻擋流程 */
export function warnScriptQuality(
  script: string,
  sourceItems?: { title: string; description?: string }[]
): void {
  if (!script.trim()) return;

  const seen = new Set<string>();
  for (const { pattern, label } of VAGUE_REFERENCE_PATTERNS) {
    pattern.lastIndex = 0;
    if (!pattern.test(script) || seen.has(label)) continue;
    seen.add(label);
    console.warn(
      `[AI 新聞稿品質] 偵測到模糊代稱「${label}」，請確認是否應寫明原新聞中的人名、球隊、公司或幣種。`,
      sourceItems?.length
        ? { titles: sourceItems.map((x) => x.title).slice(0, 3) }
        : undefined
    );
  }
}
