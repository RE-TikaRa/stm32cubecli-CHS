import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    preview: { type: "string" },
    baseline: { type: "string" },
    report: { type: "string" },
  },
});
const launcher = join(homedir(), ".local", "stm32cube", "bin", "cube.exe");
const cube = values.preview
  ? resolve(values.preview, "cube-wrapper", "cube.exe")
  : launcher;
const baseline = values.baseline ? resolve(values.baseline) : launcher;
const localAppData = process.env.LOCALAPPDATA;
if (!localAppData) throw new Error("此补丁适用于 Windows 安装");
const bundleRoot =
  process.env.CUBE_BUNDLE_PATH || join(localAppData, "stm32cube", "bundles");
const versions = { "pack-manager": "0.6.5", "ide-project-creator": "1.1.0" };
/** @type {Array<{name: string, passed: boolean, status: number | null}>} */
const results = [];

/** @param {string} executable @param {string[]} args */
function run(executable, args) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** @param {string} name @param {() => ReturnType<typeof run>} getOutput @param {number | null} status @param {RegExp} pattern */
function check(name, getOutput, status, pattern) {
  const output = getOutput();
  assert.equal(
    output.status,
    status,
    `${name}\n${output.stderr}\n${output.stdout}`,
  );
  assert.match(output.stdout + output.stderr, pattern, name);
  assert.doesNotMatch(
    output.stdout + output.stderr,
    /\ufffd/,
    `${name} 出现编码替换字符`,
  );
  results.push({ name, passed: true, status });
}

/** @param {keyof typeof versions} bundle @param {string[]} args */
function command(bundle, args) {
  const path = values.preview
    ? resolve(values.preview, bundle, "index.js")
    : join(bundleRoot, bundle, versions[bundle], "bin", "index.js");
  return run(launcher, ["node", path, ...args]);
}

for (const args of [
  ["--help"],
  ["bundle", "--help"],
  ...[
    "show",
    "list",
    "install",
    "download",
    "license",
    "init",
    "update",
    "remove",
    "autoremove",
    "external",
  ].map((name) => ["bundle", name, "--help"]),
  ...["add", "remove", "list"].map((name) => [
    "bundle",
    "external",
    name,
    "--help",
  ]),
  ["bundle-admin", "--help"],
  ["bundle-admin", "publish", "--help"],
  ["bundle-admin", "create-index", "--help"],
])
  check(`cube ${args.join(" ")}`, () => run(cube, args), 0, /选项|帮助/);

for (const args of [
  ["--help"],
  ...["sync", "install", "remove", "detect", "remote", "list"].map((name) => [
    name,
    "--help",
  ]),
  ...["list", "add", "remove"].map((name) => ["remote", name, "--help"]),
  ...["packs", "devices", "components", "boards", "parts"].map((name) => [
    "list",
    name,
    "--help",
  ]),
])
  check(
    `pack ${args.join(" ")}`,
    () => command("pack-manager", args),
    0,
    /用法：/,
  );

check(
  "工程创建帮助",
  () => command("ide-project-creator", ["--help"]),
  0,
  /创建空的 CMake 工程/,
);
check(
  "原生命令未知选项",
  () => run(cube, ["bundle", "show", "--unknown-option"]),
  run(baseline, ["bundle", "show", "--unknown-option"]).status,
  /未知参数/,
);
check(
  "原生命令缺参时显示帮助",
  () => run(cube, ["bundle", "remove"]),
  run(baseline, ["bundle", "remove"]).status,
  /需要删除的组件标识/,
);
check(
  "Pack 缺少必填参数",
  () => command("pack-manager", ["install"]),
  1,
  /缺少必填参数/,
);
check(
  "Pack 未知选项与相似名称",
  () => command("pack-manager", ["--hlep"]),
  1,
  /相似名称：--help/,
);
check(
  "工程创建缺少必填选项",
  () => command("ide-project-creator", []),
  1,
  /未指定必填选项/,
);
check(
  "工程创建工具链取值错误",
  () =>
    command("ide-project-creator", [
      "--destination",
      ".",
      "--name",
      "example",
      "--toolchain",
      "unknown",
    ]),
  1,
  /可选值为/,
);

for (const args of [
  ["--json", "bundle", "list"],
  ["--json", "bundle", "show", "cube-wrapper"],
]) {
  const before = run(baseline, args);
  const after = run(cube, args);
  assert.equal(after.status, 0);
  assert.deepEqual(JSON.parse(after.stdout), JSON.parse(before.stdout));
  results.push({
    name: `${values.baseline || values.preview ? "JSON 内容一致" : "JSON 解析"}：${args.join(" ")}`,
    passed: true,
    status: after.status,
  });
}
assert.deepEqual(
  run(cube, ["node", "--version"]),
  run(baseline, ["node", "--version"]),
);
results.push({ name: "Node 子命令转发与退出状态", passed: true, status: 0 });

const report = {
  passed: results.length,
  failed: 0,
  preview: values.preview ?? null,
  baseline: values.baseline ?? null,
  results,
};
if (values.report)
  writeFileSync(values.report, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
