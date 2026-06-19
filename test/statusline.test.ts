import { test, expect } from "bun:test";
import { renderStatusline } from "../src/statusline";

const cfg = { warnPct: 60, dangerPct: 85 };

test("dưới warn => xanh + token + cost", () => {
  const s = renderStatusline(
    { context_window: { used_percentage: 42, total_input_tokens: 80000, total_output_tokens: 4000, context_window_size: 200000 }, model: { display_name: "Opus" }, cost: { total_cost_usd: 0.31 } },
    cfg,
  );
  expect(s).toContain("🟢");
  expect(s).toContain("42%");
  expect(s).toContain("84k");
  expect(s).toContain("$0.31");
});

test("≥ danger => đỏ", () => {
  const s = renderStatusline({ context_window: { used_percentage: 90, context_window_size: 200000 } }, cfg);
  expect(s).toContain("🔴");
});

test("thiếu field => không crash", () => {
  const s = renderStatusline({}, cfg);
  expect(typeof s).toBe("string");
});
