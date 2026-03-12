const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors());
app.use(express.json());

// ─── ENV ───────────────────────────────────────────────────────────────────
const OWM_KEY         = process.env.OWM_KEY || "";
const LASTFM_KEY      = process.env.LASTFM_KEY || "";
const LASTFM_USER     = process.env.LASTFM_USER || "";
const GEMINI_KEY      = process.env.GEMINI_KEY || "";
const GITHUB_TOKEN    = process.env.GITHUB_TOKEN || "";
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || "oktavsm";
const REFRESH_SECRET  = process.env.REFRESH_SECRET || "";

// ─── IN-MEMORY CACHE ───────────────────────────────────────────────────────
let cache = {
  weather: null,
  spotify: null,
  gemini: null,
  github: null,
  svg: null,
  svgGeneratedAt: 0,
};

// ─── WEATHER ──────────────────────────────────────────────────────────────
async function fetchWeather() {
  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=Malang,ID&appid=${OWM_KEY}&units=metric`
    );
    const d = await res.json();
    const condition = d.weather[0].main.toLowerCase();
    let theme = "cloudy";
    if (condition.includes("clear") || condition.includes("sun")) theme = "sunny";
    else if (condition.includes("thunder") || condition.includes("storm")) theme = "storm";
    else if (condition.includes("rain") || condition.includes("drizzle")) theme = "rainy";

    cache.weather = {
      temp: Math.round(d.main.temp),
      feels: Math.round(d.main.feels_like),
      desc: d.weather[0].description,
      main: d.weather[0].main,
      humidity: d.main.humidity,
      wind: Math.round(d.wind.speed * 3.6),
      icon: d.weather[0].icon,
      theme,
    };
    console.log("✅ Weather:", cache.weather.temp + "°C", cache.weather.desc);
  } catch (e) {
    console.error("Weather fetch error:", e.message);
  }
}

// ─── LAST.FM ──────────────────────────────────────────────────────────────
async function fetchSpotify() {
  try {
    const res = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user=${LASTFM_USER}&api_key=${LASTFM_KEY}&format=json&limit=1`
    );
    const d = await res.json();
    const tracks = d.recenttracks?.track;
    if (!tracks || tracks.length === 0) return;

    const t = Array.isArray(tracks) ? tracks[0] : tracks;
    const isPlaying = t["@attr"]?.nowplaying === "true";

    cache.spotify = {
      isPlaying,
      track: t.name,
      artist: t.artist["#text"],
      album: t.album["#text"],
      albumArt: t.image?.[2]?.["#text"] || t.image?.[1]?.["#text"] || "",
      url: t.url,
    };
    console.log("✅ LastFM:", isPlaying ? "▶" : "⏸", cache.spotify.track, "-", cache.spotify.artist);
  } catch (e) {
    console.error("LastFM fetch error:", e.message);
  }
}

// ─── GITHUB ───────────────────────────────────────────────────────────────
async function fetchGithub() {
  try {
    const headers = GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {};
    const [userRes, eventsRes] = await Promise.all([
      fetch(`https://api.github.com/users/${GITHUB_USERNAME}`, { headers }),
      fetch(`https://api.github.com/users/${GITHUB_USERNAME}/events?per_page=100`, { headers }),
    ]);
    const d      = await userRes.json();
    const events = await eventsRes.json();

    const pushEvents = Array.isArray(events)
      ? events.filter(e => e.type === "PushEvent")
      : [];
    const lastPush = pushEvents[0]?.created_at || null;

    // Calculate streak: count consecutive days with at least one push
    let streak = 0;
    if (pushEvents.length > 0) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const pushDaySet = new Set(
        pushEvents.map(e => {
          const d2 = new Date(e.created_at);
          d2.setHours(0, 0, 0, 0);
          return d2.getTime();
        })
      );
      let cursor = new Date(todayStart);
      // allow yesterday as streak start if nothing pushed today yet
      if (!pushDaySet.has(cursor.getTime())) cursor.setDate(cursor.getDate() - 1);
      while (pushDaySet.has(cursor.getTime())) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      }
    }

    // Get commit message — first try from event payload, fallback to Commits API
    let lastCommitMsg = null;
    let lastCommitRepo = null;

    const firstPush = pushEvents[0];
    if (firstPush) {
      const repoFullName = firstPush.repo?.name || null;
      lastCommitRepo = repoFullName ? repoFullName.split('/').pop() : null;

      // Try payload commits first
      const payloadCommits = firstPush.payload?.commits;
      if (payloadCommits && payloadCommits.length > 0) {
        lastCommitMsg = payloadCommits[payloadCommits.length - 1]?.message?.split('\n')[0]?.substring(0, 72) || null;
      } else if (repoFullName) {
        // Payload empty (org/private repo) — fetch directly from Commits API
        try {
          const cRes = await fetch(
            `https://api.github.com/repos/${repoFullName}/commits?per_page=1`,
            { headers }
          );
          const cData = await cRes.json();
          if (Array.isArray(cData) && cData.length > 0) {
            lastCommitMsg = cData[0]?.commit?.message?.split('\n')[0]?.substring(0, 72) || null;
          }
        } catch (_) { /* ignore */ }
      }
    }

    cache.github = {
      repos: d.public_repos,
      followers: d.followers,
      avatar: d.avatar_url,
      streak,
      lastPush,
      lastCommitMsg,
      lastCommitRepo,
    };
    console.log("✅ GitHub:", cache.github.repos, "repos, streak:", streak, lastCommitMsg ? `| '${lastCommitMsg.substring(0,30)}'` : '');
  } catch (e) {
    console.error("GitHub fetch error:", e.message);
  }
}

// ─── GEMINI ───────────────────────────────────────────────────────────────
async function fetchGemini() {
  try {
    const weather = cache.weather;
    const spotify = cache.spotify;
    const weatherCtx = weather
      ? `Weather in Malang: ${weather.temp}°C, ${weather.desc}, humidity ${weather.humidity}%, wind ${weather.wind}km/h.`
      : "Weather unknown.";
    const spotifyCtx = spotify
      ? `Currently ${spotify.isPlaying ? "playing" : "last played"}: "${spotify.track}" by ${spotify.artist}.`
      : "";

    
const now = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', weekday: 'long', hour: '2-digit', minute: '2-digit' });
const prompt = `You are writing two short lines for a developer's live portfolio widget. Be creative, natural, and English only.

Context: ${now} in Malang, Indonesia. ${weatherCtx} ${spotifyCtx}

Output exactly two lines separated by |||:

1. VIBE (max 25 words): A poetic or atmospheric caption that feels like a moment — not about a person, but about the mood right now. Draw naturally from the weather and/or music if relevant. Think: a tweet from the universe, not a bio. Examples of tone: "Rain on the window, a playlist that knows too much." / "Hot coffee, overcast sky, the kind of afternoon that writes itself."

2. ROAST (max 25 words): A dry, witty dev humor quip. Universal, not personal. Could be about the irony of coding, tech debt, stack choices, or the dev lifestyle. No names. Examples of tone: "Wrote 200 lines to avoid writing 10." / "The app works. Nobody knows why. Including the developer."

No labels, no quotes, no markdown, no names. Just the two lines separated by |||.`;
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    const d = await res.json();
    const text = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parts = text.split("|||");
    cache.gemini = {
      bio: parts[0]?.trim() || "Building things in Malang ☕",
      roast: parts[1]?.trim() || "Your code works, your README doesn't.",
    };
    console.log("✅ Gemini bio:", cache.gemini.bio.substring(0, 50) + "...");
  } catch (e) {
    console.error("Gemini fetch error:", e.message);
  }
}

// ─── Recently Played PREVIEW ──────────────────────────────────────────────────────
app.get("/api/preview", async (req, res) => {
  try {
    const spotify = cache.spotify;
    if (!spotify?.track) return res.json({ preview_url: null });

    const q = encodeURIComponent(`${spotify.track} ${spotify.artist}`);
    const r = await fetch(`https://itunes.apple.com/search?term=${q}&media=music&limit=1`);
    const d = await r.json();
    const item = d.results?.[0];
    res.json({
      preview_url: item?.previewUrl || null,
      track: spotify.track,
      artist: spotify.artist,
      albumArt: item?.artworkUrl100 || spotify.albumArt || null,
    });
  } catch(e) {
    res.json({ preview_url: null, error: e.message });
  }
});

// ─── REFRESH ALL DATA ─────────────────────────────────────────────────────
async function refreshAll() {
  console.log("🔄 Refreshing all data...");
  await Promise.all([fetchWeather(), fetchGithub()]);
  await Promise.all([fetchSpotify(), fetchGemini()]);
  cache.svgGeneratedAt = 0;
  console.log("✅ Data refreshed");
}

refreshAll();
setInterval(refreshAll, 3 * 60 * 1000); //refresh every 3 minutes

// ─── THEME PALETTES ───────────────────────────────────────────────────────
const palettes = {
  sunny: {
    bg: "#1a0e00", surface: "#2a1800", surface2: "#3d2400",
    text: "#fff5e6", subtext: "#d4956a", accent: "#ffb347",
    primary: "#c46d00", border: "rgba(255,179,71,0.25)",
  },
  rainy: {
    bg: "#040e18", surface: "#0a1f30", surface2: "#122d44",
    text: "#e0f4ff", subtext: "#7ab8d4", accent: "#5bc8f5",
    primary: "#1a6494", border: "rgba(91,200,245,0.25)",
  },
  storm: {
    bg: "#07030f", surface: "#130828", surface2: "#1e0f3a",
    text: "#ede9fe", subtext: "#9d8ec4", accent: "#a78bfa",
    primary: "#4a22a0", border: "rgba(167,139,250,0.25)",
  },
  cloudy: {
    bg: "#0a2418", surface: "#112e1f", surface2: "#1c4232",
    text: "#e8f5f0", subtext: "#8ecfb4", accent: "#56cfaa",
    primary: "#2d9e6e", border: "rgba(86,207,170,0.25)",
  },
};

const weatherEmoji = { sunny: "☀️", rainy: "🌧️", storm: "⛈️", cloudy: "⛅" };

// ─── SVG GENERATOR ────────────────────────────────────────────────────────
function generateSVG() {
  const w  = cache.weather || { temp: 26, desc: "Partly Cloudy", humidity: 72, wind: 12, theme: "cloudy" };
  const s  = cache.spotify;
  const g  = cache.gemini  || { bio: "Building things in Malang ☕", roast: "Your Kotlin is safe, your README is not." };
  const gh = cache.github  || { repos: 13, followers: 0 };

  const theme = w.theme || "cloudy";
  const p     = palettes[theme];
  const emoji = weatherEmoji[theme] || "⛅";

  function wrapText(text, maxChars) {
    const words = text.split(" ");
    const lines = [];
    let line = "";
    for (const word of words) {
      if ((line + word).length > maxChars) {
        if (line) lines.push(line.trim());
        line = word + " ";
      } else {
        line += word + " ";
      }
    }
    if (line.trim()) lines.push(line.trim());
    return lines;
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const bioLines    = wrapText(g.bio, 52);
  const roastLines  = wrapText(g.roast, 52);
  const bioHeight   = bioLines.length * 18;
  const roastHeight = roastLines.length * 18;
  const svgHeight   = 380 + bioHeight + roastHeight;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${svgHeight}" viewBox="0 0 800 ${svgHeight}">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${p.bg}"/>
      <stop offset="100%" style="stop-color:${p.surface}"/>
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${p.accent};stop-opacity:0.8"/>
      <stop offset="100%" style="stop-color:${p.primary};stop-opacity:0.4"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="800" height="${svgHeight}" rx="20" fill="url(#bgGrad)"/>
  <circle cx="650" cy="80" r="120" fill="${p.accent}" opacity="0.04"/>
  <circle cx="100" cy="${svgHeight - 80}" r="150" fill="${p.primary}" opacity="0.05"/>
  <rect x="0" y="0" width="800" height="3" fill="url(#accentGrad)"/>

  <text x="40" y="52" font-family="'Segoe UI',system-ui,sans-serif" font-size="22" font-weight="700" fill="${p.text}">Oktavianus Samuel Minarto</text>
  <text x="40" y="74" font-family="'Segoe UI',system-ui,sans-serif" font-size="13" fill="${p.subtext}">@oktavsm · Android Engineer · Brawijaya University</text>
  <line x1="40" y1="90" x2="760" y2="90" stroke="${p.border}" stroke-width="1"/>

  <rect x="40" y="108" width="220" height="100" rx="12" fill="${p.surface2}" opacity="0.8"/>
  <rect x="40" y="108" width="220" height="100" rx="12" fill="none" stroke="${p.border}" stroke-width="1"/>
  <text x="56" y="130" font-family="'Segoe UI',sans-serif" font-size="11" fill="${p.subtext}">MALANG WEATHER</text>
  <text x="56" y="162" font-family="'Segoe UI',sans-serif" font-size="32" font-weight="700" fill="${p.accent}" filter="url(#glow)">${emoji} ${w.temp}°C</text>
  <text x="56" y="180" font-family="'Segoe UI',sans-serif" font-size="12" fill="${p.subtext}">${esc(w.desc)}</text>
  <text x="56" y="198" font-family="'Segoe UI',sans-serif" font-size="11" fill="${p.subtext}" opacity="0.7">💧 ${w.humidity}%  💨 ${w.wind} km/h</text>

  <rect x="276" y="108" width="484" height="100" rx="12" fill="${p.surface2}" opacity="0.8"/>
  <rect x="276" y="108" width="484" height="100" rx="12" fill="none" stroke="${p.border}" stroke-width="1"/>
  <text x="292" y="130" font-family="'Segoe UI',sans-serif" font-size="11" fill="${p.subtext}">🎵 ${s?.isPlaying ? "NOW PLAYING" : "RECENTLY PLAYED"}</text>
  <text x="292" y="158" font-family="'Segoe UI',sans-serif" font-size="18" font-weight="700" fill="${p.text}">${esc((s?.track || "Not playing").substring(0, 32))}${(s?.track?.length || 0) > 32 ? "…" : ""}</text>
  <text x="292" y="178" font-family="'Segoe UI',sans-serif" font-size="13" fill="${p.subtext}">${esc(s?.artist?.substring(0, 40) || "—")}</text>
  <text x="292" y="198" font-family="'Segoe UI',sans-serif" font-size="11" fill="${p.subtext}" opacity="0.6">${esc(s?.album?.substring(0, 45) || "")}</text>

  <g transform="translate(718,145)">
    <rect x="0" y="0" width="4" height="20" rx="2" fill="${p.accent}" opacity="0.8">
      <animate attributeName="height" values="4;20;8;16;4" dur="1.2s" repeatCount="indefinite"/>
      <animate attributeName="y" values="16;0;12;4;16" dur="1.2s" repeatCount="indefinite"/>
    </rect>
    <rect x="7" y="0" width="4" height="20" rx="2" fill="${p.accent}" opacity="0.6">
      <animate attributeName="height" values="16;6;20;4;16" dur="0.9s" repeatCount="indefinite"/>
      <animate attributeName="y" values="4;14;0;16;4" dur="0.9s" repeatCount="indefinite"/>
    </rect>
    <rect x="14" y="0" width="4" height="20" rx="2" fill="${p.accent}" opacity="0.8">
      <animate attributeName="height" values="8;18;4;20;8" dur="1.5s" repeatCount="indefinite"/>
      <animate attributeName="y" values="12;2;16;0;12" dur="1.5s" repeatCount="indefinite"/>
    </rect>
    <rect x="21" y="0" width="4" height="20" rx="2" fill="${p.accent}" opacity="0.5">
      <animate attributeName="height" values="20;8;14;6;20" dur="1.1s" repeatCount="indefinite"/>
      <animate attributeName="y" values="0;12;6;14;0" dur="1.1s" repeatCount="indefinite"/>
    </rect>
  </g>

  <rect x="40" y="228" width="720" height="${bioHeight + 40}" rx="12" fill="${p.surface}" opacity="0.6"/>
  <rect x="40" y="228" width="720" height="${bioHeight + 40}" rx="12" fill="none" stroke="${p.border}" stroke-width="1"/>
  <text x="56" y="248" font-family="'Segoe UI',sans-serif" font-size="11" fill="${p.accent}">✨ AI DAILY VIBE</text>
  ${bioLines.map((line, i) => `<text x="56" y="${266 + i * 18}" font-family="'Segoe UI',sans-serif" font-size="13" fill="${p.text}">${esc(line)}</text>`).join("\n  ")}

  <rect x="40" y="${278 + bioHeight}" width="720" height="${roastHeight + 40}" rx="12" fill="${p.surface}" opacity="0.4"/>
  <rect x="40" y="${278 + bioHeight}" width="720" height="${roastHeight + 40}" rx="12" fill="none" stroke="rgba(255,107,107,0.2)" stroke-width="1"/>
  <text x="56" y="${298 + bioHeight}" font-family="'Segoe UI',sans-serif" font-size="11" fill="rgba(255,107,107,0.9)">🔥 AI ROAST · DAILY</text>
  ${roastLines.map((line, i) => `<text x="56" y="${316 + bioHeight + i * 18}" font-family="'Segoe UI',sans-serif" font-size="13" fill="${p.text}" opacity="0.85">${esc(line)}</text>`).join("\n  ")}

  <text x="40" y="${338 + bioHeight + roastHeight}" font-family="'Segoe UI',sans-serif" font-size="11" fill="${p.subtext}">⚡ Kotlin · Java · Android · Firebase · GCP · Python</text>
  <text x="40" y="${svgHeight - 16}" font-family="'Segoe UI Mono',monospace" font-size="10" fill="${p.subtext}" opacity="0.5">Updated by GitHub Actions · ${new Date().toUTCString()}</text>
  <circle cx="774" cy="${svgHeight - 20}" r="4" fill="${p.accent}" opacity="0.7">
    <animate attributeName="opacity" values="0.7;0.2;0.7" dur="2s" repeatCount="indefinite"/>
  </circle>
</svg>`;
}

// ─── ROUTES ───────────────────────────────────────────────────────────────
app.get("/api/data",    (req, res) => res.json({ weather: cache.weather, spotify: cache.spotify, gemini: cache.gemini, github: cache.github }));
app.get("/api/weather", (req, res) => res.json(cache.weather));
app.get("/api/spotify", (req, res) => res.json(cache.spotify));
app.get("/api/gemini",  (req, res) => res.json(cache.gemini));
app.get("/api/github",  (req, res) => res.json(cache.github));

app.get("/readme.svg", (req, res) => {
  const now = Date.now();
  if (!cache.svg || now - cache.svgGeneratedAt > 15 * 60 * 1000) {
    cache.svg = generateSVG();
    cache.svgGeneratedAt = now;
  }
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.send(cache.svg);
});

app.post("/api/refresh", async (req, res) => {
  const secret = req.headers["x-refresh-secret"];
  if (REFRESH_SECRET && secret !== REFRESH_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  await refreshAll();
  cache.svg = generateSVG();
  cache.svgGeneratedAt = Date.now();
  res.json({ ok: true, refreshedAt: new Date().toISOString() });
});

app.get("/health", (req, res) => res.json({ ok: true, uptime: process.uptime() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));