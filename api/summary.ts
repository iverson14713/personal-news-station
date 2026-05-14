const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

type SummaryItem = { title: string; source: string };
type AiDuration = 1 | 3 | 5;

type HighlightOut = { level: string; title: string; summary: string };

function parseBody(req: any): Record<string, unknown> {
  const b = req.body;
  if (b == null) return {};
  if (typeof b === "string") {
    try {
      return JSON.parse(b) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof b === "object") return b as Record<string, unknown>;
  return {};
}

function normalizeDuration(raw: unknown): AiDuration {
  const n = Number(raw);
  if (n === 3 || n === 5) return n;
  return 1;
}

function durationParams(d: AiDuration) {
  switch (d) {
    case 3:
      return {
        maxTokens: 1300,
        scriptGuide: "「script」約 700～900 字：較完整、條理分明，適合約 3 分鐘口播。",
      };
    case 5:
      return {
        maxTokens: 2200,
        scriptGuide:
          "「script」約 1200～1500 字：深度、有層次與轉場，適合約 5 分鐘 Podcast 式主播稿。",
      };
    default:
      return {
        maxTokens: 700,
        scriptGuide: "「script」約 250～350 字：快速重點、節奏明快，適合約 1 分鐘口播。",
      };
  }
}

function safeJsonParse(s: string): Record<string, unknown> | null {
  try {
    const o = JSON.parse(s) as unknown;
    return typeof o === "object" && o !== null && !Array.isArray(o)
      ? (o as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function coerceHighlights(raw: unknown): HighlightOut[] {
  if (!Array.isArray(raw)) return [];
  const out: HighlightOut[] = [];
  for (const row of raw.slice(0, 8)) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const level = String(o.level ?? "").slice(0, 32);
    const title = String(o.title ?? "").slice(0, 300);
    const summary = String(o.summary ?? "").slice(0, 800);
    if (!title && !summary) continue;
    out.push({ level: level || "ℹ️一般", title: title || "重點", summary });
  }
  return out;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "僅支援 POST" });
  }

  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return res.status(200).json({
      ok: false,
      code: "NO_KEY",
      error: "尚未設定 AI API Key",
    });
  }

  const body = parseBody(req);
  const duration = normalizeDuration(body.duration);
  const { maxTokens, scriptGuide } = durationParams(duration);

  const rawItems = body.items;
  const items: SummaryItem[] = Array.isArray(rawItems)
    ? rawItems
        .slice(0, 5)
        .map((x: unknown) => {
          const o = x as Record<string, unknown>;
          return {
            title: String(o?.title ?? "").slice(0, 500),
            source: String(o?.source ?? "").slice(0, 200),
          };
        })
        .filter((x) => x.title.length > 0)
    : [];

  if (items.length === 0) {
    return res.status(200).json({
      ok: false,
      error: "請至少選擇一則新聞（僅需標題與來源）",
    });
  }

  const listText = items
    .map(
      (it, i) =>
        `${i + 1}. 標題：${it.title}\n   來源：${it.source}`
    )
    .join("\n\n");

  const system = `你是「AI 個人新聞台」的專業新聞編輯與主播稿撰寫助理。
使用者只會提供新聞「標題」與「來源」，沒有全文；請依標題合理推斷主題並整理，不要捏造具體數據或未被標題暗示的事實。
語氣：繁體中文、中性、資訊性；避免誇大投資建議，可做一般風險提醒。

本次主播稿長度目標：${duration} 分鐘。
${scriptGuide}

你必須只輸出一個 JSON 物件（不要 markdown 程式碼區、不要前後說明文字），結構如下：
{
  "highlights": [
    { "level": "🔥重大", "title": "簡短標題", "summary": "2～3 句繁體中文說明" }
  ],
  "script": "完整 AI 主播新聞稿（單一字串，可含換行）"
}

規則：
- highlights：最多 5 則，若輸入新聞少於 5 則則可少於 5；每則 summary 2～3 句。
- level 必須為以下之一（擇一）：「🔥重大」「⚠️注意」「ℹ️一般」
- script：符合上述字數區間的口播稿，流暢、有起承轉合，適合語音朗讀。`;

  const userMsg = `以下為使用者選取的新聞條目（僅標題與來源，無全文）。請依規定輸出 JSON：\n\n${listText}`;

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.5,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const errObj = data?.error as Record<string, unknown> | undefined;
      const msg =
        (typeof errObj?.message === "string" && errObj.message) ||
        `OpenAI 請求失敗（HTTP ${response.status}）`;
      return res.status(200).json({ ok: false, error: msg });
    }

    const choices = data?.choices as unknown[] | undefined;
    const first = choices?.[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    const content =
      typeof message?.content === "string" ? message.content.trim() : "";

    if (!content) {
      return res.status(200).json({
        ok: false,
        error: "AI 未回傳有效內容，請稍後再試",
      });
    }

    const parsed = safeJsonParse(content);
    if (parsed && typeof parsed.script === "string") {
      const script = parsed.script.trim();
      const highlights = coerceHighlights(parsed.highlights);
      if (!script) {
        return res.status(200).json({
          ok: false,
          error: "AI 回傳的 script 為空",
        });
      }
      return res.status(200).json({
        ok: true,
        duration,
        highlights,
        script,
        jsonFallback: false,
      });
    }

    return res.status(200).json({
      ok: true,
      duration,
      highlights: [],
      script: content,
      jsonFallback: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "連線或解析失敗";
    return res.status(200).json({ ok: false, error: msg });
  }
}
