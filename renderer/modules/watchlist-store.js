/**
 * ztfi.watchlistStore — 自选股与分组存储
 *
 * 架构 #1（审计）：自 history-storage.js 拆出。watchlist / watchlistGroups 两个
 * objectStore 的全部读写 + 后端写穿同步（persist_watchlist / persist_watchlist_groups）。
 * DB 连接经 ztfi.idbCore.ensureDB() 取用。
 * 加载顺序：idb-core 之后、app.js 之前。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  const ZTFI_HS_DEBUG = false; // 调试日志开关（原 history-storage 文件级开关随拆分入各 IIFE）

  /**
   * 添加自选股
   */
  async function addWatchlistStock(stock, groupId = 'ungrouped') {
    const db = await window.ztfi.idbCore.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['watchlist'], 'readwrite');
      const store = transaction.objectStore('watchlist');

      const stockData = {
        code: stock.code,
        name: stock.name || '',
        groupId: groupId,
        alertThreshold: stock.alertThreshold || 5,
        addedAt: Date.now()
      };

      const request = store.put(stockData);

      request.onsuccess = () => {
        if (ZTFI_HS_DEBUG) console.log('已添加自选股:', stockData.code, stockData.name, '分组:', groupId);
        syncWatchlistToBackend();
        resolve(true);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 更新自选股分组
   */
  async function updateWatchlistStockGroup(code, groupId) {
    const db = await window.ztfi.idbCore.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['watchlist'], 'readwrite');
      const store = transaction.objectStore('watchlist');

      const request = store.get(code);

      request.onsuccess = () => {
        const stock = request.result;
        if (stock) {
          stock.groupId = groupId;
          store.put(stock);
          syncWatchlistToBackend();
          syncWatchlistGroupsToBackend();
          resolve(true);
        } else {
          resolve(false);
        }
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 更新自选股预警阈值
   */
  async function updateWatchlistStockAlertThreshold(code, threshold) {
    const db = await window.ztfi.idbCore.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['watchlist'], 'readwrite');
      const store = transaction.objectStore('watchlist');

      const request = store.get(code);

      request.onsuccess = () => {
        const stock = request.result;
        if (stock) {
          stock.alertThreshold = threshold;
          store.put(stock);
          syncWatchlistToBackend();
          resolve(true);
        } else {
          resolve(false);
        }
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 移除自选股
   */
  async function removeWatchlistStock(code) {
    const db = await window.ztfi.idbCore.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['watchlist'], 'readwrite');
      const store = transaction.objectStore('watchlist');

      const request = store.delete(code);

      request.onsuccess = () => {
        if (ZTFI_HS_DEBUG) console.log('已移除自选股:', code);
        syncWatchlistToBackend();
        resolve(true);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 获取所有自选股
   */
  async function getAllWatchlist() {
    const db = await window.ztfi.idbCore.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['watchlist'], 'readonly');
      const store = transaction.objectStore('watchlist');

      const results = [];
      const request = store.index('addedAt').openCursor(null, 'prev');

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.push(cursor.value);
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
   * 获取自选股数量
   */
  async function getWatchlistCount() {
    const db = await window.ztfi.idbCore.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['watchlist'], 'readonly');
      const store = transaction.objectStore('watchlist');

      const request = store.count();

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 检查文本中是否包含自选股（返回匹配的股票列表）
   */
  async function matchWatchlistInText(text) {
    if (!text) return [];

    const db = await window.ztfi.idbCore.ensureDB();
    if (!db) return [];

    const watchlist = await getAllWatchlist();
    const matches = [];

    watchlist.forEach(stock => {
      if (stock.code && text.includes(stock.code)) {
        matches.push(stock);
      } else if (stock.name && text.includes(stock.name)) {
        matches.push(stock);
      }
    });

    return matches;
  }

  // ===== 自选股分组管理 =====

  /**
   * 创建分组
   */
  async function createWatchlistGroup(name) {
    const db = await window.ztfi.idbCore.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['watchlistGroups'], 'readwrite');
      const store = transaction.objectStore('watchlistGroups');

      const group = {
        id: 'group_' + Date.now(),
        name: name,
        order: Date.now(),
        createdAt: Date.now()
      };

      const request = store.add(group);

      request.onsuccess = () => {
        if (ZTFI_HS_DEBUG) console.log('已创建分组:', name);
        syncWatchlistGroupsToBackend();
        resolve(group);
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 删除分组（分组内的股票会移到"未分组"）
   */
  async function deleteWatchlistGroup(groupId) {
    const db = await window.ztfi.idbCore.ensureDB();
    if (!db || groupId === 'ungrouped') return false;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['watchlistGroups', 'watchlist'], 'readwrite');
      const groupStore = transaction.objectStore('watchlistGroups');
      const watchStore = transaction.objectStore('watchlist');

      // 先删除分组
      const deleteGroupReq = groupStore.delete(groupId);

      deleteGroupReq.onsuccess = () => {
        // 将该分组的股票移到未分组
        const index = watchStore.index('groupId');
        const request = index.openCursor(groupId);

        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.value.groupId = 'ungrouped';
            cursor.update(cursor.value);
            cursor.continue();
          } else {
            // 游标扫完（迁移完成）再同步回写与 resolve：原先在 onsuccess 里立即回写
            // 会读到迁移前的旧数据，且外层不存在 request 变量，此处一旦执行必 ReferenceError
            syncWatchlistToBackend();
            syncWatchlistGroupsToBackend();
            resolve(true);
          }
        };

        request.onerror = (event) => {
          reject(event.target.error);
        };
      };

      deleteGroupReq.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 重命名分组
   */
  async function renameWatchlistGroup(groupId, newName) {
    const db = await window.ztfi.idbCore.ensureDB();
    if (!db) return false;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['watchlistGroups'], 'readwrite');
      const store = transaction.objectStore('watchlistGroups');

      const request = store.get(groupId);

      request.onsuccess = () => {
        const group = request.result;
        if (group) {
          group.name = newName;
          store.put(group);
          if (ZTFI_HS_DEBUG) console.log('已重命名分组:', groupId, '->', newName);
          syncWatchlistGroupsToBackend();
          resolve(true);
        } else {
          resolve(false);
        }
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 获取所有分组
   */
  async function getAllWatchlistGroups() {
    const db = await window.ztfi.idbCore.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['watchlistGroups'], 'readonly');
      const store = transaction.objectStore('watchlistGroups');

      const results = [];
      const request = store.index('order').openCursor(null, 'prev');

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.push(cursor.value);
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

  // ===== 后端写穿同步与回灌 =====

  async function syncWatchlistToBackend() {
    try {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.persist_watchlist) {
        const watchlist = await getAllWatchlist();
        await pywebview.api.persist_watchlist(JSON.stringify(watchlist));
      }
    } catch (e) {
      console.warn('同步自选股到后端失败:', e);
    }
  }

  async function syncWatchlistGroupsToBackend() {
    try {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.persist_watchlist_groups) {
        const groups = await getAllWatchlistGroups();
        await pywebview.api.persist_watchlist_groups(JSON.stringify(groups));
      }
    } catch (e) {
      console.warn('同步自选股分组到后端失败:', e);
    }
  }

  /**
   * 清空自选股两个 store（启动回灌前由 idb-core.initFromBackend 调用）
   */
  async function clearStores() {
    const db = await window.ztfi.idbCore.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['watchlist', 'watchlistGroups'], 'readwrite');
      const watchStore = transaction.objectStore('watchlist');
      const groupStore = transaction.objectStore('watchlistGroups');

      const clearWatch = watchStore.clear();
      const clearGroup = groupStore.clear();

      clearWatch.onsuccess = () => {
        clearGroup.onsuccess = () => {
          resolve(true);
        };
      };

      clearWatch.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 导入单个分组（启动回灌用，put 按主键合并）
   */
  async function importGroup(group) {
    const db = await window.ztfi.idbCore.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['watchlistGroups'], 'readwrite');
      const store = transaction.objectStore('watchlistGroups');

      store.put(group);
      transaction.oncomplete = () => {
        resolve(group);
      };
      transaction.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  window.ztfi.watchlistStore = {
    addWatchlistStock,
    updateWatchlistStockGroup,
    updateWatchlistStockAlertThreshold,
    removeWatchlistStock,
    getAllWatchlist,
    getWatchlistCount,
    matchWatchlistInText,
    createWatchlistGroup,
    deleteWatchlistGroup,
    renameWatchlistGroup,
    getAllWatchlistGroups,
    clearStores,
    importGroup,
    syncToBackend: syncWatchlistToBackend,
  };
})();
