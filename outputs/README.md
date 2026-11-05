# STM32CubeCLI 中文补丁使用与维护说明

原地汉化 Windows x64 上的 STM32CubeCLI。帮助说明、组件管理提示、CMSIS 支持包管理提示和工程创建提示使用简体中文。

| 组件                | 适用版本 |
| ------------------- | -------- |
| cube-wrapper        | 0.10.4   |
| pack-manager        | 0.6.5    |
| ide-project-creator | 1.1.0    |

补丁同时处理 `.local/stm32cube/bin/cube.exe` 和组件仓库中的 `cube.exe`。命令名、参数名、芯片名称和机器输出中的字段继续使用原始标识。

## 使用

需要 Windows x64、Node.js 24 或更高版本，以及上表中的全部三个组件。补丁只使用 Node.js 内置模块，无需安装 npm 依赖。

Node 可以来自独立安装，也可以使用组件附带的运行时。使用后者时，将以下命令中的 `node` 替换为 `cube node`，例如 `cube node outputs/patch.mjs --apply`。

`cube --version` 显示入口版本，`cube bundle list` 列出已安装组件。官方安装器仅安装命令入口时，可运行：

```powershell
cube bundle install pack-manager@0.6.5 ide-project-creator@1.1.0
```

补丁适配的入口版本为 `cube-wrapper 0.10.4`。组件版本不同需要对应补丁，脚本不会安装或降级官方软件。

下载整个仓库后，在仓库根目录运行：

```powershell
node outputs/patch.mjs
node outputs/patch.mjs --apply
```

第一条命令只检查版本与文件匹配情况。第二条命令先保存所有待修改文件，再应用汉化。重复应用时跳过已经汉化的文件。

### 只分发应用文件

从本目录取出 `patch.mjs`、`patches.json` 和本说明，放在同一目录。接收者在该目录运行：

```powershell
node patch.mjs --apply
```

补丁数据通过脚本所在位置读取，不依赖启动终端的工作目录。`build.mjs`、`verify.mjs` 和 `translations.json` 用于维护，可留在源码仓库中。

### 查看结果

```powershell
cube --help
cube bundle install --help
cube pack --help
cube ide-project-create --help
```

安装根目录采用官方安装器的位置：命令入口位于用户目录的 `.local/stm32cube/bin`，组件仓库位于 `%LOCALAPPDATA%/stm32cube/bundles`。设置了 `CUBE_BUNDLE_PATH` 时使用该组件仓库。

补丁按组件版本、文件长度和修改位置的原始内容匹配。遇到其他版本或不匹配的内容时停止。完成后返回 JSON，`ok` 为 `true`，每个文件的 `status` 为 `chinese`。

| 检查结果    | 含义                                         |
| ----------- | -------------------------------------------- |
| `english`   | 文件符合原始版本，可以应用补丁               |
| `chinese`   | 文件符合当前汉化版本                         |
| `outdated`  | 指定 `--backup` 后识别到可更新的旧汉化       |
| `ok: false` | 检查或操作失败，`error` 给出原因，退出码为 1 |

两个 `cube.exe` 和两个 JavaScript 入口共四个文件均检查通过后，才开始备份与应用。

## 原文件备份

备份保存在 `.local/stm32cube/zh-backups/<时间戳>/`。应用命令的 JSON 输出包含完整的 `backupDirectory`。其中 `files.json` 记录目标路径、备份文件名及原文件和汉化文件的 SHA-256。

需要恢复时，在确认备份目录后运行：

```powershell
node outputs/patch.mjs --restore "备份目录的完整路径"
```

恢复前检查备份文件和当前汉化文件。当前文件发生过其他修改时停止，保留现有内容。

首次应用的备份用于恢复英文原文件。更新汉化时，脚本继续保存原文件，并将更新前的汉化文件另存为 `previous-` 开头的文件。应用返回的备份目录适合与该次结果配套使用。

## 验证

下面的命令均在仓库根目录运行。`work/` 用于保存验证产物，已有此目录时可略过创建命令；预览的目标目录需要不存在：

```powershell
New-Item -ItemType Directory work
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

仓库中的 `validation.json` 记录 43 项通过结果，包含 34 项帮助检查、6 项参数校验、2 项 JSON 内容对比和 1 项 Node 子命令转发。报告中的 `baseline` 是当次验证使用的本机原程序备份路径，重跑时需指定实际备份。

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

`--backup` 需要使用应用命令输出的完整备份目录。补丁记录与备份以绝对目标路径关联，适合在原安装上更新。

生成器只适配上表版本的 Windows 程序布局。修改原生程序译文时，既要满足 UTF-8 字节空间，也要检查帮助排版及退出状态。

仓库的格式化与静态检查配置位于 `biome.json`。已安装 Biome 时，在仓库根目录运行：

```powershell
biome check --write --error-on-warnings .
```

## 常见问题

| 现象                         | 处理方式                                               |
| ---------------------------- | ------------------------------------------------------ |
| 找不到 `node`                | 安装 Node.js 24 或更高版本，然后重新打开终端           |
| 找不到某个 `CubeBundle.json` | 使用 `cube bundle list` 确认三个必需组件及其版本       |
| 文件与补丁不匹配             | 检查入口版本、组件版本和是否有其他本地修改             |
| 更新补丁后拒绝原有汉化文件   | 使用原应用产生的 `--backup` 目录进行更新               |
| 恢复时提示当前文件不符       | 使用与当前汉化结果配套的备份记录；保留当前文件调查差异 |

默认安装的组件和入口位于用户目录。自定义组件仓库可通过 `CUBE_BUNDLE_PATH` 指定；入口仍按官方默认的 `.local/stm32cube/bin/cube.exe` 定位。

## 范围

翻译覆盖这三个组件的帮助、主要交互提示和常见报错。独立的 GCC、GDB、CMake、Ninja、Programmer 等工具使用各自的输出；第三方库、操作系统错误和部分底层诊断也可能显示英文。

组件更新可能替换已修改的文件。此补丁按上表版本生成，其他版本需要重新适配。

仓库只保存译文、局部差异和脚本。官方程序与本机备份保存在安装目录和工作目录中。
