/**
 * ztfi.favoritesSearch — 收藏与历史搜索
 *
 * 覆盖：checkFavoriteStatus（收藏状态回填）/ toggleFavorite（收藏切换）/ updateFavoritesBadge（徽章）/
 *       loadFavorites（收藏列表对话框）/ performSearch（历史搜索对话框）。
 * 接缝：数据层由 window.historyStorage 承载；host 仅 showToast + debugMode；
 *       DOM 走 window.ztfi.dom，esc/formatTime 走 utils。
 * 加载顺序：core → utils → dom → … → favorites-search → app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  const DOM = window.ztfi.dom;

  let _host = null;
  function attach(host) { _host = host; }
  function H() { return _host; }
  function U() { return window.ztfi.utils; }

  // ===== 收藏功能 =====
  async function checkFavoriteStatus(messageId, btn) {
    if (!window.historyStorage) return;
    try {
      const isFav = await window.historyStorage.isFavorite(messageId);
      if (isFav) {
        btn.classList.add('favorited');
      }
    } catch (err) {
      if (H().debugMode) console.warn('检查收藏状态失败:', err);
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
        if (H().debugMode) console.log('取消收藏:', item.title);
      } else {
        await window.historyStorage.addFavorite(item);
        btn.classList.add('favorited');
        if (H().debugMode) console.log('已收藏:', item.title);
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
      if (DOM.$favoritesBadge) {
        if (count > 0) {
          DOM.$favoritesBadge.textContent = count;
          DOM.$favoritesBadge.style.display = 'inline-block';
        } else {
          DOM.$favoritesBadge.style.display = 'none';
        }
      }
    } catch (err) {
      if (H().debugMode) console.warn('更新收藏徽章失败:', err);
    }
  }

  async function loadFavorites() {
    if (!window.historyStorage) return;
    try {
      const favorites = await window.historyStorage.getAllFavorites();

      if (!favorites || favorites.length === 0) {
        DOM.$favoritesList.innerHTML = '<div class="favorites-empty">暂无收藏消息</div>';
        return;
      }

      DOM.$favoritesList.innerHTML = favorites.map(fav => `
        <div class="favorite-item" data-id="${fav.id}">
          <div class="fav-title">${U().esc(fav.title)}</div>
          <div class="fav-meta">${fav.source || ''} · ${U().formatTime(fav.timestamp)}</div>
          <div class="fav-actions">
            <button class="btn-fav-copy">复制</button>
            <button class="btn-fav-remove">取消收藏</button>
          </div>
        </div>
      `).join('');

      DOM.$favoritesList.querySelectorAll('.btn-fav-copy').forEach((btn, idx) => {
        btn.addEventListener('click', () => {
          const fav = favorites[idx];
          const text = `${fav.title}\n${fav.content || ''}\n来源: ${fav.source || ''}`;
          navigator.clipboard.writeText(text.trim()).then(() => {
            H().showToast('已复制到剪贴板');
          }).catch(() => {
            const textarea = document.createElement('textarea');
            textarea.value = text.trim();
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            H().showToast('已复制到剪贴板');
          });
        });
      });

      DOM.$favoritesList.querySelectorAll('.btn-fav-remove').forEach((btn, idx) => {
        btn.addEventListener('click', async () => {
          const fav = favorites[idx];
          await window.historyStorage.removeFavorite(fav.id);
          updateFavoritesBadge();
          loadFavorites();
          H().showToast('已取消收藏');
        });
      });
    } catch (err) {
      console.error('加载收藏失败:', err);
      DOM.$favoritesList.innerHTML = '<div class="favorites-empty">加载失败</div>';
    }
  }

  async function performSearch() {
    if (!window.historyStorage) return;

    const query = DOM.$searchInput.value.trim();
    const category = DOM.$searchCategory.value || null;
    const priority = DOM.$searchPriority.value || null;

    try {
      DOM.$searchResults.innerHTML = '<div class="search-empty">搜索中...</div>';

      const results = await window.historyStorage.searchMessages(query, {
        limit: 50,
        category,
        priority
      });

      if (!results || results.length === 0) {
        DOM.$searchResults.innerHTML = '<div class="search-empty">未找到匹配的消息</div>';
        return;
      }

      DOM.$searchResults.innerHTML = results.map(msg => `
        <div class="search-result-item" data-id="${msg.id}">
          <div class="result-title">${U().esc(msg.title)}</div>
          <div class="result-meta">${msg.source || ''} · ${U().formatTime(msg.timestamp)} · ${msg.category || ''}</div>
        </div>
      `).join('');

      DOM.$searchResults.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
          DOM.$searchDialog.style.display = 'none';
        });
      });
    } catch (err) {
      console.error('搜索失败:', err);
      DOM.$searchResults.innerHTML = '<div class="search-empty">搜索出错</div>';
    }
  }

  window.ztfi.favoritesSearch = {
    attach,
    checkFavoriteStatus,
    toggleFavorite,
    updateFavoritesBadge,
    loadFavorites,
    performSearch,
  };
})();
