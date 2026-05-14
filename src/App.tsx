import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

type Tab = "home" | "player" | "video" | "favorites" | "settings";

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
  keyword: string;
  isFallback?: boolean;
};

type Topic = {
  label: string;
  query: string;
  icon: string;
};

const topics: Topic[] = [
  { label: "NBA", query: "NBA", icon: "🏀" },
  { label: "MLB", query: "MLB", icon: "⚾" },
  { label: "Curry", query: "Stephen Curry OR Curry 勇士", icon: "🔥" },
  { label: "大谷翔平", query: "大谷翔平 OR Shohei Ohtani", icon: "⚾" },
  { label: "季後賽", query: "NBA 季後賽 OR MLB 季後賽", icon: "🏆" },
  { label: "幣圈", query: "加密貨幣 OR 幣圈", icon: "₿" },
  { label: "BTC", query: "BTC OR 比特幣", icon: "₿" },
  { label: "ETH", query: "ETH OR 以太坊", icon: "💎" },
  { label: "台股", query: "台股 OR 台積電", icon: "📈" },
  { label: "ETF", query: "ETF OR 0050 OR 高股息", icon: "💰" },
  { label: "美股", query: "美股 OR Nvidia OR Tesla OR Apple", icon: "🇺🇸" },
  { label: "財經", query: "Fed OR 利率 OR CPI OR 降息", icon: "🏦" },
  { label: "國際", query: "國際局勢 OR 全球新聞", icon: "🌍" },
  { label: "戰爭", query: "俄烏戰爭 OR 烏克蘭戰爭 OR 以色列 OR 中東戰爭", icon: "⚠️" },
  { label: "台灣熱門", query: "台灣 熱門新聞 OR 台灣 即時", icon: "🇹🇼" },
  { label: "影視", query: "影視 OR 娛樂新聞", icon: "📺" },
  { label: "電影", query: "電影 OR 票房 OR Netflix", icon: "🎬" },
  { label: "動漫", query: "動漫 OR 動畫 OR 漫畫", icon: "🌀" },
  { label: "音樂", query: "音樂 OR 演唱會 OR 新歌", icon: "🎵" },
  { label: "潮流", query: "潮流 OR 球鞋 OR 穿搭", icon: "👟" },
  { label: "科技", query: "科技 OR AI OR iPhone OR 半導體", icon: "🤖" },
  { label: "遊戲", query: "遊戲 OR Steam OR Switch OR PS5 OR 電競", icon: "🎮" },
];

function cleanTitle(title: string) {
  return title.replace(/\s-\s.*$/, "").trim();
}

function normalizeKey(title: string) {
  return title.replace(/[，。！？、\s\-｜|:：]/g, "").slice(0, 28);
}

function youtubeSearchUrl(keyword: string) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(
    `${keyword} 最新 新聞 精華`
  )}`;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [selectedTopics, setSelectedTopics] = useState<string[]>([
    "NBA",
    "MLB",
    "大谷翔平",
    "Curry",
    "BTC",
  ]);
  const [customKeyword, setCustomKeyword] = useState("");
  const [news, setNews] = useState<NewsItem[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [favoriteLinks, setFavoriteLinks] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");
  const [speed, setSpeed] = useState(1.2);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState("");

  const topicSelectionKeyRef = useRef<string | null>(null);

  const selectedNews = news.filter((n) => n.selected);
  const favoriteNews = news.filter((n) => n.favorite);

  const selectedTopicObjects = useMemo(
    () => topics.filter((t) => selectedTopics.includes(t.label)),
    [selectedTopics]
  );

  const buildQuery = () => {
    if (customKeyword.trim()) return customKeyword.trim();

    if (selectedTopicObjects.length > 0) {
      return selectedTopicObjects.map((t) => `(${t.query})`).join(" OR ");
    }

    return "今日熱門新聞";
  };

  const buildVideoKeywords = () => {
    if (customKeyword.trim()) return [customKeyword.trim()];

    if (selectedTopicObjects.length > 0) {
      return selectedTopicObjects.slice(0, 8).map((t) => t.query);
    }

    return ["NBA 最新", "大谷翔平 最新", "BTC 最新"];
  };

  useEffect(() => {
    const saved = localStorage.getItem("favoriteLinks");
    if (saved) setFavoriteLinks(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem("favoriteLinks", JSON.stringify(favoriteLinks));
  }, [favoriteLinks]);

  useEffect(() => {
    const loadVoices = () => {
      const allVoices = window.speechSynthesis.getVoices();
      setVoices(allVoices);

      if (!voiceName && allVoices.length > 0) {
        const preferredVoice =
          allVoices.find(
            (v) =>
              v.lang.includes("zh") &&
              (v.name.includes("語舒") || v.name.includes("黎澈"))
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

  const fetchNews = async (query: string) => {
    setLoading(true);

    try {
      const res = await fetch(`/api/news?q=${encodeURIComponent(query)}`);
      const xmlText = await res.text();

      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, "text/xml");
      const items = Array.from(xml.querySelectorAll("item")).slice(0, 70);
      const seen = new Set<string>();

      const parsedNews: NewsItem[] = items
        .map((item, index) => {
          const rawTitle = item.querySelector("title")?.textContent || "無標題";
          const title = cleanTitle(rawTitle);
          const link = item.querySelector("link")?.textContent || "";
          const source =
            item.querySelector("source")?.textContent ||
            rawTitle.split(" - ").pop() ||
            "Google News";

          return {
            id: link || `${title}-${index}`,
            title,
            link,
            source,
            pubDate: item.querySelector("pubDate")?.textContent || "",
            selected: index < 5,
            favorite: favoriteLinks.includes(link),
          };
        })
        .filter((item) => {
          const key = normalizeKey(item.title);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 25);

      setNews(parsedNews);
      setLastUpdated(
        new Date().toLocaleTimeString("zh-TW", {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    } catch (error) {
      alert("新聞讀取失敗，請稍後再試");
      console.error(error);
    }

    setLoading(false);
  };

  const fetchVideos = async () => {
    setVideoLoading(true);

    try {
      const keywords = buildVideoKeywords();

      const results = await Promise.all(
        keywords.map(async (keyword) => {
          try {
            const res = await fetch(`/api/videos?q=${encodeURIComponent(keyword)}`);
            const data = await res.json();

            const firstVideo = Array.isArray(data) ? data[0] : null;

            if (!firstVideo) {
              return {
                id: keyword,
                title: `${keyword} 最新影音`,
                link: youtubeSearchUrl(keyword),
                channel: "YouTube 搜尋",
                thumbnail: "",
                keyword,
                isFallback: true,
              };
            }

            return {
              id: firstVideo.id || keyword,
              title: firstVideo.title || `${keyword} 最新影片`,
              link: firstVideo.url || youtubeSearchUrl(keyword),
              channel: firstVideo.channel || "YouTube",
              thumbnail: firstVideo.thumbnail || "",
              keyword,
              isFallback: false,
            };
          } catch {
            return {
              id: keyword,
              title: `${keyword} 最新影音`,
              link: youtubeSearchUrl(keyword),
              channel: "YouTube 搜尋",
              thumbnail: "",
              keyword,
              isFallback: true,
            };
          }
        })
      );

      const seen = new Set<string>();

      const uniqueVideos = results.filter((video) => {
        const key = video.link || video.title;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      setVideos(uniqueVideos);
    } catch (error) {
      console.error(error);
    }

    setVideoLoading(false);
  };

  useEffect(() => {
    fetchNews(buildQuery());
    fetchVideos();
  }, []);

  useEffect(() => {
    const key = [...selectedTopics].sort().join("\0");

    if (topicSelectionKeyRef.current === null) {
      topicSelectionKeyRef.current = key;
      return;
    }

    if (topicSelectionKeyRef.current === key) {
      return;
    }

    topicSelectionKeyRef.current = key;

    const timer = window.setTimeout(() => {
      fetchNews(buildQuery());
      fetchVideos();
    }, 450);

    return () => window.clearTimeout(timer);
  }, [selectedTopics]);

  const updateMyNews = () => {
    setTab("home");
    fetchNews(buildQuery());
    fetchVideos();
  };

  const updateVideos = () => {
    setTab("video");
    fetchVideos();
  };

  const toggleTopic = (label: string) => {
    setSelectedTopics((prev) =>
      prev.includes(label) ? prev.filter((t) => t !== label) : [...prev, label]
    );
  };

  const selectAllTopics = () => {
    setSelectedTopics(topics.map((t) => t.label));
  };

  const clearTopics = () => {
    setSelectedTopics([]);
  };

  const resetDefaultTopics = () => {
    setSelectedTopics(["NBA", "MLB", "大谷翔平", "Curry", "BTC"]);
  };

  const toggleNews = (id: string) => {
    setNews((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, selected: !item.selected } : item
      )
    );
  };

  const toggleFavorite = (item: NewsItem) => {
    setNews((prev) =>
      prev.map((n) => (n.id === item.id ? { ...n, favorite: !n.favorite } : n))
    );

    setFavoriteLinks((prev) =>
      prev.includes(item.link)
        ? prev.filter((link) => link !== item.link)
        : [...prev, item.link]
    );
  };

  const selectAll = () => {
    setNews((prev) => prev.map((item) => ({ ...item, selected: true })));
  };

  const clearAll = () => {
    setNews((prev) => prev.map((item) => ({ ...item, selected: false })));
  };

  const clearFavorites = () => {
    setFavoriteLinks([]);
    setNews((prev) => prev.map((item) => ({ ...item, favorite: false })));
  };

  const createSpeech = (rate: number) => {
    const text = selectedNews
      .map((n, i) => `第 ${i + 1} 則新聞，${n.title}`)
      .join("。");

    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = "zh-TW";
    speech.rate = rate;

    const selectedVoice = voices.find((v) => v.name === voiceName);
    if (selectedVoice) speech.voice = selectedVoice;

    speech.onstart = () => setIsSpeaking(true);
    speech.onend = () => setIsSpeaking(false);
    speech.onerror = () => setIsSpeaking(false);

    return speech;
  };

  const speakNews = () => {
    window.speechSynthesis.cancel();

    if (selectedNews.length === 0) {
      alert("請先選擇要播放的新聞");
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

    if (isSpeaking && selectedNews.length > 0) {
      window.speechSynthesis.cancel();
      setTimeout(() => {
        window.speechSynthesis.speak(createSpeech(newSpeed));
      }, 120);
    }
  };

  const copyGptPrompt = async () => {
    if (selectedNews.length === 0) {
      alert("請先選擇新聞");
      return;
    }

    const newsText = selectedNews
      .map(
        (item, index) =>
          `${index + 1}. ${item.title}\n來源：${item.source}\n連結：${item.link}`
      )
      .join("\n\n");

    const prompt = `
請幫我把以下新聞整理成「AI個人新聞台」精華版：

要求：
1. 用繁體中文
2. 先列出今日最重要的 5 個重點
3. 每則用 2～3 句話解釋
4. 幫我判斷重要程度：🔥重大 / ⚠️注意 / ℹ️一般
5. 最後給我一段適合語音朗讀的 1 分鐘新聞稿
6. 避免誇大投資建議，只做資訊整理與風險提醒

新聞列表：
${newsText}
`;

    await navigator.clipboard.writeText(prompt);
    alert("已複製 GPT 精華整理 Prompt");
  };

  const pageTitle =
    tab === "home"
      ? "我的新聞首頁"
      : tab === "player"
      ? "播放控制台"
      : tab === "video"
      ? "影音新聞"
      : tab === "favorites"
      ? "收藏新聞"
      : "個人設定";

  return (
    <div style={styles.page}>
      <div style={styles.phone}>
        {tab === "home" ? (
          <header style={styles.homeHeader}>
            <div style={{ minWidth: 0 }}>
              <h1 style={styles.homeBrand}>AI個人新聞台</h1>
              <p style={styles.homeStats}>
                追蹤 <span style={styles.homeStatNum}>{selectedTopics.length}</span> 主題 ·
                已選 <span style={styles.homeStatNum}>{selectedNews.length}</span> 則
              </p>
            </div>
            {isSpeaking ? (
              <span style={styles.homeLivePill}>播放中</span>
            ) : (
              <div style={styles.homeMicIcon} aria-hidden>
                🎙️
              </div>
            )}
          </header>
        ) : (
          <header style={styles.headerOther}>
            <div>
              <div style={styles.kicker}>AI個人新聞台</div>
              <h1 style={styles.titleOther}>{pageTitle}</h1>
            </div>
            <div style={styles.logoOther}>🎙️</div>
          </header>
        )}

        {tab === "home" && (
          <>
            <div style={styles.searchBox}>
              <input
                value={customKeyword}
                onChange={(e) => setCustomKeyword(e.target.value)}
                placeholder="搜尋：俄烏戰爭、BTC、台積電..."
                style={styles.searchInput}
              />
              <button type="button" onClick={updateMyNews} style={styles.searchButton}>
                更新
              </button>
            </div>

            <div style={styles.homeToolbarScroll} className="hide-scrollbar">
              <button
                type="button"
                onClick={() => (isSpeaking ? stopSpeak() : speakNews())}
                style={{
                  ...styles.toolbarBtn,
                  ...(isSpeaking ? styles.toolbarBtnDanger : styles.toolbarBtnPlay),
                }}
              >
                {isSpeaking ? "■ 停止" : "▶ 播放"}
              </button>
              <button type="button" onClick={copyGptPrompt} style={styles.toolbarBtnGpt}>
                GPT 精華
              </button>
              <button
                type="button"
                onClick={updateMyNews}
                disabled={loading}
                style={{
                  ...styles.toolbarBtnNeutral,
                  opacity: loading ? 0.65 : 1,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                {loading ? "…" : "重新整理"}
              </button>
              <button
                type="button"
                onClick={() => setTab("settings")}
                style={styles.toolbarBtnNeutral}
              >
                設定主題
              </button>
            </div>

            <div style={styles.homeSelectRow}>
              <div style={styles.homeSelectBtns}>
                <button type="button" onClick={selectAll} style={styles.tinyOutlineBtn}>
                  全選
                </button>
                <button type="button" onClick={clearAll} style={styles.tinyOutlineBtn}>
                  取消
                </button>
              </div>
              <span style={styles.lastUpdatedInline}>
                {lastUpdated ? `更新 ${lastUpdated}` : "尚未更新"}
              </span>
            </div>

            <NewsList
              title="新聞列表"
              compact
              news={news}
              loading={loading}
              toggleNews={toggleNews}
              toggleFavorite={toggleFavorite}
            />
          </>
        )}

        {tab === "player" && (
          <>
            <section style={styles.controlPanel}>
              <div style={styles.controlTitle}>
                播放設定 {isSpeaking ? "｜播放中" : ""}
              </div>

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
                  onChange={(e) => changeSpeed(Number(e.target.value))}
                  style={{ width: "55%" }}
                />
              </div>

              <div style={styles.actionRow}>
                <button onClick={speakNews} style={styles.playSmallButton}>
                  播放選取
                </button>
                <button onClick={stopSpeak} style={styles.stopButton}>
                  停止
                </button>
                <button onClick={copyGptPrompt} style={styles.gptButton}>
                  GPT 精華
                </button>
              </div>
            </section>

            <NewsList
              title="即將播放"
              news={selectedNews}
              loading={false}
              toggleNews={toggleNews}
              toggleFavorite={toggleFavorite}
              emptyText="目前沒有選取新聞，請回首頁勾選。"
            />
          </>
        )}

        {tab === "video" && (
          <>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>最新影音快報</h2>
              <button
                onClick={updateVideos}
                disabled={videoLoading}
                style={{
                  ...styles.updateButton,
                  opacity: videoLoading ? 0.7 : 1,
                  cursor: videoLoading ? "not-allowed" : "pointer",
                }}
              >
                {videoLoading ? "更新中..." : "🔄 更新影音"}
              </button>
            </div>

            <div style={styles.videoHint}>
              每個已選主題抓一支 YouTube 最新影片。若 API 沒回資料，會改成 YouTube 搜尋入口。
            </div>

            {videoLoading && <div style={styles.loading}>影音讀取中...</div>}

            <div style={styles.newsList}>
              {videos.map((video) => (
                <a
                  key={video.id}
                  href={video.link}
                  target="_blank"
                  rel="noreferrer"
                  style={styles.videoCard}
                >
                  {video.thumbnail ? (
                    <img src={video.thumbnail} alt={video.title} style={styles.thumbnail} />
                  ) : (
                    <div style={styles.videoIcon}>▶</div>
                  )}

                  <div style={{ flex: 1 }}>
                    <div style={styles.newsTitle}>{video.title}</div>
                    <div style={styles.newsMeta}>
                      <span>{video.channel}</span>
                      <span>{video.isFallback ? "搜尋入口" : "最新影片"}</span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </>
        )}

        {tab === "favorites" && (
          <>
            <ActionButtons
              selectAll={selectAll}
              clearAll={clearAll}
              copyGptPrompt={copyGptPrompt}
            />

            <NewsList
              title="收藏新聞"
              news={favoriteNews}
              loading={false}
              toggleNews={toggleNews}
              toggleFavorite={toggleFavorite}
              emptyText="目前沒有收藏新聞。"
            />
          </>
        )}

        {tab === "settings" && (
          <>
            <section style={styles.controlPanel}>
              <div style={styles.controlTitle}>我的追蹤主題</div>

              <div style={styles.settingHint}>
                首頁會依照這些主題整理新聞與影音。想搜尋單一事件，可直接在首頁搜尋框輸入關鍵字。
              </div>

              <div style={styles.actionRow}>
                <button onClick={selectAllTopics} style={styles.miniButton}>
                  主題全選
                </button>
                <button onClick={clearTopics} style={styles.miniButton}>
                  清空主題
                </button>
                <button onClick={resetDefaultTopics} style={styles.gptButton}>
                  預設主題
                </button>
              </div>

              <div style={styles.topicGridSettings}>
                {topics.map((topic) => {
                  const active = selectedTopics.includes(topic.label);
                  return (
                    <button
                      key={topic.label}
                      onClick={() => toggleTopic(topic.label)}
                      style={{
                        ...styles.topicChip,
                        ...(active ? styles.topicChipActive : {}),
                      }}
                    >
                      <span>{topic.icon}</span> {topic.label}
                    </button>
                  );
                })}
              </div>
            </section>

            <section style={styles.controlPanel}>
              <div style={styles.controlTitle}>自訂關鍵字</div>
              <input
                value={customKeyword}
                onChange={(e) => setCustomKeyword(e.target.value)}
                placeholder="例如：俄烏戰爭、Solana、台積電..."
                style={styles.settingInput}
              />
              <button onClick={updateMyNews} style={styles.fullButton}>
                套用並更新新聞
              </button>
            </section>

            <section style={styles.controlPanel}>
              <div style={styles.controlTitle}>語音設定</div>

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
                <span>播放速度 {speed.toFixed(1)}x</span>
                <input
                  type="range"
                  min="0.8"
                  max="2"
                  step="0.1"
                  value={speed}
                  onChange={(e) => changeSpeed(Number(e.target.value))}
                  style={{ width: "55%" }}
                />
              </div>
            </section>

            <section style={styles.controlPanel}>
              <div style={styles.controlTitle}>收藏管理</div>
              <div style={styles.settingHint}>目前收藏 {favoriteNews.length} 則新聞。</div>
              <button onClick={clearFavorites} style={styles.dangerFullButton}>
                清除全部收藏
              </button>
            </section>
          </>
        )}

        <nav style={styles.bottomNav}>
          <button
            onClick={() => setTab("home")}
            style={tab === "home" ? styles.navItemActive : styles.navItem}
          >
            🏠<span>首頁</span>
          </button>

          <button
            onClick={() => setTab("player")}
            style={tab === "player" ? styles.navItemActive : styles.navItem}
          >
            🎧<span>播放</span>
          </button>

          <button
            onClick={() => setTab("video")}
            style={tab === "video" ? styles.navItemActive : styles.navItem}
          >
            📺<span>影音</span>
          </button>

          <button
            onClick={() => setTab("favorites")}
            style={tab === "favorites" ? styles.navItemActive : styles.navItem}
          >
            ⭐<span>收藏</span>
          </button>

          <button
            onClick={() => setTab("settings")}
            style={tab === "settings" ? styles.navItemActive : styles.navItem}
          >
            ⚙️<span>設定</span>
          </button>
        </nav>
      </div>
    </div>
  );
}

function ActionButtons({
  selectAll,
  clearAll,
  copyGptPrompt,
}: {
  selectAll: () => void;
  clearAll: () => void;
  copyGptPrompt: () => void;
}) {
  return (
    <div style={styles.actionRow}>
      <button onClick={selectAll} style={styles.miniButton}>
        全選
      </button>
      <button onClick={clearAll} style={styles.miniButton}>
        取消
      </button>
      <button onClick={copyGptPrompt} style={styles.gptButton}>
        GPT 精華
      </button>
    </div>
  );
}

function NewsList({
  title,
  news,
  loading,
  toggleNews,
  toggleFavorite,
  emptyText = "沒有新聞",
  compact = false,
}: {
  title: string;
  news: NewsItem[];
  loading: boolean;
  toggleNews: (id: string) => void;
  toggleFavorite: (item: NewsItem) => void;
  emptyText?: string;
  compact?: boolean;
}) {
  return (
    <>
      <div
        style={{
          ...styles.sectionHeader,
          ...(compact ? styles.sectionHeaderCompact : {}),
        }}
      >
        <h2
          style={{
            ...styles.sectionTitle,
            ...(compact ? styles.sectionTitleCompact : {}),
          }}
        >
          {title}
        </h2>
        <span style={styles.countText}>{news.length} 則</span>
      </div>

      {loading && <div style={styles.loading}>新聞讀取中...</div>}

      {!loading && news.length === 0 && (
        <div style={styles.loading}>{emptyText}</div>
      )}

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
            <div style={styles.newsIndex}>
              {String(index + 1).padStart(2, "0")}
            </div>

            <div style={{ flex: 1 }}>
              <div style={styles.newsTitle}>
                {item.selected ? "✅ " : ""}
                {item.title}
              </div>

              <div style={styles.newsMeta}>
                <span>{item.source}</span>

                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(item);
                    }}
                    style={styles.favoriteButton}
                  >
                    {item.favorite ? "⭐" : "☆"}
                  </button>

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
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top left, #1D4ED8 0, transparent 28%), linear-gradient(180deg, #020617 0%, #0F172A 100%)",
    color: "white",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif',
    padding: "18px",
  },
  phone: { maxWidth: "460px", margin: "0 auto", paddingBottom: "98px" },
  homeHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "10px",
    padding: "4px 0 8px",
  },
  homeBrand: {
    margin: 0,
    fontSize: "clamp(18px, 4.8vw, 21px)",
    fontWeight: 900,
    letterSpacing: "-0.02em",
    lineHeight: 1.2,
  },
  homeStats: {
    margin: "6px 0 0",
    color: "#94A3B8",
    fontSize: "12px",
    lineHeight: 1.35,
  },
  homeStatNum: { color: "#E2E8F0", fontWeight: 800 },
  homeLivePill: {
    flexShrink: 0,
    fontSize: "11px",
    fontWeight: 800,
    color: "#BFDBFE",
    background: "rgba(124,58,237,.35)",
    border: "1px solid rgba(167,139,250,.45)",
    borderRadius: "999px",
    padding: "5px 10px",
    marginTop: "2px",
  },
  homeMicIcon: {
    width: "40px",
    height: "40px",
    borderRadius: "14px",
    background: "linear-gradient(135deg, #2563EB, #7C3AED)",
    display: "grid",
    placeItems: "center",
    fontSize: "20px",
    flexShrink: 0,
    boxShadow: "0 8px 22px rgba(37,99,235,.28)",
  },
  headerOther: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 0 14px",
    gap: "10px",
  },
  titleOther: {
    margin: "4px 0 0",
    fontSize: "clamp(17px, 4.5vw, 20px)",
    fontWeight: 900,
    letterSpacing: "-0.02em",
  },
  logoOther: {
    width: "44px",
    height: "44px",
    borderRadius: "16px",
    background: "linear-gradient(135deg, #2563EB, #7C3AED)",
    display: "grid",
    placeItems: "center",
    fontSize: "22px",
    flexShrink: 0,
    boxShadow: "0 8px 22px rgba(37,99,235,.28)",
  },
  homeToolbarScroll: {
    display: "flex",
    gap: "6px",
    overflowX: "auto",
    flexWrap: "nowrap",
    marginTop: "10px",
    paddingBottom: "2px",
    WebkitOverflowScrolling: "touch",
  },
  toolbarBtn: {
    flexShrink: 0,
    border: "none",
    borderRadius: "999px",
    padding: "8px 12px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  toolbarBtnPlay: {
    background: "linear-gradient(135deg, #2563EB, #4F46E5)",
    color: "white",
    boxShadow: "0 4px 14px rgba(37,99,235,.35)",
  },
  toolbarBtnDanger: {
    background: "rgba(220,38,38,.9)",
    color: "white",
  },
  toolbarBtnGpt: {
    background: "#7C3AED",
    color: "white",
    border: "none",
    borderRadius: "999px",
    padding: "8px 12px",
    fontSize: "12px",
    fontWeight: 800,
    cursor: "pointer",
    flexShrink: 0,
    whiteSpace: "nowrap",
  },
  toolbarBtnNeutral: {
    background: "rgba(255,255,255,.1)",
    color: "#E2E8F0",
    border: "1px solid rgba(255,255,255,.12)",
    borderRadius: "999px",
    padding: "8px 12px",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
    flexShrink: 0,
    whiteSpace: "nowrap",
  },
  homeSelectRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    marginTop: "8px",
    marginBottom: "2px",
  },
  homeSelectBtns: { display: "flex", gap: "6px", flexShrink: 0 },
  tinyOutlineBtn: {
    background: "transparent",
    color: "#93C5FD",
    border: "1px solid rgba(147,197,253,.35)",
    borderRadius: "999px",
    padding: "5px 10px",
    fontSize: "11px",
    fontWeight: 700,
    cursor: "pointer",
  },
  lastUpdatedInline: {
    fontSize: "11px",
    color: "#64748B",
    textAlign: "right",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  searchBox: {
    display: "flex",
    gap: "8px",
    marginTop: "6px",
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
  kicker: {
    color: "#93C5FD",
    fontSize: "10px",
    letterSpacing: "0.12em",
    fontWeight: 700,
    textTransform: "uppercase",
  },
  sectionHeaderCompact: {
    marginTop: "6px",
    marginBottom: "8px",
  },
  sectionTitleCompact: { fontSize: "15px" },
  updateButton: {
    background: "rgba(255,255,255,.12)",
    color: "white",
    border: "1px solid rgba(255,255,255,.12)",
    borderRadius: "999px",
    padding: "8px 12px",
    fontWeight: 800,
  },
  topicGridSettings: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
    padding: "14px 0 4px",
  },
  topicChip: {
    whiteSpace: "nowrap",
    background: "rgba(255,255,255,.08)",
    color: "#CBD5E1",
    border: "1px solid rgba(255,255,255,.08)",
    padding: "9px 12px",
    borderRadius: "999px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "14px",
  },
  topicChipActive: { background: "white", color: "#0F172A" },
  controlPanel: {
    marginTop: "18px",
    background: "rgba(15,23,42,.82)",
    border: "1px solid rgba(255,255,255,.08)",
    borderRadius: "24px",
    padding: "16px",
  },
  controlTitle: { fontWeight: 900, marginBottom: "10px" },
  settingHint: {
    color: "#CBD5E1",
    fontSize: "13px",
    lineHeight: 1.5,
  },
  settingInput: {
    width: "100%",
    boxSizing: "border-box",
    background: "rgba(255,255,255,.08)",
    color: "white",
    border: "1px solid rgba(255,255,255,.12)",
    outline: "none",
    fontSize: "15px",
    padding: "12px",
    borderRadius: "14px",
    marginTop: "8px",
  },
  fullButton: {
    width: "100%",
    marginTop: "12px",
    background: "#22C55E",
    color: "white",
    border: "none",
    borderRadius: "14px",
    padding: "12px",
    fontWeight: 900,
    cursor: "pointer",
  },
  dangerFullButton: {
    width: "100%",
    marginTop: "12px",
    background: "#DC2626",
    color: "white",
    border: "none",
    borderRadius: "14px",
    padding: "12px",
    fontWeight: 900,
    cursor: "pointer",
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
  actionRow: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" },
  miniButton: {
    background: "#334155",
    color: "white",
    border: "none",
    borderRadius: "12px",
    padding: "9px 12px",
    cursor: "pointer",
    fontWeight: 700,
  },
  playSmallButton: {
    background: "#2563EB",
    color: "white",
    border: "none",
    borderRadius: "12px",
    padding: "9px 12px",
    cursor: "pointer",
    fontWeight: 800,
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
    marginTop: "16px",
    marginBottom: "10px",
    gap: "10px",
  },
  sectionTitle: { margin: 0, fontSize: "20px", fontWeight: 900 },
  countText: { color: "#94A3B8", fontSize: "13px" },
  loading: {
    color: "#CBD5E1",
    background: "rgba(255,255,255,.08)",
    padding: "12px",
    borderRadius: "16px",
  },
  videoHint: {
    color: "#CBD5E1",
    background: "rgba(255,255,255,.08)",
    padding: "12px",
    borderRadius: "16px",
    fontSize: "13px",
    lineHeight: 1.5,
    marginBottom: "12px",
  },
  videoCard: {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    background: "rgba(255,255,255,.07)",
    border: "1px solid rgba(255,255,255,.08)",
    borderRadius: "18px",
    padding: "12px",
    textDecoration: "none",
    color: "white",
  },
  thumbnail: {
    width: "116px",
    height: "66px",
    borderRadius: "12px",
    objectFit: "cover",
    flexShrink: 0,
  },
  videoIcon: {
    width: "64px",
    height: "64px",
    borderRadius: "18px",
    background: "linear-gradient(135deg, #EF4444, #7C3AED)",
    display: "grid",
    placeItems: "center",
    fontWeight: 900,
    flexShrink: 0,
  },
  newsList: { display: "flex", flexDirection: "column", gap: "10px" },
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
  newsTitle: { fontSize: "15px", fontWeight: 800, lineHeight: 1.45 },
  newsMeta: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    color: "#94A3B8",
    marginTop: "8px",
    fontSize: "12px",
  },
  favoriteButton: {
    background: "transparent",
    border: "none",
    color: "#FACC15",
    cursor: "pointer",
    fontSize: "14px",
  },
  link: { color: "#93C5FD", textDecoration: "none", flexShrink: 0 },
  bottomNav: {
    position: "fixed",
    left: "50%",
    bottom: "16px",
    transform: "translateX(-50%)",
    width: "calc(100% - 28px)",
    maxWidth: "430px",
    background: "rgba(15,23,42,.92)",
    border: "1px solid rgba(255,255,255,.1)",
    borderRadius: "24px",
    padding: "9px 8px",
    display: "flex",
    justifyContent: "space-around",
    backdropFilter: "blur(18px)",
    boxShadow: "0 20px 50px rgba(0,0,0,.4)",
  },
  navItem: {
    background: "transparent",
    border: "none",
    color: "#94A3B8",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "3px",
    fontSize: "11px",
    cursor: "pointer",
  },
  navItemActive: {
    background: "rgba(255,255,255,.12)",
    border: "none",
    color: "white",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "3px",
    fontSize: "11px",
    fontWeight: 800,
    borderRadius: "16px",
    padding: "8px 10px",
    cursor: "pointer",
  },
};
