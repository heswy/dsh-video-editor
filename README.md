# DSH Video

运行在 DeepSeek Harness 内的 AI 视频创作与编辑插件。产品目标：左侧直接预览、播放和编辑作品，右侧持续和 AI 对话；支持历史会话、宿主模型选择和用户素材。画面下只保留轻量播放条，不做场景缩略卡片带。

当前：多Scene引擎与预览快照已在本机受控范围验收；最近确认安装为插件 0.2.1，插件0.2.2交付已通过独立复核、尚未安装。实时编辑画布与 AI 创作闭环尚未完成。具体提交、验证范围和下一步以 [当前状态](docs/STATUS.md) 为准，避免从此简介推断功能已上线。

## 开工入口

1. [当前状态与任务](docs/STATUS.md)
2. [开发与协作规则](docs/DEVELOPMENT.md)
3. [工作区接手入口](docs/handoffs/README.md)
4. [产品约定](docs/product/PRODUCT.md)与[前端设计](docs/design/FRONTEND-DESIGN.md)

[文档索引](docs/README.md) · [阶段路线](docs/ROADMAP.md) · [决策记录](docs/DECISIONS.md) · [历史状态](docs/STATUS-HISTORY.md)

协调分支 `codex/project-foundation` 维护当前文档；实现分别位于 `codex/p1-engine-spike-b4bf` 和 `dsh/p0-mode-shell`。main 暂为初始提交，开发进展见草稿 PR [#1](https://github.com/heswy/dsh-video-editor/pull/1)、[#2](https://github.com/heswy/dsh-video-editor/pull/2)、[#3](https://github.com/heswy/dsh-video-editor/pull/3)。工作区可长期复用，不因任务或会话更名重开分支。

原始方案、开发包及截图为证据；采纳范围以最新产品文档、决策和当前任务为准。概念图是设计提案，不是真机功能截图。
