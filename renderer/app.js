/**
 * 财经信息聚合播报 - 桌面端渲染进程
 * 
 * 架构：Python 后端抓取 + WebSocket 代理 → 前端渲染
 * 通过 pywebview.api 调用 Python 后端
 */

(function () {
  'use strict';

  // ===== 调试开关 =====
  const DEBUG_MODE = false; // 生产环境设为 false

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
  const MAX_RECENT = 80; // 只与最近80条比较，避免性能问题
  const MAX_DOM_ITEMS = 500; // 虚拟滚动：最多保留 DOM 节点数

  // ===== 设置 =====
  const ALL_SOURCES = [
    '财联社', '新浪财经', '东方财富', '同花顺', '华尔街见闻',
    '格隆汇', '选股宝', '科创板日报', '时报快讯', 'e公司',
    '北京商报', '人民财讯', '央视新闻', '新华社', '科创版日报'
  ];

  let settings = loadSettings();
  // 立即保存设置到文件（确保 Python 端能读取主题配置）
  try { saveSettings(); } catch(e) {}
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
  const $btnFavorites = null; // 已移除
  const $btnReview = null; // 已移除
  const $btnWatchlist = document.getElementById('btnWatchlist');
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
  const $showStocks = document.getElementById('showStocks');
  const $showRelated = document.getElementById('showRelated');
  const $hideDuplicates = document.getElementById('hideDuplicates');
  const $keywordHighlight = document.getElementById('keywordHighlight');
  const $keywordInputRow = document.getElementById('keywordInputRow');
  const $keywordInput = document.getElementById('keywordInput');
  const $keywordAddBtn = document.getElementById('keywordAddBtn');
  const $keywordTags = document.getElementById('keywordTags');
  const $keywordAlert = document.getElementById('keywordAlert');

  // ===== 初始化 =====
  async function init() {
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
  function handleNewsItem(item) {
    if (!item || !item.aid || seenAids.has(item.aid)) return;

    // 来源过滤
    const source = item.comefrom || '';
    if (settings.sources.length > 0 && source && !settings.sources.includes(source)) {
      seenAids.add(item.aid);
      newAidBuffer.push(item.aid);
      return;
    }

    seenAids.add(item.aid);
    newAidBuffer.push(item.aid);

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
    $newsList.prepend(el);
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

    // 语音播报
    if (settings.voiceEnabled && item.title) {
      enqueueVoice(item.title);
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

    let html = `
      <div class="news-header">
        <span class="news-time">${esc(timeStr)}</span>
        <button class="btn-favorite" data-aid="${item.aid}" title="收藏消息">
          <svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
        </button>
      </div>
      ${tagsHTML ? `<div class="news-tags">${tagsHTML}</div>` : ''}
      <div class="news-title ${titleClickable}">${esc(item.title || '')}${isDetailSource ? '<span class="news-detail-hint">▸详情</span>' : ''}</div>
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

    // 自选股匹配标记
    markWatchlistMatch(div, item);

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
    } catch (err) {
      console.error('收藏操作失败:', err);
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
      
      // 未分组的股票
      const ungroupedStocks = watchlist.filter(s => s.groupId === 'ungrouped' || !s.groupId);
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
      
      // 其他分组
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
            
            // 刷新对话框
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
  
  function createStockItemHTML(stock) {
    return `
      <div class="watchlist-item" data-code="${stock.code}">
        <button class="watchlist-remove-btn" title="移除自选股">×</button>
        <div class="watchlist-stock-info">
          <span class="watchlist-stock-name">${esc(stock.name || '未知')}</span>
          <span class="watchlist-stock-code">${esc(stock.code)}</span>
        </div>
        <button class="watchlist-move-btn" title="移动到分组">→</button>
        <button class="watchlist-quote-btn" title="查看行情">📊</button>
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
  let watchlistAlertLastTime = {}; // {code: timestamp} 记录每只股票上次提醒时间

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
    
    try {
      const watchlist = await window.historyStorage.getAllWatchlist();
      if (!watchlist || watchlist.length === 0) return;
      
      // 获取所有自选股代码
      const codes = watchlist.map(s => s.code);
      
      // 批量查询行情
      const batchResult = await batchGetQuotes(codes);
      if (!batchResult || batchResult.length === 0) return;
      
      const now = Date.now();
      const threshold = settings.watchlistAlertThreshold || 5;
      const intervalMs = (settings.watchlistAlertInterval || 5) * 60 * 1000;
      
      // 检查每只股票
      for (const q of batchResult) {
        if (!q || !q.quote) continue;
        
        const changePercent = Math.abs(q.quote.changePercent || 0);
        
        // 检查是否超过阈值
        if (changePercent >= threshold) {
          const code = q.quote.code;
          const lastTime = watchlistAlertLastTime[code] || 0;
          
          // 检查是否在冷却期内
          if (now - lastTime < intervalMs) {
            if (DEBUG_MODE) console.log(`[自选股提醒] ${code} 在冷却期内，跳过`);
            continue;
          }
          
          // 触发提醒
          watchlistAlertLastTime[code] = now;
          showWatchlistAlertPopup(q.quote);
        }
      }
    } catch (err) {
      if (DEBUG_MODE) console.error('[自选股提醒] 检查失败:', err);
    }
  }

  async function batchGetQuotes(codes) {
    if (!codes || codes.length === 0) return [];
    
    // 腾讯行情支持批量查询
    const tdxCodes = codes.map(code => {
      if (code.startsWith('6')) return `sh${code}`;
      if (code.startsWith(('0', '3'))) return `sz${code}`;
      if (code.startsWith(('8', '4'))) return `bj${code}`;
      return code;
    });
    
    const quotes = [];
    
    // 分批查询，每批最多20个
    const batchSize = 20;
    for (let i = 0; i < tdxCodes.length; i += batchSize) {
      const batch = tdxCodes.slice(i, i + batchSize);
      try {
        const resp = await fetch(`https://qt.gtimg.cn/q=${batch.join(',')}`);
        const text = await resp.text();
        
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

  function showWatchlistAlertPopup(quote) {
    const changePercent = quote.changePercent || 0;
    const change = quote.change || 0;
    const isUp = changePercent > 0;
    const direction = isUp ? '上涨' : '下跌';
    
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
        <div class="alert-message">${direction}幅度超过 ${settings.watchlistAlertThreshold}%</div>
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
      keywords: [],
      keywordAlert: false, // 关键词触发警报声
      keywordAlertKeywords: [], // 触发警报的关键词（可独立于高亮关键词）
      autoScroll: true, // 自动滚动状态
      isPinned: false, // 窗口置顶状态
      // 自选股异动提醒
      watchlistAlertEnabled: false,
      watchlistAlertThreshold: 5,
      watchlistAlertInterval: 5,
      watchlistAlertSound: true,
      darkMode: false,
    };
  }

  function saveSettings() {
    try {
      localStorage.setItem('guzhang-settings', JSON.stringify(settings));
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

    // 打开/关闭
    $btnSettings.addEventListener('click', () => {
      $settingsOverlay.classList.add('show');
    });

    $btnWatchlist.addEventListener('click', () => {
      showWatchlistDialog();
    });

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
  // 页面关闭前持久化剩余 aid
  window.addEventListener('beforeunload', () => {
    flushAidBuffer();
  });

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

  // ===== 对话框功能（原 ui-enhancements.js）=====

  // 导出对话框
  function showExportDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'export-dialog';
    dialog.innerHTML = `
      <div class="export-header">
        <h3>导出消息</h3>
        <button class="dialog-close-btn" title="关闭">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
      <div class="export-content">
        <div class="export-options">
          <div class="export-option">
            <input type="checkbox" id="exportAll" checked>
            <label for="exportAll">导出所有消息</label>
          </div>
          <div class="export-option">
            <input type="checkbox" id="exportPriority">
            <label for="exportPriority">仅导出重要消息</label>
          </div>
          <div class="export-option">
            <input type="checkbox" id="exportToday">
            <label for="exportToday">仅导出今日消息</label>
          </div>
        </div>
        <div class="export-format">
          <label>导出格式:</label>
          <select id="exportFormat">
            <option value="markdown">Markdown</option>
            <option value="json">JSON</option>
          </select>
        </div>
      </div>
      <div class="export-buttons">
        <button class="btn-export secondary" id="exportCancel">取消</button>
        <button class="btn-export primary" id="exportConfirm">导出</button>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector('.dialog-close-btn').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#exportCancel').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#exportConfirm').addEventListener('click', async () => {
      await executeExport(dialog);
      dialog.remove();
    });
  }

  async function executeExport(dialog) {
    if (!window.historyStorage) { alert('历史存储模块未加载'); return; }
    const options = {
      limit: dialog.querySelector('#exportAll').checked ? 10000 : 1000,
      priority: dialog.querySelector('#exportPriority').checked ? 'high' : null,
      startDate: dialog.querySelector('#exportToday').checked ? new Date().setHours(0, 0, 0, 0) : null
    };
    const format = dialog.querySelector('#exportFormat').value;
    try {
      const exportData = await window.historyStorage.exportMessages(options);
      let content, filename, mimeType;
      if (format === 'markdown') {
        content = window.historyStorage.generateMarkdownExport(exportData);
        filename = `guzhang-news-${new Date().toISOString().slice(0, 10)}.md`;
        mimeType = 'text/markdown';
      } else {
        content = JSON.stringify(exportData, null, 2);
        filename = `guzhang-news-${new Date().toISOString().slice(0, 10)}.json`;
        mimeType = 'application/json';
      }
      downloadFile(content, filename, mimeType);
    } catch (e) {
      alert('导出失败: ' + e.message);
    }
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // 历史搜索对话框
  function showHistoryDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'history-dialog';
    dialog.innerHTML = `
      <div class="history-header">
        <h3>历史消息搜索</h3>
        <button class="dialog-close-btn" title="关闭">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
      <div class="history-content">
        <div class="history-search">
          <input type="text" id="historySearchInput" placeholder="搜索关键词...">
          <button id="historySearchBtn">搜索</button>
        </div>
        <div class="history-filters">
          <select class="filter-select" id="historyCategory">
            <option value="">所有分类</option>
            <option value="政策">政策</option><option value="资金">资金</option>
            <option value="公司">公司</option><option value="宏观">宏观</option><option value="行业">行业</option>
          </select>
          <select class="filter-select" id="historyPriority">
            <option value="">所有优先级</option>
            <option value="critical">重磅</option><option value="high">重要</option>
            <option value="medium">关注</option><option value="low">一般</option>
          </select>
        </div>
      </div>
      <div class="history-results" id="historyResults"><div class="history-empty">输入关键词开始搜索...</div></div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector('.dialog-close-btn').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#historySearchBtn').addEventListener('click', () => executeHistorySearch(dialog));
    dialog.querySelector('#historySearchInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') executeHistorySearch(dialog); });
  }

  async function executeHistorySearch(dialog) {
    if (!window.historyStorage) { alert('历史存储模块未加载'); return; }
    const query = dialog.querySelector('#historySearchInput').value;
    const category = dialog.querySelector('#historyCategory').value;
    const priority = dialog.querySelector('#historyPriority').value;
    const options = { limit: 50, category: category || null, priority: priority || null };
    try {
      const results = await window.historyStorage.searchMessages(query, options);
      const container = dialog.querySelector('#historyResults');
      if (results.length === 0) { container.innerHTML = '<div class="history-empty">未找到匹配的消息</div>'; return; }
      container.innerHTML = results.map(msg => `
        <div class="history-item">
          <div class="history-item-title">${esc(msg.title)}</div>
          <div class="history-item-meta">
            <span>${new Date(msg.timestamp).toLocaleString()}</span>
            <span>${esc(msg.source)}</span>
            <span>${esc(msg.category)}</span>
          </div>
          <div class="history-item-content">${esc(msg.content)}</div>
        </div>
      `).join('');
    } catch (e) {
      alert('搜索失败: ' + e.message);
    }
  }

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
    } catch (e) { alert('数据源管理加载失败: ' + e.message); }
  }

  // 绑定对话框按钮事件
  document.addEventListener('click', (e) => {
    if (e.target.closest('#btnExport')) showExportDialog();
    if (e.target.closest('#btnHistory')) showHistoryDialog();
    if (e.target.closest('#btnDataSources')) showDataSourceDialog();
  });

})();
