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
    recordSourceStats, classifyItem, storeToHistory, updateCount,
    highlightElement, checkKeywordAlert,
    checkFavoriteStatus, toggleFavorite, showNewsDetail,
    updateAiArea, triggerAiAnalysis, markWatchlistMatch,
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
    applyHighlightAll: () => applyHighlightAll(),
    removeHighlightAll: () => removeHighlightAll(),
    renderKeywordTags: () => renderKeywordTags(),
    addKeyword: () => addKeyword(),
    startWatchlistAlertMonitor: () => startWatchlistAlertMonitor(),
    stopWatchlistAlertMonitor: () => stopWatchlistAlertMonitor(),
    stopVoice: () => stopVoice(),
    showToast: (msg, opts) => showToast(msg, opts),
    loadFavorites: () => loadFavorites(),
    performSearch: () => performSearch(),
    updateFavoritesBadge: () => updateFavoritesBadge(),
    getCurrentVersion: () => getCurrentVersion(),
  });
  // ===== 评估指标统计 =====
  const stats = {
    sourceCounts: {},
    sourceClicks: {},
    sourceDelays: {},
    totalMessages: 0,
    totalClicks: 0,
    startTime: Date.now(),
  };
  
  function recordSourceStats(item) {
    const source = item.comefrom || item.source_id || 'unknown';
    if (!stats.sourceCounts[source]) {
      stats.sourceCounts[source] = 0;
      stats.sourceClicks[source] = 0;
      stats.sourceDelays[source] = [];
    }
    stats.sourceCounts[source]++;
    stats.totalMessages++;
    
    const delay = Date.now() - (item.ctime || Date.now()) * 1000;
    if (delay >= 0) {
      stats.sourceDelays[source].push(delay);
    }
  }
  
  function recordSourceClick(item) {
    const source = item.comefrom || item.source_id || 'unknown';
    if (!stats.sourceClicks[source]) {
      stats.sourceClicks[source] = 0;
    }
    stats.sourceClicks[source]++;
    stats.totalClicks++;
  }
  
  function getStatsReport() {
    const report = {
      totalMessages: stats.totalMessages,
      totalClicks: stats.totalClicks,
      uptime: Math.floor((Date.now() - stats.startTime) / 1000),
      sources: {},
    };
    for (const source in stats.sourceCounts) {
      const delays = stats.sourceDelays[source];
      const avgDelay = delays.length > 0 ? Math.floor(delays.reduce((a, b) => a + b, 0) / delays.length) : 0;
      const maxDelay = delays.length > 0 ? Math.max(...delays) : 0;
      report.sources[source] = {
        count: stats.sourceCounts[source],
        clicks: stats.sourceClicks[source],
        clickRate: stats.sourceCounts[source] > 0 ? 
          ((stats.sourceClicks[source] / stats.sourceCounts[source]) * 100).toFixed(1) : 0,
        avgDelay: avgDelay,
        maxDelay: maxDelay,
      };
    }
    return report;
  }

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

  // ===== AI分析相关变量 =====
  const AI_RATE_LIMIT = 3; // 每分钟最多3条
  const AI_CACHE_PREFIX = 'ai_result_';
  let aiAnalysisQueue = []; // 待分析队列
  let aiAnalysisCount = 0; // 本分钟分析数量
  let aiAnalysisLastReset = Date.now(); // 上次重置时间

  // ===== AI分析器 =====
  window.aiAnalyzer = {
    async analyze(title, content, opts) {
      opts = opts || {};
      const isAuto = opts.isAuto === true;
      if (!settings.aiEnabled || !settings.aiApiKey) {
        // 只在用户主动点击的场景弹引导提示；自动触发场景静默 return 避免打扰
        if (!isAuto) {
          showToast('AI 解读需要先配置 API 密钥', {
            type: 'warning',
            action: {
              label: '去配置',
              callback: () => window.openSettingsAtSection('ai')
            }
          });
        }
        return null;
      }
      try {
        const result = await pywebview.api.ai_analyze(
          title,
          content,
          'custom',
          settings.aiApiKey,
          settings.aiApiUrl || '',
          settings.aiModelName || ''
        );
        const parsed = JSON.parse(result);
        if (parsed.error) {
          console.error('AI分析失败:', parsed.error);
          return null;
        }
        return parsed;
      } catch (e) {
        console.error('AI分析异常:', e);
        return null;
      }
    }
  };

  // ===== AI分析结果缓存 =====
  function getAiCache(aid) {
    try {
      const key = AI_CACHE_PREFIX + aid;
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function setAiCache(aid, result) {
    try {
      const key = AI_CACHE_PREFIX + aid;
      localStorage.setItem(key, JSON.stringify(result));
    } catch (e) {}
  }

  // ===== 触发AI分析 =====
  async function triggerAiAnalysis(item, div, isAuto = false) {
    const aid = item.aid;

    // 检查缓存
    if (item.aiResult) {
      updateAiArea(div, item.aiResult);
      return;
    }

    // 检查本地缓存
    const cached = getAiCache(aid);
    if (cached) {
      try {
        item.aiResult = JSON.parse(cached);
        updateAiArea(div, item.aiResult);
        return;
      } catch (e) {}
    }

    // 频率限制（仅自动触发）
    if (isAuto) {
      const now = Date.now();
      if (now - aiAnalysisLastReset > 60000) {
        aiAnalysisCount = 0;
        aiAnalysisLastReset = now;
      }
      if (aiAnalysisCount >= AI_RATE_LIMIT) {
        return; // 超过频率限制
      }
      aiAnalysisCount++;
    }

    // 更新按钮状态
    const aiBtn = div.querySelector('.btn-ai-interpret');
    if (aiBtn) {
      aiBtn.textContent = '分析中...';
      aiBtn.disabled = true;
    }

    // 执行分析（透传 isAuto 标志，让 analyze 在未配置时不弹 toast 避免自动触发打扰）
    const result = await window.aiAnalyzer.analyze(item.title, item.content, { isAuto: isAuto });

    if (result) {
      item.aiResult = result;
      setAiCache(aid, result);
      updateAiArea(div, result);
    } else {
      // 分析失败，恢复按钮
      if (aiBtn) {
        aiBtn.textContent = 'AI解读';
        aiBtn.disabled = false;
      }
    }
  }

  // ===== 更新AI区域UI =====
  function updateAiArea(div, result) {
    const aiArea = div.querySelector('.ai-area');
    if (!aiArea || !result) return;

    // A股市场：红涨绿跌
    const sentimentConfig = {
      'positive': { icon: '↑', text: '利好', color: '#E53935' },
      'negative': { icon: '↓', text: '利空', color: '#43A047' },
      'neutral': { icon: '—', text: '中性', color: '#FFA726' }
    };
    const sentiment = sentimentConfig[result.sentiment] || sentimentConfig.neutral;
    const confidence = result.confidence ? Math.round(result.confidence * 100) : '--';

    aiArea.innerHTML = `
      <span class="ai-badge" title="AI分析">AI</span>
      <span class="ai-sentiment" style="color: ${sentiment.color}; font-weight: bold;">
        ${sentiment.icon}${sentiment.text}
      </span>
      <span class="ai-confidence" title="置信度">${confidence}%</span>
    `;

    // 添加AI摘要（在标题下方）
    if (result.summary) {
      let summaryEl = div.querySelector('.ai-summary');
      if (!summaryEl) {
        summaryEl = document.createElement('div');
        summaryEl.className = 'ai-summary';
        const titleEl = div.querySelector('.news-title');
        if (titleEl) {
          titleEl.insertAdjacentElement('afterend', summaryEl);
        }
      }
      summaryEl.innerHTML = `📋 <span class="ai-summary-label">AI摘要：</span>${esc(result.summary)}`;
    }
  }

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
    scheduleCleanup();
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
    startWatchlistAlertMonitor();
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

  // ===== 收藏功能 =====
  async function checkFavoriteStatus(messageId, btn) {
    if (!window.historyStorage) return;
    try {
      const isFav = await window.historyStorage.isFavorite(messageId);
      if (isFav) {
        btn.classList.add('favorited');
      }
    } catch (err) {
      if (DEBUG_MODE) console.warn('检查收藏状态失败:', err);
    }
  }

  async function toggleFavorite(item, btn) {
    if (!window.historyStorage) {
      console.warn('收藏功能未初始化');
      return;
    }
    
    const messageId = item.aid;
    try {
      const isFav = await window.historyStorage.isFavorite(messageId);
      
      if (isFav) {
        await window.historyStorage.removeFavorite(messageId);
        btn.classList.remove('favorited');
        if (DEBUG_MODE) console.log('取消收藏:', item.title);
      } else {
        await window.historyStorage.addFavorite(item);
        btn.classList.add('favorited');
        if (DEBUG_MODE) console.log('已收藏:', item.title);
      }
      updateFavoritesBadge();
    } catch (err) {
      console.error('收藏操作失败:', err);
    }
  }

  async function updateFavoritesBadge() {
    if (!window.historyStorage) return;
    try {
      const count = await window.historyStorage.getFavoritesCount();
      if ($favoritesBadge) {
        if (count > 0) {
          $favoritesBadge.textContent = count;
          $favoritesBadge.style.display = 'inline-block';
        } else {
          $favoritesBadge.style.display = 'none';
        }
      }
    } catch (err) {
      if (DEBUG_MODE) console.warn('更新收藏徽章失败:', err);
    }
  }

  async function loadFavorites() {
    if (!window.historyStorage) return;
    try {
      const favorites = await window.historyStorage.getAllFavorites();
      
      if (!favorites || favorites.length === 0) {
        $favoritesList.innerHTML = '<div class="favorites-empty">暂无收藏消息</div>';
        return;
      }
      
      $favoritesList.innerHTML = favorites.map(fav => `
        <div class="favorite-item" data-id="${fav.id}">
          <div class="fav-title">${esc(fav.title)}</div>
          <div class="fav-meta">${fav.source || ''} · ${formatTime(fav.timestamp)}</div>
          <div class="fav-actions">
            <button class="btn-fav-copy">复制</button>
            <button class="btn-fav-remove">取消收藏</button>
          </div>
        </div>
      `).join('');
      
      $favoritesList.querySelectorAll('.btn-fav-copy').forEach((btn, idx) => {
        btn.addEventListener('click', () => {
          const fav = favorites[idx];
          const text = `${fav.title}\n${fav.content || ''}\n来源: ${fav.source || ''}`;
          navigator.clipboard.writeText(text.trim()).then(() => {
            showToast('已复制到剪贴板');
          }).catch(() => {
            const textarea = document.createElement('textarea');
            textarea.value = text.trim();
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showToast('已复制到剪贴板');
          });
        });
      });
      
      $favoritesList.querySelectorAll('.btn-fav-remove').forEach((btn, idx) => {
        btn.addEventListener('click', async () => {
          const fav = favorites[idx];
          await window.historyStorage.removeFavorite(fav.id);
          updateFavoritesBadge();
          loadFavorites();
          showToast('已取消收藏');
        });
      });
    } catch (err) {
      console.error('加载收藏失败:', err);
      $favoritesList.innerHTML = '<div class="favorites-empty">加载失败</div>';
    }
  }

  async function performSearch() {
    if (!window.historyStorage) return;
    
    const query = $searchInput.value.trim();
    const category = $searchCategory.value || null;
    const priority = $searchPriority.value || null;
    
    try {
      $searchResults.innerHTML = '<div class="search-empty">搜索中...</div>';
      
      const results = await window.historyStorage.searchMessages(query, {
        limit: 50,
        category,
        priority
      });
      
      if (!results || results.length === 0) {
        $searchResults.innerHTML = '<div class="search-empty">未找到匹配的消息</div>';
        return;
      }
      
      $searchResults.innerHTML = results.map(msg => `
        <div class="search-result-item" data-id="${msg.id}">
          <div class="result-title">${esc(msg.title)}</div>
          <div class="result-meta">${msg.source || ''} · ${formatTime(msg.timestamp)} · ${msg.category || ''}</div>
        </div>
      `).join('');
      
      $searchResults.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
          $searchDialog.style.display = 'none';
        });
      });
    } catch (err) {
      console.error('搜索失败:', err);
      $searchResults.innerHTML = '<div class="search-empty">搜索出错</div>';
    }
  }

  // ===== 自选股（实现见 modules/watchlist-view.js；保留薄包装以稳定既有调用点）=====
  function showWatchlistDialog() { return window.ztfi.watchlistView.showWatchlistDialog(); }
  function updateWatchlistBadge() { return window.ztfi.watchlistView.updateWatchlistBadge(); }
  function showStockQuoteDialog(code) { return window.ztfi.watchlistView.showStockQuoteDialog(code); }
  
  // ===== 自选股异动提醒 =====
  let watchlistAlertTimer = null;
  let watchlistAlertState = {}; // {code: {lastTime, lastHigh, lastLow}} 记录每只股票上次提醒状态

  function startWatchlistAlertMonitor() {
    if (watchlistAlertTimer) return;
    
    // 立即检查一次
    checkWatchlistAlerts();
    
    // 每 2 分钟检查一次（足够及时，CPU 减半；非交易时间 checkWatchlistAlerts 内部直接 return）
    watchlistAlertTimer = setInterval(() => {
      checkWatchlistAlerts();
    }, 120000);
    
    if (DEBUG_MODE) console.log('[自选股提醒] 监控已启动');
  }

  function stopWatchlistAlertMonitor() {
    if (watchlistAlertTimer) {
      clearInterval(watchlistAlertTimer);
      watchlistAlertTimer = null;
    }
    if (DEBUG_MODE) console.log('[自选股提醒] 监控已停止');
  }

  async function checkWatchlistAlerts() {
    if (!settings.watchlistAlertEnabled) return;
    if (!window.historyStorage) return;

    // 收盘后不执行自选股异动提醒（交易时间：9:25-11:30, 13:00-15:00）
    const dateNow = new Date();
    const day = dateNow.getDay();
    const hours = dateNow.getHours();
    const minutes = dateNow.getMinutes();
    const time = hours * 60 + minutes; // 当天分钟数
    // 周末不检查
    if (day === 0 || day === 6) return;
    // 非交易时间段不检查（9:25=565, 11:30=690, 13:00=780, 15:00=900）
    const inMorning = time >= 565 && time <= 690;
    const inAfternoon = time >= 780 && time <= 900;
    if (!inMorning && !inAfternoon) return;
    
    try {
      const watchlist = await window.historyStorage.getAllWatchlist();
      if (!watchlist || watchlist.length === 0) return;
      
      // 获取所有自选股代码
      const codes = watchlist.map(s => s.code);
      
      // 创建代码到阈值的映射
      const thresholdMap = {};
      watchlist.forEach(s => {
        thresholdMap[s.code] = s.alertThreshold || settings.watchlistAlertThreshold || 5;
      });
      
      // 批量查询行情
      const batchResult = await batchGetQuotes(codes);
      if (!batchResult || batchResult.length === 0) return;
      
      const timestampNow = Date.now();
      const defaultThreshold = settings.watchlistAlertThreshold || 5;
      const intervalMs = (settings.watchlistAlertInterval || 5) * 60 * 1000;
      
      // 检查每只股票
      for (const q of batchResult) {
        if (!q || !q.quote) continue;
        
        const changePercent = Math.abs(q.quote.changePercent || 0);
        const code = q.quote.code;
        const price = q.quote.price || 0;
        const isUp = (q.quote.changePercent || 0) > 0;
        
        // 使用该股票的独立阈值，若无则使用全局阈值
        const stockThreshold = thresholdMap[code] || defaultThreshold;
        
        // 检查是否超过阈值
        if (changePercent >= stockThreshold) {
          const state = watchlistAlertState[code];
          
          if (!state) {
            // 第一次触发，立即提醒
            watchlistAlertState[code] = {
              lastTime: timestampNow,
              lastHigh: price,
              lastLow: price
            };
            showWatchlistAlertPopup(q.quote, stockThreshold);
          } else {
            // 检查是否创新高或新低
            const hitNewHigh = isUp && price > state.lastHigh;
            const hitNewLow = !isUp && price < state.lastLow;
            
            if (hitNewHigh || hitNewLow) {
              // 创新高或新低，再次提醒
              watchlistAlertState[code] = {
                lastTime: timestampNow,
                lastHigh: hitNewHigh ? price : state.lastHigh,
                lastLow: hitNewLow ? price : state.lastLow
              };
              showWatchlistAlertPopup(q.quote, stockThreshold);
            } else {
              if (DEBUG_MODE) console.log(`[自选股提醒] ${code} 未创新高/新低，跳过`);
            }
          }
        } else {
          // 未超过阈值，重置状态（允许下次重新触发）
          watchlistAlertState[code] = null;
        }

        // 多条件提醒检查
        checkMultiConditionAlerts(q.quote);
        // 盘口异动检查（每30秒检查一次）
        if (Math.floor(Date.now() / 30000) % 2 === 0) { // 降频检查
          checkOrderbookAlert(q.quote.code, q.quote.name);
        }
      }
    } catch (err) {
      if (DEBUG_MODE) console.error('[自选股提醒] 检查失败:', err);
    }
  }

  async function batchGetQuotes(codes) {
    if (!codes || codes.length === 0) return [];

    // 走后端代理：避免 WebView2 直连外部 API 触发 CORS、暴露调用路径
    // 后端实现：app.py 的 batch_get_stock_quotes（复用 _http session）
    try {
      const api = window.pywebview && window.pywebview.api;
      if (!api || !api.batch_get_stock_quotes) {
        if (DEBUG_MODE) console.error('[自选股提醒] 后端 batch_get_stock_quotes 接口不可用');
        return [];
      }
      const resp = await api.batch_get_stock_quotes(codes);
      if (!resp || !resp.status || resp.status !== 'ok' || !Array.isArray(resp.quotes)) {
        if (DEBUG_MODE) console.error('[自选股提醒] 批量查询失败:', resp && resp.message);
        return [];
      }
      // 包装成 {quote: {...}} 形式以兼容现有调用方
      return resp.quotes.map(q => ({ quote: q }));
    } catch (err) {
      if (DEBUG_MODE) console.error('[自选股提醒] 批量查询异常:', err);
      return [];
    }
  }

  function showWatchlistAlertPopup(quote, threshold) {
    const changePercent = quote.changePercent || 0;
    const change = quote.change || 0;
    const isUp = changePercent > 0;
    const direction = isUp ? '上涨' : '下跌';
    const alertThreshold = threshold || settings.watchlistAlertThreshold || 5;
    
    // 播放提醒声音
    if (settings.watchlistAlertSound) {
      playAlertSound();
    }
    
    // 创建弹窗
    const dialog = document.createElement('div');
    dialog.className = 'watchlist-alert-dialog';
    
    const changeStr = `${isUp ? '+' : ''}${change.toFixed(2)} (${isUp ? '+' : ''}${changePercent.toFixed(2)}%)`;
    
    dialog.innerHTML = `
      <div class="alert-header">
        <div class="alert-icon ${isUp ? 'up' : 'down'}">${isUp ? '📈' : '📉'}</div>
        <div class="alert-title">自选股异动提醒</div>
        <button class="dialog-close-btn" title="关闭">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
      <div class="alert-body">
        <div class="alert-stock-name">${esc(quote.name)}</div>
        <div class="alert-stock-code">${esc(quote.code)}</div>
        <div class="alert-price ${isUp ? 'up' : 'down'}">${quote.price.toFixed(2)}</div>
        <div class="alert-change ${isUp ? 'up' : 'down'}">${changeStr}</div>
        <div class="alert-message">${direction}幅度超过 ${alertThreshold}%</div>
        <div class="alert-actions">
          <button class="alert-view-btn" data-code="${quote.code}">查看详情</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // 关闭按钮
    dialog.querySelector('.dialog-close-btn').addEventListener('click', () => {
      dialog.remove();
    });
    
    // 查看详情按钮
    dialog.querySelector('.alert-view-btn').addEventListener('click', () => {
      dialog.remove();
      showStockQuoteDialog(quote.code);
    });
    
    // 5秒后自动关闭
    setTimeout(() => {
      if (dialog.parentNode) {
        dialog.remove();
      }
    }, 5000);
    
    if (DEBUG_MODE) console.log(`[自选股提醒] 触发提醒: ${quote.name} ${changePercent.toFixed(2)}%`);
  }

  // 注：playAlertSound 的唯一实现见文件后半部分（关键词命中附近）；
  // 这里不再重复定义，所有调用点共用同一个函数和同一个 AudioContext 单例。

  // ===== 多条件提醒 + 智能阈值 + 盘口异动 =====
  let _alertConditions;
  try {
    _alertConditions = JSON.parse(localStorage.getItem('alert_conditions') || '{"changePercent":5,"volumeRatio":2,"amplitude":8,"triggerMode":"any","cooldown":300}');
  } catch (e) {
    console.warn('[alert_conditions] localStorage 数据损坏，使用默认值', e);
    _alertConditions = {"changePercent":5,"volumeRatio":2,"amplitude":8,"triggerMode":"any","cooldown":300};
  }
  let _alertLastTrigger = {}; // 记录每只股票上次触发时间

  // 计算ATR（平均真实波幅）
  async function calculateATR(code) {
    try {
      if (!apiHas('get_stock_history')) return 0;
      const result = await window.pywebview.api.get_stock_history(code, 21);
      const data = unwrapResult(result);
      if (data.status !== 'ok' || !data.data || data.data.length < 2) return 0;

      let trSum = 0;
      const klines = data.data;
      for (let i = 1; i < klines.length; i++) {
        const high = klines[i].high;
        const low = klines[i].low;
        const prevClose = klines[i-1].close;
        const tr = Math.max(
          high - low,
          Math.abs(high - prevClose),
          Math.abs(low - prevClose)
        );
        trSum += tr;
      }
      const atr = trSum / (klines.length - 1);
      const lastClose = klines[klines.length - 1].close;
      return lastClose > 0 ? (atr / lastClose * 100) : 0; // 返回ATR百分比
    } catch (e) {
      console.error('计算ATR失败:', e);
      return 0;
    }
  }

  // 获取智能阈值
  async function getSmartThreshold(code) {
    const atr = await calculateATR(code);
    const baseThreshold = _alertConditions.changePercent || 5;
    // 智能阈值 = max(固定阈值, 2 × ATR%)
    return Math.max(baseThreshold, atr * 2);
  }

  // 计算20日平均成交量
  async function getAvgVolume(code) {
    try {
      if (!window.pywebview || !window.pywebview.api) return 0;
      const result = await window.pywebview.api.get_stock_history(code, 21);
      const data = JSON.parse(result);
      if (data.status !== 'ok' || !data.data || data.data.length < 2) return 0;
      const klines = data.data;
      let volSum = 0;
      for (let i = 0; i < klines.length - 1; i++) { // 不含今天
        volSum += klines[i].volume;
      }
      return volSum / (klines.length - 1);
    } catch (e) {
      return 0;
    }
  }

  // 多条件提醒检查
  async function checkMultiConditionAlerts(stockData) {
    if (!_alertConditions) return;
    const code = stockData.code || stockData.id;
    const name = stockData.name || stockData.title || '';

    // 冷却检查
    const now = Date.now();
    if (_alertLastTrigger[code] && (now - _alertLastTrigger[code]) < (_alertConditions.cooldown || 300) * 1000) {
      return;
    }

    const results = [];

    // 条件1：涨跌幅
    const changePercent = Math.abs(parseFloat(stockData.changePercent || stockData.rise || 0));
    const smartThreshold = await getSmartThreshold(code);
    if (changePercent >= smartThreshold) {
      results.push({ type: '涨跌幅', value: changePercent.toFixed(2) + '%', threshold: smartThreshold.toFixed(2) + '%' });
    }

    // 条件2：成交量倍数
    const avgVol = await getAvgVolume(code);
    const currentVol = parseFloat(stockData.volume || 0);
    if (avgVol > 0 && currentVol / avgVol >= (_alertConditions.volumeRatio || 2)) {
      results.push({ type: '成交量异动', value: (currentVol / avgVol).toFixed(1) + '倍', threshold: _alertConditions.volumeRatio + '倍' });
    }

    // 条件3：振幅
    const high = parseFloat(stockData.high || 0);
    const low = parseFloat(stockData.low || 0);
    const preClose = parseFloat(stockData.preClose || stockData.yesterdayClose || 0);
    if (preClose > 0) {
      const amplitude = ((high - low) / preClose * 100);
      if (amplitude >= (_alertConditions.amplitude || 8)) {
        results.push({ type: '振幅', value: amplitude.toFixed(2) + '%', threshold: _alertConditions.amplitude + '%' });
      }
    }

    // 触发判断
    const triggered = _alertConditions.triggerMode === 'all'
      ? results.length === 3
      : results.length > 0;

    if (triggered) {
      _alertLastTrigger[code] = now;
      showMultiConditionPopup(name, code, results);
    }
  }

  // 多条件提醒弹窗
  function showMultiConditionPopup(name, code, results) {
    // 移除已有弹窗
    const existing = document.querySelector('.multi-condition-popup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.className = 'multi-condition-popup';

    let resultsHTML = results.map(r => `
      <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:13px;color:var(--text);">${r.type}</span>
        <span style="font-size:13px;color:#ff6b35;font-weight:bold;">${r.value} (阈值: ${r.threshold})</span>
      </div>
    `).join('');

    popup.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h3 style="margin:0;font-size:15px;color:var(--text);">⚡ 多条件异动 - ${name}</h3>
        <button class="dialog-close-btn" onclick="this.closest('.multi-condition-popup').remove()" title="关闭">
          <svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:#e53935;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">代码: ${code} | 时间: ${new Date().toLocaleTimeString()}</div>
      ${resultsHTML}
      <div style="margin-top:12px;text-align:right;">
        <button onclick="this.closest('.multi-condition-popup').remove()" style="font-size:13px;padding:4px 16px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);cursor:pointer;">确认</button>
      </div>
    `;

    document.body.appendChild(popup);

    // 10秒后自动消失（如果用户没交互）
    setTimeout(() => {
      if (popup.parentNode) popup.remove();
    }, 10000);
  }

  // 盘口异动监控
  async function checkOrderbookAlert(code, name) {
    try {
      if (!window.pywebview || !window.pywebview.api) return;
      const result = await window.pywebview.api.get_stock_orderbook(code);
      const data = JSON.parse(result);
      if (data.status !== 'ok') return;

      const alerts = [];
      const totalVolume = data.total_volume || 0;

      // 大单压单：卖一量 > 总量0.1%
      if (data.asks[0] && data.asks[0].volume > 0 && totalVolume > 0) {
        const askRatio = data.asks[0].volume / totalVolume * 100;
        if (askRatio > 0.1) {
          alerts.push({ type: '大单压单', desc: `卖一量 ${(data.asks[0].volume/10000).toFixed(1)}万手 (${askRatio.toFixed(2)}%)` });
        }
      }

      // 大单托单：买一量 > 总量0.1%
      if (data.bids[0] && data.bids[0].volume > 0 && totalVolume > 0) {
        const bidRatio = data.bids[0].volume / totalVolume * 100;
        if (bidRatio > 0.1) {
          alerts.push({ type: '大单托单', desc: `买一量 ${(data.bids[0].volume/10000).toFixed(1)}万手 (${bidRatio.toFixed(2)}%)` });
        }
      }

      // 封涨停：涨幅接近涨停且买一量极大
      if (data.pre_close > 0) {
        const limitUpPrice = data.pre_close * 1.1;
        if (data.price >= limitUpPrice * 0.998 && data.bids[0] && data.bids[0].volume > totalVolume * 0.05) {
          alerts.push({ type: '封涨停', desc: `买一封单 ${(data.bids[0].volume/10000).toFixed(1)}万手` });
        }
        // 封跌停
        const limitDownPrice = data.pre_close * 0.9;
        if (data.price <= limitDownPrice * 1.002 && data.asks[0] && data.asks[0].volume > totalVolume * 0.05) {
          alerts.push({ type: '封跌停', desc: `卖一封单 ${(data.asks[0].volume/10000).toFixed(1)}万手` });
        }
      }

      if (alerts.length > 0) {
        showOrderbookAlert(name, code, alerts, data);
      }
    } catch (e) {
      console.error('盘口异动检查失败:', e);
    }
  }

  // 盘口异动弹窗
  function showOrderbookAlert(name, code, alerts, stockData) {
    const existing = document.querySelector('.orderbook-alert');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.className = 'orderbook-alert';

    let alertsHTML = alerts.map(a => `
      <div style="padding:6px 0;border-bottom:1px solid rgba(255,107,53,0.2);">
        <span style="font-size:14px;font-weight:bold;color:#ff6b35;">${a.type}</span>
        <span style="font-size:12px;color:var(--text-secondary);margin-left:8px;">${a.desc}</span>
      </div>
    `).join('');

    popup.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h3 style="margin:0;font-size:15px;color:#ff6b35;">⚡ 盘口异动 - ${name}</h3>
        <button class="dialog-close-btn" onclick="this.closest('.orderbook-alert').remove()" title="关闭">
          <svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:#e53935;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">
        代码: ${code} | 现价: ${stockData.price.toFixed(2)} | 时间: ${new Date().toLocaleTimeString()}
      </div>
      ${alertsHTML}
      <div style="margin-top:12px;text-align:right;">
        <button onclick="this.closest('.orderbook-alert').remove()" style="font-size:13px;padding:4px 16px;border:1px solid #ff6b35;border-radius:4px;background:#ff6b35;color:#fff;cursor:pointer;">确认</button>
      </div>
    `;

    document.body.appendChild(popup);
    setTimeout(() => {
      if (popup.parentNode) popup.remove();
    }, 10000);
  }

  // ===== 加载更多 =====
  async function loadMore() {
    $loading.classList.add('show');

    try {
      const beforeTime = Math.floor(Date.now() / 1000) - 3600;
      const result = await pywebview.api.load_more(beforeTime);
      const data = unwrapResult(result);

      if (data.status === 'ok' && Array.isArray(data.data) && data.data.length > 0) {
        data.data.forEach(item => {
          if (!seenAids.has(item.aid)) {
            seenAids.add(item.aid);
            newAidBuffer.push(item.aid);
            appendNewsItem(item);
          }
        });
        updateCount();
      }
    } catch (err) {
      console.error('加载更多失败:', err);
    }

    $loading.classList.remove('show');
  }

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

  // ===== 关键词高亮 =====

  function addKeyword() {
    const val = $keywordInput.value.trim();
    if (!val) return;
    if (settings.keywords.includes(val)) {
      $keywordInput.value = '';
      return;
    }
    settings.keywords.push(val);
    saveSettings();
    $keywordInput.value = '';
    renderKeywordTags();
    if (settings.keywordHighlight) {
      applyHighlightAll();
    }
  }

  function removeKeyword(kw) {
    settings.keywords = settings.keywords.filter(k => k !== kw);
    saveSettings();
    renderKeywordTags();
    // 重新应用高亮（去掉已删除的关键词）
    removeHighlightAll();
    if (settings.keywordHighlight && settings.keywords.length > 0) {
      applyHighlightAll();
    }
  }

  function renderKeywordTags() {
    $keywordTags.innerHTML = '';
    settings.keywords.forEach(kw => {
      const tag = document.createElement('span');
      tag.className = 'keyword-tag';
      tag.innerHTML = `<span class="kw-text">${esc(kw)}</span><span class="kw-remove" data-kw="${esc(kw)}">×</span>`;
      tag.querySelector('.kw-remove').addEventListener('click', () => removeKeyword(kw));
      $keywordTags.appendChild(tag);
    });
  }

  /**
   * 对一个 DOM 元素内的文本节点做关键词高亮
   * 用 TreeWalker 遍历所有文本节点，把匹配的部分用 <span class="kw-hl"> 包裹
   */
  function highlightElement(el) {
    if (!settings.keywordHighlight || settings.keywords.length === 0) return;
    // 构建正则：把所有关键词用 | 连接，加 g 标志
    const escaped = settings.keywords.map(kw => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(escaped.join('|'), 'g');
    if (!regex.source) return;

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach(node => {
      const text = node.textContent;
      if (!regex.test(text)) return;
      regex.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      let match;
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIdx) {
          frag.appendChild(document.createTextNode(text.substring(lastIdx, match.index)));
        }
        const span = document.createElement('span');
        span.className = 'kw-hl';
        span.textContent = match[0];
        frag.appendChild(span);
        lastIdx = regex.lastIndex;
      }
      if (lastIdx < text.length) {
        frag.appendChild(document.createTextNode(text.substring(lastIdx)));
      }
      node.parentNode.replaceChild(frag, node);
    });
  }

  /**
   * 对页面上所有已有新闻卡片应用高亮
   */
  function applyHighlightAll() {
    if (!settings.keywordHighlight || settings.keywords.length === 0) return;
    $newsList.querySelectorAll('.news-item').forEach(item => {
      highlightElement(item);
    });
  }

  /**
   * 移除所有高亮标记（把 .kw-hl 还原为纯文本）
   */
  function removeHighlightAll() {
    $newsList.querySelectorAll('.kw-hl').forEach(span => {
      const text = document.createTextNode(span.textContent);
      span.parentNode.replaceChild(text, span);
    });
    // 合并相邻文本节点
    $newsList.normalize();
  }

  // ===== 关键词触发警报 =====
  let lastAlertTime = 0;
  const ALERT_COOLDOWN = 3000; // 3秒冷却，防止连续轰炸

  /**
   * 检测标题/内容是否命中警报关键词，命中则播放警报音+弹窗通知
   */
  function checkKeywordAlert(title, content) {
    if (!settings.keywordAlert) return;
    const alertKws = settings.keywordAlertKeywords && settings.keywordAlertKeywords.length > 0
      ? settings.keywordAlertKeywords
      : settings.keywords; // 如果没单独设置，用高亮关键词
    if (!alertKws || alertKws.length === 0) return;

    const text = (title || '') + ' ' + (content || '');
    for (const kw of alertKws) {
      if (text.includes(kw)) {
        triggerAlert(title, kw);
        return;
      }
    }
  }

  function triggerAlert(title, keyword) {
    const now = Date.now();
    if (now - lastAlertTime < ALERT_COOLDOWN) return;
    lastAlertTime = now;

    // 播放警报音（用 AudioContext 合成，无需外部文件）
    playAlertSound();

    // 弹窗通知
    showKeywordNotification(title, keyword);
  }

  // AudioContext 单例：浏览器对同一页面的 AudioContext 数量有限（通常 6 个左右），
  // 每次播放都 new 一个且不 close 会让长时间运行的客户端耗尽配额，最终无声。
  // 用懒加载单例复用同一个 ctx，必要时 resume（Chrome 自动暂停策略）。
  let _alertAudioCtx = null;
  function _getAlertAudioCtx() {
    if (!_alertAudioCtx || _alertAudioCtx.state === 'closed') {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      _alertAudioCtx = new Ctor();
    }
    // Chrome / Edge 在后台标签或长时间未交互后会自动 suspend，播放前尝试 resume
    if (_alertAudioCtx.state === 'suspended') {
      _alertAudioCtx.resume().catch(() => {});
    }
    return _alertAudioCtx;
  }

  function playAlertSound() {
    try {
      const ctx = _getAlertAudioCtx();
      if (!ctx) return;
      // 两声短促的蜂鸣
      [0, 0.15].forEach(offset => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.3, ctx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + offset + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.15);
      });
    } catch (e) {
      if (DEBUG_MODE) console.warn('播放提醒音失败:', e);
    }
  }

  function showKeywordNotification(title, keyword) {
    // 创建浮层通知
    const notif = document.createElement('div');
    notif.className = 'kw-alert-notification';
    notif.innerHTML = `
      <div class="kw-alert-header">
        <span class="kw-alert-icon">🔔</span>
        <span class="kw-alert-title">关键词命中：${esc(keyword)}</span>
        <span class="kw-alert-close">&times;</span>
      </div>
      <div class="kw-alert-body">${esc(title || '')}</div>
    `;
    document.body.appendChild(notif);

    notif.querySelector('.kw-alert-close').addEventListener('click', () => {
      notif.classList.add('kw-alert-dismiss');
      setTimeout(() => notif.remove(), 300);
    });

    // 5秒后自动消失
    setTimeout(() => {
      if (notif.parentNode) {
        notif.classList.add('kw-alert-dismiss');
        setTimeout(() => notif.remove(), 300);
      }
    }, 5000);
  }

  // ===== 新闻分类 =====
  function classifyItem(item) {
    if (!window.newsClassifier) return;
    try {
      const cls = window.newsClassifier.classifyNews(item.title || '', item.content || '');
      item.classification = cls;
      item.category = cls.categories.length > 0 ? cls.categories[0].name : '';
      item.priority = cls.priority;
    } catch (e) {
      // ignore
    }
  }

  // ===== 历史存储（批量优化） =====
  let historyBuffer = [];  // 消息缓冲
  let historyFlushTimer = null;  // 刷新定时器
  const BATCH_SIZE = 10;  // 批量大小
  const FLUSH_INTERVAL = 2000;  // 刷新间隔(ms)

  function flushHistoryBuffer() {
    if (!window.historyStorage || historyBuffer.length === 0) return;
    const items = historyBuffer.splice(0, historyBuffer.length);
    window.historyStorage.storeMessagesBatch(items).catch(() => {});
  }

  function scheduleFlush() {
    if (historyFlushTimer) return;
    historyFlushTimer = setTimeout(() => {
      historyFlushTimer = null;
      flushHistoryBuffer();
    }, FLUSH_INTERVAL);
  }

  function storeToHistory(item) {
    if (!window.historyStorage) return;
    try {
      historyBuffer.push(item);
      // 达到批量大小则立即刷新
      if (historyBuffer.length >= BATCH_SIZE) {
        if (historyFlushTimer) {
          clearTimeout(historyFlushTimer);
          historyFlushTimer = null;
        }
        flushHistoryBuffer();
      } else {
        scheduleFlush();
      }
    } catch (e) {
      // ignore
    }
  }

  async function cleanupOldHistory() {
    if (!window.historyStorage) return;
    try {
      const cutoffTime = Date.now() - MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000;
      const deletedCount = await window.historyStorage.deleteOldMessages(cutoffTime);
      if (DEBUG_MODE && deletedCount > 0) {
        console.log(`清理过期消息: 删除 ${deletedCount} 条`);
      }
    } catch (e) {
      if (DEBUG_MODE) console.warn('清理历史消息失败:', e);
    }
  }

  function scheduleCleanup() {
    // 延迟 5 分钟首次启动清理，避开启动高峰；之后每 24 小时一次
    setTimeout(() => {
      cleanupOldHistory();
      setInterval(cleanupOldHistory, 24 * 60 * 60 * 1000);
    }, 5 * 60 * 1000);
  }

  // ===== 新闻详情弹窗 =====
  async function showNewsDetail(item) {
    // 加载状态
    const overlay = document.createElement('div');
    overlay.className = 'news-detail-overlay';
    overlay.innerHTML = `
      <div class="news-detail-panel">
        <div class="news-detail-header">
          <span class="detail-source">${esc(item.comefrom || '详情')}</span>
          <button class="news-detail-close">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="#e53935">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
        <div class="news-detail-body">
          <div class="detail-title">${esc(item.title || '')}</div>
          <div class="detail-time">${esc(item.ptime || '')}  ${esc(item.comefrom || '')}</div>
          <div class="detail-content" style="color:#999;">加载详情中...</div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    overlay.querySelector('.news-detail-close').addEventListener('click', () => overlay.remove());
    const escHandler = (e) => {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    // 请求后端获取详情正文
    try {
      if (DEBUG_MODE) console.log('[详情] 请求详情, item keys:', Object.keys(item), 'art_code:', item.art_code, 'info_code:', item.info_code);
      let detailContent = '';
      if (item.art_code && apiHas('get_announcement_detail')) {
        if (DEBUG_MODE) console.log('[详情] 调用 get_announcement_detail, art_code:', item.art_code);
        const resp = await pywebview.api.get_announcement_detail(item.art_code);
        if (DEBUG_MODE) console.log('[详情] 公告详情返回:', resp);
        const data = unwrapResult(resp);
        if (data && data.status === 'ok' && data.content) {
          detailContent = data.content;
        }
      } else if (item.info_code && apiHas('get_research_detail')) {
        if (DEBUG_MODE) console.log('[详情] 调用 get_research_detail, info_code:', item.info_code);
        const resp = await pywebview.api.get_research_detail(item.info_code);
        if (DEBUG_MODE) console.log('[详情] 研报详情返回:', resp);
        const data = unwrapResult(resp);
        if (data && data.status === 'ok' && data.content) {
          detailContent = data.content;
        }
      } else {
        if (DEBUG_MODE) console.log('[详情] 没有 art_code 或 info_code，无法请求详情');
      }

      const contentEl = overlay.querySelector('.detail-content');
      if (contentEl) {
        if (detailContent) {
          contentEl.style.color = '';
          contentEl.textContent = detailContent;
        } else {
          contentEl.textContent = item.content || '暂无详细内容';
          contentEl.style.color = '#666';
        }
      }
    } catch (err) {
      const contentEl = overlay.querySelector('.detail-content');
      if (contentEl) {
        contentEl.textContent = '加载详情失败: ' + err.message;
        contentEl.style.color = '#f44336';
      }
    }
  }

  // ===== 工具函数 =====
  // toast 类型样式（success/error/warning/info）
  const TOAST_TYPES = {
    success: { bg: 'rgba(46, 125, 50, 0.92)', icon: '✓' },
    error:   { bg: 'rgba(211, 47, 47, 0.92)',  icon: '✗' },
    warning: { bg: 'rgba(237, 144, 33, 0.92)', icon: '!' },
    info:    { bg: 'rgba(0, 0, 0, 0.78)',       icon: '' }
  };

  /**
   * 显示 toast 提示（支持可选的动作按钮和类型）
   * @param {string} message - 提示文本
   * @param {object} [opts] - 选项
   *   - type: 'success' | 'error' | 'warning' | 'info'（默认 info）
   *   - duration: 显示毫秒数（默认 2500，有 action 时自动延长到 6000）
   *   - action: { label, callback } 可选动作按钮（如"去配置"）
   */
  function showToast(message, opts) {
    opts = opts || {};
    const type = opts.type && TOAST_TYPES[opts.type] ? opts.type : 'info';
    const typeInfo = TOAST_TYPES[type];
    const hasAction = opts.action && typeof opts.action.callback === 'function';
    const duration = opts.duration || (hasAction ? 6000 : 2500);

    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.style.background = typeInfo.bg;

    // 内容区
    const textSpan = document.createElement('span');
    textSpan.textContent = (typeInfo.icon ? typeInfo.icon + ' ' : '') + message;
    toast.appendChild(textSpan);

    // 动作按钮
    if (hasAction) {
      const actionBtn = document.createElement('button');
      actionBtn.className = 'toast-action-btn';
      actionBtn.textContent = opts.action.label;
      actionBtn.addEventListener('click', () => {
        try { opts.action.callback(); } catch (e) { console.warn('toast action error:', e); }
        dismiss();
      });
      toast.appendChild(actionBtn);
    }

    document.body.appendChild(toast);

    let dismissTimer = null;
    function dismiss() {
      if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
      if (!toast.parentNode) return;
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }
    dismissTimer = setTimeout(dismiss, duration);
  }


  function setStatus(state, text) {
    $statusDot.className = 'status-dot ' + state;
    $statusText.textContent = text;
  }

  function updateCount() {
    let text = `${newsCount} 条消息`;
    if (hiddenCount > 0) {
      text += ` · 已隐藏 ${hiddenCount} 条相似`;
    }
    $newsCount.textContent = text;
    const d = new Date();
    $lastUpdate.textContent = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;

    // 虚拟滚动：超出上限时移除最旧的 DOM 节点
    trimOldDomItems();

    // 定期持久化已读 aid（每 50 条批量写一次）
    if (newAidBuffer.length >= 50) {
      flushAidBuffer();
    }
  }

  function trimOldDomItems() {
    const children = $newsList.children;
    if (children.length <= MAX_DOM_ITEMS) return;
    const toRemove = children.length - MAX_DOM_ITEMS;
    // 移除最旧的（列表末尾的）
    for (let i = 0; i < toRemove; i++) {
      const el = children[children.length - 1];
      if (el) $newsList.removeChild(el);
    }
    // 从 recentItems 中也清理
    if (recentItems.length > MAX_RECENT) {
      recentItems.splice(0, recentItems.length - MAX_RECENT);
    }
  }

  function flushAidBuffer() {
    if (newAidBuffer.length === 0) return;
    const batch = newAidBuffer.splice(0, newAidBuffer.length);
    pywebview.api.persist_seen_aids(JSON.stringify(batch)).catch(() => {});
  }

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

  async function waitForApi(retries) {
    if (typeof pywebview !== 'undefined' && pywebview.api && typeof pywebview.api.fetch_initial === 'function') {
      // 优先从后端读取设置（打包后 localStorage 不稳定）
      try {
        if (apiHas('get_settings')) {
          const backendSettings = await pywebview.api.get_settings();
          if (backendSettings) {
            const parsed = unwrapResult(backendSettings);
            if (Object.keys(parsed).length > 0) {
              localStorage.setItem('ztfi-settings', JSON.stringify(parsed));
              settings = loadSettings();
              // settings 被重新赋值成新对象后，同步 window._settings 引用，
              // 避免主题系统/暗色开关读到已失效的旧 settings 对象。
              window._settings = settings;
            }
          }
        }
      } catch (e) {}

      if (settings.privacyAccepted && settings.privacyAcceptedVersion === getCurrentVersion()) {
        init();
      } else {
        showPrivacyDialog();
      }
    } else if (retries > 0) {
      setTimeout(() => waitForApi(retries - 1), 300);
    } else {
      setStatus('error', '后端 API 未就绪');
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const report = getStatsReport();
      console.log('[统计报告]', JSON.stringify(report, null, 2));
      showToast('统计报告已输出到控制台，按 F12 查看', { type: 'info', duration: 4000 });
    }
  });

  // ===== frameless 窗口边缘拖拽缩放 =====
  // pywebview 官方限制：frameless 窗口不支持鼠标 resize（resizable=True 无效）。
  // 方案：JS 检测窗口边缘热区（8px），按住拖动时实时调用后端 resize_window(w,h) 缩放。
  function initFramelessResize() {
    if (!window.pywebview || !window.pywebview.api || !window.pywebview.api.resize_window) return;
    const EDGE = 8;               // 边缘热区宽度
    const MIN_W = 320, MIN_H = 400; // 与 app.py min_size 一致
    let resizing = null;          // { edge: 'e'|'s'|'se', startX, startY, startW, startH }
    let hoverEdge = null;

    const api = window.pywebview.api;

    function getEdge(e) {
      const w = window.innerWidth, h = window.innerHeight;
      const x = e.clientX, y = e.clientY;
      const right = w - x <= EDGE;
      const left = x <= EDGE;
      const bottom = h - y <= EDGE;
      // 顶部边缘排除标题栏区域（标题栏是拖拽区，不是 resize 热区，避免冲突）
      const titlebarH = 32;
      const top = y <= EDGE && y > titlebarH;
      if (right && bottom) return 'se';
      if (left && bottom) return 'sw';
      if (right && top) return 'ne';
      if (left && top) return 'nw';
      if (right) return 'e';
      if (left) return 'w';
      if (bottom) return 's';
      if (top) return 'n';
      return null;
    }

    function cursorFor(edge) {
      if (edge === 'e' || edge === 'w') return 'ew-resize';
      if (edge === 'n' || edge === 's') return 'ns-resize';
      if (edge === 'se' || edge === 'nw') return 'nwse-resize';
      if (edge === 'sw' || edge === 'ne') return 'nesw-resize';
      return '';
    }

    document.addEventListener('mousemove', (e) => {
      if (resizing) {
        // 实时缩放
        let nw = resizing.startW, nh = resizing.startH;
        const dx = e.clientX - resizing.startX;
        const dy = e.clientY - resizing.startY;
        if (resizing.edge.includes('e')) nw = resizing.startW + dx;
        if (resizing.edge.includes('s')) nh = resizing.startH + dy;
        if (resizing.edge.includes('w')) nw = resizing.startW - dx;
        if (resizing.edge.includes('n')) nh = resizing.startH - dy;
        nw = Math.max(MIN_W, Math.round(nw));
        nh = Math.max(MIN_H, Math.round(nh));
        api.resize_window(nw, nh).catch(() => {});
        return;
      }
      const edge = getEdge(e);
      if (edge !== hoverEdge) {
        hoverEdge = edge;
        document.body.style.cursor = cursorFor(edge) || '';
      }
    });

    document.addEventListener('mousedown', (e) => {
      const edge = getEdge(e);
      if (!edge) return;
      // 边缘按下：进入缩放模式，阻止默认行为（避免选中文本等）
      e.preventDefault();
      resizing = {
        edge,
        startX: e.clientX,
        startY: e.clientY,
        startW: window.innerWidth,
        startH: window.innerHeight
      };
    });

    document.addEventListener('mouseup', () => {
      if (resizing) {
        resizing = null;
        document.body.style.cursor = '';
      }
    });

    // 离开窗口时复位
    document.addEventListener('mouseleave', () => {
      hoverEdge = null;
      if (!resizing) document.body.style.cursor = '';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      try { initThemeUI(); } catch (e) { console.warn('[theme]', e); }
      waitForApi(30);
    });
  } else {
    try { initThemeUI(); } catch (e) { console.warn('[theme]', e); }
    waitForApi(30);
  }

  // frameless 边缘缩放依赖 pywebview js_api（resize_window），
  // 必须等 pywebviewready 注入完成后绑定；在此独立监听，不依赖 init() 是否执行。
  if (apiHas('resize_window')) {
    try { initFramelessResize(); } catch (e) { console.warn('[resize]', e); }
  } else {
    window.addEventListener('pywebviewready', () => {
      try { initFramelessResize(); } catch (e) { console.warn('[resize]', e); }
    });
  }

  // 初始化主题设置面板 UI（attachUI 绑定卡片点击 + 恢复上次主题）
  // 兼容两种暴露方式：window.ThemeSystem（显式挂载）或同 realm 词法绑定 ThemeSystem。
  function initThemeUI() {
    const ts = (typeof window !== 'undefined' && window.ThemeSystem) ||
               (typeof ThemeSystem !== 'undefined' ? ThemeSystem : null);
    if (ts && typeof ts.attachUI === 'function') {
      ts.attachUI();
    } else {
      console.warn('[theme] ThemeSystem 未就绪，跳过初始化');
    }
  }

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
        showUrgentOverlay(data);
      } else {
        showUpdateDialog(data);
      }
    } catch (e) {
      console.error('解析更新数据失败:', e);
    }
  };



  function showUpdateDialog(data) {
    document.getElementById('updateLatestVersion').textContent = data.latest_version || '';
    document.getElementById('updateReleaseDate').textContent = data.release_date ? '发布日期: ' + data.release_date : '';
    
    const changelogUl = document.getElementById('updateChangelog');
    changelogUl.innerHTML = '';
    if (data.changelog && Array.isArray(data.changelog)) {
      data.changelog.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item;
        changelogUl.appendChild(li);
      });
    }
    
    document.getElementById('updateProgress').style.display = 'none';
    $updateDialog.style.display = 'flex';
  }

  function showUrgentOverlay(data) {
    document.getElementById('urgentMessage').textContent = data.urgent_message || '请立即更新到最新版本以获取安全修复';
    $urgentOverlay.style.display = 'flex';
  }

  async function performUpdateCheck() {
    if (!$btnCheckUpdate) return;
    const originalText = $btnCheckUpdate.textContent;
    $btnCheckUpdate.textContent = '检查中...';
    $btnCheckUpdate.disabled = true;

    try {
      if (apiHas('check_update')) {
        const result = await pywebview.api.check_update();
        const data = JSON.parse(result);

        if (data.status === 'update_available') {
          if (data.urgent) {
            showUrgentOverlay(data);
          } else {
            showUpdateDialog(data);
          }
        } else if (data.status === 'latest') {
          showToast('✅ 当前版本已是最新版本（' + (data.current_version || '') + '）', { type: 'success' });
        } else {
          // 错误提示更明确
          const msg = data.message || '未知错误';
          if (msg.includes('网络连接') || msg.includes('无法连接') || msg.includes('timeout')) {
            showToast('检查更新失败：无法连接 GitHub，请检查网络/代理', { type: 'error', duration: 6000 });
            console.log('[更新检查失败详情]', msg);
          } else {
            showToast('检查更新失败：' + msg, { type: 'error' });
          }
        }
      } else {
        showToast('更新检查功能不可用', { type: 'warning' });
      }
    } catch (e) {
      showToast('检查更新异常: ' + e.message, { type: 'error' });
    } finally {
      $btnCheckUpdate.textContent = originalText;
      $btnCheckUpdate.disabled = false;
    }
  }

  async function downloadAndUpdate() {
    document.getElementById('updateProgress').style.display = 'block';
    document.getElementById('updateProgressFill').style.width = '0%';
    document.getElementById('updateProgressText').textContent = '0%';
    $btnUpdateNow.disabled = true;
    $btnUpdateLater.disabled = true;

    try {
      if (apiHas('download_update')) {
        const result = await pywebview.api.download_update();
        const data = JSON.parse(result);
        if (data.status === 'ok') {
          showToast(data.message, { type: 'success', duration: 5000 });
        } else {
          showToast('下载失败：' + (data.message || '未知错误'), { type: 'error' });
        }
      } else {
        showToast('更新下载 API 不可用', { type: 'error' });
      }
    } catch (e) {
      showToast('下载更新失败：' + e.message, { type: 'error' });
    } finally {
      $btnUpdateNow.disabled = false;
      $btnUpdateLater.disabled = false;
    }
  }

  function updateDownloadProgress(percent) {
    document.getElementById('updateProgressFill').style.width = percent + '%';
    document.getElementById('updateProgressText').textContent = percent + '%';
  }

  if ($btnCheckUpdate) {
    $btnCheckUpdate.addEventListener('click', performUpdateCheck);
  }

  if ($btnUpdateLater) {
    $btnUpdateLater.addEventListener('click', () => {
      $updateDialog.style.display = 'none';
    });
  }

  if ($btnUpdateNow) {
    $btnUpdateNow.addEventListener('click', downloadAndUpdate);
  }

  if ($btnUrgentUpdate) {
    $btnUrgentUpdate.addEventListener('click', () => {
      $urgentOverlay.style.display = 'none';
      downloadAndUpdate();
    });
  }

  if ($btnUrgentExit) {
    $btnUrgentExit.addEventListener('click', () => {
      if (apiHas('exit_app')) {
        pywebview.api.exit_app();
      } else {
        window.close();
      }
    });
  }

  if ($updateDialog) {
    $updateDialog.querySelector('.dialog-close-btn').addEventListener('click', () => {
      $updateDialog.style.display = 'none';
    });
  }

})();
