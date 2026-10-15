/**
 * ztfi.historyBuffer — 历史消息批量写入与清理
 *
 * 覆盖：historyBuffer 缓冲 + 批量 flush（BATCH_SIZE / FLUSH_INTERVAL）+ 定时清理（cleanupOldHistory）。
 * 接缝：数据层由 window.historyStorage 承载；host 仅 debugMode（调试日志）与 maxHistoryDays（清理边界）。
 * 加载顺序：core → utils → dom → … → history-buffer → app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  let _host = null;
  function attach(host) { _host = host; }
  function H() { return _host; }

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

  async function cleanupOldHistory() {
    if (!window.historyStorage) return;
    try {
      const cutoffTime = Date.now() - H().maxHistoryDays * 24 * 60 * 60 * 1000;
      const deletedCount = await window.historyStorage.deleteOldMessages(cutoffTime);
      if (H().debugMode && deletedCount > 0) {
        console.log(`清理过期消息: 删除 ${deletedCount} 条`);
      }
    } catch (e) {
      if (H().debugMode) console.warn('清理历史消息失败:', e);
    }
  }

  function scheduleCleanup() {
    // 延迟 5 分钟首次启动清理，避开启动高峰；之后每 24 小时一次
    setTimeout(() => {
      cleanupOldHistory();
      setInterval(cleanupOldHistory, 24 * 60 * 60 * 1000);
    }, 5 * 60 * 1000);
  }

  window.ztfi.historyBuffer = {
    attach,
    storeToHistory,
    scheduleCleanup,
  };
})();
