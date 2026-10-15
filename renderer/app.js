/**
 * 涨停财经聚合播报 - 桌面端渲染进程
 * 
 * 架构：Python 后端抓取 + WebSocket 代理 → 前端渲染
 * 通过 pywebview.api 调用 Python 后端
 */

(function () {
  'use strict';

  // ===== 调试开关 =====
  const DEBUG_MODE = false; // 生产环境关闭（方案B动作1：降CPU 1-2%）

  // ===== 共享工具（modules/utils.js，加载顺序在 app.js 之前）=====
  // esc / apiHas / unwrapResult / formatTime / p2 / formatVolume / formatAmount /
  // markdownToHtml / titleSimilarity / getBigrams —— 见 modules/utils.js
  const {
    apiHas, unwrapResult, esc, formatTime, p2,
    formatVolume, formatAmount, markdownToHtml, titleSimilarity, getBigrams,
  } = window.ztfi.utils;

  // ===== 状态 =====
  let autoScroll = true;
  let isPinned = false;
  let newsCount = 0;
  let hiddenCount = 0;
  let oldestCtime = null;
  const seenAids = new Set();
  const newAidBuffer = []; // 本次启动新增的 aid，待持久化
  // 相似消息去重：记录最近显示的消息 { aid, title, el, sources, dupCount }
  const recentItems = [];
  const MAX_RECENT = 50; // 只与最近50条比较，避免性能问题
  const MAX_DOM_ITEMS = 200; // 虚拟滚动：最多保留 DOM 节点数（减少内存占用）
  const MAX_HISTORY_DAYS = 7; // 历史消息最多保留7天
  // 延迟消息丢弃阈值：消息自带 ctime 与当前真实时间差超过此值（秒），视为过时旧消息直接丢弃。
  // 该项目是实时突发新闻播报工具，过时新闻没有实时指导意义（老板 2026-10-15 拍板）。
  const STALE_MSG_THRESHOLD = 120; // 120 秒

  // ===== 设置 =====
  // 注：原"消息来源"筛选（settings.sources + ALL_SOURCES + $sourceList）已于 2026-10-15 移除。
  // 理由：数据源管理（齿轮图标）的开关已精确表达用户"要/不要哪个源"的意愿，
  //       前端再加一道显示过滤闸属冗余，反而造成"两套开关认知负担"。
  // 去重 / 来源统计 / 卡片来源标签 功能不受影响（它们用各自独立字段）。

  let settings = loadSettings();
  // 暴露到全局，同步 darkMode 状态
  window._settings = settings;
  // 立即保存设置到文件（确保 Python 端能读取主题配置）
  try { saveSettings(); } catch(e) {}

  // ===== 新闻列表渲染服务（modules/news-list.js）=====
  // 注入 host：设置 getter + 共享状态访问器/集合引用 + 留在 app.js 的回调钩子
  window.ztfi.newsList.attach({
    getSettings: () => settings,
    recentItems, seenAids, newAidBuffer,
    maxRecent: MAX_RECENT,
    staleThreshold: STALE_MSG_THRESHOLD,
    getNewsCount: () => newsCount, setNewsCount: v => { newsCount = v; },
    getHiddenCount: () => hiddenCount, setHiddenCount: v => { hiddenCount = v; },
    getOldestCtime: () => oldestCtime, setOldestCtime: v => { oldestCtime = v; },
    isAutoScroll: () => autoScroll,
    recordSourceStats: window.ztfi.stats.recordSourceStats, classifyItem: window.ztfi.keywordAlert.classifyItem, updateCount,
    storeToHistory: window.ztfi.historyBuffer.storeToHistory,
    highlightElement: window.ztfi.keywordAlert.highlightElement, checkKeywordAlert: window.ztfi.keywordAlert.checkKeywordAlert,
    checkFavoriteStatus: window.ztfi.favoritesSearch.checkFavoriteStatus,
    toggleFavorite: window.ztfi.favoritesSearch.toggleFavorite,
    showNewsDetail: window.ztfi.newsDetail.showNewsDetail,
    updateAiArea: window.ztfi.aiService.updateAiArea, triggerAiAnalysis: window.ztfi.aiService.triggerAiAnalysis, markWatchlistMatch,
    showToast, shouldAnnounce, enqueueVoice,
  });
  // ===== 语音播报服务（modules/voice-service.js）=====
  const voiceSvc = window.ztfi.voiceService;
  // 注入设置访问器：settings 会被重载/重置，语音模块必须每次取最新对象
  voiceSvc.attach(() => settings);
  // 注入 host：设置读写 + 版本 + 重新初始化（同意隐私后需要）
  window.ztfi.dialogsLegal.attach({
    getSettings: () => settings,
    saveSettings: () => saveSettings(),
    getCurrentVersion: () => getCurrentVersion(),
    reinit: () => init(),
  });

  // 注入 host：toast + debugMode（其余走 utils/dom/historyStorage/MinuteChart 全局）
  window.ztfi.watchlistView.attach({
    showToast,
    debugMode: DEBUG_MODE,
  });
  // 注入 host：toast（其余走 utils + pywebview 全局）
  window.ztfi.dialogsDataSource.attach({
    showToast,
  });

  // 注入 host：设置读写 + 版本（完成引导时需持久化）
  window.ztfi.dialogsOnboarding.attach({
    getSettings: () => settings,
    getCurrentVersion: () => getCurrentVersion(),
    saveSettings: () => saveSettings(),
  });

  // 注入 host：设置读写 + 留在 app.js 的能力（关键词/高亮/自选股预警/收藏搜索/字体/版本）
  window.ztfi.settingsPanel.attach({
    getSettings: () => settings,
    saveSettings: () => saveSettings(),
    applyFontSize: (size) => applyFontSize(size),
    applyHighlightAll: () => window.ztfi.keywordAlert.applyHighlightAll(),
    removeHighlightAll: () => window.ztfi.keywordAlert.removeHighlightAll(),
    renderKeywordTags: () => window.ztfi.keywordAlert.renderKeywordTags(),
    addKeyword: () => window.ztfi.keywordAlert.addKeyword(),
    startWatchlistAlertMonitor: () => window.ztfi.watchlistAlert.startWatchlistAlertMonitor(),
    stopWatchlistAlertMonitor: () => window.ztfi.watchlistAlert.stopWatchlistAlertMonitor(),
    stopVoice: () => stopVoice(),
    showToast: (msg, opts) => showToast(msg, opts),
    loadFavorites: () => window.ztfi.favoritesSearch.loadFavorites(),
    performSearch: () => window.ztfi.favoritesSearch.performSearch(),
    updateFavoritesBadge: () => window.ztfi.favoritesSearch.updateFavoritesBadge(),
    getCurrentVersion: () => getCurrentVersion(),
  });
  // 注入 host：toast
  window.ztfi.updateCheck.attach({
    showToast: (msg, opts) => showToast(msg, opts),
  });
  // 注入 host：设置读写（waitForApi 会重载 settings）+ 启动/隐私/状态/统计/toast 回调
  window.ztfi.windowService.attach({
    getSettings: () => settings,
    reloadSettings: () => { settings = loadSettings(); window._settings = settings; },
    init: () => init(),
    showPrivacyDialog: () => showPrivacyDialog(),
    setStatus: (state, text) => setStatus(state, text),
    showToast: (msg, opts) => showToast(msg, opts),
    getStatsReport: () => window.ztfi.stats.getStatsReport(),
  });
  // 注入 host：toast + debugMode
  window.ztfi.favoritesSearch.attach({
    showToast: (msg, opts) => showToast(msg, opts),
    debugMode: DEBUG_MODE,
  });
  // 注入 host：debugMode + 历史保留天数
  window.ztfi.historyBuffer.attach({
    debugMode: DEBUG_MODE,
    maxHistoryDays: MAX_HISTORY_DAYS,
  });
  // ===== 评估指标统计（实现见 modules/stats.js）=====
  // 注入 host：debugMode
  window.ztfi.newsDetail.attach({
    debugMode: DEBUG_MODE,
  });
  // ===== 自选股异动提醒（实现见 modules/watchlist-alert.js）=====
  // 注入 host：每次取最新 settings + 多条件阈值（_alertConditions 留在 app.js，因 initTTSSettings 会重赋值）
  window.ztfi.watchlistAlert.attach({
    getSettings: () => settings,
    debugMode: DEBUG_MODE,
    getAlertConditions: () => _alertConditions,
  });
  // ===== 关键词高亮 / 警报 / 新闻分类（实现见 modules/keyword-alert.js）=====
  // 注入 host：每次取最新 settings + 保存 + 调试开关
  window.ztfi.keywordAlert.attach({
    getSettings: () => settings,
    saveSettings: () => saveSettings(),
    debugMode: DEBUG_MODE,
  });
  // ===== AI 解读服务（实现见 modules/ai-service.js）=====
  // 注入 host：每次取最新 settings + toast
  window.ztfi.aiService.attach({
    getSettings: () => settings,
    showToast: (msg, opts) => showToast(msg, opts),
  });
  // ===== UI 工具服务（实现见 modules/ui-utils.js）=====
  // 注入 host：计数 getter + 共享集合引用（seenAids/newAidBuffer/recentItems 必须是同一对象）+ 虚拟滚动上限
  window.ztfi.ui.attach({
    getNewsCount: () => newsCount,
    getHiddenCount: () => hiddenCount,
    seenAids,
    newAidBuffer,
    recentItems,
    maxDomItems: MAX_DOM_ITEMS,
    maxRecent: MAX_RECENT,
  });


  // ===== DOM（modules/dom.js 集中登记，加载顺序在 app.js 之前）=====
  const {
    $container, $newsList, $statusDot, $statusText, $newsCount, $lastUpdate, $loading,
    $btnAutoscroll, $btnPin, $btnLoadMore, $btnSettings, $btnSearch, $btnFavorites,
    $favoritesBadge, $btnReview, $btnWatchlist, $watchlistBadge,
    $searchDialog, $searchInput, $searchBtn, $searchCategory, $searchPriority, $searchResults,
    $favoritesDialog, $favoritesList,
    $btnThemeToggle, $settingsOverlay, $settingsClose,
    $voiceEnabled, $voiceSettings, $voiceSelect, $voiceTest, $voiceRate, $voiceSpeedRow,
    $voiceInterruptMode, $voiceInterruptModeRow,
    $aiEnabled, $aiApiKey, $aiApiUrl, $aiModelName, $aiApiKeyRow, $aiApiUrlRow, $aiModelNameRow,
    $aiTestRow, $aiConfigHint, $btnAiTest,
    $showStocks, $showRelated, $hideDuplicates,
    $keywordHighlight, $keywordInputRow, $keywordInput, $keywordAddBtn, $keywordTags, $keywordAlert,
    $fontSize,
    $updateDialog, $urgentOverlay, $btnCheckUpdate,
    $btnUpdateLater, $btnUpdateNow, $btnUrgentUpdate, $btnUrgentExit,
  } = window.ztfi.dom;

  // ===== 字体大小配置 =====
  const FONT_SCALE = {
    'small': 1.0,
    'medium': 1.125,
    'large': 1.25,
    'xlarge': 1.5
  };

  function applyFontSize(size) {
    const scale = FONT_SCALE[size] || 1.0;
    document.documentElement.style.setProperty('--font-scale', scale);
  }

  // ===== AI 解读（实现见 modules/ai-service.js）=====

  // ===== 初始化 =====
  async function init() {
    // 0. 优先从后端读取设置（打包后 localStorage 不稳定）
    try {
      if (apiHas('get_settings')) {
        const backendSettings = await pywebview.api.get_settings();
        if (DEBUG_MODE) console.log('[DEBUG] backendSettings:', backendSettings ? backendSettings.substring(0, 200) : 'null');
        if (backendSettings) {
          const parsed = unwrapResult(backendSettings);
          if (Object.keys(parsed).length > 0) {
            localStorage.setItem('ztfi-settings', JSON.stringify(parsed));
            settings = loadSettings();
          }
        }
      }
    } catch (e) {
      console.error('[DEBUG] get_settings error:', e);
    }

    // 1. 从 SQLite 加载已读 aid（持久化去重）
    try {
      const persisted = await pywebview.api.get_seen_aids();
      const aids = unwrapResult(persisted);
      if (Array.isArray(aids)) {
        aids.forEach(aid => seenAids.add(aid));
      }
    } catch (e) {
      // ignore
    }

    // 2. 从后端初始化自选股（打包后 IndexedDB 不稳定）
    try {
      if (window.historyStorage && window.historyStorage.initFromBackend) {
        await window.historyStorage.initFromBackend();
      }
    } catch (e) {}
    
    // 更新自选股数量徽章
    updateWatchlistBadge();

    setStatus('connecting', '正在获取数据...');
    try {
      const result = await pywebview.api.fetch_initial();
      if (DEBUG_MODE) console.log('[DEBUG] fetch_initial result:', result ? result.substring(0, 200) : 'null');
      const resp = unwrapResult(result);
      if (DEBUG_MODE) console.log('[DEBUG] fetch_initial parsed:', JSON.stringify(resp.status));

      if (resp.status !== 'ok') {
        setStatus('error', '获取失败: ' + (resp.message || '未知错误'));
        $loading.classList.remove('show');
        setTimeout(init, 30000);
        return;
      }

      // 解析初始 HTML
      if (DEBUG_MODE) console.log('[DEBUG] Calling parseAndRenderHTML...');
      parseAndRenderHTML(resp.html);
      $loading.classList.remove('show');

      // 启动 WebSocket（仅在传统聚合数据源启用时）
      if (resp.token && resp.wsConfig) {
        // 检查传统聚合（ztfi）数据源是否启用
        let ztfiEnabled = true; // 默认启用（兼容旧版）
        try {
          const dsResp = await pywebview.api.get_data_sources();
          const dsData = JSON.parse(dsResp);
          if (dsData.status === 'ok') {
            const ztfiSource = (dsData.sources || []).find(s => s.id === 'ztfi');
            if (ztfiSource) {
              ztfiEnabled = ztfiSource.enabled;
            }
          }
        } catch (e) {
          console.warn('[init] 获取数据源状态失败，默认启动 WebSocket:', e);
        }

        if (ztfiEnabled) {
          setStatus('connecting', '正在连接实时推送...');
          await pywebview.api.start_ws();
        } else {
          console.log('[init] 传统聚合（ztfi）已关闭，跳过 WebSocket 启动');
          setStatus('ok', '已连接（传统聚合已关闭）');
        }
      } else {
        setStatus('error', 'WS 配置缺失，30秒后重试...');
        setTimeout(init, 30000);
      }
    } catch (err) {
      setStatus('error', '初始化失败: ' + err.message);
      $loading.classList.remove('show');
      setTimeout(init, 30000);
    }

    initVoice();
    initSettings();
    window.ztfi.historyBuffer.scheduleCleanup();
    initTTSSettings();
  }

  // ===== TTS 设置初始化 =====
  function initTTSSettings() {

    // TTS 引擎选择
    const ttsEngineSelect = document.getElementById('ttsEngineSelect');
    const ttsVoiceRow = document.getElementById('ttsVoiceRow');
    if (ttsEngineSelect) {
      ttsEngineSelect.addEventListener('change', (e) => {
        voiceSvc.setEngine(e.target.value);
        localStorage.setItem('tts_engine', voiceSvc.getEngine());
        // 根据引擎切换显示对应音色行
        if ($voiceSettings) $voiceSettings.style.display = (settings.voiceEnabled && voiceSvc.getEngine() === 'web') ? 'flex' : 'none';
        if (ttsVoiceRow) ttsVoiceRow.style.display = (settings.voiceEnabled && voiceSvc.getEngine() === 'edge') ? 'flex' : 'none';
        // 切换到 Edge 时检测可用性
        if (voiceSvc.getEngine() === 'edge') {
          checkEdgeTTSAvailability();
        }
      });
      // 恢复保存的值
      voiceSvc.setEngine(localStorage.getItem('tts_engine') || 'web');
      ttsEngineSelect.value = voiceSvc.getEngine();
      if (ttsVoiceRow) ttsVoiceRow.style.display = (settings.voiceEnabled && voiceSvc.getEngine() === 'edge') ? 'flex' : 'none';
      // 启动时检测 Edge TTS 可用性
      if (voiceSvc.getEngine() === 'edge') {
        checkEdgeTTSAvailability();
      }
    }

    // 检测 Edge TTS 可用性并加载音色列表
    async function checkEdgeTTSAvailability() {
      try {
        if (!apiHas('tts_get_voices')) return;
        const result = await pywebview.api.tts_get_voices();
        const data = unwrapResult(result);
        if (data.status !== 'ok' || !data.voices) {
          console.warn('Edge TTS 不可用:', data.message || '未知错误');
          return;
        }
        // 音色列表已静态写在 HTML 中，这里仅做可用性确认
        console.log('Edge TTS 可用，音色数:', Object.keys(data.voices).length);
      } catch (e) {
        console.warn('Edge TTS 检测失败:', e);
      }
    }

    // TTS 音色选择
    const ttsVoiceSelect = document.getElementById('ttsVoiceSelect');
    if (ttsVoiceSelect) {
      ttsVoiceSelect.addEventListener('change', (e) => {
        voiceSvc.setVoice(e.target.value);
        localStorage.setItem('tts_voice', voiceSvc.getVoice());
      });
      voiceSvc.setVoice(localStorage.getItem('tts_voice') || 'zh-CN-YunyangNeural');
      ttsVoiceSelect.value = voiceSvc.getVoice();
    }

    // Edge TTS 试听按钮
    const ttsVoiceTestBtn = document.getElementById('ttsVoiceTest');
    if (ttsVoiceTestBtn) {
      ttsVoiceTestBtn.addEventListener('click', async () => {
        const voice = ttsVoiceSelect ? ttsVoiceSelect.value : 'zh-CN-YunyangNeural';
        const testText = '这是 Edge TTS 语音播报测试，欢迎使用涨停财经聚合播报。';
        ttsVoiceTestBtn.disabled = true;
        ttsVoiceTestBtn.textContent = '合成中...';
        try {
          if (apiHas('tts_synthesize')) {
            const result = await window.pywebview.api.tts_synthesize(testText, voice, '+0%', '+0%');
            const data = unwrapResult(result);
            if (data.status === 'ok' && data.audio_data) {
              const audio = new Audio(data.audio_data);
              audio.play().catch(err => console.warn('播放失败:', err));
            } else if (data.status === 'ok' && data.audio_path) {
              const audio = new Audio('file:///' + data.audio_path.replace(/\\/g, '/'));
              audio.play().catch(err => console.warn('播放失败:', err));
            } else {
              console.warn('Edge TTS 合成失败:', data.message);
              showToast('Edge TTS 合成失败：' + (data.message || '未知错误'), { type: 'error' });
            }
          }
        } catch (e) {
          console.warn('Edge TTS 试听失败:', e);
          showToast('Edge TTS 试听失败：' + e.message, { type: 'error' });
        } finally {
          ttsVoiceTestBtn.disabled = false;
          ttsVoiceTestBtn.textContent = '试听';
        }
      });
    }

    // TTS 关键词屏蔽
    const blockInput = document.getElementById('ttsBlockKeywordsInput');
    const blockTags = document.getElementById('ttsBlockKeywordsTags');
    if (blockInput) {
      try {
        voiceSvc.setBlockKeywords(JSON.parse(localStorage.getItem('tts_block_keywords') || '[]'));
      } catch (e) {
        voiceSvc.setBlockKeywords([]);
      }
      renderBlockKeywords();
      blockInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && blockInput.value.trim()) {
          e.preventDefault();
          voiceSvc.blockKeywords().push(blockInput.value.trim());
          blockInput.value = '';
          localStorage.setItem('tts_block_keywords', JSON.stringify(voiceSvc.blockKeywords()));
          renderBlockKeywords();
        }
      });
    }

    function renderBlockKeywords() {
      if (!blockTags) return;
      blockTags.innerHTML = '';
      voiceSvc.blockKeywords().forEach((kw, i) => {
        const tag = document.createElement('span');
        tag.style.cssText = 'display:inline-flex;align-items:center;gap:2px;padding:2px 6px;background:var(--tag-bg);color:var(--tag-text);border-radius:3px;font-size:11px;';
        tag.textContent = kw;
        const rmBtn = document.createElement('span');
        rmBtn.textContent = '×';
        rmBtn.style.cssText = 'cursor:pointer;margin-left:2px;font-weight:bold;';
        rmBtn.onclick = () => {
          voiceSvc.blockKeywords().splice(i, 1);
          localStorage.setItem('tts_block_keywords', JSON.stringify(voiceSvc.blockKeywords()));
          renderBlockKeywords();
        };
        tag.appendChild(rmBtn);
        blockTags.appendChild(tag);
      });
    }

    // 定时静音
    const silentEnabled = document.getElementById('ttsSilentEnabled');
    const silentPeriodsRow = document.getElementById('ttsSilentPeriodsRow');
    if (silentEnabled) {
      voiceSvc.setSilentEnabled(localStorage.getItem('tts_silent_enabled') === 'true');
      silentEnabled.checked = voiceSvc.isSilentEnabled();
      if (silentPeriodsRow) silentPeriodsRow.style.display = voiceSvc.isSilentEnabled() ? 'flex' : 'none';
      silentEnabled.addEventListener('change', (e) => {
        voiceSvc.setSilentEnabled(e.target.checked);
        localStorage.setItem('tts_silent_enabled', voiceSvc.isSilentEnabled());
        if (silentPeriodsRow) silentPeriodsRow.style.display = voiceSvc.isSilentEnabled() ? 'flex' : 'none';
        // 开启定时静音后若当前处于静音时段，立即停止正在播报的语音
        if (voiceSvc.isSilentEnabled() && isInSilentPeriod()) {
          stopVoice();
        }
      });
    }
    // 恢复静音时段
    try {
      const periods = JSON.parse(localStorage.getItem('tts_silent_periods') || '[]');
      if (periods[0]) {
        const s1 = document.getElementById('ttsSilentStart1');
        const e1 = document.getElementById('ttsSilentEnd1');
        if (s1) s1.value = periods[0].start;
        if (e1) e1.value = periods[0].end;
      }
      if (periods[1]) {
        const s2 = document.getElementById('ttsSilentStart2');
        const e2 = document.getElementById('ttsSilentEnd2');
        if (s2) s2.value = periods[1].start;
        if (e2) e2.value = periods[1].end;
      }
    } catch (e) {}
    // 保存静音时段
    ['ttsSilentStart1', 'ttsSilentEnd1', 'ttsSilentStart2', 'ttsSilentEnd2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', saveSilentPeriods);
      }
    });

    function saveSilentPeriods() {
      const periods = [];
      const s1 = document.getElementById('ttsSilentStart1')?.value;
      const e1 = document.getElementById('ttsSilentEnd1')?.value;
      const s2 = document.getElementById('ttsSilentStart2')?.value;
      const e2 = document.getElementById('ttsSilentEnd2')?.value;
      if (s1 && e1) periods.push({ start: s1, end: e1 });
      if (s2 && e2) periods.push({ start: s2, end: e2 });
      voiceSvc.setSilentPeriods(periods);
      localStorage.setItem('tts_silent_periods', JSON.stringify(periods));
      // 修改时段后若当前处于静音时段，立即停止正在播报的语音
      if (voiceSvc.isSilentEnabled() && isInSilentPeriod()) {
        stopVoice();
      }
    }
    saveSilentPeriods();

    // 多条件提醒设置
    const alertChangePercent = document.getElementById('alertChangePercent');
    const alertVolumeRatio = document.getElementById('alertVolumeRatio');
    const alertAmplitude = document.getElementById('alertAmplitude');
    const alertTriggerMode = document.getElementById('alertTriggerMode');
    const alertCooldown = document.getElementById('alertCooldown');

    if (alertChangePercent) {
      alertChangePercent.value = _alertConditions.changePercent;
      alertVolumeRatio.value = _alertConditions.volumeRatio;
      alertAmplitude.value = _alertConditions.amplitude;
      alertTriggerMode.value = _alertConditions.triggerMode;
      alertCooldown.value = _alertConditions.cooldown;

      [alertChangePercent, alertVolumeRatio, alertAmplitude, alertTriggerMode, alertCooldown].forEach(el => {
        if (el) el.addEventListener('change', () => {
          _alertConditions = {
            changePercent: parseFloat(alertChangePercent.value) || 5,
            volumeRatio: parseFloat(alertVolumeRatio.value) || 2,
            amplitude: parseFloat(alertAmplitude.value) || 8,
            triggerMode: alertTriggerMode.value || 'any',
            cooldown: parseInt(alertCooldown.value) || 300
          };
          localStorage.setItem('alert_conditions', JSON.stringify(_alertConditions));
        });
      });
    }

    // 启动自选股监控
    window.ztfi.watchlistAlert.startWatchlistAlertMonitor();
  }

  // ===== 后端事件回调 =====
  window._onBackendEvent = async function (event, data) {
    switch (event) {
      case 'ws_open':
        if (typeof setStatus === 'function') {
          setStatus('connected', '已连接 · 实时推送中');
        }
        break;
      case 'ws_message':
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (typeof handleNewsItem === 'function') {
                await handleNewsItem(item);
              }
            }
          } else if (parsed && typeof parsed === 'object' && parsed.aid) {
            // WebSocket 消息可能没有 ctime，用当前时间补充
            if (!parsed.ctime) parsed.ctime = Math.floor(Date.now() / 1000);
            if (typeof handleNewsItem === 'function') {
              await handleNewsItem(parsed);
            }
          }
        } catch (e) {
          console.error('ws_message parse error:', e);
        }
        break;
      case 'ws_close':
        if (typeof setStatus === 'function') {
          setStatus('error', '连接断开，重连中...');
        }
        break;
      case 'ws_error':
        if (typeof setStatus === 'function') {
          setStatus('error', '连接错误: ' + data);
        }
        break;
      case 'update_progress':
        if (typeof updateDownloadProgress === 'function') {
          updateDownloadProgress(parseInt(data) || 0);
        }
        break;
    }
  };

  // ===== 新闻列表渲染（实现见 modules/news-list.js；保留薄包装以稳定既有调用点）=====
  function parseAndRenderHTML(html) { return window.ztfi.newsList.parseAndRenderHTML(html); }
  function handleNewsItem(item) { return window.ztfi.newsList.handleNewsItem(item); }
  function appendNewsItem(item) { return window.ztfi.newsList.appendNewsItem(item); }

  // ===== 自选股匹配标记 =====
  async function markWatchlistMatch(el, item) {
    if (!window.historyStorage) return;
    
    try {
      const text = (item.title || '') + ' ' + (item.content || '');
      const matches = await window.historyStorage.matchWatchlistInText(text);
      
      if (matches && matches.length > 0) {
        el.classList.add('watchlist-match');
        
        const header = el.querySelector('.news-header');
        if (header) {
          const badge = document.createElement('span');
          badge.className = 'watchlist-badge';
          badge.title = '涉及自选股: ' + matches.map(m => m.name || m.code).join(', ');
          badge.textContent = '⭐自选';
          badge.addEventListener('click', (e) => {
            e.stopPropagation();
            if (matches.length === 1) {
              showStockQuoteDialog(matches[0].code);
            }
          });
          header.insertBefore(badge, header.firstChild);
        }
      }
    } catch (err) {
      if (DEBUG_MODE) console.warn('自选股匹配失败:', err);
    }
  }

  // ===== 收藏 / 搜索（实现见 modules/favorites-search.js）=====

  // ===== 自选股（实现见 modules/watchlist-view.js；保留薄包装以稳定既有调用点）=====
  function showWatchlistDialog() { return window.ztfi.watchlistView.showWatchlistDialog(); }
  function updateWatchlistBadge() { return window.ztfi.watchlistView.updateWatchlistBadge(); }
  function showStockQuoteDialog(code) { return window.ztfi.watchlistView.showStockQuoteDialog(code); }
  
  // ===== 自选股异动提醒 / 多条件提醒 / 盘口异动（实现见 modules/watchlist-alert.js）=====
  // 注：_alertConditions 留在 app.js（initTTSSettings 会读取并重赋值），经 host 注入给模块。
  let _alertConditions;
  try {
    _alertConditions = JSON.parse(localStorage.getItem('alert_conditions') || '{"changePercent":5,"volumeRatio":2,"amplitude":8,"triggerMode":"any","cooldown":300}');
  } catch (e) {
    console.warn('[alert_conditions] localStorage 数据损坏，使用默认值', e);
    _alertConditions = {"changePercent":5,"volumeRatio":2,"amplitude":8,"triggerMode":"any","cooldown":300};
  }

  // ===== 加载更多（实现见 modules/ui-utils.js）=====
  function loadMore() { return window.ztfi.ui.loadMore(); }

  // ===== 语音播报（实现见 modules/voice-service.js；此处保留薄包装以稳定既有调用点）=====
  function initVoice() { window.ztfi.voiceService.init(); }
  function stopVoice() { window.ztfi.voiceService.stop(); }
  function isInSilentPeriod() { return window.ztfi.voiceService.isInSilentPeriod(); }
  function shouldAnnounce(item) { return window.ztfi.voiceService.shouldAnnounce(item); }
  function enqueueVoice(text, ctime) { window.ztfi.voiceService.enqueue(text, ctime); }

  // ===== 设置（加载/保存/版本逻辑见 modules/settings-store.js）=====
  function loadSettings() { return window.ztfi.settingsStore.load(); }
  function getCurrentVersion() { return window.ztfi.settingsStore.getCurrentVersion(); }
  // 注：saveSettings 保留为无参包装，因调用点达 26 处且共享同一闭包 settings。
  function saveSettings() { window.ztfi.settingsStore.save(settings); }

  // ===== 设置面板（实现见 modules/settings-panel.js）=====
  function initSettings() { return window.ztfi.settingsPanel.initSettings(); }

  // 注：原 updateSourceSettings() 函数已于 2026-10-15 移除（"消息来源"筛选功能整体下线）。

  // ===== 关键词高亮 / 关键词警报 / 新闻分类（实现见 modules/keyword-alert.js）=====

  // ===== 历史存储（批量优化，实现见 modules/history-buffer.js）=====

  // ===== 新闻详情弹窗（实现见 modules/news-detail.js）=====

  // ===== UI 工具（toast / 状态 / 计数 / 虚拟滚动 / aid 持久化，实现见 modules/ui-utils.js）=====
  // 保留薄包装以稳定既有「bare 调用点 + 各模块 host 钩子」引用。
  function showToast(message, opts) { return window.ztfi.ui.showToast(message, opts); }
  function setStatus(state, text) { return window.ztfi.ui.setStatus(state, text); }
  function updateCount() { return window.ztfi.ui.updateCount(); }
  function flushAidBuffer() { return window.ztfi.ui.flushAidBuffer(); }

  // ===== 滚动检测 =====
  $container.addEventListener('scroll', () => {
    const atTop = $container.scrollTop < 10;
    if (autoScroll && !atTop) {
      autoScroll = false;
      $btnAutoscroll.classList.remove('active');
    }
    if (!autoScroll && atTop) {
      autoScroll = true;
      $btnAutoscroll.classList.add('active');
    }
  });

  // ===== 按钮事件 =====
  // 初始化按钮状态（从 settings 恢复）
  autoScroll = settings.autoScroll;
  isPinned = settings.isPinned;
  $btnAutoscroll.classList.toggle('active', autoScroll);
  $btnPin.classList.toggle('active', isPinned);

  $btnAutoscroll.addEventListener('click', () => {
    autoScroll = !autoScroll;
    settings.autoScroll = autoScroll;
    saveSettings();
    $btnAutoscroll.classList.toggle('active', autoScroll);
    if (autoScroll) $container.scrollTop = 0;
  });

  $btnPin.addEventListener('click', () => {
    isPinned = !isPinned;
    settings.isPinned = isPinned;
    saveSettings();
    $btnPin.classList.toggle('active', isPinned);
    console.log('[置顶调试] pywebview:', typeof window.pywebview);
    console.log('[置顶调试] pywebview.api:', typeof window.pywebview?.api);
    console.log('[置顶调试] toggle_pin:', typeof window.pywebview?.api?.toggle_pin);
    console.log('[置顶调试] isPinned:', isPinned);
    if (window.pywebview && window.pywebview.api) {
      pywebview.api.toggle_pin(isPinned).then(result => {
        console.log('[置顶调试] toggle_pin 返回:', result);
      }).catch(err => {
        console.error('[置顶调试] toggle_pin 失败:', err);
      });
    }
  });

  $btnLoadMore.addEventListener('click', loadMore);

  // ===== 对话框（免责/隐私/协议/赞赏 实现见 modules/dialogs-legal.js）=====
  function showDonateDialog() { return window.ztfi.dialogsLegal.showDonateDialog(); }
  function showPrivacyDialog() { return window.ztfi.dialogsLegal.showPrivacyDialog(); }
  function showPolicyDetail(section) { return window.ztfi.dialogsLegal.showPolicyDetail(section); }

  document.addEventListener('click', (e) => {
    if (e.target.closest('#btnDonate') || e.target.closest('#statusDonateBtn')) showDonateDialog();
  });

  // ===== 启动 =====
  // 页面关闭前持久化剩余 aid
  window.addEventListener('beforeunload', () => {
    flushAidBuffer();
  });

  // ===== 窗口 / 主题 / 启动探测（实现见 modules/window-service.js）=====

  // ===== 首次启动引导（实现见 modules/dialogs-onboarding.js）=====
  function showOnboardingDialog() { return window.ztfi.dialogsOnboarding.showOnboardingDialog(); }





  // ===== 数据源管理对话框（实现见 modules/dialogs-datasource.js）=====
  function showDataSourceDialog() { return window.ztfi.dialogsDataSource.showDataSourceDialog(); }

  // 绑定对话框按钮事件
  document.addEventListener('click', (e) => {
    if (e.target.closest('#btnDataSources')) showDataSourceDialog();
  });

  // ===== 更新检测功能（DOM 引用见 modules/dom.js）=====

  window._onUpdateAvailable = function(dataStr) {
    try {
      const data = JSON.parse(dataStr);
      if (data.urgent) {
        window.ztfi.updateCheck.showUrgentOverlay(data);
      } else {
        window.ztfi.updateCheck.showUpdateDialog(data);
      }
    } catch (e) {
      console.error('解析更新数据失败:', e);
    }
  };



  // ===== 更新检测（实现见 modules/update-check.js）=====

})();
