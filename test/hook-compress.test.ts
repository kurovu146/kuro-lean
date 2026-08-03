import { test, expect } from "bun:test";
import { decideCompress } from "../src/hooks/compress";

test("lệnh test => rewrite sang kt run", () => {
  // cô lập: nếu env kế thừa KT_DISABLE=1 (vd chạy `KT_DISABLE=1 bun test`)
  // kill-switch sẽ trả null → test này fail nhầm. Tạm gỡ để kiểm hành vi mặc định.
  const saved = process.env.KT_DISABLE;
  delete process.env.KT_DISABLE;
  try {
    expect(decideCompress("npm test")).toBe("kt run -- npm test");
  } finally {
    if (saved !== undefined) process.env.KT_DISABLE = saved;
  }
});

test("đã là kt => bỏ qua", () => {
  expect(decideCompress("kt run -- npm test")).toBeNull();
});

test("có pipe/redirect => bỏ qua (tránh phá logic)", () => {
  expect(decideCompress("npm test | tee out.txt")).toBeNull();
  expect(decideCompress("npm test > out.txt")).toBeNull();
});

test("lệnh generic (grep/sed/ls) => vẫn rewrite — đây là nguồn ngốn context lớn nhất", () => {
  expect(decideCompress("grep -rn foo src")).toBe("kt run -- grep -rn foo src");
  expect(decideCompress("ls -la")).toBe("kt run -- ls -la");
});

test("cd X && cmd => cd Ở NGOÀI (Claude Code giữ cwd giữa các lệnh), chỉ wrap phần sau", () => {
  expect(decideCompress("cd /tmp/x && go test ./...")).toBe("cd /tmp/x && kt run -- go test ./...");
  expect(decideCompress("cd /tmp/x && echo a && ls")).toBe(
    "cd /tmp/x && kt run -- bash -c 'echo a && ls'",
  );
});

test("chuỗi && không có cd => wrap cả chuỗi qua bash -c", () => {
  expect(decideCompress('echo "=== A ===" && ls -la')).toBe(
    `kt run -- bash -c 'echo "=== A ===" && ls -la'`,
  );
});

test("lệnh đổi trạng thái shell ở giữa chuỗi => null (wrap sẽ mất tác dụng)", () => {
  expect(decideCompress("echo a && cd /tmp/x")).toBeNull();
  expect(decideCompress("nvm use 20 && npm test")).toBeNull();
  expect(decideCompress("export FOO=1 && npm test")).toBeNull();
});

test("dev server / tail -f => null (wrap sẽ treo tới timeout)", () => {
  expect(decideCompress("npm run dev")).toBeNull();
  expect(decideCompress("cd /tmp/x && next dev")).toBeNull();
  expect(decideCompress("tail -f app.log")).toBeNull();
});

test("chuỗi && chứa watch => null (wrap sẽ treo)", () => {
  expect(decideCompress("cd /tmp/x && npm run dev -w")).toBeNull();
});

test("chuỗi && chứa pipe/redirect => null (giữ nguyên rào cũ)", () => {
  expect(decideCompress("cd /tmp/x && npm test | head")).toBeNull();
  expect(decideCompress("cd /tmp/x && npm test > out.txt")).toBeNull();
});

test("lệnh cần tty/interactive => null (kt run bỏ stdin, wrap sẽ hỏng)", () => {
  expect(decideCompress("sudo launchctl list")).toBeNull();
  expect(decideCompress("ssh box uptime")).toBeNull();
  expect(decideCompress("gh auth login")).toBeNull();
  expect(decideCompress("docker exec -it web sh")).toBeNull();
  expect(decideCompress("git rebase -i HEAD~3")).toBeNull();
  expect(decideCompress("cd /tmp/x && sudo make install")).toBeNull();
});

test("REPL trần => null, nhưng cùng lệnh có arg thì rewrite", () => {
  expect(decideCompress("node")).toBeNull();
  expect(decideCompress("python3")).toBeNull();
  expect(decideCompress("python3 scripts/report.py")).toBe("kt run -- python3 scripts/report.py");
});

test("KT_DISABLE=1 => null (kill-switch)", () => {
  process.env.KT_DISABLE = "1";
  try {
    expect(decideCompress("npm test")).toBeNull();
  } finally {
    delete process.env.KT_DISABLE;
  }
});

test("env-prefix => wrap qua bash -c (spawn array không hiểu FOO=1)", () => {
  expect(decideCompress("GIT_PAGER=cat git diff")).toBe("kt run -- bash -c 'GIT_PAGER=cat git diff'");
  expect(decideCompress("CI=1 npm test")).toBe("kt run -- bash -c 'CI=1 npm test'");
});

test("2>&1 (idiom phổ biến của agent) => wrap qua bash -c", () => {
  expect(decideCompress("npm test 2>&1")).toBe("kt run -- bash -c 'npm test 2>&1'");
});

test("2>&1 nhưng vẫn còn pipe/redirect khác => null", () => {
  expect(decideCompress("npm test 2>&1 | tee log")).toBeNull();
  expect(decideCompress("npm test 2>&1 > out.txt")).toBeNull();
});

test("bash -c escape nháy đơn trong lệnh", () => {
  expect(decideCompress("CI=1 bun test --filter 'auth'")).toBe(
    "kt run -- bash -c 'CI=1 bun test --filter '\\''auth'\\'''",
  );
});

test("env-prefix + watch => vẫn null (wrap sẽ treo)", () => {
  expect(decideCompress("CI=1 tsc --watch")).toBeNull();
});

test("env-prefix + lệnh generic => vẫn wrap qua bash -c", () => {
  expect(decideCompress("FOO=1 echo hi")).toBe("kt run -- bash -c 'FOO=1 echo hi'");
});

test("lệnh lint => rewrite sang kt run", () => {
  expect(decideCompress("eslint src")).toBe("kt run -- eslint src");
});

test("có `kt run` ở giữa (bypass thủ công) => null, tránh double-wrap", () => {
  expect(decideCompress("KT_RAW=1 kt run -- git diff")).toBeNull();
});

test("lệnh watch/long-running => null (wrap sẽ treo)", () => {
  expect(decideCompress("tsc --watch")).toBeNull();
  expect(decideCompress("jest --watch")).toBeNull();
  expect(decideCompress("vitest watch")).toBeNull();
  expect(decideCompress("next build -w")).toBeNull();
});

test("yarn dev => null (không còn nhận nhầm install)", () => {
  expect(decideCompress("yarn dev")).toBeNull();
  expect(decideCompress("yarn start")).toBeNull();
});

test("newline trong lệnh => null", () => {
  expect(decideCompress("npm test\necho hi")).toBeNull();
});
