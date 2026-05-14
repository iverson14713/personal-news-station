const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

type SummaryItem = { title: string; source: string };

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

輸出結構（請嚴格遵守段落標題與順序）：

一、今日最重要 5 個重點
（若輸入少於 5 則，則列出全部即可；每則 2～3 句）
每一則開頭請標示重要程度之一：🔥重大 / ⚠️注意 / ℹ️一般

二、1 分鐘 AI 主播稿
（一段適合語音朗讀、約 1 分鐘長度的繁體中文口播稿，流暢、有起承轉合）`;

  const userMsg = `以下為使用者選取的新聞條目（僅標題與來源，無全文）。請依上述規定輸出：\n\n${listText}`;

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
        max_tokens: 700,
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

    return res.status(200).json({ ok: true, summary: content });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "連線或解析失敗";
    return res.status(200).json({ ok: false, error: msg });
  }
}
