// Login: Cloudflare Access sits in front of the whole site and only lets your email in.
// Every API call also verifies the Access token (signature, audience, expiry, issuer) here, so
// the API stays closed even if the Access application were removed by mistake (fail closed).

import { HttpError } from './db.js';

let jwks = { url: '', keys: [], at: 0 };

const b64urlToBytes = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function getKeys(team, force = false) {
  const url = `https://${team}/cdn-cgi/access/certs`;
  if (!force && jwks.url === url && Date.now() - jwks.at < 3600_000 && jwks.keys.length) return jwks.keys;
  const res = await fetch(url);
  if (!res.ok) throw new HttpError(502, 'Could not fetch Cloudflare Access keys');
  const body = await res.json();
  jwks = { url, keys: body.keys || [], at: Date.now() };
  return jwks.keys;
}

function cookie(request, name) {
  const c = request.headers.get('Cookie') || '';
  const m = c.split(/;\s*/).find((x) => x.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

export async function requireUser(request, env) {
  if (env.DEV_AUTH_BYPASS === '1') {
    const host = new URL(request.url).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return { email: 'local-dev', dev: true };
    throw new HttpError(500, 'DEV_AUTH_BYPASS only works on localhost. Remove it from the deployed settings.');
  }
  const team = (env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const aud = env.ACCESS_AUD;
  if (!team || !aud) throw new HttpError(500, 'Login is not configured: set ACCESS_TEAM_DOMAIN and ACCESS_AUD (see README).');

  const token = request.headers.get('Cf-Access-Jwt-Assertion') || cookie(request, 'CF_Authorization');
  if (!token) throw new HttpError(401, 'Not signed in');
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Bad sign-in token');
  const header = b64urlJson(parts[0]);
  const payload = b64urlJson(parts[1]);
  if (header.alg !== 'RS256') throw new HttpError(401, 'Bad sign-in token');

  let keys = await getKeys(team);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) { keys = await getKeys(team, true); jwk = keys.find((k) => k.kid === header.kid); }
  if (!jwk) throw new HttpError(401, 'Unknown signing key');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new HttpError(401, 'Bad sign-in signature');

  const now = Math.floor(Date.now() / 1000);
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new HttpError(401, 'Sign-in token is for another application');
  if (payload.exp && payload.exp < now - 30) throw new HttpError(401, 'Sign-in expired');
  if (payload.iss && payload.iss !== `https://${team}`) throw new HttpError(401, 'Sign-in token from another team');

  const email = (payload.email || '').toLowerCase();
  const allowed = (env.ALLOWED_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(email)) throw new HttpError(403, 'This email is not allowed');
  return { email };
}
