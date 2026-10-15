/**
 * ztfi.ui — 通用 UI 工具（toast / 状态栏 / 消息计数 / 虚拟滚动 / 加载更多 / aid 持久化）
 *
 * 覆盖：showToast（类型化提示 + 可选动作按钮）、setStatus（连接状态点）、
 *       updateCount（消息计数 + 时间戳 + 触发虚拟滚动/aid 批量持久化）、
 *       trimOldDomItems（超限移除最旧节点 + recentItems 裁剪）、
 *       flushAidBuffer（已读 aid 批量落库）、loadMore（向后端拉更早消息）。
 * 接缝：host = 计数 getter / 共享集合引用（seenAids / newAidBuffer / recentItems）+
 *       虚拟滚动上限（maxDomItems / maxRecent）；utils unwrapResult/p2；dom $loading/$newsCount/$lastUpdate/$newsList。
 * 加载顺序：core → utils → dom → … → ui-utils → app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  let _host = null;
  function attach(host) { _host = host; }
  function H() { return _host; }
  function U() { return window.ztfi.utils; }
  function D() { return window.ztfi.dom; }

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
    D().$statusDot.className = 'status-dot ' + state;
    D().$statusText.textContent = text;
  }

  function updateCount() {
    let text = `${H().getNewsCount()} 条消息`;
    const hiddenCount = H().getHiddenCount();
    if (hiddenCount > 0) {
      text += ` · 已隐藏 ${hiddenCount} 条相似`;
    }
    D().$newsCount.textContent = text;
    const d = new Date();
    D().$lastUpdate.textContent = `${U().p2(d.getHours())}:${U().p2(d.getMinutes())}:${U().p2(d.getSeconds())}`;

    // 虚拟滚动：超出上限时移除最旧的 DOM 节点
    trimOldDomItems();

    // 定期持久化已读 aid（每 50 条批量写一次）
    if (H().newAidBuffer.length >= 50) {
      flushAidBuffer();
    }
  }

  function trimOldDomItems() {
    const $newsList = D().$newsList;
    const children = $newsList.children;
    const maxDomItems = H().maxDomItems;
    if (children.length <= maxDomItems) return;
    const toRemove = children.length - maxDomItems;
    // 移除最旧的（列表末尾的）
    for (let i = 0; i < toRemove; i++) {
      const el = children[children.length - 1];
      if (el) $newsList.removeChild(el);
    }
    // 从 recentItems 中也清理
    const recentItems = H().recentItems;
    const maxRecent = H().maxRecent;
    if (recentItems.length > maxRecent) {
      recentItems.splice(0, recentItems.length - maxRecent);
    }
  }

  function flushAidBuffer() {
    const newAidBuffer = H().newAidBuffer;
    if (newAidBuffer.length === 0) return;
    const batch = newAidBuffer.splice(0, newAidBuffer.length);
    window.pywebview.api.persist_seen_aids(JSON.stringify(batch)).catch(() => {});
  }

  // ===== 加载更多 =====
  async function loadMore() {
    D().$loading.classList.add('show');

    try {
      const beforeTime = Math.floor(Date.now() / 1000) - 3600;
      const result = await window.pywebview.api.load_more(beforeTime);
      const data = U().unwrapResult(result);

      if (data.status === 'ok' && Array.isArray(data.data) && data.data.length > 0) {
        const seenAids = H().seenAids;
        const newAidBuffer = H().newAidBuffer;
        data.data.forEach(item => {
          if (!seenAids.has(item.aid)) {
            seenAids.add(item.aid);
            newAidBuffer.push(item.aid);
            window.ztfi.newsList.appendNewsItem(item);
          }
        });
        updateCount();
      }
    } catch (err) {
      console.error('加载更多失败:', err);
    }

    D().$loading.classList.remove('show');
  }

  window.ztfi.ui = {
    attach,
    showToast,
    setStatus,
    updateCount,
    trimOldDomItems,
    flushAidBuffer,
    loadMore,
  };
})();
