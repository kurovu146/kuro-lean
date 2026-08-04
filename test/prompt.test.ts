import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, utimesSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  decidePromptGuard,
  hasWarned,
  markWarned,
  lastContextTokens,
  promptGuardOutput,
} from "../src/hooks/prompt";
import { defaultConfig, loadConfig } from "../src/config";
import { transcriptDir } from "../src/cost";

const PRICE = { input: 5, output: 25 };
const tmp = () => mkdtempSync(join(tmpdir(), "kt-prompt-"));

/** transcript giả với 1 lượt usage; mtime lùi `idleMin` phút để giả cảnh phiên bỏ dở. */
function fakeTranscript(tokens: number, idleMin: number, model = "claude-opus-5"): string {
  const f = join(tmp(), `${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(f, JSON.stringify({ message: { model, usage: { cache_read_input_tokens: tokens } } }));
  const t = new Date(Date.now() - idleMin * 60_000);
  utimesSync(f, t, t);
  return f;
}

test("cache còn sống => không chặn (chặn lúc này là phá đám vô cớ)", () => {
  const d = decidePromptGuard(
    { idleMinutes: 42, tokens: 500_000, price: PRICE, alreadyWarned: false },
    { idleMin: 60, minTokens: 50_000 },
  );
  expect(d).toBeNull();
});

test("quá TTL => chặn, nêu rõ thời gian im và giá nạp lại", () => {
  const d = decidePromptGuard(
    { idleMinutes: 192, tokens: 500_000, price: PRICE, alreadyWarned: false },
    { idleMin: 60, minTokens: 50_000 },
  );
  expect(d).not.toBeNull();
  expect(d!.reason).toContain("3h12"); // 192 phút
  expect(d!.reason).toContain("$5.00"); // 500k tok × $5/1M × 2 (cache write)
  expect(d!.reason).toContain("handoff --recover");
});

test("đã cảnh báo cho đúng lần chết này => cho qua, không chặn vòng lặp", () => {
  const d = decidePromptGuard(
    { idleMinutes: 192, tokens: 500_000, price: PRICE, alreadyWarned: true },
    { idleMin: 60, minTokens: 50_000 },
  );
  expect(d).toBeNull();
});

test("idleMin = 0 => tắt hẳn tính năng", () => {
  const d = decidePromptGuard(
    { idleMinutes: 9999, tokens: 500_000, price: PRICE, alreadyWarned: false },
    { idleMin: 0, minTokens: 50_000 },
  );
  expect(d).toBeNull();
});

test("không có giá model => vẫn cảnh báo, chỉ thiếu số tiền (đừng bịa tiền)", () => {
  const d = decidePromptGuard(
    { idleMinutes: 90, tokens: 300_000, price: null, alreadyWarned: false },
    { idleMin: 60, minTokens: 50_000 },
  );
  expect(d).not.toBeNull();
  expect(d!.reason).not.toContain("$");
});

test("context nhỏ => không đáng chặn, nạp lại rẻ hơn cả phiền phức", () => {
  const d = decidePromptGuard(
    { idleMinutes: 300, tokens: 8_000, price: PRICE, alreadyWarned: false },
    { idleMin: 60, minTokens: 50_000 },
  );
  expect(d).toBeNull();
});

test("hạ minTokens => chặn cả context nhỏ (để thử nghiệm thu, và cho ai xài model đắt)", () => {
  const d = decidePromptGuard(
    { idleMinutes: 300, tokens: 8_000, price: PRICE, alreadyWarned: false },
    { idleMin: 60, minTokens: 1_000 },
  );
  expect(d).not.toBeNull();
});

test("lastContextTokens: lấy usage của lượt CUỐI, không cộng dồn cả phiên", () => {
  const dir = tmp();
  const f = join(dir, "t.jsonl");
  writeFileSync(f, [
    JSON.stringify({ message: { usage: { input_tokens: 5, cache_read_input_tokens: 100_000 } } }),
    JSON.stringify({ message: { usage: { input_tokens: 3, cache_creation_input_tokens: 2_000, cache_read_input_tokens: 400_000 } } }),
  ].join("\n"));
  expect(lastContextTokens(f)).toBe(402_003);
});

test("lastContextTokens: dòng hỏng và dòng không usage bị bỏ qua", () => {
  const dir = tmp();
  const f = join(dir, "t.jsonl");
  writeFileSync(f, [
    JSON.stringify({ message: { usage: { cache_read_input_tokens: 7_000 } } }),
    "{hỏng",
    JSON.stringify({ type: "summary" }),
  ].join("\n"));
  expect(lastContextTokens(f)).toBe(7_000);
});

test("lastContextTokens: file không có => 0, không ném", () => {
  expect(lastContextTokens("/khong/co/file.jsonl")).toBe(0);
});

test("marker: neo theo mtime — cùng lần chết thì nhớ, lần chết khác thì quên", () => {
  const p = join(tmp(), "state.json");
  expect(hasWarned(p, 1000)).toBe(false);
  markWarned(p, 1000);
  expect(hasWarned(p, 1000)).toBe(true);
  expect(hasWarned(p, 2000)).toBe(false);
});

// ---- promptGuardOutput: ráp toàn hook, chính là thứ cli.ts gọi ----

test("phiên vừa chạm vào => im lặng, không đọc transcript, không chặn", () => {
  const out = promptGuardOutput({ transcript_path: fakeTranscript(600_000, 5) }, defaultConfig);
  expect(out).toBeNull();
});

test("phiên bỏ dở qua đêm => trả JSON block đúng schema Claude Code", () => {
  const out = promptGuardOutput({ transcript_path: fakeTranscript(600_000, 300) }, defaultConfig);
  expect(out).not.toBeNull();
  const j = JSON.parse(out!);
  expect(j.decision).toBe("block");
  expect(j.reason).toContain("Cache context đã hết hạn");
  expect(j.reason).toContain("$6.00"); // 600k tok × $5/1M × 2
});

test("chặn xong thì thôi: gửi lại ngay sau đó phải đi lọt", () => {
  const f = fakeTranscript(600_000, 300);
  expect(promptGuardOutput({ transcript_path: f }, defaultConfig)).not.toBeNull();
  expect(promptGuardOutput({ transcript_path: f }, defaultConfig)).toBeNull();
});

test("transcript không tồn tại và cwd không có phiên nào => im lặng", () => {
  const out = promptGuardOutput({ transcript_path: "/khong/co.jsonl", cwd: "/khong/co/du/an" }, defaultConfig);
  expect(out).toBeNull();
});

test("phiên MỚI mở trong project còn phiên cũ bỏ dở => im lặng, không được vơ transcript phiên khác", () => {
  // Lượt ĐẦU của một phiên: Claude Code truyền transcript_path đúng, nhưng file chưa được ghi
  // (đo thật: hook thấy MISSING). Không có transcript của CHÍNH phiên này nghĩa là context còn
  // rỗng — chẳng có gì để nạp lại, nên phải im. Lấy phiên gần nhất của project là lấy nhầm người.
  const cwd = tmp();
  const dir = transcriptDir(cwd);
  mkdirSync(dir, { recursive: true });
  try {
    const cu = join(dir, "phien-cu.jsonl");
    writeFileSync(cu, JSON.stringify({ message: { model: "claude-opus-5", usage: { cache_read_input_tokens: 600_000 } } }));
    const t = new Date(Date.now() - 300 * 60_000);
    utimesSync(cu, t, t);

    const out = promptGuardOutput({ transcript_path: join(dir, "phien-moi.jsonl"), cwd }, defaultConfig);
    expect(out).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config: promptGuard mặc định 60 phút (khớp TTL cache) và 50k token", () => {
  expect(defaultConfig.promptGuard.idleMin).toBe(60);
  expect(defaultConfig.promptGuard.minTokens).toBe(50_000);
});

test("promptGuardOutput: minTokens từ config chứ không hardcode", () => {
  const f = fakeTranscript(8_000, 300);
  const cfg = { ...defaultConfig, promptGuard: { idleMin: 60, minTokens: 1_000 } };
  expect(promptGuardOutput({ transcript_path: f }, defaultConfig)).toBeNull();
  expect(promptGuardOutput({ transcript_path: f }, cfg)).not.toBeNull();
});

test("config: kt.json chỉ chỉnh idleMin vẫn giữ nguyên phần config còn lại", () => {
  const dir = tmp();
  writeFileSync(join(dir, "kt.json"), JSON.stringify({ promptGuard: { idleMin: 0 } }));
  const c = loadConfig(dir);
  expect(c.promptGuard.idleMin).toBe(0);
  expect(c.limits.maxChars).toBe(defaultConfig.limits.maxChars);
});
