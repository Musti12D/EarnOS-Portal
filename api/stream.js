// Vercel Proxy — holt Log-Lines von Hetzner (server→server HTTP)
// Browser ruft /api/stream auf (HTTPS) → kein Mixed Content

const https = require('https');
const http  = require('http');

const HETZNER_LOG = 'http://46.224.239.18:3001/log';
const MAX_LINES   = 60;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const raw = await fetch(HETZNER_LOG).then(r => r.text());
    const lines = raw.split('\n')
      .filter(l => l.trim())
      .filter(l => !l.startsWith('[D:') && !l.startsWith('[B:'))
      .slice(-MAX_LINES);

    const offset = parseInt(req.query.offset || '0');
    const neu    = lines.slice(offset);

    res.status(200).json({ lines: neu, total: lines.length });
  } catch(e) {
    res.status(200).json({ lines: [], total: 0, error: e.message });
  }
};
