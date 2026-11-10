/**
 * ztfi.favoritesStore — 收藏存储
 *
 * 架构 #1（审计）：自 history-storage.js 拆出。favorites objectStore 的全部读写
 * + 后端写穿同步（persist_favorites / get_favorites 回灌）。
 * DB 连接经 ztfi.idbCore.ensureDB() 取用。
 * 加载顺序：idb-core 之后、app.js 之前（四模块末位）。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  const ZTFI_HS_DEBUG = false; // 调试日志开关（原 history-storage 文件级开关随拆分入各 IIFE）

  /**
   * 添加收藏
   */
  async function addFavorite(message) {
    const db = await window.ztfi.idbCore.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['favorites'], 'readwrite');
      const store = transaction.objectStore('favorites');

      const favData = {
        id: message.aid || message.id || Date.now().toString(),
        aid: message.aid,
        title: message.title,
        content: message.content || '',
        source: message.comefrom || message.source,
        timestamp: message.ctime || message.timestamp || Date.now(),
        category: message.category || '未分类',
        priority: message.priority || 'low',
        stocks: message.stocks || [],
        keywords: message.keywords || [],
        favoritedAt: Date.now() // 收藏时间
      };

      const request = store.put(favData);

      request.onsuccess = () => {
        if (ZTFI_HS_DEBUG) console.log('消息已收藏:', favData.title);
        // 写穿同步到后端（%APPDATA%/ZTFINews/favorites.json）：IndexedDB 随 WebView2
        // 用户数据目录清理而丢，关键收藏必须有后端持久化通道
        syncFavoritesToBackend();
        resolve(true);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 移除收藏
   */
  async function removeFavorite(messageId) {
    const db = await window.ztfi.idbCore.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['favorites'], 'readwrite');
      const store = transaction.objectStore('favorites');

      const request = store.delete(messageId);

      request.onsuccess = () => {
        if (ZTFI_HS_DEBUG) console.log('收藏已移除:', messageId);
        syncFavoritesToBackend();
        resolve(true);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 检查是否已收藏
   */
  async function isFavorite(messageId) {
    const db = await window.ztfi.idbCore.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['favorites'], 'readonly');
      const store = transaction.objectStore('favorites');

      const request = store.get(messageId);

      request.onsuccess = (event) => {
        resolve(event.target.result !== undefined);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 获取所有收藏
   */
  async function getAllFavorites(options = {}) {
    const db = await window.ztfi.idbCore.ensureDB();

    const { limit = 100, offset = 0 } = options;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['favorites'], 'readonly');
      const store = transaction.objectStore('favorites');

      const results = [];
      const request = store.index('timestamp').openCursor(null, 'prev');

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && results.length < limit + offset) {
          if (results.length >= offset) {
            results.push(cursor.value);
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 获取收藏数量
   */
  async function getFavoritesCount() {
    const db = await window.ztfi.idbCore.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['favorites'], 'readonly');
      const store = transaction.objectStore('favorites');

      const request = store.count();

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  // ===== 后端写穿同步与回灌 =====

  async function syncFavoritesToBackend() {
    try {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.persist_favorites) {
        const favorites = await getAllFavorites({ limit: 1000, offset: 0 });
        await pywebview.api.persist_favorites(JSON.stringify(favorites));
      }
    } catch (e) {
      console.warn('同步收藏到后端失败:', e);
    }
  }

  /**
   * 导入收藏（启动回灌用，put 按主键合并）
   */
  async function importFavorites(favorites) {
    const db = await window.ztfi.idbCore.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['favorites'], 'readwrite');
      const store = transaction.objectStore('favorites');

      for (const fav of favorites) {
        store.put(fav);
      }
      transaction.oncomplete = () => {
        resolve(favorites.length);
      };
      transaction.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  window.ztfi.favoritesStore = {
    addFavorite,
    removeFavorite,
    isFavorite,
    getAllFavorites,
    getFavoritesCount,
    syncToBackend: syncFavoritesToBackend,
    importFavorites,
  };
})();
