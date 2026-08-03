---
name: lean-code
description: Viết ÍT hơn khi implement — leo "thang hiệu quả" trước khi viết (YAGNI → tái dùng → stdlib → dep có sẵn → một dòng → minimum), và áp cùng kỷ luật đó cho TÀI LIỆU, thứ chiếm phần lớn chữ viết ra. Dùng cho mọi task viết/sửa code. KHÔNG BAO GIỜ cắt validation, error handling, security, accessibility.
---

# Lean Code

Trước khi viết code, dừng ở nấc ĐẦU TIÊN thỏa:

1. Có cần tồn tại không? Không → đừng viết (YAGNI).
2. Codebase đã có helper/pattern làm việc này? → tái dùng.
3. Stdlib làm được? → dùng stdlib.
4. Platform có sẵn tính năng native? → dùng nó.
5. Dependency ĐÃ CÀI làm được? → dùng nó (không thêm dep mới).
6. Một dòng đủ? → viết một dòng.
7. Chỉ khi đó: viết minimum code chạy được.

## Tài liệu cũng tính

Đo thật: **60% chữ ghi ra bằng `Write` là `.md`**, không phải code — plan, spec, báo cáo; file
lớn nhất tới 112k ký tự. Thang trên áp cho tài liệu y hệt:

- Tài liệu dài không làm kế hoạch tốt hơn. Viết đủ để thực thi được, rồi dừng.
- Không dựng section rỗng cho đủ khuôn mẫu ("Rủi ro: không có", "Phụ lục: N/A") — bỏ hẳn mục đó.
- Không chép lại vào tài liệu thứ đã có trong code, trong issue, hay trong đoạn hội thoại ngay trên.
- Một bảng thay được ba đoạn văn thì dùng bảng.
- Tài liệu tạm (plan/spec cho một task) sống ngắn — đừng đánh bóng nó như tài liệu sản phẩm.

## Chọn đúng công cụ ghi

- Sửa file đã có → `Edit`, đừng `Write` lại cả file. (Trung vị một `Edit` là 633 ký tự,
  một `Write` là 3.028 — ghi đè cả file để đổi vài dòng đắt gấp ~5 lần và dễ mất nội dung khác.)
- Đừng viết file bằng heredoc trong `Bash` khi `Write`/`Edit` làm được — heredoc đang chiếm
  35% ký tự của các lệnh Bash, và nó không có kiểm tra ghi đè.

## Hard rules

- KHÔNG abstraction/option/config không ai xin. KHÔNG boilerplate thừa.
- Xoá hơn thêm. Nhàm chán hơn thông minh. Ít file nhất có thể.
- Yêu cầu phức tạp → hỏi lại: "có thật cần X không, hay Y đủ?"
- Fix bug ở root cause (hàm chung), không vá từng caller.
- Chỗ CỐ Ý làm đơn giản → đánh dấu `// kt: <giới hạn> — nâng khi <điều kiện>`.
- Comment chỉ để nói ràng buộc mà code không tự nói được — không thuật lại dòng kế tiếp.

KHÔNG BAO GIỜ lười với: hiểu đúng vấn đề trước khi code, validation ở trust boundary, error
handling chống mất dữ liệu, security, accessibility, feature được yêu cầu rõ.

Mỗi implementation không-tầm-thường kèm ĐÚNG MỘT check chạy được (test nhỏ nhất fail khi logic sai).
