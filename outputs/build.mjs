import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { backup: { type: "string" } } });
/** @typedef {[string, string]} Translation */
/** @type {{native: Translation[], common: Record<string, Translation[]>, pack: Record<string, Translation[]>, project: Record<string, Translation[]>}} */
const extra = JSON.parse(
  readFileSync(new URL("translations.json", import.meta.url), "utf8"),
);
const localAppData = process.env.LOCALAPPDATA;
if (!localAppData) throw new Error("此补丁适用于 Windows 安装");
const bundleRoot =
  process.env.CUBE_BUNDLE_PATH || join(localAppData, "stm32cube", "bundles");
/** @type {Array<{bundle: string, version: string, backup: string}>} */
const backupRecords = values.backup
  ? JSON.parse(readFileSync(join(values.backup, "files.json"), "utf8"))
  : [];

/** @param {string} bundle @param {string} version @param {string} path */
function readOriginal(bundle, version, path) {
  if (values.backup) {
    const entry = backupRecords.find(
      (record) => record.bundle === bundle && record.version === version,
    );
    if (!entry) throw new Error(`备份中找不到组件：${bundle}@${version}`);
    return readFileSync(join(values.backup, entry.backup));
  }
  return readFileSync(join(bundleRoot, bundle, version, path));
}

const binary = readOriginal("cube-wrapper", "0.10.4", "bin/cube.exe");
const executable = binary;
const pe = binary.readUInt32LE(0x3c);
const optional = pe + 24;
const imageBase = binary.readBigUInt64LE(optional + 24);
const sectionTable = optional + binary.readUInt16LE(pe + 20);
const sections = Array.from(
  { length: binary.readUInt16LE(pe + 6) },
  (_, index) => {
    const offset = sectionTable + index * 40;
    return {
      name: binary.toString("ascii", offset, offset + 8).replaceAll("\0", ""),
      rva: binary.readUInt32LE(offset + 12),
      size: binary.readUInt32LE(offset + 16),
      raw: binary.readUInt32LE(offset + 20),
    };
  },
);
const rdata = sections.find((section) => section.name === ".rdata");
const text = sections.find((section) => section.name === ".text");
if (!rdata || !text) throw new Error("程序缺少 .rdata 或 .text 节");
/** @type {Array<{start: number, end: number, lengthOffset: number, lengthSize: number}>} */
const slices = [];

for (const section of sections.filter((item) =>
  [".data", ".rdata"].includes(item.name),
)) {
  for (
    let offset = section.raw;
    offset < section.raw + section.size - 16;
    offset += 8
  ) {
    const address = binary.readBigUInt64LE(offset);
    const length = binary.readBigUInt64LE(offset + 8);
    const rva = Number(address - imageBase);
    if (
      rva < rdata.rva ||
      rva >= rdata.rva + rdata.size ||
      length < 1n ||
      length > 2000n
    )
      continue;
    const start = rdata.raw + rva - rdata.rva;
    const size = Number(length);
    slices.push({
      start,
      end: start + size,
      lengthOffset: offset + 8,
      lengthSize: 8,
    });
  }
}

/** @param {number} offset */
function memoryOperand(offset) {
  const rex = binary[offset];
  if (rex !== 0x48 && rex !== 0x49 && rex !== 0x4c && rex !== 0x4d) return;
  const modrm = binary[offset + 2];
  const mod = modrm >> 6;
  let base = modrm & 7;
  let at = offset + 3;
  if (mod === 3 || (mod === 0 && base === 5)) return;
  if (base === 4) {
    const sib = binary[at++];
    if ((sib & 0xf8) !== 0x20) return;
    base = sib & 7;
  }
  let displacement = 0;
  if (mod === 1) displacement = binary.readInt8(at++);
  if (mod === 2) {
    displacement = binary.readInt32LE(at);
    at += 4;
  }
  return {
    base: base + (rex & 1 ? 8 : 0),
    register: ((modrm >> 3) & 7) + (rex & 4 ? 8 : 0),
    displacement,
    end: at,
  };
}

for (let offset = text.raw; offset < text.raw + text.size - 35; offset++) {
  if (
    (binary[offset] !== 0x48 && binary[offset] !== 0x4c) ||
    binary[offset + 1] !== 0x8d ||
    (binary[offset + 2] & 0xc7) !== 5
  )
    continue;
  const target =
    offset - text.raw + text.rva + 7 + binary.readInt32LE(offset + 3);
  if (target < rdata.rva || target >= rdata.rva + rdata.size) continue;
  const register =
    ((binary[offset + 2] >> 3) & 7) + (binary[offset] & 4 ? 8 : 0);
  const first = offset + 7;
  if (register === 2) {
    for (let argument = first; argument < first + 24; argument++) {
      if (
        binary[argument] !== 0x41 ||
        binary[argument + 1] !== 0xb8 ||
        binary[argument + 6] !== 0xe8
      )
        continue;
      const size = binary.readUInt32LE(argument + 2);
      if (size < 1 || size > 2000) continue;
      const start = rdata.raw + target - rdata.rva;
      slices.push({
        start,
        end: start + size,
        lengthOffset: argument + 2,
        lengthSize: 4,
      });
      break;
    }
  }
  if (binary[first + 1] !== 0x89) continue;
  const destination = memoryOperand(first);
  if (!destination || destination.register !== register) continue;
  const next = destination.end;
  if (binary[next + 1] !== 0xc7) continue;
  const length = memoryOperand(next);
  if (
    length?.register !== 0 ||
    length.base !== destination.base ||
    length.displacement !== destination.displacement + 8
  )
    continue;
  const size = binary.readUInt32LE(length.end);
  if (size < 1 || size > 2000) continue;
  const start = rdata.raw + target - rdata.rva;
  slices.push({
    start,
    end: start + size,
    lengthOffset: length.end,
    lengthSize: 4,
  });
}

const strings = slices.map((slice) => ({
  ...slice,
  text: binary.toString("utf8", slice.start, slice.end),
}));

const translations = [...new Map(extra.native).entries()]
  .map(([english, chinese]) => [
    english,
    english === "Flags: "
      ? "选项"
      : english.includes(" (")
        ? chinese.replaceAll("（", "(")
        : chinese,
  ])
  .sort((a, b) => b[0].length - a[0].length);
const shortLabels = new Set(["Arguments", "Options", "Commands", "Usage:"]);
const missing = translations.filter(
  ([english]) => !executable.includes(Buffer.from(english)),
);
const oversized = translations.filter(
  ([english, chinese]) =>
    Buffer.byteLength(chinese) > Buffer.byteLength(english),
);
if (missing.length || oversized.length) {
  console.log(JSON.stringify({ missing, oversized }, null, 2));
  process.exit(1);
}

/** @type {Map<number, number>} */
const byteEdits = new Map();
/** @type {Array<[number, number]>} */
const claimed = [];
const seen = new Set();
let lengthFields = 0;

/** @param {number} offset @param {Uint8Array} after */
function addEdit(offset, after) {
  for (let index = 0; index < after.length; index++) {
    const position = offset + index;
    if (byteEdits.has(position) && byteEdits.get(position) !== after[index]) {
      throw new Error(`相交的修改内容不同：${position}`);
    }
    byteEdits.set(position, after[index]);
  }
}

for (const slice of strings) {
  if (!/^[\t\n\r\x20-\x7e]+$/.test(slice.text)) continue;
  let translated = slice.text;
  for (const [english, chinese] of translations) {
    if (shortLabels.has(english) && slice.text !== english) continue;
    translated = translated.replaceAll(english, chinese);
  }
  if (translated === slice.text) continue;
  const bytes = Buffer.from(translated);
  const width = slice.end - slice.start;
  if (bytes.length > width) throw new Error(`字符串超长：${slice.text}`);
  const replacement = Buffer.alloc(width, 0x20);
  bytes.copy(replacement);
  addEdit(slice.start, replacement);
  const length = Buffer.alloc(slice.lengthSize);
  if (slice.lengthSize === 8) length.writeBigUInt64LE(BigInt(bytes.length));
  else length.writeUInt32LE(bytes.length);
  addEdit(slice.lengthOffset, length);
  lengthFields++;
  claimed.push([slice.start, slice.end]);
  seen.add(slice.text);
}

for (const [english, chinese] of translations) {
  if (shortLabels.has(english)) continue;
  const original = Buffer.from(english);
  const translated = Buffer.from(chinese);
  let start = 8813568;
  while (true) {
    const offset = executable.indexOf(original, start);
    if (offset < 0 || offset >= 11443712) break;
    start = offset + original.length;
    if (
      claimed.some(
        ([first, last]) => offset < last && offset + original.length > first,
      )
    )
      continue;
    const after = Buffer.alloc(original.length, 0x20);
    translated.copy(after);
    addEdit(offset, after);
    claimed.push([offset, offset + original.length]);
    seen.add(english);
  }
}

const inlineHelp = executable.indexOf(Buffer.from("Print he"));
if (
  inlineHelp !== 7666601 ||
  !executable
    .subarray(inlineHelp + 18, inlineHelp + 24)
    .equals(Buffer.from("6c704983c00a", "hex"))
)
  throw new Error("默认帮助文字的指令不匹配");
addEdit(inlineHelp, Buffer.from("帮助  "));
addEdit(inlineHelp + 18, Buffer.from("  "));
addEdit(inlineHelp + 23, Buffer.from([6]));
if (
  !executable.subarray(7990943, 7990948).equals(Buffer.from([0xb8, 8, 0, 0, 0]))
)
  throw new Error("子命令标题长度指令不匹配");
addEdit(7990944, Buffer.from([6]));

const helpText = "显示此帮助或指定子命令的帮助";
const helpOffset = executable.indexOf(
  Buffer.from("Print this message or the help of the given subcommand(s)"),
);
for (let offset = 1024; offset < 8791000; offset++) {
  if (
    executable[offset] !== 0x48 ||
    executable[offset + 1] !== 0x8d ||
    executable[offset + 2] !== 0x15
  )
    continue;
  const address = offset + 3072 + 7 + executable.readInt32LE(offset + 3);
  if (address !== helpOffset + 5120) continue;
  for (let at = offset + 7; at < offset + 32; at++) {
    if (
      executable[at] !== 0x41 ||
      executable[at + 1] !== 0xb8 ||
      executable.readUInt32LE(at + 2) !== 57
    )
      continue;
    const length = Buffer.alloc(4);
    length.writeUInt32LE(Buffer.byteLength(helpText));
    addEdit(at + 2, length);
  }
}

const changedPositions = [...byteEdits.entries()]
  .filter(([offset, value]) => executable[offset] !== value)
  .sort((a, b) => a[0] - b[0]);
/** @type {Array<{offset: number, bytes: number[]}>} */
const nativeEdits = [];
for (const [offset, value] of changedPositions) {
  const previous = nativeEdits.at(-1);
  if (previous && offset === previous.offset + previous.bytes.length)
    previous.bytes.push(value);
  else nativeEdits.push({ offset, bytes: [value] });
}
const native = nativeEdits.map(({ offset, bytes }) => ({
  offset,
  before: executable.subarray(offset, offset + bytes.length).toString("hex"),
  after: Buffer.from(bytes).toString("hex"),
}));

/** @param {string} bundle @param {string} version @param {"pack" | "project"} group */
function buildJavaScript(bundle, version, group) {
  const source = readOriginal(bundle, version, "bin/index.js");
  /** @type {Array<{offset: number, before: Buffer, after: Buffer}>} */
  const candidates = [];
  /** @type {Array<{kind: string, english: string}>} */
  const absent = [];
  const groups = [extra[group], extra.common];
  for (const table of groups) {
    for (const [kind, pairs] of Object.entries(table)) {
      for (const [english, chinese] of pairs) {
        const patterns =
          kind === "raw"
            ? [[english, chinese]]
            : [
                [JSON.stringify(english), JSON.stringify(chinese)],
                [
                  `'${english.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`,
                  `'${chinese.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`,
                ],
                [`\`${english}\``, `\`${chinese}\``],
              ];
        let count = 0;
        for (const [before, after] of patterns) {
          const original = Buffer.from(before);
          let start = 0;
          while (true) {
            const offset = source.indexOf(original, start);
            if (offset < 0) break;
            candidates.push({
              offset,
              before: original,
              after: Buffer.from(after),
            });
            start = offset + original.length;
            count++;
          }
        }
        if (!count) absent.push({ kind, english });
      }
    }
  }
  if (absent.length) {
    console.log(JSON.stringify({ bundle, absent }, null, 2));
    process.exitCode = 1;
  }
  /** @type {typeof candidates} */
  const edits = [];
  for (const candidate of candidates.sort(
    (a, b) => b.before.length - a.before.length,
  )) {
    if (
      !edits.some(
        (edit) =>
          candidate.offset < edit.offset + edit.before.length &&
          candidate.offset + candidate.before.length > edit.offset,
      )
    )
      edits.push(candidate);
  }
  edits.sort((a, b) => a.offset - b.offset);
  let difference = 0;
  const changes = edits.map((edit) => {
    const entry = {
      offset: edit.offset,
      patchedOffset: edit.offset + difference,
      before: edit.before.toString("utf8"),
      after: edit.after.toString("utf8"),
    };
    difference += edit.after.length - edit.before.length;
    return entry;
  });
  return {
    bundle,
    version,
    path: "bin/index.js",
    originalSize: source.length,
    patchedSize: source.length + difference,
    encoding: "utf8",
    edits: changes,
  };
}

const patch = {
  format: 1,
  nativeTranslations: translations,
  targets: [
    {
      bundle: "cube-wrapper",
      version: "0.10.4",
      path: "bin/cube.exe",
      includeLauncher: true,
      originalSize: executable.length,
      patchedSize: executable.length,
      encoding: "hex",
      edits: native,
    },
    buildJavaScript("pack-manager", "0.6.5", "pack"),
    buildJavaScript("ide-project-creator", "1.1.0", "project"),
  ],
};
if (process.exitCode) process.exit(process.exitCode);
writeFileSync(
  new URL("patches.json", import.meta.url),
  `${JSON.stringify(patch, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    nativeStrings: seen.size,
    nativeLengthFields: lengthFields,
    targets: patch.targets.map((target) => ({
      bundle: target.bundle,
      edits: target.edits.length,
    })),
  }),
);
