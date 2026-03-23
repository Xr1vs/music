// api/userinfo.js
export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let cookie;
  try {
    const body = await req.json();
    cookie = body.cookie?.toString()?.trim();
  } catch { return json({ error: 'invalid request' }, 400); }

  if (!cookie) return json({ error: 'missing cookie' }, 400);

  // Strip the key name if user pasted the full "key=value" string
  const rawCookie = cookie.startsWith('.ROBLOSECURITY=')
    ? cookie.slice('.ROBLOSECURITY='.length)
    : cookie;

  const cookieHeader = `.ROBLOSECURITY=${rawCookie}`;

  // ── 1. Get CSRF token ──────────────────────────────────────────────────────
  let csrf = '';
  try {
    const r = await fetch('https://auth.roblox.com/v2/logout', {
      method: 'POST',
      headers: { Cookie: cookieHeader, 'Content-Length': '0' }
    });
    csrf = r.headers.get('x-csrf-token') || '';
  } catch {}

  // ── 2. Fetch user identity ─────────────────────────────────────────────────
  let userId = null, username = null, displayName = null;

  // Primary: users API
  try {
    const r = await fetch('https://users.roblox.com/v1/users/authenticated', {
      headers: {
        Cookie: cookieHeader,
        'x-csrf-token': csrf,
        'Accept': 'application/json',
        'User-Agent': 'Roblox/WinInet',
      }
    });
    if (r.ok) {
      const d = await r.json();
      userId = d.id; username = d.name; displayName = d.displayName || d.name;
    }
  } catch {}

  // Fallback: www.roblox.com profile redirect trick
  if (!userId) {
    try {
      const r = await fetch('https://www.roblox.com/my/profile', {
        headers: { Cookie: cookieHeader, 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow'
      });
      const url = r.url; // redirects to /users/{id}/profile
      const m = url.match(/\/users\/(\d+)\//);
      if (m) {
        userId = m[1];
        // Now fetch the username
        const r2 = await fetch(`https://users.roblox.com/v1/users/${userId}`, {
          headers: { 'Accept': 'application/json' }
        });
        if (r2.ok) {
          const d = await r2.json();
          username = d.name; displayName = d.displayName || d.name;
        }
      }
    } catch {}
  }

  if (!userId || !username) {
    return json({
      error: 'could not verify account — make sure your cookie is valid and not expired'
    }, 401);
  }

  // ── 3. Avatar thumbnail ────────────────────────────────────────────────────
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

  return json({ userId: String(userId), username, displayName, avatarUrl });
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...cors() }
  });
}
