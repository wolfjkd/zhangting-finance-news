/**
 * 涨停财经聚合播报 - 桌面端渲染进程
 * 
 * 架构：Python 后端抓取 + WebSocket 代理 → 前端渲染
 * 通过 pywebview.api 调用 Python 后端
 */

(function () {
  'use strict';

  // ===== 调试开关 =====
  const DEBUG_MODE = true; // 生产环境设为 false

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
  let windowResizeTimer = null; // 窗口大小保存防抖定时器

  // ===== 设置 =====
  const ALL_SOURCES = [
    '涨停聚合（Beta）', '传统聚合', '外网资讯', '东方财富公告', '龙虎榜', '券商研报', '公告解读', '北向资金'
  ];

  let settings = loadSettings();
  // 暴露到全局，同步 darkMode 状态
  window._settings = settings;
  // 立即保存设置到文件（确保 Python 端能读取主题配置）
  try { saveSettings(); } catch(e) {}
  let synth = window.speechSynthesis;
  let voiceList = [];
  let speaking = false;
  let voiceQueue = [];
  const VOICE_TIME_THRESHOLD = 180;
  const VOICE_INTERRUPT_MODE_COMPLETE = 'complete';
  const VOICE_INTERRUPT_MODE_IMMEDIATE = 'immediate';

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

  // ===== DOM =====
  const $container = document.getElementById('newsContainer');
  const $newsList = document.getElementById('newsList');
  const $statusDot = document.getElementById('statusDot');
  const $statusText = document.getElementById('statusText');
  const $newsCount = document.getElementById('newsCount');
  const $lastUpdate = document.getElementById('lastUpdate');
  const $loading = document.getElementById('loadingIndicator');
  const $btnAutoscroll = document.getElementById('btnAutoscroll');
  const $btnPin = document.getElementById('btnPin');
  const $btnLoadMore = document.getElementById('btnLoadMore');
  const $btnSettings = document.getElementById('btnSettings');
  const $btnSearch = document.getElementById('btnSearch');
  const $btnFavorites = document.getElementById('btnFavorites');
  const $favoritesBadge = document.getElementById('favoritesBadge');
  const $btnReview = null; // 已移除
  const $btnWatchlist = document.getElementById('btnWatchlist');
  const $watchlistBadge = document.getElementById('watchlistBadge');
  const $searchDialog = document.getElementById('searchDialog');
  const $searchInput = document.getElementById('searchInput');
  const $searchBtn = document.getElementById('searchBtn');
  const $searchCategory = document.getElementById('searchCategory');
  const $searchPriority = document.getElementById('searchPriority');
  const $searchResults = document.getElementById('searchResults');
  const $favoritesDialog = document.getElementById('favoritesDialog');
  const $favoritesList = document.getElementById('favoritesList');
  const $btnThemeToggle = document.getElementById('btnThemeToggle');
  const $settingsOverlay = document.getElementById('settingsOverlay');
  const $settingsClose = document.getElementById('settingsClose');
  const $sourceList = document.getElementById('sourceList');
  const $voiceEnabled = document.getElementById('voiceEnabled');
  const $voiceSettings = document.getElementById('voiceSettings');
  const $voiceSelect = document.getElementById('voiceSelect');
  const $voiceTest = document.getElementById('voiceTest');
  const $voiceRate = document.getElementById('voiceRate');
  const $voiceSpeedRow = document.getElementById('voiceSpeedRow');
  const $voiceInterruptMode = document.getElementById('voiceInterruptMode');
  const $voiceInterruptModeRow = document.getElementById('voiceInterruptModeRow');
  const $aiEnabled = document.getElementById('aiEnabled');
  const $aiApiKey = document.getElementById('aiApiKey');
  const $aiApiUrl = document.getElementById('aiApiUrl');
  const $aiModelName = document.getElementById('aiModelName');
  const $aiApiKeyRow = document.getElementById('aiApiKeyRow');
  const $aiApiUrlRow = document.getElementById('aiApiUrlRow');
  const $aiModelNameRow = document.getElementById('aiModelNameRow');
  const $aiTestRow = document.getElementById('aiTestRow');
  const $aiConfigHint = document.getElementById('aiConfigHint');
  const $btnAiTest = document.getElementById('btnAiTest');
  const $showStocks = document.getElementById('showStocks');
  const $showRelated = document.getElementById('showRelated');
  const $hideDuplicates = document.getElementById('hideDuplicates');
  const $keywordHighlight = document.getElementById('keywordHighlight');
  const $keywordInputRow = document.getElementById('keywordInputRow');
  const $keywordInput = document.getElementById('keywordInput');
  const $keywordAddBtn = document.getElementById('keywordAddBtn');
  const $keywordTags = document.getElementById('keywordTags');
  const $keywordAlert = document.getElementById('keywordAlert');
  const $fontSize = document.getElementById('fontSize');

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
    async analyze(title, content) {
      if (!settings.aiEnabled || !settings.aiApiKey) {
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

    // 执行分析
    const result = await window.aiAnalyzer.analyze(item.title, item.content);

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
      if (window.pywebview && window.pywebview.api && window.pywebview.api.get_settings) {
        const backendSettings = await pywebview.api.get_settings();
        console.log('[DEBUG] backendSettings:', backendSettings ? backendSettings.substring(0, 200) : 'null');
        if (backendSettings) {
          const parsed = typeof backendSettings === 'string' ? JSON.parse(backendSettings) : backendSettings;
          console.log('[DEBUG] parsed settings sources:', parsed.sources);
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
      const aids = typeof persisted === 'string' ? JSON.parse(persisted) : persisted;
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
      console.log('[DEBUG] fetch_initial result:', result ? result.substring(0, 200) : 'null');
      const resp = typeof result === 'string' ? JSON.parse(result) : result;
      console.log('[DEBUG] fetch_initial parsed:', JSON.stringify(resp.status));

      if (resp.status !== 'ok') {
        setStatus('error', '获取失败: ' + (resp.message || '未知错误'));
        $loading.classList.remove('show');
        setTimeout(init, 30000);
        return;
      }

      // 解析初始 HTML
      console.log('[DEBUG] Calling parseAndRenderHTML...');
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
        _ttsEngine = e.target.value;
        localStorage.setItem('tts_engine', _ttsEngine);
        // 根据引擎切换显示对应音色行
        if ($voiceSettings) $voiceSettings.style.display = (settings.voiceEnabled && _ttsEngine === 'web') ? 'flex' : 'none';
        if (ttsVoiceRow) ttsVoiceRow.style.display = (settings.voiceEnabled && _ttsEngine === 'edge') ? 'flex' : 'none';
        // 切换到 Edge 时检测可用性
        if (_ttsEngine === 'edge') {
          checkEdgeTTSAvailability();
        }
      });
      // 恢复保存的值
      _ttsEngine = localStorage.getItem('tts_engine') || 'web';
      ttsEngineSelect.value = _ttsEngine;
      if (ttsVoiceRow) ttsVoiceRow.style.display = (settings.voiceEnabled && _ttsEngine === 'edge') ? 'flex' : 'none';
      // 启动时检测 Edge TTS 可用性
      if (_ttsEngine === 'edge') {
        checkEdgeTTSAvailability();
      }
    }

    // 检测 Edge TTS 可用性并加载音色列表
    async function checkEdgeTTSAvailability() {
      try {
        if (!window.pywebview || !pywebview.api || !pywebview.api.tts_get_voices) return;
        const result = await pywebview.api.tts_get_voices();
        const data = JSON.parse(result);
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
        _ttsVoice = e.target.value;
        localStorage.setItem('tts_voice', _ttsVoice);
      });
      _ttsVoice = localStorage.getItem('tts_voice') || 'zh-CN-YunyangNeural';
      ttsVoiceSelect.value = _ttsVoice;
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
          if (window.pywebview && window.pywebview.api && window.pywebview.api.tts_synthesize) {
            const result = await window.pywebview.api.tts_synthesize(testText, voice, '+0%', '+0%');
            const data = JSON.parse(result);
            if (data.status === 'ok' && data.audio_data) {
              const audio = new Audio(data.audio_data);
              audio.play().catch(err => console.warn('播放失败:', err));
            } else if (data.status === 'ok' && data.audio_path) {
              const audio = new Audio('file:///' + data.audio_path.replace(/\\/g, '/'));
              audio.play().catch(err => console.warn('播放失败:', err));
            } else {
              console.warn('Edge TTS 合成失败:', data.message);
              alert('Edge TTS 合成失败：' + (data.message || '未知错误'));
            }
          }
        } catch (e) {
          console.warn('Edge TTS 试听失败:', e);
          alert('Edge TTS 试听失败：' + e.message);
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
        _ttsBlockKeywords = JSON.parse(localStorage.getItem('tts_block_keywords') || '[]');
      } catch (e) {
        _ttsBlockKeywords = [];
      }
      renderBlockKeywords();
      blockInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && blockInput.value.trim()) {
          e.preventDefault();
          _ttsBlockKeywords.push(blockInput.value.trim());
          blockInput.value = '';
          localStorage.setItem('tts_block_keywords', JSON.stringify(_ttsBlockKeywords));
          renderBlockKeywords();
        }
      });
    }

    function renderBlockKeywords() {
      if (!blockTags) return;
      blockTags.innerHTML = '';
      _ttsBlockKeywords.forEach((kw, i) => {
        const tag = document.createElement('span');
        tag.style.cssText = 'display:inline-flex;align-items:center;gap:2px;padding:2px 6px;background:var(--tag-bg);color:var(--tag-text);border-radius:3px;font-size:11px;';
        tag.textContent = kw;
        const rmBtn = document.createElement('span');
        rmBtn.textContent = '×';
        rmBtn.style.cssText = 'cursor:pointer;margin-left:2px;font-weight:bold;';
        rmBtn.onclick = () => {
          _ttsBlockKeywords.splice(i, 1);
          localStorage.setItem('tts_block_keywords', JSON.stringify(_ttsBlockKeywords));
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
      _ttsSilentEnabled = localStorage.getItem('tts_silent_enabled') === 'true';
      silentEnabled.checked = _ttsSilentEnabled;
      if (silentPeriodsRow) silentPeriodsRow.style.display = _ttsSilentEnabled ? 'flex' : 'none';
      silentEnabled.addEventListener('change', (e) => {
        _ttsSilentEnabled = e.target.checked;
        localStorage.setItem('tts_silent_enabled', _ttsSilentEnabled);
        if (silentPeriodsRow) silentPeriodsRow.style.display = _ttsSilentEnabled ? 'flex' : 'none';
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
      _ttsSilentPeriods = periods;
      localStorage.setItem('tts_silent_periods', JSON.stringify(periods));
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

  // ===== 解析初始 HTML =====
  function parseAndRenderHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const items = doc.querySelectorAll('li.recent-news-item');

    items.forEach(li => {
      try {
        const aid = li.dataset.aid || '';
        if (!aid || seenAids.has(aid)) return;
        seenAids.add(aid);
        newAidBuffer.push(aid);

        const categoryId = parseInt(li.dataset.categoryId) || 0;

        let title = '';
        const titleEl = li.querySelector('.news-title-text') ||
                        li.querySelector('.mgt-block[href]') ||
                        li.querySelector('a[href]');
        if (titleEl) title = titleEl.textContent.trim();

        const contentEl = li.querySelector('.news-content') ||
                          li.querySelector('.news-desc') ||
                          li.querySelector('p');
        const content = contentEl ? contentEl.textContent.trim() : '';

        const ptimeEl = li.querySelector('.ptime');
        const ptimeStr = ptimeEl ? (ptimeEl.getAttribute('value') || ptimeEl.textContent.trim()) : '';
        const ctime = parseInt(ptimeStr) || 0;

        const sourceEl = li.querySelector('.comefrom') || li.querySelector('.news-source');
        const comefrom = sourceEl ? sourceEl.textContent.trim() : '';

        const timeEl = li.querySelector('.news-time') || li.querySelector('.time-text');
        const ptime = timeEl ? timeEl.textContent.trim() : formatTime(ctime);

        const stocks = [];
        li.querySelectorAll('.stock-tag, [data-stock]').forEach(st => {
          const name = st.querySelector('.stock-name') ?
            st.querySelector('.stock-name').textContent.trim() :
            st.textContent.trim();
          const riseEl = st.querySelector('.stock-rise, .rise');
          const rise = riseEl ? riseEl.textContent.trim() : '';
          if (name && name.length < 20) stocks.push({ name, rise });
        });

        const child = [];
        li.querySelectorAll('.related-item, .similar-item').forEach(ri => {
          const rtitle = ri.textContent.trim();
          if (rtitle) child.push(rtitle);
        });

        if (title && title.length > 2) {
          appendNewsItem({ aid, title, content, stocks, comefrom, child, ctime, ptime, categoryId });
        }
      } catch (e) {
        // skip
      }
    });

    updateCount();
  }

  // ===== 处理实时推送 =====
  async function handleNewsItem(item) {
    if (!item || !item.aid || seenAids.has(item.aid)) return;

    // 来源过滤
    // WebSocket 传统聚合消息（无 source_id 或 source_id=ztfi）统一用"传统聚合"作为过滤来源
    // akshare_beta 消息统一用"涨停聚合（Beta）"作为过滤来源
    // foreign_news 消息统一用"外网资讯"作为过滤来源
    // 其他数据源消息用 comefrom 作为过滤来源
    let source = '';
    if (!item.source_id || item.source_id === 'ztfi') {
      source = '传统聚合';
    } else if (item.source_id === 'akshare_beta') {
      source = '涨停聚合（Beta）';
    } else if (item.source_id === 'foreign_news') {
      source = '外网资讯';
    } else {
      source = item.comefrom || '';
    }
    if (settings.sources.length > 0 && source && !settings.sources.includes(source)) {
      seenAids.add(item.aid);
      newAidBuffer.push(item.aid);
      return;
    }

    seenAids.add(item.aid);
    newAidBuffer.push(item.aid);

    recordSourceStats(item);

    // 新闻分类
    classifyItem(item);

    // === 相似消息去重 ===
    const similar = findSimilarItem(item.title);
    if (similar) {
      // 隐藏这条，追加到已有消息上
      hiddenCount++;
      appendDupBadge(similar, source);
      updateCount();
      return;
    }

    const el = renderNewsItem(item);
    
    if (item.is_x_priority || (item.comefrom && item.comefrom.includes('Twitter'))) {
      const firstNonX = $newsList.querySelector('.news-item:not(.x-priority)');
      if (firstNonX) {
        $newsList.insertBefore(el, firstNonX);
      } else {
        $newsList.prepend(el);
      }
      el.classList.add('x-priority');
    } else {
      $newsList.prepend(el);
    }
    newsCount++;

    // 存储到历史
    storeToHistory(item);

    // 记录到最近列表
    const record = { aid: item.aid, title: item.title || '', el: el, sources: [], dupCount: 1 };
    if (source) record.sources.push(source);
    recentItems.push(record);
    while (recentItems.length > MAX_RECENT) recentItems.shift();

    if (!oldestCtime || item.ctime < oldestCtime) {
      oldestCtime = item.ctime;
    }

    updateCount();

    if (autoScroll) {
      requestAnimationFrame(() => {
        $container.scrollTop = 0;
      });
    }

    // 语音播报（按来源过滤 + 关键词/自选股强制播报）
    if (settings.voiceEnabled && item.title) {
      if (shouldAnnounce(item)) {
        enqueueVoice(item.title, item.ctime);
      }
    }
  }

  // ===== 追加历史 =====
  function appendNewsItem(item) {
    // 来源过滤（初始加载不过滤，只过滤实时推送）

    // 新闻分类
    classifyItem(item);

    // === 相似消息去重（历史加载也做） ===
    const similar = findSimilarItem(item.title);
    if (similar) {
      hiddenCount++;
      appendDupBadge(similar, item.comefrom || '');
      updateCount();
      return;
    }

    const el = renderNewsItem(item);
    $newsList.appendChild(el);
    newsCount++;

    // 记录到最近列表
    const record = { aid: item.aid, title: item.title || '', el: el, sources: [], dupCount: 1 };
    const src = item.comefrom || '';
    if (src) record.sources.push(src);
    recentItems.push(record);
    while (recentItems.length > MAX_RECENT) recentItems.shift();

    if (!oldestCtime || item.ctime < oldestCtime) {
      oldestCtime = item.ctime;
    }
  }

  // ===== 渲染新闻卡片 =====
  function renderNewsItem(item) {
    const div = document.createElement('div');
    div.className = 'news-item new-item';
    div.dataset.aid = item.aid;

    if (item.categoryId === 1) {
      div.classList.add('highlight');
    }

    // 优先级样式
    if (item.classification && item.classification.priority) {
      div.classList.add('priority-' + item.classification.priority);
    }

    const timeStr = item.ptime || formatTime(item.ctime);
    const source = item.comefrom || '';

    const riseClass = (rise) => {
      if (!rise) return '';
      const val = parseFloat(rise);
      if (val > 0) return 'up';
      if (val < 0) return 'down';
      return '';
    };

    // 分类标签
    let tagsHTML = '';
    if (item.classification && window.newsClassifier) {
      tagsHTML = window.newsClassifier.getCategoryTagsHTML(item.classification) +
                 window.newsClassifier.getPriorityBadgeHTML(item.classification);
    }

    // 判断是否为可展开详情的数据源（东方财富公告/券商研报）
    const isDetailSource = source === '东方财富' || source === '券商研报';
    const titleClickable = isDetailSource ? 'clickable' : '';

    // AI区域HTML
    let aiAreaHTML = `<div class="ai-area">
      <button class="btn-ai-interpret" data-aid="${item.aid}">AI解读</button>
    </div>`;

    let html = `
      <div class="news-header">
        <span class="news-time">${esc(timeStr)}</span>
        <div class="news-header-right">
          ${aiAreaHTML}
        </div>
      </div>
      ${tagsHTML ? `<div class="news-tags">${tagsHTML}</div>` : ''}
      <div class="news-title ${titleClickable}">
        <span class="news-title-text">${esc(item.title || '')}${isDetailSource ? '<span class="news-detail-hint">▸详情</span>' : ''}</span>
        <button class="btn-favorite" data-aid="${item.aid}" title="收藏消息">
          <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        </button>
      </div>
    `;

    if (item.content) {
      html += `<div class="news-content" onclick="this.classList.toggle('expanded')">${esc(item.content)}</div>`;
    }

    if (item.images && item.images.length > 0) {
      html += '<div class="news-images">';
      item.images.forEach(imgUrl => {
        html += `<img src="${esc(imgUrl)}" class="news-image" alt="图片" />`;
      });
      html += '</div>';
    }

    if (settings.showStocks && item.stocks && item.stocks.length > 0) {
      html += '<div class="news-stocks">';
      item.stocks.forEach(s => {
        const rc = riseClass(s.rise);
        html += `<span class="stock-tag">
          <span class="stock-name">${esc(s.name)}</span>
          ${s.rise ? `<span class="stock-rise ${rc}">${esc(s.rise)}%</span>` : ''}
        </span>`;
      });
      html += '</div>';
    }

    if (settings.showRelated && item.child && item.child.length > 0) {
      html += '<div class="news-related">';
      item.child.slice(0, 3).forEach(c => {
        html += `<div class="related-item">${esc(c)}</div>`;
      });
      html += '</div>';
    }

    // 来源标签放到内容左下方
    if (source) {
      html += `<div class="news-footer"><span class="news-source">${esc(source)}</span></div>`;
    }

    div.innerHTML = html;
    setTimeout(() => div.classList.remove('new-item'), 1500);

    // 关键词高亮
    if (settings.keywordHighlight && settings.keywords.length > 0) {
      highlightElement(div);
    }

    // 关键词触发警报
    checkKeywordAlert(item.title, item.content);

    // 可点击展开详情（东方财富公告/券商研报）
    if (isDetailSource) {
      const titleEl = div.querySelector('.news-title');
      if (titleEl) {
        titleEl.addEventListener('click', () => showNewsDetail(item));
      }
    }

    // 收藏按钮事件
    const favBtn = div.querySelector('.btn-favorite');
    if (favBtn) {
      // 检查是否已收藏
      checkFavoriteStatus(item.aid, favBtn);
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(item, favBtn);
      });
    }

    // AI分析功能
    const aiBtn = div.querySelector('.btn-ai-interpret');
    if (aiBtn) {
      // 检查是否已有AI分析结果
      if (item.aiResult) {
        updateAiArea(div, item.aiResult);
      }
      aiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerAiAnalysis(item, div);
      });
    }

    // 检查是否应该自动触发AI分析
    if (window.newsClassifier && window.aiAnalyzer) {
      const text = (item.title || '') + ' ' + (item.content || '');
      if (item.classification && window.newsClassifier.shouldAutoTriggerAI(item.classification, text)) {
        // 检查是否已有分析结果
        if (!item.aiResult) {
          triggerAiAnalysis(item, div, true);
        }
      }
    }

    // 自选股匹配标记
    markWatchlistMatch(div, item);

    // 右键复制功能
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      document.querySelectorAll('.context-menu').forEach(m => m.remove());
      
      const menu = document.createElement('div');
      menu.className = 'context-menu';
      
      let left = e.clientX;
      let top = e.clientY;
      const menuWidth = 120;
      const menuHeight = 60;
      if (left + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth;
      if (top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight;
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
      
      const copyBtn = document.createElement('button');
      copyBtn.textContent = '复制内容';
      
      const removeMenu = () => {
        menu.remove();
        document.removeEventListener('click', closeMenu);
        document.removeEventListener('contextmenu', closeMenu);
      };
      
      copyBtn.onclick = () => {
        let text = '';
        if (timeStr) text += `【${timeStr}】\n`;
        if (item.title) text += `${item.title}\n`;
        if (item.content) text += `${item.content}\n`;
        if (item.stocks && item.stocks.length > 0) {
          const stockText = item.stocks.map(s => `${s.name}${s.rise ? ` ${s.rise}%` : ''}`).join(' ');
          text += `[${stockText}]\n`;
        }
        if (source) text += `来源: ${source}`;
        
        navigator.clipboard.writeText(text.trim()).then(() => {
          removeMenu();
          showToast('已复制到剪贴板');
        }).catch(() => {
          const textarea = document.createElement('textarea');
          textarea.value = text.trim();
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          removeMenu();
          showToast('已复制到剪贴板');
        });
      };
      
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = '取消';
      cancelBtn.onclick = removeMenu;
      
      menu.appendChild(copyBtn);
      menu.appendChild(cancelBtn);
      document.body.appendChild(menu);
      
      const closeMenu = (ev) => {
        if (!menu.contains(ev.target)) {
          removeMenu();
        }
      };
      document.addEventListener('click', closeMenu);
      document.addEventListener('contextmenu', closeMenu);
    });

    return div;
  }

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

  // ===== 自选股功能 =====
  async function showWatchlistDialog() {
    if (!window.historyStorage) {
      console.warn('自选股功能未初始化');
      return;
    }
    
    try {
      const watchlist = await window.historyStorage.getAllWatchlist();
      const groups = await window.historyStorage.getAllWatchlistGroups();
      const count = await window.historyStorage.getWatchlistCount();
      
      const dialog = document.createElement('div');
      dialog.className = 'watchlist-dialog';
      
      // 生成分组列表HTML
      let listHTML = '';
      
      const allGroupIds = groups.map(g => g.id);
      const ungroupedStocks = watchlist.filter(s => !s.groupId || s.groupId === '' || s.groupId === 'ungrouped' || !allGroupIds.includes(s.groupId));
      if (ungroupedStocks.length > 0) {
        listHTML += `
          <div class="watchlist-group" data-group="ungrouped">
            <div class="watchlist-group-header">
              <span class="watchlist-group-name">未分组</span>
              <span class="watchlist-group-count">(${ungroupedStocks.length})</span>
            </div>
            <div class="watchlist-group-stocks">
              ${ungroupedStocks.map(stock => createStockItemHTML(stock)).join('')}
            </div>
          </div>
        `;
      }
      
      for (const group of groups) {
        const groupStocks = watchlist.filter(s => s.groupId === group.id);
        if (groupStocks.length > 0) {
          listHTML += `
            <div class="watchlist-group" data-group="${group.id}">
              <div class="watchlist-group-header">
                <span class="watchlist-group-name" data-group-id="${group.id}">${esc(group.name)}</span>
                <span class="watchlist-group-count">(${groupStocks.length})</span>
                <button class="watchlist-group-menu-btn" data-group="${group.id}">⋮</button>
                <div class="watchlist-group-menu" id="menu_${group.id}">
                  <button class="watchlist-group-rename" data-group="${group.id}">重命名</button>
                  <button class="watchlist-group-delete" data-group="${group.id}">删除分组</button>
                </div>
              </div>
              <div class="watchlist-group-stocks">
                ${groupStocks.map(stock => createStockItemHTML(stock)).join('')}
              </div>
            </div>
          `;
        }
      }
      
      if (watchlist.length === 0) {
        listHTML = '<div class="watchlist-empty">暂无自选股</div>';
      }
      
      dialog.innerHTML = `
        <div class="watchlist-header">
          <div class="watchlist-header-left">
            <h3>自选股</h3>
            <button class="watchlist-add-group-btn" id="watchlistAddGroupBtn" title="添加分组">+ 分组</button>
            <button class="watchlist-add-btn-header" id="watchlistAddBtnHeader" title="添加自选股">+ 自选</button>
            <span class="watchlist-count">${count} 只</span>
          </div>
          <button class="dialog-close-btn" title="关闭">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div class="watchlist-add-row" id="watchlistAddRow" style="display:none;">
          <input type="text" id="watchlistAddInput" placeholder="输入股票代码（如601868）" maxlength="6">
          <select id="watchlistAddGroupSelect">
            <option value="ungrouped">未分组</option>
            ${groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}
          </select>
          <button class="watchlist-add-btn" id="watchlistAddBtn">添加</button>
        </div>
        <div class="watchlist-list">${listHTML}</div>
      `;
      
      document.body.appendChild(dialog);
      
      // 关闭按钮
      dialog.querySelector('.dialog-close-btn').addEventListener('click', () => {
        dialog.remove();
      });

      // "+ 添加"按钮 - 切换添加行显示
      const addBtnHeader = dialog.querySelector('#watchlistAddBtnHeader');
      const addRow = dialog.querySelector('#watchlistAddRow');
      if (addBtnHeader && addRow) {
        addBtnHeader.addEventListener('click', () => {
          const isVisible = addRow.style.display !== 'none';
          addRow.style.display = isVisible ? 'none' : 'flex';
          if (!isVisible) {
            dialog.querySelector('#watchlistAddInput').focus();
          }
        });
      }

      // 添加股票
      dialog.querySelector('#watchlistAddBtn').addEventListener('click', async () => {
        const input = dialog.querySelector('#watchlistAddInput');
        const select = dialog.querySelector('#watchlistAddGroupSelect');
        const code = input.value.trim();
        const groupId = select.value;
        
        if (!/^\d{6}$/.test(code)) {
          alert('请输入6位股票代码');
          return;
        }
        
        try {
          const result = await pywebview.api.get_stock_quote(code);
          const resp = typeof result === 'string' ? JSON.parse(result) : result;
          
          if (resp.status === 'ok' && resp.quote) {
            await window.historyStorage.addWatchlistStock({
              code: code,
              name: resp.quote.name
            }, groupId);
            
            updateWatchlistBadge();
            
            dialog.remove();
            showWatchlistDialog();
          } else {
            alert('未找到该股票，请检查代码');
          }
        } catch (err) {
          console.error('添加自选股失败:', err);
          alert('添加失败: ' + err.message);
        }
      });
      
      // 添加分组按钮
      dialog.querySelector('#watchlistAddGroupBtn').addEventListener('click', async () => {
        const name = prompt('输入分组名称：');
        if (name && name.trim()) {
          await window.historyStorage.createWatchlistGroup(name.trim());
          dialog.remove();
          showWatchlistDialog();
        }
      });
      
      // 分组菜单按钮
      dialog.querySelectorAll('.watchlist-group-menu-btn').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const menu = btn.nextElementSibling;
          document.querySelectorAll('.watchlist-group-menu.show').forEach(m => {
            if (m !== menu) m.classList.remove('show');
          });
          menu.classList.toggle('show');
        };
      });
      
      // 重命名分组
      dialog.querySelectorAll('.watchlist-group-rename').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const groupId = btn.dataset.group;
          const groupName = btn.closest('.watchlist-group-header').querySelector('.watchlist-group-name').textContent;
          const newName = prompt('输入新名称：', groupName);
          if (newName && newName.trim()) {
            await window.historyStorage.renameWatchlistGroup(groupId, newName.trim());
            dialog.remove();
            showWatchlistDialog();
          }
        };
      });
      
      // 删除分组
      dialog.querySelectorAll('.watchlist-group-delete').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const groupId = btn.dataset.group;
          if (confirm('删除分组后，组内股票将移至"未分组"，确定删除？')) {
            await window.historyStorage.deleteWatchlistGroup(groupId);
            dialog.remove();
            showWatchlistDialog();
          }
        };
      });
      
      // 键盘事件
      dialog.querySelector('#watchlistAddInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          dialog.querySelector('#watchlistAddBtn').click();
        }
      });
      
      // 绑定股票项事件
      bindWatchlistItemEvents(dialog);
      
    } catch (err) {
      console.error('加载自选股列表失败:', err);
    }
  }
  
  async function updateWatchlistBadge() {
    if (!$watchlistBadge || !window.historyStorage) return;
    try {
      const count = await window.historyStorage.getWatchlistCount();
      if (count > 0) {
        $watchlistBadge.textContent = count;
        $watchlistBadge.style.display = 'inline';
      } else {
        $watchlistBadge.style.display = 'none';
      }
    } catch (e) {}
  }

  function createStockItemHTML(stock) {
    const threshold = stock.alertThreshold || 5;
    return `
      <div class="watchlist-item" data-code="${stock.code}">
        <button class="watchlist-remove-btn" title="移除自选股">×</button>
        <div class="watchlist-stock-info">
          <span class="watchlist-stock-name">${esc(stock.name || '未知')}</span>
          <span class="watchlist-stock-code">${esc(stock.code)}</span>
        </div>
        <div class="watchlist-threshold-control">
          <span class="watchlist-threshold-label">阈值</span>
          <input type="number" class="watchlist-threshold-input" value="${threshold}" min="0.1" max="50" step="0.1" title="设置预警阈值">
          <span class="watchlist-threshold-unit">%</span>
        </div>
        <button class="watchlist-move-btn" title="移动到分组">→</button>
        <button class="watchlist-quote-btn" title="查看行情">📊</button>
        <button class="watchlist-minute-btn" title="分时图">📈</button>
        <div class="watchlist-minute-container" style="display:none;">
          <canvas class="minute-chart-canvas"></canvas>
        </div>
      </div>
    `;
  }
  
  function bindWatchlistItemEvents(dialog) {
    // 移除按钮
    dialog.querySelectorAll('.watchlist-remove-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const item = btn.closest('.watchlist-item');
        const code = item.dataset.code;
        
        if (!confirm(`确定移除 ${code} 吗？`)) return;
        
        try {
          await window.historyStorage.removeWatchlistStock(code);
          item.remove();
          
          const newCount = await window.historyStorage.getWatchlistCount();
          dialog.querySelector('.watchlist-count').textContent = newCount + ' 只';
          updateWatchlistBadge();
          
          // 检查是否需要显示空状态
          const listEl = dialog.querySelector('.watchlist-list');
          if (listEl.querySelectorAll('.watchlist-item').length === 0) {
            listEl.innerHTML = '<div class="watchlist-empty">暂无自选股</div>';
          }
        } catch (err) {
          console.error('移除自选股失败:', err);
        }
      };
    });
    
    // 查看行情按钮
    dialog.querySelectorAll('.watchlist-quote-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const item = btn.closest('.watchlist-item');
        const code = item.dataset.code;
        await showStockQuoteDialog(code);
      };
    });

    // 分时图按钮
    dialog.querySelectorAll('.watchlist-minute-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const item = btn.closest('.watchlist-item');
        const code = item.dataset.code;
        const container = item.querySelector('.watchlist-minute-container');
        if (!container) return;

        // 切换显示
        const isVisible = container.style.display !== 'none';
        if (isVisible) {
          container.style.display = 'none';
          return;
        }
        container.style.display = 'block';

        // 检查 MinuteChart 是否可用
        if (typeof MinuteChart === 'undefined') {
          container.querySelector('.minute-chart-canvas').insertAdjacentHTML('beforebegin', '<div style="padding:8px;color:var(--text-secondary);font-size:12px;text-align:center;">分时图模块未加载</div>');
          return;
        }

        // 显示加载中
        const canvas = container.querySelector('.minute-chart-canvas');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary') || '#666';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('加载分时数据中...', canvas.width / 2, canvas.height / 2);

        try {
          if (!window.pywebview || !window.pywebview.api || !window.pywebview.api.get_stock_minutes) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillText('后端接口不可用', canvas.width / 2, canvas.height / 2);
            return;
          }
          const result = await window.pywebview.api.get_stock_minutes(code);
          const data = typeof result === 'string' ? JSON.parse(result) : result;
          if (data.status !== 'ok' || !data.data) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillText(data.message || '无分时数据', canvas.width / 2, canvas.height / 2);
            return;
          }
          const chart = new MinuteChart(canvas);
          chart.setData(data.data);
          chart.draw();
        } catch (err) {
          console.error('加载分时图失败:', err);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#e53935';
          ctx.fillText('加载失败: ' + (err.message || ''), canvas.width / 2, canvas.height / 2);
        }
      };
    });
    
    // 移动到分组按钮
    dialog.querySelectorAll('.watchlist-move-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const item = btn.closest('.watchlist-item');
        const code = item.dataset.code;
        
        const groups = await window.historyStorage.getAllWatchlistGroups();
        
        // 显示分组选择对话框
        const menu = document.createElement('div');
        menu.className = 'watchlist-move-menu';
        menu.innerHTML = '<div class="watchlist-move-title">移动到分组</div>';
        
        const ungroupedBtn = document.createElement('button');
        ungroupedBtn.textContent = '未分组';
        ungroupedBtn.onclick = async () => {
          await window.historyStorage.updateWatchlistStockGroup(code, 'ungrouped');
          menu.remove();
          dialog.remove();
          showWatchlistDialog();
        };
        menu.appendChild(ungroupedBtn);
        
        for (const group of groups) {
          const groupBtn = document.createElement('button');
          groupBtn.textContent = group.name;
          groupBtn.onclick = async () => {
            await window.historyStorage.updateWatchlistStockGroup(code, group.id);
            menu.remove();
            dialog.remove();
            showWatchlistDialog();
          };
          menu.appendChild(groupBtn);
        }
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '取消';
        closeBtn.className = 'watchlist-move-close';
        closeBtn.onclick = () => menu.remove();
        menu.appendChild(closeBtn);
        
        document.body.appendChild(menu);
        
        // 定位菜单
        const rect = btn.getBoundingClientRect();
        menu.style.top = (rect.bottom + 5) + 'px';
        menu.style.left = rect.left + 'px';
        
        // 点击外部关闭
        setTimeout(() => {
          document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) {
              menu.remove();
              document.removeEventListener('click', closeMenu);
            }
          });
        }, 0);
      };
    });
    
    // 阈值输入框事件
    dialog.querySelectorAll('.watchlist-threshold-input').forEach(input => {
      input.addEventListener('change', async (e) => {
        const item = input.closest('.watchlist-item');
        const code = item.dataset.code;
        const threshold = parseFloat(input.value);
        
        if (isNaN(threshold) || threshold <= 0) {
          input.value = 5;
          return;
        }
        
        try {
          await window.historyStorage.updateWatchlistStockAlertThreshold(code, threshold);
          if (DEBUG_MODE) console.log(`[自选股] 已更新 ${code} 的预警阈值为 ${threshold}%`);
        } catch (err) {
          console.error('更新预警阈值失败:', err);
          input.value = 5;
        }
      });
      
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          input.blur();
        }
      });
    });
  }
  
  async function showStockQuoteDialog(code) {
    try {
      const result = await pywebview.api.get_stock_quote(code);
      const resp = typeof result === 'string' ? JSON.parse(result) : result;
      
      if (resp.status !== 'ok' || !resp.quote) {
        alert('获取行情失败');
        return;
      }
      
      const q = resp.quote;
      const changePercent = q.changePercent || 0;
      const changeClass = changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : '';
      const changeSign = changePercent > 0 ? '+' : '';
      
      const dialog = document.createElement('div');
      dialog.className = 'quote-dialog';
      
      dialog.innerHTML = `
        <div class="quote-header">
          <div>
            <h3>${esc(q.name)}</h3>
            <span class="quote-code">${esc(q.code)} · ${esc(q.market || '')}</span>
          </div>
          <button class="dialog-close-btn" title="关闭">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div class="quote-body">
          <div class="quote-price ${changeClass}">${q.price.toFixed(2)}</div>
          <div class="quote-change ${changeClass}">
            ${changeSign}${q.change?.toFixed(2) || '0.00'}
            (${changeSign}${changePercent.toFixed(2)}%)
          </div>
          <div class="quote-grid">
            <div class="quote-grid-item">
              <div class="quote-grid-label">今开</div>
              <div class="quote-grid-value">${q.open?.toFixed(2) || '--'}</div>
            </div>
            <div class="quote-grid-item">
              <div class="quote-grid-label">昨收</div>
              <div class="quote-grid-value">${q.yesterdayClose?.toFixed(2) || '--'}</div>
            </div>
            <div class="quote-grid-item">
              <div class="quote-grid-label">最高</div>
              <div class="quote-grid-value up">${q.high?.toFixed(2) || '--'}</div>
            </div>
            <div class="quote-grid-item">
              <div class="quote-grid-label">最低</div>
              <div class="quote-grid-value down">${q.low?.toFixed(2) || '--'}</div>
            </div>
            <div class="quote-grid-item">
              <div class="quote-grid-label">成交量</div>
              <div class="quote-grid-value">${formatVolume(q.volume || 0)}</div>
            </div>
            <div class="quote-grid-item">
              <div class="quote-grid-label">成交额</div>
              <div class="quote-grid-value">${formatAmount(q.amount || 0)}</div>
            </div>
          </div>
        </div>
      `;
      
      document.body.appendChild(dialog);
      
      dialog.querySelector('.dialog-close-btn').addEventListener('click', () => {
        dialog.remove();
      });
      
    } catch (err) {
      console.error('显示行情失败:', err);
      alert('获取行情失败: ' + err.message);
    }
  }
  
  function formatVolume(volume) {
    if (volume >= 100000000) return (volume / 100000000).toFixed(2) + '亿股';
    if (volume >= 10000) return (volume / 10000).toFixed(2) + '万股';
    return volume + '股';
  }
  
  function formatAmount(amount) {
    if (amount >= 100000000) return (amount / 100000000).toFixed(2) + '亿';
    if (amount >= 10000) return (amount / 10000).toFixed(2) + '万';
    return amount + '元';
  }

  // ===== 自选股异动提醒 =====
  let watchlistAlertTimer = null;
  let watchlistAlertState = {}; // {code: {lastTime, lastHigh, lastLow}} 记录每只股票上次提醒状态

  function startWatchlistAlertMonitor() {
    if (watchlistAlertTimer) return;
    
    // 立即检查一次
    checkWatchlistAlerts();
    
    // 每分钟检查一次
    watchlistAlertTimer = setInterval(() => {
      checkWatchlistAlerts();
    }, 60000);
    
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
    const now = new Date();
    const day = now.getDay();
    const hours = now.getHours();
    const minutes = now.getMinutes();
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
      
      const now = Date.now();
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
              lastTime: now,
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
                lastTime: now,
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
    
    const tdxCodes = codes.map(code => {
      if (code.startsWith('6')) return `sh${code}`;
      if (code.startsWith(('0', '3'))) return `sz${code}`;
      if (code.startsWith(('8', '4'))) return `bj${code}`;
      return code;
    });
    
    const quotes = [];
    const batchSize = 20;
    
    for (let i = 0; i < tdxCodes.length; i += batchSize) {
      const batch = tdxCodes.slice(i, i + batchSize);
      try {
        const resp = await fetch(`https://qt.gtimg.cn/q=${batch.join(',')}`);
        const buffer = await resp.arrayBuffer();
        const decoder = new TextDecoder('gbk');
        const text = decoder.decode(buffer);
        
        const lines = text.trim().split('\n');
        for (const line of lines) {
          const match = line.match(/v_\w+="([^"]+)"/);
          if (match) {
            const fields = match[1].split('~');
            if (fields.length >= 35) {
              const rawCode = fields[2];
              const code = rawCode.replace(/^(sh|sz|bj)/, '');
              const price = parseFloat(fields[3]) || 0;
              const yesterdayClose = parseFloat(fields[4]) || 0;
              const change = price - yesterdayClose;
              const changePercent = yesterdayClose > 0 ? (change / yesterdayClose) * 100 : 0;
              
              quotes.push({
                quote: {
                  code: code,
                  name: fields[1],
                  price: price,
                  yesterdayClose: yesterdayClose,
                  change: change,
                  changePercent: changePercent,
                  high: parseFloat(fields[33]) || 0,
                  low: parseFloat(fields[34]) || 0,
                  open: parseFloat(fields[5]) || 0,
                  volume: parseInt(fields[6]) * 100 || 0,
                  amount: parseFloat(fields[37]) * 10000 || 0,
                }
              });
            }
          }
        }
      } catch (err) {
        if (DEBUG_MODE) console.error('[自选股提醒] 批量查询失败:', err);
      }
    }
    
    return quotes;
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

  function playAlertSound() {
    // 使用 Web Audio API 生成简单的警报音
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 880; // A5
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      
      oscillator.start();
      
      // 响2次
      setTimeout(() => {
        oscillator.stop();
      }, 200);
      
      setTimeout(() => {
        const osc2 = audioContext.createOscillator();
        const gain2 = audioContext.createGain();
        osc2.connect(gain2);
        gain2.connect(audioContext.destination);
        osc2.frequency.value = 1047; // C6
        osc2.type = 'sine';
        gain2.gain.value = 0.3;
        osc2.start();
        setTimeout(() => osc2.stop(), 300);
      }, 300);
    } catch (err) {
      if (DEBUG_MODE) console.warn('播放提醒音失败:', err);
    }
  }

  // ===== 多条件提醒 + 智能阈值 + 盘口异动 =====
  let _alertConditions = JSON.parse(localStorage.getItem('alert_conditions') || '{"changePercent":5,"volumeRatio":2,"amplitude":8,"triggerMode":"any","cooldown":300}');
  let _alertLastTrigger = {}; // 记录每只股票上次触发时间

  // 计算ATR（平均真实波幅）
  async function calculateATR(code) {
    try {
      if (!window.pywebview || !window.pywebview.api) return 0;
      const result = await window.pywebview.api.get_stock_history(code, 21);
      const data = JSON.parse(result);
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
      const data = typeof result === 'string' ? JSON.parse(result) : result;

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

  // ===== 语音播报 =====
  function initVoice() {
    if (!synth) return;

    function populateVoices() {
      voiceList = synth.getVoices().filter(v =>
        v.lang.startsWith('zh') || v.lang === 'cmn'
      );
      $voiceSelect.innerHTML = '';
      voiceList.forEach((v, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = v.name;
        $voiceSelect.appendChild(opt);
      });
      // 选中之前保存的
      if (settings.voiceIndex >= 0 && settings.voiceIndex < voiceList.length) {
        $voiceSelect.value = settings.voiceIndex;
      }
    }

    populateVoices();
    synth.onvoiceschanged = populateVoices;
  }

  function stopVoice() {
    if (synth) {
      synth.cancel();
    }
    // 停止 Edge TTS 音频播放
    if (_currentAudio) {
      try { _currentAudio.pause(); _currentAudio.currentTime = 0; } catch (e) {}
      _currentAudio = null;
    }
    voiceQueue = [];
    speaking = false;
    // 递增令牌，使正在进行的 Edge TTS 异步请求失效
    _ttsRequestToken++;
  }

  // ===== Edge TTS 语音引擎 =====
  let _ttsEngine = 'web'; // 'web' 或 'edge'
  let _ttsVoice = 'zh-CN-YunyangNeural';
  let _ttsRequestToken = 0; // 请求令牌，stopVoice 时递增，使进行中的异步请求失效
  let _ttsBlockKeywords = [];
  let _ttsSilentEnabled = false;
  let _ttsSilentPeriods = [];
  let _currentAudio = null;

  async function speakWithEdgeTTS(text) {
    if (!window.pywebview || !window.pywebview.api) return false;
    const myToken = _ttsRequestToken; // 记录当前令牌
    try {
      const rateStr = (parseFloat(document.getElementById('voiceRate')?.value || 1.5) - 1) * 100;
      const rate = (rateStr >= 0 ? '+' : '') + rateStr + '%';
      const result = await window.pywebview.api.tts_synthesize(text, _ttsVoice, rate, '+0%');
      // 检查令牌：如果在异步等待期间被 stopVoice 了，放弃播放
      if (myToken !== _ttsRequestToken) return true; // 返回 true 避免回退到 web
      const data = JSON.parse(result);
      if (data.status === 'ok' && data.audio_data) {
        // 再次检查令牌
        if (myToken !== _ttsRequestToken) return true;
        _currentAudio = new Audio(data.audio_data);
        _currentAudio.onended = () => {
          if (myToken === _ttsRequestToken) { _currentAudio = null; processVoiceQueue(); }
        };
        _currentAudio.onerror = () => {
          if (myToken === _ttsRequestToken) { _currentAudio = null; processVoiceQueue(); }
        };
        _currentAudio.play().catch(e => console.error('Edge TTS 播放失败:', e));
        return true;
      } else if (data.status === 'ok' && data.audio_path) {
        if (myToken !== _ttsRequestToken) return true;
        _currentAudio = new Audio('file:///' + data.audio_path.replace(/\\/g, '/'));
        _currentAudio.onended = () => {
          if (myToken === _ttsRequestToken) { _currentAudio = null; processVoiceQueue(); }
        };
        _currentAudio.onerror = () => {
          if (myToken === _ttsRequestToken) { _currentAudio = null; processVoiceQueue(); }
        };
        _currentAudio.play().catch(e => console.error('Edge TTS 播放失败:', e));
        return true;
      }
      console.warn('Edge TTS 返回异常:', data.message);
    } catch (e) {
      console.error('Edge TTS 播放失败:', e);
    }
    return false;
  }

  function shouldSkipByKeyword(text) {
    if (!_ttsBlockKeywords || _ttsBlockKeywords.length === 0) return false;
    const escaped = _ttsBlockKeywords.map(kw => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(escaped.join('|'), 'gi');
    return regex.test(text);
  }

  function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  function isInSilentPeriod() {
    if (!_ttsSilentEnabled || _ttsSilentPeriods.length === 0) return false;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    for (const period of _ttsSilentPeriods) {
      const start = timeToMinutes(period.start);
      const end = timeToMinutes(period.end);
      if (start <= end) {
        if (currentMinutes >= start && currentMinutes < end) return true;
      } else {
        if (currentMinutes >= start || currentMinutes < end) return true;
      }
    }
    return false;
  }

  function enqueueVoice(text, ctime) {
    if (!synth || !text) return;

    if (shouldSkipByKeyword(text)) return;
    if (isInSilentPeriod()) return;

    // 注意：不再基于 ctime（新闻发布时间）判断是否播报。
    // 原因：各子源 API 时效性不同（如新浪财经接近实时，同花顺/东方财富可能有数分钟延迟），
    //       用 ctime 过滤会导致延迟子源的新闻被静默跳过。
    //       后端已通过 skip_tts=true 机制（基于入队时间，5分钟超时）统一控制，
    //       shouldAnnounce 已检查 skip_tts，此处无需重复过滤。

    const speakText = text.length > 80 ? text.substring(0, 80) + '...' : text;

    if (settings.voiceInterruptMode === VOICE_INTERRUPT_MODE_IMMEDIATE) {
      stopVoice();
      voiceQueue = [speakText];
      processVoiceQueue();
    } else {
      if (voiceQueue.length < 20) {
        voiceQueue.push(speakText);
      }
      if (!speaking) {
        processVoiceQueue();
      }
    }
  }

  function processVoiceQueue() {
    if (voiceQueue.length === 0) {
      speaking = false;
      return;
    }
    speaking = true;
    const text = voiceQueue.shift();

    // 根据引擎选择：Edge TTS 优先（如果可用且已选择）
    if (_ttsEngine === 'edge' && window.pywebview && window.pywebview.api && window.pywebview.api.tts_synthesize) {
      speakWithEdgeTTS(text).then(ok => {
        if (!ok) {
          // Edge TTS 失败，回退到浏览器内置
          _speakWithWeb(text);
        }
      });
      return;
    }
    _speakWithWeb(text);
  }

  // 浏览器内置语音播报
  function _speakWithWeb(text) {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-CN';
    utter.rate = parseFloat($voiceRate.value) || 1.5;

    if (voiceList.length > 0) {
      const idx = parseInt($voiceSelect.value) || 0;
      if (voiceList[idx]) utter.voice = voiceList[idx];
    }

    utter.onend = () => processVoiceQueue();
    utter.onerror = () => processVoiceQueue();
    synth.speak(utter);
  }

  // ===== 语音播报过滤规则 =====
  const SKIP_SOURCES = ['券商研报', '公告解读'];

  function shouldAnnounce(item) {
    // 超时消息：后端标记 skip_tts=true，只展示不播报
    if (item.skip_tts === true) {
      return false;
    }

    const source = item.comefrom || '';
    
    // 检查是否命中关键词高亮（标题或内容包含关键词）
    if (settings.keywordHighlight && settings.keywords.length > 0) {
      const text = (item.title || '') + ' ' + (item.content || '');
      const escaped = settings.keywords.map(kw => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const regex = new RegExp(escaped.join('|'), 'gi');
      if (regex.test(text)) {
        return true;
      }
    }
    
    // 检查是否涉及自选股（同步检查，通过item.stocks字段）
    if (item.stocks && item.stocks.length > 0) {
      return true;
    }
    
    // 来源黑名单：这些数据源的消息不播报
    for (const skip of SKIP_SOURCES) {
      if (source.includes(skip)) {
        return false;
      }
    }
    
    // 默认：播报所有其他消息
    return true;
  }

  // ===== 设置 =====
  function loadSettings() {
    try {
      const saved = localStorage.getItem('ztfi-settings');
      if (saved) {
        // 直接返回已保存的设置，不修改 sources 数组
        // settings.sources = [] 表示不过滤（显示所有来源）
        // settings.sources = ['实时聚合', ...] 表示只显示指定来源
        return JSON.parse(saved);
      }
    } catch (e) {}
    return {
      sources: [], // 默认不过滤，显示所有来源
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
    };
  }

  function getCurrentVersion() {
    const match = document.title.match(/v(\d+\.\d+\.\d+)/);
    return match ? match[1] : '3.9.2';
  }

  function saveSettings() {
    try {
      localStorage.setItem('ztfi-settings', JSON.stringify(settings));
      // 同步保存到 Python 端文件（供启动时读取主题）
      if (window.pywebview && window.pywebview.api && window.pywebview.api.persist_settings) {
        pywebview.api.persist_settings(JSON.stringify(settings)).catch(() => {});
      }
    } catch (e) {}
  }

  function initSettings() {
    // 来源列表
    $sourceList.innerHTML = '';
    ALL_SOURCES.forEach(src => {
      const chip = document.createElement('span');
      chip.className = 'source-chip' + (settings.sources.length === 0 || settings.sources.includes(src) ? ' active' : '');
      chip.dataset.source = src;
      chip.innerHTML = `<span class="check">✓</span>${src}`;
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        updateSourceSettings();
      });
      $sourceList.appendChild(chip);
    });

    // 语音
    $voiceEnabled.checked = settings.voiceEnabled;
    $voiceSpeedRow.style.display = settings.voiceEnabled ? 'flex' : 'none';
    $voiceSettings.style.display = settings.voiceEnabled ? 'flex' : 'none';
    $voiceInterruptModeRow.style.display = settings.voiceEnabled ? 'flex' : 'none';
    const $ttsEngineRow = document.getElementById('ttsEngineRow');
    if ($ttsEngineRow) $ttsEngineRow.style.display = settings.voiceEnabled ? 'flex' : 'none';

    $voiceEnabled.addEventListener('change', () => {
      settings.voiceEnabled = $voiceEnabled.checked;
      $voiceSettings.style.display = settings.voiceEnabled ? 'flex' : 'none';
      $voiceSpeedRow.style.display = settings.voiceEnabled ? 'flex' : 'none';
      $voiceInterruptModeRow.style.display = settings.voiceEnabled ? 'flex' : 'none';
      if ($ttsEngineRow) $ttsEngineRow.style.display = settings.voiceEnabled ? 'flex' : 'none';
      // 根据当前 TTS 引擎显示对应音色行
      updateTtsVoiceRowVisibility();
      saveSettings();
    });

    // 根据当前 TTS 引擎显示/隐藏对应音色选择行
    function updateTtsVoiceRowVisibility() {
      const engine = localStorage.getItem('tts_engine') || 'web';
      if ($voiceSettings) $voiceSettings.style.display = (settings.voiceEnabled && engine === 'web') ? 'flex' : 'none';
      const $ttsVoiceRow = document.getElementById('ttsVoiceRow');
      if ($ttsVoiceRow) $ttsVoiceRow.style.display = (settings.voiceEnabled && engine === 'edge') ? 'flex' : 'none';
    }
    updateTtsVoiceRowVisibility();

    $voiceRate.value = settings.voiceRate;
    $voiceRate.addEventListener('change', () => {
      settings.voiceRate = parseFloat($voiceRate.value);
      saveSettings();
    });

    $voiceInterruptMode.value = settings.voiceInterruptMode;
    $voiceInterruptMode.addEventListener('change', () => {
      settings.voiceInterruptMode = $voiceInterruptMode.value;
      saveSettings();
    });

    $voiceSelect.addEventListener('change', () => {
      settings.voiceIndex = parseInt($voiceSelect.value);
      saveSettings();
    });

    $voiceTest.addEventListener('click', () => {
      if (synth) {
        synth.cancel();
        const utter = new SpeechSynthesisUtterance('这是一条测试语音，财经聚合消息推送已开启。');
        utter.lang = 'zh-CN';
        utter.rate = parseFloat($voiceRate.value) || 1.5;
        if (voiceList.length > 0) {
          const idx = parseInt($voiceSelect.value) || 0;
          if (voiceList[idx]) utter.voice = voiceList[idx];
        }
        synth.speak(utter);
      }
    });

    // 隐藏相似消息
    $hideDuplicates.checked = settings.hideDuplicates;
    $hideDuplicates.addEventListener('change', () => {
      settings.hideDuplicates = $hideDuplicates.checked;
      saveSettings();
    });

    // 关键词高亮
    $keywordHighlight.checked = settings.keywordHighlight;
    $keywordInputRow.style.display = settings.keywordHighlight ? 'flex' : 'none';
    $keywordTags.style.display = settings.keywordHighlight ? 'flex' : 'none';

    $keywordHighlight.addEventListener('change', () => {
      settings.keywordHighlight = $keywordHighlight.checked;
      $keywordInputRow.style.display = settings.keywordHighlight ? 'flex' : 'none';
      $keywordTags.style.display = settings.keywordHighlight ? 'flex' : 'none';
      saveSettings();
      if (settings.keywordHighlight) {
        applyHighlightAll();
      } else {
        removeHighlightAll();
      }
    });

    // 关键词警报开关
    $keywordAlert.checked = settings.keywordAlert;
    $keywordAlert.addEventListener('change', () => {
      settings.keywordAlert = $keywordAlert.checked;
      saveSettings();
    });

    renderKeywordTags();

    $keywordAddBtn.addEventListener('click', addKeyword);
    $keywordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addKeyword();
    });

    // 显示设置
    $showStocks.checked = settings.showStocks;
    $showStocks.addEventListener('change', () => {
      settings.showStocks = $showStocks.checked;
      saveSettings();
    });

    $showRelated.checked = settings.showRelated;
    $showRelated.addEventListener('change', () => {
      settings.showRelated = $showRelated.checked;
      saveSettings();
    });

    // 自选股异动提醒设置
    const $watchlistAlertEnabled = document.getElementById('watchlistAlertEnabled');
    const $watchlistAlertThreshold = document.getElementById('watchlistAlertThreshold');
    const $watchlistAlertInterval = document.getElementById('watchlistAlertInterval');
    const $watchlistAlertSound = document.getElementById('watchlistAlertSound');

    $watchlistAlertEnabled.checked = settings.watchlistAlertEnabled;
    $watchlistAlertThreshold.value = settings.watchlistAlertThreshold;
    $watchlistAlertInterval.value = settings.watchlistAlertInterval;
    $watchlistAlertSound.checked = settings.watchlistAlertSound;

    $watchlistAlertEnabled.addEventListener('change', () => {
      settings.watchlistAlertEnabled = $watchlistAlertEnabled.checked;
      saveSettings();
      if (settings.watchlistAlertEnabled) {
        startWatchlistAlertMonitor();
      } else {
        stopWatchlistAlertMonitor();
      }
    });

    $watchlistAlertThreshold.addEventListener('change', () => {
      settings.watchlistAlertThreshold = parseFloat($watchlistAlertThreshold.value) || 5;
      saveSettings();
    });

    $watchlistAlertInterval.addEventListener('change', () => {
      settings.watchlistAlertInterval = parseInt($watchlistAlertInterval.value) || 5;
      saveSettings();
    });

    $watchlistAlertSound.addEventListener('change', () => {
      settings.watchlistAlertSound = $watchlistAlertSound.checked;
      saveSettings();
    });

    // 如果开启，启动异动监控
    if (settings.watchlistAlertEnabled) {
      startWatchlistAlertMonitor();
    }

    // 字体大小设置
    $fontSize.value = settings.fontSize || 'small';
    applyFontSize(settings.fontSize || 'small');

    $fontSize.addEventListener('change', () => {
      settings.fontSize = $fontSize.value;
      applyFontSize(settings.fontSize);
      saveSettings();
    });

    // AI深度分析设置
    $aiEnabled.checked = settings.aiEnabled || false;
    $aiApiKey.value = settings.aiApiKey || '';
    $aiApiUrl.value = settings.aiApiUrl || '';
    $aiModelName.value = settings.aiModelName || '';

    const updateAiVisibility = () => {
      const enabled = $aiEnabled.checked;
      $aiApiKeyRow.style.display = enabled ? 'flex' : 'none';
      $aiApiUrlRow.style.display = enabled ? 'flex' : 'none';
      $aiModelNameRow.style.display = enabled ? 'flex' : 'none';
      $aiTestRow.style.display = enabled ? 'flex' : 'none';
      $aiConfigHint.style.display = enabled ? 'block' : 'none';
    };
    updateAiVisibility();

    $aiEnabled.addEventListener('change', () => {
      settings.aiEnabled = $aiEnabled.checked;
      updateAiVisibility();
      saveSettings();
    });

    $aiApiKey.addEventListener('change', () => {
      settings.aiApiKey = $aiApiKey.value;
      saveSettings();
    });

    $aiApiUrl.addEventListener('change', () => {
      settings.aiApiUrl = $aiApiUrl.value;
      saveSettings();
    });

    $aiModelName.addEventListener('change', () => {
      settings.aiModelName = $aiModelName.value;
      saveSettings();
    });

    $btnAiTest.addEventListener('click', async () => {
      if (!settings.aiEnabled || !settings.aiApiKey) {
        alert('请先启用AI分析并配置API密钥');
        return;
      }

      const originalText = $btnAiTest.textContent;
      $btnAiTest.textContent = '测试中...';
      $btnAiTest.disabled = true;

      try {
        if (window.pywebview && window.pywebview.api && window.pywebview.api.ai_analyze) {
          const result = await pywebview.api.ai_analyze(
            '央行宣布下调存款准备金率', 
            '央行决定下调金融机构存款准备金率0.25个百分点',
            'custom',
            settings.aiApiKey,
            settings.aiApiUrl || '',
            settings.aiModelName || ''
          );
          const parsed = JSON.parse(result);
          if (parsed.error) {
            alert(`测试失败: ${parsed.error}`);
          } else {
            alert(`测试成功！\n分类: ${parsed.category}\n优先级: ${parsed.priority}\n情感: ${parsed.sentiment}\n摘要: ${parsed.summary}`);
          }
        } else {
          alert('AI分析API不可用');
        }
      } catch (e) {
        alert(`测试失败: ${e.message}`);
      } finally {
        $btnAiTest.textContent = originalText;
        $btnAiTest.disabled = false;
      }
    });

    // 打开/关闭
    $btnSettings.addEventListener('click', () => {
      $settingsOverlay.classList.add('show');
    });

    $btnWatchlist.addEventListener('click', () => {
      showWatchlistDialog();
    });

    $btnSearch.addEventListener('click', () => {
      $searchDialog.style.display = 'flex';
      $searchInput.focus();
    });

    $btnFavorites.addEventListener('click', () => {
      loadFavorites();
      $favoritesDialog.style.display = 'flex';
    });

    $searchDialog.querySelector('.dialog-close-btn').addEventListener('click', () => {
      $searchDialog.style.display = 'none';
    });

    $favoritesDialog.querySelector('.dialog-close-btn').addEventListener('click', () => {
      $favoritesDialog.style.display = 'none';
    });

    $searchBtn.addEventListener('click', () => {
      performSearch();
    });

    $searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        performSearch();
      }
    });

    document.addEventListener('click', (e) => {
      if (!$searchDialog.contains(e.target) && !$btnSearch.contains(e.target)) {
        $searchDialog.style.display = 'none';
      }
      if (!$favoritesDialog.contains(e.target) && !$btnFavorites.contains(e.target)) {
        $favoritesDialog.style.display = 'none';
      }
    });

    updateFavoritesBadge();

    // 主题切换
    function applyTheme() {
      if (settings.darkMode) {
        document.body.classList.add('dark-mode');
      } else {
        document.body.classList.remove('dark-mode');
      }
      setWindowTitlebarTheme(settings.darkMode);
    }

    function setWindowTitlebarTheme(isDark) {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.set_theme) {
        pywebview.api.set_theme(isDark ? 'dark' : 'light').catch(() => {});
      }
    }

    applyTheme();

    // pywebview API 就绪后重新应用主题（解决初始化时序问题）
    window.addEventListener('pywebviewready', () => {
      setWindowTitlebarTheme(settings.darkMode);
      if (settings.isPinned && window.pywebview && window.pywebview.api && window.pywebview.api.toggle_pin) {
        pywebview.api.toggle_pin(true).catch(() => {});
      }
      // 监听窗口大小变化，保存到后端
      window.addEventListener('resize', () => {
        if (windowResizeTimer) clearTimeout(windowResizeTimer);
        windowResizeTimer = setTimeout(() => {
          const width = window.outerWidth;
          const height = window.outerHeight;
          if (window.pywebview && window.pywebview.api && window.pywebview.api.set_window_size) {
            window.pywebview.api.set_window_size(width, height).catch(() => {});
          }
        }, 1000);
      });
    });

    $btnThemeToggle.addEventListener('click', () => {
      settings.darkMode = !settings.darkMode;
      applyTheme();
      saveSettings();
    });

    $settingsClose.addEventListener('click', () => {
      $settingsOverlay.classList.remove('show');
    });

    $settingsOverlay.addEventListener('click', (e) => {
      if (e.target === $settingsOverlay) {
        $settingsOverlay.classList.remove('show');
      }
    });
  }

  function updateSourceSettings() {
    const chips = $sourceList.querySelectorAll('.source-chip');
    const activeSources = [];
    chips.forEach(chip => {
      if (chip.classList.contains('active')) {
        activeSources.push(chip.dataset.source);
      }
    });

    // 如果全部勾选，清空数组表示"不过滤"
    if (activeSources.length === ALL_SOURCES.length) {
      settings.sources = [];
    } else {
      settings.sources = activeSources;
    }
    saveSettings();
  }

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

  function playAlertSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
      // fallback: 尝试系统 beep
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
    cleanupOldHistory();
    setInterval(cleanupOldHistory, 24 * 60 * 60 * 1000);
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
      if (item.art_code && window.pywebview && window.pywebview.api) {
        if (DEBUG_MODE) console.log('[详情] 调用 get_announcement_detail, art_code:', item.art_code);
        const resp = await pywebview.api.get_announcement_detail(item.art_code);
        if (DEBUG_MODE) console.log('[详情] 公告详情返回:', resp);
        const data = typeof resp === 'string' ? JSON.parse(resp) : resp;
        if (data.status === 'ok' && data.content) {
          detailContent = data.content;
        }
      } else if (item.info_code && window.pywebview && window.pywebview.api) {
        if (DEBUG_MODE) console.log('[详情] 调用 get_research_detail, info_code:', item.info_code);
        const resp = await pywebview.api.get_research_detail(item.info_code);
        if (DEBUG_MODE) console.log('[详情] 研报详情返回:', resp);
        const data = typeof resp === 'string' ? JSON.parse(resp) : resp;
        if (data.status === 'ok' && data.content) {
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

  // ===== 标题相似度去重 =====

  /**
   * 计算两个字符串的相似度（0~1）
   * 使用 Dice 系数（基于 bigram），对中文标题效果好
   */
  function titleSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    // 短标题（<=8字）要求更严格：完全一样才算相似
    if (a.length <= 8 || b.length <= 8) {
      return a === b ? 1 : 0;
    }
    const bigramsA = getBigrams(a);
    const bigramsB = getBigrams(b);
    if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
    let intersection = 0;
    for (const bg of bigramsA) {
      if (bigramsB.has(bg)) intersection++;
    }
    return (2 * intersection) / (bigramsA.size + bigramsB.size);
  }

  function getBigrams(str) {
    const set = new Set();
    // 去掉标点和空格后再取 bigram
    const clean = str.replace(/[\s\u3000,，。.!！?？:：;；、""''「」【】\-\—\（）()《》]/g, '');
    for (let i = 0; i < clean.length - 1; i++) {
      set.add(clean.substring(i, i + 2));
    }
    return set;
  }

  /**
   * 查找与新消息标题相似的已有消息
   * 返回 { match: recentItem } 或 null
   */
  function findSimilarItem(title) {
    if (!settings.hideDuplicates || !title) return null;
    // 阈值：0.55 对财经标题比较合适（允许措辞微调但同一事件能匹配）
    const THRESHOLD = 0.55;
    for (let i = recentItems.length - 1; i >= 0; i--) {
      const ri = recentItems[i];
      if (titleSimilarity(title, ri.title) >= THRESHOLD) {
        return ri;
      }
    }
    return null;
  }

  /**
   * 在已有消息卡片上追加来源信息
   */
  function appendDupBadge(matchItem, newSource) {
    if (!matchItem.sources) matchItem.sources = [];
    if (newSource && !matchItem.sources.includes(newSource)) {
      matchItem.sources.push(newSource);
    }
    matchItem.dupCount = (matchItem.dupCount || 1) + 1;

    // 更新或创建 badge
    let badge = matchItem.el.querySelector('.news-dup-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'news-dup-badge';
      matchItem.el.appendChild(badge);
    }

    const totalCount = matchItem.dupCount;
    const srcCount = matchItem.sources.length;
    let badgeText = `<span class="dup-icon">📡</span> 已有 ${totalCount} 条相似消息`;
    if (srcCount > 0) {
      badgeText += ` · ${srcCount} 个来源`;
    }
    badge.innerHTML = badgeText;

    // 追加来源标签（最多显示8个）
    let srcContainer = matchItem.el.querySelector('.news-dup-sources');
    if (!srcContainer) {
      srcContainer = document.createElement('div');
      srcContainer.className = 'news-dup-sources';
      matchItem.el.appendChild(srcContainer);
    }
    // 只显示新增的来源
    srcContainer.innerHTML = '';
    matchItem.sources.slice(0, 8).forEach(src => {
      const tag = document.createElement('span');
      tag.className = 'news-dup-source-tag';
      tag.textContent = src;
      srcContainer.appendChild(tag);
    });
    if (matchItem.sources.length > 8) {
      const more = document.createElement('span');
      more.className = 'news-dup-source-tag';
      more.textContent = `+${matchItem.sources.length - 8}`;
      srcContainer.appendChild(more);
    }
  }

  // ===== 工具函数 =====
  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  function formatTime(ctime) {
    if (!ctime) return '';
    const d = new Date(ctime * 1000);
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  }

  function p2(n) { return String(n).padStart(2, '0'); }

  function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
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

  // ===== 赞赏功能 =====
  function showDonateDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay show';
    overlay.innerHTML = `
      <div class="settings-panel">
        <div class="settings-header">
          <h3>💝 赞赏支持</h3>
          <button class="settings-close" title="关闭">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="#e53935" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
        <div class="settings-section" style="text-align: center;">
          <p class="donate-desc">本工具完全免费开放，若对你有帮助，可自愿小额赞助<br>支持后续更新</p>
          <div class="donate-qrcode" style="margin: 16px auto; max-width: 250px;">
            <img src="赞赏码.png" alt="赞赏码" style="width: 100%; border-radius: 8px;" />
          </div>
          <div class="donate-tips" style="text-align: left; font-size: 13px; color: var(--text-secondary);">
            <p>💡 提示：扫码后可自定义打赏金额</p>
            <p style="color: #E53935;">🔓 所有功能完全免费开放，打赏不会解锁任何额外功能</p>
          </div>
          <div class="donate-thanks" style="margin-top: 16px; color: var(--text-secondary);">
            <p>🙏 感谢您的支持！</p>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.settings-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('#btnDonate') || e.target.closest('#statusDonateBtn')) showDonateDialog();
  });

  // ===== 隐私声明弹窗 =====
  function showPrivacyDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay show';
    overlay.innerHTML = `
      <div class="settings-panel" style="max-width: 420px;">
        <div class="settings-header">
          <h3>📋 关于软件技术 & 隐私保护 & 开源 & 金融风险的免责声明</h3>
        </div>
        <div class="settings-section" style="padding: 16px;">
          <div style="background: #fff3e0; padding: 12px; border-radius: 8px; border-left: 4px solid #ff9800; margin-bottom: 16px;">
            <p style="margin: 0; font-size: 14px; font-weight: bold; color: #e65100;">重要风险提示</p>
          </div>
          <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.8;">
            <p style="margin: 8px 0;">1. 本软件为免费学习工具，行情数据仅作参考，<strong>不构成任何投资建议，所有交易盈亏自行承担。</strong></p>
            <p style="margin: 8px 0;">2. 软件仅低频抓取公开免费行情，禁止批量爬取、商用分发第三方数据，违规后果由使用者自负。</p>
            <p style="margin: 8px 0;">3. 软件全功能免费使用，内置收款码仅自愿赞助，无付费解锁功能，赞助无对应服务对价。</p>
            <p style="margin: 8px 0;">4. 本软件不采集您证券、身份、银行卡等隐私信息，仅本地临时读取硬件标识，不上传个人数据。</p>
            <p style="margin: 8px 0;">5. 软件集成开源工具，开源版权归原作者；禁止反编译、破解、公开发布本程序。</p>
            <p style="margin: 8px 0;">6. 使用本软件即代表您知晓并承担全部金融、网络、数据合规风险。</p>
          </div>
          <div style="margin-top: 16px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <a href="#" class="policy-link" data-section="privacy" style="font-size: 12px; color: #0366d6; cursor: pointer; text-align: left;">🔒 隐私政策</a>
              <a href="#" class="policy-link" data-section="risk" style="font-size: 12px; color: #0366d6; cursor: pointer; text-align: left;">⚠️ 金融风险免责</a>
              <a href="#" class="policy-link" data-section="compliance" style="font-size: 12px; color: #0366d6; cursor: pointer; text-align: left;">📊 数据抓取合规</a>
              <a href="#" class="policy-link" data-section="donate" style="font-size: 12px; color: #0366d6; cursor: pointer; text-align: left;">💝 自愿赞助说明</a>
              <a href="#" class="policy-link" data-section="open-source" style="font-size: 12px; color: #0366d6; cursor: pointer; text-align: left;">📜 开源版权说明</a>
              <a href="#" class="policy-link" data-section="general" style="font-size: 12px; color: #0366d6; cursor: pointer; text-align: left;">⚖️ 通用免责条款</a>
            </div>
          </div>
        </div>
        <div class="settings-section" style="padding: 16px; border-top: 1px solid var(--border);">
          <div style="display: flex; gap: 8px;">
            <button id="btnRejectPrivacy" style="flex: 2; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 14px; transition: background 0.15s;">
              我拒绝
            </button>
            <button id="btnAcceptPrivacy" class="primary-btn" style="flex: 3;">
              我已阅读并同意
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#btnAcceptPrivacy').addEventListener('click', () => {
      settings.privacyAccepted = true;
      settings.privacyAcceptedVersion = getCurrentVersion();
      saveSettings();
      overlay.remove();
      init();
    });
    overlay.querySelector('#btnRejectPrivacy').addEventListener('click', () => {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.exit_app) {
        pywebview.api.exit_app();
      } else {
        window.close();
      }
    });
    overlay.querySelectorAll('.policy-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const section = link.dataset.section;
        showPolicyDetail(section);
      });
    });
  }

  function showPolicyDetail(section) {
    const policies = {
      'privacy': {
        title: '🔒 隐私政策',
        content: `<strong>一、数据收集</strong>
<p style="margin: 8px 0;">本软件仅在用户本地设备上收集和存储以下数据：</p>
<table style="width:100%; border-collapse: collapse; font-size: 12px; margin: 8px 0;">
<tr style="background: var(--bg-secondary);"><th style="padding: 6px; border: 1px solid var(--border); text-align: left;">数据类型</th><th style="padding: 6px; border: 1px solid var(--border); text-align: left;">存储位置</th><th style="padding: 6px; border: 1px solid var(--border); text-align: left;">用途</th></tr>
<tr><td style="padding: 6px; border: 1px solid var(--border);">已读消息ID</td><td style="padding: 6px; border: 1px solid var(--border);">%APPDATA%/ZTFINews/</td><td style="padding: 6px; border: 1px solid var(--border);">消息去重</td></tr>
<tr><td style="padding: 6px; border: 1px solid var(--border);">用户设置</td><td style="padding: 6px; border: 1px solid var(--border);">settings.json</td><td style="padding: 6px; border: 1px solid var(--border);">保存偏好配置</td></tr>
<tr><td style="padding: 6px; border: 1px solid var(--border);">收藏消息</td><td style="padding: 6px; border: 1px solid var(--border);">%APPDATA%/ZTFINews/</td><td style="padding: 6px; border: 1px solid var(--border);">收藏管理</td></tr>
<tr><td style="padding: 6px; border: 1px solid var(--border);">自选股列表</td><td style="padding: 6px; border: 1px solid var(--border);">%APPDATA%/ZTFINews/</td><td style="padding: 6px; border: 1px solid var(--border);">自选股管理</td></tr>
</table>
<strong>二、不收集的数据</strong>
<p style="margin: 8px 0;">本软件<strong>不会</strong>收集以下数据：</p>
<p style="margin: 4px 0 4px 16px;">• 用户个人身份信息（姓名、手机号、邮箱等）</p>
<p style="margin: 4px 0 4px 16px;">• 用户设备硬件信息（MAC地址、CPU序列号等）</p>
<p style="margin: 4px 0 4px 16px;">• 用户浏览记录或行为分析数据</p>
<p style="margin: 4px 0 4px 16px;">• 用户交易记录或账户信息</p>
<strong>三、数据使用与合规声明</strong>
<p style="margin: 8px 0;">1. 软件不会后台静默联网，所有网络请求仅为行情数据实时展示</p>
<p style="margin: 4px 0;">2. 从第三方获取的数据仅用于：在软件界面展示财经资讯、提供实时行情查询、支持消息详情查看</p>
<p style="margin: 4px 0;">3. 所有网络请求严格限流串行访问，不破解反爬机制，不使用多线程高频抓取</p>
<p style="margin: 4px 0;">4. 仅选用交易所、正规金融服务商官方免费开放 API</p>
<strong>四、数据共享</strong>
<p style="margin: 8px 0;">本软件<strong>不会</strong>将任何用户数据共享给第三方：</p>
<p style="margin: 4px 0 4px 16px;">• 不向广告商提供用户数据</p>
<p style="margin: 4px 0 4px 16px;">• 不向数据分析公司提供用户数据</p>
<p style="margin: 4px 0 4px 16px;">• 不向任何第三方平台传输用户数据</p>
<strong>五、数据安全</strong>
<p style="margin: 8px 0;">1. 所有本地数据存储在用户设备上，仅用户本人可访问</p>
<p style="margin: 4px 0;">2. 网络请求使用 HTTPS 加密传输</p>
<p style="margin: 4px 0;">3. 仅在司法机关依法出具法定文书要求时配合提供可留存的本地交互记录</p>
<strong>六、开源声明</strong>
<p style="margin: 8px 0;">本软件是开源项目（MIT License），源代码托管在 GitHub：</p>
<p style="margin: 4px 0 4px 16px;">• <a href="https://github.com/wolfjkd/ZTFI-News" target="_blank" style="color: #0366d6;">https://github.com/wolfjkd/ZTFI-News</a></p>
<p style="margin: 4px 0;">用户可自行审查源代码，确认数据处理逻辑符合本隐私政策。</p>`
      },
      'risk': {
        title: '⚠️ 金融投资重大风险免责',
        content: `1. 本软件仅为个人学习、数据展示工具，软件内全部行情、指标、数据、图表均仅作参考，<strong>绝对不构成任何投资建议、买卖操作指导、盈利预测、理财推荐，不承诺任何收益。</strong>
2. 证券、期货、基金等金融产品存在极高市场波动风险，任何依据本软件数据做出的开仓、平仓、买入、卖出操作，全部决策风险、资金盈亏损失由使用者本人全额自行承担，软件开发者不承担任何直接、间接经济赔偿责任。
3. 软件抓取的第三方公开行情存在延迟、误差、缺失、临时关停、接口失效等客观问题，开发者不保证数据实时、完整、准确，不因数据偏差承担任何损失赔偿。
4. 严禁以本软件数据作为唯一交易依据，建议使用者自行前往证券交易所、正规持牌金融机构核验真实行情与资讯。`
      },
      'compliance': {
        title: '📊 数据抓取合规声明',
        content: `1. 本软件通过开源数据工具访问互联网公开免费行情，所有网络请求严格限流串行访问，不使用代理池、多线程高频抓取、不破解任何网站验证码、登录校验、IP限制等反爬防护机制。
2. 软件仅实时临时展示行情，不批量下载、导出、分发、二次售卖第三方平台原始财经数据库，使用者不得利用本软件批量爬取、囤积、商用转发第三方数据。
3. 第三方财经网站、数据平台享有全部行情数据著作权与财产权益，若使用者违规大量抓取、商用分发引发平台维权、诉讼，全部法律责任由操作人自行承担，开发者不承担连带责任。
4. 若对应数据源平台调整访问规则、封禁接口导致软件数据功能失效，开发者无义务永久维护、补偿使用者，不承担任何损失。`
      },
      'donate': {
        title: '💝 软件使用与自愿赞助说明',
        content: `1. 本软件全部功能永久免费开放，无功能阉割、无付费解锁、无激活码强制授权机制，无论是否向开发者小额赞助，均可完整使用全部数据、展示功能。
2. 软件内置收款二维码仅为自愿开发赞助通道，属于使用者无偿赠予行为，不存在"付费换取功能、付费获取专属服务"的交易对价关系，赞助金额不代表购买软件使用权。
3. 赞助完全自愿，开发者不主动索要、不诱导、不限制未赞助用户使用；所有赞助资金仅用于软件后续优化、数据源维护，不承诺赞助后提供专属定制、一对一技术服务。
4. 本软件已开源至GitHub仓库（MIT License），用户可通过官方仓库获取源码和安装包，禁止修改后以闭源形式商用分发。`
      },
      'open-source': {
        title: '📜 开源组件版权说明',
        content: `1. 本软件采用 MIT License 开源，源代码托管于 GitHub：https://github.com/wolfjkd/ZTFI-News。
2. 本软件使用以下第三方开源组件：
   - pywebview（MIT License）：桌面应用框架
   - requests（Apache License 2.0）：HTTP请求库
   - websocket-client（BSD License）：WebSocket客户端
3. 开源组件版权、知识产权归原作者所有；使用者需遵守对应开源协议约束，不得拆分、剥离开源模块单独商用牟利。
4. 软件自研界面、本地逻辑代码为开发者原创（AI仅辅助代码生成），享有完整软件著作权；禁止逆向工程、破解、反编译、篡改软件程序。`
      },
      'general': {
        title: '⚖️ 通用软件免责条款',
        content: `1. 本软件按"现状"免费提供，开发者不保证程序无BUG、无崩溃、永久稳定运行；因系统兼容、网络故障、电脑硬件问题造成的程序异常，开发者不承担修复、赔偿义务。
2. 禁止使用者将本软件用于非法证券操作、内幕交易、市场操纵、数据窃取、爬虫攻击、商业侵权等任何违反《网络安全法》《著作权法》《证券法》相关法律法规的行为，违规使用全部法律责任由使用者独立承担。
3. 因不可抗力、运营商网络故障、第三方接口关停、政策监管调整导致软件无法使用，开发者无需承担任何补偿、退款、赔偿责任。
4. 使用者不得利用本软件从事盈利性批量服务、二次转售、打包售卖等商用行为，仅限个人非经营性学习使用。
5. 凡因使用本软件产生的纠纷，优先由双方友好协商解决；协商无法达成一致，争议提交软件开发者住所地人民法院管辖。
6. 本声明可随软件版本更新调整，新版声明随更新同步展示，使用者持续使用即视为接受更新后条款。`
      }
    };

    const policy = policies[section] || policies['privacy'];
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay show';
    overlay.innerHTML = `
      <div class="settings-panel" style="max-width: 520px; max-height: 90vh;">
        <div class="settings-header">
          <h3>${policy.title}</h3>
          <button class="settings-close" title="关闭">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="#e53935" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
        <div class="settings-section" style="padding: 16px; overflow-y: auto;">
          <div style="font-size: 13px; line-height: 1.8; color: var(--text-secondary);">
            ${policy.content}
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.settings-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  function markdownToHtml(text) {
    let html = text
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    html = html.replace(/^### (.*$)/gm, '<h4 style="margin: 12px 0 6px; font-size: 15px; color: var(--text);">$1</h4>');
    html = html.replace(/^## (.*$)/gm, '<h3 style="margin: 16px 0 8px; font-size: 16px; color: var(--text);">$1</h3>');
    html = html.replace(/^# (.*$)/gm, '<h2 style="margin: 20px 0 10px; font-size: 18px; color: var(--text);">$1</h2>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^\|(.+)\|$/gm, function(match, content) {
      const cells = content.split('|').map(c => c.trim());
      if (cells.length > 1) {
        return '<div style="display: grid; grid-template-columns: repeat(' + cells.length + ', 1fr); gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--border);">' + cells.map(c => '<div style="padding: 2px 4px;">' + c + '</div>').join('') + '</div>';
      }
      return match;
    });
    html = html.replace(/^- (.*$)/gm, '<p style="margin: 4px 0 4px 16px;">• $1</p>');
    html = html.replace(/^(\d+)\. (.*$)/gm, '<p style="margin: 4px 0 4px 16px;">$1. $2</p>');
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    return html;
  }

  function showLicenseDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'license-dialog';
    dialog.innerHTML = `
      <div class="license-header">
        <h3>MIT License</h3>
        <button class="dialog-close-btn" title="关闭">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
      <div class="license-content">
        <p>Copyright (c) 2026 wolfjkd</p>
        <p>Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:</p>
        <p>The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.</p>
        <p>THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.</p>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector('.dialog-close-btn').addEventListener('click', () => dialog.remove());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.remove();
    });
  }

  // ===== 启动 =====
  // 页面关闭前持久化剩余 aid
  window.addEventListener('beforeunload', () => {
    flushAidBuffer();
  });

  async function waitForApi(retries) {
    if (typeof pywebview !== 'undefined' && pywebview.api && typeof pywebview.api.fetch_initial === 'function') {
      // 优先从后端读取设置（打包后 localStorage 不稳定）
      try {
        if (window.pywebview && window.pywebview.api && window.pywebview.api.get_settings) {
          const backendSettings = await pywebview.api.get_settings();
          if (backendSettings) {
            const parsed = typeof backendSettings === 'string' ? JSON.parse(backendSettings) : backendSettings;
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
      alert('统计报告已输出到控制台\n按 F12 查看');
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      try { initThemeUI(); } catch (e) { console.warn('[theme]', e); }
      waitForApi(30);
    });
  } else {
    try { initThemeUI(); } catch (e) { console.warn('[theme]', e); }
    waitForApi(30);
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

  // ===== 对话框功能（原 ui-enhancements.js）=====

  // 数据源管理对话框
  async function showDataSourceDialog() {
    if (!window.pywebview || !window.pywebview.api) {
      alert('数据源管理需要 pywebview 后端支持，请稍后重试');
      return;
    }
    try {
      const resp = await pywebview.api.get_data_sources();
      const data = JSON.parse(resp);
      if (data.status !== 'ok') { alert('获取数据源失败'); return; }
      const sources = data.sources || [];
      const dialog = document.createElement('div');
      dialog.className = 'datasource-overlay';
      // 需要"配置"按钮的数据源
      const configableIds = ['tushare', 'wind'];
      dialog.innerHTML = `
        <div class="datasource-panel">
          <div class="datasource-header">
            <span class="datasource-title">数据源管理</span>
            <button class="dialog-close-btn" title="关闭">
              <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
          <div class="datasource-list">
            ${sources.map(s => `
              <div class="datasource-item" data-source-id="${s.id}">
                <div class="datasource-item-left">
                  <div class="datasource-status-dot ${s.enabled ? 'dot-on' : 'dot-off'}"></div>
                  <div class="datasource-info">
                    <div class="datasource-name">${esc(s.name)}</div>
                    <div class="datasource-desc">${esc(s.description || '')}</div>
                  </div>
                </div>
                <div class="datasource-item-right">
                  ${configableIds.includes(s.id) ? `<button class="datasource-config-btn" data-source-id="${s.id}">配置</button>` : ''}
                  <button class="datasource-test-btn" data-source-id="${s.id}">测试</button>
                  <label class="datasource-toggle">
                    <input type="checkbox" ${s.enabled ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
            `).join('')}
          </div>
          <div class="datasource-test-result"></div>
        </div>
      `;
      document.body.appendChild(dialog);
      dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });
      dialog.querySelector('.dialog-close-btn').addEventListener('click', () => dialog.remove());
      dialog.querySelectorAll('.datasource-toggle input').forEach(input => {
        input.addEventListener('change', async (e) => {
          const item = e.target.closest('.datasource-item');
          const sourceId = item.dataset.sourceId;
          const enabled = e.target.checked;
          try {
            const apiMethod = enabled ? 'enable_data_source' : 'disable_data_source';
            await pywebview.api[apiMethod](sourceId);
            item.querySelector('.datasource-status-dot').className = `datasource-status-dot ${enabled ? 'dot-on' : 'dot-off'}`;
          } catch (err) { alert('操作失败: ' + err.message); e.target.checked = !enabled; }
        });
      });
      dialog.querySelectorAll('.datasource-test-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const sourceId = btn.dataset.sourceId;
          const resultDiv = dialog.querySelector('.datasource-test-result');
          btn.disabled = true; btn.textContent = '测试中...';
          try {
            const resp = await pywebview.api.test_data_source(sourceId);
            const d = JSON.parse(resp); const r = d.result || {};
            resultDiv.textContent = `${r.success ? '✓' : '✗'} ${r.message || '连接失败'}${r.latency ? ' (' + r.latency + 'ms)' : ''}`;
            resultDiv.style.color = r.success ? '#4caf50' : '#f44336';
          } catch (err) { resultDiv.textContent = '测试失败: ' + err.message; resultDiv.style.color = '#f44336'; }
          btn.disabled = false; btn.textContent = '测试';
        });
      });
      // 配置按钮
      dialog.querySelectorAll('.datasource-config-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const sourceId = btn.dataset.sourceId;
          if (sourceId === 'tushare') showTushareConfigDialog();
          else if (sourceId === 'wind') showWindConfigDialog();
        });
      });
    } catch (e) { alert('数据源管理加载失败: ' + e.message); }
  }

  // ===== Tushare 配置弹窗 =====
  async function showTushareConfigDialog() {
    if (!window.pywebview || !window.pywebview.api) return;
    let currentData = null;
    try {
      const resp = await pywebview.api.get_tushare_config();
      currentData = JSON.parse(resp);
    } catch (e) { alert('加载 Tushare 配置失败: ' + e.message); return; }

    const dialog = document.createElement('div');
    dialog.className = 'datasource-overlay';
    dialog.innerHTML = `
      <div class="datasource-panel">
        <div class="datasource-header">
          <span class="datasource-title">Tushare 配置</span>
          <button class="dialog-close-btn" title="关闭">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div class="datasource-config-body">
          <div class="config-row">
            <label class="config-label">API Token</label>
            <input type="password" id="tushare-token-input" class="config-input" placeholder="粘贴 Tushare Pro Token" autocomplete="off">
            <div class="config-hint" id="tushare-token-hint">
              ${currentData.status === 'ok' && currentData.has_token ? '当前 Token: ' + esc(currentData.token_masked) : '尚未配置 Token'}
            </div>
          </div>
          <div class="config-actions">
            <button id="tushare-save-btn" class="config-save-btn">保存 Token</button>
            <button id="tushare-detect-btn" class="config-secondary-btn">检测接口权限</button>
          </div>
          <div class="config-row">
            <label class="config-label">可用接口</label>
            <div id="tushare-apis-list" class="config-apis">
              <div class="config-hint">点击"检测接口权限"按钮，自动探测 Token 可用的接口</div>
            </div>
          </div>
          <div class="config-tip">
            <div class="config-tip-title">提示</div>
            <div>· Token 获取：<a href="#" id="tushare-reg-link">tushare.pro</a> 注册后在个人主页复制</div>
            <div>· 免费权限：日线行情、股票基础信息</div>
            <div>· 高积分权限：财经新闻、资金流向、龙虎榜、涨停板</div>
            <div>· 接口按 Token 权限自动开放，无需手动选择</div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });
    dialog.querySelector('.dialog-close-btn').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#tushare-reg-link').addEventListener('click', (e) => {
      e.preventDefault();
      window.open('https://tushare.pro/register', '_blank');
    });
    // 保存 Token
    dialog.querySelector('#tushare-save-btn').addEventListener('click', async () => {
      const token = dialog.querySelector('#tushare-token-input').value.trim();
      if (!token) { alert('请输入 Token'); return; }
      try {
        const resp = await pywebview.api.save_tushare_token(token);
        const d = JSON.parse(resp);
        if (d.status === 'ok') {
          alert('Token 保存成功');
          // 刷新显示
          const cfgResp = await pywebview.api.get_tushare_config();
          const cfg = JSON.parse(cfgResp);
          if (cfg.status === 'ok') {
            dialog.querySelector('#tushare-token-hint').textContent = '当前 Token: ' + cfg.token_masked;
          }
          dialog.querySelector('#tushare-token-input').value = '';
        } else {
          alert('保存失败');
        }
      } catch (err) { alert('保存失败: ' + err.message); }
    });
    // 检测接口权限
    dialog.querySelector('#tushare-detect-btn').addEventListener('click', async () => {
      const apisDiv = dialog.querySelector('#tushare-apis-list');
      apisDiv.innerHTML = '<div class="config-hint">检测中...</div>';
      try {
        const resp = await pywebview.api.get_tushare_apis();
        const d = JSON.parse(resp);
        if (d.status === 'ok' && d.detected) {
          if (d.apis && d.apis.length > 0) {
            apisDiv.innerHTML = d.apis.map(a => `
              <div class="config-api-item">
                <span class="api-name">${esc(a.name)}</span>
                <span class="api-desc">${esc(a.desc)}</span>
              </div>
            `).join('');
          } else {
            apisDiv.innerHTML = '<div class="config-hint">未检测到可用接口，请检查 Token 权限</div>';
          }
        } else {
          apisDiv.innerHTML = '<div class="config-hint">' + esc(d.message || '检测失败') + '</div>';
        }
      } catch (err) {
        apisDiv.innerHTML = '<div class="config-hint">检测失败: ' + esc(err.message) + '</div>';
      }
    });
  }

  // ===== Wind 独立设置页弹窗 =====
  async function showWindConfigDialog() {
    if (!window.pywebview || !window.pywebview.api) return;
    let cfg = null;
    try {
      const resp = await pywebview.api.get_wind_config();
      const d = JSON.parse(resp);
      if (d.status === 'ok') cfg = d.config;
      else { alert('加载 Wind 配置失败: ' + (d.message || '')); return; }
    } catch (e) { alert('加载 Wind 配置失败: ' + e.message); return; }

    const modules = cfg.modules || {};
    const news = modules.news || {};
    const ann = modules.announcements || {};
    const macro = modules.macro || {};

    const dialog = document.createElement('div');
    dialog.className = 'datasource-overlay';
    dialog.innerHTML = `
      <div class="datasource-panel wind-panel">
        <div class="datasource-header">
          <span class="datasource-title">Wind 高级设置</span>
          <button class="dialog-close-btn" title="关闭">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div class="datasource-config-body wind-config-body">
          <!-- API Key -->
          <div class="config-section">
            <div class="config-section-title">API Key</div>
            <div class="config-row">
              <input type="password" id="wind-apikey-input" class="config-input" placeholder="粘贴 Wind API Key" autocomplete="off">
              <div class="config-hint" id="wind-apikey-hint">
                ${cfg.has_api_key ? '当前 Key: ' + esc(cfg.api_key_masked) : '尚未配置 API Key'}
              </div>
            </div>
            <div class="config-actions">
              <button id="wind-save-key-btn" class="config-save-btn">保存 Key</button>
            </div>
          </div>

          <!-- 额度 -->
          <div class="config-section">
            <div class="config-section-title">日额度</div>
            <div class="config-quota" id="wind-quota-display">
              <span>${cfg.daily_quota_used || 0} / ${cfg.daily_quota_limit || 500}</span>
              <span class="config-hint">(日期: ${esc(cfg.daily_quota_date || '未记录')})</span>
              <button id="wind-refresh-quota-btn" class="config-secondary-btn">刷新</button>
            </div>
          </div>

          <!-- 模块1: 财经新闻 -->
          <div class="config-section">
            <div class="config-section-title">
              <label class="datasource-toggle">
                <input type="checkbox" id="wind-news-enabled" ${news.enabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
              模块1：财经新闻 RAG
            </div>
            <div class="config-row">
              <label class="config-label">关键词（逗号分隔，最多 5 个）</label>
              <input type="text" id="wind-news-keywords" class="config-input" 
                     value="${esc((news.keywords || []).join(', '))}" 
                     placeholder="如: 半导体, 新能源, 央行">
            </div>
            <div class="config-row">
              <label class="config-label">每次返回条数 (top_k)</label>
              <input type="number" id="wind-news-topk" class="config-input" 
                     value="${news.top_k || 5}" min="1" max="20" style="width:80px">
            </div>
          </div>

          <!-- 模块2: 上市公司公告 -->
          <div class="config-section">
            <div class="config-section-title">
              <label class="datasource-toggle">
                <input type="checkbox" id="wind-ann-enabled" ${ann.enabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
              模块2：上市公司公告
            </div>
            <div class="config-row">
              <label class="config-label">关注股票（逗号分隔，留空则按公告类型）</label>
              <input type="text" id="wind-ann-stocks" class="config-input" 
                     value="${esc((ann.watch_stocks || []).join(', '))}" 
                     placeholder="如: 贵州茅台, 中国平安">
            </div>
            <div class="config-row">
              <label class="config-label">公告类型（逗号分隔）</label>
              <input type="text" id="wind-ann-types" class="config-input" 
                     value="${esc((ann.types || []).join(', '))}" 
                     placeholder="如: 定报, 重大事项, 分红">
            </div>
          </div>

          <!-- 模块3: 宏观经济指标 -->
          <div class="config-section">
            <div class="config-section-title">
              <label class="datasource-toggle">
                <input type="checkbox" id="wind-macro-enabled" ${macro.enabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
              模块3：宏观经济指标
            </div>
            <div class="config-row">
              <label class="config-label">监控指标（逗号分隔）</label>
              <input type="text" id="wind-macro-indicators" class="config-input" 
                     value="${esc((macro.indicators || []).join(', '))}" 
                     placeholder="如: CPI, PPI, PMI, 社融">
            </div>
          </div>

          <div class="config-actions config-actions-bottom">
            <button id="wind-save-modules-btn" class="config-save-btn">保存模块配置</button>
            <button id="wind-test-btn" class="config-secondary-btn">测试连接</button>
          </div>
          <div class="config-tip">
            <div class="config-tip-title">说明</div>
            <div>· API Key 获取：<a href="#" id="wind-portal-link">aifinmarket.wind.com.cn</a> 开发者中心</div>
            <div>· Wind 通过 MCP 协议直连，3 个模块独立开关、独立轮询</div>
            <div>· 公告每 5 轮、宏观每 10 轮抓取一次（按数据更新频率优化）</div>
            <div>· 日额度耗尽后将自动停止调用，次日重置</div>
          </div>
          <div class="wind-test-result"></div>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });
    dialog.querySelector('.dialog-close-btn').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#wind-portal-link').addEventListener('click', (e) => {
      e.preventDefault();
      window.open('https://aifinmarket.wind.com.cn/#/user/overview', '_blank');
    });
    // 保存 API Key
    dialog.querySelector('#wind-save-key-btn').addEventListener('click', async () => {
      const key = dialog.querySelector('#wind-apikey-input').value.trim();
      if (!key) { alert('请输入 API Key'); return; }
      try {
        const resp = await pywebview.api.save_wind_api_key(key);
        const d = JSON.parse(resp);
        if (d.status === 'ok') {
          alert('API Key 保存成功');
          const cfgResp = await pywebview.api.get_wind_config();
          const cfgD = JSON.parse(cfgResp);
          if (cfgD.status === 'ok') {
            dialog.querySelector('#wind-apikey-hint').textContent = '当前 Key: ' + cfgD.config.api_key_masked;
          }
          dialog.querySelector('#wind-apikey-input').value = '';
        } else { alert('保存失败'); }
      } catch (err) { alert('保存失败: ' + err.message); }
    });
    // 保存模块配置
    dialog.querySelector('#wind-save-modules-btn').addEventListener('click', async () => {
      const newsKeywords = dialog.querySelector('#wind-news-keywords').value
        .split(',').map(s => s.trim()).filter(s => s).slice(0, 5);
      const annStocks = dialog.querySelector('#wind-ann-stocks').value
        .split(',').map(s => s.trim()).filter(s => s);
      const annTypes = dialog.querySelector('#wind-ann-types').value
        .split(',').map(s => s.trim()).filter(s => s);
      const macroIndicators = dialog.querySelector('#wind-macro-indicators').value
        .split(',').map(s => s.trim()).filter(s => s);
      const modules = {
        news: {
          enabled: dialog.querySelector('#wind-news-enabled').checked,
          keywords: newsKeywords,
          top_k: parseInt(dialog.querySelector('#wind-news-topk').value) || 5,
        },
        announcements: {
          enabled: dialog.querySelector('#wind-ann-enabled').checked,
          watch_stocks: annStocks,
          types: annTypes,
        },
        macro: {
          enabled: dialog.querySelector('#wind-macro-enabled').checked,
          indicators: macroIndicators,
        },
      };
      try {
        const resp = await pywebview.api.save_wind_modules(JSON.stringify(modules));
        const d = JSON.parse(resp);
        if (d.status === 'ok') {
          alert('模块配置已保存');
        } else { alert('保存失败'); }
      } catch (err) { alert('保存失败: ' + err.message); }
    });
    // 刷新额度
    dialog.querySelector('#wind-refresh-quota-btn').addEventListener('click', async () => {
      try {
        const resp = await pywebview.api.get_wind_quota();
        const d = JSON.parse(resp);
        if (d.status === 'ok') {
          dialog.querySelector('#wind-quota-display').innerHTML = `
            <span>${d.used} / ${d.limit}</span>
            <span class="config-hint">(日期: ${esc(d.date)})</span>
            <button id="wind-refresh-quota-btn" class="config-secondary-btn">刷新</button>
          `;
          // 重新绑定刷新按钮
          dialog.querySelector('#wind-refresh-quota-btn').addEventListener('click', () => {
            dialog.querySelector('#wind-refresh-quota-btn').click();
          });
        }
      } catch (err) { alert('刷新失败: ' + err.message); }
    });
    // 测试连接
    dialog.querySelector('#wind-test-btn').addEventListener('click', async () => {
      const resultDiv = dialog.querySelector('.wind-test-result');
      const btn = dialog.querySelector('#wind-test-btn');
      btn.disabled = true; btn.textContent = '测试中...';
      try {
        const resp = await pywebview.api.test_data_source('wind');
        const d = JSON.parse(resp); const r = d.result || {};
        resultDiv.textContent = `${r.success ? '✓' : '✗'} ${r.message || '连接失败'}${r.latency ? ' (' + r.latency + 'ms)' : ''}`;
        resultDiv.style.color = r.success ? '#4caf50' : '#f44336';
      } catch (err) {
        resultDiv.textContent = '测试失败: ' + err.message;
        resultDiv.style.color = '#f44336';
      }
      btn.disabled = false; btn.textContent = '测试连接';
    });
  }

  // 绑定对话框按钮事件
  document.addEventListener('click', (e) => {
    if (e.target.closest('#btnDataSources')) showDataSourceDialog();
  });

  // ===== 更新检测功能 =====
  const $updateDialog = document.getElementById('updateDialog');
  const $urgentOverlay = document.getElementById('urgentOverlay');
  const $btnCheckUpdate = document.getElementById('btnCheckUpdate');
  const $btnUpdateLater = document.getElementById('btnUpdateLater');
  const $btnUpdateNow = document.getElementById('btnUpdateNow');
  const $btnUrgentUpdate = document.getElementById('btnUrgentUpdate');
  const $btnUrgentExit = document.getElementById('btnUrgentExit');

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
      if (window.pywebview && window.pywebview.api && window.pywebview.api.check_update) {
        const result = await pywebview.api.check_update();
        const data = JSON.parse(result);

        if (data.status === 'update_available') {
          if (data.urgent) {
            showUrgentOverlay(data);
          } else {
            showUpdateDialog(data);
          }
        } else if (data.status === 'latest') {
          alert('✅ 当前版本已是最新版本（' + (data.current_version || '') + '）');
        } else {
          // 错误提示更明确
          const msg = data.message || '未知错误';
          if (msg.includes('网络连接') || msg.includes('无法连接') || msg.includes('timeout')) {
            alert('❌ 检查更新失败：无法连接 GitHub\n\n请确认：\n1. 网络连接正常\n2. 代理工具（Clash/v2ray）已启动\n3. 代理端口可访问\n\n技术详情：' + msg);
          } else {
            alert('❌ 检查更新失败：' + msg);
          }
        }
      } else {
        alert('更新检查功能不可用');
      }
    } catch (e) {
      alert('检查更新异常: ' + e.message);
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
      if (window.pywebview && window.pywebview.api && window.pywebview.api.download_update) {
        const result = await pywebview.api.download_update();
        const data = JSON.parse(result);
        if (data.status === 'ok') {
          alert(data.message);
        } else {
          alert('下载失败: ' + (data.message || '未知错误'));
        }
      } else {
        alert('更新下载API不可用');
      }
    } catch (e) {
      alert('下载更新失败: ' + e.message);
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
      if (window.pywebview && window.pywebview.api && window.pywebview.api.exit_app) {
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
