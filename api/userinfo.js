// api/userinfo.js — Node.js runtime (NOT edge — edge blocks roblox.com fetches)
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const { cookie } = req.body || {};
  if (!cookie) return res.status(400).json({ error: 'missing cookie' });

  const raw = cookie.toString().trim();
  const cookieVal = raw.startsWith('.ROBLOSECURITY=')
    ? raw.slice('.ROBLOSECURITY='.length)
    : raw;
  const cookieHeader = `.ROBLOSECURITY=${cookieVal}`;

  // ── Step 1: CSRF token ─────────────────────────────────────────────────────
  let csrf = '';
  try {
    const r = await fetch('https://auth.roblox.com/v2/logout', {
      method: 'POST',
      headers: {
        Cookie: cookieHeader,
        'Content-Type': 'application/json',
        'Content-Length': '0',
      },
    });
    csrf = r.headers.get('x-csrf-token') || '';
  } catch (e) {
    console.error('csrf fetch failed:', e.message);
  }

  // ── Step 2: Get user info ──────────────────────────────────────────────────
  let userId = null, username = null, displayName = null;

  try {
    const r = await fetch('https://users.roblox.com/v1/users/authenticated', {
      headers: {
        Cookie: cookieHeader,
        'x-csrf-token': csrf,
        Accept: 'application/json',
      },
    });
    const text = await r.text();
    console.log('users/authenticated status:', r.status, 'body:', text.slice(0, 200));
    if (r.ok) {
      const d = JSON.parse(text);
      userId = d.id;
      username = d.name;
      displayName = d.displayName || d.name;
    }
  } catch (e) {
    console.error('users/authenticated failed:', e.message);
  }

  // ── Fallback: profile redirect ─────────────────────────────────────────────
  if (!userId) {
    try {
      const r = await fetch('https://www.roblox.com/my/profile', {
        headers: { Cookie: cookieHeader, 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow',
      });
      const m = r.url.match(/\/users\/(\d+)\//);
      if (m) {
        userId = m[1];
        const r2 = await fetch(`https://users.roblox.com/v1/users/${userId}`, {
          headers: { Accept: 'application/json' },
        });
        if (r2.ok) {
          const d = await r2.json();
          username = d.name;
          displayName = d.displayName || d.name;
        }
      }
    } catch (e) {
      console.error('profile fallback failed:', e.message);
    }
  }

  if (!userId || !username) {
    return res.status(401).json({
      error: 'invalid or expired cookie — copy the full value from your browser',
    });
  }

  // ── Step 3: Avatar ─────────────────────────────────────────────────────────
  let avatarUrl = null;
  try {
    const r = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`,
      { headers: { Accept: 'application/json' } }
    );
    if (r.ok) {
      const d = await r.json();
      avatarUrl = d?.data?.[0]?.imageUrl ?? null;
    }
  } catch {}

  return res.status(200).json({ userId: String(userId), username, displayName, avatarUrl });
}
