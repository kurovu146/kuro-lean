/**
 * Prompt chưng cất trạng thái phiên ra file, để phiên sau bắt đầu từ ~5k token
 * thay vì vác cả context cũ. Rẻ hơn resume hàng chục lần và context sau đó cũng nhẹ.
 */
export function handoffPrompt(file: string): string {
  return `Ghi trạng thái phiên này ra \`${file}\` để phiên sau tiếp tục được mà KHÔNG cần đọc lại lịch sử.

Theo đúng khung này:

## Đang làm
Mục tiêu của phiên, và phần nào đã chạm tới.

## Đã xong
Việc đã hoàn tất + commit/branch tương ứng (nếu có). Ghi rõ cái gì đã verify, verify bằng cách nào.

## Quyết định và lý do
Chỉ những quyết định mà đọc code không suy ra được — vì sao chọn hướng này thay vì hướng kia,
phương án nào đã thử và hỏng.

## Đang dở / Bước tiếp theo
Việc cụ thể tiếp theo phải làm, đủ chi tiết để bắt tay vào ngay.

## File đang đụng
Đường dẫn + số dòng nếu cần. KHÔNG chép nội dung file vào đây.

## Cạm bẫy đã gặp
Thứ đã mất thời gian mà lần sau dễ vấp lại.

Quy tắc:
- KHÔNG chép lại code, diff, hay output lệnh — chỉ đường dẫn và số dòng.
- KHÔNG viết lại thứ đã có trong git log, README, hay comment trong code.
- Bỏ hẳn mục nào không có nội dung, đừng ghi "không có".
- Viết cho chính mình đọc sau vài ngày: đủ để hành động, không phải báo cáo.

Ghi xong thì nói cho tôi đường dẫn và số dòng của file, không tóm tắt lại nội dung.`;
}
