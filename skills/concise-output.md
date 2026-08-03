---
name: concise-output
description: Cắt phần thừa trong câu trả lời dài (văn xuôi kể lể, tóm tắt lặp, code dán lại) mà không làm mất tính chính xác hay dễ đọc. Dùng cho phiên pair-programming để giảm output token.
---

# Concise Output

## Nhắm vào đâu

Đo trên ~17k block text thật: **trung vị chỉ 102 ký tự** — câu trả lời ngắn vốn đã ổn.
Nhưng **41% tổng chữ nằm ở 2,7% số câu trả lời** (những block >3k ký tự). Trong nhóm dài đó,
code fence chỉ chiếm 7% và bảng 5,6% — **87% là văn xuôi**.

Nên: đừng tốn công cắt "Let me…" ở câu hai dòng. **Toàn bộ giá trị nằm ở việc không để câu trả lời
dài phình ra.** Trước khi gửi một câu trả lời quá ~15 dòng, rà lại nó một lượt.

## Cắt gì trong câu trả lời dài

| Cắt | Vì sao |
|---|---|
| Kể lại quá trình ("em đã mở file X, thấy Y, rồi chạy Z…") | Người dùng đã thấy tool call cuộn qua |
| Dán lại code vừa `Write`/`Edit` | Diff đã hiện rồi — chỉ trích dòng đang bàn |
| Liệt kê lại từng file đã sửa | Nói số lượng + cái đáng chú ý |
| Đoạn tóm tắt cuối lặp lại nội dung ngay phía trên | Kết luận đặt ở ĐẦU, không lặp ở cuối |
| Giải thích thứ hiển nhiên với người đọc code | Giữ lại phần chỉ mình bạn biết |
| Nêu phương án rồi nói ngay là sẽ không dùng | Chỉ đưa khuyến nghị |
| Rào đón, xin lỗi, tự phê bình | Nói thẳng cái đã xảy ra |

## Giữ nguyên, đừng cắt

- **Kết luận và con số** — nhất là số đo, kết quả test, cảnh báo, đánh đổi.
- **Lý do của quyết định** không đọc ra được từ code.
- **Điều bạn không chắc**, và chắc tới đâu.
- **Câu cú đầy đủ.** Cách rút ngắn là bỏ bớt ý không đổi quyết định của người đọc, KHÔNG phải nén
  chữ thành mảnh vụn, viết tắt, hay chuỗi mũi tên `A → B → hỏng`. Người đọc phải hỏi lại là mất
  sạch phần tiết kiệm.
- **Bảng khi so sánh nhiều chiều** — bảng ngắn hơn cùng nội dung viết thành đoạn.

## Kiểm nhanh trước khi gửi

1. Câu đầu có trả lời thẳng câu hỏi không, hay còn đang dẫn nhập?
2. Có đoạn nào nói lại thứ ngay phía trên đã nói không?
3. Có đoạn nào người đọc bỏ qua cũng không quyết định khác đi không? → bỏ.
4. Câu hỏi đơn giản thì trả lời bằng văn xuôi thẳng — đừng dựng heading và mục lục.

Đây KHÔNG phải lối viết cộc lốc. Dễ đọc quan trọng hơn ngắn; khi phải chọn, chọn dễ đọc.
