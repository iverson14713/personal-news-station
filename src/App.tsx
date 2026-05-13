import { useEffect, useMemo, useState } from "react";

type Tab = "home" | "player" | "video" | "favorites";

type NewsItem = {
  id: string;
  title: string;
  link: string;
  source: string;
  selected: boolean;
  favorite: boolean;
};

const topics = [
  "NBA",
  "MLB",
  "Curry",
  "大谷翔平",
  "BTC",
  "ETH",
  "戰爭",
  "科技",
  "電影",
  "動漫",
];

export default function App() {
  const [tab, setTab] = useState<Tab>("home");

  const [selectedTopics, setSelectedTopics] = useState<string[]>([
    "NBA",
    "大谷翔平",
    "BTC",
  ]);

  const [customKeyword, setCustomKeyword] = useState("");

  const [news, setNews] = useState<NewsItem[]>([]);

  const [favoriteLinks, setFavoriteLinks] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);

  const [speed, setSpeed] = useState(1.2);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const [voiceName, setVoiceName] = useState("");

  const selectedNews = news.filter((n) => n.selected);

  const favoriteNews = news.filter((n) => n.favorite);

  const videoCards = useMemo(() => {
    const keywords =
      selectedTopics.length > 0
        ? selectedTopics
        : ["NBA", "BTC", "大谷翔平"];

    return keywords.map((keyword) => ({
      id: keyword,
      title: `${keyword} 最新影音`,
      link: `https://www.youtube.com/results?search_query=${encodeURIComponent(
        keyword + " 最新"
      )}`,
    }));
  }, [selectedTopics]);

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
          allVoices.find((v) =>
            v.lang.includes("zh")
          ) ||
          allVoices[0];

        setVoiceName(preferredVoice.name);
      }
    };

    loadVoices();

    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const buildQuery = () => {
    if (customKeyword.trim()) {
      return customKeyword.trim();
    }

    if (selectedTopics.length > 0) {
      return selectedTopics.join(" OR ");
    }

    return "熱門新聞";
  };

  const fetchNews = async () => {
    setLoading(true);

    try {
      const q = buildQuery();

      const res = await fetch(
        `/api/news?q=${encodeURIComponent(q)}`
      );

      const xmlText = await res.text();

      const parser = new DOMParser();

      const xml = parser.parseFromString(
        xmlText,
        "text/xml"
      );

      const items = Array.from(
        xml.querySelectorAll("item")
      ).slice(0, 20);

      const parsedNews: NewsItem[] = items.map(
        (item, index) => {
          const title =
            item.querySelector("title")
              ?.textContent || "無標題";

          const link =
            item.querySelector("link")
              ?.textContent || "";

          const source =
            title.split(" - ").pop() ||
            "Google News";

          return {
            id: `${index}`,
            title,
            link,
            source,
            selected: index < 5,
            favorite:
              favoriteLinks.includes(link),
          };
        }
      );

      setNews(parsedNews);
    } catch (error) {
      console.error(error);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchNews();
  }, []);

  const toggleTopic = (topic: string) => {
    setSelectedTopics((prev) =>
      prev.includes(topic)
        ? prev.filter((t) => t !== topic)
        : [...prev, topic]
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

  const speakNews = () => {
    window.speechSynthesis.cancel();

    const text = selectedNews
      .map((n) => n.title)
      .join("。
");

    const speech =
      new SpeechSynthesisUtterance(text);

    speech.lang = "zh-TW";
    speech.rate = speed;

    const selectedVoice = voices.find(
      (v) => v.name === voiceName
    );

    if (selectedVoice) {
      speech.voice = selectedVoice;
    }

    window.speechSynthesis.speak(speech);
  };

  const stopSpeak = () => {
    window.speechSynthesis.cancel();
  };

  const copyGptPrompt = async () => {
    const prompt = `
請幫我整理以下新聞：

${selectedNews
  .map((n) => `- ${n.title}`)
  .join("
")}

請：
1. 用繁體中文
2. 幫我整理重點
3. 最後給我 1 分鐘新聞稿
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
          </div>
        </div>

        <div style={styles.bottomNav}>
          <button onClick={() => setTab("home")}>首頁</button>
          <button onClick={() => setTab("player")}>播放</button>
          <button onClick={() => setTab("video")}>影音</button>
          <button onClick={() => setTab("favorites")}>收藏</button>
        </div>
      </div>
    </div>
  );
}

const styles: any = {
  page: {
    minHeight: "100vh",
    background: "#020617",
    color: "white",
    padding: 20,
  },

  container: {
    maxWidth: 480,
    margin: "0 auto",
  },

  header: {
    marginBottom: 20,
  },

  smallTitle: {
    color: "#93C5FD",
    fontSize: 12,
  },

  mainTitle: {
    fontSize: 40,
    fontWeight: 900,
  },

  bottomNav: {
    position: "fixed",
    bottom: 20,
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    gap: 12,
  },
};
```

Commit 後等 Vercel Ready。
