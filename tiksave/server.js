// TikSave - Backend Server
// node server.js → http://localhost:3000
//
// Setup RapidAPI key untuk fitur "By Username":
//   1. Daftar di https://rapidapi.com
//   2. Subscribe ke: https://rapidapi.com/tikwm-tikwm-default/api/tiktok-scraper7
//      (free tier: 500 req/bulan)
//   3. Copy API key dari dashboard
//   4. Set env variable: RAPIDAPI_KEY=your_key_here node server.js
//      atau edit baris RAPIDAPI_KEY di bawah

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';  // ← isi API key di sini kalau mau

const http  = require('http');
const https = require('https');
const zlib  = require('zlib');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const PORT = process.env.PORT || 3000;
const UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── decompress + read body ───────────────────────────────────────────────────
function readBody(res) {
  return new Promise((resolve, reject) => {
    const enc = (res.headers['content-encoding'] || '').toLowerCase();
    const chunks = [];
    let stream;
    try {
      stream = enc === 'gzip'    ? res.pipe(zlib.createGunzip())
             : enc === 'deflate' ? res.pipe(zlib.createInflate())
             : enc === 'br'      ? res.pipe(zlib.createBrotliDecompress())
             : res;
    } catch(e) { stream = res; }
    stream.on('data', c => chunks.push(c));
    stream.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

function httpsReq(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, async res => {
      try {
        const text = await readBody(res);
        resolve({ status: res.statusCode, headers: res.headers, text });
      } catch(e) { reject(e); }
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('Timeout')));
    if (body) req.write(body);
    req.end();
  });
}

function isHTML(t) { return t.trimStart().startsWith('<') || t.includes('<!DOCTYPE'); }

function sendJSON(res, obj) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

// ═══════════════════════════════════════════════════════════════
//  BACKEND 1: tikwm.com POST — video URL + story (reliable)
// ═══════════════════════════════════════════════════════════════
async function tikwmPost(endpoint, params) {
  const bodyStr = new URLSearchParams(params).toString();
  const r = await httpsReq({
    hostname: 'www.tikwm.com', port: 443,
    path: `/api/${endpoint}`,
    method: 'POST',
    headers: {
      'User-Agent':      UA,
      'Accept':          'application/json, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Content-Type':    'application/x-www-form-urlencoded',
      'Content-Length':  Buffer.byteLength(bodyStr),
      'Origin':          'https://www.tikwm.com',
      'Referer':         'https://www.tikwm.com/',
      'Sec-Fetch-Dest':  'empty',
      'Sec-Fetch-Mode':  'cors',
      'Sec-Fetch-Site':  'same-origin',
    }
  }, bodyStr);
  if (isHTML(r.text)) throw new Error('CF_BLOCK');
  const d = JSON.parse(r.text);
  if (d.code !== 0) throw new Error(d.msg || 'tikwm error ' + d.code);
  return d;
}

// ═══════════════════════════════════════════════════════════════
//  BACKEND 2: RapidAPI TikTok Scraper — user posts (most reliable)
//  API: tiktok-scraper7 by tikwm on RapidAPI
// ═══════════════════════════════════════════════════════════════
async function rapidApiPosts(username, count, cursor) {
  if (!RAPIDAPI_KEY) throw new Error('NO_KEY');

  const qs = new URLSearchParams({
    unique_id: username,
    count:     count  || 35,
    cursor:    cursor || 0,
  }).toString();

  const r = await httpsReq({
    hostname: 'tiktok-scraper7.p.rapidapi.com', port: 443,
    path: `/user/posts?${qs}`,
    method: 'GET',
    headers: {
      'x-rapidapi-key':  RAPIDAPI_KEY,
      'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com',
      'Accept':          'application/json',
      'Accept-Encoding': 'gzip, deflate, br',
    }
  });

  console.log('[RapidAPI] status=', r.status, 'len=', r.text.length);
  if (isHTML(r.text)) throw new Error('HTML from RapidAPI');
  const d = JSON.parse(r.text);
  if (d.code !== 0) throw new Error(d.msg || 'RapidAPI error ' + d.code);
  return d; // same shape as tikwm: { code:0, data:{ videos:[...], author:{...} } }
}

// ═══════════════════════════════════════════════════════════════
//  BACKEND 3: tikvid.org (no CF, no key needed)
// ═══════════════════════════════════════════════════════════════
async function tikvidPosts(username, count) {
  const bodyStr = new URLSearchParams({ username, count: count || 30 }).toString();
  const r = await httpsReq({
    hostname: 'tikvid.org', port: 443,
    path: '/api/user-posts',
    method: 'POST',
    headers: {
      'User-Agent':      UA,
      'Accept':          'application/json',
      'Accept-Encoding': 'gzip, deflate, br',
      'Content-Type':    'application/x-www-form-urlencoded',
      'Content-Length':  Buffer.byteLength(bodyStr),
      'Origin':  'https://tikvid.org',
      'Referer': 'https://tikvid.org/',
    }
  }, bodyStr);
  console.log('[tikvid] status=', r.status, 'body=', r.text.slice(0, 150));
  if (isHTML(r.text)) throw new Error('HTML');
  const d = JSON.parse(r.text);
  return d;
}

// ═══════════════════════════════════════════════════════════════
//  BACKEND 4: tikwm.com user/posts GET (sometimes slips through CF)
// ═══════════════════════════════════════════════════════════════
async function tikwmGetPosts(username, count, cursor) {
  const qs = new URLSearchParams({ unique_id: username, count: count||35, cursor: cursor||0 }).toString();
  const r = await httpsReq({
    hostname: 'www.tikwm.com', port: 443,
    path: `/api/user/posts?${qs}`,
    method: 'GET',
    headers: {
      'User-Agent':       UA,
      'Accept':           'application/json, */*',
      'Accept-Language':  'en-US,en;q=0.9',
      'Accept-Encoding':  'gzip, deflate, br',
      'Referer':          'https://www.tikwm.com/',
      'Sec-Fetch-Dest':   'empty',
      'Sec-Fetch-Mode':   'cors',
      'Sec-Fetch-Site':   'same-origin',
    }
  });
  if (isHTML(r.text)) throw new Error('CF_BLOCK');
  const d = JSON.parse(r.text);
  if (d.code !== 0) throw new Error(d.msg || 'tikwm GET error');
  return d;
}

// ── normalise any video shape ────────────────────────────────────────────────
function norm(v) {
  return {
    id:            v.id || v.aweme_id || '',
    title:         v.title || v.desc || '',
    cover:         v.cover || v.origin_cover || v.video?.cover?.url_list?.[0] || '',
    origin_cover:  v.origin_cover || v.cover || '',
    play:          v.play || v.video?.play_addr?.url_list?.[0] || '',
    wmplay:        v.wmplay || v.play || '',
    music:         v.music || '',
    digg_count:    v.digg_count    || v.statistics?.digg_count    || 0,
    comment_count: v.comment_count || v.statistics?.comment_count || 0,
    share_count:   v.share_count   || v.statistics?.share_count   || 0,
    play_count:    v.play_count    || v.statistics?.play_count    || 0,
    images:        v.images || [],
  };
}

// ═══════════════════════════════════════════════════════════════
//  HANDLERS
// ═══════════════════════════════════════════════════════════════
async function handleVideo(query, res) {
  try {
    sendJSON(res, await tikwmPost('', { url: query.url, hd: 1 }));
  } catch(e) {
    sendJSON(res, { code: -1, msg: e.message });
  }
}

async function handlePosts(query, res) {
  const username = (query.unique_id || '').replace(/^@/, '').trim();
  const count  = parseInt(query.count)  || 35;
  const cursor = parseInt(query.cursor) || 0;
  console.log(`\n[POSTS] @username`);

  // ── 1. RapidAPI (best, needs key) ──
  if (RAPIDAPI_KEY) {
    try {
      console.log('[POSTS-1] RapidAPI...');
      const d = await rapidApiPosts(username, count, cursor);
      console.log('[POSTS-1] OK videos=', d.data?.videos?.length);
      return sendJSON(res, d);
    } catch(e) { console.log('[POSTS-1] fail:', e.message); }
  } else {
    console.log('[POSTS-1] RapidAPI skipped (no key)');
  }

  // ── 2. tikwm POST ──
  try {
    console.log('[POSTS-2] tikwm POST...');
    const d = await tikwmPost('user/posts', { unique_id: username, count, cursor });
    console.log('[POSTS-2] OK videos=', d.data?.videos?.length);
    return sendJSON(res, d);
  } catch(e) { console.log('[POSTS-2] fail:', e.message); }

  // ── 3. tikvid ──
  try {
    console.log('[POSTS-3] tikvid...');
    const d = await tikvidPosts(username, count);
    const videos = d.videos || d.data?.videos || d.items;
    if (videos?.length > 0) {
      return sendJSON(res, {
        code: 0,
        data: {
          videos: videos.map(norm),
          author: { unique_id: username, nickname: d.nickname || username, avatar_medium: d.avatar || '', follower_count: 0, heart_count: 0, verified: false }
        }
      });
    }
    throw new Error('no videos: ' + JSON.stringify(d).slice(0, 100));
  } catch(e) { console.log('[POSTS-3] fail:', e.message); }

  // ── 4. tikwm GET ──
  try {
    console.log('[POSTS-4] tikwm GET...');
    const d = await tikwmGetPosts(username, count, cursor);
    console.log('[POSTS-4] OK videos=', d.data?.videos?.length);
    return sendJSON(res, d);
  } catch(e) { console.log('[POSTS-4] fail:', e.message); }

  // ── All failed ──
  const needKey = !RAPIDAPI_KEY;
  sendJSON(res, {
    code: -1,
    need_rapidapi: needKey,
    msg: needKey
      ? 'RAPIDAPI_KEY_REQUIRED'
      : 'Semua backend gagal. Tikwm sedang diblokir CF. Coba lagi nanti atau set ulang RAPIDAPI_KEY.',
  });
}

async function handleStory(query, res) {
  const username = (query.unique_id || '').replace(/^@/, '').trim();
  try {
    sendJSON(res, await tikwmPost('user/story', { unique_id: username }));
  } catch(e) { sendJSON(res, { code: -1, msg: e.message }); }
}

// ── Media proxy ──────────────────────────────────────────────────────────────
function proxyMedia(mediaUrl, res, hops) {
  hops = hops || 0;
  if (hops > 6) { res.writeHead(500); return res.end('Too many redirects'); }
  if (!mediaUrl?.startsWith('http')) { res.writeHead(400); return res.end('Bad URL'); }
  let parsed;
  try { parsed = new URL(mediaUrl); } catch(e) { res.writeHead(400); return res.end('Bad URL'); }

  const req = https.request({
    hostname: parsed.hostname, port: 443,
    path: parsed.pathname + parsed.search,
    method: 'GET',
    headers: { 'User-Agent': UA, 'Referer': 'https://www.tiktok.com/', 'Accept': '*/*' }
  }, upstream => {
    const { statusCode, headers } = upstream;
    if ([301,302,303,307,308].includes(statusCode) && headers.location) {
      upstream.resume();
      let loc = headers.location;
      if (loc.startsWith('/')) loc = `https://${parsed.hostname}${loc}`;
      return proxyMedia(loc, res, hops + 1);
    }
    const ct  = headers['content-type'] || 'application/octet-stream';
    const ext = ct.includes('video') || /\.mp4/i.test(mediaUrl) ? '.mp4'
              : ct.includes('image') || /\.(jpe?g|png|webp)/i.test(mediaUrl) ? '.jpg' : '.bin';
    const out = { 'Content-Type': ct, 'Content-Disposition': `attachment; filename="tiksave_${Date.now()}${ext}"`, 'Access-Control-Allow-Origin': '*' };
    if (headers['content-length']) out['Content-Length'] = headers['content-length'];
    res.writeHead(statusCode < 200 || statusCode >= 300 ? statusCode : 200, out);
    upstream.pipe(res);
  });
  req.on('error', e => { if (!res.headersSent) { res.writeHead(500); res.end(e.message); } });
  req.end();
}

// ── HTTP Server ──────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  const { pathname, query } = url.parse(req.url, true);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*' }); return res.end(); }

  try {
    if (pathname === '/api/video')      return await handleVideo(query, res);
    if (pathname === '/api/user/posts') return await handlePosts(query, res);
    if (pathname === '/api/user/story') return await handleStory(query, res);

    if (pathname === '/proxy') {
      const mu = query.url ? decodeURIComponent(query.url) : '';
      if (!mu) { res.writeHead(400); return res.end('Missing url'); }
      return proxyMedia(mu, res);
    }

    if (pathname === '/favicon.ico' || pathname === '/favicon.svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#56cfaa"/><stop offset="100%" stop-color="#2d9e6e"/></linearGradient></defs><rect width="32" height="32" rx="7" fill="#091e13"/><circle cx="16" cy="16" r="10" fill="url(#g)"/><circle cx="16" cy="16" r="5.5" fill="#091e13"/></svg>');
    }

    let fp = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
    if (!fp.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg' };
      res.writeHead(200, { 'Content-Type': mime[path.extname(fp)] || 'text/plain' });
      res.end(data);
    });

  } catch(e) {
    console.error('[ERR]', e.message);
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: -1, msg: e.message })); }
  }

}).listen(PORT, () => {
  console.log(`\n🎵 TikSave → http://localhost:${PORT}`);
  if (!RAPIDAPI_KEY) {
    console.log('\n⚠️  RAPIDAPI_KEY tidak di-set. Fitur "By Username" butuh ini.');
    console.log('   1. Daftar di https://rapidapi.com (gratis)');
    console.log('   2. Subscribe: https://rapidapi.com/tikwm-tikwm-default/api/tiktok-scraper7');
    console.log('   3. Jalankan: RAPIDAPI_KEY=xxxxxx node server.js\n');
  } else {
    console.log('   RapidAPI key: SET ✓\n');
  }
});