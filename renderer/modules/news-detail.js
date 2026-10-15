/**
 * ztfi.newsDetail — 新闻/公告/研报详情弹窗
 *
 * 覆盖：showNewsDetail（点击详情 → 拉取后端正文 → 渲染，含遮罩/ESC 关闭）。
 * 接缝：host 仅 debugMode；utils：esc / apiHas / unwrapResult；后端走 window.pywebview。
 * 加载顺序：core → utils → … → news-detail → app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  let _host = null;
  function attach(host) { _host = host; }
  function H() { return _host; }
  function U() { return window.ztfi.utils; }

  // ===== 新闻详情弹窗 =====
  async function showNewsDetail(item) {
    // 加载状态
    const overlay = document.createElement('div');
    overlay.className = 'news-detail-overlay';
    overlay.innerHTML = `
      <div class="news-detail-panel">
        <div class="news-detail-header">
          <span class="detail-source">${U().esc(item.comefrom || '详情')}</span>
          <button class="news-detail-close">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="#e53935">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
        <div class="news-detail-body">
          <div class="detail-title">${U().esc(item.title || '')}</div>
          <div class="detail-time">${U().esc(item.ptime || '')}  ${U().esc(item.comefrom || '')}</div>
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
      if (H().debugMode) console.log('[详情] 请求详情, item keys:', Object.keys(item), 'art_code:', item.art_code, 'info_code:', item.info_code);
      let detailContent = '';
      if (item.art_code && U().apiHas('get_announcement_detail')) {
        if (H().debugMode) console.log('[详情] 调用 get_announcement_detail, art_code:', item.art_code);
        const resp = await pywebview.api.get_announcement_detail(item.art_code);
        if (H().debugMode) console.log('[详情] 公告详情返回:', resp);
        const data = U().unwrapResult(resp);
        if (data && data.status === 'ok' && data.content) {
          detailContent = data.content;
        }
      } else if (item.info_code && U().apiHas('get_research_detail')) {
        if (H().debugMode) console.log('[详情] 调用 get_research_detail, info_code:', item.info_code);
        const resp = await pywebview.api.get_research_detail(item.info_code);
        if (H().debugMode) console.log('[详情] 研报详情返回:', resp);
        const data = U().unwrapResult(resp);
        if (data && data.status === 'ok' && data.content) {
          detailContent = data.content;
        }
      } else {
        if (H().debugMode) console.log('[详情] 没有 art_code 或 info_code，无法请求详情');
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

  window.ztfi.newsDetail = {
    attach,
    showNewsDetail,
  };
})();
