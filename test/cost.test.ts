import { test, expect } from "bun:test";
import { priceOf, tallyUsage, renderCost, perTurnCost, type Usage } from "../src/cost";
import { defaultConfig } from "../src/config";

const P = defaultConfig.pricing;

test("priceOf khớp model theo prefix, bỏ hậu tố ngày", () => {
  expect(priceOf("claude-opus-5", P)).toEqual({ input: 5, output: 25 });
  expect(priceOf("claude-haiku-4-5-20251001", P)).toEqual({ input: 1, output: 5 });
});

test("priceOf model lạ => null (thà bỏ qua còn hơn tính sai)", () => {
  expect(priceOf("gpt-4o", P)).toBeNull();
});

test("tallyUsage: cache write tính 2x giá input, cache read 0.1x, output theo giá output", () => {
  const rows: Usage[] = [
    { model: "claude-opus-5", input: 0, cacheWrite: 1_000_000, cacheRead: 0, output: 0 },
    { model: "claude-opus-5", input: 0, cacheWrite: 0, cacheRead: 1_000_000, output: 0 },
    { model: "claude-opus-5", input: 0, cacheWrite: 0, cacheRead: 0, output: 1_000_000 },
    { model: "claude-opus-5", input: 1_000_000, cacheWrite: 0, cacheRead: 0, output: 0 },
  ];
  const t = tallyUsage(rows, P);
  expect(t.cost.cacheWrite).toBeCloseTo(10, 5); // 5 * 2
  expect(t.cost.cacheRead).toBeCloseTo(0.5, 5); // 5 * 0.1
  expect(t.cost.output).toBeCloseTo(25, 5);
  expect(t.cost.input).toBeCloseTo(5, 5);
  expect(t.total).toBeCloseTo(40.5, 5);
});

test("tallyUsage bỏ qua model không có trong bảng giá, không làm hỏng tổng", () => {
  const t = tallyUsage(
    [
      { model: "claude-opus-5", input: 1_000_000, cacheWrite: 0, cacheRead: 0, output: 0 },
      { model: "mystery-model", input: 9_999_999, cacheWrite: 0, cacheRead: 0, output: 0 },
    ],
    P,
  );
  expect(t.total).toBeCloseTo(5, 5);
  expect(t.skipped).toEqual(["mystery-model"]);
});

test("renderCost: rỗng => câu gợi ý, không phải bảng trống", () => {
  expect(renderCost([], P)).toContain("chưa có");
});

test("renderCost xếp theo chi phí giảm dần và nêu % của khoản lớn nhất", () => {
  const out = renderCost(
    [
      { model: "claude-opus-5", input: 0, cacheWrite: 0, cacheRead: 100_000_000, output: 0 },
      { model: "claude-haiku-4-5", input: 0, cacheWrite: 0, cacheRead: 1_000, output: 0 },
    ],
    P,
  );
  expect(out.indexOf("opus-5")).toBeLessThan(out.indexOf("haiku"));
  expect(out).toContain("cache read");
});

test("perTurnCost: chi phí đọc lại context cho MỖI lượt kế tiếp = tokens * 0.1 * giá input", () => {
  // 200k token context trên Opus 5 => 200000 * 0.1 * 5 / 1e6 = $0.10
  expect(perTurnCost(200_000, "claude-opus-5", P)).toBeCloseTo(0.1, 6);
});

test("perTurnCost: model ngoài bảng giá => null (ẩn đi thay vì đoán)", () => {
  expect(perTurnCost(200_000, "gpt-4o", P)).toBeNull();
});
