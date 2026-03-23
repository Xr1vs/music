// api/userinfo.js
// Given a .ROBLOSECURITY cookie, returns the authenticated user's
// username, display name, user ID, and avatar thumbnail URL.
// The cookie is used only for this request and never stored.

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let cookie;
  try {
    const body = await req.json();
    cookie = body.cookie?.toString()?.trim();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  if (!cookie) return json({ error: 'missing cookie' }, 400);

  const cookieHeader = cookie.startsWith('.ROBLOSECURITY=')
    ? cookie
    : `.ROBLOSECURITY=${cookie}`;

  // Fetch authenticated user info
  let userId, username, displayName;
  try {
    const res = await fetch('https://users.roblox.com/v1/users/authenticated', {
      headers: { Cookie: cookieHeader }
    });
    if (!res.ok) return json({ error: 'invalid cookie or not logged in' }, 401);
    const data = await res.json();
    userId      = data.id;
    username    = data.name;
    displayName = data.displayName;
  } catch (e) {
    return json({ error: `failed to fetch user: ${e.message}` }, 502);
  }

  // Fetch avatar thumbnail
  let avatarUrl = null;
  try {
    const res = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`,
      { headers: { Cookie: cookieHeader } }
    );
    const data = await res.json();
    avatarUrl = data?.data?.[0]?.imageUrl || null;
  } catch { /* avatar is optional */ }

  return json({ userId, username, displayName, avatarUrl }, 200);
}

function cors() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() }
  });
}
