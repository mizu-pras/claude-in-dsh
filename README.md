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

## Let DSH do it (copy-paste prompts)

Instead of running the steps yourself, paste one of the prompts below into a DSH chat.
A DSH agent with shell + file access can run the login in the background, relay the
authorization URL, declare the route, and verify the result. These prompts are written
in Indonesian because that is the language the author uses with DSH; translate them
freely — the instructions, not the wording, are what matters.

### Fresh machine: clone and set up

Clone the repo first (or let DSH do it), then paste:

```text
Pasang integrasi Claude subscription di DSH ini dari repo GitHub.

1. Clone git@github.com-personal:mizu-pras/claude-in-dsh.git ke ~/Workspaces/personal/claude-in-dsh
   (kalau foldernya sudah ada, cukup git pull).
2. Baca README.md dan TUTORIAL-CLAUDE-SUBSCRIPTION.md di folder itu.
3. Jalankan `node claude-oauth-login.mjs` sebagai background job, ambil URL otorisasi dari
   output-nya dan tampilkan ke saya. Saya akan login di browser. Tunggu sampai job selesai,
   jangan dimatikan, lalu laporkan hasil verifikasinya.
4. Deklarasikan route `anthropic` di profil DSH yang sedang dipakai
   (~/.dsh/profiles/<profil>/cordis.patch.yml) dengan urutan model: claude-opus-5-5,
   claude-fable-5-1, claude-sonnet-5-5, claude-haiku-5-5, lalu model lama dari terbaru ke
   terlama. Backup file dulu, dan validasi YAML setelah edit.
5. Jalankan `node claude-oauth-login.mjs --probe` dan laporkan model yang tidak bisa dipakai.
6. Ringkas hasilnya: model yang aktif, lokasi record kredensial, dan langkah di UI
   (muat ulang/restart DSH, lalu pilih model Claude).

Jangan mencetak isi token ke chat. Jangan mengubah konfigurasi atau kredensial lain di luar
yang saya minta. Kalau `node` tidak tersedia, pakai Node bawaan DSH Desktop.
```

### Already cloned: do the login and route only

```text
Di repo ~/Workspaces/personal/claude-in-dsh, bantu saya login Claude subscription ke DSH.

1. Jalankan `node claude-oauth-login.mjs` sebagai background job dan tampilkan URL
   otorisasinya. Saya login di browser; tunggu job selesai lalu laporkan verifikasinya.
2. Pastikan route `anthropic` ada di profil DSH aktif dengan urutan model
   claude-opus-5-5 > claude-fable-5-1 > claude-sonnet-5-5 > claude-haiku-5-5 > model lama
   (backup + validasi YAML dulu).
3. Jalankan `--probe`, lalu beri tahu saya kalau perlu restart DSH.

Jangan mencetak token dan jangan mengubah hal lain.
```

### Check or refresh later

```text
Di repo ~/Workspaces/personal/claude-in-dsh jalankan `node claude-oauth-login.mjs --print-path`
lalu `--probe`. Laporkan status record, status route, dan model mana yang tidak bisa dipakai.
Jangan ubah apa pun.
```

```text
Token Claude subscription saya mungkin perlu disegarkan. Di repo
~/Workspaces/personal/claude-in-dsh jalankan `node claude-oauth-login.mjs --refresh`, lalu
`--verify`, dan laporkan hasilnya tanpa mencetak token.
```

Notes:

- Let the agent run the login as a **background job**: the OAuth callback waits for your
  browser approval, and killing the process abandons the attempt.
- The authorization URL is shown in the chat. Open it on the same Mac as DSH; otherwise
  use `--copy-code` and paste the code back to the agent.
- A DSH restart ends the running chat, so the agent declares the route first and only
  then tells you to restart (or you can just reload the window).

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
