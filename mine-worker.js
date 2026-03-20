// ═══════════════════════════════════════════════════════════════
// MINE-WORKER.JS — WEBWORKER SHA-256 MINER
//
// Läuft in eigenem Thread (kein UI-Block).
// Empfängt Zone-Hint vom Hauptthread.
// Sucht SHA-256d Near-Misses in der angewiesenen Zone.
// Schickt Batches zurück.
// ═══════════════════════════════════════════════════════════════

// ── SHA-256 Implementation ────────────────────────────────────
function sha256(data) {
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];

  if (typeof data === 'string') {
    const enc = new TextEncoder();
    data = enc.encode(data);
  }

  const msg = new Uint8Array(data);
  const len = msg.length;
  const bitLen = len * 8;

  // Padding
  const padLen = ((len + 9 + 63) & ~63);
  const padded = new Uint8Array(padLen);
  padded.set(msg);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 4, bitLen, false);

  let h0=0x6a09e667, h1=0xbb67ae85, h2=0x3c6ef372, h3=0xa54ff53a;
  let h4=0x510e527f, h5=0x9b05688c, h6=0x1f83d9ab, h7=0x5be0cd19;

  for (let i = 0; i < padLen; i += 64) {
    const w = new Uint32Array(64);
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j-15],7) ^ rotr(w[j-15],18) ^ (w[j-15] >>> 3);
      const s1 = rotr(w[j-2],17) ^ rotr(w[j-2],19)  ^ (w[j-2]  >>> 10);
      w[j] = (w[j-16] + s0 + w[j-7] + s1) | 0;
    }

    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;

    for (let j = 0; j < 64; j++) {
      const S1  = rotr(e,6)  ^ rotr(e,11) ^ rotr(e,25);
      const ch  = (e & f)    ^ (~e & g);
      const tmp1 = (h + S1 + ch + K[j] + w[j]) | 0;
      const S0  = rotr(a,2)  ^ rotr(a,13) ^ rotr(a,22);
      const maj = (a & b)    ^ (a & c)    ^ (b & c);
      const tmp2 = (S0 + maj) | 0;
      h=g; g=f; f=e; e=(d+tmp1)|0;
      d=c; c=b; b=a; a=(tmp1+tmp2)|0;
    }

    h0=(h0+a)|0; h1=(h1+b)|0; h2=(h2+c)|0; h3=(h3+d)|0;
    h4=(h4+e)|0; h5=(h5+f)|0; h6=(h6+g)|0; h7=(h7+h)|0;
  }

  const out = new Uint8Array(32);
  const ov  = new DataView(out.buffer);
  [h0,h1,h2,h3,h4,h5,h6,h7].forEach((v,i) => ov.setUint32(i*4, v, false));
  return out;
}

function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

function sha256d(data) { return sha256(sha256(data)); }

function toHex(buf) {
  return Array.from(buf).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Mining State ──────────────────────────────────────────────
let mining     = false;
let zoneMin    = 0x00000000;
let zoneMax    = 0x0FFFFFFF;
let target     = '00000fffff';          // Simulated target (16 leading zeros ≈ near-miss level)
let hashCount  = 0;
let nearMisses = 0;
let startTime  = 0;

// Bitcoin-like block header (simplified for pattern search)
// Real mining would use actual stratum job data
let blockHeader = new Uint8Array(76);  // 80 bytes - 4 bytes nonce

function buildHeader() {
  // Simulated: version=1, prevhash=zeros, merkle=zeros, time=now, bits=0x1d00ffff
  const dv = new DataView(blockHeader.buffer);
  dv.setUint32(0,  1,          true);   // version
  // prevhash: bytes 4-35 (zeros for simulation)
  // merkle:   bytes 36-67 (zeros)
  dv.setUint32(68, Math.floor(Date.now() / 1000), true); // time
  dv.setUint32(72, 0x1d00ffff, true);   // bits
}

function tryNonce(nonce) {
  const full = new Uint8Array(80);
  full.set(blockHeader);
  const dv = new DataView(full.buffer);
  dv.setUint32(76, nonce, true);

  const hash = sha256d(full);
  const hex  = toHex(hash);

  // Count leading zeros
  let zeros = 0;
  for (const c of hex) {
    if (c === '0') zeros++;
    else break;
  }

  return { nonce, hex, zeros };
}

// ── Main Mining Loop ──────────────────────────────────────────
function mineChunk() {
  if (!mining) return;

  const CHUNK = 500;   // hashes per chunk (keeps UI responsive)
  let bestZeros = 0;
  let bestResult = null;
  const chunkNearMisses = [];

  for (let i = 0; i < CHUNK; i++) {
    const nonce = zoneMin + Math.floor(Math.random() * (zoneMax - zoneMin));
    const res   = tryNonce(nonce);

    hashCount++;

    if (res.zeros >= 5) {   // Near-Miss: 5+ leading zeros
      nearMisses++;
      chunkNearMisses.push({
        nonce:    res.nonce.toString(16).padStart(8, '0'),
        hash:     res.hex.substring(0, 16) + '...',
        zeros:    res.zeros,
        zone:     Math.floor(res.nonce / Math.floor(0xFFFFFFFF / 16)),
      });

      if (res.zeros > bestZeros) {
        bestZeros  = res.zeros;
        bestResult = res;
      }
    }
  }

  // Hashrate
  const elapsed = (Date.now() - startTime) / 1000;
  const hps     = Math.round(hashCount / elapsed);

  // Report to main thread
  postMessage({
    type:      'stats',
    hps,
    hashCount,
    nearMisses,
    elapsed:   Math.round(elapsed),
    zone:      [zoneMin, zoneMax].map(n => '0x' + n.toString(16).padStart(8,'0')),
  });

  // Send near-misses as batch
  if (chunkNearMisses.length > 0) {
    postMessage({
      type:      'near_miss',
      items:     chunkNearMisses,
      bestZeros,
      timestamp: Date.now(),
    });
  }

  // Continue
  setTimeout(mineChunk, 0);
}

// ── Message Handler ───────────────────────────────────────────
self.onmessage = (e) => {
  const { cmd, zoneHint } = e.data;

  if (cmd === 'start') {
    mining    = true;
    hashCount = 0;
    nearMisses = 0;
    startTime  = Date.now();
    buildHeader();

    if (zoneHint) {
      zoneMin = zoneHint.min;
      zoneMax = zoneHint.max;
    }

    postMessage({ type: 'started', zone: [zoneMin, zoneMax] });
    mineChunk();
  }

  if (cmd === 'stop') {
    mining = false;
    postMessage({ type: 'stopped' });
  }

  if (cmd === 'zone') {
    // Update zone hint from Cosmos
    if (e.data.min !== undefined) zoneMin = e.data.min;
    if (e.data.max !== undefined) zoneMax = e.data.max;
    postMessage({ type: 'zone_updated', zone: [zoneMin, zoneMax] });
  }
};
