import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

/** @typedef {{path: string, backup: string, bundle: string, version: string, originalSha256: string, patchedSha256: string}} BackupRecord */
/** @typedef {{offset: number, patchedOffset?: number, before: string, after: string}} Edit */
/** @typedef {{bundle: string, version: string, path: string, includeLauncher?: boolean, originalSize: number, patchedSize: number, encoding: BufferEncoding, edits: Edit[]}} Target */

try {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean" },
      preview: { type: "string" },
      backup: { type: "string" },
      restore: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "STM32CubeCLI 中文补丁\n\nnode patch.mjs                  检查当前安装\nnode patch.mjs --preview <目录>  生成验证副本，目录须不存在\nnode patch.mjs --apply           保存原文件并应用汉化\nnode patch.mjs --backup <目录>   更新汉化时使用原文件备份\nnode patch.mjs --restore <目录>  从应用时创建的备份恢复",
    );
  } else {
    if (
      [values.apply, values.preview, values.restore].filter(Boolean).length > 1
    )
      throw new Error("--apply、--preview 和 --restore 只能指定一个");
    if (values.restore) {
      const backupDirectory = resolve(values.restore);
      /** @type {BackupRecord[]} */
      const records = JSON.parse(
        readFileSync(join(backupDirectory, "files.json"), "utf8"),
      );
      const files = records.map((record) => {
        const original = readFileSync(join(backupDirectory, record.backup));
        const current = readFileSync(record.path);
        if (
          createHash("sha256").update(original).digest("hex") !==
          record.originalSha256
        )
          throw new Error(`备份文件校验失败：${record.backup}`);
        if (
          createHash("sha256").update(current).digest("hex") !==
          record.patchedSha256
        )
          throw new Error(`当前文件与汉化版本不符，未执行恢复：${record.path}`);
        return { path: record.path, original };
      });
      for (const file of files) writeFileSync(file.path, file.original);
      console.log(
        JSON.stringify(
          { ok: true, mode: "restore", files: files.map((file) => file.path) },
          null,
          2,
        ),
      );
    } else {
      /** @type {{targets: Target[]}} */
      const patch = JSON.parse(
        readFileSync(new URL("patches.json", import.meta.url), "utf8"),
      );
      const localAppData = process.env.LOCALAPPDATA;
      if (!localAppData) throw new Error("此补丁适用于 Windows 安装");
      const bundleRoot =
        process.env.CUBE_BUNDLE_PATH ||
        join(localAppData, "stm32cube", "bundles");
      const launcher = join(
        homedir(),
        ".local",
        "stm32cube",
        "bin",
        "cube.exe",
      );
      const files = [];
      /** @type {BackupRecord[]} */
      const sourceRecords = values.backup
        ? JSON.parse(readFileSync(join(values.backup, "files.json"), "utf8"))
        : [];
      for (const target of patch.targets) {
        const manifest = JSON.parse(
          readFileSync(
            join(bundleRoot, target.bundle, target.version, "CubeBundle.json"),
            "utf8",
          ),
        );
        if (
          manifest.name !== target.bundle ||
          manifest.version !== target.version
        )
          throw new Error(`组件版本不匹配：${target.bundle}@${target.version}`);
        const paths = [
          join(bundleRoot, target.bundle, target.version, target.path),
        ];
        if (target.includeLauncher) paths.push(launcher);
        const edits = target.edits.map((edit) => ({
          offset: edit.offset,
          patchedOffset: edit.patchedOffset ?? edit.offset,
          before: Buffer.from(edit.before, target.encoding),
          after: Buffer.from(edit.after, target.encoding),
        }));
        for (const path of paths) {
          const original = readFileSync(path);
          /** @param {Buffer} input @param {boolean} patched */
          const matches = (input, patched) =>
            input.length ===
              (patched ? target.patchedSize : target.originalSize) &&
            edits.every((edit) => {
              const offset = patched ? edit.patchedOffset : edit.offset;
              const expected = patched ? edit.after : edit.before;
              return input
                .subarray(offset, offset + expected.length)
                .equals(expected);
            });
          let status = matches(original, false)
            ? "english"
            : matches(original, true)
              ? "chinese"
              : "modified";
          let source = original;
          if (status !== "english" && values.backup) {
            const record = sourceRecords.find(
              (entry) => resolve(entry.path) === resolve(path),
            );
            if (
              !record ||
              (status === "modified" &&
                createHash("sha256").update(original).digest("hex") !==
                  record.patchedSha256)
            )
              throw new Error(`当前文件与备份记录不符：${path}`);
            source = readFileSync(join(values.backup, record.backup));
            if (
              createHash("sha256").update(source).digest("hex") !==
                record.originalSha256 ||
              !matches(source, false)
            )
              throw new Error(`原文件备份与补丁不符：${record.backup}`);
            if (status === "modified") status = "outdated";
          }
          if (status === "modified")
            throw new Error(`文件与补丁不匹配，未执行修改：${path}`);
          let translated = original;
          if (status !== "chinese") {
            const parts = [];
            let from = 0;
            for (const edit of edits) {
              parts.push(source.subarray(from, edit.offset), edit.after);
              from = edit.offset + edit.before.length;
            }
            parts.push(source.subarray(from));
            translated = Buffer.concat(parts);
          }
          files.push({ path, target, original, source, translated, status });
        }
      }

      let backupDirectory;
      if (values.preview) {
        const destination = resolve(values.preview);
        mkdirSync(destination);
        for (const file of files) {
          if (file.path === launcher) continue;
          const folder = join(destination, file.target.bundle);
          mkdirSync(folder);
          writeFileSync(join(folder, basename(file.path)), file.translated, {
            flag: "wx",
          });
        }
      } else if (values.apply) {
        const pending = files.filter((file) => file.status !== "chinese");
        if (pending.length) {
          for (const file of pending) {
            if (!readFileSync(file.path).equals(file.original))
              throw new Error(`文件在检查后发生变化：${file.path}`);
          }
          backupDirectory = join(
            homedir(),
            ".local",
            "stm32cube",
            "zh-backups",
            new Date().toISOString().replaceAll(":", "-"),
          );
          mkdirSync(backupDirectory, { recursive: true });
          const records = [];
          for (const [index, file] of files.entries()) {
            const backup = `${index + 1}-${file.target.bundle}-${basename(file.path)}`;
            writeFileSync(join(backupDirectory, backup), file.source, {
              flag: "wx",
            });
            if (!file.source.equals(file.original))
              writeFileSync(
                join(backupDirectory, `previous-${backup}`),
                file.original,
                { flag: "wx" },
              );
            records.push({
              path: file.path,
              backup,
              bundle: file.target.bundle,
              version: file.target.version,
              originalSha256: createHash("sha256")
                .update(file.source)
                .digest("hex"),
              patchedSha256: createHash("sha256")
                .update(file.translated)
                .digest("hex"),
            });
          }
          writeFileSync(
            join(backupDirectory, "files.json"),
            `${JSON.stringify(records, null, 2)}\n`,
            { flag: "wx" },
          );
          for (const file of pending) writeFileSync(file.path, file.translated);
        }
      }
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode: values.apply ? "apply" : values.preview ? "preview" : "check",
            backupDirectory,
            files: files.map((file) => ({
              path: file.path,
              status: values.apply ? "chinese" : file.status,
              edits: file.target.edits.length,
            })),
          },
          null,
          2,
        ),
      );
    }
  }
} catch (error) {
  console.log(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
}
