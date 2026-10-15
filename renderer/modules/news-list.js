/**
 * ztfi.newsList — 新闻列表渲染与去重子系统
 *
 * 职责：把「一条新闻」变成卡片 DOM（renderNewsItem）、维持去重与最近列表
 *       （findSimilarItem / appendDupBadge）、批量渲染初始 HTML（parseAndRenderHTML）、
 *       实时推送入口（handleNewsItem）与历史追加（appendNewsItem）。
 *
 * 接缝（seam）：本模块是「渲染层」，不再持有跨模块共享的原始状态。
 *   - 共享状态（newsCount / hiddenCount / oldestCtime / autoScroll）通过 host 的
 *     getter/setter 访问；集合类（recentItems / seenAids / newAidBuffer）以引用注入。
 *   - 设置通过 host.getSettings() 每次取最新（settings 会被重载/重置）。
 *   - 其余「留在 app.js」的能力（分类/统计/历史/计数/高亮/警报/收藏/详情/AI/自选股匹配/
 *     toast/语音）以回调钩子注入，避免把那些子系统也拖进来。
 * 加载顺序：core → utils → dom → settings-store → voice-service → news-list → … → app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  // ===== 依赖注入 =====
  let _host = null;
  function attach(host) { _host = host; }
  function H() { return _host; }
  function S() { return _host.getSettings() || {}; }
  function U() { return window.ztfi.utils; }
  function D() { return window.ztfi.dom; }

  // ===== 解析初始 HTML =====
  function parseAndRenderHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const items = doc.querySelectorAll('li.recent-news-item');

    items.forEach(li => {
      try {
        const aid = li.dataset.aid || '';
        if (!aid || H().seenAids.has(aid)) return;
        H().seenAids.add(aid);
        H().newAidBuffer.push(aid);

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
        const ptime = timeEl ? timeEl.textContent.trim() : U().formatTime(ctime);

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

    H().updateCount();
  }

  // ===== 处理实时推送 =====
  async function handleNewsItem(item) {
    if (!item || !item.aid || H().seenAids.has(item.aid)) return;

    // 延迟旧消息丢弃：上游（鼓掌财经等聚合源）有时会因为排队/积压/重试，
    // 把几分钟甚至更久之前的旧消息晚推过来。本项目是实时突发新闻播报工具，
    // 过时新闻没有实时指导意义，直接丢弃（老板 2026-10-15 拍板）。
    // 注意：丢弃前要先加入 seenAids，防止同一旧消息被重复尝试插入。
    if (item.ctime && typeof item.ctime === 'number') {
      const ageSec = Math.floor(Date.now() / 1000) - item.ctime;
      if (ageSec > H().staleThreshold) {
        H().seenAids.add(item.aid);
        H().newAidBuffer.push(item.aid);
        console.warn(`[stale] 丢弃延迟消息: age=${ageSec}s aid=${item.aid} title=${(item.title || '').slice(0, 40)}`);
        return;
      }
    }

    // 来源映射（用于相似消息去重徽章 appendDupBadge，不再做显示过滤）
    // 注：原 settings.sources 显示过滤闸已于 2026-10-15 移除——
    // 数据源管理开关已精确表达用户意愿，前端不再加第二道闸。
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

    H().seenAids.add(item.aid);
    H().newAidBuffer.push(item.aid);

    H().recordSourceStats(item);

    // 新闻分类
    H().classifyItem(item);

    // === 相似消息去重 ===
    const similar = findSimilarItem(item.title);
    if (similar) {
      // 隐藏这条，追加到已有消息上
      H().setHiddenCount(H().getHiddenCount() + 1);
      appendDupBadge(similar, source);
      H().updateCount();
      return;
    }

    const el = renderNewsItem(item);

    if (item.is_x_priority || (item.comefrom && item.comefrom.includes('Twitter'))) {
      const firstNonX = D().$newsList.querySelector('.news-item:not(.x-priority)');
      if (firstNonX) {
        D().$newsList.insertBefore(el, firstNonX);
      } else {
        D().$newsList.prepend(el);
      }
      el.classList.add('x-priority');
    } else {
      D().$newsList.prepend(el);
    }
    H().setNewsCount(H().getNewsCount() + 1);

    // 存储到历史
    H().storeToHistory(item);

    // 记录到最近列表
    const record = { aid: item.aid, title: item.title || '', el: el, sources: [], dupCount: 1 };
    if (source) record.sources.push(source);
    H().recentItems.push(record);
    while (H().recentItems.length > H().maxRecent) H().recentItems.shift();

    if (!H().getOldestCtime() || item.ctime < H().getOldestCtime()) {
      H().setOldestCtime(item.ctime);
    }

    H().updateCount();

    if (H().isAutoScroll()) {
      requestAnimationFrame(() => {
        D().$container.scrollTop = 0;
      });
    }

    // 语音播报（按来源过滤 + 关键词/自选股强制播报）
    if (S().voiceEnabled && item.title) {
      if (H().shouldAnnounce(item)) {
        H().enqueueVoice(item.title, item.ctime);
      }
    }
  }

  // ===== 追加历史 =====
  function appendNewsItem(item) {
    // 来源过滤（初始加载不过滤，只过滤实时推送）

    // 新闻分类
    H().classifyItem(item);

    // === 相似消息去重（历史加载也做） ===
    const similar = findSimilarItem(item.title);
    if (similar) {
      H().setHiddenCount(H().getHiddenCount() + 1);
      appendDupBadge(similar, item.comefrom || '');
      H().updateCount();
      return;
    }

    const el = renderNewsItem(item);
    D().$newsList.appendChild(el);
    H().setNewsCount(H().getNewsCount() + 1);

    // 记录到最近列表
    const record = { aid: item.aid, title: item.title || '', el: el, sources: [], dupCount: 1 };
    const src = item.comefrom || '';
    if (src) record.sources.push(src);
    H().recentItems.push(record);
    while (H().recentItems.length > H().maxRecent) H().recentItems.shift();

    if (!H().getOldestCtime() || item.ctime < H().getOldestCtime()) {
      H().setOldestCtime(item.ctime);
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

    const timeStr = item.ptime || U().formatTime(item.ctime);
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

    // AI区域HTML（未配置 API 密钥时按钮灰显 + 点击仍可弹引导）
    const st = S();
    const aiReady = !!(st.aiEnabled && st.aiApiKey);
    const aiBtnStyle = aiReady
      ? ''
      : 'style="opacity:0.45;" title="未配置 API 密钥，点击去配置"';
    let aiAreaHTML = `<div class="ai-area">
      <button class="btn-ai-interpret ${aiReady ? '' : 'btn-ai-not-ready'}" data-aid="${item.aid}" ${aiBtnStyle}>AI解读</button>
    </div>`;

    let html = `
      <div class="news-header">
        <span class="news-time">${U().esc(timeStr)}</span>
        <div class="news-header-right">
          ${aiAreaHTML}
        </div>
      </div>
      ${tagsHTML ? `<div class="news-tags">${tagsHTML}</div>` : ''}
      <div class="news-title ${titleClickable}">
        <span class="news-title-text">${U().esc(item.title || '')}${isDetailSource ? '<span class="news-detail-hint">▸详情</span>' : ''}</span>
        <button class="btn-favorite" data-aid="${item.aid}" title="收藏消息">
          <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        </button>
      </div>
    `;

    if (item.content) {
      html += `<div class="news-content" onclick="this.classList.toggle('expanded')">${U().esc(item.content)}</div>`;
    }

    if (item.images && item.images.length > 0) {
      html += '<div class="news-images">';
      item.images.forEach(imgUrl => {
        html += `<img src="${U().esc(imgUrl)}" class="news-image" alt="图片" />`;
      });
      html += '</div>';
    }

    if (st.showStocks && item.stocks && item.stocks.length > 0) {
      html += '<div class="news-stocks">';
      item.stocks.forEach(s => {
        const rc = riseClass(s.rise);
        html += `<span class="stock-tag">
          <span class="stock-name">${U().esc(s.name)}</span>
          ${s.rise ? `<span class="stock-rise ${rc}">${U().esc(s.rise)}%</span>` : ''}
        </span>`;
      });
      html += '</div>';
    }

    if (st.showRelated && item.child && item.child.length > 0) {
      html += '<div class="news-related">';
      item.child.slice(0, 3).forEach(c => {
        html += `<div class="related-item">${U().esc(c)}</div>`;
      });
      html += '</div>';
    }

    // 来源标签放到内容左下方
    if (source) {
      html += `<div class="news-footer"><span class="news-source">${U().esc(source)}</span></div>`;
    }

    div.innerHTML = html;
    setTimeout(() => div.classList.remove('new-item'), 1500);

    // 关键词高亮
    if (st.keywordHighlight && st.keywords.length > 0) {
      H().highlightElement(div);
    }

    // 关键词触发警报
    H().checkKeywordAlert(item.title, item.content);

    // 可点击展开详情（东方财富公告/券商研报）
    if (isDetailSource) {
      const titleEl = div.querySelector('.news-title');
      if (titleEl) {
        titleEl.addEventListener('click', () => H().showNewsDetail(item));
      }
    }

    // 收藏按钮事件
    const favBtn = div.querySelector('.btn-favorite');
    if (favBtn) {
      // 检查是否已收藏
      H().checkFavoriteStatus(item.aid, favBtn);
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        H().toggleFavorite(item, favBtn);
      });
    }

    // AI分析功能
    const aiBtn = div.querySelector('.btn-ai-interpret');
    if (aiBtn) {
      // 检查是否已有AI分析结果
      if (item.aiResult) {
        H().updateAiArea(div, item.aiResult);
      }
      aiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // 未配置 API 密钥时点按钮直接弹引导，不进入分析流程
        if (aiBtn.classList.contains('btn-ai-not-ready')) {
          H().showToast('AI 解读需要先配置 API 密钥', {
            type: 'warning',
            action: {
              label: '去配置',
              callback: () => window.openSettingsAtSection('ai')
            }
          });
          return;
        }
        H().triggerAiAnalysis(item, div);
      });
    }

    // 检查是否应该自动触发AI分析
    // 关键：必须先检查 AI 是否启用 + API Key 是否配置，
    // 否则没配 key 的用户会被"重要"级新闻随机触发后弹 toast 打扰
    if (window.newsClassifier && window.aiAnalyzer) {
      if (!st.aiEnabled || !st.aiApiKey) {
        // AI 未启用或未配置——不自动触发，跳过后续分类判定
      } else {
        const text = (item.title || '') + ' ' + (item.content || '');
        if (item.classification && window.newsClassifier.shouldAutoTriggerAI(item.classification, text)) {
          // 检查是否已有分析结果
          if (!item.aiResult) {
            H().triggerAiAnalysis(item, div, true);
          }
        }
      }
    }

    // 自选股匹配标记
    H().markWatchlistMatch(div, item);

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
          H().showToast('已复制到剪贴板');
        }).catch(() => {
          const textarea = document.createElement('textarea');
          textarea.value = text.trim();
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          removeMenu();
          H().showToast('已复制到剪贴板');
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

  /**
   * 查找与新消息标题相似的已有消息
   * 返回 { match: recentItem } 或 null
   */
  function findSimilarItem(title) {
    if (!S().hideDuplicates || !title) return null;
    // 阈值：0.55 对财经标题比较合适（允许措辞微调但同一事件能匹配）
    const THRESHOLD = 0.55;
    for (let i = H().recentItems.length - 1; i >= 0; i--) {
      const ri = H().recentItems[i];
      if (U().titleSimilarity(title, ri.title) >= THRESHOLD) {
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

  window.ztfi.newsList = {
    attach,
    parseAndRenderHTML,
    handleNewsItem,
    appendNewsItem,
    renderNewsItem,
    findSimilarItem,
    appendDupBadge,
  };
})();
