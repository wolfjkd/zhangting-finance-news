/**
 * ztfi.utils — 前端共享纯函数工具箱（零状态）
 *
 * 约定：本模块只提供「无内部状态、无副作用（除必要 DOM 探针）」的纯函数，
 *       任何依赖设置 / 状态 / 队列的逻辑一律留在 app.js 或对应服务模块。
 * 加载顺序：core.js → utils.js →（dom.js / 其它）→ app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  /** 检查某个后端 API 是否可用（window.pywebview.api 是否存在且该方法已注册） */
  function apiHas(methodName) {
    return !!(window.pywebview && window.pywebview.api && typeof window.pywebview.api[methodName] === 'function');
  }

  /** 把 pywebview 返回值统一解包成对象（pywebview 有时返回字符串、有时返回对象，取决于序列化时机） */
  function unwrapResult(result) {
    if (result == null) return null;
    return typeof result === 'string' ? JSON.parse(result) : result;
  }

  /** HTML 转义：把用户/外部文本安全注入 innerHTML 前的必备处理 */
  function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /** 数字补零到两位（时间格式化用） */
  function p2(n) { return String(n).padStart(2, '0'); }

  /** 秒级时间戳 → HH:MM:SS */
  function formatTime(ctime) {
    if (!ctime) return '';
    const d = new Date(ctime * 1000);
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  }

  /** 成交量（股）→ 亿股 / 万股 / 股 */
  function formatVolume(volume) {
    if (volume >= 100000000) return (volume / 100000000).toFixed(2) + '亿股';
    if (volume >= 10000) return (volume / 10000).toFixed(2) + '万股';
    return volume + '股';
  }

  /** 金额（元）→ 亿 / 万 / 元 */
  function formatAmount(amount) {
    if (amount >= 100000000) return (amount / 100000000).toFixed(2) + '亿';
    if (amount >= 10000) return (amount / 10000).toFixed(2) + '万';
    return amount + '元';
  }

  /** 极简 Markdown → HTML（标题 / 加粗 / 表格 / 列表 / 段落），用于政策/隐私等长文本 */
  function markdownToHtml(text) {
    let html = text
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    html = html.replace(/^### (.*$)/gm, '<h4 style="margin: 12px 0 6px; font-size: 15px; color: var(--text);">$1</h4>');
    html = html.replace(/^## (.*$)/gm, '<h3 style="margin: 16px 0 8px; font-size: 16px; color: var(--text);">$1</h3>');
    html = html.replace(/^# (.*$)/gm, '<h2 style="margin: 20px 0 10px; font-size: 18px; color: var(--text);">$1</h2>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^\|(.+)\|$/gm, function (match, content) {
      const cells = content.split('|').map(c => c.trim());
      if (cells.length > 1) {
        return '<div style="display: grid; grid-template-columns: repeat(' + cells.length + ', 1fr); gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--border);">' + cells.map(c => '<div style="padding: 2px 4px;">' + c + '</div>').join('') + '</div>';
      }
      return match;
    });
    html = html.replace(/^- (.*$)/gm, '<p style="margin: 4px 0 4px 16px;">• $1</p>');
    html = html.replace(/^(\d+)\. (.*$)/gm, '<p style="margin: 4px 0 4px 16px;">$1. $2</p>');
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    return html;
  }

  /** 中文友好的 bigram 集合（去标点/空格后取相邻二字） */
  function getBigrams(str) {
    const set = new Set();
    // 去掉标点和空格后再取 bigram
    const clean = str.replace(/[\s\u3000,，。.!！?？:：;；、""''「」【】\-\—\（）()《》]/g, '');
    for (let i = 0; i < clean.length - 1; i++) {
      set.add(clean.substring(i, i + 2));
    }
    return set;
  }

  /**
   * 计算两个字符串的相似度（0~1）
   * 使用 Dice 系数（基于 bigram），对中文标题效果好
   */
  function titleSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    // 短标题（<=8字）要求更严格：完全一样才算相似
    if (a.length <= 8 || b.length <= 8) {
      return a === b ? 1 : 0;
    }
    const bigramsA = getBigrams(a);
    const bigramsB = getBigrams(b);
    if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
    let intersection = 0;
    for (const bg of bigramsA) {
      if (bigramsB.has(bg)) intersection++;
    }
    return (2 * intersection) / (bigramsA.size + bigramsB.size);
  }

  window.ztfi.utils = {
    apiHas,
    unwrapResult,
    esc,
    p2,
    formatTime,
    formatVolume,
    formatAmount,
    markdownToHtml,
    getBigrams,
    titleSimilarity,
  };
})();
