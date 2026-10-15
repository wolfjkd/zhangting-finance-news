/**
 * 涨停财经聚合播报 - 前端模块命名空间（共享地基）
 *
 * 用途：renderer 下各功能模块统一挂载到 window.ztfi.<module>，避免向 window 顶层
 *       零散污染；模块之间只通过该命名空间暴露的浅接口互相调用。
 *
 * 加载约定：本文件必须排在所有 ztfi.* 模块之前（见 renderer/index.html）。
 * 约束：pywebview 以 file:// 直载页面，禁止使用 ES Modules（type="module"）。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};
})();
