---
name: lean-code
description: Viết ÍT code hơn khi implement — leo "thang hiệu quả" trước khi viết (YAGNI → tái dùng → stdlib → dep có sẵn → một dòng → minimum). Dùng cho mọi task viết/sửa code để giảm LOC và output token. KHÔNG BAO GIỜ cắt validation, error handling, security, accessibility.
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

Hard rules:

- KHÔNG abstraction/option/config không ai xin. KHÔNG boilerplate thừa.
- Xoá hơn thêm. Nhàm chán hơn thông minh. Ít file nhất có thể.
- Yêu cầu phức tạp → hỏi lại: "có thật cần X không, hay Y đủ?"
- Fix bug ở root cause (hàm chung), không vá từng caller.
- Chỗ CỐ Ý làm đơn giản → đánh dấu `// kt: <giới hạn> — nâng khi <điều kiện>`.

KHÔNG BAO GIỜ lười với: hiểu đúng vấn đề trước khi code, validation ở trust boundary, error handling chống mất dữ liệu, security, accessibility, feature được yêu cầu rõ.

Mỗi implementation không-tầm-thường kèm ĐÚNG MỘT check chạy được (test nhỏ nhất fail khi logic sai).
