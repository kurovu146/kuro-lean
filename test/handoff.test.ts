import { test, expect } from "bun:test";
import { handoffPrompt } from "../src/handoff";

test("handoffPrompt nêu đủ khung để phiên mới tiếp tục mà không cần lịch sử", () => {
  const p = handoffPrompt(".kt/handoff.md");
  for (const muc of ["Đang làm", "Đã xong", "Quyết định", "Bước tiếp theo", "File", "Cạm bẫy"]) {
    expect(p).toContain(muc);
  }
});

test("handoffPrompt nhúng đúng đường dẫn file được yêu cầu", () => {
  expect(handoffPrompt("docs/state.md")).toContain("docs/state.md");
});

test("handoffPrompt cấm chép lại code — đó là thứ làm file phình vô ích", () => {
  expect(handoffPrompt(".kt/handoff.md").toLowerCase()).toContain("không chép");
});
