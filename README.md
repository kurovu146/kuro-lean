# kuro-lean (`kt`)

CLI giảm token Claude Code: nén output lệnh shell, đo context, chặn lệnh ngốn token.
Nguyên tắc: **nén nhiễu, giữ tín hiệu** — test fail/error luôn in đầy đủ.

## Cài
```bash
bun link            # cho kt vào PATH
kt init             # đăng ký hook + statusline vào ~/.claude/settings.json
kt doctor           # kiểm tra
```

## Subcommand
- `kt run -- <cmd>`  chạy lệnh, in bản nén, lưu full
- `kt show [id]`     xem full log
- `kt status`        statusline (đọc JSON stdin)
- `kt init` / `kt doctor`

## Bypass
- `KT_RAW=1 kt run -- <cmd>` hoặc xem `kt show`.

## Kết quả đo (điền sau smoke)
| Lệnh | Trước | Sau | Tiết kiệm |
|------|-------|-----|-----------|
| (điền sau khi smoke phiên thật) | | | |
