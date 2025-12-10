import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.argv.includes('--dev') ? 5173 : (process.env.PORT || 3000);

// Simple in-memory cache (per-process)
const cache = new Map();

/**
 * Fetch helper with timeout.
 * Uses Node 18+ global fetch and AbortController.
 * @param {string} url
 * @param {{ timeoutMs?: number, headers?: Record<string,string>, method?: string, body?: any }} [opt]
 */
async function fetchWithTimeout(url, opt = {}) {
  const { timeoutMs = 10000, headers = {}, method = 'GET', body } = opt;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal
    });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

/**
 * Try to extract an image URL from a Pinterest v5 Pin object.
 * The exact shape depends on fields requested, so we defensively
 * look through several common locations.
 * @param {any} pin
 * @returns {string|null}
 */
function pickImageUrlFromPin(pin) {
  if (!pin || typeof pin !== 'object') return null;

  // 1) media.images (v5 pins with images block)
  const mediaImages = pin.media && pin.media.images;
  if (mediaImages && typeof mediaImages === 'object') {
    const variants = Object.values(mediaImages);
    for (const v of variants) {
      if (v && typeof v === 'object' && typeof v.url === 'string') {
        return v.url;
      }
    }
  }

  // 2) legacy images object (for some responses / SDKs)
  const images = pin.images;
  if (images && typeof images === 'object') {
    const preferredOrder = ['orig', '1200x', '1000x', '800x', '600x', '400x', '236x', '150x150'];
    for (const key of preferredOrder) {
      if (images[key] && typeof images[key].url === 'string') {
        return images[key].url;
      }
    }
    for (const v of Object.values(images)) {
      if (v && typeof v === 'object' && typeof v.url === 'string') {
        return v.url;
      }
    }
  }

  // 3) some APIs expose a direct image_url / thumbnail_url
  if (typeof pin.image_url === 'string') return pin.image_url;
  if (typeof pin.thumbnail_url === 'string') return pin.thumbnail_url;

  // 4) fall back to link only if it looks like a direct image (very conservative)
  if (typeof pin.link === 'string' && /^https?:\/\/i\.pinimg\.com\//.test(pin.link)) {
    return pin.link;
  }

  return null;
}

/**
 * Normalize Pinterest v5 search response into
 * { id, title, link, image } objects used by the front-end.
 * @param {any} json
 */
function normalizePinsFromPinterest(json) {
  const items = Array.isArray(json?.items) ? json.items : [];
  return items
    .map((p) => {
      const image = pickImageUrlFromPin(p);
      return {
        id: String(p.id || image || Math.random()),
        title: p.title || p.description || p.alt_text || '',
        link: p.link || null,
        image
      };
    })
    .filter((p) => !!p.image);
}

// Search endpoint: proxies Pinterest API v5 /search/pins
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const rawLimit = Number(req.query.limit || 60);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 120) : 60;
  const useMock = process.env.USE_MOCK === '1';

  if (!q) {
    return res.status(400).json({ ok: false, error: 'q is required' });
  }

  const cacheKey = `${q}::${limit}::${useMock ? 'mock' : 'live'}`;

  // Cache (only for live mode)
  if (!useMock && cache.has(cacheKey)) {
    const items = cache.get(cacheKey);
    return res.json({ ok: true, source: 'cache', items });
  }

  // Mock mode: never call Pinterest, always use bundled sample data
  if (useMock) {
    try {
      const sample = (await import('../public/mock/sample.json', { assert: { type: 'json' } })).default;
      const items = Array.isArray(sample.items) ? sample.items.slice(0, limit) : [];
      cache.set(cacheKey, items);
      return res.json({ ok: true, source: 'mock', items });
    } catch (e) {
      console.error('[Pinterval] Failed to load mock data', e);
      return res.status(500).json({ ok: false, error: 'Failed to load mock data' });
    }
  }

  // Live mode: use official Pinterest REST API v5 search endpoint
  const accessToken = process.env.PINTEREST_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('[Pinterval] Missing PINTEREST_ACCESS_TOKEN environment variable.');
    return res.status(500).json({
      ok: false,
      error: 'Pinterest API access token is not configured. Set PINTEREST_ACCESS_TOKEN to a valid OAuth2 access token.'
    });
  }

  const searchParams = new URLSearchParams();
  searchParams.set('query', q);
  // Pinterest search supports page_size; keep it modest per request
  const pageSize = Math.min(limit, 50);
  searchParams.set('page_size', String(pageSize));

  const endpoint = `https://api.pinterest.com/v5/search/pins?${searchParams.toString()}`;

  try {
    const pinterestRes = await fetchWithTimeout(endpoint, {
      timeoutMs: 10000,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`
      }
    });

    const text = await pinterestRes.text();

    if (!pinterestRes.ok) {
      console.error('[Pinterval] Pinterest API error', pinterestRes.status, text);
      return res.status(pinterestRes.status || 502).json({
        ok: false,
        error: 'Pinterest API error',
        status: pinterestRes.status
      });
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.error('[Pinterval] Failed to parse Pinterest JSON', e);
      return res.status(502).json({ ok: false, error: 'Failed to parse Pinterest response' });
    }

    const normalized = normalizePinsFromPinterest(json);
    const items = normalized.slice(0, limit);

    cache.set(cacheKey, items);
    return res.json({ ok: true, source: 'pinterest-v5', items });
  } catch (e) {
    console.error('[Pinterval] Pinterest API request failed', e);
    return res.status(502).json({ ok: false, error: 'Pinterest API request failed' });
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Pinterval server running on http://localhost:${PORT}`);
});