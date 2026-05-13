import { useEffect, useMemo, useState } from "react";

type Tab = "home" | "player" | "video" | "favorites";

type NewsItem = {
  id: string;
  title: string;
  link: string;
  source: string;
  pubDate: string;
  selected: boolean;
  favorite: boolean;
};

type VideoItem = {
  id: string;
  title: string;
  link: string;
  channel: string;
  thumbnail: string;
};

type Topic = {
  label: string;
  query: string;
  icon: string;
};

const topics: Topic[] = [
  { label: "NBA", query: "NBA", icon: "🏀" },
  { label: "MLB", query: "MLB", icon: "⚾" },
  { label: "Curry", query: "Stephen Curry", icon: "🔥" },
  { label: "大谷翔平", query: "Shohei Ohtani", icon: "⚾" },
  { label: "季後賽", query: "NBA playoffs", icon: "🏆" },
  { label: "BTC", query: "Bitcoin", icon: "₿" },
  { label: "ETH", query: "Ethereum", icon: "💎" },
  { label: "戰爭", query: "Ukraine war", icon: "⚠️" },
  { label: "科技", query: "AI technology", icon: "🤖" },
];

function cleanTitle(title: string) {
  return title.replace(/\s-\s.*$/, "").trim();
}

function normalizeKey(title: string) {
  return title.replace(/[，。！？、\s\-｜|:：]/g, "").slice(0, 28);
}

export default function App() {
  const [tab, setTab] = useState<Tab>("home");

  const [selectedTopics, setSelectedTopics] = useState<string[]>([
    "NBA",
    "大谷翔平",
    "BTC",
  ]);

  const [customKeyword, setCustomKeyword] = useState("");

  const [news, setNews] = useState<NewsItem[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);

  const [favoriteLinks, setFavoriteLinks] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);

  const [speed, setSpeed] = useState(1.2);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState("");

  const selectedNews = news.filter((n) => n.selected);
  const favoriteNews = news.filter((n) => n.favorite);

  const selectedTopicObjects = useMemo(
    () => topics.filter((t) => selectedTopics.includes(t.label)),
    [selectedTopics]
  );

  const buildQuery = () => {
    if (customKeyword.trim()) {
      return customKeyword.trim();
    }

    if (selectedTopicObjects.length > 0) {
      return selectedTopicObjects.map((t) => t.query).join(" OR ");
    }

    return "今日熱門新聞";
  };

  useEffect(() => {
    const saved = localStorage.getItem("favoriteLinks");

    if (saved) {
      setFavoriteLinks(JSON.parse(saved));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      "favoriteLinks",
      JSON.stringify(favoriteLinks)
    );
  }, [favoriteLinks]);

  useEffect(() => {
    const loadVoices = () => {
      const allVoices =
        window.speechSynthesis.getVoices();

      setVoices(allVoices);

      if (!voiceName && allVoices.length > 0) {
        const preferredVoice =
          allVoices.find(
            (v) =>
              v.lang.includes("zh") &&
              (v.name.includes("語舒") ||
                v.name.includes("黎澈"))
          ) ||
          allVoices.find((v) =>
            v.lang.includes("zh")
          ) ||
          allVoices[0];

        setVoiceName(preferredVoice.name);
      }
    };

    loadVoices();

    window.speechSynthesis.onvoiceschanged =
      loadVoices;

    setTimeout(loadVoices, 1000);
  }, []);

  const fetchNews = async (query: string) => {
    setLoading(true);

    try {
      const res = await fetch(
        `/api/news?q=${encodeURIComponent(query)}`
      );

      const xmlText = await res.text();

      const parser = new DOMParser();

      const xml = parser.parseFromString(
        xmlText,
        "text/xml"
      );

      const items = Array.from(
        xml.querySelectorAll("item")
      ).slice(0, 40);

      const seen = new Set<string>();

      const parsedNews: NewsItem[] = items
        .map((item, index) => {
          const rawTitle =
            item.querySelector("title")
              ?.textContent || "無標題";

          const title = cleanTitle(rawTitle);

          const link =
            item.querySelector("link")
              ?.textContent || "";

          const source =
            item.querySelector("source")
              ?.textContent ||
            rawTitle.split(" - ").pop() ||
            "Google News";

          return {
            id: link || `${title}-${index}`,
            title,
            link,
            source,
            pubDate:
              item.querySelector("pubDate")
                ?.textContent || "",
            selected: index < 5,
            favorite:
              favoriteLinks.includes(link),
          };
        })
        .filter((item) => {
          const key = normalizeKey(item.title);

          if (!key || seen.has(key))
            return false;

          seen.add(key);

          return true;
        });

      setNews(parsedNews);
    } catch (error) {
      console.error(error);
    }

    setLoading(false);
  };

  const fetchVideos = async (query: string) => {
    setVideoLoading(true);

    try {
      const res = await fetch(
        `/api/videos?q=${encodeURIComponent(query)}`
      );

      const xmlText = await res.text();

      const parser = new DOMParser();

      const xml = parser.parseFromString(
        xmlText,
        "text/xml"
      );

      const entries = Array.from(
        xml.querySelectorAll("entry")
      ).slice(0, 12);

      const parsedVideos: VideoItem[] =
        entries.map((entry, index) => {
          const title =
            entry.querySelector("title")
              ?.textContent || "無標題";

          const videoId =
            entry
              .querySelector("video\\:videoId")
              ?.textContent || "";

          const channel =
            entry.querySelector("author name")
              ?.textContent || "YouTube";

          return {
            id: `${videoId}-${index}`,
            title,
            link: `https://www.youtube.com/watch?v=${videoId}`,
            channel,
            thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          };
        });

      setVideos(parsedVideos);
    } catch (error) {
      console.error(error);
    }

    setVideoLoading(false);
  };

  useEffect(() => {
    const q = buildQuery();

    fetchNews(q);
    fetchVideos(q);
  }, []);

  const updateAll = () => {
    const q = buildQuery();

    fetchNews(q);
    fetchVideos(q);
  };

  const toggleTopic = (label: string) => {
    setSelectedTopics((prev) =>
      prev.includes(label)
        ? prev.filter((t) => t !== label)
        : [...prev, label]
    );
  };

  const toggleNews = (id: string) => {
    setNews((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              selected: !item.selected,
            }
          : item
      )
    );
  };

  const toggleFavorite = (
    item: NewsItem
  ) => {
    setNews((prev) =>
      prev.map((n) =>
        n.id === item.id
          ? {
              ...n,
              favorite: !n.favorite,
            }
          : n
      )
    );

    setFavoriteLinks((prev) =>
      prev.includes(item.link)
        ? prev.filter(
            (link) => link !== item.link
          )
        : [...prev, item.link]
    );
  };

  const createSpeech = (rate: number) => {
    const text = selectedNews
      .map(
        (n, i) =>
          `第 ${i + 1} 則新聞，${n.title}`
      )
      .join("。");

    const speech =
      new SpeechSynthesisUtterance(text);

    speech.lang = "zh-TW";
    speech.rate = rate;

    const selectedVoice = voices.find(
      (v) => v.name === voiceName
    );

    if (selectedVoice) {
      speech.voice = selectedVoice;
    }

    speech.onstart = () =>
      setIsSpeaking(true);

    speech.onend = () =>
      setIsSpeaking(false);

    return speech;
  };

  const speakNews = () => {
    window.speechSynthesis.cancel();

    if (selectedNews.length === 0) {
      alert("請先選擇新聞");
      return;
    }

    window.speechSynthesis.speak(
      createSpeech(speed)
    );
  };

  const stopSpeak = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
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

    await navigator.clipboard.writeText(
      prompt
    );

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
              AI個人新聞台
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
              {tab === "home" &&
                "我的新聞首頁"}

              {tab === "player" &&
                "播放控制台"}

              {tab === "video" &&
                "影音快報"}

              {tab === "favorites" &&
                "收藏新聞"}
            </div>

            <div style={styles.heroText}>
              已追蹤{" "}
              {selectedTopics.length} 個主題
            </div>
          </div>

          <button
            style={styles.playButton}
            onClick={speakNews}
          >
            ▶
          </button>
        </div>

        {tab === "home" && (
          <>
            <div style={styles.searchBox}>
              <input
                style={styles.searchInput}
                placeholder="輸入關鍵字..."
                value={customKeyword}
                onChange={(e) =>
                  setCustomKeyword(
                    e.target.value
                  )
                }
              />

              <button
                style={styles.updateBtn}
                onClick={updateAll}
              >
                更新
              </button>
            </div>

            <div style={styles.topicGrid}>
              {topics.map((topic) => {
                const active =
                  selectedTopics.includes(
                    topic.label
                  );

                return (
                  <button
                    key={topic.label}
                    onClick={() =>
                      toggleTopic(
                        topic.label
                      )
                    }
                    style={{
                      ...styles.topic,
                      ...(active
                        ? styles.topicActive
                        : {}),
                    }}
                  >
                    {topic.icon}{" "}
                    {topic.label}
                  </button>
                );
              })}
            </div>

            <div style={styles.actionRow}>
              <button
                style={styles.actionBtn}
                onClick={
                  copyGptPrompt
                }
              >
                GPT 精華
              </button>
            </div>

            <div style={styles.sectionTitle}>
              今日新聞
            </div>

            {loading && (
              <div style={styles.loading}>
                讀取中...
              </div>
            )}

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
                  <div
                    style={
                      styles.newsTitle
                    }
                  >
                    {item.selected
                      ? "✅ "
                      : ""}
                    {item.title}
                  </div>

                  <div
                    style={
                      styles.newsMeta
                    }
                  >
                    <span>
                      {item.source}
                    </span>

                    <div
                      style={{
                        display: "flex",
                        gap: 12,
                      }}
                    >
                      <button
                        style={
                          styles.favoriteBtn
                        }
                        onClick={(
                          e
                        ) => {
                          e.stopPropagation();

                          toggleFavorite(
                            item
                          );
                        }}
                      >
                        {item.favorite
                          ? "⭐"
                          : "☆"}
                      </button>

                      <a
                        href={item.link}
                        target="_blank"
                        rel="noreferrer"
                        style={
                          styles.link
                        }
                        onClick={(
                          e
                        ) =>
                          e.stopPropagation()
                        }
                      >
                        原文
                      </a>
                    </div>
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
                  setVoiceName(
                    e.target.value
                  )
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
                  速度{" "}
                  {speed.toFixed(1)}x
                </span>

                <input
                  type="range"
                  min="0.8"
                  max="2"
                  step="0.1"
                  value={speed}
                  onChange={(e) =>
                    setSpeed(
                      Number(
                        e.target.value
                      )
                    )
                  }
                />
              </div>

              <div style={styles.actionRow}>
                <button
                  style={
                    styles.playSmallBtn
                  }
                  onClick={speakNews}
                >
                  播放
                </button>

                <button
                  style={
                    styles.stopBtn
                  }
                  onClick={stopSpeak}
                >
                  停止
                </button>
              </div>
            </div>
          </>
        )}

        {tab === "video" && (
          <>
            <div style={styles.sectionTitle}>
              最新影音快報
            </div>

            {videoLoading && (
              <div style={styles.loading}>
                載入影音中...
              </div>
            )}

            <div style={styles.videoList}>
              {videos.map((video) => (
                <a
                  key={video.id}
                  href={video.link}
                  target="_blank"
                  rel="noreferrer"
                  style={
                    styles.videoCard
                  }
                >
                  <img
                    src={
                      video.thumbnail
                    }
                    alt={video.title}
                    style={
                      styles.thumbnail
                    }
                  />

                  <div
                    style={{
                      flex: 1,
                    }}
                  >
                    <div
                      style={
                        styles.videoTitle
                      }
                    >
                      {video.title}
                    </div>

                    <div
                      style={
                        styles.videoMeta
                      }
                    >
                      {video.channel}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </>
        )}

        {tab === "favorites" && (
          <>
            <div style={styles.sectionTitle}>
              收藏新聞
            </div>

            <div style={styles.newsList}>
              {favoriteNews.map(
                (item) => (
                  <div
                    key={item.id}
                    style={
                      styles.newsCard
                    }
                  >
                    <div
                      style={
                        styles.newsTitle
                      }
                    >
                      ⭐{" "}
                      {item.title}
                    </div>

                    <div
                      style={
                        styles.newsMeta
                      }
                    >
                      {item.source}
                    </div>
                  </div>
                )
              )}
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
            onClick={() =>
              setTab("home")
            }
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
            onClick={() =>
              setTab("player")
            }
          >
            🎧
            <span>播放</span>
          </button>

          <button
            style={
              tab === "video"
                ? styles.navActive
                : styles.nav
            }
            onClick={() =>
              setTab("video")
            }
          >
            📺
            <span>影音</span>
          </button>

          <button
            style={
              tab === "favorites"
                ? styles.navActive
                : styles.nav
            }
            onClick={() =>
              setTab("favorites")
            }
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
      "linear-gradient(to bottom,#021B4A,#000814)",
    color: "white",
    padding: 20,
    fontFamily:
      "-apple-system,BlinkMacSystemFont,sans-serif",
  },

  container: {
    maxWidth: 480,
    margin: "0 auto",
    paddingBottom: 100,
  },

  header: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
  },

  smallTitle: {
    fontSize: 12,
    letterSpacing: 2,
    color: "#9DB7FF",
  },

  mainTitle: {
    fontSize: 40,
    fontWeight: 900,
    marginTop: 6,
  },

  subTitle: {
    fontSize: 18,
    marginTop: 8,
    color: "#D7E3FF",
  },

  logo: {
    width: 72,
    height: 72,
    borderRadius: 24,
    background:
      "linear-gradient(135deg,#2563EB,#9333EA)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    fontSize: 34,
  },

  hero: {
    marginTop: 24,
    background:
      "linear-gradient(135deg,#2563EB,#7C3AED)",
    borderRadius: 30,
    padding: 24,
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
  },

  badge: {
    background:
      "rgba(255,255,255,0.2)",
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
    color: "#E5EDFF",
  },

  playButton: {
    width: 92,
    height: 92,
    borderRadius: 28,
    border: "none",
    background: "white",
    color: "#2563EB",
    fontSize: 28,
    fontWeight: 900,
  },

  searchBox: {
    marginTop: 20,
    display: "flex",
    gap: 10,
  },

  searchInput: {
    flex: 1,
    padding: 16,
    borderRadius: 20,
    border: "none",
    background:
      "rgba(255,255,255,0.08)",
    color: "white",
  },

  updateBtn: {
    padding: "0 20px",
    borderRadius: 18,
    border: "none",
    background: "#22C55E",
    color: "white",
    fontWeight: 800,
  },

  topicGrid: {
    marginTop: 20,
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
  },

  topic: {
    padding: "10px 14px",
    borderRadius: 999,
    border: "none",
    background:
      "rgba(255,255,255,0.08)",
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
    marginTop: 20,
  },

  actionBtn: {
    padding: "12px 18px",
    borderRadius: 16,
    border: "none",
    background: "#7C3AED",
    color: "white",
    fontWeight: 900,
  },

  sectionTitle: {
    marginTop: 28,
    marginBottom: 16,
    fontSize: 28,
    fontWeight: 900,
  },

  loading: {
    color: "#CBD5E1",
  },

  newsList: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },

  newsCard: {
    background:
      "rgba(255,255,255,0.06)",
    borderRadius: 24,
    padding: 18,
  },

  newsCardActive: {
    background:
      "rgba(37,99,235,0.3)",
    border:
      "1px solid #60A5FA",
  },

  newsTitle: {
    fontSize: 16,
    fontWeight: 800,
    lineHeight: 1.5,
  },

  newsMeta: {
    marginTop: 10,
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    color: "#AFC4FF",
    fontSize: 13,
  },

  favoriteBtn: {
    background: "transparent",
    border: "none",
    color: "#FACC15",
    fontSize: 18,
  },

  link: {
    color: "#93C5FD",
    textDecoration: "none",
  },

  playerCard: {
    marginTop: 24,
    background:
      "rgba(255,255,255,0.06)",
    borderRadius: 24,
    padding: 20,
  },

  select: {
    width: "100%",
    padding: 14,
    borderRadius: 16,
    border: "none",
  },

  speedRow: {
    marginTop: 18,
    display: "flex",
    justifyContent:
      "space-between",
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

  videoList: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },

  videoCard: {
    display: "flex",
    gap: 14,
    background:
      "rgba(255,255,255,0.06)",
    borderRadius: 22,
    overflow: "hidden",
    textDecoration: "none",
    color: "white",
  },

  thumbnail: {
    width: 150,
    objectFit: "cover",
  },

  videoTitle: {
    paddingTop: 12,
    paddingRight: 12,
    fontSize: 15,
    fontWeight: 800,
    lineHeight: 1.4,
  },

  videoMeta: {
    marginTop: 12,
    color: "#AFC4FF",
    fontSize: 13,
  },

  bottomNav: {
    position: "fixed",
    bottom: 16,
    left: "50%",
    transform:
      "translateX(-50%)",
    width: "90%",
    maxWidth: 460,
    background:
      "rgba(15,23,42,0.9)",
    borderRadius: 28,
    padding: 14,
    display: "flex",
    justifyContent:
      "space-around",
    backdropFilter:
      "blur(20px)",
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
    background:
      "rgba(255,255,255,0.1)",
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
