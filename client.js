/**
 * dsh-video — Client half.
 *
 * Hand-written DSH client bundle (no bundler, no JSX, no npm dependencies).
 * It contributes exactly two things:
 *
 *   1. one native sidebar navigation entry ("Vedio Editor") in the host's
 *      `sidebar.panellist` list, immediately after the shipped panel rows and
 *      before the Workspace/Session browsing region;
 *   2. one global main panel under the `dsh-video` key, registered in the host
 *      `main` keyed slot and selected only through `ctx.layout.selectPanel`.
 *
 * Boundaries (P0-005):
 *   - the selected state is read by the host from its own layout store; the
 *     plugin keeps no second mode boolean and never registers a second nav row;
 *   - no overlay, no host-header replacement, no DOM geometry reads, no sidebar
 *     replacement, no Remote, no session events, no local project content store;
 *     project/revision/job authority stays in the Host worker, while this Client
 *     keeps only bounded view memory across a panel switch;
 *   - the main panel and the sidebar entry are one atomic pair: the panel is
 *     registered first, the entry only after it; any failure, conflict or loss
 *     releases both, and a later declaration retries. The panel can never stay
 *     registered without a reachable navigation entry;
 *   - every registration is owned by the caller fiber through `ctx.slots.inject`
 *     / `ctx.effect`, so disabling the plugin removes it and the host's
 *     `retainMainPanels` mechanism can return the UI to the conversation.
 *
 * Browser persistence is limited to the resizable AI-pane width preference,
 * versioned and corruption-safe. Project content is not stored here.
 */
window.__ModuleLoader__.load({
  id: 'dsh-video',
  factory(require) {
    'use strict';

    //#region constants
    const React = require('react');
    const h = React.createElement;

    /** Main-panel key, sidebar list id, Loader row id and Client module id. */
    const PANEL_ID = 'dsh-video';
    /** Locale namespace registered for this plugin's UI text. */
    const NS = 'dshVideo';
    /** Versioned browser preference key for the resizable right pane (P3-016). */
    const LAYOUT_PREFS_KEY = 'dsh-video.layout.v1';
    const LAYOUT_PREFS_VERSION = 1;
    /**
     * Sidebar row position. The shipped panel rows use orders 0 (plugins),
     * 10 (schedules) and 20 (context). The workspace/session region is a
     * different sidebar slot rendered after the whole panel list, so any order
     * greater than 20 lands after the last shipped row and before the Workspace
     * group. 30 leaves room for future shipped rows without reordering them.
     */
    const SIDEBAR_ORDER = 30;
    //#endregion

    //#region layout splitter helpers
    /**
     * P3-016: the right AI pane is a resizable split view. The ratio is the AI
     * pane's share of the workspace width; CSS clamps it to a readable minimum,
     * a 720px maximum and a protected left stage. These helpers are pure so the
     * smoke test can execute the shipped bytes (same pattern as the canvas
     * helpers): persistence/corruption handling never depends on the DOM.
     */
    const AI_PANE_DEFAULT_RATIO = 0.42;
    const AI_PANE_RATIO_MIN = 0.2;
    const AI_PANE_RATIO_MAX = 0.7;
    const AI_PANE_KEYBOARD_STEP = 0.02;
    const AI_PANE_MIN_WIDTH = 320;
    const AI_PANE_MAX_WIDTH = 720;
    const LEFT_PANE_MIN_WIDTH = 360;

    function clampNumber(value, min, max) {
      if (value < min) return min;
      if (value > max) return max;
      return value;
    }

    /** Finite ratio clamped to the resize bounds and rounded to 0.01%. */
    function normalizeAiPaneRatio(value) {
      const number = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(number) === false) return AI_PANE_DEFAULT_RATIO;
      return Math.round(clampNumber(number, AI_PANE_RATIO_MIN, AI_PANE_RATIO_MAX) * 10000) / 10000;
    }

    /**
     * CSS width for `.dv-ai`: ratio-driven, but never below the readable AI
     * minimum, above 720px, or wider than the container minus the left minimum.
     * The narrow (stacked) container query overrides the width back to auto.
     */
    function aiPaneWidthCss(ratio) {
      const percent = String(Math.round(normalizeAiPaneRatio(ratio) * 10000) / 100);
      return (
        'clamp(' + AI_PANE_MIN_WIDTH + 'px, ' + percent + '%, min(' + AI_PANE_MAX_WIDTH +
        'px, calc(100% - ' + LEFT_PANE_MIN_WIDTH + 'px)))'
      );
    }

    /** Keyboard stepping: positive moves the divider left (wider AI pane). */
    function stepAiPaneRatio(ratio, delta) {
      return normalizeAiPaneRatio(normalizeAiPaneRatio(ratio) + Number(delta));
    }

    /** Pixel width from one drag position, clamped for the measured container. */
    function clampAiPaneWidth(width, containerWidth) {
      const container = Number(containerWidth);
      const upper = Number.isFinite(container) && container > 0
        ? Math.min(AI_PANE_MAX_WIDTH, container - LEFT_PANE_MIN_WIDTH)
        : AI_PANE_MAX_WIDTH;
      const lower = Math.min(AI_PANE_MIN_WIDTH, upper);
      const candidate = Number(width);
      if (Number.isFinite(candidate) === false) return lower;
      return clampNumber(candidate, lower, upper);
    }
    //#endregion

    //#region locale dictionaries
    const ZH = {

      'video.audio.title': "生成音频",
      'video.audio.tts': "旁白",
      'video.audio.music': "配乐",
      'video.audio.sfx': "音效",
      'video.audio.provider': "供应商",
      'video.audio.qianwen': "千问云",
      'video.audio.local': "本地旁白 · 免费",
      'video.audio.text': "描述声音或输入旁白文案…",
      'video.audio.generate': "生成并加入素材",
      'video.audio.cancel': "取消生成",
      'video.audio.add': "加入音轨",
      'video.audio.settings': "供应商设置",
      'video.audio.key': "API Key（仅保存在本机）",
      'video.audio.save': "保存密钥",
      'video.audio.check': "测试连接",
      'video.audio.configured': "密钥已配置",
      'video.audio.missing': "尚未配置密钥",
      'video.audio.billing': "云端按实际用量计费 · 每日最多 20 次 · 取消可能仍计费",
      'video.audio.invitation': "音乐需供应商开通邀测；不可用时请导入配乐。",
      'video.audio.volume': "音量",
      'video.audio.fadeIn': "淡入",
      'video.audio.fadeOut': "淡出",
      'video.audio.gain': "轨道增益",
      'video.audio.mute': "静音轨道",
      'video.audio.addTrack': "添加音轨",
      'video.audio.more': "更多编辑",
      'video.audio.voice': "音色",
      'video.audio.ready': "已加入素材库",
      'video.audio.queued': "等待中",
      'video.audio.running': "正在生成",
      'video.audio.downloading': "正在保存",
      'video.audio.succeeded': "生成成功",
      'video.audio.failed': "生成失败",
      'video.audio.cancelled': "已取消",
      'video.audio.interrupted': "上次任务已中断",
      'video.audio.timed_out': '生成超时',
      'video.audio.cancelling': "正在取消",
      'video.timeline.title': "时间线",
'video.timeline.loading': "正在读取时间线…",
'video.timeline.updated': "修改已保存",
'video.timeline.saved': "已保存",
'video.timeline.needTrack': "请先添加视频轨",
'video.timeline.cutHint': "将播放头移到选中片段内再切分",
'video.timeline.split': "切分",
'video.timeline.delete': "删除",
'video.timeline.duplicate': "复制",
'video.timeline.addTrack': "加轨",
'video.timeline.snap': "吸附",
'video.timeline.zoom': "缩放时间线",
'video.timeline.compact': "片条",
'video.timeline.trimIn': "调节入点",
'video.timeline.trimOut': "调节出点",
'video.timeline.track': "轨道",
'video.timeline.speed': "速度",
'video.timeline.saving': "正在保存…",
'video.timeline.hint': "选择片段 · S 切分 · 拖边精调 · Delete 删除",
'video.timeline.add': "加入时间线",

      'nav.label': 'Vedio Editor',
      'video.back': '返回对话',
      'video.empty': '尚无工程',
      'video.open': '打开示例',
      'video.opening': '正在打开…',
      'video.title': '标题',
      'video.timing': '时间',
      'video.timing.range': '开始时间与时长超出工程时长（最长 {duration} 秒）。',
      'video.start': '开始（秒）',
      'video.duration': '时长（秒）',
      'video.update': '更新画面',
      'video.updating': '正在生成画面…',
      'video.save': '保存修改',
      'video.saving': '正在保存…',
      'video.export': '导出 MP4',
      'video.exporting': '正在导出…',
      'video.export.stage.queued': '等待引擎',
      'video.export.stage.snapshot': '准备快照',
      'video.export.stage.engine': '渲染中',
      'video.export.stage.capture': '捕获帧',
      'video.export.stage.validate': '校验中',
      'video.export.stage.finished': '收尾中',
      'video.export.elapsed': '已用 {seconds}s',
      'video.export.cancelled': '导出已取消。',
      'video.cancel': '取消',
      'video.cancelling': '正在取消…',
      'video.download': '下载 MP4',
      'video.refresh': '重新读取',
      'video.refreshing': '正在读取…',
      'video.frame.empty': '画面尚未生成',
      'video.frame.failed': '画面加载失败，请重新更新。',
      'video.frameTime': '画面时间（秒）',
      'video.frameTime.invalid': '画面时间需在工程时长范围内。',
      'video.noText': '此工程没有可编辑元素。',
      'video.details': '属性',
      'video.target': '目标',
      'video.capabilities': '能力',
      'video.edit.empty': '没有需要保存的修改。',
      'video.edit.invalidTiming': '请输入有效的开始时间和时长。',
      'video.error.frameFailed': '画面生成失败，请重试。',
      'video.error.renderFailed': '导出失败，请重试。',
      'video.error.timedOut': '操作超时，请重试。',
      'video.error.back': '返回对话失败，请重试。',
      'video.error.configuration': '视频服务尚未配置，请检查 Host 配置。',
      'video.error.network': '无法连接到视频服务。',
      'video.error.worker': '视频引擎暂时不可用。',
      'video.error.conflict': '工程已更新，请重新读取后再修改。',
      'video.error.generic': '操作失败。',
      'video.state.queued': '等待中',
      'video.state.running': '处理中',
      'video.state.cancelling': '正在取消',
      'video.state.succeeded': '已完成',
      'video.state.failed': '失败',
      'video.state.cancelled': '已取消',
      'video.state.timed_out': '超时',
      'video.ai.title': 'AI 创作',
      'video.ai.empty': '还没有创作会话',
      'video.ai.create': '开始创作',
      'video.ai.creating': '正在创建…',
      'video.ai.new': '新会话',
      'video.ai.history': '创作历史',
      'video.ai.loading': '正在打开创作会话…',
      'video.ai.unavailable': '宿主未提供原生会话入口。',
      'video.ai.disabled': '创作会话未配置（Host 缺少 sessionStatePath/sessionCwd）；画面与导出仍可用。',
      'video.ai.error': '创作会话打开失败。',
      'video.ai.retry': '重试',
      'video.ai.hostOpen': '该会话已在宿主对话中打开，请先在宿主中关闭它。',
      'video.ai.archived': '已归档',
      'video.ai.missing': '不可用',
      'video.ai.listEmpty': '当前工程还没有创作会话。',
      'video.project.label': '工程',
      'video.project.new': '新建工程',
      'video.project.untitled': '未命名作品',
      'video.project.open': '打开工程',
      'video.project.rename': '重命名工程',
      'video.project.renameHint': '点击重命名（回车保存，Esc 取消）',
      'video.project.renameEmpty': '工程名称不能为空。',
      'video.project.renameFailed': '重命名失败，请重试。',
      'video.project.reveal': '在 Finder 中显示',
      'video.project.revealGeneric': '在文件管理器中显示',
      'video.project.copyPath': '复制路径',
      'video.project.copyPathDone': '路径已复制',
      'video.project.copyPathFailed': '复制路径失败，请手动复制：',
      'video.project.revealFailed': '无法打开工程文件夹，请重试。',
      'video.save.saving': '保存中…',
      'video.save.saved': '已保存',
      'video.save.failed': '保存失败 · 重试',
      'video.save.retryHint': '面板状态保存失败，点击重试',
      'video.layout.resize': '调整面板宽度',
      'video.canvas.play': '播放',
      'video.canvas.pause': '暂停',
      'video.canvas.timeline': '时间轴',
      'video.canvas.undo': '撤销',
      'video.canvas.redo': '重做',
      'video.canvas.materials': '素材',
      'video.media.compatibility': '生成兼容预览',
      'video.media.import': '导入素材 · 或拖入文件',
      'video.media.search': '搜索素材',
      'video.media.filter': '素材类型',
      'video.media.all': '全部',
      'video.media.video': '视频',
      'video.media.image': '图片',
      'video.media.audio': '音频',
      'video.media.cancel': '取消',
      'video.media.processing': '处理中…',
      'video.media.failed': '导入失败，请重试',
      'video.media.cancelled': '已取消导入',
      'video.media.retry': '重试',
      'video.media.loading': '正在读取素材…',
      'video.media.empty': '拖入视频、图片或音频',
      'video.media.more': '加载更多',
      'video.media.waveform': '波形',
      'video.media.thumbnail': '缩略图',
      'video.media.rebuild': '重新生成预览图',
      'video.media.reference': '引用标记（选择复制）',
      'video.media.remove': '删除素材',
      'video.media.confirmRemove': '确认删除素材',
      'video.canvas.addScene': '添加场景',
      'video.canvas.export': '导出 MP4',
      'video.canvas.exporting': '正在导出…',
      'video.canvas.download': '下载 MP4',
      'video.canvas.loading': '正在准备预览',
      'video.canvas.retry': '重试',
      'video.canvas.updatingPreview': '正在更新预览',
      'video.canvas.loadTimeout': '预览准备超时，请重试。',
      'video.canvas.frameTitle': '视频预览',
      'video.canvas.runtimeError': '画布运行时错误。',
      'video.canvas.invalidStyle': '请输入有效样式。',
      'video.canvas.uploadFailed': '上传失败。',
      'video.canvas.exportFailed': '导出失败。',
      'video.canvas.sceneColor': '场景底色',
      'video.canvas.textStyle': '文字样式',
      'video.canvas.apply': '应用',
      'video.canvas.hint': '点击画布选择对象；双击文字原位修改。',
      'video.canvas.busy': '处理中…',
      'video.canvas.close': '关闭',
      'video.canvas.upload': '上传 PNG/JPEG',
      'video.canvas.uploading': '正在上传…',
      'video.canvas.noAssets': '还没有图片素材。',
      'video.canvas.useAsset': '用作画面',
      'video.canvas.newSceneTitle': '新场景',
      'video.canvas.templateUnavailable': '当前场景缺少完整的可写数据，已取消本次写入以免丢失其它内容。',
      'video.canvas.invalidColor': '场景底色无效。',
      'video.canvas.invalidAsset': '图片素材地址无效。',
      'video.canvas.layoutRefused': '该对象缺少可用的静态位置，已取消本次写入。',
      'video.canvas.layoutScaleUnknown': '无法确定该对象当前的缩放比例，已取消本次写入。',
      'video.canvas.persistFailed': '保存失败，请重试。',
      'video.canvas.retryText': '重试保存',
      'video.canvas.revisionRefreshed': '工程已更新，请再次提交保存。',
      'video.preview.booting': '正在准备工程…',
      'video.preview.empty': '描述你的想法，画面将在这里出现。',
      'video.preview.retry': '重试',
      'video.error.session': '创作会话暂不可用。',
      'video.error.sessionConfig': '创作会话尚未配置。',
      'video.error.sessionState': '创作会话记录无法读取，请检查 Host 存储。',
      'video.preview.title': '文件预览',
      'video.preview.loading': '正在打开预览…',
      'video.preview.close': '关闭预览',
      'video.preview.unsupported': '此文件类型暂不支持内嵌预览。',
      'video.preview.tooLarge': '文件过大，无法内嵌预览。',
      'video.preview.denied': '无法预览该文件：不在本会话允许的范围内。',
      'video.preview.notFound': '文件不存在或已被移动。',
      'video.preview.failed': '预览失败，请重试。',
    };

    const EN = {

      'video.audio.title': "Generate audio",
      'video.audio.tts': "Voiceover",
      'video.audio.music': "Music",
      'video.audio.sfx': "Sound effect",
      'video.audio.provider': "Provider",
      'video.audio.qianwen': "Qianwen",
      'video.audio.local': "Local voice · free",
      'video.audio.text': "Describe a sound or enter narration…",
      'video.audio.generate': "Generate to library",
      'video.audio.cancel': "Cancel generation",
      'video.audio.add': "Add to audio track",
      'video.audio.settings': "Provider settings",
      'video.audio.key': "API Key (stored only on this device)",
      'video.audio.save': "Save key",
      'video.audio.check': "Test connection",
      'video.audio.configured': "Key configured",
      'video.audio.missing': "API key not configured",
      'video.audio.billing': "Cloud usage is billed · 20 calls/day · cancellation may still be billed",
      'video.audio.invitation': "Music requires invitation access. Import music if unavailable.",
      'video.audio.volume': "Volume",
      'video.audio.fadeIn': "Fade in",
      'video.audio.fadeOut': "Fade out",
      'video.audio.gain': "Track gain",
      'video.audio.mute': "Mute track",
      'video.audio.addTrack': "Add audio track",
      'video.audio.more': "More edits",
      'video.audio.voice': "Voice",
      'video.audio.ready': "Saved to library",
      'video.audio.queued': "Queued",
      'video.audio.running': "Generating",
      'video.audio.downloading': "Saving",
      'video.audio.succeeded': "Generated",
      'video.audio.failed': "Failed",
      'video.audio.cancelled': "Cancelled",
      'video.audio.interrupted': "Interrupted",
      'video.audio.timed_out': 'Timed out',
      'video.audio.cancelling': "Cancelling",
      'video.timeline.title': "Timeline",
'video.timeline.loading': "Loading timeline…",
'video.timeline.updated': "Changes saved",
'video.timeline.saved': "Saved",
'video.timeline.needTrack': "Add a video track first",
'video.timeline.cutHint': "Move the playhead inside the selected clip",
'video.timeline.split': "Split",
'video.timeline.delete': "Delete",
'video.timeline.duplicate': "Duplicate",
'video.timeline.addTrack': "Add track",
'video.timeline.snap': "Snap",
'video.timeline.zoom': "Timeline zoom",
'video.timeline.compact': "Compact",
'video.timeline.trimIn': "Trim in",
'video.timeline.trimOut': "Trim out",
'video.timeline.track': "Track",
'video.timeline.speed': "Speed",
'video.timeline.saving': "Saving…",
'video.timeline.hint': "Select a clip · S to split · drag edges to trim · Delete",
'video.timeline.add': "Add to timeline",

      'nav.label': 'Vedio Editor',
      'video.back': 'Back to conversation',
      'video.empty': 'No project yet',
      'video.open': 'Open example',
      'video.opening': 'Opening…',
      'video.title': 'Title',
      'video.timing': 'Timing',
      'video.timing.range': 'Start time plus duration exceeds the project length (maximum {duration}s).',
      'video.start': 'Start (s)',
      'video.duration': 'Duration (s)',
      'video.update': 'Update frame',
      'video.updating': 'Rendering frame…',
      'video.save': 'Save changes',
      'video.saving': 'Saving…',
      'video.export': 'Export MP4',
      'video.exporting': 'Exporting…',
      'video.export.stage.queued': 'Waiting for the engine',
      'video.export.stage.snapshot': 'Preparing snapshot',
      'video.export.stage.engine': 'Rendering',
      'video.export.stage.capture': 'Capturing frames',
      'video.export.stage.validate': 'Validating',
      'video.export.stage.finished': 'Finishing',
      'video.export.elapsed': '{seconds}s elapsed',
      'video.export.cancelled': 'The export was cancelled.',
      'video.cancel': 'Cancel',
      'video.cancelling': 'Cancelling…',
      'video.download': 'Download MP4',
      'video.refresh': 'Reload project',
      'video.refreshing': 'Reloading…',
      'video.frame.empty': 'No frame yet',
      'video.frame.failed': 'The frame could not be loaded. Update it again.',
      'video.frameTime': 'Frame time (s)',
      'video.frameTime.invalid': 'Frame time must be within the project duration.',
      'video.noText': 'This project has no editable elements.',
      'video.details': 'Properties',
      'video.target': 'Target',
      'video.capabilities': 'Capabilities',
      'video.edit.empty': 'There is nothing to save.',
      'video.edit.invalidTiming': 'Enter a valid start time and duration.',
      'video.error.frameFailed': 'The frame could not be generated. Try again.',
      'video.error.renderFailed': 'The export failed. Try again.',
      'video.error.timedOut': 'The operation timed out. Try again.',
      'video.error.back': 'Could not return to the conversation. Try again.',
      'video.error.configuration': 'The video service is not configured. Check the Host configuration.',
      'video.error.network': 'Could not reach the video service.',
      'video.error.worker': 'The video engine is temporarily unavailable.',
      'video.error.conflict': 'The project changed. Reload it before editing again.',
      'video.error.generic': 'The operation failed.',
      'video.state.queued': 'Queued',
      'video.state.running': 'Running',
      'video.state.cancelling': 'Cancelling',
      'video.state.succeeded': 'Done',
      'video.state.failed': 'Failed',
      'video.state.cancelled': 'Cancelled',
      'video.state.timed_out': 'Timed out',
      'video.ai.title': 'AI creation',
      'video.ai.empty': 'No creation conversation yet',
      'video.ai.create': 'Start creating',
      'video.ai.creating': 'Starting…',
      'video.ai.new': 'New conversation',
      'video.ai.history': 'Conversation history',
      'video.ai.loading': 'Opening the creation conversation…',
      'video.ai.unavailable': 'This host does not expose the native conversation entry.',
      'video.ai.disabled': 'Creation conversations are not configured (the Host has no sessionStatePath/sessionCwd). Preview and export still work.',
      'video.ai.error': 'The creation conversation could not be opened.',
      'video.ai.retry': 'Retry',
      'video.ai.hostOpen': 'This Session is open in the host conversation. Close it there first.',
      'video.ai.archived': 'Archived',
      'video.ai.missing': 'Unavailable',
      'video.ai.listEmpty': 'This project has no creation conversation yet.',
      'video.project.label': 'Project',
      'video.project.new': 'New project',
      'video.project.untitled': 'Untitled film',
      'video.project.open': 'Open project',
      'video.project.rename': 'Rename project',
      'video.project.renameHint': 'Click to rename (Enter saves, Esc cancels)',
      'video.project.renameEmpty': 'A project name is required.',
      'video.project.renameFailed': 'Could not rename the project; try again.',
      'video.project.reveal': 'Show in Finder',
      'video.project.revealGeneric': 'Show in file manager',
      'video.project.copyPath': 'Copy path',
      'video.project.copyPathDone': 'Path copied',
      'video.project.copyPathFailed': 'Could not copy the path; copy it manually:',
      'video.project.revealFailed': 'Could not open the project folder; try again.',
      'video.save.saving': 'Saving…',
      'video.save.saved': 'Saved',
      'video.save.failed': 'Save failed · Retry',
      'video.save.retryHint': 'Panel state could not be saved; click to retry',
      'video.layout.resize': 'Resize panels',
      'video.canvas.play': 'Play',
      'video.canvas.pause': 'Pause',
      'video.canvas.timeline': 'Timeline',
      'video.canvas.undo': 'Undo',
      'video.canvas.redo': 'Redo',
      'video.canvas.materials': 'Assets',
      'video.media.compatibility': 'Build compatible preview',
      'video.media.import': 'Import media · or drop files',
      'video.media.search': 'Search media',
      'video.media.filter': 'Media type',
      'video.media.all': 'All',
      'video.media.video': 'Video',
      'video.media.image': 'Images',
      'video.media.audio': 'Audio',
      'video.media.cancel': 'Cancel',
      'video.media.processing': 'Processing…',
      'video.media.failed': 'Import failed. Try again.',
      'video.media.cancelled': 'Import cancelled',
      'video.media.retry': 'Retry',
      'video.media.loading': 'Loading media…',
      'video.media.empty': 'Drop video, images or audio',
      'video.media.more': 'Load more',
      'video.media.waveform': 'Waveform',
      'video.media.thumbnail': 'Thumbnail',
      'video.media.rebuild': 'Rebuild preview image',
      'video.media.reference': 'Reference (select to copy)',
      'video.media.remove': 'Delete media',
      'video.media.confirmRemove': 'Confirm deletion',
      'video.canvas.addScene': 'Add scene',
      'video.canvas.export': 'Export MP4',
      'video.canvas.exporting': 'Exporting…',
      'video.canvas.download': 'Download MP4',
      'video.canvas.loading': 'Preparing preview',
      'video.canvas.retry': 'Retry',
      'video.canvas.updatingPreview': 'Updating preview',
      'video.canvas.loadTimeout': 'Preview took too long. Please retry.',
      'video.canvas.frameTitle': 'Video preview',
      'video.canvas.runtimeError': 'The canvas runtime reported an error.',
      'video.canvas.invalidStyle': 'Enter a valid style.',
      'video.canvas.uploadFailed': 'The upload failed.',
      'video.canvas.exportFailed': 'The export failed.',
      'video.canvas.sceneColor': 'Scene background',
      'video.canvas.textStyle': 'Text style',
      'video.canvas.apply': 'Apply',
      'video.canvas.hint': 'Click the canvas to select an object; double-click text to edit it in place.',
      'video.canvas.busy': 'Working…',
      'video.canvas.close': 'Close',
      'video.canvas.upload': 'Upload PNG/JPEG',
      'video.canvas.uploading': 'Uploading…',
      'video.canvas.noAssets': 'No image assets yet.',
      'video.canvas.useAsset': 'Use as picture',
      'video.canvas.newSceneTitle': 'New scene',
      'video.canvas.templateUnavailable': 'This Scene does not expose complete writable data, so the write was cancelled to avoid dropping other content.',
      'video.canvas.invalidColor': 'The Scene background color is invalid.',
      'video.canvas.invalidAsset': 'The picture asset address is invalid.',
      'video.canvas.layoutRefused': 'This object has no usable static position, so the write was cancelled.',
      'video.canvas.layoutScaleUnknown': 'The current scale of this object is unknown, so the write was cancelled.',
      'video.canvas.persistFailed': 'The save failed. Try again.',
      'video.canvas.retryText': 'Retry save',
      'video.canvas.revisionRefreshed': 'The project was updated; submit the save again.',
      'video.preview.booting': 'Preparing the project…',
      'video.preview.empty': 'Describe your idea. Your film will appear here.',
      'video.preview.retry': 'Retry',
      'video.error.session': 'Creation conversations are temporarily unavailable.',
      'video.error.sessionConfig': 'Creation conversations are not configured.',
      'video.error.sessionState': 'The creation conversation record could not be read. Check the Host storage.',
      'video.preview.title': 'File preview',
      'video.preview.loading': 'Opening preview…',
      'video.preview.close': 'Close preview',
      'video.preview.unsupported': 'Inline preview does not support this file type yet.',
      'video.preview.tooLarge': 'This file is too large for an inline preview.',
      'video.preview.denied': 'This file cannot be previewed: it is outside the allowed Session scope.',
      'video.preview.notFound': 'The file no longer exists or has moved.',
      'video.preview.failed': 'The preview failed. Try again.',
    };
    //#endregion

    //#region styles
    // Only inspected theme tokens (--dsw-alias-*) are used for colors; the
    // host-published --dsh-content-font-size and --dsh-frame-top-clearance
    // variables keep typography and the macOS window-chrome clearance native.
    // The empty workspace is deliberately plain: one quiet sentence, no cards,
    // badges, stage framing, decorative motion or future-capability copy.
    const CSS = `
.dv-timeline{flex-shrink:0;border-top:1px solid var(--dsw-alias-border-l1,#ffffff12);min-height:148px;max-height:310px;background:var(--dsw-alias-bg-base,#191a1d);color:var(--dsw-alias-label-secondary,#aaaeb6);font-size:11px;position:relative}
.dv-timeline-toolbar{height:38px;display:flex;align-items:center;gap:3px;padding:0 12px;border-bottom:1px solid var(--dsw-alias-border-l1,#ffffff0b)}
.dv-timeline-heading{font-size:11px;font-weight:500;letter-spacing:.04em;margin-right:12px;color:var(--dsw-alias-label-tertiary,#92959e)}
.dv-timeline-tool,.dv-timeline-more summary{border:0;background:transparent;color:inherit;display:grid;place-items:center;width:28px;height:28px;padding:0;border-radius:5px;cursor:pointer;list-style:none;font-size:18px}
.dv-timeline-tool:hover,.dv-timeline-more summary:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff0c);color:var(--dsw-alias-label-primary,#eee)}
.dv-timeline-tool:disabled{opacity:.28;cursor:default}.dv-timeline-tool:focus-visible,.dv-track-mute:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#8facbc);outline-offset:1px}
.dv-tool-divider{width:1px;height:14px;background:var(--dsw-alias-border-l1,#ffffff14);margin:0 5px}.dv-timeline-spacer{flex:1}
.dv-timeline-more{position:relative}.dv-timeline-more summary::-webkit-details-marker{display:none}.dv-timeline-menu{position:absolute;top:32px;left:0;min-width:154px;padding:4px;background:var(--dsw-alias-bg-layer-1,#25262a);border:1px solid var(--dsw-alias-border-l1,#ffffff16);border-radius:8px;z-index:10;box-shadow:0 8px 28px #0003}.dv-timeline-menu button{display:block;width:100%;background:none;border:0;color:inherit;font:inherit;text-align:left;padding:8px;border-radius:4px;cursor:pointer}.dv-timeline-menu button:hover{background:#8881}.dv-timeline-menu button:disabled{opacity:.3}
.dv-snap-toggle{display:flex;align-items:center;gap:4px;font-size:10px;color:var(--dsw-alias-label-tertiary,#92959e);margin-right:8px;cursor:pointer}.dv-snap-toggle input{width:11px;height:11px;accent-color:#96afba}.dv-timeline-zoom{width:64px;height:2px;accent-color:#96afba}
.dv-timeline-scroll{overflow:auto;max-height:174px;scrollbar-width:thin;scrollbar-color:#7774 transparent}.dv-timeline-content{position:relative}.dv-timeline-ruler{height:26px;position:relative;cursor:crosshair;background:var(--dsw-alias-bg-base,#191a1d);border-bottom:1px solid var(--dsw-alias-border-l1,#ffffff0b)}.dv-timeline-ruler span{position:absolute;top:7px;border-left:1px solid var(--dsw-alias-border-l1,#ffffff1a);padding-left:5px;color:var(--dsw-alias-label-tertiary,#777d88);font-size:9px;font-variant-numeric:tabular-nums;line-height:13px}
.dv-timeline-track{display:flex;height:46px;border-bottom:1px solid var(--dsw-alias-border-l1,#ffffff0b)}.dv-timeline-track-name{width:100px;flex-shrink:0;display:flex;align-items:center;gap:4px;padding:0 9px;box-sizing:border-box;position:sticky;left:0;z-index:4;background:var(--dsw-alias-bg-base,#191a1d);border-right:1px solid var(--dsw-alias-border-l1,#ffffff0b);white-space:nowrap}.dv-track-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:10px}.dv-track-kind{display:inline-block;font-size:9px;color:var(--dsw-alias-label-tertiary,#707783);margin-right:7px}.dv-track-mute{flex-shrink:0;width:18px;height:20px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#777d88);font:inherit;font-size:9px;cursor:pointer;border-radius:3px}.dv-track-mute[aria-pressed=true]{color:#e8c887;background:#e8c88718}
.dv-timeline-lane{position:relative;background:var(--dsw-alias-bg-layer-1,#ffffff02)}.dv-timeline-clip{position:absolute;top:6px;bottom:6px;box-sizing:border-box;border:1px solid #879cb62b;background:#57729538;border-radius:4px;color:var(--dsw-alias-label-primary,#d5dce6);cursor:grab;overflow:hidden;touch-action:none;display:flex;align-items:center}.dv-timeline-clip.is-audio{background:#568c7b2b;border-color:#7bb59c2b}.dv-timeline-clip.is-selected{outline:1px solid #a9c1d6;outline-offset:-1px;background:#57729565}.dv-timeline-clip.is-audio.is-selected{outline-color:#9dcdb7;background:#568c7b4a}.dv-timeline-clip-label{padding:0 9px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;pointer-events:none;font-size:10px;z-index:1}.dv-clip-waveform{position:absolute;left:0;top:8px;width:100%;height:calc(100% - 8px);opacity:.42;object-fit:fill;pointer-events:none}.is-audio .dv-timeline-clip-label{align-self:flex-start;font-size:9px;line-height:15px;text-shadow:0 1px 4px #171a1b}
.dv-timeline-edge{position:absolute;left:0;top:0;bottom:0;width:6px;cursor:ew-resize;z-index:2;opacity:0;background:#ffffff22}.dv-timeline-clip:hover .dv-timeline-edge,.dv-timeline-clip.is-selected .dv-timeline-edge{opacity:1}.dv-timeline-edge-out{left:auto;right:0}.dv-timeline-playhead{position:absolute;top:0;bottom:0;width:1px;background:#e1ab7e;pointer-events:none;z-index:3}.dv-timeline-playhead:before{content:'';position:absolute;top:0;left:-3px;border:4px solid transparent;border-top-color:#e1ab7e}
.dv-timeline-inspector{display:flex;align-items:center;gap:12px;min-height:34px;padding:4px 12px;flex-wrap:wrap;border-top:1px solid var(--dsw-alias-border-l1,#ffffff0b);font-size:10px}.dv-timeline-inspector label{display:flex;gap:5px;align-items:center;white-space:nowrap}.dv-inspector-name{white-space:nowrap;max-width:80px;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary,#777d88)}.dv-timeline-inspector select,.dv-timeline-inspector input{color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l1,#ffffff14);border-radius:4px;font:inherit;height:23px;padding:0 4px;box-sizing:border-box;max-width:85px}.dv-timeline-inspector input{width:43px}.dv-timeline-notice{padding:3px 12px 5px;color:var(--dsw-alias-label-tertiary,#777d88);min-height:12px;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dv-timeline-compact .dv-timeline-track{height:30px}.dv-timeline-compact .dv-timeline-clip{top:3px;bottom:3px}
.dv-audio-panel{width:min(340px,calc(100% - 24px));padding:18px;box-sizing:border-box;overflow:auto;max-height:calc(100% - 24px)}.dv-audio-panel textarea,.dv-audio-panel input[type=password]{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l1,#ffffff18);border-radius:8px;background:var(--dsw-alias-bg-base,#191a1d);color:inherit;font:inherit;padding:10px;resize:vertical}.dv-audio-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1,#ffffff12);padding:8px 0;margin-bottom:14px}.dv-audio-tabs button{flex:1;background:transparent;border:0;color:inherit;font:inherit;padding:7px;border-radius:6px;cursor:pointer}.dv-audio-tabs .is-active{background:var(--dsw-alias-interactive-bg-hover,#ffffff0b);color:var(--dsw-alias-label-primary,#eee)}.dv-audio-field{display:flex;justify-content:space-between;align-items:center;margin:10px 0;font-size:11px}.dv-audio-field select{max-width:190px;background:transparent;color:inherit;border:0;font:inherit}.dv-audio-note{font-size:10px;line-height:1.7;color:var(--dsw-alias-label-tertiary,#92959e);margin:10px 0}.dv-audio-job{border-top:1px solid var(--dsw-alias-border-l1,#ffffff12);padding:12px 0;font-size:11px}.dv-audio-job p{line-height:1.7;font-size:10px;color:#d3a78e}.dv-audio-settings{font-size:11px;margin-top:12px}.dv-audio-settings summary{cursor:pointer;padding:8px 0}.dv-audio-actions{display:flex;gap:6px;margin-top:8px}
@media(max-width:480px){.dv-timeline-toolbar{padding:0 7px}.dv-timeline-heading{display:none}.dv-timeline-inspector{gap:8px}.dv-inspector-name{display:none}.dv-timeline-zoom{width:40px}}


.dv-root{
  --dv-dur-fast:120ms;
  --dv-dur-med:160ms;
  --dv-ease:cubic-bezier(.2,.8,.2,1);
  box-sizing:border-box;
  display:flex;
  flex-direction:column;
  width:100%;
  height:100%;
  min-width:0;
  min-height:0;
  overflow:hidden;
  container-type:inline-size;
  container-name:dsh-video;
  background:var(--dsw-alias-bg-base, #1a1a1c);
  color:var(--dsw-alias-label-primary, #f2f2f5);
  font-family:inherit;
  font-size:var(--dsh-content-font-size, 14px);
  line-height:1.5;
  /* P3-028: the host may publish a large --dsh-frame-leading-clearance when the
     macOS sidebar is collapsed (160px) because its own title row shares the
     window-chrome seat. This panel's topbar already sits below that seat via
     --dsh-frame-top-clearance, so re-applying the full leading clearance would
     shift the back button / project name to the right. Darwin therefore clamps
     the topbar leading to its normal padding; other platforms keep the host
     safety clearance. */
  --dv-topbar-leading:max(16px, var(--dsh-frame-leading-clearance, 0px));
  animation:dv-panel-in var(--dv-dur-med) var(--dv-ease) both;
}
[data-platform="darwin"] .dv-root{
  --dv-topbar-leading:16px;
}
.dv-root *,.dv-root *::before,.dv-root *::after{box-sizing:border-box;}
@keyframes dv-panel-in{
  from{opacity:0;transform:translateY(2px);}
  to{opacity:1;transform:none;}
}
.dv-topbar{
  display:flex;
  align-items:center;
  gap:8px;
  flex:none;
  min-height:56px;
  padding:8px 20px 8px var(--dv-topbar-leading);
  border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 62%, transparent);
}
[data-platform="darwin"] .dv-topbar{
  padding-top:calc(8px + var(--dsh-frame-top-clearance, 0px));
}
.dv-back{
  display:inline-flex;
  align-items:center;
  gap:6px;
  flex:none;
  height:32px;
  padding:0 10px;
  border:0;
  border-radius:8px;
  background:transparent;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font:inherit;
  font-size:.86em;
  cursor:pointer;
  -webkit-app-region:no-drag;
  transition:color var(--dv-dur-fast) var(--dv-ease), background var(--dv-dur-fast) var(--dv-ease);
}
.dv-back:hover{
  color:var(--dsw-alias-label-primary, #f2f2f5);
  background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,140,.14));
}
.dv-back:focus-visible{
  outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #5b8cff));
  outline-offset:2px;
}
.dv-back-label{white-space:nowrap;}
.dv-sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0;}
.dv-spacer{flex:1;min-width:0;}
/* P3-017 B3: product export control in the topbar (right side). P3-016 keeps the
   project name/arrow on the left and removed the display-settings menu. */
.dv-export{display:inline-flex;align-items:center;gap:8px;flex:none;min-width:0;}
.dv-export-status{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:220px;color:var(--dsw-alias-label-secondary,#a4a4ad);font-size:.78em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums;}
.dv-export-note{color:var(--dsw-alias-label-secondary,#a4a4ad);font-size:.78em;white-space:nowrap;}
.dv-export-error{color:var(--dsw-alias-label-secondary,#a4a4ad);font-size:.78em;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dv-export .dv-button{min-height:30px;padding:0 12px;}
.dv-export .dv-loader{width:12px;height:12px;border-width:1.5px;flex:none;}
.dv-export-spinner{flex:none;}
.dv-export-cancel{min-height:30px;padding:0 8px;}
.dv-export-link{text-decoration:none;}
/* P3-016: draggable divider between the read-only stage and the AI pane. The
   hit area overhangs the 1px rule so it is easy to grab without a visible
   gutter; the pane width itself is driven by the --dv-ai-width variable. */
.dv-splitter{
  position:relative;
  z-index:2;
  flex:none;
  width:9px;
  margin:0 -4px;
  padding:0;
  border:0;
  background:transparent;
  cursor:col-resize;
  touch-action:none;
  -webkit-app-region:no-drag;
}
.dv-splitter::before{
  content:'';
  position:absolute;
  top:0;
  bottom:0;
  left:50%;
  width:1px;
  transform:translateX(-50%);
  background:transparent;
  transition:background var(--dv-dur-fast) var(--dv-ease);
}
.dv-splitter:hover::before,.dv-splitter:focus-visible::before,.dv-splitter[data-dragging="true"]::before{
  background:var(--dsw-alias-border-l1, rgba(127,127,140,.5));
}
.dv-splitter:focus-visible{
  outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #5b8cff));
  outline-offset:-3px;
  border-radius:4px;
}
.dv-main[data-resizing="true"]{user-select:none;}
.dv-icon-button{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:32px;
  height:32px;
  padding:0;
  border:0;
  border-radius:8px;
  background:transparent;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  cursor:pointer;
  -webkit-app-region:no-drag;
  transition:color var(--dv-dur-fast) var(--dv-ease), background var(--dv-dur-fast) var(--dv-ease);
}
.dv-icon-button:hover,.dv-icon-button[aria-expanded="true"]{
  color:var(--dsw-alias-label-primary, #f2f2f5);
  background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,140,.14));
}
.dv-icon-button:focus-visible{
  outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #5b8cff));
  outline-offset:2px;
}
.dv-main{
  display:flex;
  flex:1;
  flex-direction:row;
  min-width:0;
  min-height:0;
  overflow:hidden;
}
.dv-left{
  display:flex;
  flex:1;
  flex-direction:column;
  min-width:0;
  min-height:0;
  overflow:hidden;
}
.dv-ai{
  display:flex;
  flex:none;
  flex-direction:column;
  /* P3-016: --dv-ai-width is set inline from the dragged/persisted ratio; the
     fallback is the same 42% default with a readable minimum, a 720px maximum
     and a protected left stage. The stacked (narrow container) query below
     overrides width back to auto. */
  width:var(--dv-ai-width, clamp(320px, 42%, min(720px, calc(100% - 360px))));
  min-width:0;
  min-height:0;
  border-left:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 62%, transparent);
  background:var(--dsw-alias-bg-base, #1a1a1c);
  position:relative;
}
.dv-ai-head{
  display:flex;
  flex:none;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  min-height:56px;
  padding:10px 20px;
  border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 40%, transparent);
}
.dv-ai-heading{
  display:flex;
  align-items:baseline;
  gap:8px;
  min-width:0;
}
.dv-ai-title{
  flex:none;
  color:var(--dsw-alias-label-primary, #f2f2f5);
  font-size:.9em;
  font-weight:600;
}
/* M2 media drawer floats over the preview, preserving the conversation width. */
.dv-drawer.dv-media-library{width:min(360px,calc(100% - 16px));max-height:calc(100% - 56px);overflow:auto;gap:12px;z-index:12;}
.dv-media-search,.dv-media-reference input{box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid var(--dsw-alias-border-secondary,#ffffff20);border-radius:8px;background:transparent;color:inherit;font:inherit;}
.dv-media-filters{display:flex;gap:2px;flex-wrap:wrap;}
.dv-media-filters [aria-pressed="true"],.dv-media-tile[aria-pressed="true"]{background:var(--dsw-alias-fill-secondary,#ffffff12);outline:1px solid var(--dsw-alias-label-secondary,#999);}
.dv-media-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
.dv-media-tile{display:flex;flex-direction:column;gap:5px;min-width:0;padding:7px;text-align:left;background:transparent;color:inherit;border:1px solid var(--dsw-alias-border-secondary,#ffffff14);border-radius:8px;cursor:pointer;}
.dv-media-tile img,.dv-media-placeholder{width:100%;height:76px;object-fit:contain;background:#00000018;border-radius:4px;}
.dv-media-placeholder{display:grid;place-items:center;font-size:28px;}
.dv-media-name{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dv-media-tile small{opacity:.6;font-variant-numeric:tabular-nums;}
.dv-media-detail{display:flex;flex-direction:column;gap:10px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-secondary,#ffffff20);overflow-wrap:anywhere;}
.dv-media-preview{width:100%;max-height:180px;object-fit:contain;}
.dv-media-derived{width:100%;max-height:100px;object-fit:contain;}
.dv-media-progress{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:.85em;}
.dv-media-progress span:first-child{width:100%;overflow-wrap:anywhere;}
.dv-upload:focus-within{outline:2px solid var(--dsw-focus-ring-color,#4578dd);outline-offset:2px;}
.dv-media-reference{font-size:.8em;opacity:.8;}
.dv-ai-session{
  min-width:0;
  overflow:hidden;
  color:var(--dsw-alias-label-tertiary, #7f7f88);
  font-size:.78em;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dv-ai-actions{display:flex;flex:none;align-items:center;gap:4px;}
.dv-history-toggle,.dv-new-session{width:36px;height:36px;}
.dv-ai-body{
  display:flex;
  flex:1;
  flex-direction:column;
  min-width:0;
  min-height:0;
  overflow:hidden;
}
.dv-ai-body > *{min-width:0;min-height:0;}
/* Own full-height boundary; only stable native region attributes are used.
   Native Composer, approvals, model selection, scroll and editor stay mounted. */
.dv-conversation{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;overflow:hidden;}
.dv-conversation > *{flex:1;min-height:0;}
.dv-conversation [data-conversation-content]{flex:1;min-height:0;height:100%;}
.dv-conversation [data-conversation-scroll]{display:flex;flex:1;flex-direction:column;min-height:0;}
.dv-conversation [data-conversation-scroll] > [data-slot="conversation.session"]{display:flex;flex:1 0 auto;flex-direction:column;min-height:0;}
.dv-conversation [data-conversation-region="composer"]{flex-shrink:0;margin-top:auto;}

.dv-preview{
  position:absolute;
  inset:0;
  z-index:6;
  display:flex;
  flex-direction:column;
  min-width:0;
  min-height:0;
  background:var(--dsw-alias-bg-layer-1, #232327);
}
.dv-preview-head{
  display:flex;
  flex:none;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  padding:10px 12px;
  border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 62%, transparent);
}
.dv-preview-title{
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  color:var(--dsw-alias-label-primary, #f2f2f5);
  font-size:.86em;
}
.dv-preview-close{
  flex:none;
  min-height:28px;
  padding:0 9px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.32)) 82%, transparent);
  border-radius:8px;
  background:transparent;
  color:var(--dsw-alias-label-primary, #f2f2f5);
  font:inherit;
  font-size:.8em;
  cursor:pointer;
}
.dv-preview-close:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,140,.14));}
.dv-preview-body{
  display:flex;
  flex:1;
  align-items:center;
  justify-content:center;
  min-width:0;
  min-height:0;
  padding:12px;
  overflow:auto;
}
.dv-preview-image{
  display:block;
  max-width:100%;
  max-height:100%;
  object-fit:contain;
  border-radius:6px;
  background:var(--dsw-alias-bg-base, #1a1a1c);
}
.dv-preview-status{
  margin:0;
  padding:12px;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font-size:.84em;
  text-align:center;
}
.dv-preview-status[data-error="true"]{color:var(--dsw-alias-state-error-primary, #e06c75);}
.dv-ai-loading,.dv-ai-hint,.dv-ai-notice{
  margin:0;
  padding:14px;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font-size:.84em;
  text-align:left;
}
.dv-ai-error{
  display:flex;
  flex:1;
  flex-direction:column;
  align-items:flex-start;
  gap:10px;
  padding:14px;
}
.dv-ai-error .dv-error{max-width:none;text-align:left;}
.dv-ai-empty{
  display:flex;
  flex:1;
  flex-direction:column;
  align-items:flex-start;
  justify-content:center;
  gap:12px;
  padding:18px;
}
.dv-history-menu{
  position:absolute;
  top:44px;
  right:10px;
  z-index:3;
  display:flex;
  flex-direction:column;
  gap:2px;
  min-width:240px;
  max-width:calc(100% - 20px);
  max-height:320px;
  overflow:auto;
  padding:6px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 84%, transparent);
  border-radius:10px;
  background:var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, #232327));
  box-shadow:0 12px 32px -20px rgba(0,0,0,.5);
}
.dv-history-item{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  width:100%;
  min-height:32px;
  padding:0 9px;
  border:0;
  border-radius:7px;
  background:transparent;
  color:var(--dsw-alias-label-primary, #f2f2f5);
  font:inherit;
  font-size:.82em;
  text-align:left;
  cursor:pointer;
}
.dv-history-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,140,.14));}
.dv-history-item[aria-checked="true"]{background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,140,.14));}
.dv-history-item:disabled{opacity:.55;cursor:default;}
.dv-history-item:focus-visible{
  outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #5b8cff));
  outline-offset:-2px;
}
.dv-history-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dv-history-state{flex:none;color:var(--dsw-alias-label-tertiary, #7f7f88);font-size:.92em;}
.dv-emptywrap{
  display:flex;
  flex:1;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:14px;
  min-width:0;
  min-height:0;
  padding:24px;
}
.dv-empty{
  margin:0;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font-size:1em;
}
.dv-error{
  margin:0;
  max-width:38em;
  color:var(--dsw-alias-state-error-primary, #e5484d);
  font-size:.86em;
  text-align:center;
}
.dv-editor{
  display:flex;
  flex:1;
  flex-direction:column;
  min-width:0;
  min-height:0;
}
.dv-stage{
  display:flex;
  flex:1;
  flex-direction:column;
  gap:12px;
  min-width:0;
  min-height:0;
  padding:16px;
}
.dv-stagebar{
  display:flex;
  align-items:baseline;
  justify-content:space-between;
  gap:12px;
  min-height:28px;
}
.dv-project-title{
  min-width:0;
  overflow:hidden;
  color:var(--dsw-alias-label-primary, #f2f2f5);
  font-size:1.08em;
  font-weight:600;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dv-project-meta{
  flex:none;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font-size:.8em;
  font-variant-numeric:tabular-nums;
  white-space:nowrap;
}
.dv-canvas{
  position:relative;
  display:flex;
  flex:1;
  align-items:center;
  justify-content:center;
  min-height:200px;
  overflow:hidden;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 70%, transparent);
  border-radius:10px;
  background:var(--dsw-alias-bg-layer-1, #232327);
}
.dv-frame{
  display:block;
  max-width:100%;
  max-height:100%;
  object-fit:contain;
}
.dv-canvas-note{
  margin:0;
  max-width:32em;
  padding:16px;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font-size:.86em;
  text-align:center;
}
.dv-controls{
  display:flex;
  flex:none;
  flex-wrap:wrap;
  align-items:flex-end;
  gap:12px;
  max-height:44%;
  min-height:0;
  overflow:auto;
  padding:12px 16px 16px;
  border-top:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 62%, transparent);
}
.dv-controls > .dv-field{min-width:130px;flex:0 1 180px;}
.dv-controls > .dv-field-row{flex:1 1 260px;}
.dv-controls > .dv-field-row .dv-field{min-width:110px;}
.dv-controls > .dv-actions{width:100%;}
.dv-controls > .dv-details{width:100%;}
.dv-controls > .dv-note,.dv-controls > .dv-error{width:100%;}
.dv-controls > .dv-job{width:100%;}
.dv-actions{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
}
.dv-button{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-height:32px;
  padding:0 12px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 86%, transparent);
  border-radius:8px;
  background:transparent;
  color:var(--dsw-alias-label-primary, #f2f2f5);
  font:inherit;
  font-size:.86em;
  cursor:pointer;
  transition:background var(--dv-dur-fast) var(--dv-ease), border-color var(--dv-dur-fast) var(--dv-ease), opacity var(--dv-dur-fast) var(--dv-ease);
}
.dv-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,140,.14));}
.dv-button:focus-visible{
  outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #5b8cff));
  outline-offset:2px;
}
.dv-button:disabled{opacity:.55;cursor:default;}
.dv-button-primary{
  border-color:transparent;
  background:var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #5b8cff));
  color:var(--dsw-alias-label-primary-foreground, #fff);
}
.dv-button-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary, #5b8cff));}
.dv-button-primary:disabled{
  opacity:1;
  background:var(--dsw-alias-button-primary-dimmed, var(--dsw-alias-interactive-bg-hover, rgba(127,127,140,.14)));
  color:var(--dsw-alias-label-secondary, #a4a4ad);
}
.dv-button-quiet{color:var(--dsw-alias-label-secondary, #a4a4ad);}
.dv-field{
  display:flex;
  flex-direction:column;
  gap:6px;
}
.dv-field-row{
  display:flex;
  gap:8px;
}
.dv-field-row .dv-field{flex:1;min-width:0;}
.dv-label{
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font-size:.8em;
}
.dv-input{
  width:100%;
  min-width:0;
  height:32px;
  padding:0 9px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 86%, transparent);
  border-radius:8px;
  background:var(--dsw-alias-bg-base, #1a1a1c);
  color:var(--dsw-alias-label-primary, #f2f2f5);
  font:inherit;
  font-size:.86em;
}
.dv-input:focus-visible{
  outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #5b8cff));
  outline-offset:1px;
}
.dv-note{
  margin:0;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font-size:.8em;
}
.dv-job{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:8px;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font-size:.8em;
}
.dv-job-state{
  color:var(--dsw-alias-label-primary, #f2f2f5);
}
.dv-download{
  color:var(--dsw-alias-brand-primary, #5b8cff);
  font-size:.86em;
  text-decoration:none;
}
.dv-download:hover{text-decoration:underline;}
.dv-download:focus-visible{
  outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #5b8cff));
  outline-offset:2px;
}
.dv-details{
  padding-top:10px;
  border-top:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 62%, transparent);
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font-size:.8em;
}
.dv-details summary{cursor:pointer;color:var(--dsw-alias-label-primary, #f2f2f5);}
.dv-meta-list{
  display:flex;
  flex-direction:column;
  gap:6px;
  margin:8px 0 0;
  padding:0;
  list-style:none;
}
.dv-meta-item{
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dv-controls .dv-error{
  max-width:none;
  text-align:left;
}

/* P3-016 topbar: back button -> clickable work name -> project menu arrow.
   The name itself is the inline-rename trigger; the arrow only opens the picker
   so a click on the title never silently switches projects. */
.dv-projectbar{position:relative;display:flex;align-items:center;gap:2px;min-width:0;max-width:min(60%, 420px);-webkit-app-region:no-drag;}
.dv-project-name{
  min-width:0;
  max-width:320px;
  height:32px;
  padding:0 8px;
  border:0;
  border-radius:8px;
  background:transparent;
  color:var(--dsw-alias-label-primary,#f2f2f5);
  font:inherit;
  font-size:.94em;
  font-weight:550;
  text-align:left;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  cursor:text;
  transition:background var(--dv-dur-fast) var(--dv-ease);
}
.dv-project-name:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,140,.12));}
.dv-project-name:focus-visible,.dv-project-name-input:focus-visible{
  outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#5b8cff));
  outline-offset:2px;
}
.dv-project-name:disabled{opacity:.55;cursor:default;}
.dv-project-name-input{
  width:min(260px, 40vw);
  min-width:140px;
  max-width:320px;
  height:32px;
  padding:0 8px;
  border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1,rgba(127,127,140,.28)) 86%,transparent);
  border-radius:8px;
  background:var(--dsw-alias-bg-base,#1a1a1c);
  color:var(--dsw-alias-label-primary,#f2f2f5);
  font:inherit;
  font-size:.94em;
  font-weight:550;
}
.dv-project-name-input:disabled{opacity:.6;}
.dv-project-toggle{width:28px;height:28px;}
.dv-project-menu{
  position:absolute;
  top:calc(100% + 6px);
  left:0;
  z-index:3;
  display:flex;
  flex-direction:column;
  gap:2px;
  min-width:220px;
  max-width:min(340px, calc(100vw - 48px));
  max-height:320px;
  overflow:auto;
  padding:6px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 84%, transparent);
  border-radius:10px;
  background:var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1,#232327));
  box-shadow:0 12px 32px -20px rgba(0,0,0,.5);
  -webkit-app-region:no-drag;
}
.dv-project-item{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  width:100%;
  min-height:32px;
  padding:0 9px;
  border:0;
  border-radius:7px;
  background:transparent;
  color:var(--dsw-alias-label-primary,#f2f2f5);
  font:inherit;
  font-size:.84em;
  text-align:left;
  cursor:pointer;
}
.dv-project-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,140,.14));}
.dv-project-item[aria-checked="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,140,.14));}
.dv-project-item:disabled{opacity:.55;cursor:default;}
.dv-project-item:focus-visible{
  outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#5b8cff));
  outline-offset:-2px;
}
.dv-project-item-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dv-project-item-check{flex:none;min-width:1em;color:var(--dsw-alias-label-secondary,#a4a4ad);text-align:center;}
.dv-project-separator{height:1px;margin:4px 6px;background:color-mix(in srgb,var(--dsw-alias-border-l1,rgba(127,127,140,.28)) 62%,transparent);}
.dv-project-folder-notice{margin:0 8px;max-width:min(420px,42vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.78em;color:var(--dsw-alias-label-secondary,#a4a4ad);}
.dv-project-folder-notice[data-kind="error"]{color:var(--dsw-alias-state-error-primary,#e06c75);}
.dv-save-status{flex:none;margin-right:6px;padding:0 8px;height:22px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1,rgba(127,127,140,.32)) 82%,transparent);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#a4a4ad);font:inherit;font-size:.72em;line-height:20px;cursor:default;white-space:nowrap;}
.dv-save-status[data-status="failed"]{color:var(--dsw-alias-state-error-primary,#e06c75);cursor:pointer;}
.dv-save-status:disabled{opacity:1;}
.dv-folder-button{flex:none;margin-left:2px;}
@media (max-width: 640px){.dv-folder-button{display:none;}}
.dv-project-rename-error{
  min-width:0;
  margin:0;
  overflow:hidden;
  color:var(--dsw-alias-state-error-primary,#e5484d);
  font-size:.78em;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dv-canvas-shell{
  display:flex;
  flex:1;
  flex-direction:column;
  min-width:0;
  min-height:0;
  padding:8px 16px 14px;
  gap:8px;
  position:relative;
}
.dv-canvas-bar{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:6px;
  flex:none;
}
.dv-canvas-bar .dv-button{min-height:28px;padding:0 9px;font-size:.8em;}
.dv-seek{flex:1;min-width:60px;height:20px;margin:0;appearance:none;background:transparent;accent-color:var(--dsw-alias-label-primary,#f2f2f5);cursor:pointer;}
.dv-seek::-webkit-slider-runnable-track{height:3px;border-radius:99px;background:var(--dsw-alias-border-l1,rgba(127,127,140,.28));}
.dv-seek::-webkit-slider-thumb{appearance:none;width:10px;height:10px;margin-top:-3.5px;border:0;border-radius:50%;background:var(--dsw-alias-label-primary,#f2f2f5);transition:box-shadow var(--dv-dur-fast) var(--dv-ease);}
.dv-seek::-moz-range-track{height:3px;border-radius:99px;background:var(--dsw-alias-border-l1,rgba(127,127,140,.28));}
.dv-seek::-moz-range-thumb{width:10px;height:10px;border:0;border-radius:50%;background:var(--dsw-alias-label-primary,#f2f2f5);}
.dv-seek:hover:not(:disabled)::-webkit-slider-thumb{box-shadow:0 0 0 4px color-mix(in srgb,var(--dsw-alias-label-primary,#f2f2f5) 8%,transparent);}
.dv-seek:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#5b8cff));outline-offset:4px;border-radius:4px;}
.dv-seek:disabled{opacity:.35;cursor:default;}
.dv-time{color:var(--dsw-alias-label-secondary,#a4a4ad);font-size:.78em;font-variant-numeric:tabular-nums;white-space:nowrap;}
.dv-export-link{text-decoration:none;display:inline-flex;align-items:center;}
.dv-canvas-wrap{
  position:relative;
  display:flex;
  flex:1;
  align-items:center;
  justify-content:center;
  min-width:0;
  min-height:0;
  overflow:hidden;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 64%, transparent);
  border-radius:10px;
  background:var(--dsw-alias-bg-base,#1a1a1c);
}
.dv-stage{position:relative;overflow:hidden;background:#000;box-shadow:0 12px 32px -24px rgba(0,0,0,.65);}
.dv-stage.dv-canvas-stage{display:block;flex:none;padding:0;}
.dv-stage-frame{position:absolute;top:0;left:0;border:0;background:#000;}
.dv-stage-frame-candidate{pointer-events:none;}
.dv-canvas-status-overlay{
  position:absolute;
  inset:0;
  display:flex;
  align-items:center;
  justify-content:center;
  margin:0;
  padding:0;
  pointer-events:none;
}
.dv-preview-notice{
  display:flex;
  flex:none;
  flex-wrap:wrap;
  align-items:center;
  gap:8px;
  padding:6px 10px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 45%, transparent);
  border-radius:8px;
  background:var(--dsw-alias-bg-layer-1, #232327);
  color:var(--dsw-alias-state-error-primary, #e5484d);
  font-size:.8em;
}
.dv-preview-notice-text{min-width:0;overflow:hidden;text-overflow:ellipsis;}
.dv-preview-notice-retry{min-height:24px;padding:0 8px;font-size:.92em;}
.dv-overlay{position:absolute;inset:0;cursor:default;touch-action:none;}
.dv-selection{
  position:absolute;
  border:1.5px solid var(--dsw-alias-state-business-primary,#6f8cff);
  background:transparent;
  cursor:move;
  box-shadow:0 0 0 1px rgba(0,0,0,.25);
}
.dv-handle{
  position:absolute;
  width:9px;
  height:9px;
  border-radius:2px;
  border:1px solid var(--dsw-alias-state-business-primary,#6f8cff);
  background:var(--dsw-alias-bg-layer-1,#232327);
}
.dv-handle-nw{left:-5px;top:-5px;cursor:nwse-resize;}
.dv-handle-ne{right:-5px;top:-5px;cursor:nesw-resize;}
.dv-handle-sw{left:-5px;bottom:-5px;cursor:nesw-resize;}
.dv-handle-se{right:-5px;bottom:-5px;cursor:nwse-resize;}
.dv-inline-editor{
  position:absolute;
  z-index:2;
  min-width:80px;
  padding:2px 4px;
  border:1px solid var(--dsw-alias-state-business-primary,#6f8cff);
  border-radius:3px;
  background:var(--dsw-alias-bg-overlay,#232327);
  color:var(--dsw-alias-label-primary,#f2f2f5);
  font:inherit;
  resize:none;
}
.dv-editor-actions{
  position:absolute;
  z-index:3;
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:6px;
  max-width:min(320px, 90%);
  padding:3px 6px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #e06c75) 55%, transparent);
  border-radius:5px;
  background:var(--dsw-alias-bg-overlay,#232327);
  box-shadow:0 8px 20px -14px rgba(0,0,0,.6);
  font-size:.74em;
}
.dv-editor-actions .dv-button{min-height:22px;padding:0 7px;font-size:.92em;}
.dv-editor-actions .dv-editor-retry{flex:none;}
.dv-editor-actions .dv-tool-error{min-width:0;overflow:hidden;text-overflow:ellipsis;}
.dv-canvas-status{
  margin:auto;
  padding:14px;
  color:var(--dsw-alias-label-secondary,#a4a4ad);
  font-size:.84em;
  text-align:center;
}
.dv-canvas-status .dv-button{margin-top:10px;}
.dv-canvas-tools{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:10px;
  min-height:28px;
  flex:none;
  font-size:.8em;
}
.dv-tool-field{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary,#a4a4ad);}
.dv-tool-field input[type="color"]{width:28px;height:24px;padding:1px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.32)) 80%, transparent);border-radius:5px;background:transparent;}
.dv-size-input{width:52px;height:24px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.32)) 80%, transparent);border-radius:5px;background:var(--dsw-alias-bg-layer-1,#232327);color:var(--dsw-alias-label-primary,#f2f2f5);font:inherit;font-size:.95em;padding:0 4px;}
.dv-tool-hint{color:var(--dsw-alias-label-tertiary,#7f7f88);}
.dv-tool-error{color:var(--dsw-alias-state-error-primary,#e06c75);}
.dv-drawer{
  position:absolute;
  top:44px;
  left:16px;
  bottom:44px;
  z-index:4;
  display:flex;
  flex-direction:column;
  gap:8px;
  width:min(260px, calc(100% - 32px));
  padding:10px;
  overflow:auto;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 82%, transparent);
  border-radius:10px;
  background:var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1,#232327));
  box-shadow:0 12px 32px -20px rgba(0,0,0,.5);
}
.dv-drawer-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:.86em;}
.dv-upload{display:inline-flex;align-items:center;justify-content:center;min-height:28px;padding:0 8px;border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.32)) 82%, transparent);border-radius:7px;color:var(--dsw-alias-label-primary,#f2f2f5);cursor:pointer;font-size:.8em;}
.dv-upload input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;}
.dv-asset-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;}
.dv-asset-row{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;padding:2px 0;}
.dv-asset-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.78em;}
.dv-asset-row .dv-button{min-height:24px;padding:0 7px;font-size:.74em;}
.dv-empty-actions{display:flex;flex-wrap:wrap;gap:8px;}
.dv-managed-stage{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;}
.dv-left{background:color-mix(in srgb,var(--dsw-alias-bg-base,#1a1a1c) 96%,var(--dsw-alias-label-primary,#f2f2f5));}
.dv-canvas-shell[data-preview-only="true"]{padding:24px;gap:16px;}
.dv-canvas-shell[data-preview-only="true"] .dv-canvas-wrap{border:0;border-radius:0;background:transparent;}
.dv-canvas-shell[data-preview-only="true"] .dv-canvas-stage{border-radius:6px;box-shadow:0 12px 36px -20px rgba(0,0,0,.32);}
.dv-canvas-shell[data-preview-only="true"] .dv-canvas-stage[data-ready="false"]{background:transparent;box-shadow:none;}
.dv-canvas-shell[data-preview-only="true"] .dv-canvas-bar{
  align-self:center;
  flex-wrap:nowrap;
  gap:14px;
  width:min(100%, 560px);
  min-height:52px;
  padding:6px 16px 6px 8px;
  border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1,rgba(127,127,140,.28)) 55%,transparent);
  border-radius:16px;
  background:var(--dsw-alias-bg-base,#1a1a1c);
  box-shadow:0 4px 16px -10px rgba(0,0,0,.16);
}
.dv-canvas-bar .dv-play{flex:none;width:36px;min-height:36px;padding:0;border:0;border-radius:50%;color:var(--dsw-alias-label-primary,#f2f2f5);}
.dv-canvas-status{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;line-height:1.6;}
.dv-canvas-status-overlay{padding:20px;background:transparent;}
.dv-loader{display:block;width:22px;height:22px;border:1.5px solid color-mix(in srgb,var(--dsw-alias-label-secondary,#a4a4ad) 20%,transparent);border-top-color:var(--dsw-alias-label-secondary,#a4a4ad);border-radius:50%;animation:dv-loading 1s linear infinite;}
@keyframes dv-loading{to{transform:rotate(360deg);}}
.dv-preview-progress{position:absolute;top:36px;right:36px;z-index:1;display:flex;align-items:center;gap:7px;padding:6px 10px;border-radius:99px;background:var(--dsw-alias-bg-base,#1a1a1c);color:var(--dsw-alias-label-secondary,#a4a4ad);font-size:.78em;box-shadow:0 2px 8px -4px rgba(0,0,0,.2);}
.dv-status-dot{width:5px;height:5px;border-radius:50%;background:currentColor;}
@supports (backdrop-filter: blur(16px)){
  .dv-canvas-shell[data-preview-only="true"] .dv-canvas-bar{background:color-mix(in srgb,var(--dsw-alias-bg-base,#1a1a1c) 80%,transparent);backdrop-filter:blur(16px);}
}
@media (prefers-reduced-transparency: reduce){
  .dv-root .dv-canvas-shell[data-preview-only="true"] .dv-canvas-bar{background:var(--dsw-alias-bg-base,#1a1a1c);backdrop-filter:none;}
}
@media (prefers-reduced-motion: reduce){
  .dv-root,.dv-loader{animation:none;}
}
@container dsh-video (max-width: 900px){
  .dv-canvas-shell[data-preview-only="true"]{padding:16px;gap:12px;}
  .dv-stage{padding:12px;}
  .dv-controls{padding:10px 12px 12px;}
}
@container dsh-video (max-width: 700px){
  .dv-main{flex-direction:column;}
  .dv-splitter{display:none;}
  .dv-left{flex:1 1 48%;min-height:180px;}
  .dv-ai{
    width:auto;
    flex:1 1 52%;
    min-height:220px;
    max-height:none;
    border-left:0;
    border-top:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 62%, transparent);
  }
  .dv-stage{padding-bottom:8px;}
}
@container dsh-video (max-width: 520px){
  .dv-topbar{padding-left:max(12px, var(--dv-topbar-leading));padding-right:12px;}
  .dv-projectbar{max-width:calc(100% - 90px);}
  .dv-canvas-shell[data-preview-only="true"]{padding:12px;gap:8px;}
  .dv-ai-head{min-height:48px;padding:6px 12px;}
  .dv-back{padding:0 8px;}
  .dv-stage{padding:10px;}
  .dv-controls{padding:8px 10px 10px;}
}
`;
    //#endregion

    //#region diagnostics
    const reportedCodes = new Set();
    let reportIssue = function noopReport() {};

    /** Build a logger that can never throw into the UI or the slot runtime. */
    function makeReporter(ctx) {
      return function report(code, error) {
        try {
          const message = 'dsh-video: ' + code;
          if (error === undefined) {
            if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(message);
          } else if (ctx.logger && typeof ctx.logger.error === 'function') {
            ctx.logger.error(message, error);
          }
        } catch (_ignored) {
          /* diagnostics must not break activation or interaction */
        }
      };
    }

    function reportOnce(code, error) {
      if (reportedCodes.has(code)) return;
      reportedCodes.add(code);
      reportIssue(code, error);
    }
    //#endregion

    //#region preferences + plugin store
    function safeStorage() {
      try {
        if (typeof localStorage === 'undefined') return null;
        const candidate = localStorage;
        if (
          candidate === null ||
          typeof candidate !== 'object' ||
          typeof candidate.getItem !== 'function' ||
          typeof candidate.setItem !== 'function'
        ) {
          return null;
        }
        return candidate;
      } catch (_error) {
        return null;
      }
    }

    /**
     * Read the versioned layout preference (P3-016 resizable AI pane). Any
     * absence, corrupt JSON, unexpected shape, unknown version, or storage
     * exception falls back to the default ratio; the pure helpers clamp/bound
     * an accepted ratio.
     */
    function readLayoutPrefs() {
      const storage = safeStorage();
      if (storage === null) return { aiPaneRatio: AI_PANE_DEFAULT_RATIO };
      let raw;
      try {
        raw = storage.getItem(LAYOUT_PREFS_KEY);
      } catch (error) {
        reportOnce('prefs-read-failed', error);
        return { aiPaneRatio: AI_PANE_DEFAULT_RATIO };
      }
      if (typeof raw !== 'string' || raw === '') return { aiPaneRatio: AI_PANE_DEFAULT_RATIO };
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { aiPaneRatio: AI_PANE_DEFAULT_RATIO };
        }
        if (parsed.version !== LAYOUT_PREFS_VERSION) return { aiPaneRatio: AI_PANE_DEFAULT_RATIO };
        return { aiPaneRatio: normalizeAiPaneRatio(parsed.aiPaneRatio) };
      } catch (error) {
        reportOnce('prefs-corrupt', error);
        return { aiPaneRatio: AI_PANE_DEFAULT_RATIO };
      }
    }

    /** Default ratio used by a fresh panel; kept as one call for tests/mount. */
    function readAiPaneRatio() {
      return readLayoutPrefs().aiPaneRatio;
    }

    /**
     * Best-effort write of the versioned layout preference. A failed write keeps
     * the in-memory ratio and reports once; it never blocks the UI.
     */
    function writeLayoutPrefs(ratio) {
      const storage = safeStorage();
      if (storage === null) {
        reportOnce('prefs-storage-unavailable');
        return false;
      }
      try {
        storage.setItem(
          LAYOUT_PREFS_KEY,
          JSON.stringify({ version: LAYOUT_PREFS_VERSION, aiPaneRatio: normalizeAiPaneRatio(ratio) })
        );
        return true;
      } catch (error) {
        reportOnce('prefs-write-failed', error);
        return false;
      }
    }

    function createUiStore(initial, report) {
      let state = initial;
      const listeners = new Set();
      return {
        getSnapshot() {
          return state;
        },
        subscribe(listener) {
          listeners.add(listener);
          return function unsubscribe() {
            listeners.delete(listener);
          };
        },
        setPatch(patch) {
          state = Object.assign({}, state, patch);
          const snapshot = Array.from(listeners);
          for (let index = 0; index < snapshot.length; index += 1) {
            try {
              snapshot[index]();
            } catch (error) {
              report('store-listener-failed', error);
            }
          }
        },
      };
    }

    /** Plugin-scope store for panel-level notices (no project/content truth). */
    let uiStore = null;
    /** Bounded panel-scope memory: a mode switch must not rewrite worker state. */
    let editorMemory = null;

    function getStore() {
      if (uiStore === null) {
        uiStore = createUiStore({ navigationError: null }, function noop() {});
      }
      return uiStore;
    }

    function usePluginState() {
      const store = getStore();
      return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    }

    function setNavigationError(code) {
      const store = getStore();
      const value = typeof code === 'string' ? code : null;
      if (store.getSnapshot().navigationError === value) return;
      store.setPatch({ navigationError: value });
    }
    //#endregion

    //#region host helpers
    /** Feature-detected slot enumeration, used for occupancy diagnostics. */
    function slotEntries(ctx, slotName) {
      try {
        const slots = ctx.slots;
        if (slots === null || typeof slots !== 'object' || typeof slots.entries !== 'function') return null;
        const entries = slots.entries(slotName);
        return Array.isArray(entries) ? entries : null;
      } catch (error) {
        reportOnce('slot-entries-failed', error);
        return null;
      }
    }

    /**
     * Detect whether a slot already has occupants. `field === null` matches any
     * entry (single/list slots); otherwise the entry's options[field] must equal
     * value. Returns null when the runtime cannot answer.
     */
    function findOccupants(ctx, slotName, field, value) {
      const entries = slotEntries(ctx, slotName);
      if (entries === null) return null;
      if (field === null) return entries;
      return entries.filter(function keep(entry) {
        return entry !== null && typeof entry === 'object' && entry.options && entry.options[field] === value;
      });
    }

    /** Whether a slot declaration currently exists; null when it cannot be known. */
    function isSlotDeclared(ctx, slotName) {
      try {
        const slots = ctx.slots;
        if (slots === null || typeof slots !== 'object') return null;
        if (typeof slots.specDynamic === 'function') return slots.specDynamic(slotName) !== undefined;
        if (typeof slots.spec === 'function') return slots.spec(slotName) !== undefined;
      } catch (_error) {
        return null;
      }
      return null;
    }
    //#endregion

    //#region icons
    /**
     * Refined one-pixel video-camera outline for the host sidebar row. The host
     * supplies the square edge (`size`: 16 expanded / 18 collapsed in 0.2.0-rc.2)
     * and the selected state; the glyph follows the row's currentColor only.
     */
    function SidebarVideoIcon(props) {
      let size = props && typeof props.size === 'number' && isFinite(props.size) ? props.size : 16;
      if (size < 12) size = 12;
      if (size > 24) size = 24;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
          stroke: 'currentColor',
          strokeWidth: 1,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('rect', { x: 1.25, y: 3.5, width: 8.75, height: 9, rx: 2 }),
        h('path', { d: 'M10 7.15 13.9 5a.55.55 0 0 1 .82.48v5.04a.55.55 0 0 1-.82.48L10 8.85' })
      );
    }

    function FolderIcon() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: '16', height: '16', fill: 'none', stroke: 'currentColor', strokeWidth: '1.4', 'aria-hidden': 'true', focusable: 'false' },
        h('path', { d: 'M1.8 4.3c0-.7.6-1.3 1.3-1.3h3.1l1.4 1.6h5.3c.7 0 1.3.6 1.3 1.3v6.8c0 .7-.6 1.3-1.3 1.3H3.1c-.7 0-1.3-.6-1.3-1.3V4.3z' })
      );
    }

    function BackIcon() {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 16 16',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('path', { d: 'M9.75 3.5 5.25 8l4.5 4.5' })
      );
    }

    /** P3-016 project-picker arrow; never the rename trigger itself. */
    function ChevronDownIcon() {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 16 16',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('path', { d: 'm4 6.25 4 4 4-4' })
      );
    }
    function HistoryIcon() {
      return h(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 16 16',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
          stroke: 'currentColor',
          strokeWidth: 1,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('circle', { cx: 8, cy: 8, r: 5.75 }),
        h('path', { d: 'M8 4.75v3.5l2.35 1.4' })
      );
    }
    //#endregion

    //#region host bridge helpers
    // The Host-configured controlled fixture id. A request can only reference a
    // project id from the trusted allowlist; this UI never sends a path or URL.
    const DEMO_PROJECT_ID = 'demo';
    // The read-only preview follows the exact revision the Host reports. The
    // poll is the only UI-side trigger for a new preview snapshot: an AI Tool
    // publish (project.compose) bumps the worker revision, this panel observes it
    // through `inspect` and mounts the new snapshot without a user action.
    const REVISION_POLL_MS = 1500;
    // P3-017 B1 preview state machine. A published revision is debounced so a
    // burst of Agent publishes settles on the last one; the snapshot request and
    // the mounted candidate's runtime handshake each get their own independent
    // budget, because a cold worker start and a slow composition load are
    // different failure modes. A failed attempt is retried once with a fresh
    // snapshot before the honest error is shown, and the previously displayed
    // composition stays visible/playable throughout.
    const PREVIEW_DEBOUNCE_MS = 1000;
    const PREVIEW_SNAPSHOT_TIMEOUT_MS = 30000;
    const PREVIEW_READY_TIMEOUT_MS = 30000;
    const PREVIEW_RETRY_LIMIT = 1;
    const PREVIEW_RETRY_DELAY_MS = 400;
    const PREVIEW_DIAGNOSTIC_LIMIT = 6;
    // P3-017 B3 product export. The render deadline is measured by the worker
    // (a real composition needs minutes); the UI poll simply follows the job
    // until it settles. The client deadline is a safety net slightly above the
    // Host maximum, never a substitute for the worker's own timeout.
    const PRODUCT_RENDER_TIMEOUT_MS = 900000;
    const PRODUCT_EXPORT_DEADLINE_MS = 16 * 60 * 1000;
    const PRODUCT_EXPORT_POLL_MS = 500;
    // The plugin-private source key for its owned Session references. It must
    // never reuse "mainView": the host derives its current conversation from
    // that retention key (see P3-005-A investigation).
    const SESSION_SOURCE = 'videoView';
    // A private session-scope child slot is declared only to receive the
    // renderer's SessionProvider/renderSlot kit; the conversation Factory is
    // rendered directly inside the Provider and this slot has no occupant.
    const SESSION_CHILD_SLOT = 'dsh-video.chat';
    const REQUEST_ROUTE = 'api/dsh-video/request';
    const ARTIFACT_ROUTE = 'api/dsh-video/artifact';
    const TERMINAL_JOB_STATES = ['succeeded', 'failed', 'cancelled', 'timed_out'];

    function operationId() {
      try {
        if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
      } catch (_error) {
        /* fall through to the bounded local form */
      }
      return 'ui-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    function artifactUrl(jobId) {
      return ARTIFACT_ROUTE + '?jobId=' + encodeURIComponent(String(jobId));
    }

    function capabilityList(element) {
      return element && Array.isArray(element.capabilities) ? element.capabilities : [];
    }

    // The controlled fixture's title contract. Real fixtures may place a
    // text-only eyebrow before the title, so title/timing must never be found by
    // two independent "first capability" scans. A single target is selected and
    // both fields operate on that exact stableId; the target can be switched in
    // the properties panel.
    const FIXTURE_TITLE_ID = 'hf-title';

    function elementsOf(project) {
      return project && Array.isArray(project.elements) ? project.elements : [];
    }

    function hasCapability(element, capability) {
      return capabilityList(element).indexOf(capability) !== -1;
    }

    function editableElements(elements) {
      return elements.filter(function editable(element) {
        return hasCapability(element, 'text') || hasCapability(element, 'timing');
      });
    }

    function targetFor(elements, preferredId) {
      const preferred = typeof preferredId === 'string' && preferredId.length > 0
        ? elements.find(function byId(element) { return element && element.stableId === preferredId; })
        : null;
      if (preferred !== undefined && preferred !== null && (hasCapability(preferred, 'text') || hasCapability(preferred, 'timing'))) return preferred;
      const contractTitle = elements.find(function fixtureTitle(element) {
        return element && element.stableId === FIXTURE_TITLE_ID && hasCapability(element, 'text') && hasCapability(element, 'timing');
      });
      if (contractTitle !== undefined) return contractTitle;
      const combined = elements.find(function both(element) {
        return hasCapability(element, 'text') && hasCapability(element, 'timing');
      });
      if (combined !== undefined) return combined;
      const candidates = editableElements(elements);
      return candidates.length > 0 ? candidates[0] : null;
    }

    /** Small, consistent currentColor controls; hidden names remain real text. */
    function StudioIcon(props) {
      const name = props.name;
      return h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false' },
        name === 'play' ? h('path', { d: 'M9 5.5v13l10-6.5z', fill: 'currentColor', stroke: 'none' }) :
        name === 'pause' ? h('path', { d: 'M9 5.5v13M15 5.5v13', strokeWidth: 2.5 }) :
        name === 'new' ? h('path', { d: 'M12 5v14M5 12h14' }) :
        h('rect', { x: 4, y: 6, width: 16, height: 12, rx: 3 })
      );
    }

    /**
     * Presentation only: never use UI labels as project identity or write truth.
     * P3-016: the explicit `project.json` title (returned by inspect/rename) wins;
     * legacy projects without one keep the previous content-derived fallback.
     */
    function studioProjectTitle(project, fallback) {
      if (project === null || typeof project !== 'object') return fallback;
      if (typeof project.title === 'string') {
        const stored = project.title.trim();
        if (stored.length > 0) return stored.slice(0, 120);
      }
      const scene = Array.isArray(project.scenes) ? project.scenes[0] : null;
      const textElement = Array.isArray(project.elements) ? project.elements.find(function titleText(element) {
        return element && typeof element.text === 'string' && element.text.trim().length > 0 && element.text.length <= 120 && hasCapability(element, 'text');
      }) : null;
      const title = scene && typeof scene.title === 'string' ? scene.title : textElement !== null && textElement !== undefined ? textElement.text : '';
      const text = title.trim();
      return text.length > 0 ? text.slice(0, 120) : fallback;
    }

    function durationOf(project) {
      const duration = Number(project && project.duration);
      return Number.isFinite(duration) && duration >= 0 ? duration : null;
    }

    function defaultFrameTime(project, rememberedValue) {
      const duration = durationOf(project);
      if (duration === null) return 0;
      const raw = typeof rememberedValue === 'string' ? rememberedValue.trim() : rememberedValue;
      if (raw !== '' && raw !== null && raw !== undefined) {
        const remembered = Number(raw);
        if (Number.isFinite(remembered) && remembered >= 0 && remembered <= duration) return remembered;
      }
      return Math.min(2.5, duration);
    }

    function parseFrameTime(value, project) {
      const duration = durationOf(project);
      if (duration === null) return null;
      if (typeof value === 'string' && value.trim() === '') return null;
      const time = Number(value);
      if (Number.isFinite(time) === false || time < 0 || time > duration) return null;
      return time;
    }

    function formatSeconds(value) {
      return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '';
    }

    function isTerminalJob(job) {
      return job !== null && typeof job === 'object' && TERMINAL_JOB_STATES.indexOf(job.state) !== -1;
    }

    function hostError(error) {
      if (error !== null && typeof error === 'object' && typeof error.code === 'string') {
        return {
          code: error.code,
          message: typeof error.message === 'string' && error.message.length > 0 ? error.message : 'Request failed',
          uncertain: error.uncertain === true,
          jobUnknown: error.jobUnknown === true,
        };
      }
      return { code: 'E_NETWORK', message: 'Request failed', uncertain: false, jobUnknown: false };
    }

    async function hostRequest(method, params) {
      if (typeof fetch !== 'function') throw { code: 'E_NETWORK', message: 'fetch is unavailable' };
      let response;
      try {
        response = await fetch(REQUEST_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ method: method, params: params || {} }),
        });
      } catch (_error) {
        throw { code: 'E_NETWORK', message: 'Could not reach the video service' };
      }
      let body = null;
      try {
        body = await response.json();
      } catch (_error) {
        body = null;
      }
      if (body === null || typeof body !== 'object') {
        throw { code: 'E_NETWORK', message: 'The video service returned an invalid response' };
      }
      if (body.ok === true) return body.result;
      const error = body.error !== null && typeof body.error === 'object' ? body.error : {};
      throw hostError({
        code: typeof error.code === 'string' ? error.code : 'E_INTERNAL',
        message: typeof error.message === 'string' ? error.message : 'The video service rejected the request',
        uncertain: error.uncertain === true,
        jobUnknown: error.jobUnknown === true,
      });
    }

    function errorText(error, t) {
      const code = error && error.code;
      let friendly = null;
      if (code === 'E_CONFIGURATION') friendly = t('video.error.configuration');
      else if (code === 'E_NETWORK') friendly = t('video.error.network');
      else if (code === 'E_REVISION_CONFLICT' || code === 'E_OPERATION_REUSED' || code === 'E_PROJECT_CLOSING' || code === 'E_PROJECT_NOT_OPEN') friendly = t('video.error.conflict');
      else if (code === 'E_WORKER_START' || code === 'E_WORKER_EXITED' || code === 'E_WORKER_DISPOSED' || code === 'E_TRANSPORT' || code === 'E_STARTUP') friendly = t('video.error.worker');
      else if (code === 'E_ARTIFACT_INTEGRITY' || code === 'E_ARTIFACT_NOT_READY') friendly = t('video.frame.failed');
      else if (code === 'E_PERSIST') friendly = t('video.canvas.persistFailed');
      else if (code === 'E_SESSION_CONFIG') friendly = t('video.error.sessionConfig');
      else if (code === 'E_SESSION_STATE_CORRUPT' || code === 'E_SESSION_STATE_VERSION' || code === 'E_SESSION_STATE_LIMIT' || code === 'E_SESSION_STATE_DISPOSED') friendly = t('video.error.sessionState');
      else if (code === 'E_SESSION_CREATE' || code === 'E_SESSION_RESPONSE' || code === 'E_SESSION_NOT_BOUND' || code === 'E_SESSION_ALREADY_BOUND' || code === 'E_AGENT_REQUIRED' || code === 'E_PROJECT_SCOPE') friendly = t('video.error.session');
      else if (code === 'E_SESSION_OPEN' || code === 'E_SESSION_UNAVAILABLE') friendly = t('video.ai.error');
      const detail = error && typeof error.message === 'string' ? error.message : '';
      if (friendly !== null) {
        return detail.length > 0 ? friendly + ' ' + detail : friendly;
      }
      return detail.length > 0 ? detail : t('video.error.generic');
    }

    function timingRangeMessage(t, duration) {
      if (duration === null) return t('video.edit.invalidTiming');
      return t('video.timing.range').replace('{duration}', formatSeconds(duration));
    }

    function isTimingBeyondComposition(error) {
      return error !== null && typeof error === 'object' && error.code === 'E_PARAMS' && typeof error.message === 'string' && /Timing extends beyond composition/i.test(error.message);
    }

    // A preview click is intercepted only inside this plugin's embedded AI
    // surface. File cards and Markdown file links keep their native content; the
    // local handler routes only path-like targets to the Host-supported preview
    // route, so the global right sidebar never has to be mounted.
    const PREVIEW_PATH_EXTENSION = /\.[A-Za-z0-9]{1,12}(?:$|[?#])/;
    const PREVIEW_EXTERNAL_PREFIX = /^(?:https?:|mailto:|tel:|javascript:|data:|#)/i;
    // P3-022: the host chat renders a ToolRow's collapsed result summary as
    // `<button type="button" class="<css-hash>_fileLink" onClick={openFile}>`
    // (or an `<a class="..._fileLink">`) with NO title/data-* path attribute.
    // The summary text is "<localized tool title> · <file path>" (U+00B7 middle
    // dot separator); the path may be workspace-relative or absolute. A click on
    // the button/child span would otherwise run the host `openFile`, which needs
    // the host's global right-sidebar file opener and throws inside this
    // plugin's embedded conversation (that surface is not mounted under a global
    // main panel). Matching the CSS-module suffix keeps working when the hash
    // changes.
    const PREVIEW_FILE_LINK_SELECTOR = '[class*="fileLink"]';
    const PREVIEW_SUMMARY_SEPARATOR = ' \u00b7 ';

    /** Extract the file path from a ToolRow summary ("<title> · <path>"). */
    function previewSummaryPath(text) {
      if (typeof text !== 'string') return null;
      const trimmed = text.replace(/\s+/g, ' ').trim();
      if (trimmed.length === 0 || trimmed.length > 4096) return null;
      const index = trimmed.lastIndexOf(PREVIEW_SUMMARY_SEPARATOR);
      const candidate = (index >= 0 ? trimmed.slice(index + PREVIEW_SUMMARY_SEPARATOR.length) : trimmed).trim();
      if (candidate.length === 0 || candidate.length > 4096) return null;
      return localPathLike(candidate) ? candidate : null;
    }

    /** Resolve the file path of a host ToolRow file link (button or anchor). */
    function fileLinkPathFromTarget(target) {
      if (target === null || typeof target !== 'object' || typeof target.closest !== 'function') return null;
      try {
        const link = target.closest(PREVIEW_FILE_LINK_SELECTOR);
        if (link === null || link === undefined) return null;
        if (typeof link.getAttribute === 'function') {
          const attributes = [
            link.getAttribute('data-file-path'),
            link.getAttribute('data-path'),
            link.getAttribute('title'),
          ];
          for (const value of attributes) {
            if (localPathLike(value)) return value;
          }
          const href = link.getAttribute('href');
          if (localPathLike(href)) return href;
        }
        const text = typeof link.textContent === 'string' ? link.textContent : '';
        return previewSummaryPath(text);
      } catch (_error) {
        return null;
      }
    }

    function localPathFromTarget(target) {
      if (target === null || typeof target !== 'object' || typeof target.closest !== 'function') return null;
      try {
        const button = target.closest('button[title]');
        if (button !== null && button !== undefined && typeof button.getAttribute === 'function') {
          const title = button.getAttribute('title');
          if (localPathLike(title)) return title;
        }
        const dataNode = target.closest('[data-file-path],[data-path]');
        if (dataNode !== null && dataNode !== undefined && typeof dataNode.getAttribute === 'function') {
          const value = dataNode.getAttribute('data-file-path') || dataNode.getAttribute('data-path');
          if (localPathLike(value)) return value;
        }
        const anchor = target.closest('a[href]');
        if (anchor !== null && anchor !== undefined && typeof anchor.getAttribute === 'function') {
          const href = anchor.getAttribute('href');
          if (localPathLike(href)) return href;
        }
        const fileLink = fileLinkPathFromTarget(target);
        if (fileLink !== null) return fileLink;
      } catch (_error) {
        return null;
      }
      return null;
    }

    function localPathLike(value) {
      if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return false;
      if (PREVIEW_EXTERNAL_PREFIX.test(value) === true) return false;
      if (value.indexOf('\n') !== -1) return false;
      if (value.startsWith('file://')) return true;
      if (value.startsWith('/') && value.length > 1) return true;
      if (/^[A-Za-z]:[\\/]/.test(value) === true) return true;
      return PREVIEW_PATH_EXTENSION.test(value);
    }

    // P3-017 B2: an image click inside the embedded conversation must never fall
    // back to the Host's global right sidebar (that surface is not mounted inside
    // a global main panel). Browser-owned sources (data:/blob:/remote URLs already
    // loaded by the chat, or a same-origin chat image route) render directly in
    // the plugin overlay; path-like local sources (including the workspace-relative
    // `.dsh-video-frames/latest.png`) go through the existing bounded Host preview
    // route, which resolves Session/project roots server-side.
    const PREVIEW_INLINE_IMAGE = /^(?:data:image\/|blob:)/i;
    const PREVIEW_REMOTE_IMAGE = /^https?:\/\//i;

    function imagePreviewTarget(target) {
      if (target === null || typeof target !== 'object' || typeof target.closest !== 'function') return null;
      try {
        const image = target.closest('img[src]');
        if (image === null || image === undefined || typeof image.getAttribute !== 'function') return null;
        const src = image.getAttribute('src');
        if (typeof src !== 'string' || src.length === 0 || src.length > 8192 || src.indexOf('\n') !== -1) return null;
        if (PREVIEW_INLINE_IMAGE.test(src) === true) return { kind: 'inline', src: src };
        if (localPathLike(src) === true) return { kind: 'host', path: src };
        if (PREVIEW_REMOTE_IMAGE.test(src) === true || src.startsWith('api/') === true || src.startsWith('./') === true) {
          return { kind: 'inline', src: src };
        }
      } catch (_error) {
        return null;
      }
      return null;
    }

    function previewFileName(path) {
      if (typeof path !== 'string') return '';
      const withoutQuery = path.split('?')[0].split('#')[0];
      const parts = withoutQuery.split(/[\\/]/);
      return parts.length === 0 ? '' : parts[parts.length - 1];
    }

    function previewErrorText(error, t) {
      const code = error !== null && typeof error === 'object' ? error.code : null;
      if (code === 'E_PREVIEW_UNSUPPORTED') return t('video.preview.unsupported');
      if (code === 'E_PREVIEW_LIMIT') return t('video.preview.tooLarge');
      if (code === 'E_PREVIEW_DENIED') return t('video.preview.denied');
      if (code === 'E_PREVIEW_NOT_FOUND') return t('video.preview.notFound');
      return t('video.preview.failed');
    }

    function stateText(state, t) {
      return typeof state === 'string' && state.length > 0 ? t('video.state.' + state) : '';
    }

    // ---------------------------------------------------------------------------
    // Pure canvas helpers. Kept at module scope, free of React/DOM/Host state so
    // the Node smoke test can execute this exact source (vm-extracted) and prove
    // the numeric layout patch, the frozen Scene template copy and the reviewed
    // P3-005-B runtime message contract without a browser. CanvasWorkspace is the
    // only caller; keeping them here also keeps the browser harness extraction
    // inside the two reviewed region slices.
    // ---------------------------------------------------------------------------

    const CANVAS_CONTRACT_VERSION = 1;
    const CANVAS_MAX_MESSAGE_BYTES = 16384;
    const CANVAS_INSTANCE_ID = /^[a-z0-9][a-z0-9-]{7,63}$/;
    const CANVAS_NONCE = /^[a-f0-9]{32}$/;
    const CANVAS_COMMAND_TYPES = Object.freeze([
      'ping',
      'state',
      'seek',
      'play',
      'enableSound',
      'pause',
      'hitTest',
      'getElements',
      'destroy',
    ]);
    const CANVAS_EVENT_TYPES = Object.freeze([
      'ready',
      'soundEnabled',
      'pong',
      'state',
      'seeked',
      'playing',
      'paused',
      'hit',
      'elements',
      'destroyed',
      'error',
    ]);
    // Direct (unsolicited) events may not carry a replyTo: every one of these is
    // a direct answer to a command, so a floating copy is a protocol violation
    // and would otherwise let a stale snapshot mutate the current UI.
    const CANVAS_CORRELATED_EVENT_TYPES = Object.freeze([
      'pong',
      'seeked',
      'playing',
      'paused',
      'hit',
      'elements',
      'state',
      'destroyed',
    ]);
    const CANVAS_COMMAND_REQUIRED = Object.freeze({
      enableSound: [],
      ping: [],
      state: [],
      seek: ['time'],
      play: [],
      pause: [],
      hitTest: ['x', 'y'],
      getElements: [],
      destroy: [],
    });
    const CANVAS_EVENT_REQUIRED = Object.freeze({
      soundEnabled: [],
      ready: ['runtimeVersion', 'width', 'height', 'duration'],
      pong: [],
      state: ['time', 'duration', 'playing'],
      seeked: ['time'],
      playing: ['time'],
      paused: ['time'],
      hit: ['hit'],
      elements: ['elements'],
      destroyed: [],
      error: ['code', 'message'],
    });
    const CANVAS_COMMAND_KEYS = Object.freeze(['v', 'kind', 'instanceId', 'nonce', 'seq', 'type', 'payload']);
    const CANVAS_EVENT_KEYS = Object.freeze(['v', 'kind', 'instanceId', 'nonce', 'seq', 'type', 'replyTo', 'payload']);
    const CANVAS_SCENE_TEMPLATE_KEYS = Object.freeze(['title', 'duration', 'subtitle', 'badge', 'color', 'accent', 'logo', 'shot']);
    // Frozen engine 0.3.2 sceneTemplate text limits (UTF-16 string length, as
    // enforced by the Host bridge and the worker). Human typed text edits can
    // legally reach these lengths, so the client copy must not reject or
    // truncate them and must use the same length semantics as the Host/engine.
    const CANVAS_SCENE_TEXT_MAX = 2048;
    const CANVAS_SCENE_COLOR = /^#[0-9a-fA-F]{6}$/;
    const CANVAS_SCENE_ASSET = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g)$/i;
    const CANVAS_REVISION = /^[a-f0-9]{64}$/;

    function canvasPlainObject(value) {
      return value !== null && typeof value === 'object' && Array.isArray(value) === false;
    }

    function canvasFiniteNumber(value) {
      return typeof value === 'number' && Number.isFinite(value);
    }

    /**
     * Text length in UTF-16 code units, exactly like the frozen Host bridge and
     * engine (`typeof value === 'string'` + `value.length`).
     */
    function canvasTextLength(value) {
      return typeof value === 'string' ? value.length : -1;
    }

    function canvasExactKeys(value, allowed, required) {
      if (canvasPlainObject(value) === false) return 'not-object';
      for (const key of Object.keys(value)) {
        if (allowed.includes(key) === false) return 'unknown-key:' + key;
      }
      for (const key of required) {
        if (Object.prototype.hasOwnProperty.call(value, key) === false || value[key] === undefined) return 'missing-key:' + key;
      }
      return null;
    }

    function canvasIsOversizedMessage(message) {
      try {
        const encoded = JSON.stringify(message);
        if (typeof TextEncoder === 'function') return new TextEncoder().encode(encoded).length > CANVAS_MAX_MESSAGE_BYTES;
        return encoded.length > CANVAS_MAX_MESSAGE_BYTES;
      } catch (_error) {
        return true;
      }
    }

    function canvasValidateEnvelope(message, kind, types, required, allowedKeys) {
      const keyError = canvasExactKeys(message, allowedKeys, allowedKeys);
      if (keyError !== null) return { ok: false, code: 'E_MALFORMED', detail: keyError };
      if (message.v !== CANVAS_CONTRACT_VERSION) return { ok: false, code: 'E_VERSION', detail: 'unsupported contract version' };
      if (message.kind !== kind) return { ok: false, code: 'E_MALFORMED', detail: 'wrong kind' };
      if (typeof message.instanceId !== 'string' || CANVAS_INSTANCE_ID.test(message.instanceId) === false) {
        return { ok: false, code: 'E_INSTANCE', detail: 'invalid instanceId' };
      }
      if (typeof message.nonce !== 'string' || CANVAS_NONCE.test(message.nonce) === false) {
        return { ok: false, code: 'E_NONCE', detail: 'invalid nonce' };
      }
      if (Number.isInteger(message.seq) === false || message.seq < 1) {
        return { ok: false, code: 'E_SEQ', detail: 'seq must be a positive integer' };
      }
      if (types.includes(message.type) === false) return { ok: false, code: 'E_TYPE', detail: 'unknown message type' };
      if (kind === 'evt' && message.replyTo !== null && Number.isInteger(message.replyTo) === false) {
        return { ok: false, code: 'E_REPLY', detail: 'replyTo must be integer or null' };
      }
      if (canvasPlainObject(message.payload) === false) return { ok: false, code: 'E_PAYLOAD', detail: 'payload must be an object' };
      const payloadKeys = required[message.type];
      const payloadError = canvasExactKeys(message.payload, payloadKeys, payloadKeys);
      if (payloadError !== null) return { ok: false, code: 'E_PAYLOAD', detail: message.type + ':' + payloadError };
      return { ok: true };
    }

    /** Validate a runtime event against the reviewed P3-005-B contract. */
    function canvasValidateEvent(message) {
      const envelope = canvasValidateEnvelope(message, 'evt', CANVAS_EVENT_TYPES, CANVAS_EVENT_REQUIRED, CANVAS_EVENT_KEYS);
      if (envelope.ok === false) return envelope;
      const payload = message.payload;
      if (message.type === 'ready') {
        if (
          typeof payload.runtimeVersion !== 'string' ||
          canvasFiniteNumber(payload.width) === false ||
          canvasFiniteNumber(payload.height) === false ||
          canvasFiniteNumber(payload.duration) === false ||
          payload.width <= 0 ||
          payload.height <= 0 ||
          payload.duration <= 0
        ) {
          return { ok: false, code: 'E_PAYLOAD', detail: 'ready shape' };
        }
      } else if (message.type === 'state') {
        if (canvasFiniteNumber(payload.time) === false || canvasFiniteNumber(payload.duration) === false || typeof payload.playing !== 'boolean') {
          return { ok: false, code: 'E_PAYLOAD', detail: 'state shape' };
        }
      } else if (message.type === 'seeked' || message.type === 'playing' || message.type === 'paused') {
        if (canvasFiniteNumber(payload.time) === false) return { ok: false, code: 'E_PAYLOAD', detail: message.type + '.time' };
      } else if (message.type === 'hit') {
        if (payload.hit !== null && canvasValidateHit(payload.hit) !== null) return { ok: false, code: 'E_PAYLOAD', detail: 'hit shape' };
      } else if (message.type === 'elements') {
        if (Array.isArray(payload.elements) === false || payload.elements.length > 512) {
          return { ok: false, code: 'E_PAYLOAD', detail: 'elements shape' };
        }
      } else if (message.type === 'error') {
        if (
          typeof payload.code !== 'string' ||
          payload.code.length === 0 ||
          payload.code.length > 64 ||
          typeof payload.message !== 'string' ||
          payload.message.length > 512
        ) {
          return { ok: false, code: 'E_PAYLOAD', detail: 'error shape' };
        }
      }
      return { ok: true };
    }

    /** Validate a parent-to-runtime command (the UI only sends known types). */
    function canvasValidateCommand(message) {
      const envelope = canvasValidateEnvelope(message, 'cmd', CANVAS_COMMAND_TYPES, CANVAS_COMMAND_REQUIRED, CANVAS_COMMAND_KEYS);
      if (envelope.ok === false) return envelope;
      const payload = message.payload;
      if (message.type === 'seek') {
        if (canvasFiniteNumber(payload.time) === false) return { ok: false, code: 'E_PAYLOAD', detail: 'seek.time must be finite' };
      } else if (message.type === 'hitTest') {
        if (canvasFiniteNumber(payload.x) === false || canvasFiniteNumber(payload.y) === false) {
          return { ok: false, code: 'E_PAYLOAD', detail: 'hitTest coordinates must be finite' };
        }
      }
      return { ok: true };
    }

    /** Returns null for a valid hit description, else the failing detail. */
    function canvasValidateHit(hit) {
      if (canvasPlainObject(hit) === false) return 'not-object';
      const allowed = ['stableId', 'sceneId', 'tag', 'text', 'rect', 'style', 'stack'];
      for (const key of Object.keys(hit)) {
        if (allowed.includes(key) === false) return 'unknown:' + key;
      }
      if (typeof hit.stableId !== 'string' || hit.stableId.length === 0) return 'stableId';
      if (hit.sceneId !== null && typeof hit.sceneId !== 'string') return 'sceneId';
      if (typeof hit.tag !== 'string' || hit.tag.length > 32) return 'tag';
      if (typeof hit.text !== 'string') return 'text';
      if (canvasPlainObject(hit.rect) === false) return 'rect';
      const rectError = canvasExactKeys(hit.rect, ['x', 'y', 'width', 'height'], ['x', 'y', 'width', 'height']);
      if (rectError !== null) return 'rect:' + rectError;
      for (const value of Object.values(hit.rect)) {
        if (canvasFiniteNumber(value) === false) return 'rect-number';
      }
      if (hit.rect.width < 0 || hit.rect.height < 0) return 'rect-negative';
      if (canvasPlainObject(hit.style) === false) return 'style';
      if (Array.isArray(hit.stack) === false || hit.stack.length > 32) return 'stack';
      for (const id of hit.stack) {
        if (typeof id !== 'string') return 'stack-id';
      }
      return null;
    }

    /**
     * One ledger per preview snapshot instance. Mirrors the reviewed spike
     * contract: commands carry increasing seq numbers, incoming events must pass
     * the strict shape check, belong to this exact instance/nonce, advance the
     * event sequence strictly and either answer a pending command or be an
     * explicit unsolicited event (ready/error). `revoke()` returns the still
     * pending seqs so the caller can settle every promise explicitly.
     */
    function canvasMessageLedger(options) {
      const settings = canvasPlainObject(options) ? options : {};
      const instanceId = settings.instanceId;
      const nonce = settings.nonce;
      const timeoutMs = canvasFiniteNumber(settings.timeoutMs) && settings.timeoutMs > 0 ? settings.timeoutMs : 4000;
      if (typeof instanceId !== 'string' || CANVAS_INSTANCE_ID.test(instanceId) === false) throw new TypeError('invalid canvas instanceId');
      if (typeof nonce !== 'string' || CANVAS_NONCE.test(nonce) === false) throw new TypeError('invalid canvas nonce');
      let nextSeq = 1;
      let lastEventSeq = 0;
      let revoked = false;
      const pending = new Map();
      const now = typeof settings.now === 'function' ? settings.now : Date.now;

      function command(type, payload) {
        const message = {
          v: CANVAS_CONTRACT_VERSION,
          kind: 'cmd',
          instanceId: instanceId,
          nonce: nonce,
          seq: nextSeq,
          type: type,
          payload: payload === undefined ? {} : payload,
        };
        const validation = canvasValidateCommand(message);
        if (validation.ok === false) throw new TypeError('invalid canvas command: ' + validation.detail);
        nextSeq += 1;
        pending.set(message.seq, { type: type, deadline: now() + timeoutMs });
        return message;
      }

      function revoke() {
        revoked = true;
        const seqs = [...pending.keys()];
        pending.clear();
        return seqs;
      }

      function expire(at) {
        const expired = [];
        for (const [seq, entry] of pending) {
          if (entry.deadline <= at) {
            expired.push(seq);
            pending.delete(seq);
          }
        }
        return expired;
      }

      function accept(message, acceptance) {
        const optionsInput = canvasPlainObject(acceptance) ? acceptance : {};
        const at = canvasFiniteNumber(optionsInput.now) ? optionsInput.now : now();
        function drop(code, detail) {
          return { accepted: false, code: code, detail: detail, seq: canvasPlainObject(message) && Number.isInteger(message.seq) ? message.seq : null };
        }
        if (revoked) return drop('E_INSTANCE_REVOKED', 'canvas instance was revoked');
        if (optionsInput.sourceOk !== true) return drop('E_SOURCE_MISMATCH', 'event source is not this iframe');
        if (canvasIsOversizedMessage(message)) return drop('E_OVERSIZED', 'event exceeds the message size limit');
        const validation = canvasValidateEvent(message);
        if (validation.ok === false) return drop(validation.code, validation.detail);
        if (message.instanceId !== instanceId) return drop('E_WRONG_INSTANCE', 'event belongs to another instance');
        if (message.nonce !== nonce) return drop('E_NONCE', 'nonce mismatch');
        if (message.seq <= lastEventSeq) return drop('E_STALE_SEQ', 'event sequence already seen');
        lastEventSeq = message.seq;
        let correlated = null;
        if (message.replyTo !== null) {
          correlated = pending.get(message.replyTo) || null;
          if (correlated === null) return drop('E_LATE_RESPONSE', 'no pending command for seq ' + message.replyTo);
          pending.delete(message.replyTo);
        } else if (CANVAS_CORRELATED_EVENT_TYPES.includes(message.type)) {
          return drop('E_UNCORRELATED', message.type + ' needs replyTo');
        }
        void at;
        return {
          accepted: true,
          seq: message.seq,
          type: message.type,
          payload: message.payload,
          replyTo: message.replyTo,
          commandType: correlated === null ? null : correlated.type,
        };
      }

      function pendingCount() {
        return pending.size;
      }

      function pendingSeqs() {
        return [...pending.keys()];
      }

      return { command: command, accept: accept, revoke: revoke, expire: expire, pendingCount: pendingCount, pendingSeqs: pendingSeqs };
    }

    /** Static layout base (composition px) from the authoritative inspect. */
    function canvasStaticBase(layout) {
      function extent(key, positive) {
        if (canvasPlainObject(layout) === false) return null;
        const value = layout[key];
        if (canvasFiniteNumber(value) === false || value < 0) return null;
        if (positive === true && value <= 0) return null;
        return value;
      }
      return {
        left: extent('left', false),
        top: extent('top', false),
        width: extent('width', true),
        height: extent('height', true),
      };
    }

    function canvasClampNumber(value, minimum, maximum) {
      const ceiling = maximum < minimum ? minimum : maximum;
      return Math.min(Math.max(value, minimum), ceiling);
    }

    function canvasRoundNumber(value) {
      return Math.round(value * 1000) / 1000;
    }

    function canvasValidRect(value) {
      if (canvasPlainObject(value) === false) return null;
      if (canvasFiniteNumber(value.x) === false || canvasFiniteNumber(value.y) === false) return null;
      if (canvasFiniteNumber(value.width) === false || canvasFiniteNumber(value.height) === false) return null;
      if (value.width < 0 || value.height < 0) return null;
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    }

    /**
     * Turn an animated drag preview into the static layout patch to persist.
     *
     * `base` is inspected.elements[].layout (null = unset/auto), `animated` is the
     * runtime hit rect captured at pointer-down and `preview` is the same rect
     * moved by the pointer delta. A move only patches left/top from the static
     * origin plus the animated delta; a resize inverts the current animation
     * scale (sx from width, sy from height, else sy := sx) so neither the
     * transform nor the animated offset is ever baked into the document.
     */
    function canvasLayoutPatch(input) {
      const settings = canvasPlainObject(input) ? input : {};
      const mode = typeof settings.mode === 'string' ? settings.mode : '';
      const base = settings.base;
      const animated = canvasValidRect(settings.animated);
      const preview = canvasValidRect(settings.preview);
      const composition = canvasPlainObject(settings.composition)
        ? canvasValidRect({ x: 0, y: 0, width: settings.composition.width, height: settings.composition.height })
        : null;
      if (canvasPlainObject(base) === false || animated === null || preview === null || composition === null) {
        return { ok: false, code: 'E_LAYOUT_INPUT', detail: 'layout drag input is incomplete' };
      }
      if (composition.width <= 0 || composition.height <= 0) {
        return { ok: false, code: 'E_LAYOUT_INPUT', detail: 'composition size is unknown' };
      }
      const move = mode === 'move';
      const widthSide = mode.includes('e') || mode.includes('w');
      const heightSide = mode.includes('n') || mode.includes('s');
      if (move === false && (mode === '' || /^[ns]?[ew]?$/.test(mode) === false || (widthSide === false && heightSide === false))) {
        return { ok: false, code: 'E_LAYOUT_INPUT', detail: 'unknown drag mode' };
      }
      const dx = preview.x - animated.x;
      const dy = preview.y - animated.y;
      if (move) {
        if (base.left === null || base.top === null) return { ok: false, code: 'E_LAYOUT_BASE', detail: 'static origin is unknown' };
        const widthBasis = base.width !== null ? base.width : animated.width;
        const heightBasis = base.height !== null ? base.height : animated.height;
        return {
          ok: true,
          patch: {
            left: canvasRoundNumber(canvasClampNumber(base.left + dx, 0, composition.width - widthBasis)),
            top: canvasRoundNumber(canvasClampNumber(base.top + dy, 0, composition.height - heightBasis)),
          },
        };
      }
      // sx is only derivable from the static width; an auto width must never be
      // turned into a scale guess. sy falls back to sx, as the reviewed inverse
      // mapping specifies (uniform scale when the static height is auto).
      const sxFromWidth = base.width !== null && animated.width > 0 ? animated.width / base.width : null;
      const syFromHeight = base.height !== null && animated.height > 0 ? animated.height / base.height : null;
      const sxKnown = sxFromWidth !== null && Number.isFinite(sxFromWidth) && sxFromWidth > 0;
      const syKnown = syFromHeight !== null && Number.isFinite(syFromHeight) && syFromHeight > 0;
      const sx = sxKnown ? sxFromWidth : null;
      const sy = syKnown ? syFromHeight : sx;
      if (widthSide && (sx === null || sx <= 0)) return { ok: false, code: 'E_LAYOUT_SCALE', detail: 'current width scale is unknown' };
      if (heightSide && (sy === null || sy <= 0)) return { ok: false, code: 'E_LAYOUT_SCALE', detail: 'current height scale is unknown' };
      const patch = {};
      // East/south edges keep the static left/top, so the composition bound for
      // the new extent is the remaining space after that static origin.
      const widthCeiling = widthSide && mode.includes('w') === false && base.left !== null ? Math.max(1, composition.width - base.left) : composition.width;
      const heightCeiling = heightSide && mode.includes('n') === false && base.top !== null ? Math.max(1, composition.height - base.top) : composition.height;
      if (widthSide) patch.width = canvasRoundNumber(canvasClampNumber(preview.width / sx, 1, widthCeiling));
      if (heightSide) patch.height = canvasRoundNumber(canvasClampNumber(preview.height / sy, 1, heightCeiling));
      if (mode.includes('w')) {
        if (base.left === null) return { ok: false, code: 'E_LAYOUT_BASE', detail: 'static left is unknown' };
        const left = canvasClampNumber(base.left + dx / sx, 0, composition.width - 1);
        patch.left = canvasRoundNumber(left);
        if (widthSide) patch.width = canvasRoundNumber(canvasClampNumber(preview.width / sx, 1, Math.max(1, composition.width - left)));
      }
      if (mode.includes('n')) {
        if (base.top === null) return { ok: false, code: 'E_LAYOUT_BASE', detail: 'static top is unknown' };
        const top = canvasClampNumber(base.top + dy / sy, 0, composition.height - 1);
        patch.top = canvasRoundNumber(top);
        if (heightSide) patch.height = canvasRoundNumber(canvasClampNumber(preview.height / sy, 1, Math.max(1, composition.height - top)));
      }
      return { ok: true, patch: patch };
    }

    /**
     * Validate and copy the frozen P3-009 `scene.template` from one authoritative
     * inspect result. The returned object is exactly the full replacement input
     * for scene.update: every supported field is preserved, sceneId and unknown
     * keys are not copied, and an absent/invalid template is refused instead of
     * guessed from UI defaults.
     */
    function canvasCopySceneTemplate(template) {
      if (canvasPlainObject(template) === false) return { ok: false, detail: 'scene template is absent' };
      for (const key of Object.keys(template)) {
        if (key === 'sceneId') continue;
        if (CANVAS_SCENE_TEMPLATE_KEYS.includes(key) === false) return { ok: false, detail: 'unknown scene template field ' + key };
      }
      const titleLength = canvasTextLength(template.title);
      if (titleLength < 1 || titleLength > CANVAS_SCENE_TEXT_MAX) {
        return { ok: false, detail: 'scene title is invalid' };
      }
      if (canvasFiniteNumber(template.duration) === false || template.duration < 0.5 || template.duration > 60) {
        return { ok: false, detail: 'scene duration is invalid' };
      }
      const copy = { title: template.title, duration: template.duration };
      if (template.subtitle !== undefined) {
        const subtitleLength = canvasTextLength(template.subtitle);
        if (subtitleLength < 0 || subtitleLength > CANVAS_SCENE_TEXT_MAX) return { ok: false, detail: 'scene subtitle is invalid' };
        copy.subtitle = template.subtitle;
      }
      if (template.badge !== undefined) {
        const badgeLength = canvasTextLength(template.badge);
        if (badgeLength < 0 || badgeLength > CANVAS_SCENE_TEXT_MAX) return { ok: false, detail: 'scene badge is invalid' };
        copy.badge = template.badge;
      }
      for (const key of ['color', 'accent']) {
        if (template[key] === undefined) continue;
        if (typeof template[key] !== 'string' || CANVAS_SCENE_COLOR.test(template[key]) === false) return { ok: false, detail: 'scene ' + key + ' is invalid' };
        copy[key] = template[key];
      }
      for (const key of ['logo', 'shot']) {
        if (template[key] === undefined) continue;
        if (typeof template[key] !== 'string' || CANVAS_SCENE_ASSET.test(template[key]) === false) return { ok: false, detail: 'scene ' + key + ' is invalid' };
        copy[key] = template[key];
      }
      return { ok: true, template: copy };
    }

    /**
     * Copy the complete template for one Scene from one authoritative inspect
     * result, together with that inspect's revision (the expectedRevision for the
     * immediately following scene.update).
     */
    function canvasSceneTemplate(inspected, sceneId) {
      if (canvasPlainObject(inspected) === false) return { ok: false, code: 'E_SCENE_TEMPLATE', detail: 'inspect result is unavailable' };
      if (typeof inspected.revision !== 'string' || CANVAS_REVISION.test(inspected.revision) === false) {
        return { ok: false, code: 'E_SCENE_TEMPLATE', detail: 'authoritative revision is unavailable' };
      }
      if (Array.isArray(inspected.scenes) === false) return { ok: false, code: 'E_SCENE_TEMPLATE', detail: 'scenes are unavailable' };
      const scene = inspected.scenes.find(function findScene(candidate) {
        return canvasPlainObject(candidate) && candidate.sceneId === sceneId;
      });
      if (scene === undefined) return { ok: false, code: 'E_SCENE_NOT_FOUND', detail: 'scene is no longer present' };
      const copied = canvasCopySceneTemplate(scene.template);
      if (copied.ok === false) return { ok: false, code: 'E_SCENE_TEMPLATE', detail: copied.detail };
      return { ok: true, revision: inspected.revision, sceneId: sceneId, template: copied.template };
    }

    function canvasNormalizedColor(value) {
      return typeof value === 'string' && CANVAS_SCENE_COLOR.test(value) ? value.toLowerCase() : null;
    }

    function canvasNormalizedAssetPath(value) {
      return typeof value === 'string' && CANVAS_SCENE_ASSET.test(value) ? value : null;
    }

    function canvasIsRevisionConflict(error) {
      return canvasPlainObject(error) && error.code === 'E_REVISION_CONFLICT';
    }

    //#endregion

    //#region components
    function StyleTag() {
      return h('style', {
        'data-dsh-video': 'styles',
        dangerouslySetInnerHTML: { __html: CSS },
      });
    }

    /** Local slot component: the embedded occurrence shows only the Chat view. */
    function SessionChatView(props) {
      if (props === null || typeof props !== 'object' || typeof props.renderSlot !== 'function') return null;
      return props.renderSlot('conversation.session', { view: 'chat' });
    }

    /**
     * Render the native Conversation content Factory for the bound Session.
     * `hero:false` is mandatory: the hero workspace chip navigates the host's
     * main conversation. `widthControls` is intentionally omitted so the
     * embedded occurrence has no resize handles.
     */
    function SessionConversationContent(props) {
      if (typeof props.renderFactorySlot !== 'function') return null;
      return h('div', { className: 'dv-conversation' }, props.renderFactorySlot(
        'conversation.content',
        { variant: 'embedded', phase: props.phase === 'active' ? 'active' : 'settling', hero: false },
        { slots: { views: SessionChatView } }
      ));
    }

    /** Observe a sessions.list source without requiring the host kit. */
    function useSessionListSnapshot(sessions) {
      let source = null;
      try {
        source = sessions && sessions.list ? sessions.list : null;
      } catch (_error) {
        source = null;
      }
      if (source === null || typeof source.getSnapshot !== 'function') return null;
      const subscribe = typeof source.subscribe === 'function'
        ? function subscribeSessionList(listener) { return source.subscribe(listener); }
        : function subscribeNothing() { return function unsubscribeNothing() {}; };
      const getSnapshot = function getSessionListSnapshot() { return source.getSnapshot(); };
      try {
        return React.useSyncExternalStore(subscribe, getSnapshot);
      } catch (_error) {
        try {
          return source.getSnapshot();
        } catch (_ignored) {
          return null;
        }
      }
    }

    /** Host-list title projection for one mapped Session, with a stable fallback. */
    function sessionTitleFromSnapshot(snapshot, sessionId) {
      try {
        const record = snapshot && snapshot.projectionsBySession ? snapshot.projectionsBySession[sessionId] : null;
        const title = record && record.values && typeof record.values.title === 'string' ? record.values.title : '';
        if (title.length > 0) return title;
      } catch (_error) {
        /* fall through to the identity */
      }
      return sessionId;
    }

    /**
     * One owned SessionReference and the native Conversation occurrence.
     *
     * Acquisition and release are deliberately split from the parent panel:
     * changing `sessionId` re-keys this component, so React unmounts (and the
     * cleanup releases) the old reference before the new one is created. No
     * Provider is ever rendered with a released reference.
     */
    function SessionConversationHost(props) {
      const t = props.t;
      const sessions = props.sessions;
      const sessionId = props.sessionId;
      const SessionProvider = props.SessionProvider;
      const renderFactorySlot = props.renderFactorySlot;
      const hostConversationOpen = props.hostConversationOpen === true;
      const onRetry = props.onRetry;
      const [reference, setReference] = React.useState(null);
      const [phase, setPhase] = React.useState('loading');
      const [failure, setFailure] = React.useState(null);

      React.useEffect(function acquireSession() {
        let cancelled = false;
        let handle = null;
        let unsubscribe = null;
        setReference(null);
        setFailure(null);
        setPhase('loading');
        if (sessions === null || typeof sessions.retain !== 'function') {
          setFailure({ code: 'E_SESSION_UNAVAILABLE', message: t('video.ai.unavailable') });
          return function cleanupUnavailable() {};
        }
        try {
          handle = sessions.retain(sessionId, { source: SESSION_SOURCE });
        } catch (error) {
          setFailure(hostError(error));
          return function cleanupFailed() {};
        }
        setReference(handle);
        function readSnapshot() {
          if (cancelled || handle === null) return;
          let binding = null;
          try {
            binding = handle.binding !== undefined && handle.binding !== null ? handle.binding : null;
          } catch (_error) {
            binding = null;
          }
          const face = binding !== null && binding.session ? binding.session : null;
          if (face === null) return;
          let snapshot = null;
          try {
            snapshot = typeof face.getSnapshot === 'function' ? face.getSnapshot() : null;
          } catch (_error) {
            snapshot = null;
          }
          if (snapshot === null || typeof snapshot !== 'object') return;
          if (snapshot.openState === 'error') {
            setPhase('error');
            setFailure({ code: 'E_SESSION_OPEN', message: '' });
            return;
          }
          if (snapshot.openState === 'open') setPhase('active');
          else setPhase('settling');
        }
        Promise.resolve(handle.ready).then(function sessionReady(binding) {
          if (cancelled) return;
          const face = binding !== null && binding !== undefined && binding.session ? binding.session : null;
          if (face !== null && typeof face.subscribe === 'function') {
            try {
              unsubscribe = face.subscribe(readSnapshot);
            } catch (_error) {
              unsubscribe = null;
            }
          }
          readSnapshot();
        }).catch(function sessionFailed(error) {
          if (cancelled) return;
          setFailure(hostError(error));
          setPhase('error');
        });
        return function cleanupSession() {
          cancelled = true;
          if (typeof unsubscribe === 'function') {
            try {
              unsubscribe();
            } catch (_error) {
              /* observed source cleanup is best effort */
            }
          }
          if (handle !== null) {
            try {
              handle.release();
            } catch (_error) {
              /* release is idempotent at the controller boundary */
            }
          }
        };
      }, [sessionId]);

      if (hostConversationOpen) {
        return h('p', { className: 'dv-ai-notice', role: 'status' }, t('video.ai.hostOpen'));
      }
      if (failure !== null) {
        return h(
          'div',
          { className: 'dv-ai-error', role: 'alert' },
          h('p', { className: 'dv-error' }, errorText(failure, t)),
          typeof onRetry === 'function'
            ? h('button', { type: 'button', className: 'dv-button dv-button-quiet', onClick: onRetry }, t('video.ai.retry'))
            : null
        );
      }
      if (reference === null) {
        return h('p', { className: 'dv-ai-loading', role: 'status' }, t('video.ai.loading'));
      }
      if (typeof SessionProvider !== 'function' || typeof renderFactorySlot !== 'function') {
        return h('p', { className: 'dv-ai-error', role: 'alert' }, t('video.ai.unavailable'));
      }
      return h(
        SessionProvider,
        { session: reference },
        h(SessionConversationContent, { renderFactorySlot: renderFactorySlot, phase: phase })
      );
    }

    //#region P3-008 canvas workspace
    // The canvas is a sandboxed snapshot document plus a fixed Host-injected
    // runtime. This component owns only the editor layer: letterbox mapping,
    // selection, inline text, drag/resize commits, playback control and the
    // material drawer. Project/revision truth stays in the Host worker.
    function canvasInstanceId() {
      const random = Math.random().toString(36).slice(2, 10);
      return ('dvcanvas-' + random).padEnd(12, '0').slice(0, 32);
    }

    function canvasNonce() {
      const values = new Uint8Array(16);
      try {
        if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
          globalThis.crypto.getRandomValues(values);
        } else {
          for (let index = 0; index < values.length; index += 1) values[index] = Math.floor(Math.random() * 256);
        }
      } catch (_error) {
        for (let index = 0; index < values.length; index += 1) values[index] = Math.floor(Math.random() * 256);
      }
      return Array.prototype.map.call(values, function hex(value) {
        return value.toString(16).padStart(2, '0');
      }).join('');
    }

    function canvasNumber(value, fallback) {
      return Number.isFinite(Number(value)) ? Number(value) : fallback;
    }

    function MediaLibraryPanel(props) {
      const t = props.t,
        projectId = props.projectId;
      const [assets, setAssets] = React.useState([]),
        [kind, setKind] = React.useState(''),
        [query, setQuery] = React.useState('');
      const [cursor, setCursor] = React.useState(null),
        [selected, setSelected] = React.useState(null),
        [error, setError] = React.useState(null);
      const [loading, setLoading] = React.useState(false),
        [upload, setUpload] = React.useState(null),
        [confirmRemove, setConfirmRemove] = React.useState(false);
      const [cacheVersion, setCacheVersion] = React.useState(0),
        [deriveBusy, setDeriveBusy] = React.useState(false);
      const [derivedReady, setDerivedReady] = React.useState({});
      const deriveSeen = React.useRef({});
      const [proxyReady, setProxyReady] = React.useState({});
      const requestSerial = React.useRef(0),
        uploadRef = React.useRef(null),
        alive = React.useRef(true);
      function mediaUrl(asset, derived) {
        return (
          'api/dsh-video/' +
          (derived ? 'derived' : 'media') +
          '?projectId=' +
          encodeURIComponent(projectId) +
          '&assetId=' +
          encodeURIComponent(asset.assetId) +
          (derived ? '&kind=' + derived : '')
        );
      }
      async function load(nextCursor) {
        const serial = ++requestSerial.current;
        setLoading(true);
        setError(null);
        try {
          const page = await hostRequest('asset.list', {
            projectId: projectId,
            limit: 30,
            ...(kind ? { kind: kind } : {}),
            ...(query.trim() ? { query: query.trim() } : {}),
            ...(nextCursor ? { cursor: nextCursor } : {}),
          });
          if (!alive.current || serial !== requestSerial.current) return;
          setAssets((previous) => (nextCursor ? previous.concat(page.assets) : page.assets));
          setCursor(page.nextCursor);
        } catch (e) {
          if (alive.current && serial === requestSerial.current) setError(hostError(e));
        } finally {
          if (alive.current && serial === requestSerial.current) setLoading(false);
        }
      }
      React.useEffect(
        function mediaLoad() {
          alive.current = true;
          setSelected(null);
          const timer = setTimeout(() => {
            void load(null);
          }, 150);
          return () => {
            clearTimeout(timer);
            requestSerial.current++;
          };
        },
        [projectId, kind, query],
      );
      React.useEffect(
        function mediaDerivatives() {
          let cancelled = false;
          void (async () => {
            for (const asset of assets) {
              if (cancelled || deriveSeen.current[asset.assetId]) continue;
              deriveSeen.current[asset.assetId] = true;
              try {
                await hostRequest('asset.derive', {
                  projectId: projectId,
                  assetId: asset.assetId,
                  kind: asset.kind === 'audio' ? 'waveform' : 'thumb',
                });
                if (alive.current) setDerivedReady((previous) => ({ ...previous, [asset.assetId]: true }));
              } catch (e) {
                delete deriveSeen.current[asset.assetId];
              }
            }
          })();
          return () => {
            cancelled = true;
          };
        },
        [assets, projectId],
      );
      React.useEffect(function mediaCleanup() {
        return () => {
          alive.current = false;
          requestSerial.current++;
          if (uploadRef.current) uploadRef.current.abort();
        };
      }, []);
      async function derive(asset) {
        setDeriveBusy(true);
        setError(null);
        try {
          await hostRequest('asset.derive', {
            projectId: projectId,
            assetId: asset.assetId,
            kind: asset.kind === 'audio' ? 'waveform' : 'thumb',
          });
          if (alive.current) {
            setCacheVersion((v) => v + 1);
            setDerivedReady((previous) => ({ ...previous, [asset.assetId]: true }));
          }
        } catch (e) {
          if (alive.current) setError(hostError(e));
        } finally {
          if (alive.current) setDeriveBusy(false);
        }
      }
      async function compatibilityPreview(asset) {
        setDeriveBusy(true);
        setError(null);
        try {
          await hostRequest('asset.derive', { projectId: projectId, assetId: asset.assetId, kind: 'proxy' });
          if (alive.current) setProxyReady((previous) => ({ ...previous, [asset.assetId]: true }));
        } catch (e) {
          if (alive.current) setError(hostError(e));
        } finally {
          if (alive.current) setDeriveBusy(false);
        }
      }
      function choose(asset) {
        setSelected(asset);
        setConfirmRemove(false);
        void derive(asset);
      }
      async function removeSelected() {
        if (!selected) return;
        setError(null);
        try {
          await hostRequest('asset.remove', {
            projectId: projectId,
            assetId: selected.assetId,
            operationId: operationId(),
          });
          if (alive.current) {
            setSelected(null);
            setConfirmRemove(false);
            await load(null);
          }
        } catch (e) {
          if (alive.current) setError(hostError(e));
        }
      }
      async function importFiles(files) {
        if (uploadRef.current || !files || !files.length) return;
        setError(null);
        try {
          for (const file of Array.from(files)) {
            if (!alive.current) break;
            const receipt = await new Promise((yes, no) => {
              const xhr = new XMLHttpRequest();
              uploadRef.current = xhr;
              xhr.open('POST', 'api/dsh-video/asset-upload');
              xhr.withCredentials = true;
              xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
              xhr.setRequestHeader('x-dsh-project-id', projectId);
              xhr.setRequestHeader('x-dsh-file-name', encodeURIComponent(file.name));
              setUpload({ name: file.name, percent: 0, processing: false });
              xhr.upload.onprogress = (e) => {
                if (alive.current && e.lengthComputable)
                  setUpload({ name: file.name, percent: Math.round((e.loaded / e.total) * 100), processing: false });
              };
              xhr.onerror = () => no({ code: 'E_ASSET_UPLOAD', message: t('video.media.failed') });
              xhr.onabort = () => no({ code: 'E_CANCELLED', message: t('video.media.cancelled') });
              xhr.onload = () => {
                try {
                  const value = JSON.parse(xhr.responseText);
                  xhr.status >= 200 && xhr.status < 300 ? yes(value) : no(value.error || value);
                } catch (e) {
                  no(e);
                }
              };
              xhr.send(file);
            });
            uploadRef.current = null;
            if (!alive.current) break;
            setUpload({ name: file.name, percent: 100, processing: true });
            await hostRequest('asset.importMedia', {
              projectId: projectId,
              receiptId: receipt.receiptId,
              operationId: operationId(),
            });
            if (alive.current) await load(null);
          }
        } catch (e) {
          if (alive.current) setError(hostError(e));
        } finally {
          uploadRef.current = null;
          if (alive.current) setUpload(null);
        }
      }
      const busy = upload !== null;
      return h(
        'aside',
        {
          className: 'dv-drawer dv-media-library',
          'aria-label': t('video.canvas.materials'),
          onDragOver: (e) => {
            e.preventDefault();
          },
          onDrop: (e) => {
            e.preventDefault();
            if (!busy) void importFiles(e.dataTransfer.files);
          },
        },
        h(
          'div',
          { className: 'dv-drawer-head' },
          h('strong', null, t('video.canvas.materials')),
          h(
            'button',
            { type: 'button', className: 'dv-icon-button', onClick: props.onClose, 'aria-label': t('video.canvas.close') },
            '×',
          ),
        ),
        h(
          'label',
          { className: 'dv-upload' },
          t('video.media.import'),
          h('input', {
            type: 'file',
            multiple: true,
            accept: '.mp4,.mov,.m4v,.webm,.mp3,.wav,.m4a,.aac,.flac,.png,.jpg,.jpeg',
            disabled: busy,
            onChange: (e) => {
              void importFiles(e.target.files);
              e.target.value = '';
            },
          }),
        ),
        h('input', {
          type: 'search',
          className: 'dv-media-search',
          value: query,
          maxLength: 120,
          placeholder: t('video.media.search'),
          'aria-label': t('video.media.search'),
          onChange: (e) => setQuery(e.target.value),
        }),
        h(
          'div',
          { className: 'dv-media-filters', role: 'group', 'aria-label': t('video.media.filter') },
          ['', 'video', 'image', 'audio'].map((k) =>
            h(
              'button',
              {
                key: k,
                type: 'button',
                className: 'dv-button dv-button-quiet',
                'aria-pressed': kind === k ? 'true' : 'false',
                onClick: () => setKind(k),
              },
              t('video.media.' + (k || 'all')),
            ),
          ),
        ),
        busy
          ? h(
              'div',
              { role: 'status', className: 'dv-media-progress' },
              h('span', null, upload.name),
              h('progress', { max: 100, value: upload.processing ? undefined : upload.percent }),
              h('span', null, upload.processing ? t('video.media.processing') : upload.percent + '%'),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dv-button dv-button-quiet',
                  disabled: upload.processing,
                  onClick: () => uploadRef.current?.abort(),
                },
                t('video.media.cancel'),
              ),
            )
          : null,
        error
          ? h(
              'div',
              { role: 'alert', className: 'dv-tool-error' },
              errorText(error, t),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dv-button dv-button-quiet',
                  onClick: () => {
                    void load(null);
                  },
                },
                t('video.media.retry'),
              ),
            )
          : null,
        loading && assets.length === 0
          ? h('p', { className: 'dv-tool-hint', role: 'status' }, t('video.media.loading'))
          : null,
        !loading && assets.length === 0 ? h('p', { className: 'dv-tool-hint' }, t('video.media.empty')) : null,
        h(
          'div',
          { className: 'dv-media-grid' },
          assets.map((asset) =>
            h(
              'button',
              {
                key: asset.assetId,
                type: 'button',
                draggable:true,onDragStart:e=>e.dataTransfer.setData('application/x-dsh-asset',asset.assetId),className: 'dv-media-tile',
                'aria-pressed': selected?.assetId === asset.assetId ? 'true' : 'false',
                onClick: () => choose(asset),
              },
              derivedReady[asset.assetId]
                ? h('img', {
                    src: mediaUrl(asset, asset.kind === 'audio' ? 'waveform' : 'thumb'),
                    alt: '',
                    loading: 'lazy',
                  })
                : h(
                    'span',
                    { className: 'dv-media-placeholder', 'aria-hidden': 'true' },
                    asset.kind === 'video' ? '▷' : '♪',
                  ),
              h('span', { className: 'dv-media-name', title: asset.name }, asset.name),
              h(
                'small',
                null,
                asset.kind === 'image'
                  ? (asset.media?.width || '—') + ' × ' + (asset.media?.height || '—')
                  : formatSeconds(asset.media?.durationSec || 0),
              ),
            ),
          ),
        ),
        cursor
          ? h(
              'button',
              {
                type: 'button',
                className: 'dv-button dv-button-quiet',
                disabled: loading,
                onClick: () => {
                  void load(cursor);
                },
              },
              t('video.media.more'),
            )
          : null,
        selected
          ? h(
              'section',
              { className: 'dv-media-detail', key: selected.assetId },
              h('strong', null, selected.name),
              props.onAdd?h('button',{className:'dv-button dv-button-primary',onClick:()=>props.onAdd(selected)},t('video.timeline.add')):null,
              selected.kind === 'image'
                ? h('img', { className: 'dv-media-preview', src: mediaUrl(selected), alt: selected.name })
                : h(selected.kind === 'audio' ? 'audio' : 'video', {
                    className: 'dv-media-preview',
                    src: mediaUrl(selected, proxyReady[selected.assetId] ? 'proxy' : undefined),
                    controls: true,
                    preload: 'metadata',
                  }),
              h('img', {
                className: 'dv-media-derived',
                key: cacheVersion,
                src: mediaUrl(selected, selected.kind === 'audio' ? 'waveform' : 'thumb') + '#v=' + cacheVersion,
                alt: t('video.media.' + (selected.kind === 'audio' ? 'waveform' : 'thumbnail')),
                onError: (e) => {
                  e.target.style.visibility = 'hidden';
                },
                onLoad: (e) => {
                  e.target.style.visibility = 'visible';
                },
              }),
              h(
                'p',
                null,
                Math.round(selected.bytes / 1024) +
                  ' KiB · ' +
                  (selected.media?.width ? selected.media.width + ' × ' + selected.media.height + ' · ' : '') +
                  (selected.kind === 'image' ? '' : formatSeconds(selected.media?.durationSec || 0)),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dv-button dv-button-quiet',
                  disabled: deriveBusy,
                  onClick: () => {
                    void derive(selected);
                  },
                },
                t(deriveBusy ? 'video.media.processing' : 'video.media.rebuild'),
              ),
              selected.kind !== 'image'
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dv-button dv-button-quiet',
                      disabled: deriveBusy,
                      onClick: () => {
                        void compatibilityPreview(selected);
                      },
                    },
                    t('video.media.compatibility'),
                  )
                : null,
              h(
                'label',
                { className: 'dv-media-reference' },
                t('video.media.reference'),
                h('input', {
                  readOnly: true,
                  value: '@asset:' + selected.assetId,
                  onFocus: (e) => e.target.select(),
                  'aria-label': t('video.media.reference'),
                }),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dv-button dv-button-quiet',
                  onClick: () => {
                    if (confirmRemove) void removeSelected();
                    else setConfirmRemove(true);
                  },
                },
                t(confirmRemove ? 'video.media.confirmRemove' : 'video.media.remove'),
              ),
              confirmRemove
                ? h(
                    'button',
                    { type: 'button', className: 'dv-button dv-button-quiet', onClick: () => setConfirmRemove(false) },
                    t('video.media.cancel'),
                  )
                : null,
            )
          : null,
      );
    }

    function AudioPanel(props) {
      const t=props.t,h=React.createElement;
      const [settings,setSettings]=React.useState(null),[kind,setKind]=React.useState('tts'),[provider,setProvider]=React.useState('qianwen'),[text,setText]=React.useState(''),[key,setKey]=React.useState(''),[voice,setVoice]=React.useState('longanhuan_v3.1'),[job,setJob]=React.useState(null),[jobs,setJobs]=React.useState([]),[notice,setNotice]=React.useState(''),[busy,setBusy]=React.useState(false);
      const alive=React.useRef(true);
      React.useEffect(()=>{alive.current=true;void Promise.all([hostRequest('audio.settings',{}),hostRequest('audio.status',{projectId:props.projectId})]).then(([a,b])=>{if(alive.current){setSettings(a);setJobs(b.jobs);setJob(b.jobs.find(j=>['queued','running','downloading'].includes(j.state))||null);}}).catch(e=>{if(alive.current)setNotice(errorText(hostError(e),t));});return()=>{alive.current=false;};},[props.projectId]);
      React.useEffect(()=>{if(!job||!['queued','running','downloading','cancelling'].includes(job.state))return;let stopped=false;const timer=setInterval(()=>{void hostRequest('audio.status',{projectId:props.projectId,jobId:job.jobId}).then(j=>{if(!stopped){setJob(j);if(j.state==='succeeded')setNotice(t('video.audio.ready'));if(j.state==='failed')void hostRequest('audio.settings',{}).then(v=>{if(!stopped)setSettings(v);});}}).catch(e=>{if(!stopped)setNotice(errorText(hostError(e),t));});},800);return()=>{stopped=true;clearInterval(timer);};},[job?.jobId,job?.state]);
      async function perform(method,params){setBusy(true);setNotice('');try{const r=await hostRequest(method,params);if(!alive.current)return;if(method==='audio.generate'||method==='audio.cancel')setJob(r);else if(method==='audio.configure'){setSettings(r);setKey('');setNotice(t('video.audio.configured'));}else {if(r.providers)setSettings(r);setNotice(r.note||t('video.audio.configured'));}}catch(e){if(alive.current)setNotice(errorText(hostError(e),t));}finally{if(alive.current)setBusy(false);}}
      const generating=job&&['queued','running','downloading','cancelling'].includes(job.state);
      const jobView=j=>h('div',{className:'dv-audio-job',key:j.jobId},h('span',null,t('video.audio.'+j.kind)+' · '+t('video.audio.'+j.state)),j.error?h('p',{role:'alert'},j.error.message):null,j.asset?h('button',{className:'dv-button dv-button-quiet',onClick:()=>props.onAdd(j.asset)},t('video.audio.add')):null);
      return h('aside',{className:'dv-drawer dv-audio-panel',role:'dialog','aria-label':t('video.audio.title'),onKeyDown:e=>{if(e.key==='Escape')props.onClose();}},
        h('div',{className:'dv-drawer-head'},h('strong',null,t('video.audio.title')),h('button',{className:'dv-icon-button','aria-label':t('video.canvas.close'),onClick:props.onClose},'×')),
        h('div',{className:'dv-audio-tabs'},['tts','music','sfx'].map(x=>h('button',{key:x,className:kind===x?'is-active':'','aria-pressed':kind===x,onClick:()=>{setKind(x);if(x!=='tts')setProvider('qianwen');}},t('video.audio.'+x)))),
        h('label',{className:'dv-audio-field'},t('video.audio.provider'),h('select',{value:provider,onChange:e=>{setProvider(e.target.value);setVoice(e.target.value==='local'?'Tingting':'longanhuan_v3.1');}},h('option',{value:'qianwen'},t('video.audio.qianwen')),kind==='tts'?h('option',{value:'local'},t('video.audio.local')):null)),
        kind==='tts'?h('label',{className:'dv-audio-field'},t('video.audio.voice'),h('select',{value:voice,onChange:e=>setVoice(e.target.value)},(provider==='local'?[['Tingting','Tingting · 普通话'],['Meijia','Meijia · 台湾'],['Sinji','Sinji · 粤语']]:[['longanhuan_v3.1','安欢 · 女声'],['xunanchuan_v3.1','南川 · 男声'],['longanlingxin_v3.1','灵心 · 女声']]).map(([v,n])=>h('option',{key:v,value:v},n)))):null,
        h('textarea',{value:text,maxLength:2000,rows:6,placeholder:t('video.audio.text'),'aria-label':t('video.audio.text'),onChange:e=>setText(e.target.value)}),
        kind==='music'?h('p',{className:'dv-audio-note'},t('video.audio.invitation')):null,
        h('p',{className:'dv-audio-note'},(provider==='local'?t('video.audio.local'):t('video.audio.billing'))+' · '+text.length+'/2000'),
        h('button',{className:'dv-button dv-button-primary',disabled:busy||generating||!text.trim()||(provider==='local'&&kind!=='tts')||(provider==='qianwen'&&kind==='music'&&settings?.providers?.find(p=>p.id==='qianwen')?.capabilities.music===false),onClick:()=>perform('audio.generate',{projectId:props.projectId,operationId:operationId(),provider,kind,text,voice:kind==='tts'?voice:undefined})},t('video.audio.generate')),
        generating?h('button',{className:'dv-button dv-button-quiet',disabled:busy,onClick:()=>perform('audio.cancel',{projectId:props.projectId,jobId:job.jobId})},t('video.audio.cancel')):null,
        job?jobView(job):null,h('div',{className:'dv-audio-note',role:'status'},notice),
        h('details',{className:'dv-audio-settings'},h('summary',null,t('video.audio.settings')),h('p',null,t('video.audio.'+(settings?.configured?'configured':'missing'))),h('input',{type:'password',autoComplete:'off',value:key,placeholder:t('video.audio.key'),'aria-label':t('video.audio.key'),onChange:e=>setKey(e.target.value)}),h('div',{className:'dv-audio-actions'},h('button',{className:'dv-button dv-button-quiet',disabled:busy,onClick:()=>perform('audio.configure',{apiKey:key})},t('video.audio.save')),h('button',{className:'dv-button dv-button-quiet',disabled:busy,onClick:()=>perform('audio.check',{})},t('video.audio.check')))),
        jobs.filter(j=>j.jobId!==job?.jobId).slice(0,5).map(jobView));
    }

    function TimelinePanel(props) {
      const h = React.createElement,
        t = props.t;
      const [data, setData] = React.useState(null),
        [selected, setSelected] = React.useState(null),
        [busy, setBusy] = React.useState(false),
        [notice, setNotice] = React.useState(""),
        [zoom, setZoom] = React.useState(36),
        [compact, setCompact] = React.useState(false),
        [waveVersion,setWaveVersion]=React.useState(0),
        [levelDrafts,setLevelDrafts]=React.useState({}),
        [snap, setSnap] = React.useState(true),
        [drag, setDrag] = React.useState(null);
      const waves=React.useRef(new Set());
      const alive = React.useRef(true),
        current = React.useRef(null),
        viewport = React.useRef(null),laneRefs=React.useRef(new Map()),gestureMoved=React.useRef(false);
      React.useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
        };
      }, []);
      async function load() {
        let page = await hostRequest("timeline.inspect", {
          projectId: props.projectId,
          limit: 100,
        });
        const loadRevision=page.revision;
        let tracks = page.tracks;
        while (page.nextOffset !== null) {
          page = await hostRequest("timeline.inspect", {
            projectId: props.projectId,
            offset: page.nextOffset,
            limit: 100,
          });
          if(page.revision!==loadRevision)throw {code:'E_REVISION_CONFLICT',message:'作品已更新，请刷新时间线'};
          tracks = tracks.map((tr) => ({
            ...tr,
            clips: [
              ...tr.clips,
              ...(page.tracks.find((x) => x.trackId === tr.trackId)?.clips || []),
            ],
          }));
        }
        const next = { ...page, tracks };
        if (alive.current) {
          current.current = next;
          setData(next);
        }
        return next;
      }
      React.useEffect(() => {
        let stop = false;
        (async () => {
          try {
            await load();
            if (!stop) await props.onReload();
          } catch (e) {
            if (!stop) setNotice(errorText(hostError(e), t));
          }
        })();
        return () => {
          stop = true;
        };
      }, [props.projectId]);
      React.useEffect(() => {
        if (current.current && props.revision !== current.current.revision)
          void load().catch((e) => setNotice(errorText(hostError(e), t)));
      }, [props.revision]);
      async function write(ops, action) {
        if (busy || !current.current) return;
        setBusy(true);
        setNotice("");
        try {
          const result = await hostRequest(action || "timeline.apply", {
            projectId: props.projectId,
            expectedRevision: current.current.revision,
            operationId: operationId(),
            ...(ops ? { ops } : {}),
          });
          if (!alive.current) return;
          setNotice(
            result.changeSummary?.summary || t("video.timeline.saved"),
          );
          await load();
          await props.onReload();
          return result;
        } catch (e) {
          if (alive.current) {
            setNotice(errorText(hostError(e), t));
            if (hostError(e).code === "E_REVISION_CONFLICT") {
              await load();
              await props.onReload();
            }
          }
        } finally {
          if (alive.current) setBusy(false);
        }
      }
      React.useEffect(() => {
        if (props.assetToAdd && data && !busy) {
          const a = props.assetToAdd;
          props.onAssetConsumed();
          const tr = data.tracks.find((x) => x.kind === (a.kind === 'audio' ? 'audio' : 'video') && !x.locked);
          if (!tr) {
            if(a.kind==='audio'&&data.tracks.filter(x=>x.kind==='audio').length<3){void (async()=>{const result=await write([{op:'track.add',kind:'audio',name:t('video.audio.tts')}]);if(result)props.onQueueAsset?.(a);})();}
            else setNotice(t("video.timeline.needTrack"));
            return;
          }
          const start = Math.max(
            0,
            ...tr.clips.map((c) => c.startFrame + c.durationFrames),
          );
          void write([
            {
              op: "clip.insert",
              assetId: a.assetId,
              trackId: tr.trackId,
              startFrame: start,
              ...(a.kind === "image" ? { durationFrames: 150 } : {}),
              mode: "ripple",
            },
          ]);
        }
      }, [props.assetToAdd, data, busy]);
      React.useEffect(()=>{setLevelDrafts({});},[data?.revision]);
      React.useEffect(()=>{for(const a of data?.assets??[]){if(a.kind!=='audio'||waves.current.has(a.assetId))continue;waves.current.add(a.assetId);void hostRequest('asset.derive',{projectId:props.projectId,assetId:a.assetId,kind:'waveform'}).then(()=>{if(alive.current)setWaveVersion(v=>v+1);}).catch(()=>{waves.current.delete(a.assetId);});}},[data?.revision]);
      if (!data)
        return h(
          "section",
          { className: "dv-timeline", role: "status" },
          t("video.timeline.loading"),
        );
      const clips = data.tracks.flatMap((tr) =>
          tr.clips.map((c) => ({ ...c, trackId: tr.trackId })),
        ),
        chosen = clips.find((c) => c.clipId === selected),
        frame = Math.round(props.time * 30),
        duration = data.settings.durationFrames,
        width = Math.max(520, (duration / 30) * zoom + 60);
      function nearest(raw, except) {
        let value = Math.max(0, Math.round(raw));
        if (!snap) return value;
        const points = [
          0,
          frame,
          ...clips
            .filter((c) => c.clipId !== except)
            .flatMap((c) => [c.startFrame, c.startFrame + c.durationFrames]),
        ];
        const at = points.find((x) => Math.abs(x - value) <= 180 / zoom);
        return at ?? value;
      }
      function cut() {
        if (
          chosen &&
          frame > chosen.startFrame &&
          frame < chosen.startFrame + chosen.durationFrames
        )
          void write([{ op: "clip.split", clipId: chosen.clipId, atFrame: frame }]);
        else setNotice(t("video.timeline.cutHint"));
      }
      function moveOrder(delta) {
        if (!chosen) return;
        const tr = data.tracks.find((tr) => tr.trackId === chosen.trackId),
          ids = tr.clips.map((c) => c.clipId),
          i = ids.indexOf(chosen.clipId),
          j = i + delta;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        void write([{ op: "clip.reorder", trackId: tr.trackId, clipIds: ids }]);
      }
      function pointerDown(e, c, edge) {
        if (busy) return;
        e.preventDefault();
        e.stopPropagation();
        setSelected(c.clipId);
        e.currentTarget.setPointerCapture(e.pointerId);
        gestureMoved.current=false;setDrag({ clipId: c.clipId, x: e.clientX,y:e.clientY, edge, delta: 0 });
      }
      function pointerMove(e) {
        if (!drag) return;
        setDrag({ ...drag, delta: Math.round(((e.clientX - drag.x) / zoom) * 30) });
      }
      function pointerUp(e, c) {
        if (!drag) return;
        if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<4){setDrag(null);return;}
        gestureMoved.current=true;
        const delta = drag.delta,
          edge = drag.edge;
        const lane=[...laneRefs.current.values()].find(el=>{if(!el)return false;const r=el.getBoundingClientRect();return e.clientY>=r.top&&e.clientY<=r.bottom;});
        const trackId =
          lane?.dataset.trackId ||
          data.tracks.find((tr) => tr.clips.some((x) => x.clipId === c.clipId))
            ?.trackId;
        setDrag(null);
        if (
          !delta &&
          trackId ===
            data.tracks.find((tr) => tr.clips.some((x) => x.clipId === c.clipId))
              ?.trackId
        )
          return;
        const fromTrack=data.tracks.find(tr=>tr.clips.some(x=>x.clipId===c.clipId));
        const startFrame=nearest(c.startFrame+delta,c.clipId);
        if(!edge&&trackId===fromTrack?.trackId){const hit=fromTrack.clips.find(x=>x.clipId!==c.clipId&&startFrame<x.startFrame+x.durationFrames&&startFrame+c.durationFrames>x.startFrame);if(hit){const order=fromTrack.clips.filter(x=>x.clipId!==c.clipId).map(x=>x.clipId);let at=order.indexOf(hit.clipId);if(startFrame>=hit.startFrame+hit.durationFrames/2)at++;order.splice(at,0,c.clipId);void write([{op:'clip.reorder',trackId,clipIds:order}]);return;}}
        const ops = edge
          ? [{ op: "clip.trim", clipId: c.clipId, edge, deltaFrames: delta }]
          : [
              {
                op: "clip.move",
                clipId: c.clipId,
                startFrame: nearest(c.startFrame + delta, c.clipId),
                trackId,
                mode: "reject",
              },
            ];
        void write(ops);
      }
      function tool(label,path,onClick,disabled){return h('button',{className:'dv-timeline-tool',title:label,'aria-label':label,onClick,disabled},h('svg',{viewBox:'0 0 24 24',width:16,height:16,fill:'none',stroke:'currentColor',strokeWidth:1.5,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:path})),h('span',{className:'dv-sr-only'},label));}
      return h(
        "section",
        {
          className: "dv-timeline" + (compact ? " dv-timeline-compact" : ""),
          "aria-label": t("video.timeline.title"),"aria-busy":busy?"true":"false",
          tabIndex: 0,
          onKeyDown: (e) => {
            if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT")
              return;
            if (e.key === "Delete" || e.key === "Backspace") {
              e.preventDefault();
              if (chosen)
                void write([
                  { op: "clip.delete", clipId: chosen.clipId, ripple: false },
                ]);
            }
            if (e.key === "s" && !e.metaKey && !e.ctrlKey) cut();
            if ((e.metaKey || e.ctrlKey) && e.key === "z") {
              e.preventDefault();
              void write(null, e.shiftKey ? "timeline.redo" : "timeline.undo");
            }
          },
        },
        h(
          "div",
          { className: "dv-timeline-toolbar" },
          h('span',{className:'dv-timeline-heading'},t('video.timeline.title')),
          tool(t('video.canvas.undo'),'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12',()=>write(null,'timeline.undo'),busy||!data.undoHint.canUndo),
          tool(t('video.canvas.redo'),'m15 5 5 5-5 5m5-5h-9a6 6 0 0 0 0 12',()=>write(null,'timeline.redo'),busy||!data.undoHint.canRedo),
          h('span',{className:'dv-tool-divider'}),
          tool(t('video.timeline.split'),'M9 9 20 3M9 15l11 6M12 12l-3-3M12 12l-3 3M6 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6M6 12a3 3 0 1 0 0 6 3 3 0 0 0 0-6',cut,busy||!chosen),
          tool(t('video.timeline.delete'),'M4 6h16M9 6V3h6v3M7 6l1 15h8l1-15',()=>chosen&&write([{op:'clip.delete',clipId:chosen.clipId,ripple:false}]),busy||!chosen),
          h('details',{className:'dv-timeline-more'},h('summary',{'aria-label':t('video.audio.more'),title:t('video.audio.more')},'···'),h('div',{className:'dv-timeline-menu'},
            h('button',{disabled:busy||!chosen,onClick:()=>chosen&&write([{op:'clip.duplicate',clipId:chosen.clipId,mode:'ripple'}])},t('video.timeline.duplicate')),
            h('button',{disabled:busy||!chosen,onClick:()=>moveOrder(-1)},'←'),
            h('button',{disabled:busy||!chosen,onClick:()=>moveOrder(1)},'→'),
            h('button',{disabled:busy,onClick:()=>write([{op:'track.add',kind:'video'}])},t('video.timeline.addTrack')),
            h('button',{disabled:busy,onClick:()=>write([{op:'track.add',kind:'audio'}])},t('video.audio.addTrack')),
            h('button',{'aria-pressed':compact,onClick:()=>setCompact(!compact)},t('video.timeline.compact')))),
          h('span',{className:'dv-timeline-spacer'}),
          h('label',{className:'dv-snap-toggle',title:t('video.timeline.snap')},h('input',{type:'checkbox',checked:snap,onChange:e=>setSnap(e.target.checked)}),h('span',null,t('video.timeline.snap'))),
          h('input',{type:'range',className:'dv-timeline-zoom',min:8,max:100,value:zoom,'aria-label':t('video.timeline.zoom'),onChange:e=>setZoom(Number(e.target.value))}),
        ),
        h(
          "div",
          { className: "dv-timeline-scroll", ref: viewport },
          h(
            "div",
            { className: "dv-timeline-content", style: { width: width + 100 } },
            h(
              "div",
              {
                className: "dv-timeline-ruler",
                style: { marginLeft: 100, width },
                onClick: (e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  props.onSeek(
                    Math.min(
                      duration / 30,
                      Math.max(0, (e.clientX - rect.left) / zoom),
                    ),
                  );
                },
              },
              Array.from(
                { length: Math.min(1000, Math.ceil(duration / 30) + 1) },
                (_, i) =>
                  h(
                    "span",
                    { key: i, style: { left: i * zoom } },
                    zoom < 20 && i % 5 ? "" : i + "s",
                  ),
              ),
            ),
            data.tracks
              .map((tr) =>
                h(
                  "div",
                  { key: tr.trackId, className: "dv-timeline-track" },
                  h("div", { className: "dv-timeline-track-name" }, h('span',{className:'dv-track-label'},h('span',{className:'dv-track-kind'},tr.kind==='audio'?'A':'V'),tr.name),h('button',{className:'dv-track-mute','aria-label':t('video.audio.mute')+' '+tr.name,'aria-pressed':Boolean(tr.muted),disabled:busy,onClick:()=>write([{op:'track.update',trackId:tr.trackId,patch:{muted:!tr.muted}}])},'M')),
                  h(
                    "div",
                    {
                      className: "dv-timeline-lane",ref:el=>{if(el)laneRefs.current.set(tr.trackId,el);else laneRefs.current.delete(tr.trackId);},
                      "data-track-id": tr.trackId,
                      style: { width },
                      onDragOver: (e) => e.preventDefault(),
                      onDrop: (e) => {
                        e.preventDefault();
                        const clipId = e.dataTransfer.getData(
                          "application/x-dsh-clip",
                        );
                        const a = e.dataTransfer.getData("application/x-dsh-asset");
                        const rect = e.currentTarget.getBoundingClientRect(),
                          startFrame = nearest(
                            ((e.clientX - rect.left) / zoom) * 30,
                            clipId,
                          );
                        if (clipId)
                          void write([
                            {
                              op: "clip.move",
                              clipId,
                              trackId: tr.trackId,
                              startFrame,
                              mode: "reject",
                            },
                          ]);
                        else if (a)
                          void write([
                            {
                              op: "clip.insert",
                              assetId: a,
                              trackId: tr.trackId,
                              startFrame,
                              mode: "ripple",
                            },
                          ]);
                      },
                    },
                    tr.clips.map((c) =>
                      h(
                        "div",
                        {
                          key: c.clipId,
                          className:
                            "dv-timeline-clip" + (tr.kind==='audio'?' is-audio':'') +
                            (selected === c.clipId ? " is-selected" : ""),
                          "data-clip-id": c.clipId,
                          tabIndex: 0,
                          role: "button",
                          "aria-label": c.label || c.clipId,
                          "aria-pressed": selected === c.clipId,
                          onClick: () => {
                            if(gestureMoved.current){gestureMoved.current=false;return;}
                            setSelected(c.clipId);
                            props.onSeek(c.startFrame / 30);
                          },
                          onKeyDown:e=>{if(e.target!==e.currentTarget)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(c.clipId);props.onSeek(c.startFrame/30);}},
                          onPointerDown: (e) => pointerDown(e, c, null),
                          onPointerMove: pointerMove,
                          onPointerUp: (e) => pointerUp(e, c),
                          onPointerCancel: () => setDrag(null),
                          style: {
                            left: ((c.startFrame+(drag?.clipId===c.clipId&&drag.edge==="in"?drag.delta:0)) / 30) * zoom,
                            width: Math.max(8, ((c.durationFrames+(drag?.clipId===c.clipId&&drag.edge?(drag.edge==="in"?-drag.delta:drag.delta):0)) / 30) * zoom),
                            transform:
                              drag?.clipId === c.clipId && !drag.edge
                                ? "translateX(" + (drag.delta / 30) * zoom + "px)"
                                : undefined,
                          },
                        },
                        tr.kind==='audio'?h('img',{className:'dv-clip-waveform',style:{width:((data.assets.find(a=>a.assetId===c.assetId)?.durationFrames??c.durationFrames)/(data.assets.find(a=>a.assetId===c.assetId)?.fps??30))/(c.durationFrames/30*(c.speed||1))*100+'%',left:-((c.sourceInFrame??0)/(data.assets.find(a=>a.assetId===c.assetId)?.fps??30))/(c.durationFrames/30*(c.speed||1))*100+'%'},src:'api/dsh-video/derived?projectId='+encodeURIComponent(props.projectId)+'&assetId='+encodeURIComponent(c.assetId)+'&kind=waveform#v='+waveVersion,alt:'',draggable:false,onError:e=>{e.target.style.visibility='hidden';}}):null,
                        h("span", {
                          className: "dv-timeline-edge",
                          role: "slider",
                          tabIndex: 0,
                          "aria-label": t("video.timeline.trimIn"),
                          "aria-valuenow": c.startFrame,
                          onPointerDown: (e) => pointerDown(e, c, "in"),
                          onKeyDown: (e) => {
                            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                              e.preventDefault();
                              e.stopPropagation();
                              void write([
                                {
                                  op: "clip.trim",
                                  clipId: c.clipId,
                                  edge: "in",
                                  deltaFrames: e.key === "ArrowLeft" ? -1 : 1,
                                },
                              ]);
                            }
                          },
                        }),
                        h(
                          "span",
                          { className: "dv-timeline-clip-label" },
                          c.label || c.clipId,
                        ),
                        h("span", {
                          className: "dv-timeline-edge dv-timeline-edge-out",
                          role: "slider",
                          tabIndex: 0,
                          "aria-label": t("video.timeline.trimOut"),
                          "aria-valuenow": c.durationFrames,
                          onPointerDown: (e) => pointerDown(e, c, "out"),
                          onKeyDown: (e) => {
                            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                              e.preventDefault();
                              e.stopPropagation();
                              void write([
                                {
                                  op: "clip.trim",
                                  clipId: c.clipId,
                                  edge: "out",
                                  deltaFrames: e.key === "ArrowLeft" ? -1 : 1,
                                },
                              ]);
                            }
                          },
                        }),
                      ),
                    ),
                  ),
                ),
              ),
            h("div", {
              className: "dv-timeline-playhead",
              style: { left: 100 + props.time * zoom },
            }),
          ),
        ),
        chosen
          ? h(
              "div",
              { className: "dv-timeline-inspector" },
              h("span", {className:'dv-inspector-name',title:chosen.clipId}, chosen.label || t('video.timeline.title')),
              h("span", null, (chosen.durationFrames / 30).toFixed(2) + "s"),
              h(
                "label",
                null,
                t("video.timeline.track"),
                h(
                  "select",
                  {
                    value: chosen.trackId,
                    disabled: busy,
                    onChange: (e) =>
                      write([
                        {
                          op: "clip.move",
                          clipId: chosen.clipId,
                          trackId: e.target.value,
                          startFrame: chosen.startFrame,
                        },
                      ]),
                  },
                  data.tracks
                    .filter((x) => x.kind === data.tracks.find(tr=>tr.trackId===chosen.trackId)?.kind)
                    .map((tr) =>
                      h("option", { key: tr.trackId, value: tr.trackId }, tr.name),
                    ),
                ),
              ),
              h(
                "label",
                null,
                t("video.timeline.speed"),
                h(
                  "select",
                  {
                    value: chosen.speed || 1,
                    disabled: busy || chosen.kind !== "media",
                    onChange: (e) =>
                      write([
                        {
                          op: "clip.speed",
                          clipId: chosen.clipId,
                          speed: Number(e.target.value),
                          ripple: true,
                        },
                      ]),
                  },
                  [0.25, 0.5, 1, 1.5, 2, 4].map((x) =>
                    h("option", { key: x, value: x }, x + "×"),
                  ),
                ),
              ),
              chosen.kind==='media'?h(React.Fragment,null,
                ...[['video.audio.volume','volumeDb',-60,12,1],['video.audio.fadeIn','fadeInFrames',0,chosen.durationFrames/30,0.1],['video.audio.fadeOut','fadeOutFrames',0,chosen.durationFrames/30,0.1]].map(([label,key,min,max,step])=>h('label',{key},t(label),h('input',{type:'text',inputMode:'decimal',key:chosen.clipId+':'+key+':'+data.revision,value:levelDrafts[key]??(key==='volumeDb'?(chosen[key]??0):(chosen[key]??0)/30),onChange:e=>setLevelDrafts({...levelDrafts,[key]:e.target.value}),min,max,step,'aria-label':t(label),disabled:busy,onBlur:e=>{const value=Number(e.target.value);if(e.target.value===''||!Number.isFinite(value))return;if((key==='volumeDb'?value:Math.round(value*30))===(chosen[key]??0))return;void write([key==='volumeDb'?{op:'clip.volume',clipId:chosen.clipId,volumeDb:value}:{op:'clip.fade',clipId:chosen.clipId,inFrames:key==='fadeInFrames'?Math.round(value*30):chosen.fadeInFrames??0,outFrames:key==='fadeOutFrames'?Math.round(value*30):chosen.fadeOutFrames??0}]);}}),key==='volumeDb'?'dB':'s')),
                h('label',null,t('video.audio.gain'),h('input',{type:'text',inputMode:'decimal',key:chosen.trackId+':'+data.revision,value:levelDrafts.gain??data.tracks.find(tr=>tr.trackId===chosen.trackId)?.gainDb??0,onChange:e=>setLevelDrafts({...levelDrafts,gain:e.target.value}),min:-60,max:12,step:1,'aria-label':t('video.audio.gain'),disabled:busy,onBlur:e=>{const gainDb=Number(e.target.value);if(e.target.value!==''&&Number.isFinite(gainDb)&&gainDb!==(data.tracks.find(tr=>tr.trackId===chosen.trackId)?.gainDb??0))void write([{op:'track.update',trackId:chosen.trackId,patch:{gainDb}}]);}}),'dB')):null,
            )
          : null,
        h(
          "div",
          { className: "dv-timeline-notice", role: "status" },
          busy ? t("video.timeline.saving") : notice || t("video.timeline.hint"),
        ),
      );
    }

    function CanvasWorkspace(props) {
      const t = props.t;
      const projectId = props.projectId;
      const inspected = props.inspected;
      const onReload = props.onReload;
      const onError = props.onError;
      // The product workspace mounts the canvas read-only (`previewOnly: true`):
      // snapshot load/retry, the fixed runtime contract, play/pause, seek and the
      // revision/phase markers stay, while every manual-edit affordance and every
      // user gesture that could issue a write is not rendered. The default stays
      // false so the reviewed P3-008 manual path is unchanged for its browser
      // harness and component-level contract tests.
      const previewOnly = props.previewOnly === true;
      const scenes = Array.isArray(inspected.scenes) ? inspected.scenes : [];
      const elements = Array.isArray(inspected.elements) ? inspected.elements : [];
      const files = Array.isArray(inspected.files) ? inspected.files : [];
      const images = files.filter(function imageAsset(file) {
        return typeof file.path === 'string' && /\.(png|jpe?g)$/i.test(file.path);
      });

      // R2 retention contract. `active` is the last ready snapshot actually
      // displayed and playable; `candidate` is a hidden preloading snapshot for
      // the requested revision; `targetRevision` is the latest requested
      // revision. `phase` is derived from those: loading (no active yet) / ready
      // (an active composition is shown, a candidate may be pending) / error (no
      // active and the load failed). A candidate only replaces the active
      // composition after its runtime reports ready.
      const [active, setActive] = React.useState(null);
      const [candidate, setCandidate] = React.useState(null);
      const [visibleSlot, setVisibleSlot] = React.useState(0);
      const [targetRevision, setTargetRevision] = React.useState(inspected.revision);
      const [phase, setPhase] = React.useState('loading');
      const [frameError, setFrameError] = React.useState(null);
      const [previewNotice, setPreviewNotice] = React.useState(null);
      const [previewAttempt, setPreviewAttempt] = React.useState({ revision: null, attempt: 0 });
      const [previewRetrying, setPreviewRetrying] = React.useState(false);
      const [previewDiagnostics, setPreviewDiagnostics] = React.useState([]);
      const pendingRequestRef = React.useRef(null);
      const [time, setTime] = React.useState(0);
      const [playing, setPlaying] = React.useState(false);
      const [selected, setSelected] = React.useState(null);
      const [drag, setDrag] = React.useState(null);
      const [editor, setEditor] = React.useState(null);
      const [editorNotice, setEditorNotice] = React.useState(null);
      const [busy, setBusy] = React.useState(null);
      const [actionError, setActionError] = React.useState(null);
      const [stageSize, setStageSize] = React.useState({ width: 0, height: 0 });
      const [assetToAdd,setAssetToAdd]=React.useState(null);
      const [audioOpen,setAudioOpen]=React.useState(false);
      const [drawerOpen, setDrawerOpen] = React.useState(false);
      const [uploadBusy, setUploadBusy] = React.useState(false);
      const [sceneChoice, setSceneChoice] = React.useState(scenes[0] ? scenes[0].sceneId : null);
      const [sceneColor, setSceneColor] = React.useState('#1d4ed8');
      const [styleColor, setStyleColor] = React.useState('#ffffff');
      const [styleSize, setStyleSize] = React.useState(64);
      const [exportState, setExportState] = React.useState(null);

      // Two physical, permanently keyed iframe slots: the visible slot renders
      // `active`, the hidden slot preloads `candidate`. Promotion flips the slot
      // roles instead of swapping src, so the already-ready candidate DOM iframe
      // is never reloaded. The old messages are routed only to the instance that
      // owns the matching slot/ledger.
      const iframeRef = React.useRef(null);
      const slot1Ref = React.useRef(null);
      const stageRef = React.useRef(null);
      const wrapRef = React.useRef(null);
      const overlayRef = React.useRef(null);
      const activeRef = React.useRef(null);
      const candidateRef = React.useRef(null);
      const visibleSlotRef = React.useRef(0);
      const slotInstancesRef = React.useRef([null, null]);
      const editorRef = React.useRef(null);
      const timeRef = React.useRef(0);
      const playingRef = React.useRef(false);
      const soundEnabledRef = React.useRef(false);
      const selectedRef = React.useRef(null);
      const readyRef = React.useRef(false);
      const snapshotToken = React.useRef(0);
      const suppressClickRef = React.useRef(false);
      const pollRef = React.useRef(null);
      const unmountEpochRef = React.useRef(0);
      // P3-017 B1: bounded per-revision attempt bookkeeping, one pending auto
      // retry timer, and the restore payload captured for that retry. The
      // diagnostics ring is bounded; nothing here can grow with time.
      const attemptRef = React.useRef({ revision: null, attempt: 0 });
      const diagnosticsRef = React.useRef([]);
      const retryTimerRef = React.useRef(null);
      const retryRestoreRef = React.useRef(null);
      // The pending revision debounce is owned by a ref (not by an effect
      // cleanup), so a parent re-render can never silently re-arm it. It is
      // cleared when a newer revision arrives, the target loads, or on unmount.
      const debounceRef = React.useRef({ revision: null, timer: null });
      const targetRevisionRef = React.useRef(targetRevision);
      const firstLoadRef = React.useRef(true);
      const lastProjectIdRef = React.useRef(projectId);
      const inspectedMetaRef = React.useRef(new Map());
      const revision = inspected.revision;
      // R2F: geometry/duration belong to each preview instance, never to the
      // latest target props. The latest inspected metadata only seeds the map
      // entry for the revision being requested (kept per revision so a retry of a
      // previously failed target still uses that revision's own geometry).
      const inspectedMeta = {
        width: canvasNumber(inspected.width, 1280),
        height: canvasNumber(inspected.height, 720),
        duration: Math.max(0, canvasNumber(inspected.duration, 0)),
      };
      if (typeof inspected.revision === 'string' && inspected.revision.length > 0) {
        inspectedMetaRef.current.set(inspected.revision, inspectedMeta);
        if (inspectedMetaRef.current.size > 64) {
          const oldest = inspectedMetaRef.current.keys().next();
          if (oldest.done === false && oldest.value !== inspected.revision) inspectedMetaRef.current.delete(oldest.value);
        }
      }
      const displayMeta = active !== null ? active : candidate !== null ? candidate : inspectedMeta;
      const displayWidthPx = displayMeta.width;
      const displayHeightPx = displayMeta.height;
      const displayDuration = displayMeta.duration;
      const scale = stageSize.width > 0 && stageSize.height > 0 ? Math.min(stageSize.width / displayWidthPx, stageSize.height / displayHeightPx) : 0;
      const displayWidth = scale > 0 ? displayWidthPx * scale : 0;
      const displayHeight = scale > 0 ? displayHeightPx * scale : 0;

      timeRef.current = time;
      playingRef.current = playing;
      selectedRef.current = selected;
      editorRef.current = editor;
      activeRef.current = active;
      candidateRef.current = candidate;
      visibleSlotRef.current = visibleSlot;
      targetRevisionRef.current = targetRevision;
      slotInstancesRef.current = [
        visibleSlot === 0 ? active : candidate,
        visibleSlot === 1 ? active : candidate,
      ];

      function setSelectedSafe(next) {
        selectedRef.current = next;
        setSelected(next);
        if (next !== null && next.style) {
          setStyleColor(typeof next.style.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(next.style.color) ? next.style.color : '#ffffff');
          setStyleSize(canvasNumber(next.style.fontSize, 64));
        }
      }

      // Settle one runtime instance explicitly: resolve every still pending
      // command promise with null, clear its timers, drop its waiter map and
      // revoke its ledger. Never leave a dangling promise when an instance is
      // unbound, replaced or destroyed (the reviewed P3-005-B requirement). The
      // active and candidate instances own separate ledgers/waiters, so settling
      // one can never disturb the other.
      function settleInstance(instance) {
        if (instance === null || instance === undefined) return;
        const pending = instance.pending;
        if (pending !== null && pending !== undefined) {
          for (const entry of pending.values()) {
            clearTimeout(entry.timer);
            entry.resolve(null);
          }
          pending.clear();
        }
        if (instance.ledger !== null && instance.ledger !== undefined) instance.ledger.revoke();
      }

      function slotFrame(index) {
        return index === 0 ? iframeRef.current : slot1Ref.current;
      }

      function settleInstanceWaiter(instance, seq, payload) {
        const pending = instance !== null && instance !== undefined ? instance.pending : null;
        if (pending === null || pending === undefined) return;
        const entry = pending.get(seq);
        if (entry === undefined) return;
        pending.delete(seq);
        clearTimeout(entry.timer);
        entry.resolve(payload);
      }

      function postSlotCommand(index, type, payload) {
        return new Promise(function commandPromise(resolve) {
          const frame = slotFrame(index);
          const instances = slotInstancesRef.current;
          const instance = instances !== null && instances !== undefined ? instances[index] : null;
          const ledger = instance !== null && instance !== undefined ? instance.ledger : null;
          if (frame === null || frame === undefined || ledger === null || typeof frame.contentWindow === 'undefined') {
            resolve(null);
            return;
          }
          let message;
          try {
            message = ledger.command(type, payload || {});
          } catch (_error) {
            // The UI only constructs contract commands; an invalid one is a bug,
            // not something to post to the sandbox.
            resolve(null);
            return;
          }
          const pending = instance.pending;
          const timer = setTimeout(function timeout() {
            if (pending.has(message.seq) === false) return;
            pending.delete(message.seq);
            ledger.expire(Date.now() + 1);
            resolve(null);
          }, 4000);
          pending.set(message.seq, { resolve: resolve, timer: timer });
          try {
            frame.contentWindow.postMessage(message, '*');
          } catch (_error) {
            clearTimeout(timer);
            pending.delete(message.seq);
            ledger.expire(Date.now() + 1);
            resolve(null);
          }
        });
      }

      function postActiveCommand(type, payload) {
        return postSlotCommand(visibleSlotRef.current, type, payload);
      }

      function hideSelection() {
        setSelectedSafe(null);
        setEditor(null);
        setDrag(null);
      }

      function selectedElement() {
        if (selected === null) return null;
        return elements.find(function same(element) {
          return element.stableId === selected.stableId;
        }) || null;
      }

      function isTextSelected() {
        const element = selectedElement();
        return element !== null && Array.isArray(element.capabilities) && element.capabilities.includes('text');
      }

      function isLayoutSelected() {
        const element = selectedElement();
        return element !== null && Array.isArray(element.capabilities) && element.capabilities.includes('layout');
      }

      function isStyleSelected() {
        const element = selectedElement();
        return element !== null && Array.isArray(element.capabilities) && element.capabilities.includes('style');
      }

      function currentScene() {
        const found = scenes.find(function contains(scene) {
          return time >= scene.start && time < scene.start + scene.duration;
        });
        return found || scenes[0] || null;
      }

      React.useEffect(
        function measureStage() {
          const element = wrapRef.current;
          if (element === null || element === undefined) return function noMeasure() {};
          function measure() {
            try {
              const rect = element.getBoundingClientRect();
              setStageSize({ width: Math.max(0, rect.width), height: Math.max(0, rect.height) });
            } catch (_error) {
              /* A non-DOM test host has no box; render the composition at its
                 natural aspect so the canvas still mounts for contract tests. */
              setStageSize({ width: Math.max(320, canvasNumber(inspected.width, 1280)), height: Math.max(180, canvasNumber(inspected.height, 720)) });
            }
          }
          measure();
          let observer = null;
          if (typeof ResizeObserver === 'function' && element !== null) {
            observer = new ResizeObserver(measure);
            observer.observe(element);
          } else if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('resize', measure);
          }
          return function stopMeasure() {
            if (observer !== null) observer.disconnect();
            else if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') window.removeEventListener('resize', measure);
          };
        },
        []
      );

      // Fire-and-forget Host snapshot release: retention is only needed while an
      // instance may still load/play. Errors are ignored (the worker TTL and the
      // Host route cap clean up).
      function releaseSnapshot(instance) {
        if (instance === null || instance === undefined) return;
        if (typeof instance.snapshotId !== 'string' || instance.snapshotId.length === 0) return;
        hostRequest('preview.release', { snapshotId: instance.snapshotId }).catch(function ignoreRelease() {});
      }

      /** Metadata of the revision being requested, independent of later props. */
      function metadataForRevision(revisionId) {
        const known = inspectedMetaRef.current.get(revisionId);
        if (known !== undefined && known !== null) return known;
        if (inspected.revision === revisionId) return inspectedMeta;
        if (activeRef.current !== null) {
          return { width: activeRef.current.width, height: activeRef.current.height, duration: activeRef.current.duration };
        }
        if (candidateRef.current !== null) {
          return { width: candidateRef.current.width, height: candidateRef.current.height, duration: candidateRef.current.duration };
        }
        return inspectedMeta;
      }

      function snapshotInstance(next, restore, metadata) {
        const instanceId = canvasInstanceId();
        const nonce = canvasNonce();
        const meta = metadata !== null && metadata !== undefined ? metadata : inspectedMeta;
        return {
          snapshotId: next.snapshotId,
          revision: next.revision,
          entryUrl: next.entryUrl,
          routeBase: next.routeBase,
          src: next.entryUrl + '?instance=' + encodeURIComponent(instanceId) + '&nonce=' + nonce,
          instanceId: instanceId,
          nonce: nonce,
          restore: restore || null,
          // R2F: this instance's own composition metadata. The visible display,
          // seek range and coordinate mapping never read another instance's
          // values, so a failed/delayed candidate cannot resize the active one.
          width: canvasNumber(meta.width, 1280),
          height: canvasNumber(meta.height, 720),
          duration: Math.max(0, canvasNumber(meta.duration, 0)),
          ledger: canvasMessageLedger({ instanceId: instanceId, nonce: nonce, timeoutMs: 4000 }),
          pending: new Map(),
        };
      }

      function discardCandidate() {
        const current = candidateRef.current;
        if (current === null) return;
        candidateRef.current = null;
        settleInstance(current);
        releaseSnapshot(current);
        setCandidate(null);
        setPreviewNotice(null);
      }

      // Snapshot request failure or candidate runtime error: keep the last ready
      // composition visible/playable. With an active composition a compact notice
      // + retry appears next to the stage; without one (first load) the existing
      // full recoverable status is shown.
      function failCandidate(error) {
        const current = candidateRef.current;
        if (current !== null) {
          candidateRef.current = null;
          settleInstance(current);
          releaseSnapshot(current);
        }
        setCandidate(null);
        if (activeRef.current !== null) {
          setPreviewNotice(hostError(error));
          setPhase('ready');
        } else {
          setPhase('error');
          setFrameError(hostError(error));
        }
      }

      function clearRetryTimer() {
        if (retryTimerRef.current !== null) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
      }

      function clearDebounceTimer() {
        if (debounceRef.current.timer !== null) clearTimeout(debounceRef.current.timer);
        debounceRef.current = { revision: null, timer: null };
      }

      function releaseUnusedSnapshot(value) {
        if (value !== null && typeof value === 'object' && typeof value.snapshotId === 'string') {
          hostRequest('preview.release', { snapshotId: value.snapshotId }).catch(function ignoreRelease() {});
        }
      }

      // P3-017 B1 bounded diagnostics: the newest PREVIEW_DIAGNOSTIC_LIMIT
      // attempts, each with revision, attempt number, snapshot/ready durations and
      // error code. Exposed as one data attribute (and one console line per failed
      // attempt); the ring never grows with session length.
      function recordPreviewDiagnostic(entry) {
        const next = diagnosticsRef.current.concat([entry]).slice(-PREVIEW_DIAGNOSTIC_LIMIT);
        diagnosticsRef.current = next;
        setPreviewDiagnostics(next);
      }

      function previewDiagnosticsText() {
        return diagnosticsRef.current.map(function diagnosticLine(entry) {
          const revisionId = typeof entry.revision === 'string' ? entry.revision.slice(0, 8) : '';
          const attempt = Number.isFinite(entry.attempt) ? String(entry.attempt) : '-';
          const snapshotMs = Number.isFinite(entry.snapshotMs) ? String(Math.round(entry.snapshotMs)) : '-';
          const readyMs = Number.isFinite(entry.readyMs) ? String(Math.round(entry.readyMs)) : '-';
          return revisionId + ':' + attempt + ':' + snapshotMs + ':' + readyMs + ':' + (entry.errorCode || 'ok');
        }).join('|');
      }

      function resetPreviewAttempt(revisionId) {
        attemptRef.current = { revision: revisionId, attempt: 0 };
        setPreviewAttempt({ revision: revisionId, attempt: 0 });
      }

      // P3-017 B1: one automatic retry with a fresh snapshot before the honest
      // failure is shown. The active composition is never unmounted here; while
      // the retry is pending it stays visible/playable and the non-blocking
      // "updating preview" marker names the pending revision.
      function handlePreviewAttemptFailure(error, detail) {
        const meta = detail !== null && typeof detail === 'object' ? detail : {};
        const failure = hostError(error);
        const revisionId = typeof meta.revision === 'string' && meta.revision.length > 0 ? meta.revision : targetRevisionRef.current;
        const attempt = attemptRef.current.revision === revisionId ? attemptRef.current.attempt : 0;
        recordPreviewDiagnostic({
          revision: revisionId,
          attempt: attempt,
          snapshotMs: Number.isFinite(meta.snapshotMs) ? meta.snapshotMs : null,
          readyMs: Number.isFinite(meta.readyMs) ? meta.readyMs : null,
          errorCode: failure.code,
        });
        if (attempt > 0 && attempt <= PREVIEW_RETRY_LIMIT) {
          clearRetryTimer();
          setPreviewRetrying(true);
          setPreviewNotice(null);
          if (activeRef.current !== null) {
            setPhase('ready');
          } else {
            setPhase('loading');
            setFrameError(null);
          }
          console.warn('[dsh-video] preview attempt failed; retrying once', {
            revision: revisionId,
            attempt: attempt,
            snapshotMs: Number.isFinite(meta.snapshotMs) ? Math.round(meta.snapshotMs) : null,
            readyMs: Number.isFinite(meta.readyMs) ? Math.round(meta.readyMs) : null,
            code: failure.code,
          });
          retryTimerRef.current = setTimeout(function autoRetryPreview() {
            retryTimerRef.current = null;
            if (activeRef.current === null) setPhase('loading');
            void loadTarget(revisionId, retryRestoreRef.current);
          }, PREVIEW_RETRY_DELAY_MS);
          return;
        }
        setPreviewRetrying(false);
        console.warn('[dsh-video] preview failed', {
          revision: revisionId,
          attempt: attempt,
          snapshotMs: Number.isFinite(meta.snapshotMs) ? Math.round(meta.snapshotMs) : null,
          readyMs: Number.isFinite(meta.readyMs) ? Math.round(meta.readyMs) : null,
          code: failure.code,
        });
        failCandidate(error);
      }

      function promoteCandidate(instance) {
        if (candidateRef.current !== instance) return;
        const previous = activeRef.current;
        const hiddenIndex = 1 - visibleSlotRef.current;
        const restore = instance.restore;
        // The restored playback position is clamped to the NEW instance's own
        // duration; the outgoing instance's duration is no longer authoritative.
        const restoreTime = restore !== null && restore !== undefined && Number.isFinite(restore.time)
          ? Math.min(restore.time, instance.duration)
          : Math.min(timeRef.current, instance.duration);
        const clampedTime = Math.min(timeRef.current, instance.duration);
        // The preloaded runtime is already ready: carry the playback position (and
        // on the manual path the selection) over before the slot roles swap.
        void postSlotCommand(hiddenIndex, 'seek', { time: restoreTime });
        if (soundEnabledRef.current) void postSlotCommand(hiddenIndex,'enableSound');
        if (playingRef.current === true) void postSlotCommand(hiddenIndex, 'play');
        if (restore !== null && restore !== undefined && typeof restore.stableId === 'string') {
          const element = elements.find(function same(item) {
            return item.stableId === restore.stableId;
          });
          if (element !== undefined && element.layout && Number.isFinite(element.layout.left) && Number.isFinite(element.layout.top)) {
            const rect = element.layout;
            if (rect.width > 0 && rect.height > 0) {
              void postSlotCommand(hiddenIndex, 'hitTest', { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }).then(function applyHit(payload) {
                if (payload && payload.hit) setSelectedSafe(payload.hit);
              });
            }
          }
        }
        activeRef.current = instance;
        candidateRef.current = null;
        visibleSlotRef.current = hiddenIndex;
        setVisibleSlot(hiddenIndex);
        setActive(instance);
        setCandidate(null);
        setPhase('ready');
        setFrameError(null);
        setPreviewNotice(null);
        setTime(clampedTime);
        readyRef.current = true;
        if (previous !== null) {
          // Release the outgoing instance only after the successful switch.
          settleInstance(previous);
          releaseSnapshot(previous);
        }
      }

      async function loadTarget(requested, restore, options) {
        const target = typeof requested === 'string' && requested.length > 0 ? requested : revision;
        const settings = options !== null && typeof options === 'object' ? options : {};
        // Idempotent for the requested revision: an already in-flight request,
        // an already preloading candidate and the displayed composition are never
        // fetched a second time (a re-render or a poll cannot disturb them, and no
        // duplicate snapshot is created).
        const inFlight = pendingRequestRef.current;
        if (inFlight !== null && inFlight.revision === target) return;
        if (candidateRef.current !== null && candidateRef.current.revision === target) {
          setTargetRevision(target);
          return;
        }
        if (activeRef.current !== null && activeRef.current.revision === target) {
          setTargetRevision(target);
          setPreviewNotice(null);
          setPreviewRetrying(false);
          setPhase('ready');
          return;
        }
        // One attempt is one snapshot request. A fresh cycle (a new revision, a
        // new project or an explicit user retry) restarts the retry allowance.
        if (settings.fresh === true || attemptRef.current.revision !== target) resetPreviewAttempt(target);
        const attempt = attemptRef.current.attempt + 1;
        attemptRef.current = { revision: target, attempt: attempt };
        setPreviewAttempt({ revision: target, attempt: attempt });
        clearRetryTimer();
        clearDebounceTimer();
        if (restore !== null && restore !== undefined) retryRestoreRef.current = restore;
        const token = ++snapshotToken.current;
        // Capture the requested revision's metadata before any async work: later
        // props.inspected updates for a newer revision must not leak into this
        // instance (and retries reuse the per-revision map entry).
        const targetMeta = metadataForRevision(target);
        pendingRequestRef.current = { revision: target, token: token };
        setTargetRevision(target);
        setPreviewNotice(null);
        setPreviewRetrying(false);
        // A newer request supersedes a still-preloading candidate.
        discardCandidate();
        if (activeRef.current === null) {
          setPhase('loading');
          setFrameError(null);
        }
        // The snapshot has its own independent budget, measured from the request
        // itself. A timed-out request keeps running in the background; if it ever
        // resolves afterwards the unused snapshot is released instead of leaking.
        const startedAt = Date.now();
        let next = null;
        let failure = null;
        const request = hostRequest('preview.snapshot', { projectId: projectId, revision: target, ttlMs: 300000 });
        const timedOut = await new Promise(function snapshotBudget(resolve) {
          let settled = false;
          const timer = setTimeout(function snapshotTimedOut() {
            if (settled === true) return;
            settled = true;
            resolve(true);
          }, PREVIEW_SNAPSHOT_TIMEOUT_MS);
          request.then(
            function snapshotReady(value) {
              clearTimeout(timer);
              if (settled === true) {
                releaseUnusedSnapshot(value);
                return;
              }
              settled = true;
              next = value;
              resolve(false);
            },
            function snapshotFailed(error) {
              clearTimeout(timer);
              if (settled === true) return;
              settled = true;
              failure = error;
              resolve(false);
            }
          );
        });
        const snapshotMs = Date.now() - startedAt;
        if (token !== snapshotToken.current) {
          // Superseded while in flight: the snapshot we just obtained is unused;
          // release it without touching the displayed composition.
          if (pendingRequestRef.current !== null && pendingRequestRef.current.token === token) pendingRequestRef.current = null;
          releaseUnusedSnapshot(next);
          return;
        }
        pendingRequestRef.current = null;
        if (timedOut === true) {
          handlePreviewAttemptFailure(
            { code: 'E_PREVIEW_TIMEOUT', message: t('video.canvas.loadTimeout') },
            { revision: target, snapshotMs: snapshotMs, phase: 'snapshot' }
          );
          return;
        }
        if (failure !== null) {
          handlePreviewAttemptFailure(failure, { revision: target, snapshotMs: snapshotMs, phase: 'snapshot' });
          return;
        }
        if (next === null || typeof next !== 'object' || typeof next.snapshotId !== 'string' || typeof next.entryUrl !== 'string') {
          handlePreviewAttemptFailure(
            { code: 'E_SNAPSHOT', message: 'The preview snapshot was invalid' },
            { revision: target, snapshotMs: snapshotMs, phase: 'snapshot' }
          );
          return;
        }
        const instance = snapshotInstance(next, restore || retryRestoreRef.current || null, targetMeta);
        instance.snapshotMs = snapshotMs;
        instance.mountedAt = Date.now();
        candidateRef.current = instance;
        setCandidate(instance);
      }

      React.useEffect(
        function reloadOnRevision() {
          const projectChanged = lastProjectIdRef.current !== projectId;
          lastProjectIdRef.current = projectId;
          const restore = {
            time: timeRef.current,
            stableId: selectedRef.current ? selectedRef.current.stableId : null,
            playing: playingRef.current,
          };
          retryRestoreRef.current = restore;
          // The first load and a project switch are immediate. A later published
          // revision is debounced (~1s of stability) so a burst of Agent publishes
          // settles on the last revision instead of racing several snapshots; the
          // target marker names the pending revision right away. The hidden manual
          // path (previewOnly=false) keeps its reviewed immediate reload because its
          // writes are user-initiated and never arrive in bursts.
          if (firstLoadRef.current === true || projectChanged === true || previewOnly === false) {
            firstLoadRef.current = false;
            clearDebounceTimer();
            void loadTarget(revision, restore);
            return function stopImmediateLoad() {};
          }
          setTargetRevision(revision);
          // The ref owns the timer exactly once per pending revision, so a parent
          // re-render cannot push the debounce deadline back indefinitely.
          if (debounceRef.current.revision === revision && debounceRef.current.timer !== null) {
            return function keepDebouncedLoad() {};
          }
          clearDebounceTimer();
          const timer = setTimeout(function debouncedPreviewLoad() {
            debounceRef.current = { revision: null, timer: null };
            void loadTarget(revision, restore);
          }, PREVIEW_DEBOUNCE_MS);
          debounceRef.current = { revision: revision, timer: timer };
          return function keepDebouncedLoad() {};
        },
        [projectId, revision]
      );

      // P3-017 B1: the ready budget starts only after a snapshot resolved AND its
      // candidate is actually mounted. A missing runtime handshake expires exactly
      // this attempt: settle/release the candidate and let the normal one-retry
      // path apply. A late ready from the discarded instance can never promote.
      React.useEffect(function boundReadyWait() {
        if (candidate === null) return function noReadyWait() {};
        const instance = candidate;
        const startedAt = Number.isFinite(instance.mountedAt) ? instance.mountedAt : Date.now();
        const timer = setTimeout(function previewNotReady() {
          if (candidateRef.current !== instance) return;
          discardCandidate();
          handlePreviewAttemptFailure(
            { code: 'E_PREVIEW_TIMEOUT', message: t('video.canvas.loadTimeout') },
            { revision: instance.revision, snapshotMs: instance.snapshotMs, readyMs: Date.now() - startedAt, phase: 'ready' }
          );
        }, PREVIEW_READY_TIMEOUT_MS);
        return function stopReadyWait() { clearTimeout(timer); };
      }, [candidate]);

      function handleActiveRuntimeEvent(instance, outcome) {
        if (activeRef.current !== instance) return;
        const payload = outcome.payload;
        if (outcome.type === 'ready') {
          readyRef.current = true;
          setPhase('ready');
        } else if (outcome.type === 'seeked' || outcome.type === 'state') {
          if (Number.isFinite(payload.time)) setTime(payload.time);
          if (typeof payload.playing === 'boolean') setPlaying(payload.playing);
          readyRef.current = true;
        } else if(outcome.type==='soundEnabled'){
          soundEnabledRef.current=true;
        } else if (outcome.type === 'playing') {
          setPlaying(true);
        } else if (outcome.type === 'paused') {
          setPlaying(false);
          if (Number.isFinite(payload.time)) setTime(payload.time);
        } else if (outcome.type === 'hit') {
          setSelectedSafe(payload.hit || null);
        } else if (outcome.type === 'error') {
          setActionError({ code: payload.code, message: payload.message });
        } else if (outcome.type === 'destroyed') {
          settleInstance(instance);
        }
      }

      function handleCandidateRuntimeEvent(instance, outcome) {
        // Only the currently tracked candidate may promote; an old/revoked
        // candidate's ready or error can never affect the displayed composition.
        if (candidateRef.current !== instance) return;
        const payload = outcome.payload;
        if (outcome.type === 'ready' || outcome.type === 'state') {
          promoteCandidate(instance);
        } else if (outcome.type === 'error') {
          // The mounted candidate failed before ready: release it, then apply the
          // same one-retry policy as a snapshot failure.
          const readyMs = Number.isFinite(instance.mountedAt) ? Date.now() - instance.mountedAt : null;
          discardCandidate();
          handlePreviewAttemptFailure(
            { code: payload.code, message: payload.message },
            { revision: instance.revision, snapshotMs: instance.snapshotMs, readyMs: readyMs, phase: 'runtime' }
          );
        } else if (outcome.type === 'destroyed') {
          settleInstance(instance);
        }
      }

      React.useEffect(
        function bindRuntimeMessages() {
          if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return function noWindow() {};
          function handleMessage(event) {
            const instances = slotInstancesRef.current;
            for (let index = 0; index < 2; index += 1) {
              const frame = slotFrame(index);
              if (frame === null || frame === undefined) continue;
              if (event.source !== frame.contentWindow) continue;
              const instance = instances !== null && instances !== undefined ? instances[index] : null;
              if (instance === null || instance === undefined) return;
              const role = index === visibleSlotRef.current ? 'active' : 'candidate';
              const outcome = instance.ledger.accept(event.data, { sourceOk: true });
              if (outcome.accepted === false) return;
              if (outcome.replyTo !== null) {
                settleInstanceWaiter(instance, outcome.replyTo, outcome.type === 'error' ? null : outcome.payload);
              }
              if (role === 'candidate') handleCandidateRuntimeEvent(instance, outcome);
              else handleActiveRuntimeEvent(instance, outcome);
              return;
            }
          }
          window.addEventListener('message', handleMessage);
          return function unbind() {
            window.removeEventListener('message', handleMessage);
          };
        },
        []
      );

      // Release the displayed/preloading snapshots only when the component is
      // really unmounting. In the Node smoke shim effect cleanups also run on
      // re-render, so a re-armed epoch distinguishes a re-render from an unmount
      // without releasing routes that are still displayed.
      React.useEffect(
        function releaseOnUnmount() {
          const epoch = ++unmountEpochRef.current;
          return function scheduleRelease() {
            void Promise.resolve().then(function releaseIfStillUnmounted() {
              if (unmountEpochRef.current !== epoch) return;
              // Stop any pending automatic retry/debounce and invalidate an
              // in-flight snapshot so a late result is released instead of leaking.
              clearRetryTimer();
              clearDebounceTimer();
              snapshotToken.current += 1;
              pendingRequestRef.current = null;
              if (candidateRef.current !== null) {
                const next = candidateRef.current;
                candidateRef.current = null;
                settleInstance(next);
                releaseSnapshot(next);
              }
              if (activeRef.current !== null) {
                const current = activeRef.current;
                activeRef.current = null;
                settleInstance(current);
                releaseSnapshot(current);
              }
              readyRef.current = false;
            });
          };
        },
        []
      );

      React.useEffect(
        function pollDuringPlayback() {
          if (!playing) return function noPoll() {};
          const timer = setInterval(function pollState() {
            void postActiveCommand('state');
          }, 33);
          return function stopPoll() {
            clearInterval(timer);
          };
        },
        [playing]
      );

      function stagePoint(event) {
        const stage = stageRef.current;
        if (stage === null || scale <= 0) return null;
        const rect = stage.getBoundingClientRect();
        const x = (event.clientX - rect.left) / scale;
        const y = (event.clientY - rect.top) / scale;
        if (x < 0 || y < 0 || x > displayWidthPx || y > displayHeightPx) return null;
        return { x: x, y: y };
      }

      function onOverlayClick(event) {
        if (editor !== null || drag !== null) return;
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        const point = stagePoint(event);
        if (point === null) return;
        void postActiveCommand('hitTest', point).then(function applyHit(payload) {
          setSelectedSafe(payload && payload.hit ? payload.hit : null);
        });
      }

      function beginDrag(event, mode) {
        if (selected === null || playing || isLayoutSelected() === false) return;
        const point = stagePoint(event);
        if (point === null) return;
        event.preventDefault();
        event.stopPropagation();
        if (overlayRef.current !== null && typeof overlayRef.current.setPointerCapture === 'function') {
          try {
            overlayRef.current.setPointerCapture(event.pointerId);
          } catch (_error) {
            /* pointer capture is best effort */
          }
        }
        const rect = canvasValidRect(selected.rect);
        if (rect === null) return;
        // The static base is the authoritative inspected layout, never the
        // animated getBoundingClientRect the runtime reported for the hit.
        const element = selectedElement();
        const base = element !== null ? canvasStaticBase(element.layout) : canvasStaticBase(null);
        setEditor(null);
        setEditorNotice(null);
        setDrag({
          mode: mode,
          pointerId: event.pointerId,
          start: point,
          rect: rect,
          base: base,
          preview: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          stableId: selected.stableId,
          moved: false,
        });
      }

      function onOverlayPointerMove(event) {
        if (drag === null) return;
        const point = stagePoint(event);
        if (point === null) return;
        const dx = point.x - drag.start.x;
        const dy = point.y - drag.start.y;
        let next = { x: drag.rect.x, y: drag.rect.y, width: drag.rect.width, height: drag.rect.height };
        if (drag.mode === 'move') {
          next.x = Math.max(0, Math.min(displayWidthPx - next.width, drag.rect.x + dx));
          next.y = Math.max(0, Math.min(displayHeightPx - next.height, drag.rect.y + dy));
        } else {
          if (drag.mode.includes('w')) {
            const x = Math.max(0, Math.min(drag.rect.x + dx, drag.rect.x + drag.rect.width - 1));
            next.x = x;
            next.width = drag.rect.x + drag.rect.width - x;
          }
          if (drag.mode.includes('e')) next.width = Math.max(1, Math.min(displayWidthPx - next.x, drag.rect.width + dx));
          if (drag.mode.includes('n')) {
            const y = Math.max(0, Math.min(drag.rect.y + dy, drag.rect.y + drag.rect.height - 1));
            next.y = y;
            next.height = drag.rect.y + drag.rect.height - y;
          }
          if (drag.mode.includes('s')) next.height = Math.max(1, Math.min(displayHeightPx - next.y, drag.rect.height + dy));
        }
        const moved = Math.abs(dx) > 1 || Math.abs(dy) > 1;
        setDrag({ ...drag, preview: next, moved: drag.moved || moved });
      }

      async function commitLayout(current) {
        const element = selectedRef.current;
        if (element === null || current === null) return;
        const plan = canvasLayoutPatch({
          mode: current.mode,
          base: current.base,
          animated: current.rect,
          preview: current.preview,
          composition: { width: displayWidthPx, height: displayHeightPx },
        });
        if (plan.ok === false) {
          // Unknown static origin/scale: refuse loudly instead of persisting the
          // animated rectangle. The selection keeps its pre-drag rect (the drag
          // preview was already cleared) and no request is sent.
          setActionError({
            code: plan.code,
            message: t(plan.code === 'E_LAYOUT_SCALE' ? 'video.canvas.layoutScaleUnknown' : 'video.canvas.layoutRefused'),
          });
          return;
        }
        setBusy('layout');
        setActionError(null);
        try {
          await hostRequest('edit', {
            projectId: projectId,
            expectedRevision: revision,
            operationId: operationId(),
            ops: [
              {
                type: 'layout',
                target: element.stableId,
                unit: 'composition-px',
                box: plan.patch,
              },
            ],
          });
          await onReload();
        } catch (error) {
          setActionError(hostError(error));
          onError(hostError(error));
        } finally {
          setBusy(null);
        }
      }

      function onOverlayPointerUp(event) {
        if (drag === null) return;
        const current = drag;
        setDrag(null);
        if (current.moved) {
          suppressClickRef.current = true;
          void commitLayout(current);
        }
      }

      // ---- inline text write attempts ---------------------------------------
      // One operationId binds exactly ONE immutable request. The worker caches
      // results by operationId + canonical request signature and checks that
      // cache BEFORE the revision, so:
      //   - replaying the exact frozen request after a lost response returns the
      //     cached success (applied once);
      //   - the same operationId with a different request is E_OPERATION_REUSED;
      //   - a stale expectedRevision without a cache entry is
      //     E_REVISION_CONFLICT.
      // A changed draft therefore settles the old frozen attempt first and only
      // then starts a new attempt with a new operationId and the settled
      // revision. The id is never switched while the old outcome is unknown.
      function makeTextAttempt(stableId, expectedRevision, value) {
        // One immutable text operation id per attempt: an exact retry replays
        // this request; a changed intent always gets a fresh textOperationId.
        const textOperationId = operationId();
        return {
          operationId: textOperationId,
          expectedRevision: expectedRevision,
          ops: [{ type: 'text', target: stableId, text: value }],
          value: value,
        };
      }

      function sendTextAttempt(attempt) {
        return hostRequest('edit', {
          projectId: projectId,
          expectedRevision: attempt.expectedRevision,
          operationId: attempt.operationId,
          ops: attempt.ops,
        });
      }

      function isRecoverableAttemptError(failure) {
        return canvasIsRevisionConflict(failure) || failure.code === 'E_OPERATION_REUSED';
      }

      function showAttemptFailure(failure, freezeAttempt) {
        setActionError(failure);
        setEditor(function keepDraftAndAttempt(previous) {
          if (previous === null) return null;
          if (isRecoverableAttemptError(failure)) {
            // Recoverable, but never auto-overwritten: reset the attempt and use
            // the explicit refresh path. A later explicit submit creates a new
            // id at the refreshed revision.
            return Object.assign({}, previous, { attempt: null, error: failure, refreshRequired: true });
          }
          // Uncertain/definite failure: the frozen request is kept so the next
          // explicit submit re-sends exactly this request (same id/ops/revision).
          return Object.assign({}, previous, { attempt: freezeAttempt, error: failure, refreshRequired: false });
        });
        onError(failure);
      }

      async function submitText() {
        if (editor === null || busy !== null) return;
        if (editor.refreshRequired === true) {
          // The previous explicit submit hit a revision conflict (or a
          // recoverable E_OPERATION_REUSED). Retrying now refreshes the
          // authoritative revision only and resets the attempt: the user has to
          // submit again afterwards, so a newer project is never overwritten
          // silently and nothing is replayed automatically.
          setBusy('text');
          setActionError(null);
          try {
            await onReload();
            setEditor(function clearConflict(previous) {
              if (previous === null) return null;
              return Object.assign({}, previous, { attempt: null, refreshRequired: false, error: null });
            });
            setEditorNotice(t('video.canvas.revisionRefreshed'));
          } catch (reloadError) {
            setActionError(hostError(reloadError));
            onError(hostError(reloadError));
          } finally {
            setBusy(null);
          }
          return;
        }
        const value = editor.value;
        const stableId = editor.stableId;
        const frozen = editor.attempt;
        let pendingAttempt = frozen;
        setBusy('text');
        setActionError(null);
        try {
          if (frozen !== null && value !== frozen.value) {
            // The retained draft changed after an unknown outcome. A user-
            // initiated submit first settles the OLD attempt by re-sending its
            // exact frozen request; only its result unlocks a new intent/id.
            let settled = null;
            try {
              settled = await sendTextAttempt(frozen);
            } catch (settleError) {
              showAttemptFailure(hostError(settleError), frozen);
              return;
            }
            // If the user closed the editor while the settle was in flight, the
            // old attempt was settled (applied at most once) and the new intent
            // stays unsent: never write new text after an explicit cancel.
            if (editorRef.current === null) return;
            const settledRevision =
              canvasPlainObject(settled) && typeof settled.revision === 'string' ? settled.revision : revision;
            const nextAttempt = makeTextAttempt(stableId, settledRevision, value);
            pendingAttempt = nextAttempt;
            setEditor(function storeNextAttempt(previous) {
              if (previous === null) return null;
              return Object.assign({}, previous, { attempt: nextAttempt, error: null, refreshRequired: false });
            });
            await sendTextAttempt(nextAttempt);
            setEditor(null);
            setEditorNotice(null);
            await onReload();
            return;
          }
          const attempt = frozen !== null ? frozen : makeTextAttempt(stableId, revision, value);
          pendingAttempt = attempt;
          if (frozen === null) {
            setEditor(function storeAttempt(previous) {
              if (previous === null) return null;
              return Object.assign({}, previous, { attempt: attempt, error: null, refreshRequired: false });
            });
          }
          await sendTextAttempt(attempt);
          setEditor(null);
          setEditorNotice(null);
          await onReload();
        } catch (error) {
          // Keep the draft and its target visible; no automatic retry and no
          // silent close. The frozen attempt is preserved on uncertain failures.
          showAttemptFailure(hostError(error), pendingAttempt);
        } finally {
          setBusy(null);
        }
      }

      async function applyStyle() {
        if (selected === null || busy !== null) return;
        setBusy('style');
        setActionError(null);
        try {
          const styles = {};
          if (/^#[0-9a-fA-F]{6}$/.test(styleColor)) styles.color = styleColor;
          const fontSize = Number(styleSize);
          if (Number.isFinite(fontSize) && fontSize >= 8 && fontSize <= 256) styles.fontSize = fontSize;
          if (Object.keys(styles).length === 0) throw { code: 'E_PARAMS', message: t('video.canvas.invalidStyle') };
          await hostRequest('edit', {
            projectId: projectId,
            expectedRevision: revision,
            operationId: operationId(),
            ops: [{ type: 'style', target: selected.stableId, styles: styles }],
          });
          await onReload();
        } catch (error) {
          setActionError(hostError(error));
          onError(hostError(error));
        } finally {
          setBusy(null);
        }
      }

      async function applySceneColor() {
        const scene = currentScene();
        if (scene === null || busy !== null) return;
        const color = canvasNormalizedColor(sceneColor);
        if (color === null) {
          setActionError({ code: 'E_PARAMS', message: t('video.canvas.invalidColor') });
          return;
        }
        setBusy('scene');
        setActionError(null);
        try {
          // A fresh authoritative inspect right before the write: scene.update
          // replaces the complete template, so the copy must come from the
          // current project state and the write must use this revision.
          const fresh = await hostRequest('inspect', { projectId: projectId });
          const prepared = canvasSceneTemplate(fresh, scene.sceneId);
          if (prepared.ok === false) {
            // Refuse instead of destructive guessing: no scene.update is sent.
            setActionError({ code: prepared.code, message: t('video.canvas.templateUnavailable') });
            return;
          }
          const template = prepared.template;
          template.color = color;
          await hostRequest('scene.update', {
            projectId: projectId,
            expectedRevision: prepared.revision,
            operationId: operationId(),
            sceneId: prepared.sceneId,
            template: template,
          });
          await onReload();
        } catch (error) {
          setActionError(hostError(error));
          onError(hostError(error));
        } finally {
          setBusy(null);
        }
      }

      async function addScene() {
        if (busy !== null) return;
        setBusy('scene-add');
        setActionError(null);
        try {
          await hostRequest('scene.create', {
            projectId: projectId,
            expectedRevision: revision,
            operationId: operationId(),
            template: { title: t('video.canvas.newSceneTitle'), duration: 5 },
          });
          await onReload();
        } catch (error) {
          setActionError(hostError(error));
          onError(hostError(error));
        } finally {
          setBusy(null);
        }
      }

      async function historyStep(kind) {
        if (busy !== null) return;
        setBusy(kind);
        setActionError(null);
        try {
          const history = await hostRequest('history', { projectId: projectId, limit: 20 });
          await hostRequest(kind, {
            projectId: projectId,
            expectedRevision: history.revision,
            operationId: operationId(),
          });
          await onReload();
        } catch (error) {
          setActionError(hostError(error));
          onError(hostError(error));
        } finally {
          setBusy(null);
        }
      }

      async function uploadImage(event) {
        const input = event.target;
        const file = input && input.files && input.files[0];
        if (!file) return;
        setUploadBusy(true);
        setActionError(null);
        try {
          const response = await fetch('api/dsh-video/asset-upload', {
            method: 'POST',
            headers: {
              'content-type': file.type || 'application/octet-stream',
              'x-dsh-project-id': projectId,
              'x-dsh-file-name': file.name,
            },
            credentials: 'same-origin',
            body: file,
          });
          const receipt = await response.json();
          if (response.ok === false || !receipt || typeof receipt.receiptId !== 'string') {
            throw (receipt && receipt.error) || { code: 'E_ASSET_UPLOAD', message: t('video.canvas.uploadFailed') };
          }
          await hostRequest('asset.import', {
            projectId: projectId,
            expectedRevision: revision,
            operationId: operationId(),
            receiptId: receipt.receiptId,
          });
          await onReload();
        } catch (error) {
          setActionError(hostError(error));
          onError(hostError(error));
        } finally {
          setUploadBusy(false);
          try {
            input.value = '';
          } catch (_error) {
            /* file input reset is best effort */
          }
        }
      }

      async function useAsset(assetPath) {
        const scene = currentScene();
        if (scene === null || busy !== null) return;
        const shot = canvasNormalizedAssetPath(assetPath);
        if (shot === null) {
          setActionError({ code: 'E_PARAMS', message: t('video.canvas.invalidAsset') });
          return;
        }
        setBusy('asset-use');
        setActionError(null);
        try {
          // Same fresh-inspect rule as the background change: copy the complete
          // authoritative template and change only the shot. The UI colour state
          // must never leak into an unrelated Scene write.
          const fresh = await hostRequest('inspect', { projectId: projectId });
          const prepared = canvasSceneTemplate(fresh, scene.sceneId);
          if (prepared.ok === false) {
            setActionError({ code: prepared.code, message: t('video.canvas.templateUnavailable') });
            return;
          }
          const template = prepared.template;
          template.shot = shot;
          await hostRequest('scene.update', {
            projectId: projectId,
            expectedRevision: prepared.revision,
            operationId: operationId(),
            sceneId: prepared.sceneId,
            template: template,
          });
          await onReload();
        } catch (error) {
          setActionError(hostError(error));
          onError(hostError(error));
        } finally {
          setBusy(null);
        }
      }

      async function exportVideo() {
        if (busy !== null) return;
        setBusy('render');
        setActionError(null);
        setExportState({ state: 'running' });
        try {
          const job = await hostRequest('render', { projectId: projectId, revision: revision });
          const jobId = job.jobId;
          let result = job;
          for (let attempt = 0; attempt < 240; attempt += 1) {
            await new Promise(function wait(resolve) {
              setTimeout(resolve, 500);
            });
            result = await hostRequest('status', { jobId: jobId });
            if (['succeeded', 'failed', 'cancelled', 'timed_out'].includes(result.state)) break;
          }
          if (result.state !== 'succeeded') throw { code: 'E_RENDER', message: t('video.canvas.exportFailed') };
          setExportState({ state: 'ready', jobId: jobId, url: 'api/dsh-video/artifact?jobId=' + encodeURIComponent(jobId) });
        } catch (error) {
          setExportState({ state: 'error' });
          setActionError(hostError(error));
          onError(hostError(error));
        } finally {
          setBusy(null);
        }
      }

      function togglePlayback() {
        if (playing) {
          setPlaying(false);
          void postActiveCommand('pause');
        } else {
          setPlaying(true);
          void postActiveCommand('play');
        }
      }

      function seekTo(nextTime) {
        const value = Math.max(0, Math.min(displayDuration, Number(nextTime) || 0));
        setTime(value);
        void postActiveCommand('seek', { time: value });
      }

      // Open the in-place text editor for one inspected text-capable element.
      // `hit` is a runtime hit (or the current selection): the text content is
      // authoritative from the runtime, the element only proves the capability.
      function openEditorForHit(hit) {
        if (canvasPlainObject(hit) === false || typeof hit.stableId !== 'string' || hit.stableId.length === 0) return;
        if (editorRef.current !== null) return;
        const element = elements.find(function same(item) {
          return item.stableId === hit.stableId;
        });
        const capabilities = element !== null && Array.isArray(element.capabilities) ? element.capabilities : [];
        if (capabilities.includes('text') === false) return;
        const rect = canvasValidRect(hit.rect);
        if (rect === null) return;
        setSelectedSafe(hit);
        setPlaying(false);
        void postActiveCommand('pause');
        setEditorNotice(null);
        setEditor({
          stableId: hit.stableId,
          value: typeof hit.text === 'string' ? hit.text : element !== null && typeof element.text === 'string' ? element.text : '',
          rect: rect,
          // `attempt` freezes exactly ONE immutable write request when the user
          // first submits. It stays null while the editor only holds a draft.
          attempt: null,
          error: null,
          refreshRequired: false,
        });
      }

      function openTextEditor() {
        if (selected === null || isTextSelected() === false) return;
        openEditorForHit(selected);
      }

      function pointInsideRect(point, rect) {
        return (
          point !== null &&
          point.x >= rect.x &&
          point.x <= rect.x + rect.width &&
          point.y >= rect.y &&
          point.y <= rect.y + rect.height
        );
      }

      // A real double-click cannot rely on the selection node as its target:
      // beginDrag sets pointer capture on the overlay, so pointerup (and per
      // spec click/dblclick) retarget to the nearest common ancestor, the
      // overlay. Handle the gesture there; keep the selection-node handler as a
      // compatibility path for synthetic events and capture-less browsers.
      function onOverlayDoubleClick(event) {
        if (editorRef.current !== null || drag !== null) return;
        if (
          event !== null &&
          typeof event === 'object' &&
          event.target !== undefined &&
          event.currentTarget !== undefined &&
          event.target !== event.currentTarget
        ) {
          return;
        }
        const point = stagePoint(event);
        if (point === null) return;
        const current = selected;
        const currentRect = current !== null ? canvasValidRect(current.rect) : null;
        if (current !== null && isTextSelected() && currentRect !== null && pointInsideRect(point, currentRect)) {
          openEditorForHit(current);
          return;
        }
        void postActiveCommand('hitTest', point).then(function openOnHit(payload) {
          if (editorRef.current !== null || drag !== null) return;
          openEditorForHit(payload !== null && typeof payload === 'object' && payload.hit ? payload.hit : null);
        });
      }

      function selectionRect() {
        if (drag !== null) return drag.preview;
        return selected === null ? null : selected.rect;
      }

      const selectedBox = selectionRect();
      const selectedScale = scale;

      // One physical iframe per slot: `active` occupies the visible slot and the
      // preloading `candidate` the hidden one. The candidate is mounted at the
      // same composition size so its fixed runtime loads, but is invisible and
      // cannot receive pointer input.
      function slotFrameNode(index) {
        const instance = index === visibleSlot ? active : candidate;
        if (instance === null) return null;
        const visible = index === visibleSlot && active !== null;
        // R2F: size/scale the iframe from ITS OWN metadata so the hidden
        // candidate loads at its own composition viewport without touching the
        // displayed (active) geometry.
        const instanceScale = stageSize.width > 0 && stageSize.height > 0
          ? Math.min(stageSize.width / instance.width, stageSize.height / instance.height)
          : 0;
        return h('iframe', {
          key: 'slot-' + index,
          ref: index === 0 ? iframeRef : slot1Ref,
          className: visible ? 'dv-stage-frame' : 'dv-stage-frame dv-stage-frame-candidate',
          title: t('video.canvas.frameTitle'),
          src: instance.src,
          // The sandbox document must keep its composition viewport: the
          // runtime's hitTest uses the iframe document's CSS pixels, so a
          // letterboxed (smaller) viewport would clip the frame and silently
          // miss composition coordinates beyond it. Keep the element at the
          // composition size and scale the whole element visually instead.
          style: {
            width: instance.width + 'px',
            height: instance.height + 'px',
            transformOrigin: 'top left',
            transform: 'scale(' + (instanceScale > 0 ? instanceScale : 1) + ')',
            visibility: visible ? 'visible' : 'hidden',
            pointerEvents: visible ? 'auto' : 'none',
          },
          'aria-hidden': visible ? 'false' : 'true',
          sandbox: 'allow-scripts',
          allow: 'autoplay *',
          referrerPolicy: 'no-referrer',
          onLoad: function runtimeLoaded() {
            setTimeout(function recoverState() {
              void postSlotCommand(index, 'state');
            }, 120);
          },
        });
      }

      function retryRequestedRevision() {
        // An explicit user retry restarts the automatic-retry allowance.
        const restore = {
          time: timeRef.current,
          stableId: selectedRef.current ? selectedRef.current.stableId : null,
          playing: playingRef.current,
        };
        retryRestoreRef.current = restore;
        attemptRef.current = { revision: targetRevision, attempt: 0 };
        setPreviewAttempt({ revision: targetRevision, attempt: 0 });
        void loadTarget(targetRevision, restore);
      }

      // Compact in-place feedback next to the stage when a candidate revision
      // fails while an active composition is still displayed.
      function previewNoticeNode() {
        if (previewNotice === null) return null;
        return h(
          'div',
          { className: 'dv-preview-notice', role: 'alert', key: 'preview-notice' },
          h('span', { className: 'dv-preview-notice-text' }, errorText(previewNotice, t)),
          h(
            'button',
            { type: 'button', className: 'dv-button dv-button-quiet dv-preview-notice-retry', onClick: retryRequestedRevision },
            t('video.canvas.retry')
          )
        );
      }

      function canvasBody() {
        if (phase === 'error' && active === null) {
          // First load failed: no composition was ever displayed, so the full
          // recoverable error remains the honest state.
          return h(
            'div',
            { className: 'dv-canvas-status', role: 'alert' },
            h('p', null, errorText(frameError || { code: 'E_SNAPSHOT' }, t)),
            h(
              'button',
              {
                type: 'button',
                className: 'dv-button dv-button-quiet',
                onClick: retryRequestedRevision,
              },
              t('video.canvas.retry')
            )
          );
        }
        if ((active === null && candidate === null) || displayWidth === 0 || displayHeight === 0) {
          return h('p', { className: 'dv-canvas-status', role: 'status' }, h('span', { className: 'dv-loader', 'aria-hidden': 'true' }), t('video.canvas.loading'));
        }
        return h(
          'div',
          {
            className: 'dv-stage dv-canvas-stage',
            'data-ready': active !== null ? 'true' : 'false',
            ref: stageRef,
            style: { width: displayWidth + 'px', height: displayHeight + 'px' },
          },
          slotFrameNode(0),
          slotFrameNode(1),
          active === null
            ? h(
                'p',
                { className: 'dv-canvas-status dv-canvas-status-overlay', role: 'status', 'data-overlay': 'true' },
                h('span', { className: 'dv-loader', 'aria-hidden': 'true' }),
                t('video.canvas.loading')
              )
            : null,
          previewOnly
            ? null
            : h(
            'div',
            {
              className: 'dv-overlay',
              ref: overlayRef,
              onClick: onOverlayClick,
              onDoubleClick: onOverlayDoubleClick,
              onPointerMove: onOverlayPointerMove,
              onPointerUp: onOverlayPointerUp,
              onPointerCancel: function cancelPointer() {
                setDrag(null);
              },
            },
            selectedBox !== null
              ? h(
                  'div',
                  {
                    className: 'dv-selection',
                    style: {
                      left: selectedBox.x * selectedScale + 'px',
                      top: selectedBox.y * selectedScale + 'px',
                      width: selectedBox.width * selectedScale + 'px',
                      height: selectedBox.height * selectedScale + 'px',
                    },
                    onPointerDown: function startMove(event) {
                      beginDrag(event, 'move');
                    },
                    onDoubleClick: openTextEditor,
                  },
                  ['nw', 'ne', 'sw', 'se'].map(function handle(position) {
                    return h('span', {
                      key: position,
                      className: 'dv-handle ' + 'dv-handle-' + position,
                      onPointerDown: function startResize(event) {
                        beginDrag(event, position);
                      },
                    });
                  })
                )
              : null,
            editor !== null
              ? h('textarea', {
                  className: 'dv-inline-editor',
                  style: {
                    left: editor.rect.x * selectedScale + 'px',
                    top: editor.rect.y * selectedScale + 'px',
                    width: Math.max(80, editor.rect.width * selectedScale) + 'px',
                    height: Math.max(28, editor.rect.height * selectedScale) + 'px',
                  },
                  value: editor.value,
                  autoFocus: true,
                  onChange: function updateEditor(event) {
                    const nextValue = event.target.value;
                    setEditor(function updateDraft(previous) {
                      if (previous === null) return null;
                      return Object.assign({}, previous, { value: nextValue });
                    });
                  },
                  onKeyDown: function editorKeys(event) {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setEditor(null);
                      setEditorNotice(null);
                    } else if (event.key === 'Enter' && event.shiftKey === false) {
                      event.preventDefault();
                      void submitText();
                    }
                  },
                })
              : null,
            editor !== null && (editor.error !== null || editorNotice !== null || editor.refreshRequired === true)
              ? h(
                  'div',
                  {
                    className: 'dv-editor-actions',
                    style: {
                      left: editor.rect.x * selectedScale + 'px',
                      top: (editor.rect.y + editor.rect.height) * selectedScale + 4 + 'px',
                    },
                  },
                  editor.error !== null ? h('span', { className: 'dv-tool-error', role: 'alert' }, errorText(editor.error, t)) : null,
                  editorNotice !== null ? h('span', { className: 'dv-tool-hint' }, editorNotice) : null,
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dv-button dv-button-quiet dv-editor-retry',
                      onClick: function retryTextSave() {
                        void submitText();
                      },
                      disabled: busy !== null,
                    },
                    t('video.canvas.retryText')
                  )
                )
              : null
          )
        );
      }

      const scene = currentScene();
      return h(
        'section',
        {
          className: 'dv-canvas-shell',
          // Truthful markers: the revision marker names only the ACTIVE displayed
          // composition (empty before the first ready), while the target marker
          // names the requested revision being loaded/pending/failed.
          'data-canvas-revision': active !== null ? active.revision : '',
          'data-canvas-target-revision': targetRevision === null || targetRevision === undefined ? '' : String(targetRevision),
          'data-canvas-phase': phase,
          'data-preview-only': previewOnly ? 'true' : 'false',
          'data-preview-pending': active !== null && active.revision !== targetRevision && previewNotice === null ? 'true' : 'false',
          // P3-017 B1 diagnostics: the current attempt for the target revision and
          // a bounded ring of the most recent attempts (revision:attempt:
          // snapshotMs:readyMs:errorCode separated by "|").
          'data-preview-attempt': (previewAttempt.revision === null ? '' : String(previewAttempt.revision).slice(0, 8) + ':' + String(previewAttempt.attempt)),
          'data-preview-retrying': previewRetrying ? 'true' : 'false',
          'data-preview-diagnostics': previewDiagnosticsText(),
        },
        h('div', { className: 'dv-canvas-wrap', ref: wrapRef }, canvasBody()),
        previewNoticeNode(),
        active !== null && active.revision !== targetRevision && previewNotice === null ? h('span', { className: 'dv-preview-progress', role: 'status' }, h('span', { className: 'dv-status-dot', 'aria-hidden': 'true' }), t('video.canvas.updatingPreview')) : null,
        h(
          'div',
          { className: 'dv-canvas-bar' },
          h('button', { type: 'button', className: 'dv-button dv-button-quiet dv-play', onClick: togglePlayback, disabled: phase !== 'ready', 'aria-label': playing ? t('video.canvas.pause') : t('video.canvas.play'), title: playing ? t('video.canvas.pause') : t('video.canvas.play') }, h(StudioIcon, { name: playing ? 'pause' : 'play' }), h('span', { className: 'dv-sr-only' }, playing ? t('video.canvas.pause') : t('video.canvas.play'))),
          h(
            'input',
            {
              className: 'dv-seek',
              type: 'range',
              min: '0',
              max: String(displayDuration || 1),
              step: '0.01',
              value: String(Math.min(time, displayDuration || 1)),
              'aria-label': t('video.canvas.timeline'),
              disabled: phase !== 'ready',
              onChange: function seek(event) {
                seekTo(event.target.value);
              },
            }
          ),
          h('span', { className: 'dv-time' }, formatSeconds(time) + ' / ' + formatSeconds(displayDuration)),
          previewOnly ? null : h('button', { type: 'button', className: 'dv-button dv-button-quiet', onClick: function undo() { void historyStep('undo'); }, disabled: busy !== null, title: t('video.canvas.undo') }, t('video.canvas.undo')),
          previewOnly ? null : h('button', { type: 'button', className: 'dv-button dv-button-quiet', onClick: function redo() { void historyStep('redo'); }, disabled: busy !== null, title: t('video.canvas.redo') }, t('video.canvas.redo')),
          previewOnly ? h('button',{type:'button',className:'dv-button dv-button-quiet',onClick:()=>{setAudioOpen(!audioOpen);setDrawerOpen(false);}},t('video.audio.title')):null,
          h('button', { type: 'button', className: 'dv-button dv-button-quiet', onClick: function drawer() { setDrawerOpen(!drawerOpen); }, 'aria-expanded': drawerOpen ? 'true' : 'false' }, t('video.canvas.materials')),
          previewOnly ? null : h('button', { type: 'button', className: 'dv-button dv-button-quiet', onClick: function add() { void addScene(); }, disabled: busy !== null }, t('video.canvas.addScene')),
          previewOnly
            ? null
            : exportState && exportState.state === 'ready'
            ? h('a', { className: 'dv-button dv-button-primary dv-export-link', href: exportState.url, download: 'dsh-video.mp4' }, t('video.canvas.download'))
            : h('button', { type: 'button', className: 'dv-button dv-button-primary', onClick: function render() { void exportVideo(); }, disabled: busy !== null }, exportState && exportState.state === 'running' ? t('video.canvas.exporting') : t('video.canvas.export'))
        ),
        previewOnly ? null : h(
          'div',
          { className: 'dv-canvas-tools' },
          scene === null
            ? null
            : h(
                'label',
                { className: 'dv-tool-field' },
                h('span', null, t('video.canvas.sceneColor')),
                h('input', {
                  type: 'color',
                  value: sceneColor,
                  onChange: function pickSceneColor(event) {
                    setSceneColor(event.target.value);
                  },
                }),
                h('button', { type: 'button', className: 'dv-button dv-button-quiet', onClick: function applyScene() { void applySceneColor(); }, disabled: busy !== null }, t('video.canvas.apply'))
              ),
          isTextSelected() && selected !== null
            ? h(
                'div',
                { className: 'dv-tool-field' },
                h('span', null, t('video.canvas.textStyle')),
                h('input', { type: 'color', value: styleColor, onChange: function pickColor(event) { setStyleColor(event.target.value); } }),
                h('input', {
                  className: 'dv-size-input',
                  type: 'number',
                  min: '8',
                  max: '256',
                  step: '1',
                  value: String(styleSize),
                  onChange: function pickSize(event) {
                    setStyleSize(Number(event.target.value));
                  },
                }),
                h('button', { type: 'button', className: 'dv-button dv-button-quiet', onClick: function apply() { void applyStyle(); }, disabled: busy !== null }, t('video.canvas.apply'))
              )
            : h('span', { className: 'dv-tool-hint' }, t('video.canvas.hint')),
          actionError !== null ? h('span', { className: 'dv-tool-error', role: 'alert' }, errorText(actionError, t)) : null,
          busy !== null ? h('span', { className: 'dv-tool-hint' }, t('video.canvas.busy')) : null
        ),
        previewOnly && props.timelineEnabled!==false ? h(TimelinePanel,{key:projectId,t,projectId,revision:inspected.revision,time,onSeek:seekTo,onReload,assetToAdd,onAssetConsumed:()=>setAssetToAdd(null),onQueueAsset:setAssetToAdd}) : null,
        audioOpen && previewOnly ? h(AudioPanel,{key:projectId,t,projectId,onClose:()=>setAudioOpen(false),onAdd:a=>{setAssetToAdd(a);setAudioOpen(false);}}):null,
        drawerOpen && previewOnly ? h(MediaLibraryPanel,{key:projectId,t:t,projectId:projectId,onClose:()=>setDrawerOpen(false),onAdd:asset=>{setAssetToAdd(asset);setDrawerOpen(false);}}) : null,
        drawerOpen && previewOnly === false
          ? h(
              'aside',
              { className: 'dv-drawer', 'aria-label': t('video.canvas.materials') },
              h(
                'div',
                { className: 'dv-drawer-head' },
                h('span', null, t('video.canvas.materials')),
                h('button', { type: 'button', className: 'dv-icon-button', onClick: function close() { setDrawerOpen(false); }, 'aria-label': t('video.canvas.close') }, '×')
              ),
              h(
                'label',
                { className: 'dv-upload' },
                uploadBusy ? t('video.canvas.uploading') : t('video.canvas.upload'),
                h('input', { type: 'file', accept: 'image/png,image/jpeg', onChange: uploadImage, disabled: uploadBusy })
              ),
              images.length === 0
                ? h('p', { className: 'dv-tool-hint' }, t('video.canvas.noAssets'))
                : h(
                    'ul',
                    { className: 'dv-asset-list' },
                    images.map(function assetRow(file) {
                      return h(
                        'li',
                        { key: file.path, className: 'dv-asset-row' },
                        h('span', { className: 'dv-asset-name', title: file.path }, file.path.split('/').pop()),
                        h('button', { type: 'button', className: 'dv-button dv-button-quiet', onClick: function use() { void useAsset(file.path); }, disabled: busy !== null }, t('video.canvas.useAsset'))
                      );
                    })
                  )
            )
          : null
      );
    }
    //#endregion

    function VideoWorkspace(props) {
      const t = props.t;
      const onBack = props.onBack;
      const sessions = props.sessions !== undefined && props.sessions !== null ? props.sessions : null;
      const layout = props.layout !== undefined && props.layout !== null ? props.layout : null;
      const sessionKitAvailable = typeof props.SessionProvider === 'function' && typeof props.renderFactorySlot === 'function';
      const ui = usePluginState();
      // P3-016 resizable right pane: a reflected inline CSS variable; pointer
      // and keyboard updates never touch project/revision authority.
      const [aiPaneRatio, setAiPaneRatio] = React.useState(readAiPaneRatio);
      // M1-05: Host ui-state (last project / layout) + visible save status.
      const [uiStateSupported, setUiStateSupported] = React.useState(true);
      const [saveStatus, setSaveStatus] = React.useState('idle');
      const [saveRetryToken, setSaveRetryToken] = React.useState(0);
      const aiPaneRatioRef = React.useRef(aiPaneRatio);
      aiPaneRatioRef.current = aiPaneRatio;
      const [resizing, setResizing] = React.useState(false);
      const dragRef = React.useRef(null);
      const mainRef = React.useRef(null);
      // P3-016: the work name is the inline-rename trigger; the arrow opens the
      // project picker so clicking the name can never silently switch projects.
      const [projectMenuOpen, setProjectMenuOpen] = React.useState(false);
      const [renameDraft, setRenameDraft] = React.useState(null);
      const [renameBusy, setRenameBusy] = React.useState(false);
      const [renameError, setRenameError] = React.useState(null);
      const [folderBusy, setFolderBusy] = React.useState(null);
      const [folderNotice, setFolderNotice] = React.useState(null);
      const projectToggleRef = React.useRef(null);
      const projectItemRef = React.useRef(null);
      const projectNameRef = React.useRef(null);
      const renameInputRef = React.useRef(null);
      const focusNameAfterRenameRef = React.useRef(false);

      // Panel-switch memory keeps only the visible view: the Host worker stays the
      // authority for project/revision/session truth. On a later mount the
      // remembered project is re-validated against `project.list` before it opens.
      const remembered = editorMemory === null ? {} : editorMemory;
      const [project, setProject] = React.useState(remembered.project || null);
      const [boot, setBoot] = React.useState('idle');
      const [error, setError] = React.useState(remembered.error || null);
      const [projectId, setProjectId] = React.useState(typeof remembered.projectId === 'string' ? remembered.projectId : '');
      const [projectChoices, setProjectChoices] = React.useState([]);
      const projectTitlesRef = React.useRef(new Map(Array.isArray(remembered.projectTitles) ? remembered.projectTitles : []));
      if (project !== null && projectId !== '') {
        projectTitlesRef.current.set(projectId, studioProjectTitle(project, t('video.project.untitled')));
        if (projectTitlesRef.current.size > 64) projectTitlesRef.current.delete(projectTitlesRef.current.keys().next().value);
      }
      const [projectBusy, setProjectBusy] = React.useState(null);
      const projectIdRef = React.useRef(projectId);
      projectIdRef.current = projectId;
      const latestRevisionRef = React.useRef(remembered.project && typeof remembered.project.revision === 'string' ? remembered.project.revision : null);
      if (project !== null && typeof project.revision === 'string') latestRevisionRef.current = project.revision;
      const [sessionState, setSessionState] = React.useState(remembered.sessionState || { status: 'idle', items: [], activeSessionId: null, error: null });
      const [activeSessionId, setActiveSessionId] = React.useState(typeof remembered.activeSessionId === 'string' ? remembered.activeSessionId : null);
      const [sessionBusy, setSessionBusy] = React.useState(null);
      const [historyOpen, setHistoryOpen] = React.useState(false);
      const [hostConversationOpen, setHostConversationOpen] = React.useState(false);
      const [retryTick, setRetryTick] = React.useState(0);
      const [sessionDiagnostic, setSessionDiagnostic] = React.useState(null);
      const [preview, setPreview] = React.useState(null);
      const previewToken = React.useRef(0);
      const activeSessionIdRef = React.useRef(null);
      activeSessionIdRef.current = activeSessionId;
      const sessionListToken = React.useRef(0);
      const sessionSwitchToken = React.useRef(0);
      const sessionCreatePending = React.useRef(false);
      const aliveRef = React.useRef(true);
      // P3-017 B3 product export: one render bound to the revision inspected when
      // the button was pressed. Later AI publishes never change what is exported;
      // the worker's real stage/progress feed the visible progress text, and the
      // elapsed time is derived from the real start timestamp.
      const [exportState, setExportState] = React.useState(null);
      const [exportElapsed, setExportElapsed] = React.useState(0);
      const exportToken = React.useRef(0);
      const exportStateRef = React.useRef(null);
      exportStateRef.current = exportState;
      // Synchronous in-flight gate: two clicks in the same tick cannot both pass
      // the state check before the first render (state itself is async).
      const exportInFlightRef = React.useRef(false);
      const exportRunning = exportState !== null && exportState.phase === 'running';
      const bootToken = React.useRef(0);
      const bootStarted = React.useRef(false);
      const autoProvisionedRef = React.useRef(false);
      const autoSessionProjectRef = React.useRef(null);
      const sessionListSnapshot = useSessionListSnapshot(sessions);

      React.useEffect(
        function keepAlive() {
          aliveRef.current = true;
          return function cleanupWorkspace() {
            aliveRef.current = false;
            // Never leave a render job running with no UI left to cancel it.
            exportInFlightRef.current = false;
            const current = exportStateRef.current;
            if (current !== null && current.phase === 'running' && typeof current.jobId === 'string') {
              hostRequest('cancel', { jobId: current.jobId }).catch(function ignoreExportCancel() {});
            }
          };
        },
        []
      );

      // Advance the elapsed label while a render is running; the interval only
      // re-renders the label and stops with the terminal state.
      React.useEffect(
        function tickExportElapsed() {
          if (exportRunning === false) return function noExportTick() {};
          const startedAt = exportState === null || !Number.isFinite(exportState.startedAt) ? Date.now() : exportState.startedAt;
          setExportElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
          const timer = setInterval(function tickElapsed() {
            const current = exportStateRef.current;
            if (current === null || current.phase !== 'running') return;
            setExportElapsed(Math.max(0, Math.floor((Date.now() - current.startedAt) / 1000)));
          }, 1000);
          return function stopExportTick() {
            clearInterval(timer);
          };
        },
        [exportRunning]
      );

      // The host main conversation is outside this panel; when it is the visible
      // main panel we must not mount a second editable root for the same
      // Session. Subscribe instead of checking once: the host panel can change
      // while the plugin stays mounted in its declaration lifetime.
      React.useEffect(
        function watchHostConversation() {
          if (layout === null || typeof layout !== 'object' || !layout.panelInfo || typeof layout.panelInfo.getSnapshot !== 'function') {
            return function noPanelInfo() {};
          }
          function readPanelInfo() {
            try {
              const snapshot = layout.panelInfo.getSnapshot();
              setHostConversationOpen(Boolean(snapshot && snapshot.activePanelId === 'conversation'));
            } catch (_error) {
              /* the host panel source is advisory; embedding still needs the reference */
            }
          }
          readPanelInfo();
          let unsubscribe = null;
          if (typeof layout.panelInfo.subscribe === 'function') {
            try {
              unsubscribe = layout.panelInfo.subscribe(readPanelInfo);
            } catch (_error) {
              unsubscribe = null;
            }
          }
          return function stopPanelInfo() {
            if (typeof unsubscribe !== 'function') return;
            try {
              unsubscribe();
            } catch (_error) {
              /* observed source cleanup is best effort */
            }
          };
        },
        []
      );

      // Conversation-first boot: one `project.list` decides whether the
      // remembered / most recent managed project opens or a first project is
      // provisioned. The guard ref keeps a re-rendered effect from issuing the
      // creation pair twice.
      React.useEffect(
        function prepareWorkspace() {
          if (bootStarted.current) return;
          bootStarted.current = true;
          void bootstrap();
        },
        []
      );

      // Read-only installation preflight: kit presence is checked locally and
      // the Host reports only safe status/version facts (no messages, titles or
      // credentials). It never enables anything; failures stay advisory.
      React.useEffect(
        function diagnoseCreationSessions() {
          void diagnoseSessions();
        },
        []
      );

      // Automatic preview follow: while a project is loaded the panel polls the
      // worker revision (exactly like the Host reports it) and swaps in the new
      // snapshot. This is the only UI-side trigger for a publish: an AI Tool
      // `project.compose` appears here without a manual refresh.
      React.useEffect(
        function followPublishedRevision() {
          const followedProjectId = projectId;
          if (typeof followedProjectId !== 'string' || followedProjectId.length === 0 || project === null) return function noRevisionPoll() {};
          let cancelled = false;
          async function inspectCurrent() {
            let next;
            try {
              next = await hostRequest('inspect', { projectId: followedProjectId });
            } catch (_pollError) {
              /* A transient poll failure keeps the last valid preview mounted. */
              return;
            }
            // Late responses may only update the same project this poll belongs
            // to; a stale project's result can never overwrite the current one.
            if (cancelled || !aliveRef.current || projectIdRef.current !== followedProjectId) return;
            if (next === null || typeof next !== 'object' || typeof next.revision !== 'string') return;
            if (next.revision !== latestRevisionRef.current) {
              latestRevisionRef.current = next.revision;
              setProject(next);
            }
          }
          void inspectCurrent();
          const timer = setInterval(function pollRevision() {
            void inspectCurrent();
          }, REVISION_POLL_MS);
          return function stopRevisionPoll() {
            cancelled = true;
            clearInterval(timer);
          };
        },
        [projectId, project === null]
      );

      // A panel switch is a view switch: the worker keeps the project and the
      // mapped Sessions, and this memory restores the visible view instead of
      // silently clearing progress.
      React.useEffect(function rememberVisibleState() {
        editorMemory = {
          project: project,
          error: error,
          projectId: projectId,
          projectTitles: Array.from(projectTitlesRef.current.entries()),
          sessionState: sessionState,
          activeSessionId: activeSessionId,
        };
      });

      // M1-05: Host ui-state writes are scheduled imperatively by the event that
      // changed the state (no effect churn). The save indicator stays visible;
      // an older Host without ui-state degrades silently to local view memory.
      const uiStateSupportedRef = React.useRef(true);
      const lastProjectSaveTimer = React.useRef(null);
      const paneRatioSaveTimer = React.useRef(null);
      const lastWrittenProjectId = React.useRef('');

      function markUiStateSupport(value) {
        uiStateSupportedRef.current = value;
        setUiStateSupported(value);
      }

      function classifyUiStateError(error) {
        const code = error && error.code;
        if (code === 'E_METHOD' || code === 'E_UI_STATE_CONFIG' || code === 'E_CONFIGURATION' || code === 'E_UI_STATE_UNAVAILABLE') {
          markUiStateSupport(false);
          return 'unsupported';
        }
        return 'failed';
      }

      function scheduleLastProjectWrite(targetProjectId) {
        if (typeof targetProjectId !== 'string' || targetProjectId === '') return;
        if (uiStateSupportedRef.current === false) return;
        if (lastWrittenProjectId.current === targetProjectId) return;
        lastWrittenProjectId.current = targetProjectId;
        if (lastProjectSaveTimer.current !== null) clearTimeout(lastProjectSaveTimer.current);
        setSaveStatus('saving');
        lastProjectSaveTimer.current = setTimeout(function writeLastProject() {
          lastProjectSaveTimer.current = null;
          hostRequest('ui.state.set', { patch: { lastProjectId: targetProjectId } }).then(
            function saved() {
              if (aliveRef.current) setSaveStatus('saved');
            },
            function failed(error) {
              if (!aliveRef.current) return;
              const kind = classifyUiStateError(error);
              setSaveStatus(kind === 'unsupported' ? 'idle' : 'failed');
            }
          );
        }, 250);
      }

      function schedulePaneRatioWrite(ratio) {
        if (uiStateSupportedRef.current === false) return;
        if (typeof ratio !== 'number' || Number.isFinite(ratio) === false) return;
        if (paneRatioSaveTimer.current !== null) clearTimeout(paneRatioSaveTimer.current);
        paneRatioSaveTimer.current = setTimeout(function writeLayout() {
          paneRatioSaveTimer.current = null;
          hostRequest('ui.state.set', { patch: { layout: { aiPaneRatio: ratio } } }).catch(function failed(error) {
            if (aliveRef.current) classifyUiStateError(error);
          });
        }, 400);
      }

      function retrySaveLastProject() {
        if (saveStatus !== 'failed') return;
        setSaveStatus('saving');
        const target = projectIdRef.current;
        if (typeof target !== 'string' || target === '') {
          setSaveStatus('idle');
          return;
        }
        lastWrittenProjectId.current = '';
        scheduleLastProjectWrite(target);
      }

      // Focus management for the project picker menu: opening moves focus onto
      // the current project item; Escape/Tab close it and return focus to the
      // arrow button (never left on the removed node). Only element-level
      // handlers are used, so unmount cannot leak a global listener.
      React.useEffect(
        function focusOpenProjectItem() {
          if (!projectMenuOpen || projectItemRef.current === null || typeof projectItemRef.current.focus !== 'function') return;
          try {
            projectItemRef.current.focus();
          } catch (_error) {
            /* focus is best-effort; the menu stays usable */
          }
        },
        [projectMenuOpen]
      );

      // Inline rename: focus (and select) the input when it appears.
      React.useEffect(
        function focusRenameInput() {
          if (renameDraft === null || renameInputRef.current === null) return;
          try {
            renameInputRef.current.focus();
            if (typeof renameInputRef.current.select === 'function') renameInputRef.current.select();
          } catch (_error) {
            /* focus is best-effort; the input stays usable */
          }
        },
        [renameDraft === null]
      );
      // After a save/cancel settles, focus goes back to the name button once the
      // input has been removed from the tree.
      React.useEffect(function restoreNameFocus() {
        if (focusNameAfterRenameRef.current === false || renameDraft !== null) return;
        focusNameAfterRenameRef.current = false;
        try {
          if (projectNameRef.current !== null && typeof projectNameRef.current.focus === 'function') {
            projectNameRef.current.focus();
          }
        } catch (_error) {
          /* focus is best-effort */
        }
      });

      function focusProjectToggle() {
        try {
          if (projectToggleRef.current !== null && typeof projectToggleRef.current.focus === 'function') {
            projectToggleRef.current.focus();
          }
        } catch (_error) {
          /* focus is best-effort; the menu is already closed */
        }
      }

      function closeProjectMenu() {
        setProjectMenuOpen(false);
        focusProjectToggle();
      }

      function toggleProjectMenu() {
        if (projectMenuOpen) {
          closeProjectMenu();
        } else {
          setFolderNotice(null);
          setProjectMenuOpen(true);
        }
      }

      function onProjectToggleKeyDown(event) {
        if (!event) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!projectMenuOpen) {
            setProjectMenuOpen(true);
            return;
          }
          if (projectItemRef.current !== null && typeof projectItemRef.current.focus === 'function') {
            projectItemRef.current.focus();
          }
        } else if (event.key === 'Escape' && projectMenuOpen) {
          event.preventDefault();
          closeProjectMenu();
        }
      }

      function onProjectMenuKeyDown(event) {
        if (!event) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          closeProjectMenu();
        } else if (event.key === 'Tab') {
          event.preventDefault();
          closeProjectMenu();
        }
      }

      // ── P3-016 inline project rename (presentation metadata only) ─────────
      function projectDisplayTitle() {
        return studioProjectTitle(project, t('video.project.untitled'));
      }

      function projectChoiceTitle(item, index) {
        if (item !== null && typeof item === 'object' && typeof item.title === 'string') {
          const stored = item.title.trim();
          if (stored.length > 0) return stored.slice(0, 120);
        }
        const rememberedTitle = item !== null && typeof item === 'object'
          ? projectTitlesRef.current.get(item.projectId)
          : null;
        if (typeof rememberedTitle === 'string' && rememberedTitle.length > 0) return rememberedTitle;
        return t('video.project.untitled') + (typeof index === 'number' ? ' ' + String(index + 1) : '');
      }

      function startRename() {
        if (renameBusy || projectBusy !== null || projectId === '') return;
        setProjectMenuOpen(false);
        setRenameError(null);
        setRenameDraft(projectDisplayTitle());
      }

      function cancelRename() {
        setRenameDraft(null);
        setRenameError(null);
        focusNameAfterRenameRef.current = true;
      }

      function onRenameChange(event) {
        const raw = event !== null && event.target !== undefined ? event.target.value : '';
        setRenameDraft(typeof raw === 'string' ? raw : '');
        if (renameError !== null) setRenameError(null);
      }

      function onRenameKeyDown(event) {
        if (!event) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          void submitRename();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelRename();
        }
      }

      async function submitRename() {
        if (renameBusy || renameDraft === null) return;
        const title = renameDraft.trim();
        if (title.length === 0) {
          setRenameError(t('video.project.renameEmpty'));
          return;
        }
        if (projectIdRef.current === '' || title === projectDisplayTitle()) {
          cancelRename();
          return;
        }
        setRenameBusy(true);
        setRenameError(null);
        const targetId = projectIdRef.current;
        try {
          const renamed = await hostRequest('project.rename', { projectId: targetId, title: title });
          if (!aliveRef.current) return;
          const renamedTitle = renamed !== null && typeof renamed === 'object' && typeof renamed.title === 'string' && renamed.title.length > 0
            ? renamed.title
            : title;
          setProject(function applyRenamedTitle(previous) {
            return previous === null || typeof previous !== 'object'
              ? previous
              : Object.assign({}, previous, { title: renamedTitle });
          });
          projectTitlesRef.current.set(targetId, renamedTitle);
          setProjectChoices(function applyRenamedChoice(list) {
            return list.map(function updateChoice(item) {
              return item !== null && typeof item === 'object' && item.projectId === targetId
                ? Object.assign({}, item, { title: renamedTitle })
                : item;
            });
          });
          setRenameDraft(null);
          focusNameAfterRenameRef.current = true;
        } catch (_error) {
          // Keep the draft and show a localized failure; the next Enter retries.
          if (aliveRef.current) setRenameError(t('video.project.renameFailed'));
        } finally {
          if (aliveRef.current) setRenameBusy(false);
        }
      }

      // ── P3-016 draggable split between stage and AI pane ──────────────────
      function setPaneRatio(next) {
        aiPaneRatioRef.current = next;
        setAiPaneRatio(next);
      }

      function onSplitterPointerDown(event) {
        const main = mainRef.current;
        if (main === null || typeof main.getBoundingClientRect !== 'function') return;
        const rect = main.getBoundingClientRect();
        if (!(Number(rect.width) > 0)) return;
        dragRef.current = { containerWidth: rect.width, right: rect.left + rect.width };
        setResizing(true);
        if (event === null || typeof event !== 'object') return;
        if (typeof event.preventDefault === 'function') event.preventDefault();
        const target = event.currentTarget;
        if (target !== null && target !== undefined && typeof target.setPointerCapture === 'function' && event.pointerId !== undefined) {
          try {
            target.setPointerCapture(event.pointerId);
          } catch (_error) {
            /* pointer capture is an enhancement; the drag still works */
          }
        }
      }

      function onSplitterPointerMove(event) {
        const drag = dragRef.current;
        if (drag === null || event === null || typeof event !== 'object') return;
        const pointerX = Number(event.clientX);
        if (Number.isFinite(pointerX) === false) return;
        const width = clampAiPaneWidth(drag.right - pointerX, drag.containerWidth);
        setPaneRatio(normalizeAiPaneRatio(width / drag.containerWidth));
      }

      function onSplitterPointerUp(event) {
        if (dragRef.current === null) return;
        dragRef.current = null;
        setResizing(false);
        if (event !== null && typeof event === 'object') {
          const target = event.currentTarget;
          if (target !== null && target !== undefined && typeof target.releasePointerCapture === 'function' && event.pointerId !== undefined) {
            try {
              target.releasePointerCapture(event.pointerId);
            } catch (_error) {
              /* capture cleanup is best effort */
            }
          }
        }
        writeLayoutPrefs(aiPaneRatioRef.current);
        schedulePaneRatioWrite(aiPaneRatioRef.current);
      }

      function resetAiPaneRatio() {
        setPaneRatio(AI_PANE_DEFAULT_RATIO);
        writeLayoutPrefs(AI_PANE_DEFAULT_RATIO);
        schedulePaneRatioWrite(AI_PANE_DEFAULT_RATIO);
      }

      function onSplitterKeyDown(event) {
        if (!event) return;
        let next = null;
        if (event.key === 'ArrowLeft') next = stepAiPaneRatio(aiPaneRatioRef.current, AI_PANE_KEYBOARD_STEP);
        else if (event.key === 'ArrowRight') next = stepAiPaneRatio(aiPaneRatioRef.current, -AI_PANE_KEYBOARD_STEP);
        else if (event.key === 'Home') next = AI_PANE_DEFAULT_RATIO;
        if (next === null) return;
        if (typeof event.preventDefault === 'function') event.preventDefault();
        setPaneRatio(next);
        writeLayoutPrefs(next);
        schedulePaneRatioWrite(next);
      }

      /** Managed projects only: demo/legacy entries never reach the product UI. */
      function managedProjectChoices(result) {
        const list = result !== null && typeof result === 'object' && Array.isArray(result.projects) ? result.projects : [];
        const seen = new Set();
        const choices = [];
        for (const entry of list) {
          if (entry === null || typeof entry !== 'object') continue;
          const id = entry.projectId;
          if (typeof id !== 'string' || id.length === 0 || id === DEMO_PROJECT_ID || seen.has(id)) continue;
          seen.add(id);
          const updatedAt = Number.isFinite(Number(entry.updatedAt)) ? Number(entry.updatedAt) : 0;
          // P3-016: optional host-reported display title; null keeps the
          // remembered/content-derived fallback for legacy projects.
          const title = typeof entry.title === 'string' && entry.title.trim().length > 0
            ? entry.title.trim().slice(0, 120)
            : null;
          choices.push({ projectId: id, updatedAt: updatedAt, title: title });
        }
        choices.sort(function recentFirst(left, right) {
          if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt;
          if (left.projectId === right.projectId) return 0;
          return left.projectId < right.projectId ? -1 : 1;
        });
        return choices;
      }

      async function refreshProjectChoices() {
        try {
          const result = await hostRequest('project.list', {});
          if (!aliveRef.current) return null;
          const items = managedProjectChoices(result);
          setProjectChoices(items);
          return items;
        } catch (_error) {
          /* the project list is advisory; the canvas state reports real errors */
          return null;
        }
      }

      async function bootstrap() {
        const token = ++bootToken.current;
        setBoot('loading');
        setError(null);
        // M1-05: the Host is authoritative for the last opened project and the
        // pane ratio; an older Host without ui-state falls back to the in-memory
        // view memory / localStorage silently.
        let restored = null;
        try {
          restored = await hostRequest('ui.state.get', {});
        } catch (_restoreError) {
          restored = null;
        }
        if (!aliveRef.current || token !== bootToken.current) return;
        if (restored !== null && typeof restored === 'object') {
          markUiStateSupport(true);
          if (restored.layout !== null && typeof restored.layout === 'object' && typeof restored.layout.aiPaneRatio === 'number') {
            try {
              setAiPaneRatio(normalizeAiPaneRatio(restored.layout.aiPaneRatio));
            } catch (_ratioError) {
              /* an invalid persisted ratio keeps the local preference */
            }
          }
        } else {
          markUiStateSupport(false);
        }
        const restoredLastProjectId = restored !== null && typeof restored === 'object' && typeof restored.lastProjectId === 'string'
          ? restored.lastProjectId
          : '';
        let listed = null;
        try {
          listed = await hostRequest('project.list', {});
        } catch (listError) {
          if (!aliveRef.current || token !== bootToken.current) return;
          setBoot('error');
          setError(hostError(listError));
          return;
        }
        if (!aliveRef.current || token !== bootToken.current) return;
        const choices = managedProjectChoices(listed);
        setProjectChoices(choices);
        const memoryId = typeof projectIdRef.current === 'string' && projectIdRef.current.length > 0 && projectIdRef.current !== DEMO_PROJECT_ID
          ? projectIdRef.current
          : '';
        const rememberedId = memoryId !== ''
          ? memoryId
          : (restoredLastProjectId !== '' && restoredLastProjectId !== DEMO_PROJECT_ID ? restoredLastProjectId : '');
        const rememberedAvailable = rememberedId !== '' && choices.some(function known(item) {
          return item.projectId === rememberedId;
        });
        let targetId = rememberedAvailable ? rememberedId : '';
        if (targetId === '' && listed !== null && typeof listed === 'object' && typeof listed.defaultProjectId === 'string') {
          const fromHost = choices.find(function hostDefault(item) {
            return item.projectId === listed.defaultProjectId;
          });
          if (fromHost !== undefined) targetId = fromHost.projectId;
        }
        if (targetId === '' && choices.length > 0) targetId = choices[0].projectId;
        if (targetId !== '') {
          await openProject(targetId, token);
          return;
        }
        await provisionProject(token);
      }

      function retryBoot() {
        autoProvisionedRef.current = false;
        void bootstrap();
      }

      async function provisionProject(token) {
        if (autoProvisionedRef.current) return;
        autoProvisionedRef.current = true;
        setProjectBusy('create');
        setError(null);
        try {
          const created = await hostRequest('project.create', {
            templateId: 'product-launch-v1',
            title: t('video.project.untitled'),
          });
          if (!aliveRef.current || token !== bootToken.current) return;
          autoSessionProjectRef.current = null;
          await openProject(created.projectId, token);
        } catch (createError) {
          autoProvisionedRef.current = false;
          if (!aliveRef.current || token !== bootToken.current) return;
          setBoot('error');
          setError(hostError(createError));
        } finally {
          if (aliveRef.current && token === bootToken.current) setProjectBusy(null);
        }
      }

      async function createManagedProject() {
        if (projectBusy !== null) return;
        const token = ++bootToken.current;
        autoProvisionedRef.current = true;
        setProjectBusy('create');
        setError(null);
        setBoot('loading');
        try {
          const created = await hostRequest('project.create', {
            templateId: 'product-launch-v1',
            title: t('video.project.untitled'),
          });
          if (!aliveRef.current || token !== bootToken.current) return;
          autoSessionProjectRef.current = null;
          await openProject(created.projectId, token);
          await refreshProjectChoices();
        } catch (createError) {
          if (!aliveRef.current || token !== bootToken.current) return;
          setBoot('error');
          setError(hostError(createError));
        } finally {
          if (aliveRef.current && token === bootToken.current) setProjectBusy(null);
        }
      }

      async function openProject(nextProjectId, token) {
        if (typeof nextProjectId !== 'string' || nextProjectId.length === 0) return;
        const activeToken = token === undefined ? ++bootToken.current : token;
        setBoot('loading');
        setError(null);
        setProjectBusy('open');
        // A project switch discards any in-flight title draft and picker menu.
        setRenameDraft(null);
        setRenameError(null);
        setProjectMenuOpen(false);
        try {
          const opened = await hostRequest('open', { projectId: nextProjectId });
          if (!aliveRef.current || activeToken !== bootToken.current) return;
          const inspected = await hostRequest('inspect', { projectId: opened.projectId });
          if (!aliveRef.current || activeToken !== bootToken.current) return;
          latestRevisionRef.current = typeof inspected.revision === 'string' ? inspected.revision : null;
          projectIdRef.current = opened.projectId;
          setProjectId(opened.projectId);
          lastWrittenProjectId.current = '';
          scheduleLastProjectWrite(opened.projectId);
          setProject(inspected);
          setBoot('ready');
          setActiveSessionId(null);
          setSessionState({ status: 'loading', items: [], activeSessionId: null, error: null });
          previewToken.current += 1;
          setPreview(null);
          const listedSessions = await loadSessionsFor(opened.projectId);
          if (!aliveRef.current || activeToken !== bootToken.current) return;
          await ensureProjectSession(opened.projectId, listedSessions);
          if (!aliveRef.current || activeToken !== bootToken.current) return;
          await refreshProjectChoices();
        } catch (openError) {
          if (!aliveRef.current || activeToken !== bootToken.current) return;
          setBoot('error');
          setError(hostError(openError));
        } finally {
          if (aliveRef.current && activeToken === bootToken.current) setProjectBusy(null);
        }
      }

      // A project without any mapped creation Session gets one automatically so a
      // first-time user lands directly in a working conversation. Once per
      // project: the guard survives re-renders and the Host also dedupes the
      // requestId, and a failed attempt resets the guard so retry can work.
      async function ensureProjectSession(targetProjectId, listedSessions) {
        if (sessionKitAvailable === false) return null;
        if (sessions === null || typeof sessions.retain !== 'function') return null;
        if (autoSessionProjectRef.current === targetProjectId) return null;
        const items = listedSessions !== null && listedSessions !== undefined && Array.isArray(listedSessions.sessions) ? listedSessions.sessions : null;
        if (items === null || items.length > 0) return null;
        if (listedSessions !== null && listedSessions !== undefined && typeof listedSessions.activeSessionId === 'string') return null;
        autoSessionProjectRef.current = targetProjectId;
        const created = await createSessionForProject(targetProjectId);
        if (created === null) autoSessionProjectRef.current = null;
        return created;
      }

      async function createSessionForProject(targetProjectId) {
        // A second click may arrive before React re-renders the disabled button;
        // the synchronous ref keeps creation single-flight in the interim.
        if (sessionCreatePending.current) return null;
        if (sessionKitAvailable === false) return null;
        sessionCreatePending.current = true;
        setSessionBusy('create');
        setError(null);
        try {
          const created = await hostRequest('session.create', { projectId: targetProjectId, requestId: operationId() });
          if (!aliveRef.current || projectIdRef.current !== targetProjectId) return null;
          const listed = await loadSessionsFor(targetProjectId);
          if (!aliveRef.current || projectIdRef.current !== targetProjectId) return null;
          const fallback = listed !== null && listed !== undefined && typeof listed.activeSessionId === 'string' ? listed.activeSessionId : null;
          previewToken.current += 1;
          setPreview(null);
          setActiveSessionId(typeof created.sessionId === 'string' ? created.sessionId : fallback);
          setHistoryOpen(false);
          return created;
        } catch (createError) {
          if (aliveRef.current) setError(hostError(createError));
          return null;
        } finally {
          sessionCreatePending.current = false;
          if (aliveRef.current) setSessionBusy(null);
        }
      }

      async function reloadCanvasProject() {
        const next = await hostRequest('inspect', { projectId: projectIdRef.current });
        if (aliveRef.current) setProject(next);
        return next;
      }

      // ---- P3-017 B3 product export ------------------------------------------
      function exportStageText(stage) {
        if (stage === 'snapshot') return t('video.export.stage.snapshot');
        if (stage === 'engine') return t('video.export.stage.engine');
        if (stage === 'capture') return t('video.export.stage.capture');
        if (stage === 'validate' || stage === 'sheet') return t('video.export.stage.validate');
        if (stage === 'finished') return t('video.export.stage.finished');
        return t('video.export.stage.queued');
      }

      // Presentation-only filename: the project title is already the honest name
      // shown in the UI (there is no separate title API in this branch). Unsafe
      // filesystem characters are stripped; a stable fallback is always used.
      function exportProductFileName() {
        const title = studioProjectTitle(project, t('video.project.untitled'));
        const safe = String(title).replace(/[\\/:*?"<>|]/g, ' ').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
        return (safe.length > 0 ? safe : 'dsh-video') + '.mp4';
      }

      function delayExportPoll(milliseconds) {
        return new Promise(function wait(resolve) {
          setTimeout(resolve, milliseconds);
        });
      }

      async function exportProductVideo() {
        if (project === null || projectIdRef.current === '') return;
        const current = exportStateRef.current;
        // One in-flight export only: a double click cannot start a second render.
        if (exportInFlightRef.current === true) return;
        if (current !== null && current.phase === 'running') return;
        const revisionAtClick = typeof project.revision === 'string' ? project.revision : null;
        if (revisionAtClick === null) return;
        exportInFlightRef.current = true;
        const token = ++exportToken.current;
        const startedAt = Date.now();
        setExportElapsed(0);
        setExportState({
          phase: 'running',
          jobId: null,
          revision: revisionAtClick,
          stage: 'queued',
          progress: 0,
          startedAt: startedAt,
          fileName: exportProductFileName(),
          error: null,
          cancelling: false,
        });
        function settleFailure(code) {
          if (exportToken.current !== token || !aliveRef.current) return;
          exportInFlightRef.current = false;
          setExportState(function keepFailure(previous) {
            if (previous === null) return previous;
            if (code === 'E_CANCELLED') {
              return Object.assign({}, previous, { phase: 'cancelled', error: null, cancelling: false });
            }
            return Object.assign({}, previous, { phase: 'error', error: code, cancelling: false });
          });
        }
        let job;
        try {
          job = await hostRequest('render', {
            projectId: projectIdRef.current,
            revision: revisionAtClick,
            timeoutMs: Math.min(21600000,Math.max(PRODUCT_RENDER_TIMEOUT_MS,60000+140*Math.round((project?.duration||0)*30))),
          });
        } catch (error) {
          settleFailure(error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'E_RENDER');
          return;
        }
        if (exportToken.current !== token || !aliveRef.current) return;
        if (job === null || typeof job !== 'object' || typeof job.jobId !== 'string') {
          settleFailure('E_RENDER');
          return;
        }
        const jobId = job.jobId;
        setExportState(function attachJob(previous) {
          if (previous === null) return previous;
          return Object.assign({}, previous, {
            jobId: jobId,
            stage: typeof job.stage === 'string' ? job.stage : 'queued',
            progress: Number.isFinite(job.progress) ? job.progress : 0,
          });
        });
        const deadline = startedAt + Math.max(PRODUCT_EXPORT_DEADLINE_MS,120000+140*Math.round((project?.duration||0)*30));
        let result = job;
        let consecutiveStatusErrors = 0;
        while (isTerminalJob(result) === false && Date.now() < deadline) {
          await delayExportPoll(PRODUCT_EXPORT_POLL_MS);
          if (exportToken.current !== token || !aliveRef.current) return;
          try {
            result = await hostRequest('status', { jobId: jobId });
            consecutiveStatusErrors = 0;
          } catch (_statusError) {
            // A transient status failure must not kill a minutes-long render; a
            // sustained failure does (the worker deadline still bounds the job).
            consecutiveStatusErrors += 1;
            if (consecutiveStatusErrors >= 5) {
              settleFailure('E_RENDER');
              return;
            }
            continue;
          }
          if (exportToken.current !== token || !aliveRef.current) return;
          // Exact binding: the job must still describe the revision captured when
          // the export started; anything else is treated as a failed export.
          if (result === null || typeof result !== 'object' || result.jobId !== jobId || result.revision !== revisionAtClick) {
            settleFailure('E_RENDER');
            return;
          }
          setExportState(function updateExportProgress(previous) {
            if (previous === null || previous.phase !== 'running') return previous;
            return Object.assign({}, previous, {
              stage: typeof result.stage === 'string' ? result.stage : previous.stage,
              progress: Number.isFinite(result.progress) ? result.progress : previous.progress,
            });
          });
        }
        if (isTerminalJob(result) === false) {
          // Client safety net above the Host limit: stop the job instead of
          // leaving it running with no owner.
          try {
            await hostRequest('cancel', { jobId: jobId });
          } catch (_cancelError) {
            /* best effort; the worker/Host limits still bound the job */
          }
          settleFailure('E_TIMEOUT');
          return;
        }
        if (result.state !== 'succeeded') {
          settleFailure(result.state === 'cancelled' ? 'E_CANCELLED' : 'E_RENDER');
          return;
        }
        exportInFlightRef.current = false;
        setExportState(function finishExport(previous) {
          if (previous === null) return previous;
          return Object.assign({}, previous, {
            phase: 'ready',
            stage: 'finished',
            progress: 1,
            url: ARTIFACT_ROUTE + '?jobId=' + encodeURIComponent(jobId),
            error: null,
            cancelling: false,
          });
        });
      }

      async function cancelProductExport() {
        const current = exportStateRef.current;
        if (current === null || current.phase !== 'running' || typeof current.jobId !== 'string') return;
        setExportState(function markCancelling(previous) {
          if (previous === null) return previous;
          return Object.assign({}, previous, { cancelling: true });
        });
        try {
          await hostRequest('cancel', { jobId: current.jobId });
        } catch (_cancelError) {
          // The running status poll settles the terminal cancelled state.
        }
      }

      // Topbar export control: button -> live stage/percent/elapsed + cancel ->
      // download link, with a concise retry state on failure/cancel.
      function exportControl() {
        if (project === null) return null;
        const state = exportState;
        if (state === null) {
          return h(
            'div',
            { className: 'dv-export', key: 'product-export' },
            h(
              'button',
              {
                type: 'button',
                className: 'dv-button dv-button-primary',
                onClick: function startProductExport() {
                  void exportProductVideo();
                },
                disabled: projectBusy !== null,
                title: t('video.canvas.export'),
              },
              t('video.canvas.export')
            )
          );
        }
        if (state.phase === 'running') {
          const percent = state.stage === 'capture' && Number.isFinite(state.progress) ? Math.round(state.progress * 100) : null;
          const elapsed = t('video.export.elapsed').replace('{seconds}', String(exportElapsed));
          const label = exportStageText(state.stage) + (percent === null ? '' : ' ' + String(percent) + '%') + ' · ' + elapsed;
          return h(
            'div',
            { className: 'dv-export', key: 'product-export' },
            h(
              'span',
              {
                className: 'dv-export-status',
                role: 'status',
                'aria-live': 'polite',
                'data-export-stage': state.stage,
                'data-export-progress': percent === null ? '' : String(percent),
                'data-export-elapsed': String(exportElapsed),
              },
              h('span', { className: 'dv-loader dv-export-spinner', 'aria-hidden': 'true' }),
              label
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dv-button dv-button-quiet dv-export-cancel',
                onClick: function cancelExport() {
                  void cancelProductExport();
                },
                disabled: state.cancelling === true,
                title: state.cancelling === true ? t('video.cancelling') : t('video.cancel'),
              },
              state.cancelling === true ? t('video.cancelling') : t('video.cancel')
            )
          );
        }
        if (state.phase === 'ready') {
          return h(
            'div',
            { className: 'dv-export', key: 'product-export' },
            h(
              'a',
              {
                className: 'dv-button dv-button-primary dv-export-link',
                href: state.url,
                download: state.fileName || 'dsh-video.mp4',
                title: state.fileName || t('video.canvas.download'),
                'data-export-ready': 'true',
              },
              t('video.canvas.download')
            ),
            // A finished export can be repeated for the same current revision.
            h(
              'button',
              {
                type: 'button',
                className: 'dv-button dv-button-quiet',
                onClick: function exportAgain() {
                  void exportProductVideo();
                },
                disabled: projectBusy !== null,
                title: t('video.canvas.export'),
              },
              t('video.canvas.export')
            )
          );
        }
        const note = state.phase === 'cancelled' ? t('video.export.cancelled') : t('video.canvas.exportFailed');
        return h(
          'div',
          { className: 'dv-export', key: 'product-export' },
          h('span', { className: 'dv-export-error', role: 'alert', 'data-export-error': state.error || '' }, note),
          h(
            'button',
            {
              type: 'button',
              className: 'dv-button dv-button-primary',
              onClick: function retryProductExport() {
                void exportProductVideo();
              },
              disabled: projectBusy !== null,
            },
            t('video.canvas.export')
          )
        );
      }

      async function loadSessionsFor(targetProjectId) {
        const token = ++sessionListToken.current;
        if (sessionKitAvailable === false) {
          setSessionState({ status: 'unavailable', items: [], activeSessionId: null, error: null });
          return null;
        }
        if (sessions === null || typeof sessions.retain !== 'function') {
          setSessionState({ status: 'unavailable', items: [], activeSessionId: null, error: null });
          return null;
        }
        try {
          const result = await hostRequest('session.list', { projectId: targetProjectId });
          if (token !== sessionListToken.current || !aliveRef.current) return null;
          const items = Array.isArray(result.sessions) ? result.sessions : [];
          const active = typeof result.activeSessionId === 'string' ? result.activeSessionId : null;
          setSessionState({ status: 'ready', items: items, activeSessionId: active, error: null, contract: result.contract || null });
          setActiveSessionId(function keepKnown(previous) {
            if (typeof previous === 'string' && items.some(function known(item) { return item.sessionId === previous; })) return previous;
            return active;
          });
          return result;
        } catch (requestError) {
          if (token !== sessionListToken.current || !aliveRef.current) return null;
          const code = requestError && requestError.code;
          setSessionState({
            status: code === 'E_SESSION_CONFIG' ? 'disabled' : 'error',
            items: [],
            activeSessionId: null,
            error: hostError(requestError),
          });
          return null;
        }
      }

      function refreshSessions() {
        return loadSessionsFor(projectIdRef.current);
      }

      async function diagnoseSessions() {
        if (sessionKitAvailable === false || sessions === null || typeof sessions.retain !== 'function') return;
        try {
          const result = await hostRequest('session.diagnose', {});
          if (aliveRef.current && result !== null && typeof result === 'object') setSessionDiagnostic(result);
        } catch (_error) {
          /* diagnosis is advisory; the visible list state already reports failures */
        }
      }

      async function chooseSession(sessionId) {
        setHistoryOpen(false);
        if (typeof sessionId !== 'string' || sessionId === activeSessionId) return;
        if (sessionBusy !== null) return;
        const token = ++sessionSwitchToken.current;
        setSessionBusy('select');
        setError(null);
        try {
          const result = await hostRequest('session.select', { projectId: projectIdRef.current, sessionId: sessionId });
          if (token !== sessionSwitchToken.current || !aliveRef.current) return;
          previewToken.current += 1;
          setPreview(null);
          setActiveSessionId(typeof result.activeSessionId === 'string' ? result.activeSessionId : sessionId);
        } catch (requestError) {
          if (token === sessionSwitchToken.current && aliveRef.current) setError(hostError(requestError));
        } finally {
          if (token === sessionSwitchToken.current && aliveRef.current) setSessionBusy(null);
        }
      }

      function closePreview() {
        previewToken.current += 1;
        setPreview(null);
      }

      // Open a file card or local image link in a plugin-owned overlay. The Host
      // route validates the owned Session, the trusted roots and the image bytes;
      // this surface never navigates to the conversation or mounts a third column.
      function openPreview(path) {
        const token = ++previewToken.current;
        const sessionId = activeSessionId;
        const fileName = previewFileName(path);
        if (typeof sessionId !== 'string' || sessionId.length === 0) {
          setPreview({ phase: 'error', sessionId: null, fileName: fileName, message: t('video.preview.denied') });
          return;
        }
        setPreview({ phase: 'loading', sessionId: sessionId, fileName: fileName });
        hostRequest('preview', { projectId: projectIdRef.current, sessionId: sessionId, path: path }).then(
          function previewReady(result) {
            if (token !== previewToken.current || !aliveRef.current || activeSessionIdRef.current !== sessionId) return;
            if (result === null || typeof result !== 'object' || typeof result.dataUrl !== 'string' || typeof result.mediaType !== 'string') {
              setPreview({ phase: 'error', sessionId: sessionId, fileName: fileName, message: t('video.preview.failed') });
              return;
            }
            setPreview({
              phase: 'ready',
              sessionId: sessionId,
              fileName: typeof result.fileName === 'string' && result.fileName.length > 0 ? result.fileName : fileName,
              mediaType: result.mediaType,
              dataUrl: result.dataUrl,
              size: Number(result.size) || 0,
              sha256: typeof result.sha256 === 'string' ? result.sha256 : '',
            });
          },
          function previewFailed(error) {
            if (token !== previewToken.current || !aliveRef.current || activeSessionIdRef.current !== sessionId) return;
            setPreview({ phase: 'error', sessionId: sessionId, fileName: fileName, message: previewErrorText(error, t) });
          }
        );
      }

      // P3-017 B2: a chat image already rendered by the browser (data:/blob:/remote
      // or same-origin chat route) is shown as-is in the same overlay. No Host read
      // happens and the native right-sidebar file opener is never involved.
      function openInlinePreview(src) {
        previewToken.current += 1;
        setPreview({
          phase: 'ready',
          local: true,
          sessionId: activeSessionId,
          fileName: '',
          mediaType: '',
          dataUrl: src,
          size: 0,
          sha256: '',
        });
      }

      function capturePreviewClick(event) {
        if (event === null || typeof event !== 'object') return;
        // An image target (read_image thumbnail/gallery) is browser-owned: show
        // its own source directly. This branch runs before the path/file-link
        // branches so an <img> inside a file-link container cannot be routed to
        // the native opener.
        const image = imagePreviewTarget(event.target);
        if (image !== null) {
          if (typeof event.preventDefault === 'function') event.preventDefault();
          if (typeof event.stopPropagation === 'function') event.stopPropagation();
          if (image.kind === 'host') openPreview(image.path);
          else openInlinePreview(image.src);
          return;
        }
        // File cards, Markdown links and host ToolRow fileLink summaries all end
        // in the plugin's own overlay, never the native right sidebar.
        const path = localPathFromTarget(event.target);
        if (path === null) return;
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
        openPreview(path);
      }

      function retrySession() {
        setRetryTick(function bump(value) {
          return value + 1;
        });
      }

      function errorNotice() {
        if (error === null) return null;
        return h(
          'div',
          { className: 'dv-error', role: 'alert', key: 'error' },
          errorText(error, t),
          ' ',
          h(
            'button',
            {
              type: 'button',
              className: 'dv-button dv-button-quiet',
              disabled: boot === 'loading' || projectBusy !== null,
              onClick: retryBoot,
            },
            t('video.preview.retry')
          )
        );
      }

      function navigationNotice() {
        if (ui.navigationError === null) return null;
        return h('p', { className: 'dv-error', role: 'alert', key: 'navigation-error' }, t('video.error.back'));
      }

      function sessionTitle(sessionId) {
        return sessionTitleFromSnapshot(sessionListSnapshot, sessionId);
      }

      function historyMenu() {
        const items = sessionState.items || [];
        return h(
          'div',
          { className: 'dv-history-menu', role: 'menu', 'aria-label': t('video.ai.history'), key: 'history' },
          items.length === 0
            ? h('p', { className: 'dv-ai-hint' }, t('video.ai.listEmpty'))
            : items.map(function historyRow(item) {
                const id = item.sessionId;
                const status = item.status;
                const meta = status === 'archived' ? t('video.ai.archived') : status === 'unavailable' ? t('video.ai.missing') : '';
                const disabled = status === 'archived' || status === 'unavailable' || sessionBusy !== null;
                return h(
                  'button',
                  {
                    type: 'button',
                    key: id,
                    className: 'dv-history-item',
                    role: 'menuitemradio',
                    'aria-checked': id === activeSessionId ? 'true' : 'false',
                    disabled: disabled,
                    onClick: function selectHistory() {
                      void chooseSession(id);
                    },
                  },
                  h('span', { className: 'dv-history-title' }, sessionTitle(id)),
                  meta === '' ? null : h('span', { className: 'dv-history-state' }, meta)
                );
              })
        );
      }

      function previewOverlay() {
        if (preview === null) return null;
        // A browser-owned inline image belongs to this panel, not to a Session
        // read token; only Host-backed previews are dropped on a Session switch.
        if (preview.local !== true && preview.sessionId !== activeSessionId) return null;
        const title = typeof preview.fileName === 'string' && preview.fileName.length > 0 ? preview.fileName : t('video.preview.title');
        const head = h(
          'div',
          { className: 'dv-preview-head', key: 'head' },
          h('span', { className: 'dv-preview-title', title: title, key: 'title' }, title),
          h(
            'button',
            {
              type: 'button',
              className: 'dv-preview-close',
              key: 'close',
              'aria-label': t('video.preview.close'),
              onClick: closePreview,
            },
            t('video.preview.close')
          )
        );
        let body;
        if (preview.phase === 'loading') {
          body = h('p', { className: 'dv-preview-status', role: 'status', key: 'loading' }, t('video.preview.loading'));
        } else if (preview.phase === 'error') {
          body = h(
            'p',
            { className: 'dv-preview-status', role: 'alert', 'data-error': 'true', key: 'error' },
            preview.message || t('video.preview.failed')
          );
        } else {
          body = h('img', {
            className: 'dv-preview-image',
            src: preview.dataUrl,
            alt: title,
            key: 'image',
          });
        }
        return h(
          'div',
          {
            className: 'dv-preview',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('video.preview.title'),
            key: 'preview',
            onKeyDown: function previewKeyDown(event) {
              if (event !== null && typeof event === 'object' && event.key === 'Escape') {
                if (typeof event.preventDefault === 'function') event.preventDefault();
                closePreview();
              }
            },
          },
          head,
          h('div', { className: 'dv-preview-body', key: 'body' }, body)
        );
      }

      function aiPanel() {
        const status = sessionKitAvailable === false ? 'unavailable' : sessionState.status;
        let body = null;
        if (status === 'idle' || status === 'loading') {
          body = h('p', { className: 'dv-ai-loading', role: 'status' }, t('video.ai.loading'));
        } else if (status === 'unavailable') {
          body = h('p', { className: 'dv-ai-hint' }, t('video.ai.unavailable'));
        } else if (status === 'disabled') {
          body = h('p', { className: 'dv-ai-hint' }, t('video.ai.disabled'));
        } else if (status === 'error') {
          body = h(
            'div',
            { className: 'dv-ai-error', role: 'alert' },
            h('p', { className: 'dv-error' }, errorText(sessionState.error, t)),
            h(
              'button',
              {
                type: 'button',
                className: 'dv-button dv-button-quiet',
                onClick: function retryList() {
                  void refreshSessions().then(function ensureSession(listed) {
                    if (listed !== null && listed !== undefined) void ensureProjectSession(projectIdRef.current, listed);
                  });
                },
              },
              t('video.ai.retry')
            )
          );
        } else if (activeSessionId === null) {
          body = h(
            'div',
            { className: 'dv-ai-empty' },
            h('p', { className: 'dv-ai-hint' }, t('video.ai.empty')),
            h(
              'button',
              {
                type: 'button',
                className: 'dv-button dv-button-primary',
                disabled: sessionBusy !== null || projectId === '',
                onClick: function create() {
                  void createSessionForProject(projectIdRef.current);
                },
              },
              sessionBusy === 'create' ? t('video.ai.creating') : t('video.ai.create')
            )
          );
        } else {
          body = h(SessionConversationHost, {
            key: activeSessionId + ':' + String(retryTick),
            sessionId: activeSessionId,
            sessions: sessions,
            SessionProvider: props.SessionProvider,
            renderFactorySlot: props.renderFactorySlot,
            t: t,
            hostConversationOpen: hostConversationOpen,
            onRetry: retrySession,
          });
        }
        return h(
          'aside',
          { className: 'dv-ai', 'aria-label': t('video.ai.title'), key: 'ai', onClickCapture: capturePreviewClick },
          h(
            'header',
            { className: 'dv-ai-head', 'aria-label': activeSessionId === null ? t('video.ai.title') : sessionTitle(activeSessionId) },
            h(
              'div',
              { className: 'dv-ai-heading' },
              h('span', { className: 'dv-ai-title' }, t('video.ai.title')),
              null
            ),
            h(
              'div',
              { className: 'dv-ai-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dv-icon-button dv-new-session',
                  'aria-label': t('video.ai.new'),
                  title: t('video.ai.new'),
                  disabled: sessionBusy !== null || status === 'disabled' || status === 'unavailable' || projectId === '',
                  onClick: function createNew() {
                    void createSessionForProject(projectIdRef.current);
                  },
                },
                h(StudioIcon, { name: 'new' }),
                h('span', { className: 'dv-sr-only' }, sessionBusy === 'create' ? t('video.ai.creating') : t('video.ai.new'))
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dv-icon-button dv-history-toggle',
                  'aria-haspopup': 'menu',
                  'aria-expanded': historyOpen ? 'true' : 'false',
                  'aria-label': t('video.ai.history'),
                  title: t('video.ai.history'),
                  disabled: status !== 'ready',
                  onClick: function toggleHistory() {
                    setHistoryOpen(!historyOpen);
                  },
                },
                h(HistoryIcon)
              )
            )
          ),
          historyOpen ? historyMenu() : null,
          h('div', { className: 'dv-ai-body' }, body),
          previewOverlay()
        );
      }

      // ── M1-04 project folder actions (Host-authoritative path) ─────────────
      function platformIsMac() {
        try {
          const platform = typeof navigator === 'undefined' ? '' : String(navigator.platform || '');
          if (/Mac|iPhone|iPad|iPod/.test(platform)) return true;
          if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string' && navigator.userAgent.indexOf('Macintosh') >= 0) return true;
        } catch (_error) {
          /* platform sniffing is presentation-only */
        }
        return false;
      }

      function folderRevealLabel() {
        return platformIsMac() ? t('video.project.reveal') : t('video.project.revealGeneric');
      }

      async function writeClipboardText(value) {
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(value);
            return true;
          }
        } catch (_error) {
          /* fall through to the legacy path */
        }
        try {
          if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
            const area = document.createElement('textarea');
            area.value = value;
            area.setAttribute('readonly', 'readonly');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            const host = document.documentElement || document;
            host.appendChild(area);
            const selected = typeof area.select === 'function' ? area.select() : false;
            const copied = selected !== false && document.execCommand('copy') === true;
            host.removeChild(area);
            return copied;
          }
        } catch (_error) {
          /* the caller shows the fallback toast */
        }
        return false;
      }

      async function revealProjectFolder() {
        if (folderBusy !== null || projectIdRef.current === '') return;
        setProjectMenuOpen(false);
        setFolderBusy('reveal');
        setFolderNotice(null);
        try {
          const result = await hostRequest('project.reveal', { projectId: projectIdRef.current });
          if (result === null || typeof result !== 'object' || result.opened !== true) throw new Error('reveal failed');
        } catch (_error) {
          if (aliveRef.current) setFolderNotice({ kind: 'error', text: t('video.project.revealFailed') });
        } finally {
          if (aliveRef.current) setFolderBusy(null);
        }
      }

      async function copyProjectPath() {
        if (folderBusy !== null || projectIdRef.current === '') return;
        setProjectMenuOpen(false);
        setFolderBusy('copy');
        setFolderNotice(null);
        let path = '';
        try {
          const result = await hostRequest('project.path', { projectId: projectIdRef.current });
          path = result !== null && typeof result === 'object' && typeof result.path === 'string' ? result.path : '';
          if (path === '') throw new Error('path unavailable');
          const copied = await writeClipboardText(path);
          if (!copied) throw new Error('clipboard unavailable');
          if (aliveRef.current) setFolderNotice({ kind: 'status', text: t('video.project.copyPathDone') });
        } catch (_error) {
          if (aliveRef.current) {
            setFolderNotice({ kind: 'error', text: t('video.project.copyPathFailed') + (path === '' ? '' : path) });
          }
        } finally {
          if (aliveRef.current) setFolderBusy(null);
        }
      }

      function projectMenu() {
        const options = projectChoices.slice();
        if (projectId !== '' && options.some(function has(item) { return item.projectId === projectId; }) === false) {
          options.unshift({ projectId: projectId, updatedAt: 0, title: null });
        }
        return h(
          'div',
          {
            className: 'dv-project-menu',
            id: 'dsh-video-project-menu',
            role: 'menu',
            'aria-label': t('video.project.open'),
            key: 'project-menu',
            onKeyDown: onProjectMenuKeyDown,
          },
          options.map(function projectRow(item, index) {
            const id = item.projectId;
            const active = id === projectId;
            const name = projectChoiceTitle(item, index);
            return h(
              'button',
              {
                type: 'button',
                key: id,
                ref: active ? projectItemRef : null,
                className: 'dv-project-item',
                role: 'menuitemradio',
                'aria-checked': active ? 'true' : 'false',
                disabled: projectBusy !== null,
                onClick: function switchProject() {
                  setProjectMenuOpen(false);
                  if (id === projectIdRef.current) return;
                  void openProject(id);
                },
              },
              h('span', { className: 'dv-project-item-title' }, name),
              active ? h('span', { className: 'dv-project-item-check', 'aria-hidden': 'true' }, '✓') : null
            );
          }),
          h('div', { className: 'dv-project-separator', key: 'separator', 'aria-hidden': 'true' }),
          h(
            'button',
            {
              type: 'button',
              key: '__reveal__',
              className: 'dv-project-item',
              'data-action': 'reveal',
              role: 'menuitem',
              disabled: projectBusy !== null || folderBusy !== null,
              onClick: function revealFolder() {
                void revealProjectFolder();
              },
            },
            h('span', { className: 'dv-project-item-title' }, folderRevealLabel())
          ),
          h(
            'button',
            {
              type: 'button',
              key: '__copy_path__',
              className: 'dv-project-item',
              'data-action': 'copy-path',
              role: 'menuitem',
              disabled: projectBusy !== null || folderBusy !== null,
              onClick: function copyFolderPath() {
                void copyProjectPath();
              },
            },
            h('span', { className: 'dv-project-item-title' }, t('video.project.copyPath'))
          ),
          h('div', { className: 'dv-project-separator', key: 'separator-new', 'aria-hidden': 'true' }),
          h(
            'button',
            {
              type: 'button',
              key: '__new__',
              className: 'dv-project-item',
              role: 'menuitem',
              disabled: projectBusy !== null,
              onClick: function newProject() {
                setProjectMenuOpen(false);
                void createManagedProject();
              },
            },
            '+ ' + t('video.project.new')
          )
        );
      }

      function projectBar() {
        if (projectId === '' && projectChoices.length === 0) return null;
        const name = projectDisplayTitle();
        const nameControl = renameDraft === null
          ? h(
              'button',
              {
                type: 'button',
                key: 'name',
                ref: projectNameRef,
                className: 'dv-project-name',
                disabled: projectBusy !== null,
                title: t('video.project.renameHint'),
                onClick: startRename,
              },
              name
            )
          : h('input', {
              type: 'text',
              key: 'name-input',
              ref: renameInputRef,
              className: 'dv-project-name-input',
              value: renameDraft,
              maxLength: 120,
              disabled: renameBusy,
              spellCheck: false,
              'aria-label': t('video.project.rename'),
              onChange: onRenameChange,
              onKeyDown: onRenameKeyDown,
              onBlur: cancelRename,
            });
        return h(
          'div',
          { className: 'dv-projectbar', key: 'projects' },
          nameControl,
          h(
            'button',
            {
              type: 'button',
              key: 'toggle',
              ref: projectToggleRef,
              className: 'dv-icon-button dv-project-toggle',
              'aria-haspopup': 'menu',
              'aria-expanded': projectMenuOpen ? 'true' : 'false',
              'aria-controls': 'dsh-video-project-menu',
              'aria-label': t('video.project.open'),
              title: t('video.project.open'),
              disabled: projectBusy !== null,
              onClick: toggleProjectMenu,
              onKeyDown: onProjectToggleKeyDown,
            },
            h(ChevronDownIcon)
          ),
          // M1-04: a visible, always-reachable folder button (the menu items are
          // the discoverable/copy-path fallback). Hidden when no project is open.
          projectId !== ''
            ? h(
                'button',
                {
                  type: 'button',
                  key: 'folder',
                  className: 'dv-icon-button dv-folder-button',
                  'data-action': 'reveal-folder',
                  'aria-label': folderRevealLabel(),
                  title: folderRevealLabel(),
                  disabled: projectBusy !== null || folderBusy !== null,
                  onClick: function revealFolder() {
                    setFolderNotice(null);
                    void revealProjectFolder();
                  },
                },
                h(FolderIcon)
              )
            : null,
          projectMenuOpen ? projectMenu() : null
        );
      }

      // Left side: one read-only, auto-playing preview of the revision the Host
      // reports. There is no project/empty choice UI for manual editing here and
      // no legacy PNG/form editor branch.
      function stageContent() {
        if (project === null) {
          const busyCreating = boot === 'loading' || boot === 'idle' || projectBusy !== null;
          return h(
            'div',
            { className: 'dv-emptywrap', key: 'empty' },
            navigationNotice(),
            errorNotice(),
            h('p', { className: 'dv-empty', role: 'status' }, busyCreating ? t('video.preview.booting') : t('video.preview.empty')),
            h(
              'div',
              { className: 'dv-empty-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dv-button dv-button-quiet',
                  disabled: busyCreating,
                  onClick: retryBoot,
                },
                t('video.preview.retry')
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dv-button dv-button-primary',
                  disabled: projectBusy !== null,
                  onClick: function createFromEmpty() {
                    void createManagedProject();
                  },
                },
                projectBusy === 'create' ? t('video.opening') : t('video.project.new')
              )
            )
          );
        }
        return h(
          'div',
          { className: 'dv-managed-stage', key: 'canvas' },
          errorNotice(),
          h(CanvasWorkspace, {
            t: t,
            projectId: projectId,
            inspected: project,
            previewOnly: true,
            timelineEnabled:props.timelineEnabled,
            onReload: reloadCanvasProject,
            onError: function canvasError(nextError) {
              setError(nextError);
            },
          })
        );
      }

      return h(
        'div',
        {
          className: 'dv-root',
          'data-panel': PANEL_ID,
          'data-project-id': projectId,
          'data-boot': boot,
          'data-session': sessionKitAvailable === false ? 'unavailable' : sessionState.status,
          'data-session-kit': sessionKitAvailable ? 'available' : 'missing',
          'data-session-active': activeSessionId === null ? '' : activeSessionId,
          'data-session-contract': sessionDiagnostic !== null && sessionDiagnostic.contract !== undefined ? String(sessionDiagnostic.contract) : '',
          'data-session-controller': sessionDiagnostic === null ? '' : sessionDiagnostic.controller === true ? 'available' : 'missing',
          'data-session-context': sessionDiagnostic === null ? '' : sessionDiagnostic.contextRegistered === true ? 'registered' : 'absent',
          // P3-017 B3 export markers: the visible phase plus the exact revision the
          // current/last export was bound to (never the latest published one).
          'data-export': exportState === null ? 'idle' : exportState.phase,
          'data-export-revision': exportState === null || exportState.revision === undefined ? '' : String(exportState.revision),
        },
        h(StyleTag, { key: 'style' }),
        h(
          'header',
          { className: 'dv-topbar', 'data-window-drag': true, key: 'topbar' },
          h(
            'button',
            {
              type: 'button',
              key: 'back',
              className: 'dv-back',
              onClick: onBack,
              'aria-label': t('video.back'),
              title: t('video.back'),
            },
            h(BackIcon, { key: 'icon' }),
            h('span', { className: 'dv-sr-only', key: 'label' }, t('video.back'))
          ),
          projectBar(),
          projectId !== '' && saveStatus !== 'idle'
            ? h(
                'button',
                {
                  type: 'button',
                  key: 'save-status',
                  className: 'dv-save-status',
                  'data-status': saveStatus,
                  role: saveStatus === 'failed' ? 'alert' : 'status',
                  disabled: saveStatus !== 'failed',
                  title: saveStatus === 'failed' ? t('video.save.retryHint') : t('video.save.saved'),
                  onClick: retrySaveLastProject,
                },
                saveStatus === 'saving'
                  ? t('video.save.saving')
                  : saveStatus === 'saved'
                    ? t('video.save.saved')
                    : t('video.save.failed')
              )
            : null,
          // P3-016: inline rename feedback stays next to the left-aligned project
          // name/arrow. P3-017: the product export control owns the right side.
          renameError !== null
            ? h('p', { className: 'dv-project-rename-error', role: 'alert', key: 'rename-error' }, renameError)
            : null,
          folderNotice !== null
            ? h(
                'p',
                {
                  className: 'dv-project-folder-notice',
                  key: 'folder-notice',
                  role: folderNotice.kind === 'error' ? 'alert' : 'status',
                  'data-kind': folderNotice.kind,
                },
                folderNotice.text
              )
            : null,
          h('span', { className: 'dv-spacer', key: 'spacer' }),
          exportControl()
        ),
        h(
          'main',
          {
            className: 'dv-main',
            key: 'main',
            ref: mainRef,
            style: { '--dv-ai-width': aiPaneWidthCss(aiPaneRatio) },
            'data-resizing': resizing ? 'true' : 'false',
          },
          h('div', { className: 'dv-left', key: 'left' }, stageContent()),
          h('div', {
            className: 'dv-splitter',
            key: 'splitter',
            role: 'separator',
            tabIndex: 0,
            'aria-orientation': 'vertical',
            'aria-label': t('video.layout.resize'),
            'aria-valuemin': String(Math.round(AI_PANE_RATIO_MIN * 100)),
            'aria-valuemax': String(Math.round(AI_PANE_RATIO_MAX * 100)),
            'aria-valuenow': String(Math.round(aiPaneRatio * 100)),
            'data-dragging': resizing ? 'true' : 'false',
            onPointerDown: onSplitterPointerDown,
            onPointerMove: onSplitterPointerMove,
            onPointerUp: onSplitterPointerUp,
            onPointerCancel: onSplitterPointerUp,
            onDoubleClick: resetAiPaneRatio,
            onKeyDown: onSplitterKeyDown,
          }),
          aiPanel()
        )
      );
    }
    //#endregion


    //#region plugin
    const inject = ['slots', 'layout', 'locale'];

    function apply(ctx) {
      reportIssue = makeReporter(ctx);
      reportedCodes.clear();
      uiStore = createUiStore({ navigationError: null }, reportIssue);

      // Browser-owned Session service face used only to retain/release our own
      // project Sessions. It is optional: a host without it keeps the preview
      // and export path and shows a localized unavailable state for AI.
      let clientSessions = null;
      try {
        clientSessions = (typeof ctx.get === 'function' ? ctx.get('sessions') : null) || ctx.sessions || null;
      } catch (error) {
        clientSessions = null;
        reportOnce('sessions-service-unavailable', error);
      }
      const clientLayout = ctx.layout !== undefined && ctx.layout !== null ? ctx.layout : null;

      ctx.effect(
        function registerDictionaries() {
          try {
            return ctx.locale.register(NS, { zh: ZH, en: EN });
          } catch (error) {
            // Text falls back to dictionary keys; registration still proceeds.
            reportIssue('locale-register-failed', error);
            return function noopDispose() {};
          }
        },
        'dsh-video: dictionaries'
      );

      // Unload safety net: leaving the profile while the video panel is selected
      // must not leave a dead active key behind. Host `retainMainPanels` is the
      // primary mechanism (it reacts to the main-slot entries disappearing); this
      // cleanup only nudges the selection back when the host still reports video.
      ctx.effect(
        function leaveVideoOnUnload() {
          return function cleanupSelection() {
            try {
              const panelInfo = ctx.layout && ctx.layout.panelInfo;
              if (!panelInfo || typeof panelInfo.getSnapshot !== 'function') return;
              const snapshot = panelInfo.getSnapshot();
              if (snapshot && snapshot.activePanelId === PANEL_ID) ctx.layout.selectPanel(null);
            } catch (error) {
              reportOnce('unload-return-failed', error);
            }
          };
        },
        'dsh-video: leave video on unload'
      );

      // Locale-aware sidebar label. The host re-reads this thunk on every
      // projection (and after locale changes); the exact user-requested spelling
      // is also the fallback if the locale service is unavailable.
      let boundText = null;
      function sidebarLabel() {
        try {
          if (boundText === null && ctx.locale && typeof ctx.locale.bind === 'function') {
            boundText = ctx.locale.bind(NS);
          }
          if (typeof boundText === 'function') {
            const text = boundText('nav.label');
            if (typeof text === 'string' && text !== '' && text !== 'nav.label') return text;
          }
        } catch (error) {
          reportOnce('sidebar-label-failed', error);
        }
        return 'Vedio Editor';
      }

      function navigation() {
        return {
          sessions: clientSessions,
          layout: clientLayout,
          onBack: function onBack() {
            setNavigationError(null);
            try {
              if (typeof ctx.layout.selectPanel !== 'function') {
                throw new Error('layout.selectPanel is unavailable');
              }
              ctx.layout.selectPanel(null);
            } catch (error) {
              setNavigationError('back');
              reportOnce('navigation-failed', error);
            }
          },
        };
      }

      // Ask the host to leave our panel when its entry disappears mid-selection.
      function settleSelection() {
        try {
          const panelInfo = ctx.layout && ctx.layout.panelInfo;
          if (!panelInfo || typeof panelInfo.getSnapshot !== 'function') return;
          const snapshot = panelInfo.getSnapshot();
          if (snapshot && snapshot.activePanelId === PANEL_ID) ctx.layout.selectPanel(null);
        } catch (error) {
          reportOnce('fallback-return-failed', error);
        }
      }

      // 1. One `main` declaration lifetime owns a chain. Inside that chain each
      //    `sidebar.panellist` declaration lifetime re-acquires one atomic pair:
      //    the video panel is registered first, then the sidebar row. A refused
      //    or failed entry disposes the panel synchronously; a lost leading or
      //    sidebar declaration releases both. A later declaration retries, so no
      //    reachable row ever points at a missing main panel.
      let mainController = null;

      function registerPanelAndEntry() {
        const initialMainOccupants = findOccupants(ctx, 'main', 'key', PANEL_ID);
        if (initialMainOccupants === null) {
          reportIssue('main-entries-unavailable');
          return function noopDispose() {};
        }
        if (initialMainOccupants.length > 0) {
          reportIssue('main-key-conflict:' + String(initialMainOccupants.length));
          return function noopDispose() {};
        }

        let closed = false;
        let sidebarRegistered = false;
        let sidebarController = null;
        let cycle = null;

        function releaseCycle(target) {
          if (target === null || target.disposed === true) return;
          target.disposed = true;
          if (cycle === target) cycle = null;
          sidebarRegistered = false;
          // Drop the navigation row first: the video panel must never be left
          // registered without its reachable entry, and the row must never stay
          // clickable after its panel is gone.
          try {
            if (target.sidebarDispose !== null) {
              const dispose = target.sidebarDispose;
              target.sidebarDispose = null;
              dispose();
            }
          } catch (error) {
            reportOnce('sidebar-cleanup-failed', error);
          }
          try {
            if (target.mainDispose !== null) {
              const dispose = target.mainDispose;
              target.mainDispose = null;
              dispose();
            }
          } catch (error) {
            reportOnce('main-cleanup-failed', error);
          }
          settleSelection();
        }

        function acquirePair() {
          if (closed) return function noopDispose() {};
          if (cycle !== null) releaseCycle(cycle);

          const sidebarEntries = findOccupants(ctx, 'sidebar.panellist', null, null);
          if (sidebarEntries === null) {
            reportIssue('sidebar-entries-unavailable');
            reportIssue('sidebar-entry-unavailable');
            return function noopDispose() {};
          }
          const ourSidebarEntries = sidebarEntries.filter(function ours(entry) {
            return entry !== null && typeof entry === 'object' && entry.options && entry.options.id === PANEL_ID;
          });
          if (ourSidebarEntries.length > 0) {
            reportIssue('sidebar-entry-conflict:' + String(ourSidebarEntries.length));
            reportIssue('sidebar-entry-unavailable');
            return function noopDispose() {};
          }
          // Re-check the main key right before committing the pair: a competitor
          // may have registered while declarations were being processed.
          const mainOccupants = findOccupants(ctx, 'main', 'key', PANEL_ID);
          if (mainOccupants === null) {
            reportIssue('main-entries-unavailable');
            return function noopDispose() {};
          }
          if (mainOccupants.length > 0) {
            reportIssue('main-key-conflict:' + String(mainOccupants.length));
            return function noopDispose() {};
          }

          let mainDispose = null;
          let sidebarDispose = null;
          try {
            mainDispose = ctx.slots.register(
              {
                name: 'main',
                key: PANEL_ID,
                locale: NS,
                // A private session-scope child makes the renderer synthesize
                // SessionProvider (and renderSlot) into this entry's kit. No
                // occupant is registered for it: the Conversation Factory is
                // rendered directly inside the explicit Provider.
                children: (function () {
                  const children = {};
                  children[SESSION_CHILD_SLOT] = { kind: 'single', scope: 'session' };
                  return children;
                })(),
                inject: navigation,
              },
              VideoWorkspace
            );
          } catch (error) {
            reportIssue('main-register-failed', error);
            return function noopDispose() {};
          }
          try {
            sidebarDispose = ctx.slots.register(
              { name: 'sidebar.panellist', id: PANEL_ID, order: SIDEBAR_ORDER, label: sidebarLabel, locale: NS },
              SidebarVideoIcon
            );
          } catch (error) {
            reportIssue('sidebar-register-failed', error);
            reportIssue('sidebar-entry-unavailable');
            try {
              mainDispose();
            } catch (cleanupError) {
              reportOnce('main-cleanup-failed', cleanupError);
            }
            return function noopDispose() {};
          }

          sidebarRegistered = true;
          const acquired = {
            disposed: false,
            mainDispose: mainDispose,
            sidebarDispose: sidebarDispose,
            inner: null,
          };
          acquired.inner = function releaseSidebarDeclaration() {
            releaseCycle(acquired);
          };
          cycle = acquired;
          return acquired.inner;
        }

        function closeChain() {
          if (closed) return;
          closed = true;
          try {
            if (sidebarController !== null) {
              const dispose = sidebarController;
              sidebarController = null;
              dispose();
            }
          } catch (error) {
            reportOnce('sidebar-cleanup-failed', error);
          }
          releaseCycle(cycle);
        }

        try {
          sidebarController = ctx.slots.inject('sidebar.panellist', acquirePair);
        } catch (error) {
          reportIssue('sidebar-inject-failed', error);
          closeChain();
          return function noopDispose() {};
        }

        if (isSlotDeclared(ctx, 'sidebar.panellist') !== false && sidebarRegistered !== true && cycle === null) {
          // The seat exists but our pair was refused. No video panel was
          // registered in this order, so there is nothing left to retract; a
          // later sidebar declaration retries the acquisition.
          reportIssue('sidebar-entry-unavailable');
        }

        return closeChain;
      }

      try {
        mainController = ctx.slots.inject('main', registerPanelAndEntry);
      } catch (error) {
        reportIssue('main-inject-failed', error);
        return;
      }
    }

    return { inject: inject, apply: apply };
    //#endregion
  },
});
