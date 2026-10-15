/**
 * ztfi.stats — 来源评估指标统计
 *
 * 覆盖：recordSourceStats（来源计数/延迟）、recordSourceClick（点击计数）、getStatsReport（报告）。
 * 接缝：模块自持 stats 状态，无 host 依赖（纯内存统计）。
 * 加载顺序：core → utils → … → stats → app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  // ===== 评估指标统计 =====
  const stats = {
    sourceCounts: {},
    sourceClicks: {},
    sourceDelays: {},
    totalMessages: 0,
    totalClicks: 0,
    startTime: Date.now(),
  };

  function recordSourceStats(item) {
    const source = item.comefrom || item.source_id || 'unknown';
    if (!stats.sourceCounts[source]) {
      stats.sourceCounts[source] = 0;
      stats.sourceClicks[source] = 0;
      stats.sourceDelays[source] = [];
    }
    stats.sourceCounts[source]++;
    stats.totalMessages++;

    const delay = Date.now() - (item.ctime || Date.now()) * 1000;
    if (delay >= 0) {
      stats.sourceDelays[source].push(delay);
    }
  }

  function recordSourceClick(item) {
    const source = item.comefrom || item.source_id || 'unknown';
    if (!stats.sourceClicks[source]) {
      stats.sourceClicks[source] = 0;
    }
    stats.sourceClicks[source]++;
    stats.totalClicks++;
  }

  function getStatsReport() {
    const report = {
      totalMessages: stats.totalMessages,
      totalClicks: stats.totalClicks,
      uptime: Math.floor((Date.now() - stats.startTime) / 1000),
      sources: {},
    };
    for (const source in stats.sourceCounts) {
      const delays = stats.sourceDelays[source];
      const avgDelay = delays.length > 0 ? Math.floor(delays.reduce((a, b) => a + b, 0) / delays.length) : 0;
      const maxDelay = delays.length > 0 ? Math.max(...delays) : 0;
      report.sources[source] = {
        count: stats.sourceCounts[source],
        clicks: stats.sourceClicks[source],
        clickRate: stats.sourceCounts[source] > 0 ?
          ((stats.sourceClicks[source] / stats.sourceCounts[source]) * 100).toFixed(1) : 0,
        avgDelay: avgDelay,
        maxDelay: maxDelay,
      };
    }
    return report;
  }

  window.ztfi.stats = {
    recordSourceStats,
    recordSourceClick,
    getStatsReport,
  };
})();
