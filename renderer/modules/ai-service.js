/**
 * ztfi.aiService — AI 解读（分析器 / 缓存 / 触发 / 结果渲染）
 *
 * 覆盖：window.aiAnalyzer（冻结接口，模块内挂 window）、getAiCache / setAiCache（本地缓存）、
 *       triggerAiAnalysis（缓存命中 + 频率限制 + 按钮态）、updateAiArea（结果渲染：情绪/置信度/AI摘要）。
 * 接缝：host = getSettings（每次取最新 settings）+ showToast；utils esc；
 *       后端走 window.pywebview；引导跳转走全局 window.openSettingsAtSection。
 * 加载顺序：core → utils → … → ai-service → app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  let _host = null;
  function attach(host) { _host = host; }
  function H() { return _host; }
  function S() { return H().getSettings(); }
  function U() { return window.ztfi.utils; }

  const AI_RATE_LIMIT = 3; // 每分钟最多3条
  const AI_CACHE_PREFIX = 'ai_result_';
  let aiAnalysisCount = 0; // 本分钟分析数量
  let aiAnalysisLastReset = Date.now(); // 上次重置时间

  // ===== AI分析器 =====
  window.aiAnalyzer = {
    async analyze(title, content, opts) {
      opts = opts || {};
      const isAuto = opts.isAuto === true;
      const s = S();
      if (!s.aiEnabled || !s.aiApiKey) {
        // 只在用户主动点击的场景弹引导提示；自动触发场景静默 return 避免打扰
        if (!isAuto) {
          H().showToast('AI 解读需要先配置 API 密钥', {
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
        const result = await window.pywebview.api.ai_analyze(
          title,
          content,
          'custom',
          s.aiApiKey,
          s.aiApiUrl || '',
          s.aiModelName || ''
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
      summaryEl.innerHTML = `📋 <span class="ai-summary-label">AI摘要：</span>${U().esc(result.summary)}`;
    }
  }

  window.ztfi.aiService = {
    attach,
    triggerAiAnalysis,
    updateAiArea,
    getAiCache,
    setAiCache,
  };
})();
