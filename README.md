<div align="center">

![DSH Video — From conversation to creation](docs/assets/hero.svg)

# DSH Video

**用对话构思，用时间线打磨，让想法成为影片。**

DeepSeek Harness 内的 AI 视频创作与剪辑工作台。<br>
右侧对话生成与续改，左侧即时预览，多轨剪辑与 MP4 导出一站完成。

[![Version](https://img.shields.io/badge/version-1.0.0-829cff?style=flat-square)](docs/STATUS.md) [![DSH](https://img.shields.io/badge/DeepSeek_Harness-%E2%89%A50.2.1--rc.2-5865f2?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness) [![Node](https://img.shields.io/badge/Node.js-22%2B-70b798?style=flat-square)](https://nodejs.org/) [![Platform](https://img.shields.io/badge/tested-macOS_Apple_Silicon-a7b8d3?style=flat-square)](#安装) [![MIT](https://img.shields.io/badge/license-MIT-c4b5fd?style=flat-square)](LICENSE)

**简体中文** · [English](README.en.md)

[功能](#从一句想法到一条影片) · [安装](#安装) · [开始创作](#开始创作) · [开发](#开发) · [文档](docs/README.md)

</div>

## 从一句想法，到一条影片

| 创作环节 | 你可以做什么 |
|---|---|
| **对话创作** | 描述想要的影片，复用 DSH 的模型和原生对话，持续修改同一作品。 |
| **即时预览** | 自动更新画面，播放、暂停、跳转，边看边调整。 |
| **多轨剪辑** | 导入图片、视频与音频；移动、裁剪、拆分、复制、排序和吸附。 |
| **看见声音** | 真实音频波形、连续视频缩略图，视频原声一键分离为独立音轨。 |
| **放心修改** | AI 与手动操作共享撤销/重做；工程自动保存，重开继续创作。 |
| **交付成片** | 导出带声音的 H264/AAC MP4，查看进度或取消任务。 |

封面为产品工作流插画。功能与验证边界见[当前状态](docs/STATUS.md)。

## 安装

需要 **DeepSeek Harness ≥ 0.2.1-rc.2、Node.js ≥ 22、FFmpeg/ffprobe 和 Google Chrome**。目前实测 macOS Apple Silicon；其他平台尚未完成验收。

打开 DSH **插件 → 添加插件**，使用下列任一来源，安装后启用：

### GitHub 仓库

```text
https://github.com/heswy/dsh-video-editor
```

> 本次安装适配尚在 PR 中。合入 main 后，上述地址才包含完整适配；此前请勿把旧 main 安装视为已验证。

源码直接提供 JavaScript 和引擎源码，依赖由 DSH 安装，无需授权插件构建脚本。稳定使用可固定到已验收提交：`github:heswy/dsh-video-editor#<commit>`。

### npm 包名

```text
dsh-video-editor
```

> **待首次 npm 发布。** 发布前请使用 GitHub；`dsh-video` 是其他作者的包，请勿混淆。npm 来源选择官方源，或等待所用镜像同步。

### Release / 离线包

从 [Releases](https://github.com/heswy/dsh-video-editor/releases) 下载设备对应的 `.tgz`，在添加插件时输入下载地址或本地文件的绝对路径。首次公开 Release 尚未发布。

安装方式、发行准备和更新说明见[安装与发布](docs/releases/UPDATE-CHANNEL.md)。

## 开始创作

1. 从 DSH 左侧进入 **Vedio Editor**（当前界面入口名称），创建或打开作品。
2. 在右侧描述影片；生成后左侧自动更新预览。
3. 继续对话，或在时间线上调整片段。自己的图片、视频和音频从 **素材** 导入。
4. 点击 **导出 MP4**，等待完成并保存成片。

可以从这样的想法开始：

> 做一段 15 秒的产品介绍，深色背景，分三段展示标题、亮点和结束语，转场简洁。

工程默认保存在 `~/Movies/DSH Video`。模型和密钥由 DSH 管理，本仓库无需配置模型 API key。音频本地生成不等于真人演唱；画布内对象直接编辑暂不提供。

## 更新、停用与回滚

编辑器顶栏 **插件更新** 支持检查版本、查看说明和主动安装；本地 link 开发安装由开发者更新。安装完成后按提示重启 DSH。

在 DSH 插件页可以停用。回滚时移除当前插件并安装上一已验证包，保留用户数据目录和旧包；不要删除工程文件。

## 开发

```sh
git clone https://github.com/heswy/dsh-video-editor.git
cd dsh-video-editor
npm ci --ignore-scripts
npm run check
node --test tests/*.test.mjs
```

运行时为直接加载的 JavaScript。`host/` 负责工程、会话与资源边界，`client.js` 提供原生工作区，`packages/` 保存独立视频引擎。开发规则见 [DEVELOPMENT](docs/DEVELOPMENT.md)，发布流程见[发行指南](docs/releases/UPDATE-CHANNEL.md)。

发现问题请提交 [Issue](https://github.com/heswy/dsh-video-editor/issues)，附 DSH/插件版本、设备及复现步骤；不要上传密钥或私人作品。安全问题见 [SECURITY](SECURITY.md)。

## 致谢与许可

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，视频引擎使用 [HyperFrames](https://github.com/heygen-com/hyperframes)。感谢开源社区。

[MIT](LICENSE) © DSH Video contributors
