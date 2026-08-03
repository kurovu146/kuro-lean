import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// Cắt ngắn phần ồn: tool_result và input của tool là thứ làm transcript phình lên hàng MB,
// nhưng phiên sau chỉ cần biết đã đụng gì, không cần nguyên văn.
const RESULT_CAP = 200;
const TOOL_INPUT_CAP = 200;
const TEXT_CAP = 800;

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/**
 * Trích phần CUỐI transcript thành văn bản gọn (PURE).
 * Bỏ thinking (không lưu được, và phiên sau không cần), cắt tool_result/tool input.
 * Đo trên phiên thật: 60 message cuối ≈ 0,1% kích thước transcript mà vẫn đủ ngữ cảnh.
 */
export function extractTail(lines: string[], nMessages: number): string {
  const out: string[] = [];
  for (const line of lines.slice(-nMessages)) {
    if (!line.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // dòng hỏng → bỏ, đừng làm chết cả bản trích
    }
    const m = e?.message;
    const role = m?.role;
    if (role !== "user" && role !== "assistant") continue;

    const parts: string[] = [];
    const c = m.content;
    if (typeof c === "string") {
      parts.push(clip(c, TEXT_CAP));
    } else if (Array.isArray(c)) {
      for (const it of c) {
        if (!it || typeof it !== "object") continue;
        if (it.type === "text") {
          parts.push(clip(it.text ?? "", TEXT_CAP));
        } else if (it.type === "tool_use") {
          parts.push(`[dùng ${it.name}: ${clip(JSON.stringify(it.input ?? {}), TOOL_INPUT_CAP)}]`);
        } else if (it.type === "tool_result") {
          const cc = it.content;
          const s = Array.isArray(cc)
            ? cc.map((x: any) => (x && typeof x === "object" ? x.text ?? "" : "")).join("")
            : String(cc ?? "");
          parts.push(`[kết quả: ${clip(s, RESULT_CAP)}]`);
        }
        // thinking: bỏ hẳn
      }
    }
    const body = parts.filter((p) => p.trim()).join("\n");
    if (body) out.push(`### ${role}\n${body}`);
  }
  return out.join("\n\n");
}

/** Transcript được ghi gần nhất trong thư mục phiên của một project. null nếu không có. */
export function latestTranscript(dir: string): string | null {
  if (!existsSync(dir)) return null;
  let best: { path: string; mtime: number } | null = null;
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join(dir, f);
      try {
        const mt = statSync(p).mtimeMs;
        if (!best || mt > best.mtime) best = { path: p, mtime: mt };
      } catch {}
    }
  } catch {
    return null;
  }
  return best?.path ?? null;
}

/** Bản trích kèm hướng dẫn, sẵn để dán vào phiên mới. */
export function recoverPrompt(tail: string, sourceFile: string): string {
  if (!tail) return `(không đọc được nội dung dùng được từ ${sourceFile})\n`;
  return `Đây là phần cuối của phiên làm việc trước (trích từ \`${sourceFile}\`, đã lược bớt output dài).
Đọc để nắm trạng thái, tóm tắt lại cho tôi đang dở ở đâu và bước tiếp theo là gì, rồi chờ tôi xác nhận trước khi làm gì.

---

${tail}
`;
}
