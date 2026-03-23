// api/upload.js
// Proxies audio upload to Roblox so the browser avoids CORS issues.
// The cookie is sent from the client and used only for this request — 
// it is never logged, stored, or forwarded anywhere else.

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: cors()
    });
  }

  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }

  let cookie, audioBuffer, fileName, description;

  try {
    const form = await req.formData();
    cookie      = form.get('cookie')?.toString()?.trim();
    audioBuffer = form.get('audio');       // File blob
    fileName    = form.get('fileName')?.toString() || 'bypassed_audio';
    description = form.get('description')?.toString() || 'orlobx bypasser';
  } catch (e) {
    return json({ error: 'invalid form data' }, 400);
  }

  if (!cookie || !audioBuffer) {
    return json({ error: 'missing cookie or audio' }, 400);
  }

  // Normalise cookie — accept full string or just the value
  const cookieHeader = cookie.startsWith('.ROBLOSECURITY=')
    ? cookie
    : `.ROBLOSECURITY=${cookie}`;

  // ── Step 1: get CSRF token ──────────────────────────────────────────────
  let csrfToken;
  try {
    const probe = await fetch('https://auth.roblox.com/v2/logout', {
      method: 'POST',
      headers: { Cookie: cookieHeader }
    });
    csrfToken = probe.headers.get('x-csrf-token');
    if (!csrfToken) throw new Error('no csrf token returned');
  } catch (e) {
    return json({ error: `csrf fetch failed: ${e.message}` }, 502);
  }

  // ── Step 2: upload audio ────────────────────────────────────────────────
  // Roblox asset upload endpoint
  const audioBytes = await audioBuffer.arrayBuffer();
  const uploadForm = new FormData();
  uploadForm.append('request', JSON.stringify({
    displayName:  fileName.replace(/\.[^.]+$/, ''),
    description:  description,
    assetType:    'Audio',
    creationContext: { creator: { userId: 0 } }  // 0 = authenticated user
  }));
  uploadForm.append('fileContent', new Blob([audioBytes], { type: 'audio/wav' }), fileName);

  let assetId, assetOperationId;
  try {
    const up = await fetch('https://apis.roblox.com/assets/v1/assets', {
      method: 'POST',
      headers: {
        Cookie:         cookieHeader,
        'x-csrf-token': csrfToken,
      },
      body: uploadForm
    });

    const text = await up.text();
    let upJson;
    try { upJson = JSON.parse(text); } catch { upJson = {}; }

    if (!up.ok) {
      return json({ error: `roblox upload failed (${up.status}): ${text}` }, 502);
    }

    // New API returns an operation path for async processing
    assetOperationId = upJson.operationId || upJson.assetId || null;
    assetId = upJson.assetId || null;
  } catch (e) {
    return json({ error: `upload request failed: ${e.message}` }, 502);
  }

  // ── Step 3: poll for operation result if needed ─────────────────────────
  if (!assetId && assetOperationId) {
    for (let i = 0; i < 20; i++) {
      await sleep(1500);
      try {
        const poll = await fetch(
          `https://apis.roblox.com/assets/v1/operations/${assetOperationId}`,
          { headers: { Cookie: cookieHeader, 'x-csrf-token': csrfToken } }
        );
        const pj = await poll.json();
        if (pj.done && pj.response?.assetId) {
          assetId = pj.response.assetId;
          break;
        }
        if (pj.error) {
          return json({ error: `operation error: ${pj.error.message}` }, 502);
        }
      } catch (_) {}
    }
  }

  if (!assetId) {
    return json({ error: 'timed out waiting for roblox to process the audio' }, 504);
  }

  return json({ assetId: String(assetId) }, 200);
}

// ── helpers ────────────────────────────────────────────────────────────────
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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
