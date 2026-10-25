# 当前状态

更新：2026-10-25。

## 1.0.0

功能开发已完成，最后功能通过 PR #33 合入 main（56841bb）。本机仍是此前已验收的 `dsh-video` 1.0.0 / engine 0.9.0 固定 link 包；本轮不替换用户安装或重启 DSH。

已完成：AI 对话生成/续改、自动预览、稳定工程存储、素材导入、多轨剪辑、撤销重做、真实波形、连续缩略图、分离音频、轨道画面/声音控制、带声音 MP4 导出、插件更新入口。

## 仓库与发行整理

- 公开包名调整为 `dsh-video-editor`，避免与他人已占用的 `dsh-video` 混淆。稳定用户数据、UI key 和 API 路由保持不变。
- GitHub/npm 安装带 JS 与引擎源码、固定根依赖；安装无需插件构建脚本。修正引擎对嵌套 node_modules 布局的假设。
- 新增中英文 README、品牌 SVG 封面、安全指南、发布步骤与依赖锁文件。
- 历史实验、第三方开发包副本、任务/评审流水与原始证据从当前树移除；整理前固定提交仍保留全部 Git 历史，本机另外保存完整归档。当前 docs 仅保留有效入口与规范。
- Gitleaks 已扫描整理前全部可达分支的302个提交，未发现密钥；当前发行树另行扫描。

## 验证与发行边界

源码门禁58/86/71通过；安装/更新相关15项测试通过；版本门禁10项通过。临时 DSH_HOME 的0.9.9→1.0.0安装、工程revision保留和真实抽帧通过。此为隔离安装/引擎证据，不冒充用户 Desktop 新包验收。

GitHub 公网固定完整提交直装、工程创建和真实抽帧已通过。用户已明确授权合并 PR #34 并发布 npm 1.0.0；首次 npm 发布及发布后包名验证正在执行，GitHub Release 尚未发布。操作见[发行指南](releases/UPDATE-CHANNEL.md)。

## 当前边界

实测平台为 macOS Apple Silicon；Node22+、FFmpeg/ffprobe、Chrome 由系统提供。Windows/Linux/Intel、扬声器听感及真实模型复杂多轮效果未在本轮复验。画布对象直接编辑延期。

开发规则见 [DEVELOPMENT](DEVELOPMENT.md)，交接见 [handoffs](handoffs/README.md)。历史证据见[整理前固定版本](https://github.com/heswy/dsh-video-editor/tree/56841bb60b989aa55aa0ef4897f107a8a66823d1)。
