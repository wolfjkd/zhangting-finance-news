/**
 * ztfi.dom — DOM 元素引用集中登记表（单一事实源）
 *
 * 约定：所有 `$xxx` 元素引用统一在此登记，元素 id 字符串只出现这一次；
 *       别处（app.js / 视图模块）通过 window.ztfi.dom 取用，不再各自 getElementById。
 * 加载顺序：core.js → utils.js → dom.js → app.js（dom.js 依赖 index.html 中的元素已存在，
 *           index.html 在 </body> 前加载脚本，元素此时已就绪）。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  window.ztfi.dom = {
    // 主列表 / 工具栏 / 状态栏
    $container: document.getElementById('newsContainer'),
    $newsList: document.getElementById('newsList'),
    $statusDot: document.getElementById('statusDot'),
    $statusText: document.getElementById('statusText'),
    $newsCount: document.getElementById('newsCount'),
    $lastUpdate: document.getElementById('lastUpdate'),
    $loading: document.getElementById('loadingIndicator'),
    $btnAutoscroll: document.getElementById('btnAutoscroll'),
    $btnPin: document.getElementById('btnPin'),
    $btnLoadMore: document.getElementById('btnLoadMore'),
    $btnSettings: document.getElementById('btnSettings'),
    $btnSearch: document.getElementById('btnSearch'),
    $btnFavorites: document.getElementById('btnFavorites'),
    $favoritesBadge: document.getElementById('favoritesBadge'),
    $btnReview: null, // 已移除
    $btnWatchlist: document.getElementById('btnWatchlist'),
    $watchlistBadge: document.getElementById('watchlistBadge'),

    // 搜索 / 收藏对话框
    $searchDialog: document.getElementById('searchDialog'),
    $searchInput: document.getElementById('searchInput'),
    $searchBtn: document.getElementById('searchBtn'),
    $searchCategory: document.getElementById('searchCategory'),
    $searchPriority: document.getElementById('searchPriority'),
    $searchResults: document.getElementById('searchResults'),
    $favoritesDialog: document.getElementById('favoritesDialog'),
    $favoritesList: document.getElementById('favoritesList'),

    // 主题 / 设置面板
    $btnThemeToggle: document.getElementById('btnThemeToggle'),
    $settingsOverlay: document.getElementById('settingsOverlay'),
    $settingsClose: document.getElementById('settingsClose'),

    // 语音播报
    $voiceEnabled: document.getElementById('voiceEnabled'),
    $voiceSettings: document.getElementById('voiceSettings'),
    $voiceSelect: document.getElementById('voiceSelect'),
    $voiceTest: document.getElementById('voiceTest'),
    $voiceRate: document.getElementById('voiceRate'),
    $voiceSpeedRow: document.getElementById('voiceSpeedRow'),
    $voiceInterruptMode: document.getElementById('voiceInterruptMode'),
    $voiceInterruptModeRow: document.getElementById('voiceInterruptModeRow'),

    // AI 深度分析
    $aiEnabled: document.getElementById('aiEnabled'),
    $aiApiKey: document.getElementById('aiApiKey'),
    $aiApiUrl: document.getElementById('aiApiUrl'),
    $aiModelName: document.getElementById('aiModelName'),
    $aiApiKeyRow: document.getElementById('aiApiKeyRow'),
    $aiApiUrlRow: document.getElementById('aiApiUrlRow'),
    $aiModelNameRow: document.getElementById('aiModelNameRow'),
    $aiTestRow: document.getElementById('aiTestRow'),
    $aiConfigHint: document.getElementById('aiConfigHint'),
    $btnAiTest: document.getElementById('btnAiTest'),

    // 显示 / 去重 / 关键词
    $showStocks: document.getElementById('showStocks'),
    $showRelated: document.getElementById('showRelated'),
    $hideDuplicates: document.getElementById('hideDuplicates'),
    $keywordHighlight: document.getElementById('keywordHighlight'),
    $keywordInputRow: document.getElementById('keywordInputRow'),
    $keywordInput: document.getElementById('keywordInput'),
    $keywordAddBtn: document.getElementById('keywordAddBtn'),
    $keywordTags: document.getElementById('keywordTags'),
    $keywordAlert: document.getElementById('keywordAlert'),

    // 字体大小
    $fontSize: document.getElementById('fontSize'),

    // 更新检测
    $updateDialog: document.getElementById('updateDialog'),
    $urgentOverlay: document.getElementById('urgentOverlay'),
    $btnCheckUpdate: document.getElementById('btnCheckUpdate'),
    $btnUpdateLater: document.getElementById('btnUpdateLater'),
    $btnUpdateNow: document.getElementById('btnUpdateNow'),
    $btnUrgentUpdate: document.getElementById('btnUrgentUpdate'),
    $btnUrgentExit: document.getElementById('btnUrgentExit'),
  };
})();
