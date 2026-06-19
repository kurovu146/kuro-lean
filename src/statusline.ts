export interface StatuslineInput {
  context_window?: {
    used_percentage?: number;
    total_input_tokens?: number;
    total_output_tokens?: number;
    context_window_size?: number;
  };
  model?: { display_name?: string };
  cost?: { total_cost_usd?: number };
}

export function renderStatusline(input: StatuslineInput, cfg: { warnPct: number; dangerPct: number }): string {
  const cw = input.context_window ?? {};
  const size = cw.context_window_size ?? 0;
  const tokens = (cw.total_input_tokens ?? 0) + (cw.total_output_tokens ?? 0);
  const pct = cw.used_percentage ?? (size > 0 ? Math.round((tokens / size) * 100) : undefined);

  const dot = pct === undefined ? "⚪" : pct >= cfg.dangerPct ? "🔴" : pct >= cfg.warnPct ? "🟡" : "🟢";
  const pctStr = pct === undefined ? "~? ctx" : `${pct}% ctx`;
  const tokStr = tokens > 0 ? ` · ~${Math.round(tokens / 1000)}k tok` : "";
  const costStr = input.cost?.total_cost_usd !== undefined ? ` · $${input.cost.total_cost_usd.toFixed(2)}` : "";
  const model = input.model?.display_name ? `${input.model.display_name} · ` : "";
  return `${dot} ${model}${pctStr}${tokStr}${costStr}`;
}
