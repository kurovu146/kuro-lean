import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { listSessions, parseHandoffArgs, renderSessions, resolveFrom } from "../src/sessions";
import { defaultConfig } from "../src/config";

const tmp = () => mkdtempSync(join(tmpdir(), "kt-sessions-"));

/** Dựng một transcript giả: dòng meta (cwd/branch) + dòng usage, rồi lùi mtime. */
function fakeSession(
  root: string,
  slug: string,
  file: string,
  o: { cwd: string; branch: string; tokens: number; idleMin: number; pad?: number },
): string {
  const dir = join(root, slug);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, file);
  const lines = [
    JSON.stringify({ type: "user", cwd: o.cwd, gitBranch: o.branch }),
    JSON.stringify({ message: { role: "user", content: "x".repeat(o.pad ?? 0) } }),
    JSON.stringify({ message: { model: "claude-opus-5", usage: { cache_read_input_tokens: o.tokens } } }),
  ];
  writeFileSync(p, lines.join("\n") + "\n");
  const t = new Date(Date.now() - o.idleMin * 60_000);
  utimesSync(p, t, t);
  return p;
}

test("liệt kê phiên toàn máy: mới nhất lên đầu, kèm repo/branch/token của lượt cuối", () => {
  const root = tmp();
  fakeSession(root, "-Users-kuro-Dev-mot", "a.jsonl", {
    cwd: "/Users/kuro/Dev/mot", branch: "main", tokens: 96_000, idleMin: 10, pad: 3000,
  });
  fakeSession(root, "-Users-kuro-Dev-hai", "b.jsonl", {
    cwd: "/Users/kuro/Dev/hai", branch: "dev", tokens: 263_000, idleMin: 300, pad: 3000,
  });

  const rows = listSessions(root, { minBytes: 1000, limit: 10 });

  expect(rows.length).toBe(2);
  // cwd đọc từ trong transcript, không suy từ tên thư mục — "kuro-lean" không đoán ngược được
  expect(rows[0]!.cwd).toBe("/Users/kuro/Dev/mot");
  expect(rows[0]!.branch).toBe("main");
  expect(rows[0]!.tokens).toBe(96_000);
  expect(Math.round(rows[0]!.idleMinutes)).toBe(10);
  expect(rows[1]!.cwd).toBe("/Users/kuro/Dev/hai");
  expect(rows[1]!.tokens).toBe(263_000);
});

test("bỏ qua phiên quá ngắn: không có gì để cứu thì đừng chen vào danh sách", () => {
  const root = tmp();
  fakeSession(root, "-Users-kuro-Dev-mot", "co-viec.jsonl", {
    cwd: "/Users/kuro/Dev/mot", branch: "main", tokens: 96_000, idleMin: 60, pad: 3000,
  });
  // phiên vừa mở gõ đúng một câu — mới nhất, nhưng rỗng tuếch
  fakeSession(root, "-Users-kuro-Dev-mot", "vua-mo.jsonl", {
    cwd: "/Users/kuro/Dev/mot", branch: "main", tokens: 900, idleMin: 0,
  });

  const rows = listSessions(root, { minBytes: 1000, limit: 10 });

  expect(rows.length).toBe(1);
  expect(rows[0]!.path).toContain("co-viec.jsonl");
});

// ---- bảng để chọn ----

const rows = [
  { path: "/p/a.jsonl", cwd: "/Users/kuro/Dev/fb-auto-post", branch: "main", idleMinutes: 2, tokens: 263_000, model: "claude-opus-5", bytes: 2e6 },
  { path: "/p/b.jsonl", cwd: "/Users/kuro/Dev/kuro-lean", branch: "dev", idleMinutes: 312, tokens: 178_000, model: "claude-opus-5", bytes: 9e5 },
];

test("bảng phiên: đánh số, giữ nguyên tên repo có dấu gạch, kèm giá nạp lại", () => {
  const out = renderSessions(rows, defaultConfig.pricing);

  expect(out).toContain("1");
  expect(out).toContain("~/Dev/fb-auto-post (main)"); // KHÔNG được thành fb/auto/post
  expect(out).toContain("263k tok");
  expect(out).toContain("$2.63"); // 263k × $5/1M × 2 (cache write)
  expect(out).toContain("5h12"); // 312 phút
});

test("--from nhận số thứ tự trong bảng", () => {
  expect(resolveFrom(rows, "2")).toBe("/p/b.jsonl");
});

test("--from nhận thẳng đường dẫn, khỏi phải tra bảng", () => {
  expect(resolveFrom(rows, "/noi/khac/c.jsonl")).toBe("/noi/khac/c.jsonl");
});

test("--from trỏ ra ngoài bảng => null, đừng đoán bừa một phiên", () => {
  expect(resolveFrom(rows, "9")).toBeNull();
});

// ---- đọc cờ dòng lệnh ----

test("kt handoff không cờ => vẫn là prompt chốt phiên như cũ", () => {
  expect(parseHandoffArgs([])).toEqual({ mode: "prompt", file: ".kt/handoff.md" });
  expect(parseHandoffArgs(["ghi-chu.md"])).toEqual({ mode: "prompt", file: "ghi-chu.md" });
});

test("kt handoff --list [N] => liệt kê, N là số dòng", () => {
  expect(parseHandoffArgs(["--list"])).toEqual({ mode: "list", limit: 10 });
  expect(parseHandoffArgs(["--list", "20"])).toEqual({ mode: "list", limit: 20 });
});

test("kt handoff --recover [N] --from X => giữ N cũ, thêm chỗ chỉ phiên", () => {
  expect(parseHandoffArgs(["--recover"])).toEqual({ mode: "recover", n: 60, from: null });
  expect(parseHandoffArgs(["--recover", "30"])).toEqual({ mode: "recover", n: 30, from: null });
  expect(parseHandoffArgs(["--recover", "--from", "2"])).toEqual({ mode: "recover", n: 60, from: "2" });
  expect(parseHandoffArgs(["--recover", "30", "--from", "/p/x.jsonl"])).toEqual({
    mode: "recover", n: 30, from: "/p/x.jsonl",
  });
});

test("không đọc được usage => hiện '?', đừng hiện 0k làm anh tưởng phiên rỗng", () => {
  const out = renderSessions(
    [{ path: "/p/c.jsonl", cwd: "/Users/kuro/Dev/mot", branch: "main", idleMinutes: 133, tokens: 0, model: "", bytes: 5e5 }],
    defaultConfig.pricing,
  );
  expect(out).toContain("? tok");
  expect(out).not.toContain("0k tok");
});
