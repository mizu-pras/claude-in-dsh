#!/usr/bin/env node
/**
 * claude-oauth-login.mjs
 *
 * Menyiapkan kredensial OAuth provider `anthropic` (pi-ai) di DeepSeek Harness
 * (DSH) memakai LANGGANAN Claude (Pro / Max / Team / Enterprise) — bukan API key
 * dan bukan saldo Claude Console.
 *
 * Alur yang dipakai sama dengan yang dipakai pi-ai di dalam DSH
 * (`@earendil-works/pi-ai` -> auth/oauth/anthropic): OAuth 2.0 + PKCE dengan
 * client id publik Claude Code, lalu menulis SATU record
 * `llm-pi-ai/anthropic` ke `$DSH_HOME/.credentials.yaml`.
 *
 * Setelah record ada, DSH/pi-ai akan memakai access token sebagai Bearer dan
 * menyegarkan otomatis memakai refresh token (refresh berjalan di dalam store
 * kredensial DSH, jadi record ikut diperbarui).
 *
 * Yang TIDAK dilakukan skrip ini:
 *   - tidak mengubah cordis.patch.yml (route dideklarasikan terpisah; lihat
 *     langkah 2 di TUTORIAL-CLAUDE-SUBSCRIPTION.md),
 *   - tidak mencetak token ke layar/log,
 *   - tidak mengirim token ke pihak ketiga mana pun; hanya ke
 *     platform.claude.com (tukar/refresh token) dan api.anthropic.com (verifikasi).
 *
 * Pemakaian:
 *   node claude-oauth-login.mjs                # login browser, simpan, verifikasi
 *   node claude-oauth-login.mjs --copy-code    # login headless: salin kode manual
 *   node claude-oauth-login.mjs --dry-run      # login + tampilkan rencana, TIDAK menulis
 *   node claude-oauth-login.mjs --verify       # tidak login: cek record + request uji
 *   node claude-oauth-login.mjs --from-claude-code  # impor token dari login Claude Code
 *   node claude-oauth-login.mjs --refresh      # segarkan token tersimpan sekarang
 *   node claude-oauth-login.mjs --print-path   # tampilkan lokasi store & record
 *   node claude-oauth-login.mjs --list-models  # model katalog yang dikenal snapshot DSH
 *   node claude-oauth-login.mjs --probe        # uji SEMUA model (katalog + /v1/models)
 *   node claude-oauth-login.mjs --emit-models  # probe, lalu cetak blok YAML models: yang hidup
 *   node claude-oauth-login.mjs --probe --json # hasil probe dalam JSON
 *   node claude-oauth-login.mjs --self-test    # uji penulis record (tanpa jaringan)
 *
 * Flag lain:
 *   --no-browser        jangan coba membuka browser otomatis
 *   --no-verify         lewati request verifikasi setelah menyimpan
 *   --dsh-home <dir>    override DSH_HOME (default: env DSH_HOME atau ~/.dsh)
 *   --model <id>        model untuk verifikasi (default: claude-haiku-4-5)
 *   --port <n>          port callback loopback (default 53692, fallback otomatis)
 *   --timeout <detik>   batas tunggu login browser (default 900)
 *   --help
 *
 * Node >= 18 (fetch & webcrypto bawaan). Tanpa dependensi.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

/* ------------------------------------------------------------------ */
/*  Konstanta protokol (sama dengan pi-ai)                             */
/* ------------------------------------------------------------------ */

// Client id publik Claude Code (pi-ai menyimpannya sebagai base64 yang sama).
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const API_URL = 'https://api.anthropic.com/v1/messages';
const COPY_CODE_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
const SCOPES = [
  'org:create_api_key',
  'user:profile',
  'user:inference',
  'user:sessions:claude_code',
  'user:mcp_servers',
  'user:file_upload',
].join(' ');
const CALLBACK_HOST = '127.0.0.1';
const CALLBACK_PATH = '/callback';
const DEFAULT_PORT = 53692;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
// Versi yang dilaporkan pi-ai pada user-agent OAuth.
const CLAUDE_CLI_VERSION = '2.1.280';
const ANTHROPIC_VERSION = '2023-06-01';
const OAUTH_BETAS = ['claude-code-20250219', 'oauth-2025-04-20'];

const RECORD_KEY = 'llm-pi-ai/anthropic';
const RECORD_SCOPE_DIR = 'llm-pi-ai';

// Snapshot katalog pi-ai yang dibundel DSH 0.2.2-rc.1 (model chat anthropic).
const KNOWN_MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5'],
  ['claude-opus-5', 'Claude Opus 5'],
  ['claude-sonnet-5', 'Claude Sonnet 5'],
  ['claude-fable-5-1', 'Claude Fable 5.1'],
  ['claude-fable-5', 'Claude Fable 5'],
  ['claude-opus-4-8', 'Claude Opus 4.8'],
  ['claude-opus-4-7', 'Claude Opus 4.7'],
  ['claude-opus-4-6', 'Claude Opus 4.6'],
  ['claude-opus-4-5', 'Claude Opus 4.5 (latest)'],
  ['claude-sonnet-4-6', 'Claude Sonnet 4.6'],
  ['claude-sonnet-4-5', 'Claude Sonnet 4.5 (latest)'],
  ['claude-haiku-4-5', 'Claude Haiku 4.5 (latest)'],
];

// Kapasitas katalog pi-ai untuk setiap id di atas; dipakai saat menulis blok
// `models:` hasil probe. Nilai ini aman: batas lebih rendah selalu diterima API.
const MODEL_META = {
  'claude-fable-5': { name: 'Claude Fable 5', contextWindow: 1000000, maxTokens: 128000 },
  'claude-fable-5-1': { name: 'Claude Fable 5.1', contextWindow: 1000000, maxTokens: 128000 },
  'claude-opus-5-5': { name: 'Claude Opus 5.5', contextWindow: 1000000, maxTokens: 128000 },
  'claude-opus-5': { name: 'Claude Opus 5', contextWindow: 1000000, maxTokens: 128000 },
  'claude-sonnet-5-5': { name: 'Claude Sonnet 5.5', contextWindow: 1000000, maxTokens: 128000 },
  'claude-sonnet-5': { name: 'Claude Sonnet 5', contextWindow: 1000000, maxTokens: 128000 },
  'claude-haiku-5-5': { name: 'Claude Haiku 5.5', contextWindow: 1000000, maxTokens: 128000 },
  'claude-opus-4-8': { name: 'Claude Opus 4.8', contextWindow: 1000000, maxTokens: 128000 },
  'claude-opus-4-7': { name: 'Claude Opus 4.7', contextWindow: 1000000, maxTokens: 128000 },
  'claude-opus-4-6': { name: 'Claude Opus 4.6', contextWindow: 1000000, maxTokens: 128000 },
  'claude-opus-4-5': { name: 'Claude Opus 4.5 (latest)', contextWindow: 200000, maxTokens: 64000 },
  'claude-opus-4-5-20251101': { name: 'Claude Opus 4.5', contextWindow: 200000, maxTokens: 64000 },
  'claude-sonnet-4-6': { name: 'Claude Sonnet 4.6', contextWindow: 1000000, maxTokens: 128000 },
  'claude-sonnet-4-5': { name: 'Claude Sonnet 4.5 (latest)', contextWindow: 200000, maxTokens: 64000 },
  'claude-sonnet-4-5-20250929': { name: 'Claude Sonnet 4.5', contextWindow: 200000, maxTokens: 64000 },
  'claude-haiku-4-5': { name: 'Claude Haiku 4.5 (latest)', contextWindow: 200000, maxTokens: 64000 },
  'claude-haiku-4-5-20251001': { name: 'Claude Haiku 4.5', contextWindow: 200000, maxTokens: 64000 },
};


/* ------------------------------------------------------------------ */
/*  Argumen                                                            */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const HELP = has('--help') || has('-h');
const DRY_RUN = has('--dry-run');
const VERIFY_ONLY = has('--verify');
const FROM_CLAUDE_CODE = has('--from-claude-code');
const REFRESH_ONLY = has('--refresh');
const PRINT_PATH = has('--print-path');
const LIST_MODELS = has('--list-models');
const PROBE = has('--probe');
const EMIT_MODELS = has('--emit-models');
const PROBE_JSON = has('--json');
const SELF_TEST = has('--self-test');
const NO_BROWSER = has('--no-browser');
const NO_VERIFY = has('--no-verify');
const COPY_CODE = has('--copy-code');
const DSH_HOME = opt('--dsh-home') ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
const CREDENTIALS_FILE = path.join(DSH_HOME, '.credentials.yaml');
const VERIFY_MODEL = opt('--model') ?? process.env.CLAUDE_TEST_MODEL ?? 'claude-haiku-4-5';
const CALLBACK_PORT = Number(opt('--port') ?? DEFAULT_PORT) || DEFAULT_PORT;
const LOGIN_TIMEOUT_MS = Math.max(30, Number(opt('--timeout') ?? 900) || 900) * 1000;

/* ------------------------------------------------------------------ */
/*  Utilitas                                                           */
/* ------------------------------------------------------------------ */

function log(message = '') {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`\n✗ ${message}\n`);
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generatePkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function mask(token) {
  if (typeof token !== 'string' || token.length === 0) return '(kosong)';
  return `${token.slice(0, 12)}…(${token.length} karakter)`;
}

async function postJson(url, body, timeoutMs = 30_000) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { ok: response.ok, status: response.status, text, json };
}

function openBrowser(url) {
  if (NO_BROWSER) return;
  try {
    const platform = process.platform;
    if (platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else if (platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* biarkan pengguna membuka URL manual */
  }
}

function buildAuthorizeUrl(redirectUri, challenge, verifier) {
  const params = new URLSearchParams({
    code: 'true',
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: verifier,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

function parseAuthorizationInput(input) {
  const value = String(input ?? '').trim();
  if (!value) return {};
  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    };
  } catch {
    /* bukan URL */
  }
  if (value.includes('#')) {
    const [code, state] = value.split('#', 2);
    return { code, state };
  }
  if (value.includes('code=')) {
    const params = new URLSearchParams(value);
    return { code: params.get('code') ?? undefined, state: params.get('state') ?? undefined };
  }
  return { code: value };
}

function tokenToCredential(token) {
  const access = token.access_token;
  const refresh = token.refresh_token;
  const expiresIn = Number(token.expires_in);
  if (typeof access !== 'string' || typeof refresh !== 'string' || !Number.isFinite(expiresIn)) {
    fail('Respons token tidak memuat access_token / refresh_token / expires_in.');
  }
  return {
    type: 'oauth',
    access,
    refresh,
    // Samakan dengan pi-ai: kedaluwarsa dikurangi margin 5 menit.
    expires: Date.now() + expiresIn * 1000 - REFRESH_MARGIN_MS,
  };
}

/* ------------------------------------------------------------------ */
/*  Langkah login                                                      */
/* ------------------------------------------------------------------ */

function startCallbackServer(port, expectedState) {
  let settle;
  const wait = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  wait.catch(() => undefined);
  let settled = false;
  const finish = (fn, value) => {
    if (settled) return;
    settled = true;
    fn(value);
  };

  const server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const page = (status, title, detail) => {
        response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(
          `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
            `<body style="font:16px/1.5 -apple-system,system-ui,sans-serif;padding:40px;max-width:640px">` +
            `<h2>${title}</h2><p>${detail}</p></body>`,
        );
      };
      if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
        page(404, 'Callback tidak dikenal', 'Rute callback tidak ditemukan.');
        return;
      }
      const error = url.searchParams.get('error');
      if (error) {
        const description = url.searchParams.get('error_description') ?? error;
        page(400, 'Login Claude gagal', description);
        finish(settle.reject, new Error(`Otorisasi Claude gagal: ${description}`));
        return;
      }
      if (url.searchParams.get('state') !== expectedState) {
        page(400, 'State tidak cocok', 'State OAuth tidak cocok. Ulangi login.');
        finish(settle.reject, new Error('OAuth state mismatch'));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        page(400, 'Kode tidak ada', 'Callback tidak membawa authorization code.');
        return;
      }
      page(200, 'Login Claude selesai', 'Kembali ke terminal; skrip melanjutkan sendiri. Tab ini boleh ditutup.');
      finish(settle.resolve, code);
    })();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, CALLBACK_HOST, () => {
      server.off('error', reject);
      const address = server.address();
      resolve({
        port: address.port,
        redirectUri: `http://localhost:${address.port}${CALLBACK_PATH}`,
        wait: (timeoutMs) =>
          Promise.race([
            wait,
            sleep(timeoutMs).then(() => {
              throw new Error('Waktu login habis.');
            }),
          ]),
        close: () => {
          finish(settle.reject, new Error('Callback server ditutup'));
          // Browser menahan koneksi keep-alive; tanpa ini proses tidak pernah keluar.
          server.closeAllConnections?.();
          server.close();
        },
      });
    });
  });
}

async function exchangeCode(code, state, verifier, redirectUri) {
  const result = await postJson(TOKEN_URL, {
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    state,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  if (!result.ok || !result.json) {
    fail(`Tukar authorization code gagal (HTTP ${result.status}): ${String(result.text ?? '').slice(0, 400)}`);
  }
  return tokenToCredential(result.json);
}

async function loginBrowser() {
  const { verifier, challenge } = await generatePkce();
  let server;
  try {
    server = await startCallbackServer(CALLBACK_PORT, verifier);
  } catch {
    try {
      server = await startCallbackServer(0, verifier);
    } catch (error) {
      fail(`Tidak bisa membuka callback server loopback: ${error.message}. Coba --copy-code.`);
    }
  }
  const url = buildAuthorizeUrl(server.redirectUri, challenge, verifier);
  log('1) Buka URL berikut di browser (mungkin sudah terbuka otomatis):\n');
  log(`   ${url}\n`);
  log('2) Login dengan akun Claude yang berlangganan Pro/Max/Team/Enterprise, lalu setujui akses.');
  log(`   Callback loopback: ${server.redirectUri}`);
  log('   (Kalau browser ada di mesin lain, jalankan ulang dengan --copy-code.)\n');
  openBrowser(url);
  log('   Menunggu callback… (Ctrl+C untuk batal)');
  try {
    const code = await server.wait(LOGIN_TIMEOUT_MS);
    log('   ✓ Browser kembali dengan authorization code.');
    return await exchangeCode(code, verifier, verifier, server.redirectUri);
  } finally {
    server.close();
  }
}

async function loginCopyCode() {
  const { verifier, challenge } = await generatePkce();
  const url = buildAuthorizeUrl(COPY_CODE_REDIRECT_URI, challenge, verifier);
  log('1) Buka URL berikut di browser mana pun:\n');
  log(`   ${url}\n`);
  log('2) Setujui akses; browser menampilkan KODE. Salin kode itu (format: kode#state).\n');
  openBrowser(url);
  const input = await promptLine('3) Tempel kode di sini: ');
  const parsed = parseAuthorizationInput(input);
  if (parsed.state && parsed.state !== verifier) fail('OAuth state mismatch (kode berasal dari login lain).');
  if (!parsed.code) fail('Kode otorisasi kosong.');
  log('   ✓ Kode diterima.');
  return exchangeCode(parsed.code, parsed.state ?? verifier, verifier, COPY_CODE_REDIRECT_URI);
}

function promptLine(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const onData = (chunk) => {
      process.stdin.pause();
      process.stdin.off('data', onData);
      resolve(String(chunk).trim());
    };
    process.stdin.resume();
    process.stdin.once('data', onData);
  });
}

/* ------------------------------------------------------------------ */
/*  Impor dari Claude Code / refresh                                   */
/* ------------------------------------------------------------------ */

function readClaudeCodeOAuth() {
  const candidates = [];
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  if (configDir) candidates.push(path.join(configDir, '.credentials.json'));
  candidates.push(path.join(os.homedir(), '.claude', '.credentials.json'));

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const oauth = data.claudeAiOauth ?? data;
      if (oauth?.accessToken && oauth?.refreshToken) return { source: file, oauth };
    } catch {
      /* lanjut */
    }
  }

  if (process.platform === 'darwin') {
    try {
      const raw = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const data = JSON.parse(raw);
      const oauth = data.claudeAiOauth ?? data;
      if (oauth?.accessToken && oauth?.refreshToken) {
        return { source: 'Keychain "Claude Code-credentials"', oauth };
      }
    } catch {
      /* tidak ada */
    }
  }
  return null;
}

function credentialFromClaudeCode() {
  const found = readClaudeCodeOAuth();
  if (!found) {
    fail(
      'Tidak menemukan login Claude Code. Jalankan "claude auth login" lebih dulu, ' +
        'atau login lewat skrip ini tanpa --from-claude-code.',
    );
  }
  const { oauth } = found;
  const expires = Number(oauth.expiresAt);
  log(`  Sumber token : ${found.source}`);
  return {
    type: 'oauth',
    access: oauth.accessToken,
    refresh: oauth.refreshToken,
    expires: Number.isFinite(expires) && expires > 0 ? expires : Date.now() + 3600_000,
  };
}

async function refreshCredential(credential) {
  const result = await postJson(TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: credential.refresh,
  });
  if (!result.ok || !result.json) {
    fail(`Refresh token gagal (HTTP ${result.status}): ${String(result.text ?? '').slice(0, 300)}`);
  }
  return tokenToCredential(result.json);
}

/* ------------------------------------------------------------------ */
/*  Store kredensial (YAML sederhana milik dsh-credentials-local)      */
/* ------------------------------------------------------------------ */

function yamlScalar(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function recordBlock(credential) {
  return [
    `  ${RECORD_KEY}:`,
    '    kind: grant',
    '    payload:',
    '      type: oauth',
    `      access: ${yamlScalar(credential.access)}`,
    `      refresh: ${yamlScalar(credential.refresh)}`,
    `      expires: ${Math.trunc(credential.expires)}`,
  ];
}

/** Cari bagian record bernama RECORD_KEY; kembalikan {start,end} indeks baris. */
function locateRecord(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === `  ${RECORD_KEY}:`) {
      let end = i + 1;
      while (end < lines.length) {
        const line = lines[end];
        if (/^ {0,1}[^ ]/.test(line) || /^ {2}[^ ]/.test(line)) break;
        end++;
      }
      return { start: i, end };
    }
  }
  return null;
}

function locateRecordsSection(lines) {
  const start = lines.findIndex((line) => /^records:\s*$/.test(line));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z#]/.test(lines[end])) end++;
  return { start, end };
}

function withFinalNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

/** Sisipkan/ganti record. Mengembalikan teks baru; melempar bila struktur tak dikenal. */
function upsertRecord(text, credential) {
  const lines = text.split('\n');
  const section = locateRecordsSection(lines);
  const block = recordBlock(credential);

  if (section === null) {
    const anchor = lines.findIndex((line) => /^refs:\s*$/.test(line));
    const insertAt = anchor >= 0 ? anchor : lines.length;
    lines.splice(insertAt, 0, 'records:', ...block, '');
    return withFinalNewline(lines.join('\n'));
  }

  const existing = locateRecord(lines);
  if (existing !== null) {
    const replaced = lines.slice(existing.start, existing.end);
    if (replaced.some((line) => /^\s+kind:/.test(line)) && !replaced.some((line) => /^\s+kind: grant/.test(line))) {
      log(`  ! Record lama berjenis lain ditemukan dan akan diganti (${replaced.length} baris).`);
    }
    lines.splice(existing.start, existing.end - existing.start, ...block);
    return withFinalNewline(lines.join('\n'));
  }

  let insertAt = section.end;
  while (insertAt > section.start + 1 && lines[insertAt - 1] === '') insertAt--;
  lines.splice(insertAt, 0, '', ...block);
  return withFinalNewline(lines.join('\n'));
}

function parseStoredCredential(text) {
  const lines = text.split('\n');
  const found = locateRecord(lines);
  if (!found) return null;
  const credential = { type: 'oauth' };
  let inPayload = false;
  for (let i = found.start + 1; i < found.end; i++) {
    const line = lines[i];
    if (/^    payload:\s*$/.test(line)) {
      inPayload = true;
      continue;
    }
    if (!inPayload) continue;
    const match = /^ {6}([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    let value = raw.trim();
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replace(/''/g, "'");
    else if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (key === 'expires') credential.expires = Number(value);
    else if (key === 'type' || key === 'access' || key === 'refresh') credential[key] = value;
  }
  if (!credential.access || !credential.refresh) return null;
  return credential;
}

function validateEdit(before, after, credential, { expectNewRecord }) {
  const keys = (text) => (text.match(/^ {2}[A-Za-z0-9/_.-]+:/gm) ?? []).map((line) => line.trim().replace(/:$/, ''));
  const beforeKeys = keys(before);
  const afterKeys = keys(after);
  const uniqueAfter = new Set(afterKeys);
  if (uniqueAfter.size !== afterKeys.length) throw new Error('Validasi gagal: ada key record duplikat setelah edit.');
  if (!uniqueAfter.has(RECORD_KEY)) throw new Error('Validasi gagal: record baru tidak ditemukan.');
  for (const key of beforeKeys) {
    if (key === RECORD_KEY) continue;
    if (!uniqueAfter.has(key)) throw new Error(`Validasi gagal: record lama hilang (${key}).`);
  }
  if (expectNewRecord && beforeKeys.includes(RECORD_KEY)) throw new Error('Validasi gagal: record sudah ada sebelumnya.');
  const parsed = parseStoredCredential(after);
  if (!parsed || parsed.refresh !== credential.refresh || parsed.access !== credential.access) {
    throw new Error('Validasi gagal: record tidak terbaca kembali dengan token yang sama.');
  }
  if (/\nrefs:/.test(before) && !/\nrefs:/.test(after)) throw new Error('Validasi gagal: bagian refs hilang.');
}

function writeCredentials(text, before) {
  const dir = path.dirname(CREDENTIALS_FILE);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${CREDENTIALS_FILE}.bak.${stamp}`;
  fs.copyFileSync(CREDENTIALS_FILE, backup);
  try {
    fs.chmodSync(backup, 0o600);
  } catch {
    /* Windows: mode tidak berlaku */
  }

  const temp = path.join(dir, `.credentials.yaml.tmp-${process.pid}`);
  fs.writeFileSync(temp, text, { mode: 0o600 });
  try {
    fs.chmodSync(temp, 0o600);
  } catch {
    /* Windows */
  }
  const fd = fs.openSync(temp, 'r+');
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(temp, CREDENTIALS_FILE);
  try {
    fs.chmodSync(CREDENTIALS_FILE, 0o600);
  } catch {
    /* Windows */
  }
  return backup;
}

function storeCredential(credential) {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    fail(`Store kredensial belum ada: ${CREDENTIALS_FILE}\n  Jalankan DSH sekali dulu agar file ini dibuat.`);
  }
  const before = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
  const hadRecord = locateRecord(before.split('\n')) !== null;
  const after = upsertRecord(before, credential);
  validateEdit(before, after, credential, { expectNewRecord: !hadRecord });
  if (DRY_RUN) {
    log('\n--dry-run: record TIDAK ditulis. Rencana record:');
    log(recordBlock(credential).join('\n'));
    return { written: false, hadRecord };
  }
  const backup = writeCredentials(after, before);
  return { written: true, hadRecord, backup };
}

/* ------------------------------------------------------------------ */
/*  Deklarasi route & verifikasi                                       */
/* ------------------------------------------------------------------ */

function describeRouteDeclaration() {
  const profilesDir = path.join(DSH_HOME, 'profiles');
  if (!fs.existsSync(profilesDir)) return { declaredIn: [], checked: false };
  const declaredIn = [];
  for (const profile of fs.readdirSync(profilesDir)) {
    const patch = path.join(profilesDir, profile, 'cordis.patch.yml');
    if (!fs.existsSync(patch)) continue;
    const text = fs.readFileSync(patch, 'utf8');
    if (text.includes('llm-pi-ai') && /\banthropic\s*:/.test(text)) declaredIn.push(profile);
  }
  return { declaredIn, checked: true };
}

function oauthHeaders(access) {
  return {
    authorization: `Bearer ${access}`,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': OAUTH_BETAS.join(','),
    'content-type': 'application/json',
    'user-agent': `claude-cli/${CLAUDE_CLI_VERSION}`,
    'x-app': 'cli',
  };
}

async function verifyRequest(access, model) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: oauthHeaders(access),
    body: JSON.stringify({
      model,
      max_tokens: 16,
      stream: false,
      system: [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }],
      messages: [{ role: 'user', content: 'Balas dengan satu kata: OK' }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (!response.ok) {
    const detail = json?.error?.message ?? text.slice(0, 300);
    return { ok: false, status: response.status, detail, kind: json?.error?.type };
  }
  const answer = (json?.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join(' ')
    .trim();
  return { ok: true, status: response.status, answer, usage: json?.usage };
}

async function verifyStored() {
  if (!fs.existsSync(CREDENTIALS_FILE)) fail(`Store kredensial tidak ada: ${CREDENTIALS_FILE}`);
  const stored = parseStoredCredential(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  if (!stored) fail(`Record ${RECORD_KEY} tidak ditemukan di ${CREDENTIALS_FILE}. Login dulu.`);

  log(`Record       : ${RECORD_KEY}`);
  log(`Access token : ${mask(stored.access)}`);
  log(`Kedaluwarsa  : ${new Date(stored.expires).toLocaleString()}`);
  if (stored.expires < Date.now()) log('               (sudah lewat; DSH akan refresh otomatis saat dipakai)');

  const candidates = [VERIFY_MODEL, 'claude-haiku-4-5', 'claude-sonnet-5-5', 'claude-opus-5-5'].filter(
    (model, index, list) => list.indexOf(model) === index,
  );
  let lastFailure;
  for (const model of candidates) {
    log(`\nUji request ke ${model}…`);
    let result;
    try {
      result = await verifyRequest(stored.access, model);
    } catch (error) {
      lastFailure = { model, status: 0, detail: error.message };
      log(`  ✗ jaringan: ${error.message}`);
      break;
    }
    if (result.ok) {
      log(`  ✓ HTTP ${result.status} — jawaban: "${result.answer || '(kosong)'}"`);
      log(`  ✓ Token langganan Claude bekerja untuk model ${model}.`);
      return true;
    }
    log(`  ✗ HTTP ${result.status}${result.kind ? ` (${result.kind})` : ''}: ${result.detail}`);
    lastFailure = { model, ...result };
    if (result.status === 401) {
      log('\n  Token ditolak. Jalankan ulang login (atau --refresh), lalu coba lagi.');
      return false;
    }
    if (![403, 404].includes(result.status)) return false;
  }
  if (lastFailure) log(`\n  Model uji tidak bisa dipakai; token bisa jadi tetap valid. Coba --model <id> lain.`);
  return false;
}

/* ------------------------------------------------------------------ */
/*  Probe seluruh katalog model                                        */
/* ------------------------------------------------------------------ */

function storedAccess() {
  if (!fs.existsSync(CREDENTIALS_FILE)) fail(`Store kredensial tidak ada: ${CREDENTIALS_FILE}`);
  const stored = parseStoredCredential(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
  if (!stored) fail(`Record ${RECORD_KEY} tidak ditemukan. Login dulu.`);
  return stored;
}

async function fetchAdvertisedModels(access) {
  const ids = [];
  let after;
  for (let page = 0; page < 10; page++) {
    const url = new URL('https://api.anthropic.com/v1/models');
    url.searchParams.set('limit', '1000');
    if (after) url.searchParams.set('after_id', after);
    const response = await fetch(url, { headers: oauthHeaders(access), signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    if (!response.ok) throw new Error(`GET /v1/models HTTP ${response.status}: ${text.slice(0, 200)}`);
    const json = JSON.parse(text);
    for (const model of json.data ?? []) {
      ids.push({ id: model.id, name: model.display_name, created: model.created_at });
    }
    if (!json.has_more) break;
    after = json.last_id;
  }
  return ids;
}

async function probeOne(access, id) {
  const started = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: oauthHeaders(access),
        body: JSON.stringify({
          model: id,
          max_tokens: 8,
          stream: false,
          system: [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }],
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      return { id, ok: false, status: 0, kind: 'network', detail: error.message, ms: Date.now() - started };
    }
    const text = await response.text();
    const ms = Date.now() - started;
    if (response.ok) return { id, ok: true, status: response.status, ms };
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    const kind = json?.error?.type ?? '';
    const detail = json?.error?.message ?? text.slice(0, 160);
    if (response.status === 429 && attempt === 0) {
      await sleep(5000);
      continue;
    }
    return { id, ok: false, status: response.status, kind, detail, ms };
  }
  return { id, ok: false, status: 429, kind: 'rate_limit_error', detail: 'rate limited', ms: Date.now() - started };
}

function modelYamlLines(rows) {
  const lines = ['        models:'];
  for (const row of rows) {
    const meta = MODEL_META[row.id] ?? { name: row.name ?? row.id, contextWindow: 1000000, maxTokens: 128000 };
    lines.push(`          - id: ${row.id}`);
    lines.push(`            name: ${meta.name}`);
    lines.push(`            contextWindow: ${meta.contextWindow}`);
    lines.push(`            maxTokens: ${meta.maxTokens}`);
    lines.push('            input:');
    lines.push('              - text');
    lines.push('              - image');
  }
  return lines;
}

async function runProbe() {
  const stored = storedAccess();
  log(`Record : ${RECORD_KEY} (kedaluwarsa ${new Date(stored.expires).toLocaleString()})\n`);

  let advertised = [];
  try {
    advertised = await fetchAdvertisedModels(stored.access);
    log(`Ditawarkan akun ini (GET /v1/models): ${advertised.length} model`);
  } catch (error) {
    log(`! Gagal membaca /v1/models: ${error.message}`);
    log('  Probe dilanjutkan memakai katalog snapshot DSH saja.\n');
  }

  const targetIds = [];
  for (const model of advertised) if (!targetIds.includes(model.id)) targetIds.push(model.id);
  for (const [id] of KNOWN_MODELS) if (!targetIds.includes(id)) targetIds.push(id);
  const extra = (opt('--extra') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  for (const id of extra) if (!targetIds.includes(id)) targetIds.push(id);

  const advertisedById = new Map(advertised.map((model) => [model.id, model]));

  log(`Menguji ${targetIds.length} model dengan satu request kecil (max_tokens 8)…\n`);

  const rows = [];
  for (const id of targetIds) {
    const result = await probeOne(stored.access, id);
    const row = { ...result, name: advertisedById.get(id)?.name ?? MODEL_META[id]?.name ?? id };
    rows.push(row);
    const status = result.ok ? 'OK  ' : 'GAGAL';
    const detail = result.ok
      ? `${String(result.ms).padStart(5)} ms`
      : `HTTP ${result.status}${result.kind ? ` ${result.kind}` : ''}: ${String(result.detail ?? '').replace(/\s+/g, ' ').slice(0, 70)}`;
    log(`  ${status}  ${id.padEnd(30)} ${detail}`);
    await sleep(250);
  }

  const usable = rows.filter((row) => row.ok);
  const dead = rows.filter((row) => !row.ok);

  if (PROBE_JSON) {
    log(`\n${JSON.stringify({ advertised, usable: usable.map((row) => row.id), dead, probedAt: new Date().toISOString() }, null, 2)}`);
    return;
  }

  log(`\nRingkasan: ${usable.length} bisa dipakai, ${dead.length} tidak bisa.\n`);
  if (dead.length > 0) {
    log('Tidak bisa dipakai:');
    for (const row of dead) log(`  - ${row.id}  (HTTP ${row.status}${row.kind ? ` ${row.kind}` : ''})`);
    log('');
  }
  if (usable.length > 0) {
    log('Bisa dipakai:');
    log(`  ${usable.map((row) => row.id).join(', ')}\n`);
  }

  const inCatalog = new Set(KNOWN_MODELS.map(([id]) => id));
  const notInCatalog = advertised.filter((model) => !inCatalog.has(model.id));
  if (notInCatalog.length > 0) {
    log('Model baru (ditawarkan akun, belum ada di snapshot katalog DSH):');
    for (const model of notInCatalog) log(`  - ${model.id}  ${model.name}`);
    log('');
  }

  if (EMIT_MODELS) {
    log('Blok `models:` untuk cordis.patch.yml (hanya model yang bisa dipakai):\n');
    log(modelYamlLines(usable).join('\n'));
    log('');
  }
}

function printPath() {
  log(`DSH_HOME      : ${DSH_HOME}`);
  log(`Store         : ${CREDENTIALS_FILE}${fs.existsSync(CREDENTIALS_FILE) ? '' : '  (belum ada)'}`);
  log(`Record target : ${RECORD_KEY}`);
  const stored = fs.existsSync(CREDENTIALS_FILE) ? parseStoredCredential(fs.readFileSync(CREDENTIALS_FILE, 'utf8')) : null;
  log(`Status record : ${stored ? `ADA (kedaluwarsa ${new Date(stored.expires).toLocaleString()})` : 'belum ada'}`);
  const route = describeRouteDeclaration();
  if (!route.checked) log('Deklarasi route: direktori profiles tidak ditemukan.');
  else if (route.declaredIn.length === 0) log('Deklarasi route: BELUM ADA `anthropic` di cordis.patch.yml profil mana pun.');
  else log(`Deklarasi route: OK — ${route.declaredIn.join(', ')}`);
}

function printModels() {
  log('Model chat anthropic pada snapshot katalog pi-ai yang dibundel DSH 0.2.2-rc.1:\n');
  for (const [id, name] of KNOWN_MODELS) log(`  ${id.padEnd(28)} ${name}`);
  log(
    '\nKalau route dideklarasikan sebagai `anthropic: {}`, seluruh katalog di atas otomatis tersedia\n' +
      'di model picker DSH. Untuk membatasi/menambah model, tulis daftar `models:` sendiri — daftar itu\n' +
      'MENGGANTI katalog, bukan menambah.',
  );
}

/* ------------------------------------------------------------------ */
/*  Self-test penulis record (tanpa jaringan)                          */
/* ------------------------------------------------------------------ */

function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-claude-selftest-'));
  const file = path.join(dir, '.credentials.yaml');
  const sample = [
    'version: 1',
    'records:',
    '  deepseek-account-platform/device:',
    '    kind: grant',
    '    payload:',
    '      id: 00000000-0000-0000-0000-000000000000',
    '',
    'refs:',
    '  {}',
    '',
  ].join('\n');
  fs.writeFileSync(file, sample, { mode: 0o600 });

  const credential = { type: 'oauth', access: 'sk-ant-oat01-SELFTEST', refresh: 'sk-ant-ort01-SELFTEST', expires: Date.now() + 3600_000 };
  const before = fs.readFileSync(file, 'utf8');
  const after = upsertRecord(before, credential);
  validateEdit(before, after, credential, { expectNewRecord: true });
  const parsed = parseStoredCredential(after);
  if (!parsed || parsed.access !== credential.access || parsed.refresh !== credential.refresh) {
    throw new Error('self-test: record tidak terbaca kembali');
  }
  if (!/\nrefs:/.test(after)) throw new Error('self-test: bagian refs hilang');

  const second = upsertRecord(after, { ...credential, access: 'sk-ant-oat01-SELFTEST2' });
  const parsedSecond = parseStoredCredential(second);
  if (!parsedSecond || parsedSecond.access !== 'sk-ant-oat01-SELFTEST2') {
    throw new Error('self-test: penimpaan record gagal');
  }
  if ((second.match(/llm-pi-ai\/anthropic:/g) ?? []).length !== 1) {
    throw new Error('self-test: record terduplikasi');
  }

  const pkce = crypto.randomBytes(32).toString('base64url');
  const challenge = base64url(crypto.createHash('sha256').update(pkce).digest());
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new Error('self-test: PKCE challenge tidak valid');

  fs.rmSync(dir, { recursive: true, force: true });
  log('✓ self-test lulus: upsert record, validasi, parse-balik, penimpaan, PKCE.');
}

/* ------------------------------------------------------------------ */
/*  Bantuan                                                            */
/* ------------------------------------------------------------------ */

function printHelp() {
  const source = fs.readFileSync(new URL(import.meta.url), 'utf8');
  const start = source.indexOf('/**');
  const end = source.indexOf('*/', start);
  const header = source.slice(start + 3, end);
  log(header.replace(/^ ?\* ?/gm, '').trim());
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  if (HELP) {
    printHelp();
    return;
  }
  if (SELF_TEST) {
    selfTest();
    return;
  }
  if (PROBE || EMIT_MODELS) {
    await runProbe();
    return;
  }
  if (LIST_MODELS) {
    printModels();
    return;
  }
  if (PRINT_PATH) {
    printPath();
    return;
  }
  if (VERIFY_ONLY) {
    const ok = await verifyStored();
    process.exitCode = ok ? 0 : 1;
    return;
  }
  if (REFRESH_ONLY) {
    if (!fs.existsSync(CREDENTIALS_FILE)) fail(`Store kredensial tidak ada: ${CREDENTIALS_FILE}`);
    const stored = parseStoredCredential(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    if (!stored) fail(`Record ${RECORD_KEY} tidak ditemukan. Login dulu.`);
    log('Menyegarkan token memakai refresh token tersimpan…');
    const refreshed = await refreshCredential(stored);
    const result = storeCredential(refreshed);
    if (result.written) log(`  ✓ Record diperbarui (backup: ${result.backup})`);
    if (!NO_VERIFY && !DRY_RUN) {
      const ok = await verifyStored();
      process.exitCode = ok ? 0 : 1;
    }
    return;
  }

  log('=== Login langganan Claude untuk provider `anthropic` di DSH ===\n');
  log(`DSH_HOME : ${DSH_HOME}`);
  log(`Store    : ${CREDENTIALS_FILE}`);
  log(`Record   : ${RECORD_KEY}`);
  log(`Mode     : ${FROM_CLAUDE_CODE ? 'impor dari Claude Code' : COPY_CODE ? 'copy-code' : 'browser'}\n`);

  let credential;
  if (FROM_CLAUDE_CODE) {
    credential = credentialFromClaudeCode();
    log(`  Access : ${mask(credential.access)}`);
  } else if (COPY_CODE) {
    credential = await loginCopyCode();
  } else {
    credential = await loginBrowser();
  }

  if (!DRY_RUN && credential.expires < Date.now()) {
    log('\nToken baru sudah lewat masa berlaku; menyegarkan…');
    credential = await refreshCredential(credential);
  }

  log('\nMenyimpan record kredensial…');
  const result = storeCredential(credential);
  if (result.written) {
    log(`  ✓ Tersimpan (${result.hadRecord ? 'record lama ditimpa' : 'record baru'}).`);
    log(`  Backup: ${result.backup}`);
  }

  if (!DRY_RUN && !NO_VERIFY) {
    log('');
    const ok = await verifyStored();
    if (!ok) process.exitCode = 1;
  }

  const route = describeRouteDeclaration();
  log('\nLangkah berikutnya di DSH:');
  if (!route.checked) {
    log('  1. Pastikan DSH pernah dijalankan agar profil terbentuk.');
  } else if (route.declaredIn.length > 0) {
    log(`  1. Route \`anthropic\` sudah dideklarasikan (${route.declaredIn.join(', ')}).`);
  } else {
    log('  1. Deklarasikan route: Settings → Models → Add model provider → Third-party model provider →');
    log('     pilih `anthropic`, biarkan kolom API key KOSONG, lalu Apply.');
    log('     (Alternatif: tambahkan `anthropic: {}` di bawah `providers:` pada entry llm-pi-ai');
    log('      di ~/.dsh/profiles/<profil>/cordis.patch.yml, lalu restart DSH.)');
  }
  log('  2. Restart DSH Desktop (atau muat ulang halaman web) setelah record/route berubah.');
  log('  3. Pilih model Claude di model picker chat (mis. Claude Opus 5.5 / Sonnet 5.5).');
  log('\nCatatan: token hanya memberi akses model; fitur khusus Claude Code (MCP Claude.ai,');
  log('Remote Control) tidak ikut lewat jalur ini.');
}

main().catch((error) => {
  fail(error?.stack ?? error?.message ?? String(error));
});
