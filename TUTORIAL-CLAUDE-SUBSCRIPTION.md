# Tutorial: langganan Claude (Claude Code) di DeepSeek Harness

Panduan ini memasang provider **`anthropic`** di DeepSeek Harness (DSH) memakai
**langganan Claude** (Pro / Max / Team / Enterprise) — bukan API key Console, bukan
saldo billing API. Hasil akhirnya: model Claude (Opus 5.5, Sonnet 5.5, Haiku 5.5, dst.)
muncul di model picker DSH dan dipakai sebagai model chat agent.

Ini adalah pasangan dari `TUTORIAL-OPENAI-CODEX-SUBSCRIPTION.md` (jalur langganan
ChatGPT). Mekanismenya sama: satu **record kredensial OAuth** bernama
`llm-pi-ai/anthropic` di `~/.dsh/.credentials.yaml`, ditulis oleh skrip kecil tanpa
dependensi.

Berkas yang perlu dibawa:

| Berkas | Fungsi |
|---|---|
| `TUTORIAL-CLAUDE-SUBSCRIPTION.md` | dokumen ini |
| `claude-oauth-login.mjs` | login OAuth + penyimpan kredensial (tanpa dependensi) |

Perkiraan waktu: **3–5 menit** (mayoritas menunggu login browser).

---

## 0. Ringkas: 3 langkah

1. **Login**: `node claude-oauth-login.mjs` → browser terbuka → setujui → token tersimpan.
2. **Deklarasikan route** `anthropic` di profil DSH (Settings → Models, atau `anthropic: {}` di YAML).
3. **Verifikasi**: `node claude-oauth-login.mjs --verify`, restart DSH, pilih model Claude.

---

## 1. Yang perlu dan tidak perlu

| Perlu | Keterangan |
|---|---|
| Langganan Claude (Pro/Max/Team/Enterprise) | Sumber autentikasi. Akun gratis tidak bisa. |
| DSH terpasang dan **pernah dijalankan minimal sekali** | Agar `~/.dsh/.credentials.yaml` sudah dibuat. |
| Node.js ≥ 18 | Hanya untuk menjalankan skrip (Desktop DSH membawa Node sendiri, lihat Troubleshooting). |
| Browser di mesin yang sama | Untuk callback `http://localhost:53692/callback`. Tanpa browser lokal, pakai `--copy-code`. |

| Tidak perlu | Keterangan |
|---|---|
| `ANTHROPIC_API_KEY` / saldo API Console | Jalur ini OAuth-only; API key justru akan ditagih terpisah. |
| Claude Code CLI | Opsional. Kalau sudah login (`claude auth login`), tokennya bisa diimpor (bagian 4b). |

Model chat pada snapshot katalog pi-ai yang dibundel DSH `0.2.2-rc.1`:

```
claude-opus-5-5   claude-sonnet-5-5  claude-haiku-5-5
claude-opus-5     claude-sonnet-5    claude-fable-5-1   claude-fable-5
claude-opus-4-8   claude-opus-4-7   claude-opus-4-6    claude-opus-4-5
claude-sonnet-4-6 claude-sonnet-4-5 claude-haiku-4-5
```

Katalog adalah snapshot saat DSH dirilis. Model yang lebih baru bisa ditambahkan
manual lewat `models:` (bagian 6) atau otomatis muncul setelah DSH diperbarui.

---

## 2. Langkah 1 — login langganan Claude

Jalankan dari folder mana pun:

```bash
node claude-oauth-login.mjs
```

Yang terjadi:

1. Skrip membuat PKCE, membuka callback server di `127.0.0.1:53692`, dan mencetak
   **URL otorisasi** (browser juga dibuka otomatis).
2. Anda login dengan akun Claude berlangganan, lalu **Approve/Authorize**.
3. Browser diarahkan balik ke `localhost`; skrip menukar code menjadi
   access + refresh token.
4. Record ditulis ke `~/.dsh/.credentials.yaml` (backup otomatis, mode `0600`).
5. Skrip mengirim **satu request kecil** ke `api.anthropic.com` untuk memastikan token
   benar-benar bisa dipakai. Token tidak pernah dicetak.

Varian yang tersedia:

```bash
node claude-oauth-login.mjs --copy-code      # browser di mesin lain / headless: tempel kode
node claude-oauth-login.mjs --dry-run        # login, tapi JANGAN tulis apa pun
node claude-oauth-login.mjs --from-claude-code  # impor token dari `claude auth login`
node claude-oauth-login.mjs --refresh        # segarkan token tersimpan sekarang
node claude-oauth-login.mjs --verify         # cek record + request uji, tanpa login
node claude-oauth-login.mjs --print-path     # lokasi store, status record, status route
node claude-oauth-login.mjs --list-models    # daftar model katalog yang dikenal
```

Contoh keluaran sukses:

```
=== Login langganan Claude untuk provider `anthropic` di DSH ===
DSH_HOME : /Users/<anda>/.dsh
Store    : /Users/<anda>/.dsh/.credentials.yaml
Record   : llm-pi-ai/anthropic
Mode     : browser

1) Buka URL berikut di browser ...
   https://claude.ai/oauth/authorize?code=true&client_id=...&code_challenge=...
...
   ✓ Browser kembali dengan authorization code.
   ✓ Tersimpan (record baru).
   ✓ HTTP 200 — jawaban: "OK"
   ✓ Token langganan Claude bekerja untuk model claude-haiku-4-5.
```

> Catatan: kalau token sudah lewat masa berlaku, DSH menyegarkannya otomatis lewat
> refresh token saat dipakai. `--refresh` hanya untuk memaksa sekarang.

---

## 3. Langkah 2 — deklarasikan route `anthropic`

Record kredensial saja belum menampilkan model; route harus ada di lapisan patch profil
yang Anda jalankan:

```
~/.dsh/profiles/<profil>/cordis.patch.yml     # `desktop` untuk aplikasi Desktop, `web` untuk `dsh web`
```

Pilih **salah satu** cara.

### Cara A — lewat GUI (tanpa edit file)

1. **Settings → Models**.
2. **Add model provider** → mode **Third-party model provider**.
3. Pilih **`anthropic`** (nama tampil *Anthropic*).
4. **Biarkan kolom API key KOSONG.** Route tanpa referensi kredensial akan memakai
   login OAuth yang tersimpan. Klik **Apply**.
5. Tutup & buka lagi DSH Desktop (profil `web`: muat ulang halaman).

### Cara B — edit file

Tutup DSH Desktop dulu, lalu buka `~/.dsh/profiles/desktop/cordis.patch.yml`.

Kalau **sudah ada** entry `- id: llm-pi-ai`, tambahkan satu baris di bawah `providers:`:

```yaml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      anthropic: {}
```

Kalau **belum ada**, tempel blok itu di akhir file (file berupa array YAML). `{}` berarti
"pakai seluruh katalog pi-ai": endpoint `https://api.anthropic.com`, protokol
`anthropic-messages`, dan 17 model diwarisi otomatis.

> Jangan menulis `models:` kecuali memang ingin membatasi/mengubah katalog — `models:`
> **mengganti** seluruh katalog route, bukan menambah.

Cek hasilnya:

```bash
node claude-oauth-login.mjs --print-path
# Status record : ADA (kedaluwarsa ...)
# Deklarasi route: OK — desktop
```

---

## 4. Langkah 3 — verifikasi dan pakai

```bash
node claude-oauth-login.mjs --verify
```

- `HTTP 200` + jawaban model → token valid.
- `HTTP 401` → token ditolak; jalankan ulang login atau `--refresh`.
- `HTTP 403/404` untuk model uji → token valid tapi model itu tidak tersedia untuk akun
  Anda; coba `--model claude-sonnet-5-5`.

Lalu di DSH:

1. Restart DSH Desktop (setelah record/route berubah).
2. Buka model picker di komposer, pilih provider **Anthropic** dan model
   mis. **Claude Opus 5.5**.
3. Kalau ingin jadi default: Settings → General → model default, atau ubah
   `agent-default-model` di `cordis.patch.yml`:

```yaml
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: anthropic
    model: claude-sonnet-5-5
```

### 4b. Impor token dari Claude Code (opsional)

Kalau Anda sudah `claude auth login` di mesin ini, tidak perlu login dua kali:

```bash
node claude-oauth-login.mjs --from-claude-code
```

Skrip membaca `claudeAiOauth` dari Keychain macOS (`Claude Code-credentials`) atau
`~/.claude/.credentials.json` (Linux/Windows/`CLAUDE_CONFIG_DIR`), lalu menulis record
yang sama.

> Ini memakai ulang **refresh token yang sama** dengan Claude Code. Dua klien yang
> menyegarkan token yang sama bisa saling mematikan sesi. Untuk pemakaian jangka panjang,
> login lewat skrip (tanpa `--from-claude-code`) lebih aman.

---

## 5. Cara kerjanya (kenapa ini bisa jalan)

- `dsh-llm-pi-ai` memakai `@earendil-works/pi-ai`, yang pada `api/anthropic-messages`
  mendeteksi access token berawalan `sk-ant-oat` dan otomatis:
  - memakai `Authorization: Bearer` (bukan `x-api-key`),
  - menambahkan beta `claude-code-20250219` dan `oauth-2025-04-20`,
  - mengirim identitas Claude Code (`user-agent: claude-cli/...`, `x-app: cli`,
    system prompt "You are Claude Code…").
- Record `llm-pi-ai/anthropic` bertipe `grant` dengan payload `{type: oauth, access,
  refresh, expires}` adalah format yang persis dibaca adapter; pi-ai memakai
  `toAuth(credential) = {apiKey: access}` lalu menyegarkan lewat `refresh`.
- Karena tidak ada `apiKeyEnv` pada route, kredensial diambil dari store DSH, bukan dari
  environment.

---

## 6. Model baru tidak muncul

Katalog berasal dari snapshot pi-ai di DSH. Untuk menambah/membatasi model, tulis daftar
lengkap di bawah route — daftar ini menggantikan katalog:

```yaml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      anthropic:
        models:
          - id: claude-opus-5-5
            name: Claude Opus 5.5
            contextWindow: 1000000
            maxTokens: 128000
            input: [text, image]
          - id: claude-sonnet-5-5
            name: Claude Sonnet 5.5
            contextWindow: 1000000
            maxTokens: 128000
            input: [text, image]
```

Kalau ID model salah, request gagal dengan `UNKNOWN_MODEL` sebelum jaringan dipanggil.

### 6b. Cek model terbaru dan uji semua model

```bash
node claude-oauth-login.mjs --probe          # uji semua model, tandai OK / GAGAL
node claude-oauth-login.mjs --emit-models    # probe + cetak blok YAML hanya model yang hidup
node claude-oauth-login.mjs --probe --json   # hasil mesin-terbaca
```

`--probe` membaca `GET /v1/models` (daftar yang benar-benar ditawarkan akun Anda) lalu
mengirim satu request kecil ke **setiap** id: irisan katalog snapshot DSH + daftar akun
+ `--extra id1,id2`. Model yang dijawab `429` dicoba ulang sekali; `404`/`400` berarti
model tidak tersedia untuk akun itu; `401` berarti token perlu di-refresh.

Hasil di mesin penulis (6 Nov 2026): **17/17 model bisa dipakai**, tidak ada yang mati —
termasuk alias tanpa tanggal (`claude-opus-4-5`, `claude-sonnet-4-5`, `claude-haiku-4-5`).
Karena tidak ada model mati, `anthropic: {}` (katalog penuh) tetap dipakai. Kalau nanti ada
yang mati, jalankan `--emit-models` dan tempel blok `models:` hasilnya.

Jalur yang lebih ramping (hanya lineup aktif) bisa ditulis manual:

```yaml
      anthropic:
        models:
          - { id: claude-fable-5-1, name: Claude Fable 5.1, contextWindow: 1000000, maxTokens: 128000, input: [text, image] }
          - { id: claude-opus-5-5,  name: Claude Opus 5.5,  contextWindow: 1000000, maxTokens: 128000, input: [text, image] }
          - { id: claude-sonnet-5-5, name: Claude Sonnet 5.5, contextWindow: 1000000, maxTokens: 128000, input: [text, image] }
          - { id: claude-haiku-5-5, name: Claude Haiku 5.5, contextWindow: 1000000, maxTokens: 128000, input: [text, image] }
```

Lineup aktif per Nov 2026 (dari [Models overview](https://platform.claude.com/docs/en/models/overview)):
Fable 5.1 (US$10/50 per MTok), Opus 5.5 (US$4/20), Sonnet 5.5 (US$2/10),
Haiku 5.5 (dari US$0.10/0.50) — semuanya konteks 1M dan output maksimum 128K.

### 6c. Mengatur urutan model di picker

**Ya, urutan bisa diatur.** Urutan model di picker mengikuti urutan array `models:`
pada route, apa adanya:

1. `models:` di `cordis.patch.yml` → `ctx.llm.listModels()` → katalog browser →
   daftar di picker. Tidak ada pengurutan ulang alfabetis.
2. Slot pencarian (`rankByName`) hanya mengurutkan ulang saat kotak pencarian berisi
   query; dengan query kosong array dikembalikan pada urutan aslinya.
3. Urutan **provider** (grup) mengikuti urutan kunci di `providers:`, kecuali
   `deepseek-account` dan `deepseek-official` yang selalu dipaku di dua posisi teratas.

Jadi untuk menaruh Opus 5.5 → Fable 5.1 → Sonnet 5.5 → Haiku 5.5 → model lama, cukup
tulis array dengan urutan itu (sudah diterapkan di profil penulis):

```yaml
      anthropic:
        models:
          - id: claude-opus-5-5
            name: Claude Opus 5.5
            contextWindow: 1000000
            maxTokens: 128000
            input: [text, image]
          - id: claude-fable-5-1
            ...
```

Alternatif tanpa edit file: **Settings → Models → baris Anthropic → drag handle model
ke atas/bawah → Apply**. Halaman itu menulis array yang sama, jadi urutannya identik.

Catatan: begitu `models:` ditulis eksplisit, katalog tidak lagi diwarisi — model baru
dari pembaruan DSH tidak otomatis muncul sampai ditambahkan (atau `models:` dihapus
untuk kembali ke `anthropic: {}`).

---

## 7. Troubleshooting

| Gejala | Penyebab / solusi |
|---|---|
| Browser menampilkan "Just a moment…" / 403 | Itu challenge Cloudflare di `claude.ai`; tunggu lalu loloskan. Bukan masalah skrip. Kalau tetap, coba mode `--copy-code`. |
| `Tukar authorization code gagal (HTTP 400)` | Kode kedaluwarsa/terpakai. Ulangi login; jangan pakai kode dari percobaan sebelumnya. |
| `HTTP 429 rate_limit_error` saat menukar token | Rate limit IP di endpoint OAuth Anthropic. Tunggu beberapa menit lalu ulangi. |
| `--verify` → `HTTP 401` | Token tidak valid/dicabut. `--refresh`, kalau masih gagal login ulang. |
| Model Claude tidak muncul di picker | Route `anthropic` belum dideklarasikan, atau DSH belum di-restart. Cek `--print-path`. |
| `MISSING_CREDENTIAL` di log DSH | Route memakai `apiKeyEnv` yang tidak punya nilai. Hapus `apiKeyEnv` agar memakai record OAuth. |
| `UNSTORABLE_PROVIDER_ID` | Terjadi bila id provider bukan identifier huruf kecil bertanda hubung; `anthropic` aman. |
| `claude` tidak ditemukan saat `--from-claude-code` | Jalur impor butuh Claude Code; jalur login biasa tidak butuh. |
| Node tidak ada | Pakai Node bawaan DSH Desktop: `/Applications/DeepSeek\ Harness.app/Contents/Resources/runtime/**/bin/node`, atau pasang Node 18+. |

Log DSH: `~/Library/Logs/DeepSeek Harness/` (macOS) atau terminal tempat `dsh web` jalan.

---

## 8. Keamanan dan kebijakan

- Token disimpan di `~/.dsh/.credentials.yaml` dengan mode `0600`, backup sebelum
  penulisan, dan penulisan atomik. Skrip tidak mencetak token dan tidak mengirimnya ke
  mana pun selain `platform.claude.com` dan `api.anthropic.com`.
- **Kebijakan Anthropic**: OAuth langganan ditujukan untuk pemakaian Claude Code dan
  aplikasi native Anthropic. [Ketentuan mereka](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)
  melarang developer pihak ketiga menawarkan/mengarahkan login langganan untuk pengguna
  lain, dan Anthropic berhak menegakkan aturan ini. Memakai token langganan Anda sendiri
  di klien lain adalah area kelabu: risikonya (mis. pembatasan akun) ditanggung sendiri.
- **Alternatif yang jelas didukung**: jalankan Claude Code asli sebagai *subagent* di DSH
  memakai login native-nya — lihat bagian 9.

---

## 9. Alternatif resmi: Claude Code sebagai subagent DSH

Kalau yang dibutuhkan adalah "kemampuan Claude Code" di dalam DSH (bukan model chat
utama), pakai bundle **`@deepseek-ai/dsh-subagent-claude-code`**. Bundle ini menjalankan
binary Claude Code asli dengan login/setting native Anda, lalu mengekspos tool
`subagent_claude_code` ke agent DSH.

Di profil `desktop` Anda, paket **0.2.1-rc.5 sudah terpasang tetapi diblokir** karena
butuh DSH `0.2.1-rc.5` (runtime Anda `0.2.2-rc.1`). Versi yang cocok sudah tersedia:

```bash
# cek versi terpasang vs runtime
cat ~/.dsh/profiles/desktop/package.json | grep subagent-claude-code
npm view @deepseek-ai/dsh-subagent-claude-code@0.2.2-rc.1 version   # → 0.2.2-rc.1
```

Langkah:

1. Buka **Settings → Plugins** (katalog Official), cari **Claude Code subagent**.
2. Pasang/Enable versi **0.2.2-rc.1** (atau hapus 0.2.1-rc.5 lalu pasang ulang).
3. Restart DSH bila diminta. Tool `subagent_claude_code` muncul untuk semua agent.
4. Pastikan `claude auth login` sudah dilakukan — subagent memakai login native, bukan
   record OAuth di atas.

Konfigurasi opsional (model & izin) lewat patch:

```yaml
- id: subagent-claude-code
  name: '@deepseek-ai/dsh-subagent-claude-code'
  config:
    providerName: claude-code
    model: claude-opus-5-5        # opsional; tanpa ini ikut setting Claude Code
    permissionMode: dontAsk      # dontAsk | acceptEdits | auto | plan | bypassPermissions
```

Bedanya dengan jalur OAuth di atas:

| | OAuth `anthropic` (bagian 2–6) | Subagent Claude Code (bagian 9) |
|---|---|---|
| Model Claude jadi model chat DSH | ✅ | ❌ (delegasi, bukan model utama) |
| Memakai login langganan native | ⚠️ token OAuth terpisah | ✅ login Claude Code apa adanya |
| Tool & perilaku Claude Code asli | ❌ (hanya model) | ✅ |
| Konteks/token | masuk konteks chat DSH | terisolasi, hanya hasil akhir |
| Dukungan resmi DSH | jalur token tidak resmi | ✅ bundle resmi |

---

## 10. Ringkasan perintah

```bash
# 1) login + simpan + verifikasi
node claude-oauth-login.mjs

# 2) deklarasikan route (GUI) atau:
#    ~/.dsh/profiles/desktop/cordis.patch.yml → providers: anthropic: {}

# 3) cek
node claude-oauth-login.mjs --print-path
node claude-oauth-login.mjs --verify
```
