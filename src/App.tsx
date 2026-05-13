import { useEffect, useState } from "react";

type Tab = "home" | "player" | "selected";

type NewsItem = {
  id: number;
  title: string;
  link: string;
  source: string;
  selected: boolean;
};

const topics = [
  "NBA",
  "MLB",
  "Curry",
  "大谷翔平",
  "季後賽",
  "幣圈",
  "BTC",
  "ETH",
  "台股",
  "ETF",
  "影視",
  "潮流",
  "音樂",
  "科技",
  "電影",
  "動漫",
];

export default function App() {
  const [tab, setTab] = useState<Tab>("home");

  const [selectedTopics, setSelectedTopics] = useState<string[]>([
    "NBA",
    "MLB",
    "Curry",
    "BTC",
    "大谷翔平",
  ]);

  const [customKeyword, setCustomKeyword] = useState("");

  const [news, setNews] = useState<NewsItem[]>([
    {
      id: 1,
      title: "🔥 Curry 狂砍 38 分，勇士搶下關鍵勝利",
      link: "#",
      source: "ESPN",
      selected: true,
    },
    {
      id: 2,
      title: "⚾ 大谷翔平今日雙響砲，道奇逆轉勝",
      link: "#",
      source: "MLB",
      selected: true,
    },
    {
      id: 3,
      title: "₿ BTC 跌破重要支撐，市場震盪",
      link: "#",
      source: "CoinDesk",
      selected: false,
    },
    {
      id: 4,
      title: "📈 台積電法說會即將登場，市場關注 AI",
      link: "#",
      source: "鉅亨網",
      selected: false,
    },
  ]);

  const [speed, setSpeed] = useState(1.2);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState("");

  const selectedNews = news.filter((n) => n.selected);

  useEffect(() => {
    const loadVoices = () => {
      const allVoices = window.speechSynthesis.getVoices();

      setVoices(allVoices);

      if (!voiceName && allVoices.length > 0) {
        const preferredVoice =
          allVoices.find(
            (v) =>
              v.lang.includes("zh") &&
              (v.name.includes("語舒") ||
                v.name.includes("黎澈"))
          ) ||
          allVoices.find((v) => v.lang.includes("zh")) ||
          allVoices[0];

        setVoiceName(preferredVoice.name);
      }
    };

    loadVoices();

    window.speechSynthesis.onvoiceschanged = loadVoices;

    setTimeout(loadVoices, 1000);
  }, []);

  const toggleTopic = (topic: string) => {
    setSelectedTopics((prev) =>
      prev.includes(topic)
        ? prev.filter((t) => t !== topic)
        : [...prev, topic]
    );
  };

  const toggleNews = (id: number) => {
    setNews((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, selected: !item.selected }
          : item
      )
    );
  };

  const selectAll = () => {
    setNews((prev) =>
      prev.map((item) => ({
        ...item,
        selected: true,
      }))
    );
  };

  const clearAll = () => {
    setNews((prev) =>
      prev.map((item) => ({
        ...item,
        selected: false,
      }))
    );
  };

  const createSpeech = (rate: number) => {
    const text = selectedNews
      .map((n, i) => `第 ${i + 1} 則新聞，${n.title}`)
      .join("。");

    const speech = new SpeechSynthesisUtterance(text);

    speech.lang = "zh-TW";
    speech.rate = rate;

    const selectedVoice = voices.find(
      (v) => v.name === voiceName
    );

    if (selectedVoice) {
      speech.voice = selectedVoice;
    }

    speech.onstart = () => {
      setIsSpeaking(true);
    };

    speech.onend = () => {
      setIsSpeaking(false);
    };

    return speech;
  };

  const speakNews = () => {
    window.speechSynthesis.cancel();

    if (selectedNews.length === 0) {
      alert("請先選擇新聞");
      return;
    }

    window.speechSynthesis.speak(createSpeech(speed));
  };

  const stopSpeak = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  const changeSpeed = (newSpeed: number) => {
    setSpeed(newSpeed);

    if (isSpeaking) {
      window.speechSynthesis.cancel();

      setTimeout(() => {
        window.speechSynthesis.speak(
          createSpeech(newSpeed)
        );
      }, 100);
    }
  };

  const copyGptPrompt = async () => {
    const prompt = `
請幫我整理以下新聞：

${selectedNews
  .map((n) => `- ${n.title}`)
  .join("\n")}

請：
1. 用繁體中文
2. 幫我整理重點
3. 幫我分析重要性
4. 最後給我 1 分鐘新聞稿
`;

    await navigator.clipboard.writeText(prompt);

    alert("已複製 GPT Prompt");
  };

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <div style={styles.smallTitle}>
              PERSONAL NEWS RADIO
            </div>

            <div style={styles.mainTitle}>
              個人新聞台
            </div>

            <div style={styles.subTitle}>
              只聽你真正關心的重點
            </div>
          </div>

          <div style={styles.logo}>🎙️</div>
        </div>

        <div style={styles.hero}>
          <div>
            <div style={styles.badge}>
              今日新聞雷達
            </div>

            <div style={styles.heroTitle}>
              我的新聞首頁
            </div>

            <div style={styles.heroText}>
              已追蹤 {selectedTopics.length} 個主題，
              已選 {selectedNews.length} 則新聞。
            </div>
          </div>

          <button
            style={styles.playButton}
            onClick={speakNews}
          >
            ▶ 播放
          </button>
        </div>

        {tab === "home" && (
          <>
            <div style={styles.searchBox}>
              <input
                style={styles.searchInput}
                placeholder="自訂：降息、台積電、Solana..."
                value={customKeyword}
                onChange={(e) =>
                  setCustomKeyword(e.target.value)
                }
              />

              <button style={styles.updateBtn}>
                更新
              </button>
            </div>

            <div style={styles.sectionTitle}>
              我的主題
            </div>

            <div style={styles.topicGrid}>
              {topics.map((topic) => {
                const active =
                  selectedTopics.includes(topic);

                return (
                  <button
                    key={topic}
                    onClick={() =>
                      toggleTopic(topic)
                    }
                    style={{
                      ...styles.topic,
                      ...(active
                        ? styles.topicActive
                        : {}),
                    }}
                  >
                    {topic}
                  </button>
                );
              })}
            </div>

            <div style={styles.actionRow}>
              <button
                style={styles.actionBtn}
                onClick={selectAll}
              >
                全選
              </button>

              <button
                style={styles.actionBtn}
                onClick={clearAll}
              >
                取消
              </button>

              <button
                style={styles.gptBtn}
                onClick={copyGptPrompt}
              >
                GPT 精華
              </button>
            </div>

            <div style={styles.sectionTitle}>
              我的今日新聞
            </div>

            <div style={styles.newsList}>
              {news.map((item) => (
                <div
                  key={item.id}
                  style={{
                    ...styles.newsCard,
                    ...(item.selected
                      ? styles.newsCardActive
                      : {}),
                  }}
                  onClick={() =>
                    toggleNews(item.id)
                  }
                >
                  <div style={styles.newsTitle}>
                    {item.selected ? "✅ " : ""}
                    {item.title}
                  </div>

                  <div style={styles.newsMeta}>
                    {item.source}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "player" && (
          <>
            <div style={styles.playerCard}>
              <div style={styles.sectionTitle}>
                播放設定
              </div>

              <select
                style={styles.select}
                value={voiceName}
                onChange={(e) =>
                  setVoiceName(e.target.value)
                }
              >
                {voices.map((voice) => (
                  <option
                    key={voice.name}
                    value={voice.name}
                  >
                    {voice.name}
                  </option>
                ))}
              </select>

              <div style={styles.speedRow}>
                <span>
                  速度 {speed.toFixed(1)}x
                </span>

                <input
                  type="range"
                  min="0.8"
                  max="2"
                  step="0.1"
                  value={speed}
                  onChange={(e) =>
                    changeSpeed(
                      Number(e.target.value)
                    )
                  }
                />
              </div>

              <div style={styles.actionRow}>
                <button
                  style={styles.playSmallBtn}
                  onClick={speakNews}
                >
                  播放
                </button>

                <button
                  style={styles.stopBtn}
                  onClick={stopSpeak}
                >
                  停止
                </button>
              </div>
            </div>
          </>
        )}

        {tab === "selected" && (
          <>
            <div style={styles.sectionTitle}>
              收藏新聞
            </div>

            <div style={styles.newsList}>
              {selectedNews.map((item) => (
                <div
                  key={item.id}
                  style={styles.newsCard}
                >
                  <div style={styles.newsTitle}>
                    ⭐ {item.title}
                  </div>

                  <div style={styles.newsMeta}>
                    {item.source}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={styles.bottomNav}>
          <button
            style={
              tab === "home"
                ? styles.navActive
                : styles.nav
            }
            onClick={() => setTab("home")}
          >
            🏠
            <span>首頁</span>
          </button>

          <button
            style={
              tab === "player"
                ? styles.navActive
                : styles.nav
            }
            onClick={() => setTab("player")}
          >
            🎧
            <span>播放</span>
          </button>

          <button
            style={
              tab === "selected"
                ? styles.navActive
                : styles.nav
            }
            onClick={() => setTab("selected")}
          >
            ⭐
            <span>收藏</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: any = {
  page: {
    minHeight: "100vh",
    background:
      "linear-gradient(to bottom, #021B4A, #000814)",
    color: "white",
    fontFamily:
      "-apple-system,BlinkMacSystemFont,sans-serif",
    padding: 20,
  },

  container: {
    maxWidth: 480,
    margin: "0 auto",
    paddingBottom: 100,
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },

  smallTitle: {
    fontSize: 12,
    letterSpacing: 2,
    color: "#9DB7FF",
  },

  mainTitle: {
    fontSize: 42,
    fontWeight: 900,
    marginTop: 4,
  },

  subTitle: {
    fontSize: 18,
    marginTop: 8,
    color: "#D7E3FF",
  },

  logo: {
    width: 70,
    height: 70,
    borderRadius: 24,
    background:
      "linear-gradient(135deg,#2563EB,#9333EA)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 34,
  },

  hero: {
    marginTop: 24,
    background:
      "linear-gradient(135deg,#2563EB,#7C3AED)",
    borderRadius: 30,
    padding: 24,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },

  badge: {
    background: "rgba(255,255,255,0.2)",
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 12,
    display: "inline-block",
  },

  heroTitle: {
    marginTop: 18,
    fontSize: 24,
    fontWeight: 900,
  },

  heroText: {
    marginTop: 10,
    fontSize: 15,
    color: "#E5EDFF",
  },

  playButton: {
    width: 100,
    height: 100,
    borderRadius: 30,
    border: "none",
    background: "white",
    color: "#2563EB",
    fontWeight: 900,
    fontSize: 22,
  },

  searchBox: {
    marginTop: 22,
    display: "flex",
    gap: 10,
  },

  searchInput: {
    flex: 1,
    padding: 16,
    borderRadius: 20,
    border: "none",
    background: "rgba(255,255,255,0.08)",
    color: "white",
    fontSize: 16,
  },

  updateBtn: {
    padding: "0 18px",
    borderRadius: 20,
    border: "none",
    background: "#22C55E",
    color: "white",
    fontWeight: 800,
  },

  sectionTitle: {
    marginTop: 28,
    marginBottom: 14,
    fontSize: 28,
    fontWeight: 900,
  },

  topicGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
  },

  topic: {
    padding: "12px 16px",
    borderRadius: 999,
    border: "none",
    background: "rgba(255,255,255,0.08)",
    color: "white",
    fontWeight: 700,
  },

  topicActive: {
    background: "white",
    color: "#111827",
  },

  actionRow: {
    display: "flex",
    gap: 10,
    marginTop: 18,
  },

  actionBtn: {
    border: "none",
    padding: "12px 16px",
    borderRadius: 16,
    background: "#334155",
    color: "white",
    fontWeight: 700,
  },

  gptBtn: {
    border: "none",
    padding: "12px 18px",
    borderRadius: 16,
    background: "#7C3AED",
    color: "white",
    fontWeight: 900,
  },

  newsList: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },

  newsCard: {
    background: "rgba(255,255,255,0.06)",
    borderRadius: 22,
    padding: 18,
  },

  newsCardActive: {
    background: "rgba(37,99,235,0.3)",
    border: "1px solid #60A5FA",
  },

  newsTitle: {
    fontSize: 17,
    fontWeight: 800,
    lineHeight: 1.5,
  },

  newsMeta: {
    marginTop: 10,
    color: "#AFC4FF",
    fontSize: 13,
  },

  playerCard: {
    marginTop: 24,
    background: "rgba(255,255,255,0.06)",
    padding: 20,
    borderRadius: 24,
  },

  select: {
    width: "100%",
    padding: 14,
    borderRadius: 16,
    border: "none",
    marginTop: 10,
  },

  speedRow: {
    marginTop: 20,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },

  playSmallBtn: {
    background: "#2563EB",
    color: "white",
    border: "none",
    borderRadius: 16,
    padding: "12px 20px",
    fontWeight: 900,
  },

  stopBtn: {
    background: "#DC2626",
    color: "white",
    border: "none",
    borderRadius: 16,
    padding: "12px 20px",
    fontWeight: 900,
  },

  bottomNav: {
    position: "fixed",
    bottom: 18,
    left: "50%",
    transform: "translateX(-50%)",
    width: "90%",
    maxWidth: 460,
    background: "rgba(15,23,42,0.9)",
    borderRadius: 28,
    padding: 14,
    display: "flex",
    justifyContent: "space-around",
    backdropFilter: "blur(20px)",
  },

  nav: {
    background: "transparent",
    border: "none",
    color: "#94A3B8",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
  },

  navActive: {
    background: "rgba(255,255,255,0.1)",
    border: "none",
    color: "white",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    borderRadius: 18,
    padding: "10px 18px",
  },
};
