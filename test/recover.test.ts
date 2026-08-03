import { test, expect } from "bun:test";
import { extractTail, latestTranscript } from "../src/recover";

const mk = (o: unknown) => JSON.stringify(o);

test("giữ text người và model, kèm nhãn vai", () => {
  const out = extractTail([
    mk({ message: { role: "user", content: "sửa bug login" } }),
    mk({ message: { role: "assistant", content: [{ type: "text", text: "đã sửa ở auth.ts:42" }] } }),
  ], 10);
  expect(out).toContain("sửa bug login");
  expect(out).toContain("auth.ts:42");
});

test("tool_result dài bị cắt — đây chính là thứ làm transcript phình", () => {
  const huge = "x".repeat(5000);
  const out = extractTail([
    mk({ message: { role: "user", content: [{ type: "tool_result", content: [{ type: "text", text: huge }] }] } }),
  ], 10);
  expect(out.length).toBeLessThan(1000);
  expect(out).toContain("kết quả");
});

test("bỏ thinking (không lưu được và không cần cho phiên sau)", () => {
  const out = extractTail([
    mk({ message: { role: "assistant", content: [
      { type: "thinking", thinking: "ĐÂY LÀ SUY NGHĨ" },
      { type: "text", text: "kết luận" },
    ] } }),
  ], 10);
  expect(out).not.toContain("ĐÂY LÀ SUY NGHĨ");
  expect(out).toContain("kết luận");
});

test("tool_use giữ tên công cụ + input đã cắt, để biết đang đụng file nào", () => {
  const out = extractTail([
    mk({ message: { role: "assistant", content: [
      { type: "tool_use", name: "Edit", input: { file_path: "src/a.ts", new_string: "y".repeat(3000) } },
    ] } }),
  ], 10);
  expect(out).toContain("Edit");
  expect(out).toContain("src/a.ts");
  expect(out.length).toBeLessThan(600);
});

test("chỉ lấy N message cuối", () => {
  const lines = Array.from({ length: 50 }, (_, i) =>
    mk({ message: { role: "user", content: `tin ${i}` } }));
  const out = extractTail(lines, 3);
  expect(out).toContain("tin 49");
  expect(out).not.toContain("tin 40");
});

test("dòng hỏng bị bỏ qua, không làm chết cả bản trích", () => {
  const out = extractTail(["{hỏng", mk({ message: { role: "user", content: "còn đây" } })], 10);
  expect(out).toContain("còn đây");
});

test("không có gì dùng được => chuỗi rỗng (caller tự quyết báo gì)", () => {
  expect(extractTail(["{hỏng"], 10)).toBe("");
});

test("latestTranscript: thư mục không tồn tại => null, không ném", () => {
  expect(latestTranscript("/khong/co/thu/muc/nay")).toBeNull();
});
