# P0-002 修复复审

日期：2026-10-17。提交：`8ebf922`、`a31ee51`；原评审：`43f8c19`。

结论：**主要修复通过代码与本地检查，可进入受控安装验证；P0 尚未完成验收。** 未把实现合入协调分支或 main。

## 证据

- 已读实际 Client diff、相关 Slot 生命周期实现及测试更新；首轮评审原文无改动。
- 复跑 `npm run check`：静态 20/20、VM smoke 24/24 通过；变更 `git diff --check` 通过。
- R1：main 声明回调内成功注册目标后再建立 leading 注入，测试已覆盖等待/折叠/重声明与失败。
- R2：一次性 thumbOrigin 呈现提示与宿主 activePanel 分离，导航不等待动画；动效起终态与中断的本地逻辑通过。真实 CSS 播放未验收。
- R3：模式组件自身读取宿主字号，文字 em、尺寸 clamp；真实窄窗/字号排版仍待实测。
- 引擎 worktree 与 P0 文件边界独立；P1 无需等待此安装。

## 固定安装包

- 来源：干净的 DSH worktree `a31ee51`，`dsh-video@0.1.0`。
- 位置：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p0-mode-shell/a31ee51/dsh-video-0.1.0.tgz`。
- SHA-256：`c0257548cad4f6f737d90eee3eb7b73ac823a946732d37710ff58cbb4490bbc4`。
- `npm pack --offline --pack-destination ...` 实际产出；9 文件；包内 Client 与所审源码字节相同，未含 scripts/原始截图/开发包，无路径越界和链接条目。
- 本轮仅打包，没有安装、启用或 profile 改动。后续修复需产生新提交和新路径/摘要，不覆盖此证据包。

## 安装后重点

检查中文/英文、顶部 no-drag 与侧栏折叠、模式快速反向、键盘焦点、明暗主题及字号；测试会话草稿中的引用、待发送图片/文件与阅读位置；视频页停用能回普通且重新启用无残留。

剩余边界观察：leading **晚于 main 才声明**且其注册失败时，当前注册链的后置就绪检查只在第一次建立链时执行；需实测/合约补验晚到与独立重声明失败是否留下不可达视频面板。该边界不阻止当前已声明 Slot 的受控安装，但不得据已过测试宣称所有动态重挂场景通过；重现后交 DSH 修复再验。

## 下一步

按 `docs/tasks/P0-003-install-validation.md` 准备安装验证。只有用户明确发送授权提示后，DSH 才安装/启用本固定包。不把用户转发的完成报告视为安装授权。
