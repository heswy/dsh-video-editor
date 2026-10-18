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
 * Browser persistence is limited to the reduced-effects preference, versioned and
 * corruption-safe. Project content is not stored here.
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
    /** Browser preference key (version lives in the key and in the payload). */
    const PREFS_KEY = 'dsh-video.ui.v1';
    const PREFS_VERSION = 1;
    /**
     * Sidebar row position. The shipped panel rows use orders 0 (plugins),
     * 10 (schedules) and 20 (context). The workspace/session region is a
     * different sidebar slot rendered after the whole panel list, so any order
     * greater than 20 lands after the last shipped row and before the Workspace
     * group. 30 leaves room for future shipped rows without reordering them.
     */
    const SIDEBAR_ORDER = 30;
    //#endregion

    //#region locale dictionaries
    const ZH = {
      'nav.label': 'Vedio Editor',
      'video.back': '返回对话',
      'video.empty': '尚无工程',
      'video.open': '打开示例',
      'video.opening': '正在打开…',
      'video.display.label': '显示选项',
      'video.display.simplified': '简化界面效果',
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
      'video.project.untitled': '未命名工程',
      'video.project.open': '打开工程',
      'video.canvas.play': '播放',
      'video.canvas.pause': '暂停',
      'video.canvas.timeline': '时间轴',
      'video.canvas.undo': '撤销',
      'video.canvas.redo': '重做',
      'video.canvas.materials': '素材',
      'video.canvas.addScene': '添加场景',
      'video.canvas.export': '导出 MP4',
      'video.canvas.exporting': '正在导出…',
      'video.canvas.download': '下载 MP4',
      'video.canvas.loading': '正在加载画布…',
      'video.canvas.retry': '重试',
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
      'video.preview.empty': '还没有可用画面。',
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
      'nav.label': 'Vedio Editor',
      'video.back': 'Back to conversation',
      'video.empty': 'No project yet',
      'video.open': 'Open example',
      'video.opening': 'Opening…',
      'video.display.label': 'Display options',
      'video.display.simplified': 'Reduce UI effects',
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
      'video.project.untitled': 'Untitled project',
      'video.project.open': 'Open project',
      'video.canvas.play': 'Play',
      'video.canvas.pause': 'Pause',
      'video.canvas.timeline': 'Timeline',
      'video.canvas.undo': 'Undo',
      'video.canvas.redo': 'Redo',
      'video.canvas.materials': 'Assets',
      'video.canvas.addScene': 'Add scene',
      'video.canvas.export': 'Export MP4',
      'video.canvas.exporting': 'Exporting…',
      'video.canvas.download': 'Download MP4',
      'video.canvas.loading': 'Loading canvas…',
      'video.canvas.retry': 'Retry',
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
      'video.preview.empty': 'No preview is available yet.',
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
  animation:dv-panel-in var(--dv-dur-med) var(--dv-ease) both;
}
.dv-root *,.dv-root *::before,.dv-root *::after{box-sizing:border-box;}
.dv-root[data-simplified="true"]{--dv-dur-fast:0ms;--dv-dur-med:0ms;}
@keyframes dv-panel-in{
  from{opacity:0;transform:translateY(2px);}
  to{opacity:1;transform:none;}
}
.dv-topbar{
  display:flex;
  align-items:center;
  gap:8px;
  flex:none;
  min-height:52px;
  padding:10px max(16px, var(--dsh-frame-leading-clearance, 0px)) 10px 16px;
  border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 62%, transparent);
}
[data-platform="darwin"] .dv-topbar{
  padding-top:calc(10px + var(--dsh-frame-top-clearance, 0px));
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
.dv-spacer{flex:1;min-width:0;}
.dv-display{position:relative;display:inline-flex;flex:none;}
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
.dv-menu{
  position:absolute;
  top:calc(100% + 6px);
  right:0;
  z-index:2;
  min-width:190px;
  padding:6px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 84%, transparent);
  border-radius:10px;
  background:var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, #232327));
  box-shadow:0 12px 32px -20px rgba(0,0,0,.5);
  -webkit-app-region:no-drag;
}
.dv-menu-item{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  width:100%;
  height:34px;
  padding:0 10px;
  border:0;
  border-radius:7px;
  background:transparent;
  color:var(--dsw-alias-label-primary, #f2f2f5);
  font:inherit;
  font-size:.86em;
  text-align:left;
  cursor:pointer;
}
.dv-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,140,.14));}
.dv-menu-item:focus-visible{
  outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #5b8cff));
  outline-offset:-2px;
}
.dv-menu-check{
  flex:none;
  min-width:1em;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  text-align:center;
}
.dv-menu-text{
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
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
  width:clamp(320px, 34%, 400px);
  min-width:0;
  min-height:0;
  border-left:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 62%, transparent);
  background:var(--dsw-alias-bg-layer-1, #232327);
  position:relative;
}
.dv-ai-head{
  display:flex;
  flex:none;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  min-height:44px;
  padding:6px 12px;
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
.dv-ai-session{
  min-width:0;
  overflow:hidden;
  color:var(--dsw-alias-label-tertiary, #7f7f88);
  font-size:.78em;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dv-ai-actions{display:flex;flex:none;align-items:center;gap:4px;}
.dv-history-toggle{width:28px;height:28px;}
.dv-new-session{min-height:28px;padding:0 8px;font-size:.8em;}
.dv-ai-body{
  display:flex;
  flex:1;
  flex-direction:column;
  min-width:0;
  min-height:0;
  overflow:hidden;
}
.dv-ai-body > *{min-width:0;min-height:0;}
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

.dv-projectbar{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:8px;
  padding:8px 16px 0;
}
.dv-project-picker{display:flex;align-items:center;gap:6px;min-width:0;color:var(--dsw-alias-label-secondary,#a4a4ad);font-size:.8em;}
.dv-project-picker select{
  min-width:120px;
  max-width:240px;
  height:26px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.32)) 82%, transparent);
  border-radius:7px;
  background:var(--dsw-alias-bg-layer-1,#232327);
  color:var(--dsw-alias-label-primary,#f2f2f5);
  font:inherit;
  font-size:.9em;
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
.dv-seek{flex:1;min-width:120px;accent-color:var(--dsw-alias-state-business-primary,#6f8cff);}
.dv-time{color:var(--dsw-alias-label-secondary,#a4a4ad);font-size:.78em;font-variant-numeric:tabular-nums;white-space:nowrap;}
.dv-export-link{text-decoration:none;display:inline-flex;align-items:center;}
.dv-canvas-wrap{
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
.dv-managed-stage{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;gap:6px;padding-top:6px;}
.dv-canvas-shell[data-preview-only="true"]{padding:0 16px 14px;}
.dv-canvas-shell[data-preview-only="true"] .dv-canvas-wrap{border-radius:12px;}
@media (prefers-reduced-motion: reduce){
  .dv-root{animation:none;}
}
@container dsh-video (max-width: 900px){
  .dv-ai{width:clamp(280px, 38%, 340px);}
  .dv-stage{padding:12px;}
  .dv-controls{padding:10px 12px 12px;}
}
@container dsh-video (max-width: 700px){
  .dv-main{flex-direction:column;}
  .dv-ai{
    width:auto;
    max-height:52%;
    border-left:0;
    border-top:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 62%, transparent);
  }
  .dv-stage{padding-bottom:8px;}
}
@container dsh-video (max-width: 520px){
  .dv-topbar{padding-left:12px;padding-right:12px;}
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

    function defaultPrefs() {
      return { simplifiedEffects: false };
    }

    /**
     * Read the versioned browser preference. Any absence, corrupt JSON, unexpected
     * shape, unknown version, or storage exception falls back to defaults.
     */
    function readPrefs() {
      const storage = safeStorage();
      if (storage === null) return defaultPrefs();
      let raw;
      try {
        raw = storage.getItem(PREFS_KEY);
      } catch (error) {
        reportOnce('prefs-read-failed', error);
        return defaultPrefs();
      }
      if (typeof raw !== 'string' || raw === '') return defaultPrefs();
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultPrefs();
        if (parsed.version !== PREFS_VERSION) return defaultPrefs();
        return { simplifiedEffects: parsed.simplifiedEffects === true };
      } catch (error) {
        reportOnce('prefs-corrupt', error);
        return defaultPrefs();
      }
    }

    /**
     * Best-effort write of the versioned preference. A failed write keeps the
     * in-memory value and reports once; it never blocks the UI.
     */
    function writePrefs(state) {
      const storage = safeStorage();
      if (storage === null) {
        reportOnce('prefs-storage-unavailable');
        return false;
      }
      try {
        storage.setItem(
          PREFS_KEY,
          JSON.stringify({ version: PREFS_VERSION, simplifiedEffects: state.simplifiedEffects === true })
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

    /** Plugin-scope store shared by the panel and its display menu. */
    let uiStore = null;
    /** Bounded panel-scope memory: a mode switch must not rewrite worker state. */
    let editorMemory = null;

    function getStore() {
      if (uiStore === null) {
        uiStore = createUiStore(
          { simplifiedEffects: false, navigationError: null },
          function noop() {}
        );
      }
      return uiStore;
    }

    function usePluginState() {
      const store = getStore();
      return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    }

    function setSimplifiedEffects(next) {
      const store = getStore();
      const value = next === true;
      if (store.getSnapshot().simplifiedEffects === value) return;
      store.setPatch({ simplifiedEffects: value });
      writePrefs(store.getSnapshot());
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

    function DisplayOptionsIcon() {
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
        },
        h('path', { d: 'M2.5 4.25h2.2M8.3 4.25h5.2' }),
        h('circle', { cx: 6.5, cy: 4.25, r: 1.5 }),
        h('path', { d: 'M2.5 8h5.3M11.4 8h2.1' }),
        h('circle', { cx: 9.6, cy: 8, r: 1.5 }),
        h('path', { d: 'M2.5 11.75h1.9M7.9 11.75h5.6' }),
        h('circle', { cx: 6.1, cy: 11.75, r: 1.5 })
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
      'pause',
      'hitTest',
      'getElements',
      'destroy',
    ]);
    const CANVAS_EVENT_TYPES = Object.freeze([
      'ready',
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
      return props.renderFactorySlot(
        'conversation.content',
        { variant: 'embedded', phase: props.phase === 'active' ? 'active' : 'settling', hero: false },
        { slots: { views: SessionChatView } }
      );
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

      const [snapshot, setSnapshot] = React.useState(null);
      const [phase, setPhase] = React.useState('loading');
      const [frameError, setFrameError] = React.useState(null);
      const [time, setTime] = React.useState(0);
      const [playing, setPlaying] = React.useState(false);
      const [selected, setSelected] = React.useState(null);
      const [drag, setDrag] = React.useState(null);
      const [editor, setEditor] = React.useState(null);
      const [editorNotice, setEditorNotice] = React.useState(null);
      const [busy, setBusy] = React.useState(null);
      const [actionError, setActionError] = React.useState(null);
      const [stageSize, setStageSize] = React.useState({ width: 0, height: 0 });
      const [drawerOpen, setDrawerOpen] = React.useState(false);
      const [uploadBusy, setUploadBusy] = React.useState(false);
      const [sceneChoice, setSceneChoice] = React.useState(scenes[0] ? scenes[0].sceneId : null);
      const [sceneColor, setSceneColor] = React.useState('#1d4ed8');
      const [styleColor, setStyleColor] = React.useState('#ffffff');
      const [styleSize, setStyleSize] = React.useState(64);
      const [exportState, setExportState] = React.useState(null);

      const iframeRef = React.useRef(null);
      const stageRef = React.useRef(null);
      const wrapRef = React.useRef(null);
      const overlayRef = React.useRef(null);
      const ledgerRef = React.useRef(null);
      const pendingRef = React.useRef(new Map());
      const editorRef = React.useRef(null);
      const timeRef = React.useRef(0);
      const selectedRef = React.useRef(null);
      const readyRef = React.useRef(false);
      const snapshotToken = React.useRef(0);
      const suppressClickRef = React.useRef(false);
      const pollRef = React.useRef(null);
      const revision = inspected.revision;
      const width = canvasNumber(inspected.width, 1280);
      const height = canvasNumber(inspected.height, 720);
      const duration = canvasNumber(inspected.duration, 0);
      const scale = stageSize.width > 0 && stageSize.height > 0 ? Math.min(stageSize.width / width, stageSize.height / height) : 0;
      const displayWidth = scale > 0 ? width * scale : 0;
      const displayHeight = scale > 0 ? height * scale : 0;

      timeRef.current = time;
      selectedRef.current = selected;
      editorRef.current = editor;

      function setSelectedSafe(next) {
        selectedRef.current = next;
        setSelected(next);
        if (next !== null && next.style) {
          setStyleColor(typeof next.style.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(next.style.color) ? next.style.color : '#ffffff');
          setStyleSize(canvasNumber(next.style.fontSize, 64));
        }
      }

      // Settle every still pending runtime command explicitly: resolve its
      // promise with null, clear its timeout and drop it from the waiter map.
      // Never leave a dangling promise when an instance is unbound, replaced or
      // destroyed (the reviewed P3-005-B contract requirement).
      function settlePendingCommands() {
        const pending = pendingRef.current;
        for (const [seq, entry] of pending) {
          pending.delete(seq);
          clearTimeout(entry.timer);
          entry.resolve(null);
        }
        const ledger = ledgerRef.current;
        if (ledger !== null) ledger.revoke();
        readyRef.current = false;
      }

      function postCommand(type, payload) {
        return new Promise(function commandPromise(resolve) {
          const frame = iframeRef.current;
          const ledger = ledgerRef.current;
          if (frame === null || ledger === null || typeof frame.contentWindow === 'undefined') {
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
          const pending = pendingRef.current;
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

      async function loadSnapshot(targetRevision, restore) {
        const token = ++snapshotToken.current;
        readyRef.current = false;
        setPhase('loading');
        setFrameError(null);
        if (playing) {
          setPlaying(false);
          void postCommand('pause');
        }
        try {
          const next = await hostRequest('preview.snapshot', { projectId: projectId, revision: targetRevision, ttlMs: 300000 });
          if (token !== snapshotToken.current) return;
          const instance = canvasInstanceId();
          const nonce = canvasNonce();
          // A new snapshot is a new sandbox instance: settle every promise that
          // still belongs to the old instance before its ledger is replaced.
          settlePendingCommands();
          ledgerRef.current = canvasMessageLedger({ instanceId: instance, nonce: nonce, timeoutMs: 4000 });
          pendingRef.current = new Map();
          setSnapshot({
            snapshotId: next.snapshotId,
            revision: next.revision,
            entryUrl: next.entryUrl,
            routeBase: next.routeBase,
            src: next.entryUrl + '?instance=' + encodeURIComponent(instance) + '&nonce=' + nonce,
            restore: restore || null,
          });
          setPhase('ready');
        } catch (error) {
          if (token !== snapshotToken.current) return;
          setPhase('error');
          setFrameError(hostError(error));
        }
      }

      React.useEffect(
        function reloadOnRevision() {
          void loadSnapshot(revision, { time: timeRef.current, stableId: selectedRef.current ? selectedRef.current.stableId : null });
          return function cancelSnapshot() {
            snapshotToken.current += 1;
          };
        },
        [projectId, revision]
      );

      React.useEffect(
        function bindRuntimeMessages() {
          if (snapshot === null) return function noMessages() {};
          const frame = iframeRef.current;
          if (frame === null) return function noFrame() {};
          const boundLedger = ledgerRef.current;
          function restoreRuntimeState() {
            const restore = snapshot.restore;
            const target = restore && Number.isFinite(restore.time) ? Math.min(restore.time, duration) : 0;
            void postCommand('seek', { time: target }).then(function restoreSelection() {
              if (restore && restore.stableId) {
                const element = elements.find(function same(item) {
                  return item.stableId === restore.stableId;
                });
                if (element !== undefined && element.layout && Number.isFinite(element.layout.left) && Number.isFinite(element.layout.top)) {
                  const rect = element.layout;
                  if (rect.width > 0 && rect.height > 0) {
                    void postCommand('hitTest', { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }).then(function applyHit(payload) {
                      if (payload && payload.hit) setSelectedSafe(payload.hit);
                    });
                  }
                }
              }
            });
          }
          function settleWaiter(seq, payload) {
            const pending = pendingRef.current;
            const entry = pending.get(seq);
            if (entry === undefined) return;
            pending.delete(seq);
            clearTimeout(entry.timer);
            entry.resolve(payload);
          }
          function handleRuntimeEvent(outcome) {
            const payload = outcome.payload;
            if (outcome.type === 'ready') {
              readyRef.current = true;
              setPhase('ready');
              restoreRuntimeState();
            } else if (outcome.type === 'seeked' || outcome.type === 'state') {
              if (Number.isFinite(payload.time)) setTime(payload.time);
              if (typeof payload.playing === 'boolean') setPlaying(payload.playing);
              if (readyRef.current === false) {
                readyRef.current = true;
                setPhase('ready');
                restoreRuntimeState();
              }
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
              settlePendingCommands();
            }
          }
          function handleMessage(event) {
            if (event.source !== frame.contentWindow) return;
            const ledger = ledgerRef.current;
            if (ledger === null) return;
            const outcome = ledger.accept(event.data, { sourceOk: true });
            if (outcome.accepted === false) return;
            if (outcome.replyTo !== null) settleWaiter(outcome.replyTo, outcome.type === 'error' ? null : outcome.payload);
            handleRuntimeEvent(outcome);
          }
          if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return function noWindow() {};
          window.addEventListener('message', handleMessage);
          return function unbind() {
            window.removeEventListener('message', handleMessage);
            // Explicit settlement: a replaced snapshot already settled its own
            // pending commands before its ledger was swapped out; only this
            // still-active instance still owns promises.
            if (ledgerRef.current === boundLedger) settlePendingCommands();
            else if (boundLedger !== null) boundLedger.revoke();
          };
        },
        [snapshot]
      );

      React.useEffect(
        function pollDuringPlayback() {
          if (!playing) return function noPoll() {};
          const timer = setInterval(function pollState() {
            void postCommand('state');
          }, 250);
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
        if (x < 0 || y < 0 || x > width || y > height) return null;
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
        void postCommand('hitTest', point).then(function applyHit(payload) {
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
          next.x = Math.max(0, Math.min(width - next.width, drag.rect.x + dx));
          next.y = Math.max(0, Math.min(height - next.height, drag.rect.y + dy));
        } else {
          if (drag.mode.includes('w')) {
            const x = Math.max(0, Math.min(drag.rect.x + dx, drag.rect.x + drag.rect.width - 1));
            next.x = x;
            next.width = drag.rect.x + drag.rect.width - x;
          }
          if (drag.mode.includes('e')) next.width = Math.max(1, Math.min(width - next.x, drag.rect.width + dx));
          if (drag.mode.includes('n')) {
            const y = Math.max(0, Math.min(drag.rect.y + dy, drag.rect.y + drag.rect.height - 1));
            next.y = y;
            next.height = drag.rect.y + drag.rect.height - y;
          }
          if (drag.mode.includes('s')) next.height = Math.max(1, Math.min(height - next.y, drag.rect.height + dy));
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
          composition: { width: width, height: height },
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
          void postCommand('pause');
        } else {
          setPlaying(true);
          void postCommand('play');
        }
      }

      function seekTo(nextTime) {
        const value = Math.max(0, Math.min(duration, Number(nextTime) || 0));
        setTime(value);
        void postCommand('seek', { time: value });
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
        void postCommand('pause');
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
        void postCommand('hitTest', point).then(function openOnHit(payload) {
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

      function canvasBody() {
        if (phase === 'error') {
          return h(
            'div',
            { className: 'dv-canvas-status', role: 'alert' },
            h('p', null, errorText(frameError || { code: 'E_SNAPSHOT' }, t)),
            h(
              'button',
              {
                type: 'button',
                className: 'dv-button dv-button-quiet',
                onClick: function retrySnapshot() {
                  void loadSnapshot(revision, { time: time, stableId: selected ? selected.stableId : null });
                },
              },
              t('video.canvas.retry')
            )
          );
        }
        if (snapshot === null || displayWidth === 0 || displayHeight === 0) {
          return h('p', { className: 'dv-canvas-status', role: 'status' }, t('video.canvas.loading'));
        }
        return h(
          'div',
          {
            className: 'dv-stage dv-canvas-stage',
            ref: stageRef,
            style: { width: displayWidth + 'px', height: displayHeight + 'px' },
          },
          h('iframe', {
            ref: iframeRef,
            className: 'dv-stage-frame',
            title: t('video.canvas.frameTitle'),
            src: snapshot.src,
            // The sandbox document must keep its composition viewport: the
            // runtime's hitTest uses the iframe document's CSS pixels, so a
            // letterboxed (smaller) viewport would clip the frame and silently
            // miss composition coordinates beyond it. Keep the element at the
            // composition size and scale the whole element visually instead.
            style: {
              width: width + 'px',
              height: height + 'px',
              transformOrigin: 'top left',
              transform: 'scale(' + scale + ')',
            },
            sandbox: 'allow-scripts',
            referrerPolicy: 'no-referrer',
            onLoad: function runtimeLoaded() {
              setTimeout(function recoverState() {
                void postCommand('state');
              }, 120);
            },
          }),
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
          'data-canvas-revision': revision,
          'data-canvas-phase': phase,
          'data-preview-only': previewOnly ? 'true' : 'false',
        },
        h(
          'div',
          { className: 'dv-canvas-bar' },
          h('button', { type: 'button', className: 'dv-button dv-button-quiet', onClick: togglePlayback, disabled: phase !== 'ready' }, playing ? t('video.canvas.pause') : t('video.canvas.play')),
          h(
            'input',
            {
              className: 'dv-seek',
              type: 'range',
              min: '0',
              max: String(duration || 1),
              step: '0.01',
              value: String(Math.min(time, duration || 1)),
              'aria-label': t('video.canvas.timeline'),
              disabled: phase !== 'ready',
              onChange: function seek(event) {
                seekTo(event.target.value);
              },
            }
          ),
          h('span', { className: 'dv-time' }, formatSeconds(time) + ' / ' + formatSeconds(duration)),
          previewOnly ? null : h('button', { type: 'button', className: 'dv-button dv-button-quiet', onClick: function undo() { void historyStep('undo'); }, disabled: busy !== null, title: t('video.canvas.undo') }, t('video.canvas.undo')),
          previewOnly ? null : h('button', { type: 'button', className: 'dv-button dv-button-quiet', onClick: function redo() { void historyStep('redo'); }, disabled: busy !== null, title: t('video.canvas.redo') }, t('video.canvas.redo')),
          previewOnly ? null : h('button', { type: 'button', className: 'dv-button dv-button-quiet', onClick: function drawer() { setDrawerOpen(!drawerOpen); }, 'aria-expanded': drawerOpen ? 'true' : 'false' }, t('video.canvas.materials')),
          previewOnly ? null : h('button', { type: 'button', className: 'dv-button dv-button-quiet', onClick: function add() { void addScene(); }, disabled: busy !== null }, t('video.canvas.addScene')),
          previewOnly
            ? null
            : exportState && exportState.state === 'ready'
            ? h('a', { className: 'dv-button dv-button-primary dv-export-link', href: exportState.url, download: 'dsh-video.mp4' }, t('video.canvas.download'))
            : h('button', { type: 'button', className: 'dv-button dv-button-primary', onClick: function render() { void exportVideo(); }, disabled: busy !== null }, exportState && exportState.state === 'running' ? t('video.canvas.exporting') : t('video.canvas.export'))
        ),
        h('div', { className: 'dv-canvas-wrap', ref: wrapRef }, canvasBody()),
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
      const [menuOpen, setMenuOpen] = React.useState(false);
      const triggerRef = React.useRef(null);
      const itemRef = React.useRef(null);

      // Panel-switch memory keeps only the visible view: the Host worker stays the
      // authority for project/revision/session truth. On a later mount the
      // remembered project is re-validated against `project.list` before it opens.
      const remembered = editorMemory === null ? {} : editorMemory;
      const [project, setProject] = React.useState(remembered.project || null);
      const [boot, setBoot] = React.useState('idle');
      const [error, setError] = React.useState(remembered.error || null);
      const [projectId, setProjectId] = React.useState(typeof remembered.projectId === 'string' ? remembered.projectId : '');
      const [projectChoices, setProjectChoices] = React.useState([]);
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
          };
        },
        []
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
          sessionState: sessionState,
          activeSessionId: activeSessionId,
        };
      });

      // Focus management for the single-item display menu. The trigger opens the
      // menu; the open menu moves focus onto its item; Escape and Tab close it and
      // return focus to the trigger (Tab is not prevented from leaving afterwards,
      // and focus never stays on the removed node). No document/window listeners
      // are installed, so unmount cannot leak a global handler.
      React.useEffect(
        function focusOpenItem() {
          if (!menuOpen || itemRef.current === null || typeof itemRef.current.focus !== 'function') return;
          try {
            itemRef.current.focus();
          } catch (_error) {
            /* focus is best-effort; the menu stays usable */
          }
        },
        [menuOpen]
      );

      function focusTrigger() {
        try {
          if (triggerRef.current !== null && typeof triggerRef.current.focus === 'function') {
            triggerRef.current.focus();
          }
        } catch (_error) {
          /* focus is best-effort; the menu is already closed */
        }
      }

      function openMenu() {
        setMenuOpen(true);
      }

      function closeMenu() {
        setMenuOpen(false);
        focusTrigger();
      }

      function onTriggerClick() {
        if (menuOpen) closeMenu();
        else openMenu();
      }

      function onTriggerKeyDown(event) {
        if (!event) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (menuOpen) {
            if (itemRef.current !== null && typeof itemRef.current.focus === 'function') itemRef.current.focus();
          } else {
            openMenu();
          }
        } else if (event.key === 'Escape' && menuOpen) {
          event.preventDefault();
          closeMenu();
        }
      }

      function onMenuKeyDown(event) {
        if (!event) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          closeMenu();
        } else if (event.key === 'Tab') {
          event.preventDefault();
          closeMenu();
        }
      }

      function onToggleSimplified() {
        setSimplifiedEffects(!ui.simplifiedEffects);
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
          choices.push({ projectId: id, updatedAt: updatedAt });
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
        const rememberedId = typeof projectIdRef.current === 'string' && projectIdRef.current.length > 0 && projectIdRef.current !== DEMO_PROJECT_ID
          ? projectIdRef.current
          : '';
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
        try {
          const opened = await hostRequest('open', { projectId: nextProjectId });
          if (!aliveRef.current || activeToken !== bootToken.current) return;
          const inspected = await hostRequest('inspect', { projectId: opened.projectId });
          if (!aliveRef.current || activeToken !== bootToken.current) return;
          latestRevisionRef.current = typeof inspected.revision === 'string' ? inspected.revision : null;
          projectIdRef.current = opened.projectId;
          setProjectId(opened.projectId);
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

      function capturePreviewClick(event) {
        if (event === null || typeof event !== 'object') return;
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
        if (preview.sessionId !== activeSessionId) return null;
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
            { className: 'dv-ai-head' },
            h(
              'div',
              { className: 'dv-ai-heading' },
              h('span', { className: 'dv-ai-title' }, t('video.ai.title')),
              activeSessionId === null ? null : h('span', { className: 'dv-ai-session' }, sessionTitle(activeSessionId))
            ),
            h(
              'div',
              { className: 'dv-ai-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dv-button dv-button-quiet dv-new-session',
                  disabled: sessionBusy !== null || status === 'disabled' || status === 'unavailable' || projectId === '',
                  onClick: function createNew() {
                    void createSessionForProject(projectIdRef.current);
                  },
                },
                sessionBusy === 'create' ? t('video.ai.creating') : t('video.ai.new')
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

      function projectBar() {
        if (projectId === '' && projectChoices.length === 0) return null;
        const options = projectChoices.slice();
        if (projectId !== '' && options.some(function has(item) { return item.projectId === projectId; }) === false) {
          options.unshift({ projectId: projectId });
        }
        return h(
          'div',
          { className: 'dv-projectbar', key: 'projects' },
          h(
            'label',
            { className: 'dv-project-picker' },
            h('span', null, t('video.project.label')),
            h(
              'select',
              {
                value: projectId,
                disabled: projectBusy !== null,
                'aria-label': t('video.project.open'),
                onChange: function switchProject(event) {
                  const next = event.target.value;
                  if (next === projectId || next.length === 0) return;
                  void openProject(next);
                },
              },
              options.map(function option(item) {
                return h('option', { key: item.projectId, value: item.projectId }, item.projectId);
              })
            )
          ),
          h(
            'button',
            { type: 'button', className: 'dv-button dv-button-quiet', onClick: function createProject() { void createManagedProject(); }, disabled: projectBusy !== null },
            projectBusy === 'create' ? t('video.opening') : t('video.project.new')
          )
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
          'data-simplified': ui.simplifiedEffects ? 'true' : 'false',
          'data-panel': PANEL_ID,
          'data-project-id': projectId,
          'data-boot': boot,
          'data-session': sessionKitAvailable === false ? 'unavailable' : sessionState.status,
          'data-session-kit': sessionKitAvailable ? 'available' : 'missing',
          'data-session-active': activeSessionId === null ? '' : activeSessionId,
          'data-session-contract': sessionDiagnostic !== null && sessionDiagnostic.contract !== undefined ? String(sessionDiagnostic.contract) : '',
          'data-session-controller': sessionDiagnostic === null ? '' : sessionDiagnostic.controller === true ? 'available' : 'missing',
          'data-session-context': sessionDiagnostic === null ? '' : sessionDiagnostic.contextRegistered === true ? 'registered' : 'absent',
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
            h('span', { className: 'dv-back-label', key: 'label' }, t('video.back'))
          ),
          h('span', { className: 'dv-spacer', key: 'spacer' }),
          h(
            'div',
            { className: 'dv-display', key: 'display' },
            h(
              'button',
              {
                type: 'button',
                key: 'trigger',
                ref: triggerRef,
                className: 'dv-icon-button',
                'aria-haspopup': 'menu',
                'aria-expanded': menuOpen ? 'true' : 'false',
                'aria-controls': 'dsh-video-display-menu',
                'aria-label': t('video.display.label'),
                title: t('video.display.label'),
                onClick: onTriggerClick,
                onKeyDown: onTriggerKeyDown,
              },
              h(DisplayOptionsIcon)
            ),
            menuOpen
              ? h(
                  'div',
                  {
                    className: 'dv-menu',
                    id: 'dsh-video-display-menu',
                    role: 'menu',
                    'aria-label': t('video.display.label'),
                    key: 'menu',
                    onKeyDown: onMenuKeyDown,
                  },
                  h(
                    'button',
                    {
                      type: 'button',
                      key: 'item',
                      ref: itemRef,
                      className: 'dv-menu-item',
                      role: 'menuitemcheckbox',
                      tabIndex: -1,
                      'aria-checked': ui.simplifiedEffects ? 'true' : 'false',
                      onClick: onToggleSimplified,
                    },
                    h('span', { className: 'dv-menu-text', key: 'text' }, t('video.display.simplified')),
                    h(
                      'span',
                      { className: 'dv-menu-check', 'aria-hidden': 'true', key: 'check' },
                      ui.simplifiedEffects ? '✓' : ''
                    )
                  )
                )
              : null
          )
        ),
        h(
          'main',
          { className: 'dv-main', key: 'main' },
          h('div', { className: 'dv-left', key: 'left' }, projectBar(), stageContent()),
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
      const initialPrefs = readPrefs();
      uiStore = createUiStore(
        { simplifiedEffects: initialPrefs.simplifiedEffects === true, navigationError: null },
        reportIssue
      );

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
