// api/upload.js — Node.js runtime (edge blocks roblox.com fetches)
// Proxies audio upload to Roblox. Cookie is used only for this request, never stored.

export const config = {
  api: { bodyParser: false }, // we handle multipart manually
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  // Read the raw body so we can forward it as-is to Roblox
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);

  // Extract cookie from the multipart form manually
  // (we need it for headers but must pass the rest to Roblox)
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) return res.status(400).json({ error: 'missing boundary' });

  const boundary = boundaryMatch[1];
  const bodyStr = rawBody.toString('binary');

  // Extract cookie field value
  const cookieMatch = bodyStr.match(/name="cookie"\r\n\r\n([^\r\n]+)/);
  if (!cookieMatch) return res.status(400).json({ error: 'missing cookie field' });

  const rawCookie = cookieMatch[1].trim();
  const cookieVal = rawCookie.startsWith('.ROBLOSECURITY=')
    ? rawCookie.slice('.ROBLOSECURITY='.length)
    : rawCookie;
  const cookieHeader = `.ROBLOSECURITY=${cookieVal}`;

  // ── Step 1: CSRF token ─────────────────────────────────────────────────────
  let csrf = '';
  try {
    const r = await fetch('https://auth.roblox.com/v2/logout', {
      method: 'POST',
      headers: { Cookie: cookieHeader, 'Content-Length': '0' },
    });
    csrf = r.headers.get('x-csrf-token') || '';
  } catch (e) {
    console.error('csrf error:', e.message);
  }

  // ── Step 2: extract audio blob + metadata from form ────────────────────────
  // Re-parse the multipart to get individual fields
  let audioBuffer = null, fileName = 'audio.mp3', description = 'orlobx bypasser';

  try {
    const parts = rawBody.toString('binary').split(`--${boundary}`);
    for (const part of parts) {
      if (part.includes('name="fileName"')) {
        const m = part.match(/\r\n\r\n([^\r\n]+)/);
        if (m) fileName = m[1].trim();
      }
      if (part.includes('name="description"')) {
        const m = part.match(/\r\n\r\n([^\r\n]+)/);
        if (m) description = m[1].trim();
      }
      if (part.includes('name="audio"')) {
        // Audio is binary — find the data after the double CRLF
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          const dataPart = part.slice(headerEnd + 4, part.lastIndexOf('\r\n'));
          audioBuffer = Buffer.from(dataPart, 'binary');
        }
      }
    }
  } catch (e) {
    return res.status(400).json({ error: 'failed to parse form: ' + e.message });
  }

  if (!audioBuffer || audioBuffer.length < 100) {
    return res.status(400).json({ error: 'no audio data found in request' });
  }

  // ── Step 3: upload to Roblox ───────────────────────────────────────────────
  const uploadForm = new FormData();
  uploadForm.append('request', JSON.stringify({
    displayName: fileName.replace(/\.[^.]+$/, ''),
    description,
    assetType: 'Audio',
    creationContext: { creator: { userId: 0 } },
  }));
  uploadForm.append(
    'fileContent',
    new Blob([audioBuffer], { type: 'audio/mpeg' }),
    fileName
  );

  let operationId = null, assetId = null;
  try {
    const r = await fetch('https://apis.roblox.com/assets/v1/assets', {
      method: 'POST',
      headers: { Cookie: cookieHeader, 'x-csrf-token': csrf },
      body: uploadForm,
    });
    const text = await r.text();
    console.log('upload status:', r.status, text.slice(0, 300));
    if (!r.ok) return res.status(502).json({ error: `roblox upload failed (${r.status}): ${text}` });
    const d = JSON.parse(text);
    operationId = d.operationId || null;
    assetId = d.assetId || null;
  } catch (e) {
    return res.status(502).json({ error: 'upload request failed: ' + e.message });
  }

  // ── Step 4: poll operation if needed ──────────────────────────────────────
  if (!assetId && operationId) {
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1500));
      try {
        const r = await fetch(
          `https://apis.roblox.com/assets/v1/operations/${operationId}`,
          { headers: { Cookie: cookieHeader, 'x-csrf-token': csrf } }
        );
        if (r.ok) {
          const d = await r.json();
          if (d.done && d.response?.assetId) { assetId = d.response.assetId; break; }
          if (d.error) return res.status(502).json({ error: d.error.message });
        }
      } catch {}
    }
  }

  if (!assetId) return res.status(504).json({ error: 'timed out waiting for roblox to process audio' });
  return res.status(200).json({ assetId: String(assetId) });
}
