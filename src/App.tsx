import { useEffect, useState } from "react";

type NewsItem = {
  id: number;
  title: string;
  link: string;
  source: string;
  pubDate: string;
  selected: boolean;
};

const topics = [
  { label: "全部", query: "NBA OR MLB OR BTC OR ETH OR 台股 OR ETF", icon: "✨" },
  { label: "NBA", query: "NBA 勇士 Curry", icon: "🏀" },
  { label: "MLB", query: "MLB 道奇 大谷翔平", icon: "⚾" },
  { label: "幣圈", query: "BTC OR ETH OR 加密貨幣 OR 比特幣", icon: "₿" },
  { label: "台股", query: "台股 ETF 台積電", icon: "📈" },
  { label: "國際", query: "戰爭 國際局勢 Fed 利率", icon: "🌍" },
];

function cleanTitle(title: string) {
  return title.replace(/\s-\s.*$/, "").trim();
}

export default function App() {
  const [activeTopic, setActiveTopic] = useState(topics[0]);
  const [customKeyword, setCustomKeyword] = useState("");
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [speed, setSpeed] = useState(1.2);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState("");

  useEffect(() => {
    const loadVoices = () => {
      const allVoices = window.speechSynthesis.getVoices();
      setVoices(allVoices);
      if (!voiceName && allVoices.length > 0) {
        const zhVoice = allVoices.find((v) => v.lang.includes("zh")) || allVoices[0];
        setVoiceName(zhVoice.name);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const fetchNews = async (query: string) => {
    setLoading(true);

    try {
      const res = await fetch(`/api/news?q=${encodeURIComponent(query)}`);
      const xmlText = await res.text();

      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, "text/xml");
      const items = Array.from(xml.querySelectorAll("item")).slice(0, 40);

      const seen = new Set<string>();

      const parsedNews: NewsItem[] = items
        .map((item, index) => {
          const rawTitle = item.querySelector("title")?.textContent || "無標題";
          const title = cleanTitle(rawTitle);

          return {
            id: index + 1,
            title,
            link: item.querySelector("link")?.textContent || "",
            source:
              item.querySelector("source")?.textContent ||
              rawTitle.split(" - ").pop() ||
              "Google News",
            pubDate: item.querySelector("pubDate")?.textContent || "",
            selected: index < 5,
          };
        })
        .filter((item) => {
          const key = item.title.replace(/[，。！？、\s]/g, "").slice(0, 24);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 20);

      setNews(parsedNews);
    } catch (error) {
      alert("新聞讀取失敗，請稍後再試");
      console.error(error);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchNews(activeTopic.query);
  }, []);

  const changeTopic = (topic: (typeof topics)[0]) => {
    setActiveTopic(topic);
    fetchNews(topic.query);
  };

  const searchCustomKeyword = () => {
    if (!customKeyword.trim()) {
      alert("請輸入想追蹤的關鍵字");
      return;
    }

    const customTopic = {
      label: customKeyword,
      query: customKeyword,
      icon: "🔎",
    };

    setActiveTopic(customTopic);
    fetchNews(customKeyword);
  };

  const toggleNews = (id: number) => {
    setNews((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, selected: !item.selected } : item
      )
    );
  };

  const selectAll = () => {
    setNews((prev) => prev.map((item) => ({ ...item, selected: true })));
  };

  const clearAll = () => {
    setNews((prev) => prev.map((item) => ({ ...item, selected: false })));
  };

  const speakNews = () => {
    window.speechSynthesis.cancel();

    const selectedNews = news.filter((item) => item.selected);

    if (selectedNews.length === 0) {
      alert("請先選擇要播放的新聞");
      return;
    }

    const text = selectedNews
      .map((n, i) => `第 ${i + 1} 則新聞，${n.title}`)
      .join("。");

    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = "zh-TW";
    speech.rate = speed;

    const selectedVoice = voices.find((v) => v.name === voiceName);
    if (selectedVoice) speech.voice = selectedVoice;

    window.speechSynthesis.speak(speech);
  };

  const stopSpeak = () => {
    window.speechSynthesis.cancel();
  };

  const copyGptPrompt = async () => {
    const selectedNews = news.filter((item) => item.selected);

    if (selectedNews.length === 0) {
      alert("請先選擇新聞");
      return;
    }

    const prompt = `
請幫我把以下新聞整理成「個人新聞台」精華版：

要求：
1. 用繁體中文
2. 先列出今日最重要的 5 個重點
3. 每則用 2～3 句話解釋
4. 幫我判斷重要程度：🔥重大 / ⚠️注意 / ℹ️一般
5. 最後給我一段適合語音朗讀的 1 分鐘新聞稿

新聞列表：
${selectedNews
  .map(
    (item, index) =>
      `${index + 1}. ${item.title}\n來源：${item.source}\n連結：${item.link}`
  )
  .join("\n\n")}
`;

    await navigator.clipboard.writeText(prompt);
    alert("已複製 GPT 精華整理 Prompt");
  };

  const selectedCount = news.filter((n) => n.selected).length;

  return (
    <div style={styles.page}>
      <div style={styles.phone}>
        <header style={styles.header}>
          <div>
            <div style={styles.kicker}>Personal News Radio</div>
            <h1 style={styles.title}>個人新聞台</h1>
            <p style={styles.subtitle}>只聽你真正關心的重點</p>
          </div>
          <div style={styles.logo}>🎙️</div>
        </header>

        <section style={styles.heroCard}>
          <div>
            <div style={styles.heroBadge}>今日新聞雷達</div>
            <h2 style={styles.heroTitle}>AI 新聞電台雛形</h2>
            <p style={styles.heroText}>
              已選 {selectedCount} 則新聞，可朗讀或丟給 GPT 變精華。
            </p>
          </div>

          <button onClick={speakNews} style={styles.playButton}>
            ▶ 播放
          </button>
        </section>

        <div style={styles.searchBox}>
          <input
            value={customKeyword}
            onChange={(e) => setCustomKeyword(e.target.value)}
            placeholder="搜尋：大谷、Curry、BTC、台積電..."
            style={styles.searchInput}
          />
          <button onClick={searchCustomKeyword} style={styles.searchButton}>
            搜尋
          </button>
        </div>

        <div style={styles.topicRow}>
          {topics.map((topic) => (
            <button
              key={topic.label}
              onClick={() => changeTopic(topic)}
              style={{
                ...styles.topicChip,
                ...(activeTopic.label === topic.label ? styles.topicChipActive : {}),
              }}
            >
              <span>{topic.icon}</span> {topic.label}
            </button>
          ))}
        </div>

        <section style={styles.controlPanel}>
          <div style={styles.controlTitle}>播放設定</div>

          <select
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            style={styles.select}
          >
            {voices.map((voice) => (
              <option key={voice.name} value={voice.name}>
                {voice.name}（{voice.lang}）
              </option>
            ))}
          </select>

          <div style={styles.speedRow}>
            <span>速度 {speed.toFixed(1)}x</span>
            <input
              type="range"
              min="0.8"
              max="2"
              step="0.1"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              style={{ width: "55%" }}
            />
          </div>

          <div style={styles.actionRow}>
            <button onClick={selectAll} style={styles.miniButton}>全選</button>
            <button onClick={clearAll} style={styles.miniButton}>取消</button>
            <button onClick={stopSpeak} style={styles.stopButton}>停止</button>
            <button onClick={copyGptPrompt} style={styles.gptButton}>GPT 精華</button>
          </div>
        </section>

        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>{activeTopic.label}｜今日新聞</h2>
          <span style={styles.countText}>{news.length} 則</span>
        </div>

        {loading && <div style={styles.loading}>新聞讀取中...</div>}

        <div style={styles.newsList}>
          {news.map((item, index) => (
            <article
              key={item.id}
              onClick={() => toggleNews(item.id)}
              style={{
                ...styles.newsCard,
                ...(item.selected ? styles.newsCardActive : {}),
              }}
            >
              <div style={styles.newsIndex}>{String(index + 1).padStart(2, "0")}</div>

              <div style={{ flex: 1 }}>
                <div style={styles.newsTitle}>
                  {item.selected ? "✅ " : ""}
                  {item.title}
                </div>

                <div style={styles.newsMeta}>
                  <span>{item.source}</span>
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={styles.link}
                  >
                    原文
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>

        <nav style={styles.bottomNav}>
          <div style={styles.navItemActive}>🏠<span>首頁</span></div>
          <div style={styles.navItem}>🎧<span>播放</span></div>
          <div style={styles.navItem}>⭐<span>收藏</span></div>
          <div style={styles.navItem}>⚙️<span>設定</span></div>
        </nav>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top left, #1D4ED8 0, transparent 28%), linear-gradient(180deg, #020617 0%, #0F172A 100%)",
    color: "white",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif',
    padding: "18px",
  },
  phone: {
    maxWidth: "460px",
    margin: "0 auto",
    paddingBottom: "92px",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 2px 18px",
  },
  kicker: {
    color: "#93C5FD",
    fontSize: "12px",
    letterSpacing: "1px",
    textTransform: "uppercase",
  },
  title: {
    margin: 0,
    fontSize: "34px",
    fontWeight: 900,
    letterSpacing: "-1px",
  },
  subtitle: {
    margin: "6px 0 0",
    color: "#CBD5E1",
    fontSize: "15px",
  },
  logo: {
    width: "54px",
    height: "54px",
    borderRadius: "18px",
    background: "linear-gradient(135deg, #2563EB, #7C3AED)",
    display: "grid",
    placeItems: "center",
    fontSize: "26px",
    boxShadow: "0 12px 30px rgba(37,99,235,.35)",
  },
  heroCard: {
    background:
      "linear-gradient(135deg, rgba(37,99,235,.95), rgba(124,58,237,.9))",
    borderRadius: "28px",
    padding: "22px",
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
    alignItems: "center",
    boxShadow: "0 20px 60px rgba(37,99,235,.35)",
  },
  heroBadge: {
    display: "inline-block",
    background: "rgba(255,255,255,.18)",
    padding: "6px 10px",
    borderRadius: "999px",
    fontSize: "12px",
    marginBottom: "12px",
  },
  heroTitle: {
    margin: 0,
    fontSize: "24px",
    fontWeight: 900,
  },
  heroText: {
    margin: "8px 0 0",
    color: "#DBEAFE",
    fontSize: "14px",
    lineHeight: 1.5,
  },
  playButton: {
    minWidth: "86px",
    height: "86px",
    borderRadius: "28px",
    border: "none",
    background: "white",
    color: "#1D4ED8",
    fontWeight: 900,
    fontSize: "16px",
    cursor: "pointer",
  },
  searchBox: {
    display: "flex",
    gap: "8px",
    marginTop: "18px",
    background: "rgba(255,255,255,.08)",
    padding: "8px",
    borderRadius: "18px",
    border: "1px solid rgba(255,255,255,.08)",
  },
  searchInput: {
    flex: 1,
    background: "transparent",
    color: "white",
    border: "none",
    outline: "none",
    fontSize: "15px",
    padding: "10px",
  },
  searchButton: {
    background: "#22C55E",
    color: "white",
    border: "none",
    borderRadius: "13px",
    padding: "0 14px",
    fontWeight: 800,
    cursor: "pointer",
  },
  topicRow: {
    display: "flex",
    gap: "9px",
    overflowX: "auto",
    padding: "18px 0 6px",
  },
  topicChip: {
    whiteSpace: "nowrap",
    background: "rgba(255,255,255,.08)",
    color: "#CBD5E1",
    border: "1px solid rgba(255,255,255,.08)",
    padding: "10px 14px",
    borderRadius: "999px",
    cursor: "pointer",
    fontWeight: 700,
  },
  topicChipActive: {
    background: "white",
    color: "#0F172A",
  },
  controlPanel: {
    marginTop: "14px",
    background: "rgba(15,23,42,.82)",
    border: "1px solid rgba(255,255,255,.08)",
    borderRadius: "24px",
    padding: "16px",
  },
  controlTitle: {
    fontWeight: 900,
    marginBottom: "10px",
  },
  select: {
    width: "100%",
    padding: "11px",
    borderRadius: "14px",
    border: "none",
    marginBottom: "12px",
  },
  speedRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    color: "#CBD5E1",
    fontSize: "14px",
  },
  actionRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    marginTop: "14px",
  },
  miniButton: {
    background: "#334155",
    color: "white",
    border: "none",
    borderRadius: "12px",
    padding: "9px 12px",
    cursor: "pointer",
    fontWeight: 700,
  },
  stopButton: {
    background: "#DC2626",
    color: "white",
    border: "none",
    borderRadius: "12px",
    padding: "9px 12px",
    cursor: "pointer",
    fontWeight: 700,
  },
  gptButton: {
    background: "#7C3AED",
    color: "white",
    border: "none",
    borderRadius: "12px",
    padding: "9px 12px",
    cursor: "pointer",
    fontWeight: 800,
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "24px",
    marginBottom: "12px",
  },
  sectionTitle: {
    margin: 0,
    fontSize: "20px",
    fontWeight: 900,
  },
  countText: {
    color: "#94A3B8",
    fontSize: "13px",
  },
  loading: {
    color: "#CBD5E1",
    background: "rgba(255,255,255,.08)",
    padding: "12px",
    borderRadius: "16px",
  },
  newsList: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  newsCard: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    background: "rgba(255,255,255,.07)",
    border: "1px solid rgba(255,255,255,.08)",
    borderRadius: "18px",
    padding: "13px",
    cursor: "pointer",
  },
  newsCardActive: {
    background: "rgba(37,99,235,.26)",
    border: "1px solid rgba(147,197,253,.45)",
  },
  newsIndex: {
    width: "34px",
    height: "34px",
    borderRadius: "12px",
    background: "rgba(255,255,255,.1)",
    display: "grid",
    placeItems: "center",
    color: "#93C5FD",
    fontWeight: 900,
    fontSize: "12px",
    flexShrink: 0,
  },
  newsTitle: {
    fontSize: "15px",
    fontWeight: 800,
    lineHeight: 1.45,
  },
  newsMeta: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    color: "#94A3B8",
    marginTop: "8px",
    fontSize: "12px",
  },
  link: {
    color: "#93C5FD",
    textDecoration: "none",
    flexShrink: 0,
  },
  bottomNav: {
    position: "fixed",
    left: "50%",
    bottom: "16px",
    transform: "translateX(-50%)",
    width: "calc(100% - 36px)",
    maxWidth: "430px",
    background: "rgba(15,23,42,.92)",
    border: "1px solid rgba(255,255,255,.1)",
    borderRadius: "24px",
    padding: "10px 12px",
    display: "flex",
    justifyContent: "space-around",
    backdropFilter: "blur(18px)",
    boxShadow: "0 20px 50px rgba(0,0,0,.4)",
  },
  navItem: {
    color: "#94A3B8",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "3px",
    fontSize: "12px",
  },
  navItemActive: {
    color: "white",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "3px",
    fontSize: "12px",
    fontWeight: 800,
  },
};
