# oktaavsm-bcc-web

Source code for [oktaavsm.bccdev.id](https://oktaavsm.bccdev.id) — personal portfolio with a backend API, TikSave, and college assignment pages.

## Project Structure

```
.
├── backend/          # Express API (port 3000)
├── frontend/         # Static files served by nginx
│   ├── index.html    # Main portfolio page
│   └── tugas/        # College assignments
│       └── durian-shop/
├── tiksave/          # TikTok video downloader (port 3001)
├── nginx.conf        # Nginx reverse proxy config
├── docker-compose.yml
└── .env.example
```

## Routes

| URL | Description |
|-----|-------------|
| `/` | Portfolio & profile card |
| `/api/data` | All data JSON (weather, spotify, github, gemini) |
| `/api/refresh` | Force re-fetch cache (called by GitHub Actions) |
| `/readme.svg` | Dynamic SVG card for GitHub profile README |
| `/tiksave` | TikTok video downloader |
| `/tugas/durian-shop` | College assignment — Durian Shop (static web) |

## Stack

- **Frontend** — Vanilla HTML/CSS/JS
- **Backend** — Node.js + Express
- **Proxy** — Nginx (Alpine)
- **Runtime** — Docker Compose
- **CI** — GitHub Actions (auto-refresh README every 6 hours)

## APIs Used

- [OpenWeatherMap](https://openweathermap.org/api) — Malang weather
- [Spotify Web API](https://developer.spotify.com/documentation/web-api) — now playing
- [Last.fm API](https://www.last.fm/api) — scrobble history
- [Google Gemini](https://aistudio.google.com/) — AI daily vibe & roast
- [RapidAPI TikTok Scraper](https://rapidapi.com/tikwm-tikwm-default/api/tiktok-scraper7) — tiksave

## Setup

### 1. Clone & configure environment

```bash
git clone https://github.com/oktavsm/oktaavsm-bcc-web.git
cd oktaavsm-bcc-web
cp .env.example .env
nano .env  # fill in all API keys
```

### 2. Run

```bash
docker compose up -d --build
```

### 3. Verify

```bash
curl http://localhost:8080/api/data
curl http://localhost:8080/health
```

For the full setup guide (Spotify token, GitHub Actions, etc.) see [SETUP.md](SETUP.md).

## GitHub Actions

The workflow `.github/workflows/update-readme.yml` runs every 6 hours:
1. Bumps the SVG cache-buster timestamp in the profile README
2. Hits `POST /api/refresh` to pre-generate a fresh SVG

Add the following secrets to your GitHub profile repo (`oktavsm/oktavsm`):
- `REFRESH_SECRET` — same value as in your `.env`
- `SERVER_URL` — `https://oktaavsm.bccdev.id`


[![GitHub Profile](https://oktaavsm.bccdev.id/github-svg/svg/oktavsm)](https://github.com/oktavsm)