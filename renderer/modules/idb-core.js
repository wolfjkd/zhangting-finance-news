/**
 * ztfi.idbCore — IndexedDB 核心：连接/升级 + 消息存储 + 生命周期清理
 *
 * 架构 #1（审计）：原 history-storage.js（1415 行 / 6 个 objectStore / 43 方法）按
 * 限界上下文拆为 idb-core / history-search / watchlist-store / favorites-store 四模块，
 * 聚合门面 = window.ztfi.historyStorage（惰性转发，见本文件尾部）。
 *
 * 接缝：本模块持唯一的 DB 连接，其余三模块经 ensureDB() 取用；
 *       initFromBackend 为启动回灌编排器，跨调 watchlist-store / favorites-store。
 * 加载顺序：core → utils → dom → … → idb-core → history-search → watchlist-store → favorites-store → app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  const ZTFI_HS_DEBUG = false; // 调试日志开关（原 history-storage 文件级开关随拆分入各 IIFE）

  const DB_NAME = 'ZTFINewsHistory';
  const DB_VERSION = 5; // 升级版本以添加自选股预警阈值
  const MAX_RECORDS = 10000; // 最大存储记录数
  const CLEANUP_THRESHOLD = 12000; // 清理阈值

  let _db = null;

  /**
   * 打开数据库（含全部 objectStore/索引创建；searchIndex 已停写但保留建店以兼容老库版本路径）
   */
  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 创建消息存储
        if (!db.objectStoreNames.contains('messages')) {
          const store = db.createObjectStore('messages', { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('aid', 'aid', { unique: true });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('priority', 'priority', { unique: false });
        }

        // 创建收藏存储
        if (!db.objectStoreNames.contains('favorites')) {
          const favStore = db.createObjectStore('favorites', { keyPath: 'id' });
          favStore.createIndex('timestamp', 'timestamp', { unique: false });
          favStore.createIndex('aid', 'aid', { unique: false });
        }

        // 创建全文索引存储（词索引已停写——审计 #18；保留建店防老库升级路径变化）
        if (!db.objectStoreNames.contains('searchIndex')) {
          const indexStore = db.createObjectStore('searchIndex', { keyPath: 'id', autoIncrement: true });
          indexStore.createIndex('word', 'word', { unique: false });
          indexStore.createIndex('messageId', 'messageId', { unique: false });
        }

        // 创建自选股存储
        if (!db.objectStoreNames.contains('watchlist')) {
          const watchStore = db.createObjectStore('watchlist', { keyPath: 'code' });
          watchStore.createIndex('addedAt', 'addedAt', { unique: false });
          watchStore.createIndex('groupId', 'groupId', { unique: false });
        }

        // 创建自选股分组存储
        if (!db.objectStoreNames.contains('watchlistGroups')) {
          const groupStore = db.createObjectStore('watchlistGroups', { keyPath: 'id' });
          groupStore.createIndex('order', 'order', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        _db = event.target.result;
        resolve(_db);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 取 DB 连接（未开则先开）
   */
  async function ensureDB() {
    if (!_db) await openDB();
    return _db;
  }

  /**
   * 批量存储消息（性能优化）
   */
  async function storeMessagesBatch(messages) {
    const db = await ensureDB();
    if (!messages || messages.length === 0) return 0;

    return new Promise((resolve, reject) => {
      // searchIndex 已停写（审计 #18）
      const transaction = db.transaction(['messages'], 'readwrite');
      const messagesStore = transaction.objectStore('messages');

      let processed = 0;
      let error = null;

      transaction.oncomplete = () => {
        if (error) reject(error);
        else resolve(processed);
      };

      transaction.onerror = (event) => {
        reject(event.target.error);
      };

      messages.forEach(message => {
        const messageData = {
          id: message.aid || Date.now().toString() + '_' + processed,
          aid: message.aid,
          title: message.title,
          content: message.content || '',
          source: message.comefrom,
          timestamp: message.ctime || Date.now(),
          category: message.category || '未分类',
          priority: message.priority || 'low',
          stocks: message.stocks || [],
          keywords: message.keywords || [],
          classification: message.classification || {}
        };

        messagesStore.put(messageData);

        processed++;
      });

      // 检查是否需要清理
      if (processed > 0) {
        checkAndCleanup();
      }
    });
  }

  /**
   * 检查并清理旧数据
   * 优化（审计 #19）：原走 getStatistics 全 cursor 扫描，实时流下每条消息一次全表
   * 扫描呈 O(N²)；本方法只需 total，改用 count() 并加 5 分钟节流。
   */
  async function checkAndCleanup() {
    const db = await ensureDB();

    const now = Date.now();
    if (checkAndCleanup._last && now - checkAndCleanup._last < 300000) return;
    checkAndCleanup._last = now;

    try {
      const total = await new Promise((resolve, reject) => {
        const tx = db.transaction(['messages'], 'readonly');
        const req = tx.objectStore('messages').count();
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
      });
      if (total > CLEANUP_THRESHOLD) {
        await cleanupOldMessages(total - MAX_RECORDS);
      }
    } catch (e) {
      console.warn('清理历史消息失败:', e);
    }
  }

  /**
   * 清理旧消息
   */
  async function cleanupOldMessages(count) {
    const db = await ensureDB();
    if (count <= 0) return 0;

    return new Promise((resolve, reject) => {
      // searchIndex 已停写（审计 #18）
      const transaction = db.transaction(['messages'], 'readwrite');
      const messagesStore = transaction.objectStore('messages');

      // 获取最旧的消息
      const request = messagesStore.index('timestamp').openCursor();
      let deleted = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && deleted < count) {
          // 删除消息
          cursor.delete();

          deleted++;
          cursor.continue();
        } else {
          if (ZTFI_HS_DEBUG) console.log(`清理了 ${deleted} 条旧消息`);
          resolve(deleted);
        }
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 删除过期消息（清理内存占用；原版附带清扫已停写的 searchIndex 残留——审计 #18 后仅操作 messages）
   */
  async function deleteOldMessages(cutoffTime) {
    const db = await ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['messages'], 'readwrite');
      const messagesStore = transaction.objectStore('messages');

      let deletedCount = 0;

      const index = messagesStore.index('timestamp');
      const request = index.openCursor(null, 'next');

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.timestamp < cutoffTime) {
            cursor.delete();
            deletedCount++;
            cursor.continue();
          } else {
            cursor.continue();
          }
        } else {
          resolve(deletedCount);
        }
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 启动回灌编排：后端（%APPDATA%/ZTFINews/*.json）→ IndexedDB。
   * 自选股/分组与收藏分别委托 watchlist-store / favorites-store。
   */
  async function initFromBackend() {
    try {
      if (window.pywebview && window.pywebview.api) {
        const backendWatchlist = await pywebview.api.get_watchlist();
        const backendGroups = await pywebview.api.get_watchlist_groups();

        const hasWatchlist = backendWatchlist &&
          (typeof backendWatchlist === 'string' ? JSON.parse(backendWatchlist) : backendWatchlist).length > 0;

        const hasGroups = backendGroups &&
          (typeof backendGroups === 'string' ? JSON.parse(backendGroups) : backendGroups).length > 0;

        if (hasWatchlist || hasGroups) {
          await window.ztfi.watchlistStore.clearStores();

          if (hasGroups) {
            const parsedGroups = typeof backendGroups === 'string' ? JSON.parse(backendGroups) : backendGroups;
            for (const group of parsedGroups) {
              await window.ztfi.watchlistStore.importGroup(group);
            }
          }

          if (hasWatchlist) {
            const parsedWatchlist = typeof backendWatchlist === 'string' ? JSON.parse(backendWatchlist) : backendWatchlist;
            for (const stock of parsedWatchlist) {
              await window.ztfi.watchlistStore.addWatchlistStock({ code: stock.code, name: stock.name }, stock.groupId || 'ungrouped');
            }
          }
        }

        // 回灌收藏：后端 favorites.json → IndexedDB（put 按主键合并，不覆盖本地已有）
        if (window.pywebview.api.get_favorites) {
          const backendFavs = await window.pywebview.api.get_favorites();
          const favs = typeof backendFavs === 'string' ? JSON.parse(backendFavs) : backendFavs;
          if (Array.isArray(favs) && favs.length) {
            await window.ztfi.favoritesStore.importFavorites(favs);
            // 合并后回写全量快照，双端收敛（本地新增项也会同步上去）
            await window.ztfi.favoritesStore.syncToBackend();
          }
        }
      }
    } catch (e) {
      console.warn('从后端初始化自选股失败:', e);
    }
  }

  window.ztfi.idbCore = {
    ensureDB,
    storeMessagesBatch,
    checkAndCleanup,
    deleteOldMessages,
    initFromBackend,
    MAX_RECORDS,
    CLEANUP_THRESHOLD,
  };

  // ===== 聚合门面：window.ztfi.historyStorage（惰性转发，调用点零语义变化）=====
  // 拆分前全局暴露 window.historyStorage（单例类），调用方统一改走 ztfi 命名空间。
  window.ztfi.historyStorage = {
    // 消息存储与生命周期（idb-core）
    storeMessagesBatch: (...a) => window.ztfi.idbCore.storeMessagesBatch(...a),
    deleteOldMessages: (...a) => window.ztfi.idbCore.deleteOldMessages(...a),
    initFromBackend: (...a) => window.ztfi.idbCore.initFromBackend(...a),
    // 搜索（history-search）
    searchMessages: (...a) => window.ztfi.historySearch.searchMessages(...a),
    // 收藏（favorites-store）
    addFavorite: (...a) => window.ztfi.favoritesStore.addFavorite(...a),
    removeFavorite: (...a) => window.ztfi.favoritesStore.removeFavorite(...a),
    isFavorite: (...a) => window.ztfi.favoritesStore.isFavorite(...a),
    getAllFavorites: (...a) => window.ztfi.favoritesStore.getAllFavorites(...a),
    getFavoritesCount: (...a) => window.ztfi.favoritesStore.getFavoritesCount(...a),
    // 自选股与分组（watchlist-store）
    addWatchlistStock: (...a) => window.ztfi.watchlistStore.addWatchlistStock(...a),
    updateWatchlistStockGroup: (...a) => window.ztfi.watchlistStore.updateWatchlistStockGroup(...a),
    updateWatchlistStockAlertThreshold: (...a) => window.ztfi.watchlistStore.updateWatchlistStockAlertThreshold(...a),
    removeWatchlistStock: (...a) => window.ztfi.watchlistStore.removeWatchlistStock(...a),
    getAllWatchlist: (...a) => window.ztfi.watchlistStore.getAllWatchlist(...a),
    getWatchlistCount: (...a) => window.ztfi.watchlistStore.getWatchlistCount(...a),
    matchWatchlistInText: (...a) => window.ztfi.watchlistStore.matchWatchlistInText(...a),
    createWatchlistGroup: (...a) => window.ztfi.watchlistStore.createWatchlistGroup(...a),
    deleteWatchlistGroup: (...a) => window.ztfi.watchlistStore.deleteWatchlistGroup(...a),
    renameWatchlistGroup: (...a) => window.ztfi.watchlistStore.renameWatchlistGroup(...a),
    getAllWatchlistGroups: (...a) => window.ztfi.watchlistStore.getAllWatchlistGroups(...a),
  };

  // 模块加载即开库（原 constructor 内 this.init() 行为保持）
  ensureDB().catch(e => console.error('初始化历史消息数据库失败:', e));
})();
