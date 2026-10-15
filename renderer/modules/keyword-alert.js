/**
 * ztfi.keywordAlert — 关键词高亮 / 关键词警报 / 新闻分类
 *
 * 覆盖：addKeyword / removeKeyword / renderKeywordTags（关键词标签管理）、
 *       highlightElement / applyHighlightAll / removeHighlightAll（高亮渲染）、
 *       checkKeywordAlert / triggerAlert / playAlertSound / showKeywordNotification（命中警报）、
 *       classifyItem（新闻分类标注）。
 * 接缝：host = getSettings（每次取最新 settings）+ saveSettings + debugMode；
 *       utils esc；dom $keywordInput / $keywordTags / $newsList。
 * 加载顺序：core → utils → dom → … → keyword-alert → app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  let _host = null;
  function attach(host) { _host = host; }
  function H() { return _host; }
  function S() { return H().getSettings(); }
  function U() { return window.ztfi.utils; }
  function D() { return window.ztfi.dom; }

  // ===== 关键词高亮 =====
  function addKeyword() {
    const val = D().$keywordInput.value.trim();
    if (!val) return;
    if (S().keywords.includes(val)) {
      D().$keywordInput.value = '';
      return;
    }
    S().keywords.push(val);
    H().saveSettings();
    D().$keywordInput.value = '';
    renderKeywordTags();
    if (S().keywordHighlight) {
      applyHighlightAll();
    }
  }

  function removeKeyword(kw) {
    const s = S();
    s.keywords = s.keywords.filter(k => k !== kw);
    H().saveSettings();
    renderKeywordTags();
    // 重新应用高亮（去掉已删除的关键词）
    removeHighlightAll();
    if (s.keywordHighlight && s.keywords.length > 0) {
      applyHighlightAll();
    }
  }

  function renderKeywordTags() {
    const $keywordTags = D().$keywordTags;
    $keywordTags.innerHTML = '';
    S().keywords.forEach(kw => {
      const tag = document.createElement('span');
      tag.className = 'keyword-tag';
      tag.innerHTML = `<span class="kw-text">${U().esc(kw)}</span><span class="kw-remove" data-kw="${U().esc(kw)}">×</span>`;
      tag.querySelector('.kw-remove').addEventListener('click', () => removeKeyword(kw));
      $keywordTags.appendChild(tag);
    });
  }

  /**
   * 对一个 DOM 元素内的文本节点做关键词高亮
   * 用 TreeWalker 遍历所有文本节点，把匹配的部分用 <span class="kw-hl"> 包裹
   */
  function highlightElement(el) {
    const s = S();
    if (!s.keywordHighlight || s.keywords.length === 0) return;
    // 构建正则：把所有关键词用 | 连接，加 g 标志
    const escaped = s.keywords.map(kw => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
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
    const s = S();
    if (!s.keywordHighlight || s.keywords.length === 0) return;
    D().$newsList.querySelectorAll('.news-item').forEach(item => {
      highlightElement(item);
    });
  }

  /**
   * 移除所有高亮标记（把 .kw-hl 还原为纯文本）
   */
  function removeHighlightAll() {
    const $newsList = D().$newsList;
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
    const s = S();
    if (!s.keywordAlert) return;
    const alertKws = s.keywordAlertKeywords && s.keywordAlertKeywords.length > 0
      ? s.keywordAlertKeywords
      : s.keywords; // 如果没单独设置，用高亮关键词
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
      if (H().debugMode) console.warn('播放提醒音失败:', e);
    }
  }

  function showKeywordNotification(title, keyword) {
    // 创建浮层通知
    const notif = document.createElement('div');
    notif.className = 'kw-alert-notification';
    notif.innerHTML = `
      <div class="kw-alert-header">
        <span class="kw-alert-icon">🔔</span>
        <span class="kw-alert-title">关键词命中：${U().esc(keyword)}</span>
        <span class="kw-alert-close">&times;</span>
      </div>
      <div class="kw-alert-body">${U().esc(title || '')}</div>
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

  window.ztfi.keywordAlert = {
    attach,
    addKeyword,
    removeKeyword,
    renderKeywordTags,
    highlightElement,
    applyHighlightAll,
    removeHighlightAll,
    checkKeywordAlert,
    classifyItem,
    playAlertSound,
  };
})();
