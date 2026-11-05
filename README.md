# STM32CubeCLI 简体中文补丁

为 Windows x64 上的 `cube` 主命令、组件管理、CMSIS 支持包管理和工程创建工具提供中文帮助与交互提示。补丁原地修改已安装文件，自动保存原文件备份。

| 组件                | 支持版本 |
| ------------------- | -------- |
| cube-wrapper        | 0.10.4   |
| pack-manager        | 0.6.5    |
| ide-project-creator | 1.1.0    |

需要 Node.js 24 或更高版本，以及使用官方默认位置安装的 STM32CubeCLI。上述三个组件需要全部安装，`cube-wrapper` 的版本号可通过 `cube --version` 查看，组件清单可通过 `cube bundle list` 查看。

## 快速使用

仅安装了官方命令入口时，先安装另外两个组件：

```powershell
cube bundle install pack-manager@0.6.5 ide-project-creator@1.1.0
```

下载本仓库，在仓库根目录打开 PowerShell，运行：

```powershell
node outputs/patch.mjs --apply
```

无需安装 npm 依赖。脚本会检查组件版本和待修改内容，保存备份后应用汉化。

也可使用已安装组件提供的 Node 运行时：`cube node outputs/patch.mjs --apply`，无需单独将 Node 加入 PATH。

```powershell
cube --help
cube bundle install --help
cube pack --help
cube ide-project-create --help
```

## 分发文件

普通使用只需取出以下文件，放在同一目录：

```text
patch.mjs
patches.json
README.md
```

这三个文件位于仓库的 `outputs/`。在该目录运行 `node patch.mjs --apply`。其他脚本和译文表用于维护与验证补丁。

## 文档与验证

- [完整使用与维护说明](outputs/README.md)：安装要求、备份恢复、补丁更新、常见问题和译文维护。
- [验证报告](outputs/validation.json)：43 项检查通过，覆盖帮助、参数校验、两项 JSON 内容对比和子命令转发。
- [译文表](outputs/translations.json)：主命令与两个 JavaScript 工具的原文、译文。

命令名、参数名和 JSON 字段保持原始标识。独立的 GCC、GDB、CMake、Ninja、Programmer 等工具使用各自的输出。编译、烧录和硬件通信尚未实测。

CubeMX 图形界面的补丁位于独立仓库：[STM32CubeMX-zh](https://github.com/RE-TikaRa/STM32CubeMX-zh)。
