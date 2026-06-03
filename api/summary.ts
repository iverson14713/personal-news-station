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

/** 依時長 × 新聞數量動態決定 token 上限與篇幅指引 */
function buildDynamicAllocation(duration: AiDuration, newsCount: number) {
  const n = newsCount;
  const many = n >= 4;
  const few = n <= 2;

  if (duration === 1) {
    const maxTokens = many ? 900 : n === 3 ? 800 : 650;
    const scriptWords = many
      ? "總字數約 240～340 字（快報節奏，寧短勿冗）"
      : n === 3
        ? "總字數約 260～360 字"
        : "總字數約 200～300 字";
    return {
      maxTokens,
      modeLabel: "1 分鐘｜快報模式",
      scriptGuide: `${scriptWords}。極精簡、像電視快報。
- 🔥重大、⚠️注意：口播可 1～2 句，講清重點。
- ℹ️一般：口播盡量 1 句，只講重點。
- 若新聞共 ${n} 則且偏多：先依重要度排序，前 1～2 則（🔥/⚠️）可稍完整；其餘用自然轉場「另外快速帶您幾則…」各用 1 句帶過，避免每則都過短導致聽不懂。
- 仍須在 script 中「提到」全部 ${n} 則（可詳略分明，不可完全省略任一则）。`,
      highlightsGuide: `highlights 共 ${n} 則，與輸入一一對應、順序一致。
- level：🔥重大 / ⚠️注意 / ℹ️一般（請先判斷重要度並排序，重要的排前）。
- summary 篇幅依 level 動態調整：
  · 🔥重大：1～2 句（重點＋一句影響）
  · ⚠️注意：1 句為主，必要時 2 句
  · ℹ️一般：1 句即可
- 禁止每則都寫滿 3 句；禁止長篇分析。`,
    };
  }

  if (duration === 3) {
    const maxTokens = many ? 1600 : few ? 1200 : 1400;
    const scriptWords = many
      ? "總字數約 480～680 字"
      : few
        ? "總字數約 400～580 字"
        : "總字數約 450～650 字";
    return {
      maxTokens,
      modeLabel: "3 分鐘｜平衡模式",
      scriptGuide: `${scriptWords}。節奏穩健、有轉場，像晚間新聞中段。
- 依 🔥/⚠️/ℹ️ 自動分配篇幅：🔥 可 2～3 句；⚠️ 約 1～2 句；ℹ️ 約 1 句。
- 可加入簡短影響說明，但避免評論專欄式長文。
- 全部 ${n} 則都要出現在 script；篇幅不必平均，重要多講、次要少講。
- 若共 ${n} 則：自行拿捏每則句數，總時長感約 3 分鐘，不要硬湊字數。`,
      highlightsGuide: `highlights 共 ${n} 則，與輸入一一對應。
- 先標 level 並依重要度排序。
- summary 動態篇幅：
  · 🔥重大：2 句（重點＋影響）
  · ⚠️注意：1～2 句
  · ℹ️一般：1 句為主
- 勿固定每則 3 句；勿對 ℹ️一般寫過長。`,
    };
  }

  // 5 分鐘
  const maxTokens = few ? 2600 : many ? 2000 : 2300;
  const scriptWords = few
    ? "總字數約 750～1100 字（依實際新聞量自然伸縮，勿灌水）"
    : many
      ? "總字數約 850～1150 字"
      : "總字數約 800～1050 字";
  return {
    maxTokens,
    modeLabel: "5 分鐘｜深度模式",
    scriptGuide: `${scriptWords}。像 Podcast 新聞節目，有層次、有轉場。
- 🔥重大：可 3～5 句，含背景脈絡、影響、後續觀察（僅能依標題合理推斷，勿捏造數據）。
- ⚠️注意：約 2～3 句，適度影響分析。
- ℹ️一般：1～2 句簡短帶過即可。
- 全部 ${n} 則須出現在 script；重要多講、次要少講。
${
  few
    ? `- 目前僅 ${n} 則新聞：內容可自然充實——為每則（尤其 🔥/⚠️）適度增加背景、市場／球隊／產業脈絡、後續觀察與延伸資訊；用「節目感」鋪陳，不要為湊字數重複廢話。`
    : `- 新聞較多（${n} 則）：深度留給 🔥/⚠️，ℹ️ 維持簡短，避免超時。`
}`,
    highlightsGuide: `highlights 共 ${n} 則，與輸入一一對應。
- 先標 level 並依重要度排序。
- summary 動態篇幅：
  · 🔥重大：2～3 句（重點、影響、可選一句後續觀察）
  · ⚠️注意：2 句
  · ℹ️一般：1 句
${
  few
    ? `- 新聞較少：🔥/⚠️ 的 summary 可稍增背景與影響，但仍保持精煉。`
    : ""
}`,
  };
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
  const deepMode = body.deepMode === true || body.mode === "deep";
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

  const n = items.length;
  const alloc = buildDynamicAllocation(duration, n);

  const listText = items
    .map(
      (it, i) =>
        `${i + 1}. 標題：${it.title}\n   來源：${it.source}`
    )
    .join("\n\n");

  const system = `你是「AI 個人新聞台」的專業新聞編輯與主播稿撰寫助理。
使用者只會提供新聞「標題」與「來源」，沒有全文；請依標題合理推斷主題並整理，不要捏造具體數據或未被標題暗示的事實。
語氣：繁體中文、中性、像真正新聞節目主播；有節奏、有轉場；避免誇大投資建議，可做一般風險提醒。

【本次參數】
- 模式：${alloc.modeLabel}
- 使用者選取新聞：${n} 則
- 你的任務：依「分鐘數 × 新聞數量 × 重要程度」動態分配篇幅，不要套用固定「每則 2～3 句」模板。

【script 篇幅總則】
${alloc.scriptGuide}

【highlights 篇幅總則】
${alloc.highlightsGuide}

你必須只輸出一個 JSON 物件（不要 markdown 程式碼區、不要前後說明文字），結構如下：
{
  "highlights": [
    { "level": "🔥重大", "title": "簡短標題", "summary": "依重要度動態調整句數" }
  ],
  "script": "完整 AI 主播新聞稿（單一字串，可含換行）"
}

【共通規則】
- highlights 必須恰好 ${n} 則，與輸入編號一一對應，不可合併或省略任一则。
- level 僅能使用：「🔥重大」「⚠️注意」「ℹ️一般」。
- script 必須涵蓋全部 ${n} 則新聞；禁止「第一則…第二則…」機械編號。
- 轉場範例：「首先帶您關注…」「接下來看到…」「另外，財經方面…」「最後快速補充幾則…」
- 結構：簡短開場 → 依重要度播報（詳略分明）→ 簡短結尾。
- 像新聞節目，不是固定模板摘要；字數/句數服務於「聽起來像 ${duration} 分鐘」，勿為湊字數重複空話。${
    deepMode
      ? `

【深度解析模式】
請補充事件背景、重點整理、可能影響、後續觀察，不要提供投資建議。`
      : ""
  }`;

  const userMsg = `以下為使用者選取的 ${n} 則新聞（僅標題與來源）。
請先判斷每則重要程度（🔥/⚠️/ℹ️），再依「${duration} 分鐘模式」與「共 ${n} 則」動態分配 highlights 與 script 篇幅。
輸出 JSON，highlights 必須 ${n} 則，script 須自然轉場並涵蓋每一則：

${listText}`;

  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.45,
        max_tokens: alloc.maxTokens,
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
