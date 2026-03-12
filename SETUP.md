# 🚀 Okta Profile — Setup Guide

## Architecture

```
oktaavsm.bccdev.id  (VM playground, port 11023)
├── nginx (port 80)
│   ├── / → serve frontend/index.html  (web porto)
│   ├── /api/* → proxy to backend:3000
│   └── /readme.svg → proxy to backend:3000
│
└── backend (port 3000, internal only)
    ├── /api/data      → all data JSON
    ├── /api/weather   → weather only
    ├── /api/spotify   → spotify only
    ├── /readme.svg    → generated SVG card
    └── /api/refresh   → force re-fetch (called by GitHub Actions)

GitHub Actions (repo: oktavsm/oktavsm)
└── Every 6h → bump timestamp in README.md
    → Optional: call /api/refresh to pre-generate fresh SVG
```

---

## Step 1: Get Spotify Refresh Token (do this ONCE, locally)

Your Spotify app needs `http://localhost:8888/callback` as a Redirect URI.
Add it in: https://developer.spotify.com/dashboard → your app → Settings → Redirect URIs

```bash
# Run locally (not on server)
SPOTIFY_CLIENT_ID=xxx SPOTIFY_CLIENT_SECRET=yyy node get-spotify-token.js
```

Open the URL it prints, authorize, copy the `SPOTIFY_REFRESH_TOKEN` from terminal.

---

## Step 2: Deploy to VM

```bash
# SSH into your VM
ssh dev@bccdev.id -p 11023

# Clone or copy this project
git clone https://github.com/oktavsm/okta-profile.git
# OR scp -P 11023 -r ./okta-profile dev@bccdev.id:~/okta-profile

cd okta-profile

# Set up environment variables
cp .env.example .env
nano .env  # fill in all your keys

# Build and start
docker-compose up -d --build

# Check logs
docker-compose logs -f

# Verify it works
curl http://localhost/api/data
curl http://localhost/health
```

---

## Step 3: Setup GitHub Profile README

1. Create a repo named `oktavsm` (same as your GitHub username)
   → This is your special profile repo: `github.com/oktavsm/oktavsm`

2. Copy the README content:
```bash
cp PROFILE_README.md README.md
```

3. Commit and push:
```bash
git add README.md
git commit -m "feat: add dynamic profile card"
git push
```

4. Add GitHub Actions workflow:
```bash
mkdir -p .github/workflows
cp .github/workflows/update-readme.yml .github/workflows/
git add .github/workflows/update-readme.yml
git commit -m "feat: add auto-refresh action"
git push
```

5. Add these secrets to your profile repo
   → `github.com/oktavsm/oktavsm` → Settings → Secrets → Actions:
   - `REFRESH_SECRET` — same value as in your `.env`
   - `SERVER_URL` — `https://oktaavsm.bccdev.id`

---

## Step 4: Domain / HTTPS (if needed)

If your VM already has HTTPS via your org's setup, you're done.
If not and you want HTTPS manually:

```bash
# Install certbot inside VM
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d oktaavsm.bccdev.id
```

---

## Updating projects / content

Edit `frontend/index.html` and `backend/server.js`, then:
```bash
docker-compose up -d --build
```

---

## Environment Variables Reference

| Variable | Description |
|---|---|
| `OWM_KEY` | OpenWeatherMap API key |
| `SPOTIFY_CLIENT_ID` | Spotify app client ID |
| `SPOTIFY_CLIENT_SECRET` | Spotify app client secret |
| `SPOTIFY_REFRESH_TOKEN` | Get via `get-spotify-token.js` |
| `GEMINI_KEY` | Google Gemini API key |
| `GITHUB_TOKEN` | GitHub PAT (optional, higher rate limit) |
| `GITHUB_USERNAME` | Your GitHub username (default: `oktavsm`) |
| `REFRESH_SECRET` | Random secret for `/api/refresh` endpoint |

---

## Troubleshooting

**SVG not showing on GitHub README?**
→ Make sure `oktaavsm.bccdev.id` is publicly accessible (not behind VPN/auth)
→ GitHub caches images — the `?t=TIMESTAMP` busts the cache

**Spotify shows "not playing" always?**
→ Free Spotify: `currently-playing` needs Premium. We auto-fallback to `recently-played` ✅

**Weather wrong?**
→ Check OWM key: `curl "https://api.openweathermap.org/data/2.5/weather?q=Malang,ID&appid=YOUR_KEY&units=metric"`

**Gemini rate limit?**
→ Free tier has generous limits. If hit, the bio/roast shows fallback text gracefully.
