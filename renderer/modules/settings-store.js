/**
 * ztfi.settingsStore — 设置的加载 / 保存 / 版本读取（单一事实源）
 *
 * 设计说明：
 *   - 本模块只负责「持久化读写」，不持有可变状态；活动设置对象仍由 app.js 持有
 *     （`let settings`），因此 30+ 处 `settings.xxx` 读取点无需改动。
 *   - 接口刻意保持浅：load() / save(settings) / getCurrentVersion()。
 *   - 保存走双通道：localStorage（前端自读）+ Python 端 persist_settings（供启动读主题）。
 * 加载顺序：core.js → utils.js → settings-store.js → app.js（save 依赖 utils.apiHas）。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  const STORAGE_KEY = 'ztfi-settings';

  // 出厂默认设置（无本地存档时返回）
  // 注：原 sources 字段（消息来源显示过滤）已于 2026-10-15 弃用，
  //     但保留默认值以兼容老用户已保存的 localStorage，不会被任何代码读取。
  const DEFAULTS = {
    sources: [], // 已弃用（2026-10-15），保留默认值兼容旧 localStorage，不再被读取
    fontSize: 'large',
    voiceEnabled: true,
    voiceIndex: 0,
    voiceRate: 1.5,
    voiceInterruptMode: 'complete',
    showStocks: true,
    showRelated: true,
    hideDuplicates: true,
    keywordHighlight: true,
    keywords: [],
    keywordAlert: false,
    keywordAlertKeywords: [],
    autoScroll: true,
    isPinned: false,
    watchlistAlertEnabled: false,
    watchlistAlertThreshold: 5,
    watchlistAlertInterval: 5,
    watchlistAlertSound: true,
    darkMode: false,
    privacyAccepted: false,
    privacyAcceptedVersion: '',
    onboardingCompletedVersion: '',  // 引导完成标记（跟版本绑定，由 settings.json 持久化）
  };

  /**
   * 读取设置：有本地存档则直接返回；否则返回默认设置的浅拷贝。
   * 注意：故意不与 DEFAULTS 合并 —— 保持「老存档缺字段即为 undefined」的原有语义，
   *       避免改变既有运行时行为。
   */
  function load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {}
    return Object.assign({}, DEFAULTS);
  }

  /** 保存设置：localStorage + Python 端文件双写 */
  function save(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      // 同步保存到 Python 端文件（供启动时读取主题）
      if (window.ztfi.utils.apiHas('persist_settings')) {
        pywebview.api.persist_settings(JSON.stringify(settings)).catch(() => {});
      }
    } catch (e) {}
  }

  /** 从页面标题解析当前版本号（如 "v4.4.1" → "4.4.1"） */
  function getCurrentVersion() {
    const match = document.title.match(/v(\d+\.\d+\.\d+)/);
    return match ? match[1] : '3.9.2';
  }

  window.ztfi.settingsStore = {
    STORAGE_KEY,
    DEFAULTS,
    load,
    save,
    getCurrentVersion,
  };
})();
