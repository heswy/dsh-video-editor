# DSH Video：AI-Native Programmatic Video Studio 方案

> 一个运行在 DeepSeek Harness（DSH）中的 AI 原生视频创作插件。  
> 核心不是“让 AI 帮用户剪视频”，而是让 Agent **直接用代码写视频**，并允许用户在同一个工程中进行可视化修改与传统剪辑。

---

## 1. 项目定位

### 1.1 一句话定义

**DSH Video 是一个让 Agent 直接“写视频”的 AI-Native Programmatic Video Studio。**

它不是在 DSH 里复刻一个剪映、Premiere 或 CapCut，而是让 DSH 获得一种新的创作能力：

- AI 可以从零生成视频 Scene；
- AI 可以编写 HTML / SVG / Canvas / WebGL / Three.js / GSAP 等程序化动画；
- AI 可以把用户导入的视频、图片、音频作为素材重新导演；
- AI 可以生成 Motion Graphics、字幕动画、数据可视化、UI Demo、产品发布片等；
- 用户可以在可视化 Workspace 中直接修改 Scene、对象和 Timeline；
- 用户与 AI 操作同一个项目状态；
- 最终通过浏览器渲染与 FFmpeg 导出 MP4。

核心理念：

> **Code as Video, Agent as Director, Human as Co-Creator.**

---

# 2. 项目不是什么

DSH Video 第一阶段不应被定义为：

- AI 剪映；
- AI Premiere；
- 传统 NLE（Non-linear Editor）复刻；
- 单纯 FFmpeg GUI；
- 单纯 Remotion Generator；
- “输入一句 Prompt → 返回一个 MP4”的黑盒生成器；
- Sora / Veo 类型的视频扩散模型。

传统剪辑能力仍然需要，但它只是基础设施，而不是产品中心。

传统视频编辑器的世界观通常是：

```text
素材
↓
拖入 Timeline
↓
剪切 / 拼接 / 转场
↓
输出视频
```

DSH Video 的世界观应该是：

```text
Prompt / Brief / Assets
↓
Agent
↓
Treatment / Storyboard / Style
↓
代码生成 Scene
↓
HTML / SVG / Canvas / GSAP / Three.js
↓
Preview
↓
人与 Agent 共同修改
↓
Timeline 组合
↓
Review
↓
Render
```

---

# 3. 为什么必须做成 DSH 插件

DSH 的价值不只是“可以调用模型”。

它本身就是一个 Agent Harness：

- Plugin Runtime；
- Tool Registry；
- Skill Registry；
- Model Router；
- Agent Loop；
- Client Module；
- Remote API；
- Storage；
- Session；
- Subagent；
- 权限与生命周期管理。

因此 DSH Video 不应该 fork DSH，也不应该独立再造一个 AI Agent 系统。

正确的产品关系是：

```text
DeepSeek Harness
│
├── Chat / Coding 等已有能力
│
└── DSH Video Plugin
      │
      ├── Video Workspace
      ├── Video Tools
      ├── Video Skills
      ├── Composition Runtime
      ├── Timeline
      └── Render Pipeline
```

对用户而言，它仍然是一个插件：

```bash
dsh plugin add dsh-video
```

安装后，DSH 获得视频创作能力。

---

# 4. 产品核心：AI 用代码“写”视频

这是整个方案中最重要的一点。

视频并不只是：

```text
现成素材 + Timeline
```

一个视频工程中的 Scene 可以完全由 AI 从零用代码生成。

例如：

```text
Launch Video
│
├── Scene 01
│   ├── Gradient Background
│   ├── Logo
│   ├── Kinetic Typography
│   └── Particle Field
│
├── Scene 02
│   ├── Product Screenshot
│   ├── Camera Zoom
│   ├── SVG Highlight
│   └── Cursor Animation
│
├── Scene 03
│   ├── Imported Demo Video
│   ├── Programmatic Crop
│   ├── Floating UI
│   └── Captions
│
└── Scene 04
    ├── Three.js Geometry
    ├── CTA
    └── Outro
```

其中：

- Scene 01 可以完全由代码生成；
- Scene 02 是图片素材 + 程序化动画；
- Scene 03 是真实视频 + AI 动态包装；
- Scene 04 可以是 3D + typography。

因此：

> **真实视频素材只是视频工程的一种素材，不是视频工程本身。**

---

# 5. 三种 Scene 类型

建议把 Scene 分成三类。

## 5.1 Generated Scene

完全由 Agent 写代码生成。

例如：

- Typography；
- Motion Graphics；
- Data Visualization；
- Particle；
- SVG Illustration；
- Three.js；
- Shader；
- UI Animation；
- Product Demo Mockup。

```text
Prompt
↓
Agent
↓
HTML / SVG / Canvas / WebGL
↓
Scene
```

---

## 5.2 Media Scene

主要基于用户现成素材：

- 视频；
- 图片；
- 音频；
- 屏幕录制；
- 摄像机素材。

可以进行：

- trim；
- split；
- crop；
- speed；
- subtitle；
- BGM；
- transition。

---

## 5.3 Hybrid Scene

这是最重要的一类。

例如：

```text
真实产品录屏
+
AI 写的 Camera Zoom
+
Spotlight
+
Cursor
+
Floating Callout
+
Kinetic Typography
+
Transition
```

这不再只是“剪素材”，而是：

> **AI 对现实素材进行重新导演。**

未来 DSH Video 最核心的作品，大概率都会是 Hybrid。

---

# 6. 两层编辑模型

DSH Video 不应该只有 Timeline。

整个视频工作区应该分成两个主要编辑层。

---

## 6.1 Composition Layer

这是 AI 最擅长的地方。

负责 Scene 内部：

- HTML；
- CSS；
- SVG；
- Canvas；
- GSAP；
- Three.js；
- WebGL；
- shader；
- typography；
- camera；
- particles；
- charts；
- UI demo；
- transitions。

用户可以选中一个 Scene 内的对象：

```text
Scene 02

├── Background
├── Screenshot
├── Headline
├── Glow
├── Cursor
├── Callout
└── Camera
```

然后告诉 AI：

> 这个标题出现得太俗了。

Agent 知道用户指的是 `Headline`。

再说：

> 改成从模糊里慢慢浮出来，最后轻微 overshoot。

AI 直接修改对应代码。

---

## 6.2 Timeline Layer

Timeline 负责跨 Scene 的时序关系：

- Scene 排序；
- Scene duration；
- Clip trim；
- clip split；
- audio；
- BGM；
- subtitle；
- timing；
- transition；
- beat synchronization。

因此：

```text
Composition Layer
负责“这一幕是什么、怎么动”

Timeline Layer
负责“什么时候出现、持续多久、如何衔接”
```

Timeline 很重要，但不应该定义整个产品。

---

# 7. 核心架构

推荐总体架构：

```text
                          DSH
┌──────────────────────────────────────────────────────┐
│                                                      │
│        User Prompt              Direct Manipulation  │
│             │                           │            │
│             ▼                           ▼            │
│         DSH Agent                  Video Workspace   │
│             │                           │            │
│       Video Skills                      │            │
│             │                           │            │
│             └────────────┬──────────────┘            │
│                          ▼                           │
│                    Video Service                     │
│                          │                           │
└──────────────────────────┼───────────────────────────┘
                           ▼
                  Composition Project
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
        Code Scenes      Assets        Timeline
            │              │              │
      HTML / SVG          Video          Timing
      Canvas              Image          Audio
      Three.js            Audio          Subtitle
      WebGL
            └──────────────┬──────────────┘
                           ▼
                  Browser Renderer
                           │
                    Chromium / Playwright
                           │
                           ▼
                        FFmpeg
                           │
                           ▼
                       Final MP4
```

---

# 8. 视频引擎：优先参考 HyperFrames

经过调研，HyperFrames 的方向非常接近 DSH Video 需要的底层能力：

- HTML-based video；
- Timeline；
- Preview；
- Studio；
- Inspector；
- source synchronization；
- Chromium render；
- FFmpeg；
- Agent Skills；
- Whisper；
- Talking Head workflow；
- captions；
- programmatic animation；
- Apache-2.0。

因此推荐：

```text
DSH
= Agent / Plugin / Model / Skill / Tool

HyperFrames
= Composition / Timeline / Preview / Render Base

FFmpeg
= Media Infrastructure

Skills
= Creative Intelligence
```

需要注意：

**不能把 DSH Video 变成“HyperFrames 的套壳”。**

真正需要我们建立的是：

> **DSH 与程序化视频 Runtime 之间的 AI-Native Editing Layer。**

---

# 9. Remotion 的角色

Remotion 不需要被排除。

它非常适合：

- React Video；
- Product Launch；
- Motion Graphics；
- UI Animation；
- React component reuse；
- 已有 Remotion ecosystem。

现有 DSH `remotion-video-plugin` 已经验证：

```text
DSH Agent
↓
Remotion Project
↓
Render Still
↓
Render Video
↓
ffprobe
↓
MP4
```

因此建议：

```text
Primary Runtime
└── HyperFrames / HTML Runtime

Optional Generator Backends
├── Remotion
├── Manim
└── Blender
```

未来 AI 可以根据 Scene 类型决定使用哪个 Renderer。

例如：

```text
动态图形
→ HTML / GSAP

React 产品视频
→ Remotion

数学动画
→ Manim

高复杂度 3D
→ Blender
```

---

# 10. Opus 5.5 给我们的真正启发

最近所谓“Opus 5.5 做视频”，真正值得学习的不是某个模型名字，而是整个 Harness。

典型路径：

```text
LLM
↓
HTML / SVG / Canvas / WebGL
↓
确定性 animation(t)
↓
Browser
↓
Frames
↓
FFmpeg
↓
MP4
```

真正优秀的作品通常不是：

```text
一个巨大 Prompt
↓
一次生成
```

而是：

```text
Brief
↓
Treatment
↓
Storyboard
↓
Visual Style
↓
Beat Map
↓
Scene Generation
↓
Keyframe Preview
↓
Draft Render
↓
Visual Review
↓
Iteration
↓
Final Render
```

因此真正重要的是：

> **Prompt is only part of the system. Harness + Skill + Review Loop 才决定最终质量。**

---

# 11. DSH Video 的 Agent Workflow

核心工作流：

```text
UNDERSTAND
理解用户 Brief

↓
DIRECT
生成 Treatment / Storyboard

↓
DESIGN
确定 Visual System / Motion Language

↓
BUILD
Agent 用代码生成 Scene

↓
COMPOSE
组织 Timeline / Audio / Scene

↓
PREVIEW
关键帧 / Contact Sheet / Draft

↓
REVIEW
视觉模型审片

↓
REFINE
修改代码 / timing / typography / audio

↓
RENDER
最终导出
```

---

# 12. AI-Native 的定义

AI-Native 不等于：

> 在视频编辑器右边放一个聊天框。

真正的 AI-Native 是：

> 用户当前正在看的、选中的、修改的内容自动成为 Agent Context。

例如：

用户框选：

```text
Scene 03
00:08.2 ───────── 00:12.6
```

再说：

> 这里太乱。

Agent 自动获得：

```text
selectedScene
selectedObjects
selectedRange
currentFrame
nearbyTranscript
visualSnapshot
audioContext
styleContext
projectIntent
```

所以 Agent 真正知道：

> “这里”是谁。

---

# 13. Direct Manipulation + Agent

用户不应该只能 Prompt。

用户仍然可以：

- 拖 Scene；
- 调 duration；
- 拖 Clip；
- trim；
- reorder；
- 修改文本；
- 删除对象；
- 调参数。

而 AI 必须继续理解用户的这些修改。

正确关系：

```text
               Project State
              ↑             ↑
              │             │
          Human UI        Agent
              │             │
              └──────┬──────┘
                     ↓
                   Render
```

**Human 和 AI 共同操作同一份项目。**

---

# 14. Composition Graph

项目的真正核心数据结构，不应该只是 Timeline。

建议：

```json
{
  "project": "launch-video",
  "scenes": [
    {
      "id": "hero",
      "type": "generated",
      "source": "scenes/hero.html",
      "duration": 4.2,
      "objects": [
        "background",
        "headline",
        "particles",
        "logo"
      ]
    },
    {
      "id": "demo",
      "type": "hybrid",
      "source": "scenes/demo.html",
      "assets": [
        "product-demo.mp4"
      ],
      "objects": [
        "demo-video",
        "spotlight",
        "cursor",
        "callout"
      ]
    }
  ]
}
```

整个工程可以理解为：

```text
Composition Graph
│
├── Scenes
│
├── Objects
│
├── Assets
│
├── Timeline
│
├── Audio
│
└── Style System
```

---

# 15. Operation Journal

AI 编辑必须支持可追踪。

每次 AI 操作记录为原子 Operation：

```json
{
  "actor": "agent",
  "scene": "scene-02",
  "operation": "update-animation",
  "object": "headline",
  "reason": "reduce visual noise",
  "baseVersion": 31
}
```

或者：

```json
{
  "actor": "agent",
  "operation": "trim",
  "clip": "interview-01",
  "from": 13.2,
  "to": 14.8,
  "reason": "remove verbal filler",
  "baseVersion": 44
}
```

获得：

- Undo；
- Redo；
- AI edit history；
- attribution；
- version control；
- conflict protection；
- Agent rebase。

---

# 16. Agent Tools

第一版 Tool 数量不宜过多。

推荐：

## Project

```text
video_project
```

支持：

- create；
- open；
- inspect；
- status。

---

## Assets

```text
video_media
```

支持：

- import；
- probe；
- metadata；
- register。

---

## Scene

```text
video_scene
```

支持：

- create；
- inspect；
- update；
- duplicate；
- remove。

---

## Timeline

```text
video_timeline
```

支持：

- inspect；
- apply operations。

---

## Speech

```text
video_transcribe
```

负责：

- Whisper；
- word timestamps；
- sentence segmentation。

---

## Preview

```text
video_preview
```

支持：

- frame；
- range；
- contact sheet；
- draft。

---

## Render

```text
video_render
```

支持：

- draft；
- final；
- cancel。

---

## QA

```text
video_qa
```

检查：

- visual；
- subtitle；
- audio；
- codec；
- resolution；
- blank frames；
- overflow。

---

# 17. Skills 才是创作能力核心

Tools 只是“手”。

Skills 才是：

> Agent 知道怎么做视频。

建议结构：

```text
skills/
│
├── video-director/
├── storyboard/
├── motion-design/
├── product-launch/
├── kinetic-typography/
├── talking-head/
├── captions/
├── data-story/
├── music-video/
├── rough-cut/
├── visual-review/
└── render/
```

---

# 18. Video Director Skill

这是最高层 Skill。

负责：

```text
Brief
↓
目标受众
↓
核心信息
↓
Narrative
↓
Visual Treatment
↓
Storyboard
↓
Scene Plan
↓
Motion Language
↓
Audio Plan
↓
Production Plan
```

不要一收到需求就开始写代码。

---

# 19. Motion Design Skill

重点参考 Opus 5.5 社区工作流。

流程：

```text
Creative Brief
↓
Visual Treatment
↓
Storyboard
↓
Typography System
↓
Motion System
↓
Scene Code
↓
Key Still Review
↓
Draft
↓
Visual Critique
↓
Final
```

支持：

- HTML；
- CSS；
- SVG；
- Canvas；
- GSAP；
- p5.js；
- Three.js；
- WebGL。

---

# 20. Product Launch Skill

输入可以非常简单：

```text
产品 URL
Logo
截图
一句描述
```

Agent 自动：

```text
理解产品
↓
提炼卖点
↓
Narrative
↓
Storyboard
↓
Scene Generation
↓
Screenshot Animation
↓
Typography
↓
Audio
↓
CTA
```

这是 DSH Video 第一阶段最适合传播的能力。

---

# 21. Style Skill

Style 不应该每次都依赖 Prompt。

建议：

```text
styles/
├── apple-launch/
├── linear/
├── editorial/
├── kinetic-type/
├── brutalist/
├── sketchbook/
├── terminal/
└── hand-drawn/
```

每个 Style 定义：

- typography；
- spacing；
- colors；
- motion curves；
- camera；
- rhythm；
- transition；
- texture；
- forbidden patterns。

例如：

```text
STYLE.md
```

Agent 需要某种视觉语言时加载。

---

# 22. Audio 是一等公民

程序化视频最容易出现的问题：

> 很像网页 Demo，不像真正的视频。

真正的视频需要：

```text
Visual Rhythm
+
Audio Rhythm
```

因此项目上下文应该同时包含：

```text
timeline
beats
audioPeaks
transcript
wordTimestamps
shots
semanticSegments
```

支持：

- Beat Map；
- BGM；
- SFX；
- voice；
- loudness；
- scene sync。

---

# 23. 推荐技术栈

## Programmatic Visual

```text
HTML
CSS
SVG
Canvas
GSAP
p5.js
Three.js
WebGL
```

---

## Render

```text
Chromium
Playwright
FFmpeg
ffprobe
```

---

## Media

```text
FFmpeg
```

负责：

- trim；
- concat；
- crop；
- audio；
- mux；
- transcode；
- proxy；
- export。

---

## Speech

```text
Whisper
```

后续：

```text
WhisperX
```

---

## Audio Intelligence

后续可加入：

```text
Beat Detection
Demucs
Audio Analysis
```

---

## Optional Engines

```text
Remotion
Manim
Blender
```

---

# 24. Workspace 设计

UI 不应该照搬 Premiere。

建议：

```text
┌────────────────────────────────────────────────────────┐
│ Scenes / Assets │            Preview          │ Agent │
│                 │                             │       │
│ Scene 01        │                             │       │
│ Scene 02        │                             │       │
│ Scene 03        │                             │       │
│                 │                             │       │
├────────────────────────────────────────────────────────┤
│ Scene Objects                                          │
│ [Background] [Headline] [Particles] [Screenshot]      │
├────────────────────────────────────────────────────────┤
│ Timeline                                               │
│ S1 ━━━━━━━  S2 ━━━━━━━━  S3 ━━━━━                    │
│ Video                ━━━━━━━━━━━━━                     │
│ Audio ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   │
│ Caption      ███      █████       ███                 │
└────────────────────────────────────────────────────────┘
```

核心是三层：

```text
Scene
↓
Objects
↓
Timeline
```

---

# 25. 最重要的交互

### 场景 1

用户点击：

```text
Headline
```

说：

> 太普通了。

Agent 修改 Headline 的 motion code。

---

### 场景 2

用户暂停某一帧：

> 这里截图太小了。

Agent 获取 current frame + selected object。

---

### 场景 3

用户选择 Scene 02：

> 这一幕重做，空间感更强一点。

Agent 可以完整重构 Scene 02，而不影响 Scene 01 / 03。

---

### 场景 4

用户：

> 前面太慢，把前五秒压紧一点。

Agent 调整 Scene timing / Timeline。

---

# 26. MVP 应该证明什么

第一版不应该首先证明：

> “AI 能剪采访。”

而应该证明：

> **Agent 可以在 DSH 内从零写出一支视频。**

---

# 27. MVP Killer Demo

用户输入：

```text
Logo
3 张产品截图
一句产品介绍
```

Prompt：

> 做一个 15 秒产品发布片。
> 黑色背景，空间感强，科技感，但不要模板味。
```

DSH Video 自动：

```text
理解 Brief
↓
生成 Treatment
↓
Storyboard
↓
Style
↓
Scene 01 HTML/SVG
↓
Scene 02 Canvas/GSAP
↓
Scene 03 Screenshot + WebGL
↓
Scene 04 CTA
↓
Audio
↓
Timeline
↓
Keyframes
↓
Draft Render
↓
Visual Review
↓
修改
↓
Final MP4
```

用户：

> 第二幕太花了。

Agent：

```text
进入 Scene 02
↓
降低粒子
↓
减少 Camera Motion
↓
保留 Typography
↓
重新 Preview
```

如果这一条链路跑通，DSH Video 就成立。

---

# 28. 第二个 Demo：Hybrid Video

输入：

```text
一段真人产品讲解
+
Logo
+
产品截图
```

用户：

> 剪成 30 秒。
> 开头做一个两秒的程序化标题，
> 中间产品重点用动态图形标出来，
> 最后做一个 CTA。
```

最终：

```text
Generated Intro
↓
Real Footage
↓
Generated Typography
↓
Product Demo
↓
Generated Callout
↓
Real Footage
↓
Generated Outro
```

这个 Demo 用于证明：

> **生成视频与编辑视频属于同一个工程。**

---

# 29. 第三个 Demo：纯程序化视频

Prompt：

> 解释 RAG 的工作原理，做成 30 秒横屏解释视频。

Agent：

```text
Storyboard
↓
Vector Diagram
↓
Animated Documents
↓
Embedding Space
↓
Retrieval
↓
LLM
↓
Answer
```

所有画面由：

- SVG；
- Canvas；
- typography；
- animation；

直接生成。

不需要用户提供任何视频素材。

---

# 30. MVP 功能范围

## 必须有

- DSH Plugin；
- Video Workspace；
- Project；
- Scene；
- Composition；
- Preview；
- Timeline；
- AI Scene Generation；
- Assets；
- Basic Manual Editing；
- Whisper；
- Subtitle；
- Audio；
- Draft Render；
- Final Render；
- Contact Sheet；
- Vision Review；
- Operation Journal；
- Undo / Redo。

---

## 第一版不要做

```text
Advanced Mask
Professional Color Grading
Curves
Multicam
Complex Keyframe UI
AE-class Compositing
Advanced Audio Mixing
Plugin Marketplace
Cloud Render Farm
```

---

# 31. 插件结构

建议仓库：

```text
dsh-video/
│
├── package.json
├── cordis.patch.yml
│
├── src/
│   │
│   ├── core/
│   │   ├── project-service.ts
│   │   ├── scene-service.ts
│   │   ├── composition-service.ts
│   │   ├── timeline-service.ts
│   │   ├── operation-journal.ts
│   │   └── render-service.ts
│   │
│   ├── tools/
│   │   ├── project.ts
│   │   ├── scene.ts
│   │   ├── media.ts
│   │   ├── timeline.ts
│   │   ├── transcribe.ts
│   │   ├── preview.ts
│   │   ├── render.ts
│   │   └── qa.ts
│   │
│   ├── skills/
│   │   ├── video-director/
│   │   ├── storyboard/
│   │   ├── motion-design/
│   │   ├── product-launch/
│   │   ├── kinetic-typography/
│   │   ├── talking-head/
│   │   ├── visual-review/
│   │   └── render/
│   │
│   ├── runtime/
│   │   ├── browser/
│   │   ├── hyperframes/
│   │   ├── ffmpeg/
│   │   └── remotion/
│   │
│   ├── remote/
│   │   └── video-api.ts
│   │
│   └── client/
│       └── dsh-video-client/
│
├── styles/
│   ├── apple-launch/
│   ├── linear/
│   ├── editorial/
│   └── kinetic-type/
│
├── templates/
│
└── evals/
```

---

# 32. Desktop First

第一阶段建议：

> **DSH Desktop First**

原因：

- 视频文件巨大；
- 本地文件系统；
- FFmpeg；
- Chromium；
- Whisper；
- GPU；
- cache；
- frames；
- render；
- 几 GB 素材。

第一版没有必要同时解决：

- cloud storage；
- upload；
- remote render；
- streaming；
- cloud proxy。

后续再支持 Web。

---

# 33. 模型架构

DSH 的 Router 是天然优势。

推荐角色：

```text
Director Model
├── 理解需求
├── Storyboard
├── Visual Direction
└── Review

Worker Model
├── 写 HTML
├── CSS
├── GSAP
├── Timeline
└── Tools

Vision Model
├── 看 Keyframes
├── 看 Contact Sheet
├── Typography QA
├── Composition QA
└── Visual Critique

Audio Pipeline
├── Whisper
├── Beat
└── Loudness
```

最终目标不是：

> “支持 Opus 5.5。”

而是：

> **把 Opus 5.5 已经证明有效的视频创作 Workflow 固化成模型无关的 DSH Skills。**

换模型，Workflow 仍然存在。

---

# 34. 安全设计

Agent 最终会生成 HTML / JS 并运行，因此默认：

> Project Code = Untrusted Code

必须：

1. Project Root confinement；
2. 不允许静默访问工程外路径；
3. 不允许自动 `npm install`；
4. 禁止未知 postinstall；
5. 第三方依赖安装需批准；
6. FFmpeg 参数结构化；
7. Render timeout；
8. Render cancel；
9. Runtime version pin；
10. 外部 URL 进入 Project 前确认；
11. Agent Edit Journal；
12. 可恢复 Snapshot。

---

# 35. 产品护城河在哪里

不是：

- FFmpeg；
- Timeline；
- HTML renderer；
- Remotion；
- Three.js。

这些都是现成技术。

真正的产品价值在：

## 35.1 Video Agent Harness

```text
Brief
→ Director
→ Storyboard
→ Scene Generation
→ Preview
→ Review
→ Refine
→ Render
```

---

## 35.2 Creative Skills

把优秀创作者的方法沉淀为：

```text
Skill
Style
Workflow
Evaluation
```

---

## 35.3 Human + Agent Shared State

用户与 AI 编辑同一个工程，而不是：

```text
AI 生成视频
↓
用户下载
↓
换软件修改
```

---

## 35.4 Scene-Level Context

AI 明确知道：

- 用户当前选了哪个 Scene；
- 哪个对象；
- 哪段时间；
- 哪一帧；
- 哪句话；
- 哪个视觉问题。

---

# 36. 项目的真正命题

如果它只是：

> DSH 现在也能生成视频。

那只是一个 Feature。

如果只是：

> DSH 能调 FFmpeg。

那只是 Tool Collection。

如果只是：

> 把 HyperFrames 或 Remotion 嵌入 DSH。

那只是 Integration。

真正值得做的命题是：

> **Agent Harness 是否可以通过插件变成一种专业创作软件？**

DSH Video 应该证明：

> **可以。**

它重新定义的软件交互不是：

```text
Button
→ Command
```

而是：

```text
Human Intent
+
Direct Manipulation
+
Agent Reasoning
+
Programmatic Creation
+
Editable Project State
```

---

# 37. 最终技术决策

如果今天开始开发，建议先冻结以下路线：

```text
Product
DSH Video

Host
DeepSeek Harness

Product Category
AI-Native Programmatic Video Studio

Primary Interaction
Agent + Direct Manipulation

Core Concept
Code as Video

Project Model
Composition Graph + Timeline

Programmatic Visual
HTML / CSS / SVG
Canvas
GSAP
Three.js
WebGL

Primary Runtime
HyperFrames-compatible HTML Runtime

Traditional Media
FFmpeg / ffprobe

Render
Chromium / Playwright + FFmpeg

Speech
Whisper

Creative Intelligence
DSH Skills

Optional Runtime
Remotion

Future Runtime
Manim / Blender

Initial Platform
DSH Desktop
```

---

# 38. 第一阶段唯一目标

第一阶段不要追求功能完整度。

只需要跑通这一件事：

> 用户安装 DSH Video，给 Agent 一个 Brief 和几张素材，Agent 能在 DSH 内部从零用代码构建多个 Scene，生成一支完整视频；用户可以点进其中一个 Scene，通过自然语言或直接操作修改它，再让 Agent 继续编辑，最终导出 MP4。

一旦这一条链路跑通：

**DSH Video 就成立了。**

随后再逐步加入：

- 真实素材；
- AI rough cut；
- talking head；
- music video；
- data story；
- education video；
- product demo；
- advanced motion；
- 3D；
- multi-agent production。

最终形成：

> **一个运行在 DSH 中、让 Agent 直接“写视频”的开放式 AI 创作环境。**
