/**
 * ztfi.historySearch — 历史消息检索
 *
 * 架构 #1（审计）：自 history-storage.js 拆出。子串扫描检索（v4.4.1 起），
 * DB 连接经 ztfi.idbCore.ensureDB() 取用。
 * 加载顺序：idb-core 之后、app.js 之前。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  /**
   * 历史消息检索（标题/正文子串匹配，按时间倒序；空查询即最近消息）
   */
  async function searchMessages(query, options = {}) {
    const db = await window.ztfi.idbCore.ensureDB();

    const {
      limit = 50,
      offset = 0,
      category = null,
      priority = null,
      startDate = null,
      endDate = null
    } = options;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['messages'], 'readonly');
      const messagesStore = transaction.objectStore('messages');

      const results = [];
      const seenIds = new Set();
      const q = (query || '').trim().toLowerCase();
      const need = offset + limit;

      // 中文分词块（4 字贪婪切分）常与查询块不对齐，故统一改为「标题/正文子串匹配」，
      // 按时间倒序扫描（空查询即返回最近消息）。原词索引路径对短词/错位词几乎必然漏检。
      const request = messagesStore.index('timestamp').openCursor(null, 'prev');

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && results.length < need) {
          const message = cursor.value;

          const text = ((message.title || '') + ' ' + (message.content || '')).toLowerCase();
          const queryOk = !q || text.includes(q);

          if (queryOk && matchesFilters(message, { category, priority, startDate, endDate })) {
            if (!seenIds.has(message.id)) {
              results.push(message);
              seenIds.add(message.id);
            }
          }
          cursor.continue();
        } else {
          resolve(results.slice(offset, offset + limit));
        }
      };

      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 检查消息是否匹配过滤条件
   */
  function matchesFilters(message, filters) {
    const { category, priority, startDate, endDate } = filters;

    if (category && message.category !== category) return false;
    if (priority && message.priority !== priority) return false;
    if (startDate && message.timestamp < startDate) return false;
    if (endDate && message.timestamp > endDate) return false;

    return true;
  }

  window.ztfi.historySearch = {
    searchMessages,
    matchesFilters,
  };
})();
