const COOKIE = '__Host-sponsorscout';
const DAY = 86400000;
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(bytes)).map(n => n.toString(16).padStart(2, '0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async (s: string) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(s)));
export async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256));
}
export function validPassword(value: unknown): value is string { return typeof value === 'string' && value.length >= 6 && value.length <= 128 && /[a-z]/i.test(value) && /[0-9]/.test(value); }
function equal(a: string, b: string) { let diff = a.length ^ b.length; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0); return diff === 0; }
function json(data: unknown, status = 200, cookie?: string) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(cookie ? { 'Set-Cookie': cookie } : {}) } }); }
const cookie = (token: string, age = 604800) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
type Account = { id: string; username: string; email: string; name: string; password_hash: string; salt: string; recovery_hash: string; profile: string; decisions: string };
const publicAccount = (a: Account) => ({ id: a.id, username: a.username, email: a.email, name: a.name, profile: JSON.parse(a.profile), decisions: JSON.parse(a.decisions) });
async function session(request: Request, db: D1Database) {
  const token = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare('SELECT a.* FROM accounts a JOIN account_sessions s ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?').bind(await digest(token), Date.now()).first<Account>();
}
async function newSession(db: D1Database, id: string) {
  const token = random();
  await db.prepare('INSERT INTO account_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)').bind(await digest(token), id, Date.now() + 7 * DAY).run();
  return cookie(token);
}
async function limit(db: D1Database, key: string, max: number) {
  const bucket = Math.floor(Date.now() / 900000);
  const row = await db.prepare('INSERT INTO account_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(await digest(`${key}:${bucket}`), (bucket + 1) * 900000).first<{count:number}>();
  if (row && row.count > max) fail('Too many attempts. Please try again in 15 minutes.', 429);
}
export function cleanProfile(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid profile.');
  const data = input as Record<string, unknown>; const result: Record<string,string> = {};
  for (const [key, max] of Object.entries({ name: 100, headline: 240, experienceYears: 2, targetTitles: 1000, skills: 2000, locations: 500, sponsorship: 20, resumeHighlights: 12000 })) {
    if (typeof data[key] !== 'string' || (data[key] as string).length > max) fail(`Please check ${key} (maximum ${max} characters).`);
    result[key] = (data[key] as string).trim();
  }
  if (!['needed','not-needed','unsure'].includes(result.sponsorship)) fail('Choose a sponsorship preference.');
  if (result.experienceYears && !/^\d{1,2}$/.test(result.experienceYears)) fail('Experience must be a number from 0 to 99.');
  return result;
}
async function readBody(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json')) fail('JSON required.',415);
  const reader = request.body?.getReader(); if (!reader) fail('Request body required.');
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) { const {done,value} = await reader.read(); if (done) break; length += value.length; if (length > 40000) { await reader.cancel(); fail('Request is too large.',413); } chunks.push(value); }
  const buffer = new Uint8Array(length); let offset = 0; for(const chunk of chunks) {buffer.set(chunk,offset);offset+=chunk.length;}
  try { return JSON.parse(new TextDecoder().decode(buffer)); } catch { fail('Invalid request.'); }
}
export async function handleAccounts(request: Request, db: D1Database): Promise<Response> {
  try {
    if (!db) fail('Account service is temporarily unavailable.',503);
    const action = new URL(request.url).pathname.slice('/api/account/'.length);
    if (request.method === 'GET' && action === 'me') { const a = await session(request, db); return json({ account: a ? publicAccount(a) : null }); }
    if (request.method !== 'POST') return json({error:'Method not allowed.'},405);
    if (request.headers.get('origin') !== new URL(request.url).origin) fail('Please reload the page and try again.',403);
    const body = await readBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Invalid request.');
    await limit(db, `ip:${request.headers.get('cf-connecting-ip') || 'unknown'}`, 100);
    if (['register','login','username','reset'].includes(action)) {
      await limit(db, `auth-ip:${request.headers.get('cf-connecting-ip') || 'unknown'}`, 30);
      const identifier = String(body.username || body.email || '').trim().toLowerCase().slice(0,254);
      await limit(db, `auth-identity:${identifier}`, 12);
      // Bounded cleanup keeps expired sessions and rate buckets out of active storage.
      await db.batch([db.prepare('DELETE FROM account_sessions WHERE token_hash IN (SELECT token_hash FROM account_sessions WHERE expires_at<? LIMIT 100)').bind(Date.now()), db.prepare('DELETE FROM account_limits WHERE key IN (SELECT key FROM account_limits WHERE expires_at<? LIMIT 100)').bind(Date.now())]);
    }
    if (action === 'register') {
      const username = String(body.username || '').trim().toLowerCase(); const email = String(body.email || '').trim().toLowerCase(); const name = String(body.name || '').trim();
      if (!/^[a-z0-9_]{3,30}$/.test(username)) fail('Username must be 3–30 letters, numbers, or underscores.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || !name || name.length>100) fail('Enter your name and a valid email address.');
      if (!validPassword(body.password)) fail('Password needs at least 6 characters, including a letter and a number (maximum 128).');
      const id = crypto.randomUUID(), salt = random(), recoveryCode = random();
      const hash = await passwordHash(body.password, salt);
      try { await db.prepare('INSERT INTO accounts(id,username,email,name,password_hash,salt,recovery_hash,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id, username, email, name, hash, salt, await digest(recoveryCode), Date.now()).run(); }
      catch (error) { if (/unique/i.test(String(error))) fail('An account already uses that username or email. Try signing in or account recovery.',409); throw error; }
      const a = await db.prepare('SELECT * FROM accounts WHERE id=?').bind(id).first<Account>();
      return json({account:publicAccount(a!),recoveryCode},201,await newSession(db,id));
    }
    if (action === 'login') {
      const username = String(body.username || '').trim().toLowerCase();
      const a = await db.prepare('SELECT * FROM accounts WHERE username=?').bind(username).first<Account>();
      const hash = await passwordHash(typeof body.password === 'string' ? body.password.slice(0,129) : '', a?.salt || 'invalid-account-salt');
      if (!a || !equal(a.password_hash,hash)) fail('Username or password is incorrect.',401);
      return json({account:publicAccount(a)},200,await newSession(db,a.id));
    }
    if (action === 'username' || action === 'reset') {
      const email = String(body.email || '').trim().toLowerCase();
      const a = await db.prepare('SELECT * FROM accounts WHERE email=?').bind(email).first<Account>();
      const recovery = String(body.recoveryCode || '').trim().toLowerCase();
      const hash = await digest(recovery);
      if (!a || !/^[a-f0-9]{64}$/.test(recovery) || !equal(a.recovery_hash,hash)) fail('Email or recovery code is incorrect.',401);
      if (action === 'username') return json({username:a.username});
      if (!validPassword(body.password)) fail('Password needs at least 6 characters, including a letter and a number (maximum 128).');
      const salt = random(), recoveryCode = random(); const nextHash = await passwordHash(body.password,salt);
      // Match the old hash in the update so a recovery code cannot be reused concurrently.
      const result = await db.prepare('UPDATE accounts SET password_hash=?,salt=?,recovery_hash=? WHERE id=? AND recovery_hash=?').bind(nextHash,salt,await digest(recoveryCode),a.id,hash).run();
      if (!result.meta.changes) fail('This recovery code has already been used.',401);
      await db.prepare('DELETE FROM account_sessions WHERE account_id=?').bind(a.id).run();
      return json({username:a.username,recoveryCode},200,cookie('',0));
    }
    const a = await session(request,db); if (!a) fail('Please sign in to continue.',401);
    if (action === 'logout') {
      const token = (request.headers.get('cookie') || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1) || '';
      await db.prepare('DELETE FROM account_sessions WHERE token_hash=?').bind(await digest(token)).run();
      return json({ok:true},200,cookie('',0));
    }
    if (action === 'profile') {
      const profile = cleanProfile(body.profile);
      await db.prepare('UPDATE accounts SET profile=? WHERE id=?').bind(JSON.stringify(profile),a.id).run();
      return json({ok:true,profile});
    }
    if (action === 'clear-profile') { await db.prepare("UPDATE accounts SET profile='{}' WHERE id=?").bind(a.id).run(); return json({ok:true}); }
    if (action === 'decision') {
      const id = String(body.id || ''); const value = body.value;
      if (!id || id.length>500 || !['saved','skipped','applied'].includes(value) || ['__proto__','constructor','prototype'].includes(id)) fail('Invalid job selection.');
      // Each job update is atomic; other tabs cannot overwrite the account's queue.
      await db.prepare('UPDATE accounts SET decisions=json_set(decisions,?,?) WHERE id=?').bind(`$.${JSON.stringify(id)}`,value,a.id).run();
      return json({ok:true});
    }
    return json({error:'Not found.'},404);
  } catch (error) { const e = error as Error & {status?:number}; return json({error:e.status ? e.message : 'Account service is temporarily unavailable. Please try again.'},e.status || 500); }
}
