# orlobx audio bypasser

A Roblox audio bypasser that processes audio in-browser and optionally auto-uploads to Roblox.

## How to deploy to Vercel

1. Push this entire folder to a GitHub repo
2. Go to vercel.com → New Project → import your repo
3. No build settings needed — just deploy
4. Your site will be live at `your-project.vercel.app`

## Project structure

```
orlobx/
├── vercel.json          # routing config
├── api/
│   └── upload.js        # serverless function — proxies Roblox API upload
└── public/
    └── index.html       # full frontend app
```

## How the bypass works

1. Audio is decoded in-browser via Web Audio API
2. Sped up AND pitched up by the bypass ratio (default ×2.5) using OfflineAudioContext
3. +10 dB gain applied to compensate for Roblox's compression (matches your .rbxm EQ settings)
4. Normalized and encoded as WAV
5. If a cookie is saved, the file is sent to `/api/upload` (your own Vercel function)
   which proxies the upload to Roblox's asset API and returns the asset ID

## Cookie security

- The cookie is stored in localStorage (your browser only)
- It is sent only to `/api/upload` on YOUR OWN Vercel deployment
- The Vercel function never logs or stores the cookie
- Never share your .ROBLOSECURITY cookie with anyone
