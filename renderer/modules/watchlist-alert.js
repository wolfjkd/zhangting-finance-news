/**
 * ztfi.watchlistAlert — 自选股异动提醒（异动 / 多条件 / 盘口）
 *
 * 覆盖：startWatchlistAlertMonitor / stopWatchlistAlertMonitor（2 分钟轮询）、
 *       checkWatchlistAlerts（交易时段 + 阈值 + 新高/新低）、batchGetQuotes（后端代理批量行情）、
 *       showWatchlistAlertPopup、calculateATR / getSmartThreshold / getAvgVolume、
 *       checkMultiConditionAlerts / showMultiConditionPopup、checkOrderbookAlert / showOrderbookAlert。
 * 接缝：host = getSettings（每次取最新 settings）+ debugMode + getAlertConditions
 *       （_alertConditions 留在 app.js，因 initTTSSettings 会重赋值）；
 *       utils esc/apiHas/unwrapResult；跨模块 window.ztfi.watchlistView.showStockQuoteDialog、
 *       window.ztfi.keywordAlert.playAlertSound。
 * 加载顺序：core → utils → dom → … → watchlist-alert → app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  let _host = null;
  function attach(host) { _host = host; }
  function H() { return _host; }
  function S() { return H().getSettings(); }
  function U() { return window.ztfi.utils; }

  // ===== 自选股异动提醒 =====
  let watchlistAlertTimer = null;
  let watchlistAlertState = {}; // {code: {lastTime, lastHigh, lastLow}} 记录每只股票上次提醒状态

  function startWatchlistAlertMonitor() {
    if (watchlistAlertTimer) return;

    // 立即检查一次
    checkWatchlistAlerts();

    // 每 2 分钟检查一次（足够及时，CPU 减半；非交易时间 checkWatchlistAlerts 内部直接 return）
    watchlistAlertTimer = setInterval(() => {
      checkWatchlistAlerts();
    }, 120000);

    if (H().debugMode) console.log('[自选股提醒] 监控已启动');
  }

  function stopWatchlistAlertMonitor() {
    if (watchlistAlertTimer) {
      clearInterval(watchlistAlertTimer);
      watchlistAlertTimer = null;
    }
    if (H().debugMode) console.log('[自选股提醒] 监控已停止');
  }

  async function checkWatchlistAlerts() {
    if (!S().watchlistAlertEnabled) return;
    if (!window.historyStorage) return;

    // 收盘后不执行自选股异动提醒（交易时间：9:25-11:30, 13:00-15:00）
    const dateNow = new Date();
    const day = dateNow.getDay();
    const hours = dateNow.getHours();
    const minutes = dateNow.getMinutes();
    const time = hours * 60 + minutes; // 当天分钟数
    // 周末不检查
    if (day === 0 || day === 6) return;
    // 非交易时间段不检查（9:25=565, 11:30=690, 13:00=780, 15:00=900）
    const inMorning = time >= 565 && time <= 690;
    const inAfternoon = time >= 780 && time <= 900;
    if (!inMorning && !inAfternoon) return;

    try {
      const watchlist = await window.historyStorage.getAllWatchlist();
      if (!watchlist || watchlist.length === 0) return;

      // 获取所有自选股代码
      const codes = watchlist.map(s => s.code);

      // 创建代码到阈值的映射
      const thresholdMap = {};
      watchlist.forEach(s => {
        thresholdMap[s.code] = s.alertThreshold || S().watchlistAlertThreshold || 5;
      });

      // 批量查询行情
      const batchResult = await batchGetQuotes(codes);
      if (!batchResult || batchResult.length === 0) return;

      const timestampNow = Date.now();
      const defaultThreshold = S().watchlistAlertThreshold || 5;
      const intervalMs = (S().watchlistAlertInterval || 5) * 60 * 1000;

      // 检查每只股票
      for (const q of batchResult) {
        if (!q || !q.quote) continue;

        const changePercent = Math.abs(q.quote.changePercent || 0);
        const code = q.quote.code;
        const price = q.quote.price || 0;
        const isUp = (q.quote.changePercent || 0) > 0;

        // 使用该股票的独立阈值，若无则使用全局阈值
        const stockThreshold = thresholdMap[code] || defaultThreshold;

        // 检查是否超过阈值
        if (changePercent >= stockThreshold) {
          const state = watchlistAlertState[code];

          if (!state) {
            // 第一次触发，立即提醒
            watchlistAlertState[code] = {
              lastTime: timestampNow,
              lastHigh: price,
              lastLow: price
            };
            showWatchlistAlertPopup(q.quote, stockThreshold);
          } else {
            // 检查是否创新高或新低
            const hitNewHigh = isUp && price > state.lastHigh;
            const hitNewLow = !isUp && price < state.lastLow;

            if (hitNewHigh || hitNewLow) {
              // 创新高或新低，再次提醒
              watchlistAlertState[code] = {
                lastTime: timestampNow,
                lastHigh: hitNewHigh ? price : state.lastHigh,
                lastLow: hitNewLow ? price : state.lastLow
              };
              showWatchlistAlertPopup(q.quote, stockThreshold);
            } else {
              if (H().debugMode) console.log(`[自选股提醒] ${code} 未创新高/新低，跳过`);
            }
          }
        } else {
          // 未超过阈值，重置状态（允许下次重新触发）
          watchlistAlertState[code] = null;
        }

        // 多条件提醒检查
        checkMultiConditionAlerts(q.quote);
        // 盘口异动检查（每30秒检查一次）
        if (Math.floor(Date.now() / 30000) % 2 === 0) { // 降频检查
          checkOrderbookAlert(q.quote.code, q.quote.name);
        }
      }
    } catch (err) {
      if (H().debugMode) console.error('[自选股提醒] 检查失败:', err);
    }
  }

  async function batchGetQuotes(codes) {
    if (!codes || codes.length === 0) return [];

    // 走后端代理：避免 WebView2 直连外部 API 触发 CORS、暴露调用路径
    // 后端实现：app.py 的 batch_get_stock_quotes（复用 _http session）
    try {
      const api = window.pywebview && window.pywebview.api;
      if (!api || !api.batch_get_stock_quotes) {
        if (H().debugMode) console.error('[自选股提醒] 后端 batch_get_stock_quotes 接口不可用');
        return [];
      }
      const resp = await api.batch_get_stock_quotes(codes);
      if (!resp || !resp.status || resp.status !== 'ok' || !Array.isArray(resp.quotes)) {
        if (H().debugMode) console.error('[自选股提醒] 批量查询失败:', resp && resp.message);
        return [];
      }
      // 包装成 {quote: {...}} 形式以兼容现有调用方
      return resp.quotes.map(q => ({ quote: q }));
    } catch (err) {
      if (H().debugMode) console.error('[自选股提醒] 批量查询异常:', err);
      return [];
    }
  }

  function showWatchlistAlertPopup(quote, threshold) {
    const changePercent = quote.changePercent || 0;
    const change = quote.change || 0;
    const isUp = changePercent > 0;
    const direction = isUp ? '上涨' : '下跌';
    const alertThreshold = threshold || S().watchlistAlertThreshold || 5;

    // 播放提醒声音
    if (S().watchlistAlertSound) {
      window.ztfi.keywordAlert.playAlertSound();
    }

    // 创建弹窗
    const dialog = document.createElement('div');
    dialog.className = 'watchlist-alert-dialog';

    const changeStr = `${isUp ? '+' : ''}${change.toFixed(2)} (${isUp ? '+' : ''}${changePercent.toFixed(2)}%)`;

    dialog.innerHTML = `
      <div class="alert-header">
        <div class="alert-icon ${isUp ? 'up' : 'down'}">${isUp ? '📈' : '📉'}</div>
        <div class="alert-title">自选股异动提醒</div>
        <button class="dialog-close-btn" title="关闭">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
      <div class="alert-body">
        <div class="alert-stock-name">${U().esc(quote.name)}</div>
        <div class="alert-stock-code">${U().esc(quote.code)}</div>
        <div class="alert-price ${isUp ? 'up' : 'down'}">${quote.price.toFixed(2)}</div>
        <div class="alert-change ${isUp ? 'up' : 'down'}">${changeStr}</div>
        <div class="alert-message">${direction}幅度超过 ${alertThreshold}%</div>
        <div class="alert-actions">
          <button class="alert-view-btn" data-code="${quote.code}">查看详情</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    // 关闭按钮
    dialog.querySelector('.dialog-close-btn').addEventListener('click', () => {
      dialog.remove();
    });

    // 查看详情按钮
    dialog.querySelector('.alert-view-btn').addEventListener('click', () => {
      dialog.remove();
      window.ztfi.watchlistView.showStockQuoteDialog(quote.code);
    });

    // 5秒后自动关闭
    setTimeout(() => {
      if (dialog.parentNode) {
        dialog.remove();
      }
    }, 5000);

    if (H().debugMode) console.log(`[自选股提醒] 触发提醒: ${quote.name} ${changePercent.toFixed(2)}%`);
  }

  // ===== 多条件提醒 + 智能阈值 + 盘口异动 =====
  let _alertLastTrigger = {}; // 记录每只股票上次触发时间

  // 计算ATR（平均真实波幅）
  async function calculateATR(code) {
    try {
      if (!U().apiHas('get_stock_history')) return 0;
      const result = await window.pywebview.api.get_stock_history(code, 21);
      const data = U().unwrapResult(result);
      if (data.status !== 'ok' || !data.data || data.data.length < 2) return 0;

      let trSum = 0;
      const klines = data.data;
      for (let i = 1; i < klines.length; i++) {
        const high = klines[i].high;
        const low = klines[i].low;
        const prevClose = klines[i-1].close;
        const tr = Math.max(
          high - low,
          Math.abs(high - prevClose),
          Math.abs(low - prevClose)
        );
        trSum += tr;
      }
      const atr = trSum / (klines.length - 1);
      const lastClose = klines[klines.length - 1].close;
      return lastClose > 0 ? (atr / lastClose * 100) : 0; // 返回ATR百分比
    } catch (e) {
      console.error('计算ATR失败:', e);
      return 0;
    }
  }

  // 获取智能阈值
  async function getSmartThreshold(code) {
    const atr = await calculateATR(code);
    const cond = H().getAlertConditions() || {};
    const baseThreshold = cond.changePercent || 5;
    // 智能阈值 = max(固定阈值, 2 × ATR%)
    return Math.max(baseThreshold, atr * 2);
  }

  // 计算20日平均成交量
  async function getAvgVolume(code) {
    try {
      if (!window.pywebview || !window.pywebview.api) return 0;
      const result = await window.pywebview.api.get_stock_history(code, 21);
      const data = JSON.parse(result);
      if (data.status !== 'ok' || !data.data || data.data.length < 2) return 0;
      const klines = data.data;
      let volSum = 0;
      for (let i = 0; i < klines.length - 1; i++) { // 不含今天
        volSum += klines[i].volume;
      }
      return volSum / (klines.length - 1);
    } catch (e) {
      return 0;
    }
  }

  // 多条件提醒检查
  async function checkMultiConditionAlerts(stockData) {
    const cond = H().getAlertConditions();
    if (!cond) return;
    const code = stockData.code || stockData.id;
    const name = stockData.name || stockData.title || '';

    // 冷却检查
    const now = Date.now();
    if (_alertLastTrigger[code] && (now - _alertLastTrigger[code]) < (cond.cooldown || 300) * 1000) {
      return;
    }

    const results = [];

    // 条件1：涨跌幅
    const changePercent = Math.abs(parseFloat(stockData.changePercent || stockData.rise || 0));
    const smartThreshold = await getSmartThreshold(code);
    if (changePercent >= smartThreshold) {
      results.push({ type: '涨跌幅', value: changePercent.toFixed(2) + '%', threshold: smartThreshold.toFixed(2) + '%' });
    }

    // 条件2：成交量倍数
    const avgVol = await getAvgVolume(code);
    const currentVol = parseFloat(stockData.volume || 0);
    if (avgVol > 0 && currentVol / avgVol >= (cond.volumeRatio || 2)) {
      results.push({ type: '成交量异动', value: (currentVol / avgVol).toFixed(1) + '倍', threshold: cond.volumeRatio + '倍' });
    }

    // 条件3：振幅
    const high = parseFloat(stockData.high || 0);
    const low = parseFloat(stockData.low || 0);
    const preClose = parseFloat(stockData.preClose || stockData.yesterdayClose || 0);
    if (preClose > 0) {
      const amplitude = ((high - low) / preClose * 100);
      if (amplitude >= (cond.amplitude || 8)) {
        results.push({ type: '振幅', value: amplitude.toFixed(2) + '%', threshold: cond.amplitude + '%' });
      }
    }

    // 触发判断
    const triggered = cond.triggerMode === 'all'
      ? results.length === 3
      : results.length > 0;

    if (triggered) {
      _alertLastTrigger[code] = now;
      showMultiConditionPopup(name, code, results);
    }
  }

  // 多条件提醒弹窗
  function showMultiConditionPopup(name, code, results) {
    // 移除已有弹窗
    const existing = document.querySelector('.multi-condition-popup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.className = 'multi-condition-popup';

    let resultsHTML = results.map(r => `
      <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:13px;color:var(--text);">${r.type}</span>
        <span style="font-size:13px;color:#ff6b35;font-weight:bold;">${r.value} (阈值: ${r.threshold})</span>
      </div>
    `).join('');

    popup.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h3 style="margin:0;font-size:15px;color:var(--text);">⚡ 多条件异动 - ${name}</h3>
        <button class="dialog-close-btn" onclick="this.closest('.multi-condition-popup').remove()" title="关闭">
          <svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:#e53935;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">代码: ${code} | 时间: ${new Date().toLocaleTimeString()}</div>
      ${resultsHTML}
      <div style="margin-top:12px;text-align:right;">
        <button onclick="this.closest('.multi-condition-popup').remove()" style="font-size:13px;padding:4px 16px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);cursor:pointer;">确认</button>
      </div>
    `;

    document.body.appendChild(popup);

    // 10秒后自动消失（如果用户没交互）
    setTimeout(() => {
      if (popup.parentNode) popup.remove();
    }, 10000);
  }

  // 盘口异动监控
  async function checkOrderbookAlert(code, name) {
    try {
      if (!window.pywebview || !window.pywebview.api) return;
      const result = await window.pywebview.api.get_stock_orderbook(code);
      const data = JSON.parse(result);
      if (data.status !== 'ok') return;

      const alerts = [];
      const totalVolume = data.total_volume || 0;

      // 大单压单：卖一量 > 总量0.1%
      if (data.asks[0] && data.asks[0].volume > 0 && totalVolume > 0) {
        const askRatio = data.asks[0].volume / totalVolume * 100;
        if (askRatio > 0.1) {
          alerts.push({ type: '大单压单', desc: `卖一量 ${(data.asks[0].volume/10000).toFixed(1)}万手 (${askRatio.toFixed(2)}%)` });
        }
      }

      // 大单托单：买一量 > 总量0.1%
      if (data.bids[0] && data.bids[0].volume > 0 && totalVolume > 0) {
        const bidRatio = data.bids[0].volume / totalVolume * 100;
        if (bidRatio > 0.1) {
          alerts.push({ type: '大单托单', desc: `买一量 ${(data.bids[0].volume/10000).toFixed(1)}万手 (${bidRatio.toFixed(2)}%)` });
        }
      }

      // 封涨停：涨幅接近涨停且买一量极大
      if (data.pre_close > 0) {
        const limitUpPrice = data.pre_close * 1.1;
        if (data.price >= limitUpPrice * 0.998 && data.bids[0] && data.bids[0].volume > totalVolume * 0.05) {
          alerts.push({ type: '封涨停', desc: `买一封单 ${(data.bids[0].volume/10000).toFixed(1)}万手` });
        }
        // 封跌停
        const limitDownPrice = data.pre_close * 0.9;
        if (data.price <= limitDownPrice * 1.002 && data.asks[0] && data.asks[0].volume > totalVolume * 0.05) {
          alerts.push({ type: '封跌停', desc: `卖一封单 ${(data.asks[0].volume/10000).toFixed(1)}万手` });
        }
      }

      if (alerts.length > 0) {
        showOrderbookAlert(name, code, alerts, data);
      }
    } catch (e) {
      console.error('盘口异动检查失败:', e);
    }
  }

  // 盘口异动弹窗
  function showOrderbookAlert(name, code, alerts, stockData) {
    const existing = document.querySelector('.orderbook-alert');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.className = 'orderbook-alert';

    let alertsHTML = alerts.map(a => `
      <div style="padding:6px 0;border-bottom:1px solid rgba(255,107,53,0.2);">
        <span style="font-size:14px;font-weight:bold;color:#ff6b35;">${a.type}</span>
        <span style="font-size:12px;color:var(--text-secondary);margin-left:8px;">${a.desc}</span>
      </div>
    `).join('');

    popup.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h3 style="margin:0;font-size:15px;color:#ff6b35;">⚡ 盘口异动 - ${name}</h3>
        <button class="dialog-close-btn" onclick="this.closest('.orderbook-alert').remove()" title="关闭">
          <svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:#e53935;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">
        代码: ${code} | 现价: ${stockData.price.toFixed(2)} | 时间: ${new Date().toLocaleTimeString()}
      </div>
      ${alertsHTML}
      <div style="margin-top:12px;text-align:right;">
        <button onclick="this.closest('.orderbook-alert').remove()" style="font-size:13px;padding:4px 16px;border:1px solid #ff6b35;border-radius:4px;background:#ff6b35;color:#fff;cursor:pointer;">确认</button>
      </div>
    `;

    document.body.appendChild(popup);
    setTimeout(() => {
      if (popup.parentNode) popup.remove();
    }, 10000);
  }

  window.ztfi.watchlistAlert = {
    attach,
    startWatchlistAlertMonitor,
    stopWatchlistAlertMonitor,
  };
})();
