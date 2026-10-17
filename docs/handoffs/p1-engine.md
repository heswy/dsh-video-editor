# p1-engine：当前接手

更新：2026-10-17。当前工作树已恢复，路径见 DEVELOPMENT；沿用 `codex/p1-engine-spike-b4bf` 和 PR #2，不新建树、不改分支名。

## 当前事实

- 最近功能交付 `9df968c` / 记录 `aae05e9`；P3-003 已在受控本机范围验收。原归档 snapshot 与 aae05e9 一致。
- 恢复后 worker/client 按锁文件安装并禁安装脚本；基线 worker 17/17、client 16 pass + 1 opt-in skip。旧忽略产物未整体恢复。
- 本轮只同步 AGENTS 入口，HEAD 因文档提交可前移；功能基线仍为 aae05e9，不 reset 回旧提交。

## 继续哪个任务

从协调分支读取 [P3-004](../tasks/P3-004-engine-preview-snapshot.md) 和 [P3-003 复审](../reviews/P3-003-review-01.md)。仅该任务已放行：schema、preview.snapshot/release、registry 失败恢复、两包 0.2.1 与测试/固定包。若本地还没有指南，按指南开工步骤存档到任务文件，填开发记录。

本轮产品 v0.3 已确认：无底部场景缩略卡片，右 AI 常驻、左直接编辑；这不改变引擎快照任务。不要新增 UI、模型调用或素材界面。

全局文档和本交接均通过 `git show origin/codex/project-foundation:<路径>` 阅读；不用 merge 协调分支。读取的协调 SHA 记入任务交付。完成后正常 commit/push 更新 PR #2，由用户转交评审；未获单独授权不安装/启停/重启/merge。
