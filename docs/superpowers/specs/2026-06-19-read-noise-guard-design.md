# Design: `readNoise` guard — chặn Read file nhiễu

Ngày: 2026-06-19

## Vấn đề
kt hiện chỉ nén output **Bash**. Khi agent đọc-hiểu codebase, phần lớn token đến từ
**Read/Grep** (tool riêng, không qua Bash) nên kt không chạm tới. Read đã tự cap 2000 dòng,
nên "đổ nguyên file" không phải vấn đề lớn — nhưng agent vẫn có thể đọc **file nhiễu**
(lock files, minified, generated) tốn 2000 dòng rác vào context.

## Mục tiêu (scope tối giản — đã chốt qua brainstorm)
Mở rộng **guard** sang tool **Read**: chặn việc đọc **cả file nhiễu**, kèm gợi ý.
- KHÔNG auto-limit file code (Read đã cap 2000).
- KHÔNG đụng Grep.
- Chỉ Claude Code (dựa PreToolUse hook), nhất quán phần còn lại của kt.

## Phát hiện "nhiễu" — deny nếu dính 1 nhóm
1. **Lock files** (tên file): `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`,
   `npm-shrinkwrap.json`, `go.sum`, `Cargo.lock`, `composer.lock`, `Gemfile.lock`,
   `poetry.lock`, `Pipfile.lock`, `flake.lock`.
2. **Generated/minified** (đuôi): `*.min.js`, `*.min.css`, `*.map`.
3. **Thư mục vendor/build** (path chứa): `/node_modules/`, `/dist/`, `/build/`, `/.next/`,
   `/out/`, `/vendor/`, `/coverage/`.
4. **File quá lớn** (size): `> guard.maxReadKb` (mặc định 500 KB).

## Cửa thoát (cho đọc có chủ đích)
- Read kèm `offset`, HOẶC `limit` ≤ 400 → **cho qua** (agent cố ý xem 1 đoạn).
- `KT_DISABLE=1` → bỏ qua guard.
- `guard.rules.readNoise=false` → tắt rule.

## Hành vi
PreToolUse trên matcher `Read` → `permissionDecision: "deny"` + reason gợi ý
(đọc kèm `limit` nhỏ / dùng Grep / `KT_DISABLE=1`).

## Kiến trúc
- `src/hooks/guard.ts`: thêm hàm pure `checkNoisyRead(input, cfg) → string | null`
  (cạnh `checkCatBig`). `input = { file_path, offset?, limit? }`.
- `src/cli.ts`: case `hook-guard` rẽ nhánh theo `tool_name` — `Bash` → `decideGuard` (cũ),
  `Read` → `checkNoisyRead`. Honor `KT_DISABLE`.
- `src/init.ts`: đăng ký thêm matcher `Read` → `kt hook-guard` (idempotent).
- `src/config.ts` + `kt.json`: thêm `guard.maxReadKb: 500`, `guard.rules.readNoise: true`.

## Test
- Bảng case `checkNoisyRead`: lock/min/map/dir/size đều deny; file code thường → null;
  cửa thoát (offset/limit nhỏ) → null; rule tắt → null.
- `init`: đăng ký matcher Read idempotent.

## Phạm vi không làm (YAGNI)
auto-limit file code, can thiệp Grep, PostToolUse nén nội dung, hỗ trợ tool ngoài Claude Code.
