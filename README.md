# kuro-lean (`kt`)

CLI giảm token Claude Code: nén output lệnh shell, đo context, chặn lệnh ngốn token.
Nguyên tắc: **nén nhiễu, giữ tín hiệu** — test fail/error luôn in đầy đủ.

## Cài
```bash
bun link            # cho kt vào PATH
kt init             # đăng ký PreToolUse hook (+ statusline nếu chưa có) vào ~/.claude/settings.json
kt doctor           # kiểm tra
```
- `kt init` **không ghi đè** statusLine custom của bạn — chỉ set `kt status` khi bạn CHƯA có statusLine. Tự backup `.bak` trước khi đổi, idempotent.
- Sau khi cài, lệnh bị rewrite thành `kt run -- ...`. Thêm `Bash(kt run:*)` vào `permissions.allow` (hoặc bấm "always allow" lần đầu) để khỏi bị hỏi.

## Bypass / tắt
- `KT_RAW=1 kt run -- <cmd>` — chạy không nén.
- `KT_DISABLE=1` — hook không rewrite (kill-switch).

## Subcommand
- `kt run -- <cmd>`  chạy lệnh, in bản nén, lưu full
- `kt show [id]`     xem full log
- `kt status`        statusline (đọc JSON stdin)
- `kt init` / `kt doctor`


## Kết quả đo (đo thật trên repo này, 2026-06-19)

Token ước lượng ~ ký tự/4. Đo bằng `bash scripts/measure.sh`.

| Lệnh | Trước (ký tự) | Sau (ký tự) | Tiết kiệm |
|------|--------------:|------------:|-----------|
| `git diff HEAD~10 HEAD` | 21.157 (~5.3k tok) | 504 (~126 tok) | **98%** |
| `bun test` (pass) | 103 | 89 | 14% |
| `git log --oneline -20` (nhỏ) | 1.310 | 1.310 | 0% (giữ nguyên — đúng) |
| `git status` (nhỏ) | 409 | 409 | 0% (giữ nguyên — đúng) |

**Nhận xét:**
- Đòn lớn nhất là output dài (diff, test/build ồn ào, log lỗi) — `git diff` tiết kiệm ~98%.
- Output đã gọn (`git status`, `git log` ngắn) → **không nén** (tránh làm hỏng tín hiệu). Đây là chủ đích.
- `bun test` tiết kiệm ít vì output bun vốn rất ngắn; ở dự án dùng jest/vitest/go test (output dài) mức tiết kiệm cao hơn nhiều.
- **Test/build fail luôn giữ NGUYÊN block lỗi** (đã verify: `bun test` fail → giữ đủ `Expected/Received` + stacktrace, exit code bảo toàn).
