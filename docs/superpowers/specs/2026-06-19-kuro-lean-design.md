# kuro-lean — Design Spec

- **Ngày**: 2026-06-19
- **Tác giả**: Kuro (cho Vũ Đức Tuấn)
- **Trạng thái**: Approved (chờ implementation plan)

## 1. Mục tiêu

Một CLI tool độc lập (`kt`) viết bằng Bun + TypeScript, giảm token Claude Code tiêu thụ
bằng cách **cắt thứ đi vào context** — không bằng cách bắt model trả lời cụt lủn.

Học cơ chế của RTK (nén output lệnh shell trước khi vào context) nhưng:
- Viết Bun+TS (khớp stack `my-assistant`, dễ maintain) thay vì Rust.
- Tích hợp sâu vào Claude Code qua hooks + statusline + skill.
- An toàn theo nguyên tắc **nén nhiễu, giữ tín hiệu** — không bao giờ nuốt thông tin model cần.

### Non-goals (v1)
- Không nén lịch sử hội thoại / context API-layer (rủi ro mất thông tin cao — đó là cái headroom-compress làm, ta bỏ).
- Không làm desktop app / tray.
- Không đổi văn phong model kiểu "caveman".
- Không hỗ trợ Windows native trong v1 (macOS/Linux trước; WSL chạy được).

## 2. Nguyên tắc thiết kế (xương sống)

> **Nén phần nhiễu, giữ nguyên phần tín hiệu.**

- Test **pass** → 1 dòng summary. Test **fail** → in ĐẦY ĐỦ phần lỗi.
- Build OK → 1 dòng. Có error/warning → giữ nguyên error/warning.
- Nén lỗi (compressor throw) → **fallback in raw**. Không bao giờ nuốt output.
- **Exit code gốc luôn được giữ nguyên** (để Claude/hook phía sau biết lệnh fail).
- Full output luôn được lưu lại → bypass được khi cần debug.

## 3. Kiến trúc

### 3.1 Cơ chế tích hợp (Approach A — đã chốt)

PreToolUse hook tự **rewrite** Bash command trước khi thực thi:

```
"npm test"  →  "kt run -- npm test"
```

Model không cần biết gì. So với:
- (B) chỉ skill nhắc tự gọi `kt` → dễ quên, loại.
- (C) PATH shim thay `git`/`npm` → dễ vỡ môi trường, loại.

### 3.2 Luồng dữ liệu

```
Claude chạy Bash "npm test"
  → [guard hook]    chặn/cảnh báo nếu là lệnh ngốn token (find /, cat file lớn…)
  → [compress hook] rewrite: "kt run -- npm test"
  → kt run:
       runner.spawn(npm test) → capture stdout/stderr/exitCode
       detect(command) → chọn profile (test)
       compressors/test(raw) → compact text + stats
       lưu FULL → .kt/runs/<id>.log
       in COMPACT ra stdout + dòng "↳ full: kt show <id>"
       process.exit(exitCode gốc)
```

### 3.3 Cấu trúc thư mục

```
kuro-lean/
├── src/
│   ├── cli.ts              # entry: kt run | status | init | show | doctor
│   ├── runner.ts           # spawn lệnh, capture stdout/stderr, giữ exitCode
│   ├── detect.ts           # command → profile name
│   ├── config.ts           # đọc/merge kt.json + default
│   ├── compressors/
│   │   ├── index.ts        # registry: profile → compressor fn
│   │   ├── types.ts        # CompressInput / CompressResult
│   │   ├── test.ts         # jest/vitest/bun test/go test/cargo test
│   │   ├── build.ts        # tsc/cargo build/webpack/vite build
│   │   ├── install.ts      # npm/pnpm/yarn/bun install
│   │   ├── git.ts          # git status / git diff / git log
│   │   └── generic.ts      # fallback: giữ đầu N + đuôi M dòng
│   ├── statusline.ts       # đọc session JSONL → context % + token + $
│   ├── store.ts            # .kt/runs/ lưu & đọc full log theo id
│   └── hooks/
│       ├── compress.ts     # PreToolUse: rewrite command → kt run
│       └── guard.ts        # PreToolUse: chặn/cảnh báo lệnh ngốn token
├── skills/
│   └── concise-output.md   # bỏ preamble/postamble thừa, VẪN tiếng người dễ đọc
├── test/
│   ├── fixtures/           # output thật của vitest/go test/git diff…
│   └── *.test.ts           # bun test, golden assertions
├── kt.json                 # config mặc định
├── package.json
├── tsconfig.json
└── README.md
```

## 4. Đặc tả từng thành phần

### 4.1 `runner.ts`
- API: `run(argv: string[], opts): Promise<{ stdout, stderr, exitCode, durationMs }>`.
- Spawn qua `Bun.spawn`, capture stdout+stderr riêng, stream-collect (không block trên buffer lớn).
- Bảo toàn exit code, đo thời gian chạy.
- `KT_RAW=1` hoặc `--raw` → chạy passthrough, không nén (in trực tiếp).

### 4.2 `detect.ts`
- Input: command string (đã bỏ tiền tố `kt run --`).
- Map regex → profile: `test | build | install | git | generic`.
- Bảng nhận diện tối thiểu (v1):
  - test: `\b(jest|vitest|bun test|go test|cargo test|pytest|npm (run )?test|pnpm test)\b`
  - build: `\b(tsc|cargo build|webpack|vite build|next build|go build)\b`
  - install: `\b(npm (i|install)|pnpm (i|install|add)|yarn|bun (i|install|add))\b`
  - git: `\bgit (status|diff|log)\b`
  - còn lại → `generic` (chỉ nén nếu output > ngưỡng).

### 4.3 `compressors/` (mỗi module là pure function)
- Type: `(input: CompressInput) => CompressResult`
  - `CompressInput = { stdout, stderr, exitCode, command }`
  - `CompressResult = { text: string, savedFrom?: number, note?: string }`
- **test.ts**: parse summary count (passed/failed). Nếu `exitCode===0` & 0 fail → 1 dòng `✓ 42 passed (3.1s)`. Nếu có fail → giữ NGUYÊN block của các test fail + summary, cắt phần pass.
- **build.ts**: `exitCode===0` & không có warning → 1 dòng. Có error/warning → giữ nguyên các dòng `error`/`warning`, cắt log thường.
- **install.ts**: giữ dòng kết quả cuối (`added N packages`) + bất kỳ dòng `warn`/`error`/`peer`/`deprecated`. Cắt progress.
- **git.ts**: `status` → đếm theo nhóm (staged/modified/untracked) + liệt kê path gọn. `diff` → ưu tiên `--stat`; nếu input là diff đầy đủ thì rút về per-file stat + giữ tối đa K dòng hunk/file (configurable).
- **generic.ts**: nếu output ≤ ngưỡng → trả nguyên. Nếu vượt → giữ `head N` + `tail M` dòng, chèn `… [X dòng đã ẩn — kt show <id>] …`.
- **Quy tắc chung**: mọi compressor bọc trong try/catch ở tầng gọi → throw thì fallback raw.

### 4.4 `store.ts`
- Lưu full log: `.kt/runs/<id>.log` (id = counter ngắn hoặc timestamp truyền vào — **không** dùng `Date.now()` bên trong test).
- `kt show <id>` in lại full. `kt show` (không id) → bản gần nhất.
- Tự dọn: giữ tối đa N file gần nhất (config, mặc định 50).

### 4.5 `statusline.ts`
- Claude Code statusline truyền JSON qua stdin có sẵn object `context_window`
  (`used_percentage`, `total_input_tokens`, `total_output_tokens`, `context_window_size`),
  `model.display_name`, và `cost.total_cost_usd`. **Không cần parse transcript JSONL.**
- Output 1 dòng: `🟢 42% ctx · ~84k tok · $0.31` — ngưỡng màu 🟢<warnPct / 🟡<dangerPct / 🔴≥dangerPct (configurable).
- Token = `total_input_tokens + total_output_tokens`; %  ưu tiên `used_percentage`, fallback tự tính.
- Thiếu field → degrade gọn (`~? ctx`), không crash.

### 4.6 `hooks/compress.ts` (PreToolUse, matcher: Bash)
- Đọc hook input JSON (stdin) → lấy `tool_input.command`.
- Bỏ qua nếu: đã bắt đầu bằng `kt `, có pipe/redirect/`&&`/`;` phức tạp, hoặc `KT_DISABLE=1`.
- Khớp `detect()` ra profile ≠ null → trả về quyết định rewrite command thành `kt run -- <command>`.
- Cơ chế rewrite tuân theo Claude Code hook contract (updated `tool_input` / `permissionDecision`), xác định chính xác lúc implement.

### 4.7 `hooks/guard.ts` (PreToolUse, matcher: Bash)
- Phát hiện lệnh ngốn token: `find /` (không scope), `cat`/`head`/`tail` file > ngưỡng kb, `npm ls` không `--depth`, `tree` không `-L`, in toàn bộ `node_modules`…
- Hành vi: cảnh báo + gợi ý lệnh thay thế gọn hơn (deny mềm với lý do, không cứng nhắc).
- Danh sách rule trong config, bật/tắt được.

### 4.8 `skills/concise-output.md`
- Skill hướng dẫn em bỏ preamble/postamble thừa ("Let me…", "I'll now…", lặp lại đề bài) nhưng **vẫn tiếng Việt/Anh đầy đủ, dễ đọc**. Không phải caveman.

### 4.9 `cli.ts`
- `kt run -- <command>`: cơ chế chính (mục 3.2).
- `kt status`: nhận stdin JSON của statusline → in 1 dòng.
- `kt init`: cài hooks + statusline vào `~/.claude/settings.json` (idempotent, backup file cũ).
- `kt show [id]`: in full log.
- `kt doctor`: kiểm tra cài đặt (hook đã đăng ký? bun? quyền ghi `.kt/`?).

## 5. Config (`kt.json`)

```jsonc
{
  "profiles": { "test": true, "build": true, "install": true, "git": true, "generic": true },
  "generic": { "thresholdLines": 40, "headLines": 15, "tailLines": 10 },
  "git": { "maxHunkLinesPerFile": 20 },
  "store": { "keepRuns": 50 },
  "statusline": { "warnPct": 60, "dangerPct": 85, "pricePerMTokIn": 0, "pricePerMTokOut": 0 },
  "guard": { "maxCatKb": 100, "rules": { "findRoot": true, "npmLs": true, "treeNoDepth": true } }
}
```

## 6. Error handling
- Compressor throw → log nội bộ, in raw, giữ exit code.
- `kt run` không nhận diện được lệnh → generic (chỉ nén nếu vượt ngưỡng).
- Hook lỗi parse stdin → no-op (để lệnh chạy bình thường), không bao giờ chặn nhầm.
- Ghi `.kt/` thất bại (quyền) → vẫn in compact, bỏ qua lưu full + cảnh báo 1 dòng.

## 7. Testing
- `bun test`. Mỗi compressor có golden fixtures = output THẬT (vitest/go test/git diff/npm install) trong `test/fixtures/`.
- Test các nhánh: pass-only, có-fail (phải giữ lỗi), output rỗng, output khổng lồ (generic cắt đúng).
- `detect.ts`: bảng case command → profile.
- `runner.ts`: lệnh exit code ≠ 0 phải bảo toàn.
- Không dùng `Date.now()`/`Math.random()` trong code path test được (id truyền vào để test deterministic).

## 8. Thứ tự build đề xuất (cho implementation plan)
1. Scaffold (package.json, tsconfig, bun test chạy được).
2. `types` + `runner` + `detect` + `generic` compressor + `store` (lõi `kt run` chạy được end-to-end với generic).
3. Compressors: test → build → install → git (kèm fixtures).
4. `cli` (run/show/doctor).
5. `statusline`.
6. `hooks/compress` + `hooks/guard`.
7. `kt init` (cài vào settings.json) + skill concise-output.
8. README + smoke test thủ công trong 1 phiên Claude Code thật.

## 9. Tiêu chí hoàn thành (Definition of Done v1)
- `kt run -- <cmd>` nén đúng 5 profile, giữ lỗi, bảo toàn exit code, lưu full + `kt show`.
- `kt init` đăng ký hook + statusline; `kt doctor` xác nhận.
- Statusline hiển thị % context thật.
- Guard chặn được ≥3 loại lệnh ngốn token.
- `bun test` xanh với golden fixtures.
- Đo thực tế: 1 phiên coding có dùng test/build/git → token input giảm rõ rệt so với không dùng (ghi lại con số trong README).
