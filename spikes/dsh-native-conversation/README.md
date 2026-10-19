# spikes/dsh-native-conversation（P3-005-A 只读调查工具）

本目录只保存 **P3-005-A 只读契约调查** 所需的本地提取/检查脚本，不属于根插件运行时，不进入 `package.json` 的 `files` 安装清单。

- `asar-read.mjs`：解析已安装 Desktop 的 `app.asar` 头部，按路径列目录、读取文本、按行区间读取或做正则搜索。只读；不执行包内代码，不写 app 包，也不访问 profile/会话内容。
  - 默认归档：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`（可用 `DSH_ASAR` 覆盖）。
  - 例：`node spikes/dsh-native-conversation/asar-read.mjs read dsh/package.json`
  - `tree [prefix]`、`list [prefix]`、`read <path>`、`lines <path> <from> <to>`、`grep <regex> --prefix <dir> --ext js,md --max N`。
- 调查结论、精确版本与未测项记录在 `docs/research/P3-005A-native-conversation-contract.md`。本目录脚本不能替代 DSH 真机安装/激活验证。
