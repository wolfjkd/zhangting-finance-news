/**
 * 鼓掌财经聚合消息 - 桌面端渲染进程
 * 
 * 架构：Python 后端抓取 + WebSocket 代理 → 前端渲染
 * 通过 pywebview.api 调用 Python 后端
 */

(function () {
  'use strict';

  // ===== 状态 =====
  let autoScroll = true;
  let isPinned = false;
  let newsCount = 0;
  let hiddenCount = 0;
  let oldestCtime = null;
  const seenAids = new Set();
  // 相似消息去重：记录最近显示的消息 { aid, title, el, sources, dupCount }
  const recentItems = [];
  const MAX_RECENT = 80; // 只与最近80条比较，避免性能问题

  // ===== 设置 =====
  const ALL_SOURCES = [
    '财联社', '新浪财经', '东方财富', '同花顺', '华尔街见闻',
    '格隆汇', '选股宝', '科创板日报', '时报快讯', 'e公司',
    '北京商报', '人民财讯', '央视新闻', '新华社', '科创版日报'
  ];

  let settings = loadSettings();
  let synth = window.speechSynthesis;
  let voiceList = [];
  let speaking = false;
  let voiceQueue = [];

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
  const $settingsOverlay = document.getElementById('settingsOverlay');
  const $settingsClose = document.getElementById('settingsClose');
  const $sourceList = document.getElementById('sourceList');
  const $voiceEnabled = document.getElementById('voiceEnabled');
  const $voiceSettings = document.getElementById('voiceSettings');
  const $voiceSelect = document.getElementById('voiceSelect');
  const $voiceTest = document.getElementById('voiceTest');
  const $voiceRate = document.getElementById('voiceRate');
  const $voiceSpeedRow = document.getElementById('voiceSpeedRow');
  const $showStocks = document.getElementById('showStocks');
  const $showRelated = document.getElementById('showRelated');
  const $hideDuplicates = document.getElementById('hideDuplicates');
  const $keywordHighlight = document.getElementById('keywordHighlight');
  const $keywordInputRow = document.getElementById('keywordInputRow');
  const $keywordInput = document.getElementById('keywordInput');
  const $keywordAddBtn = document.getElementById('keywordAddBtn');
  const $keywordTags = document.getElementById('keywordTags');

  // ===== 初始化 =====
  async function init() {
    setStatus('connecting', '正在获取数据...');
    try {
      const result = await pywebview.api.fetch_initial();
      const resp = typeof result === 'string' ? JSON.parse(result) : result;

      if (resp.status !== 'ok') {
        setStatus('error', '获取失败: ' + (resp.message || '未知错误'));
        $loading.classList.remove('show');
        setTimeout(init, 30000);
        return;
      }

      // 解析初始 HTML
      parseAndRenderHTML(resp.html);
      $loading.classList.remove('show');

      // 启动 WebSocket
      if (resp.token && resp.wsConfig) {
        setStatus('connecting', '正在连接实时推送...');
        await pywebview.api.start_ws();
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
  }

  // ===== 后端事件回调 =====
  window._onBackendEvent = function (event, data) {
    switch (event) {
      case 'ws_open':
        setStatus('connected', '已连接 · 实时推送中');
        break;
      case 'ws_message':
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed)) {
            parsed.forEach(item => handleNewsItem(item));
          } else if (parsed && typeof parsed === 'object' && parsed.ctime) {
            handleNewsItem(parsed);
          }
        } catch (e) {
          // ignore non-JSON
        }
        break;
      case 'ws_close':
        setStatus('error', '连接断开，重连中...');
        break;
      case 'ws_error':
        setStatus('error', '连接错误: ' + data);
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
  function handleNewsItem(item) {
    if (!item || !item.aid || seenAids.has(item.aid)) return;

    // 来源过滤
    const source = item.comefrom || '';
    if (settings.sources.length > 0 && source && !settings.sources.includes(source)) {
      seenAids.add(item.aid);
      return;
    }

    seenAids.add(item.aid);

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
    $newsList.prepend(el);
    newsCount++;

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

    // 语音播报
    if (settings.voiceEnabled && item.title) {
      enqueueVoice(item.title);
    }
  }

  // ===== 追加历史 =====
  function appendNewsItem(item) {
    // 来源过滤（初始加载不过滤，只过滤实时推送）

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

    const timeStr = item.ptime || formatTime(item.ctime);
    const source = item.comefrom || '';

    const riseClass = (rise) => {
      if (!rise) return '';
      const val = parseFloat(rise);
      if (val > 0) return 'up';
      if (val < 0) return 'down';
      return '';
    };

    let html = `
      <div class="news-header">
        <span class="news-time">${esc(timeStr)}</span>
        ${source ? `<span class="news-source">${esc(source)}</span>` : ''}
      </div>
      <div class="news-title">${esc(item.title || '')}</div>
    `;

    if (item.content) {
      html += `<div class="news-content" onclick="this.classList.toggle('expanded')">${esc(item.content)}</div>`;
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

    div.innerHTML = html;
    setTimeout(() => div.classList.remove('new-item'), 1500);

    // 关键词高亮
    if (settings.keywordHighlight && settings.keywords.length > 0) {
      highlightElement(div);
    }

    return div;
  }

  // ===== 加载更多 =====
  async function loadMore() {
    if (!oldestCtime) return;
    $loading.classList.add('show');

    try {
      const result = await pywebview.api.load_more(oldestCtime);
      const data = typeof result === 'string' ? JSON.parse(result) : result;

      if (data.status === 'ok' && Array.isArray(data.data) && data.data.length > 0) {
        data.data.forEach(item => {
          if (!seenAids.has(item.aid)) {
            seenAids.add(item.aid);
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

  function enqueueVoice(text) {
    if (!synth || !text) return;
    // 只播报标题，截断过长文本
    const speakText = text.length > 80 ? text.substring(0, 80) + '...' : text;
    voiceQueue.push(speakText);
    if (!speaking) {
      processVoiceQueue();
    }
  }

  function processVoiceQueue() {
    if (voiceQueue.length === 0) {
      speaking = false;
      return;
    }
    speaking = true;
    const text = voiceQueue.shift();
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

  // ===== 设置 =====
  function loadSettings() {
    try {
      const saved = localStorage.getItem('guzhang-settings');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {
      sources: [], // 空=全部显示
      voiceEnabled: false,
      voiceIndex: 0,
      voiceRate: 1.5,
      showStocks: true,
      showRelated: true,
      hideDuplicates: true,
      keywordHighlight: false,
      keywords: []
    };
  }

  function saveSettings() {
    try {
      localStorage.setItem('guzhang-settings', JSON.stringify(settings));
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

    $voiceEnabled.addEventListener('change', () => {
      settings.voiceEnabled = $voiceEnabled.checked;
      $voiceSettings.style.display = settings.voiceEnabled ? 'flex' : 'none';
      $voiceSpeedRow.style.display = settings.voiceEnabled ? 'flex' : 'none';
      saveSettings();
    });

    $voiceRate.value = settings.voiceRate;
    $voiceRate.addEventListener('change', () => {
      settings.voiceRate = parseFloat($voiceRate.value);
      saveSettings();
    });

    $voiceSelect.addEventListener('change', () => {
      settings.voiceIndex = parseInt($voiceSelect.value);
      saveSettings();
    });

    $voiceTest.addEventListener('click', () => {
      if (synth) {
        synth.cancel();
        const utter = new SpeechSynthesisUtterance('这是一条测试语音，鼓掌财经消息推送已开启。');
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

    // 打开/关闭
    $btnSettings.addEventListener('click', () => {
      $settingsOverlay.classList.add('show');
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
  $btnAutoscroll.addEventListener('click', () => {
    autoScroll = !autoScroll;
    $btnAutoscroll.classList.toggle('active', autoScroll);
    if (autoScroll) $container.scrollTop = 0;
  });

  $btnPin.addEventListener('click', () => {
    isPinned = !isPinned;
    $btnPin.classList.toggle('active', isPinned);
  });

  $btnLoadMore.addEventListener('click', loadMore);

  // ===== 授权系统 =====
  const $authOverlay        = document.getElementById('authOverlay');
  const $authTitle          = document.getElementById('authTitle');
  const $authDesc           = document.getElementById('authDesc');
  const $authOpenSettingsBtn= document.getElementById('authOpenSettingsBtn');
  const $authInfoValue      = document.getElementById('authInfoValue');
  const $authFingerprint    = document.getElementById('authFingerprint');
  const $btnCopyFingerprint = document.getElementById('btnCopyFingerprint');
  const $authKeyInput       = document.getElementById('authKeyInput');
  const $authActivateBtn    = document.getElementById('authActivateBtn');
  const $authHint           = document.getElementById('authHint');
  const $authStatus         = document.getElementById('authStatus');

  // 授权就绪回调（Python 后端注入 window._authInfo 后触发）
  window._onAuthReady = function () {
    const auth = window._authInfo;
    if (!auth) return;

    // 状态栏显示授权状态
    $authStatus.className = 'auth-status ' + auth.status;
    const statusLabels = {
      trial:         '⏱ ' + auth.message,
      licensed:      '✅ ' + auth.message,
      trial_expired: '❌ 试用到期',
      expired:       '❌ 授权无效',
    };
    $authStatus.textContent = statusLabels[auth.status] || auth.message;

    // 设置面板：当前状态
    $authInfoValue.className = 'auth-info-value ' + auth.status;
    $authInfoValue.textContent = auth.message;

    // 机器指纹
    $authFingerprint.textContent = auth.machineId || '--';

    // 试用到期 → 弹遮罩（遮罩里不再放激活输入，只提示去设置）
    if (auth.status === 'trial_expired' || auth.status === 'expired') {
      $authOverlay.style.display = 'flex';
      $authTitle.textContent = auth.status === 'trial_expired' ? '试用期已结束' : '授权验证失败';
      $authDesc.textContent  = auth.message + '，请在「设置 → 软件授权」中输入激活码';
    }
  };

  // 遮罩里的「打开设置」按钮
  $authOpenSettingsBtn.addEventListener('click', () => {
    $authOverlay.style.display = 'none';
    $settingsOverlay.classList.add('show');
    // 自动聚焦激活码输入框
    setTimeout(() => $authKeyInput.focus(), 200);
  });

  // 复制机器指纹
  $btnCopyFingerprint.addEventListener('click', () => {
    const text = $authFingerprint.textContent;
    if (!text || text === '--') return;
    navigator.clipboard.writeText(text).then(() => {
      $btnCopyFingerprint.textContent = '已复制';
      $btnCopyFingerprint.classList.add('copied');
      setTimeout(() => {
        $btnCopyFingerprint.textContent = '复制';
        $btnCopyFingerprint.classList.remove('copied');
      }, 1500);
    });
  });

  // 激活码输入：自动加横线
  $authKeyInput.addEventListener('input', () => {
    let v = $authKeyInput.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const parts = [];
    for (let i = 0; i < v.length && i < 20; i += 4) parts.push(v.substring(i, Math.min(i + 4, v.length)));
    $authKeyInput.value = parts.join('-');
    $authHint.textContent = '';
    $authHint.className = 'auth-hint';
  });

  $authActivateBtn.addEventListener('click', doActivate);
  $authKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doActivate();
  });

  async function doActivate() {
    const key = $authKeyInput.value.trim();
    if (key.length < 19) {
      $authHint.textContent = '请输入完整的激活码';
      $authHint.className = 'auth-hint error';
      return;
    }
    $authActivateBtn.disabled = true;
    $authActivateBtn.textContent = '验证中...';
    try {
      const result = await pywebview.api.activate_license(key);
      const resp = typeof result === 'string' ? JSON.parse(result) : result;
      if (resp.status === 'ok') {
        $authHint.textContent = '✅ 激活成功，正在刷新...';
        $authHint.className = 'auth-hint success';
        // 关闭遮罩（如果开着的话）
        $authOverlay.style.display = 'none';
        setTimeout(() => location.reload(), 1200);
      } else {
        $authHint.textContent = '❌ ' + (resp.message || '激活码无效');
        $authHint.className = 'auth-hint error';
      }
    } catch (err) {
      $authHint.textContent = '激活失败：' + err.message;
      $authHint.className = 'auth-hint error';
    }
    $authActivateBtn.disabled = false;
    $authActivateBtn.textContent = '激活';
  }

  // ===== 启动 =====
  function waitForApi(retries) {
    if (typeof pywebview !== 'undefined' && pywebview.api && typeof pywebview.api.fetch_initial === 'function') {
      init();
    } else if (retries > 0) {
      setTimeout(() => waitForApi(retries - 1), 300);
    } else {
      setStatus('error', '后端 API 未就绪');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => waitForApi(30));
  } else {
    waitForApi(30);
  }

})();
