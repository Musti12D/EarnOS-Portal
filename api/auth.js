// Vercel Serverless Function — /api/auth
// Service Key bleibt hier, Browser sieht ihn nie.
// Actions: register, login, me

const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const crypto = require('crypto');
function hash(pw, salt) {
  return crypto.createHash('sha256').update(pw + salt).digest('hex');
}
function token() { return crypto.randomBytes(32).toString('hex'); }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { action } = req.query;

  // ── REGISTER ──────────────────────────────────────────────
  if (action === 'register' && req.method === 'POST') {
    const { email, password } = req.body || {};
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: 'Email + min 6 Zeichen' });
    }

    // Check existing
    const { data: existing } = await sb
      .from('earnos_users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existing) return res.status(409).json({ error: 'Email bereits registriert' });

    const salt    = crypto.randomBytes(16).toString('hex');
    const pw_hash = hash(password, salt);
    const tok     = token();

    const { data, error } = await sb
      .from('earnos_users')
      .insert({ email, pw_hash, salt, token: tok, synergy: 0, batches: 0 })
      .select('id, email, synergy')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ ok: true, token: tok, userId: data.id, email: data.email, synergy: 0 });
  }

  // ── LOGIN ─────────────────────────────────────────────────
  if (action === 'login' && req.method === 'POST') {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email + Passwort' });

    const { data: u } = await sb
      .from('earnos_users')
      .select('id, email, pw_hash, salt, synergy, token')
      .eq('email', email)
      .maybeSingle();

    if (!u || u.pw_hash !== hash(password, u.salt)) {
      return res.status(401).json({ error: 'Email oder Passwort falsch' });
    }

    // Neuer Token bei jedem Login
    const tok = token();
    await sb.from('earnos_users').update({ token: tok }).eq('id', u.id);

    return res.status(200).json({ ok: true, token: tok, userId: u.id, email: u.email, synergy: u.synergy || 0 });
  }

  // ── ME (Token prüfen) ────────────────────────────────────
  if (action === 'me' && req.method === 'GET') {
    const tok = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    if (!tok) return res.status(401).json({ error: 'Kein Token' });

    const { data: u } = await sb
      .from('earnos_users')
      .select('id, email, synergy, batches')
      .eq('token', tok)
      .maybeSingle();

    if (!u) return res.status(401).json({ error: 'Ungültiger Token' });

    return res.status(200).json({ ok: true, userId: u.id, email: u.email, synergy: u.synergy || 0, batches: u.batches || 0 });
  }

  // ── SYNERGY UPDATE (nach Batch) ──────────────────────────
  if (action === 'reward' && req.method === 'POST') {
    const tok = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
    const { reward } = req.body || {};
    if (!tok) return res.status(401).json({ error: 'Kein Token' });

    const { data: u } = await sb
      .from('earnos_users')
      .select('id, synergy, batches')
      .eq('token', tok)
      .maybeSingle();

    if (!u) return res.status(401).json({ error: 'Ungültiger Token' });

    const newSyn = (u.synergy || 0) + (reward || 0);
    await sb.from('earnos_users').update({
      synergy: newSyn,
      batches: (u.batches || 0) + 1,
    }).eq('id', u.id);

    return res.status(200).json({ ok: true, synergy: newSyn });
  }

  res.status(404).json({ error: 'Unknown action' });
};
