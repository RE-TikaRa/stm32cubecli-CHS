# STM32CubeCLI 中文补丁

原地汉化 Windows x64 上的 STM32CubeCLI。帮助说明、组件管理提示、CMSIS 支持包管理提示和工程创建提示使用简体中文。

| 组件                | 适用版本 |
| ------------------- | -------- |
| cube-wrapper        | 0.10.4   |
| pack-manager        | 0.6.5    |
| ide-project-creator | 1.1.0    |

补丁同时处理 `.local/stm32cube/bin/cube.exe` 和组件仓库中的 `cube.exe`。命令名、参数名、芯片名称和机器输出中的字段继续使用原始标识。

## 使用

需要 Node.js 24 或更高版本。在仓库根目录运行：

```powershell
node outputs/patch.mjs
node outputs/patch.mjs --apply
```

第一条命令只检查版本与文件匹配情况。第二条命令先保存所有待修改文件，再应用汉化。重复应用时跳过已经汉化的文件。

```powershell
cube --help
cube bundle install --help
cube pack --help
cube ide-project-create --help
```

安装根目录采用官方安装器的位置：命令入口位于用户目录的 `.local/stm32cube/bin`，组件仓库位于 `%LOCALAPPDATA%/stm32cube/bundles`。设置了 `CUBE_BUNDLE_PATH` 时使用该组件仓库。

补丁按组件版本、文件长度和各处原始内容匹配。遇到其他版本或不同内容时停止，不覆盖文件。

## 原文件备份

备份保存在 `.local/stm32cube/zh-backups/<时间戳>/`。应用命令的 JSON 输出包含完整的 `backupDirectory`。其中 `files.json` 记录目标路径、备份文件名及原文件和汉化文件的 SHA-256。

需要恢复时，在确认备份目录后运行：

```powershell
node outputs/patch.mjs --restore "备份目录的完整路径"
```

恢复前检查备份文件和当前汉化文件。当前文件发生过其他修改时停止，保留现有内容。

## 验证

生成验证副本时，指定一个不存在的目录：

```powershell
node outputs/patch.mjs --preview work/preview
node outputs/verify.mjs --preview work/preview --report work/validation.json
```

验证覆盖主命令及各级子命令帮助、必填参数提示、未知选项提示、相似名称提示、工程创建工具链取值校验、JSON 内容与命令转发。

汉化应用前运行验证，可以比较原安装与汉化副本的 JSON 内容。省略 `--preview` 时检查当前安装。

安装已汉化时，可通过 `--baseline` 指定备份中的原始 `cube.exe`，继续检查 JSON 内容和退出状态是否一致：

```powershell
node outputs/verify.mjs --baseline "原始 cube.exe 的备份路径" --report outputs/validation.json
```

验证命令仅查询帮助或使用会在参数校验时结束的输入。安装、卸载、同步、创建实际工程及硬件通信需要各自的业务验证；终端字体下的视觉效果也需要实际查看。

## 修改译文

`translations.json` 保存原文与译文。`native` 是原生程序文字，`common` 是两个 JavaScript 工具共用的命令解析提示，`pack` 和 `project` 是各自的文字。

`build.mjs` 从原文件生成 `patches.json`。安装已汉化时，可使用应用前的备份生成：

```powershell
node outputs/build.mjs --backup "备份目录的完整路径"
```

原生程序的译文使用原有存储位置，并同步调整可识别的 Rust 字符串长度。译文的 UTF-8 字节数需要适合原有空间。JavaScript 补丁按原始位置保存局部替换规则，并记录修改后的位置。

更新现有汉化时，使用原文件备份生成验证副本并应用：

```powershell
node outputs/patch.mjs --backup "原文件备份目录" --preview work/preview
node outputs/patch.mjs --backup "原文件备份目录" --apply
```

更新前检查当前文件是否符合备份记录，并保存完整的原文件与更新前的汉化文件。`patches.json` 由工具生成，译文调整在 `translations.json` 中进行。

## 范围

翻译覆盖这三个组件的帮助、主要交互提示和常见报错。独立的 GCC、GDB、CMake、Ninja、Programmer 等工具使用各自的输出；第三方库、操作系统错误和部分底层诊断也可能显示英文。

组件更新可能替换已修改的文件。此补丁按上表版本生成，其他版本需要重新适配。

仓库只保存译文、局部差异和脚本。官方程序与本机备份保存在安装目录和工作目录中。
