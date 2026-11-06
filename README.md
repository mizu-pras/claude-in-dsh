# claude-in-dsh

Use a **Claude subscription** (Pro / Max / Team / Enterprise) as a model provider in
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) — no Anthropic
API key, no Console billing.

The repo contains one dependency-free Node script that runs the same OAuth 2.0 + PKCE
flow pi-ai/Claude Code uses, stores the credential as the DSH record
`llm-pi-ai/anthropic`, and a tutorial (in Indonesian) covering the route declaration,
verification, model probing, and troubleshooting.

| File | Purpose |
|---|---|
| [`claude-oauth-login.mjs`](claude-oauth-login.mjs) | OAuth login, credential record writer, token verify, model probe |
| [`TUTORIAL-CLAUDE-SUBSCRIPTION.md`](TUTORIAL-CLAUDE-SUBSCRIPTION.md) | End-to-end tutorial (Indonesian) |
| [`README.md`](README.md) | This file |

## Requirements

- A Claude subscription (Pro / Max / Team / Enterprise). Free accounts cannot use this.
- DSH installed and launched at least once (so `~/.dsh/.credentials.yaml` exists).
- Node.js ≥ 18 (DSH Desktop ships its own Node if you do not have one).
- A local browser for the OAuth callback (`http://localhost:53692/callback`), or use
  `--copy-code` to paste the code from any browser.

## Quick start

```bash
# 0) Get the repo (public, no GitHub account needed)
git clone https://github.com/mizu-pras/claude-in-dsh.git
cd claude-in-dsh

# 1) Log in: browser opens, approve, the record is written and verified.
node claude-oauth-login.mjs

# 2) Declare the route in DSH:
#    Settings -> Models -> Add model provider -> Third-party -> anthropic,
#    leave the API key EMPTY, Apply. (Restart DSH if the picker does not refresh.)
#    YAML alternative: add `anthropic: {}` under `providers:` of the llm-pi-ai entry
#    in ~/.dsh/profiles/<profile>/cordis.patch.yml

# 3) Verify and pick a model
node claude-oauth-login.mjs --verify
node claude-oauth-login.mjs --probe
```

Then pick e.g. **Claude Opus 5.5** in the DSH model picker.

## Setup with an AI agent

The fastest path: let the agent inside DSH (or any coding agent that can run shell commands
and edit files, e.g. Claude Code or Codex) do the whole setup for you. Open a new chat,
paste the prompt below, and only step in when it shows you the login URL.

**Before you paste**

- Start the chat in a folder you are happy to clone into (for example your home folder or a
  workspace folder). The agent clones the repo there.
- The agent needs to write outside that folder (`~/.dsh/.credentials.yaml` and
  `~/.dsh/profiles/<profile>/cordis.patch.yml`). In DSH's `workspace-write` mode it will ask
  for approval; approve those two paths only.
- Keep the browser on the same machine as DSH, or be ready to paste a code back
  (`--copy-code`).

**Prompt** (Indonesian, copy as-is):

```text
Pasang Claude subscription (OAuth) di DSH ini memakai repo publik
https://github.com/mizu-pras/claude-in-dsh.git

1. Repo: kalau folder claude-in-dsh belum ada di working directory sesi ini, jalankan
   `git clone https://github.com/mizu-pras/claude-in-dsh.git`; kalau sudah ada, masuk ke
   folder itu dan jalankan `git pull`. Kalau `git` tidak tersedia, unduh
   https://github.com/mizu-pras/claude-in-dsh/archive/refs/heads/main.zip lalu ekstrak.
   Semua langkah berikut dijalankan dari folder repo itu.
2. Baca README.md dan TUTORIAL-CLAUDE-SUBSCRIPTION.md di folder itu sebelum mengubah apa pun.
3. Cek dulu: `node claude-oauth-login.mjs --print-path` untuk melihat lokasi store, status
   record, dan status route. Kalau record sudah valid, lewati langkah 4.
4. Login: jalankan `node claude-oauth-login.mjs` sebagai background job, lalu tampilkan URL
   otorisasinya ke saya sebagai link. Tunggu job selesai (jangan dimatikan), lalu laporkan
   hasil verifikasinya.
5. Route: kalau provider `anthropic` belum dideklarasikan, tambahkan di profil DSH yang sedang
   dipakai (~/.dsh/profiles/<profil>/cordis.patch.yml, di bawah `providers:` entry llm-pi-ai).
   Backup file dulu. Jalankan `node claude-oauth-login.mjs --emit-models` dan pakai urutan
   model: claude-opus-5-5, claude-fable-5-1, claude-sonnet-5-5, claude-haiku-5-5, lalu model
   lama yang masih hidup dari yang terbaru. Validasi YAML setelah edit.
6. Uji: jalankan `node claude-oauth-login.mjs --verify` dan `node claude-oauth-login.mjs --probe`,
   lalu laporkan model yang gagal.
7. Tutup dengan ringkasan: lokasi repo, model yang aktif, lokasi record kredensial, file yang
   diubah beserta backup-nya, dan langkah di UI (muat ulang atau restart DSH, lalu pilih
   model Claude).

Aturan: jangan mencetak token atau isi kredensial. Jangan mengubah konfigurasi di luar yang
diminta. Kalau `node` tidak ada, pakai Node bawaan DSH Desktop. Kalau browser tidak bisa
membuka localhost, ulangi login dengan `--copy-code` dan minta saya menempelkan kodenya.
```

**Follow-up prompts**

```text
Cek ulang setup Claude subscription dari repo claude-in-dsh: jalankan
`node claude-oauth-login.mjs --verify` dan `--probe`, laporkan model yang gagal tanpa
mencetak token.
```

```text
Token Claude subscription saya error. Di repo claude-in-dsh, jalankan
`node claude-oauth-login.mjs --refresh`; kalau gagal, login ulang dengan
`node claude-oauth-login.mjs` sebagai background job dan tampilkan URL-nya ke saya.
```

## Commands

```bash
node claude-oauth-login.mjs                 # browser login, store, verify
node claude-oauth-login.mjs --copy-code     # headless/remote browser: paste the code
node claude-oauth-login.mjs --from-claude-code  # import an existing `claude auth login`
node claude-oauth-login.mjs --refresh       # force a token refresh now
node claude-oauth-login.mjs --verify        # check stored record + one test request
node claude-oauth-login.mjs --print-path    # store location, record status, route status
node claude-oauth-login.mjs --probe         # test every known model, report dead ones
node claude-oauth-login.mjs --emit-models   # probe + YAML `models:` block for living models
node claude-oauth-login.mjs --probe --json  # machine-readable probe result
node claude-oauth-login.mjs --list-models   # catalog snapshot bundled with DSH
node claude-oauth-login.mjs --self-test     # exercise the record writer, no network
node claude-oauth-login.mjs --help
```

Options: `--dry-run`, `--no-browser`, `--no-verify`, `--dsh-home <dir>`,
`--model <id>`, `--port <n>`, `--timeout <seconds>`, `--extra id1,id2`.

## How it works

- The script uses the public Claude Code OAuth client id with PKCE (the same flow
  `@earendil-works/pi-ai` implements for `Anthropic (Claude Pro/Max)`).
- The resulting credential is written to `~/.dsh/.credentials.yaml` as one record:

  ```yaml
  records:
    llm-pi-ai/anthropic:
      kind: grant
      payload:
        type: oauth
        access: '...'
        refresh: '...'
        expires: 1794...
  ```

  Backups are taken before every write, writes are atomic, and the file stays `0600`.
- DSH's `dsh-llm-pi-ai` resolves that record per request, and pi-ai recognizes the
  `sk-ant-oat…` access token, switching to `Authorization: Bearer` plus the
  `claude-code-20250219` / `oauth-2025-04-20` betas and the Claude Code identity
  headers. Refresh tokens are rotated automatically by DSH.
- The token is never printed to stdout or sent anywhere except `platform.claude.com`
  (token exchange/refresh) and `api.anthropic.com` (verification/probe).

## Model order

Model order in the DSH picker follows the `models:` array order of the route — see
tutorial section 6c. Without a `models:` list the full pi-ai catalog (17 models as of
DSH 0.2.2-rc.1) is inherited.

## Security and policy

- Anthropic's [authentication policy](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)
  targets subscription OAuth at Claude Code and native Anthropic apps. Using your own
  subscription token in a third-party client is a grey area: third-party developers may
  not offer or intermediate Claude.ai logins for other users, and Anthropic reserves the
  right to enforce this. Your account, your risk.
- For a clearly supported alternative, run the real Claude Code binary as a DSH
  subagent with its native login instead (`@deepseek-ai/dsh-subagent-claude-code`) —
  see tutorial section 9.

## License

MIT — see [LICENSE](LICENSE).
