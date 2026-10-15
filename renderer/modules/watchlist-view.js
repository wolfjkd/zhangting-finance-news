/**
 * ztfi.watchlistView — 自选股视图（对话框 / 卡片 / 行情弹窗）
 *
 * 覆盖：showWatchlistDialog（分组列表 + 增删改 + 移动）、updateWatchlistBadge、
 *       createStockItemHTML、bindWatchlistItemEvents（含分时图）、showStockQuoteDialog。
 * 接缝：数据层已由 renderer/modules/history-storage.js（window.historyStorage）承载，
 *       本模块只做「视图 + 交互」，仅依赖极少 host 钩子：
 *   - showToast（app.js）
 *   - debugMode（DEBUG_MODE，仅用于一条调试日志）
 * 其余 esc/unwrapResult/apiHas/formatVolume/formatAmount 走 utils，$watchlistBadge 走 dom。
 * 加载顺序：core → utils → dom → … → watchlist-view → app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  let _host = null;
  function attach(host) { _host = host; }
  function H() { return _host; }
  function U() { return window.ztfi.utils; }
  function D() { return window.ztfi.dom; }

  // ===== 自选股功能 =====
  async function showWatchlistDialog() {
    if (!window.historyStorage) {
      console.warn('自选股功能未初始化');
      return;
    }

    try {
      const watchlist = await window.historyStorage.getAllWatchlist();
      const groups = await window.historyStorage.getAllWatchlistGroups();
      const count = await window.historyStorage.getWatchlistCount();

      const dialog = document.createElement('div');
      dialog.className = 'watchlist-dialog';

      // 生成分组列表HTML
      let listHTML = '';

      const allGroupIds = groups.map(g => g.id);
      const ungroupedStocks = watchlist.filter(s => !s.groupId || s.groupId === '' || s.groupId === 'ungrouped' || !allGroupIds.includes(s.groupId));
      if (ungroupedStocks.length > 0) {
        listHTML += `
          <div class="watchlist-group" data-group="ungrouped">
            <div class="watchlist-group-header">
              <span class="watchlist-group-name">未分组</span>
              <span class="watchlist-group-count">(${ungroupedStocks.length})</span>
            </div>
            <div class="watchlist-group-stocks">
              ${ungroupedStocks.map(stock => createStockItemHTML(stock)).join('')}
            </div>
          </div>
        `;
      }

      for (const group of groups) {
        const groupStocks = watchlist.filter(s => s.groupId === group.id);
        if (groupStocks.length > 0) {
          listHTML += `
            <div class="watchlist-group" data-group="${group.id}">
              <div class="watchlist-group-header">
                <span class="watchlist-group-name" data-group-id="${group.id}">${U().esc(group.name)}</span>
                <span class="watchlist-group-count">(${groupStocks.length})</span>
                <button class="watchlist-group-menu-btn" data-group="${group.id}">⋮</button>
                <div class="watchlist-group-menu" id="menu_${group.id}">
                  <button class="watchlist-group-rename" data-group="${group.id}">重命名</button>
                  <button class="watchlist-group-delete" data-group="${group.id}">删除分组</button>
                </div>
              </div>
              <div class="watchlist-group-stocks">
                ${groupStocks.map(stock => createStockItemHTML(stock)).join('')}
              </div>
            </div>
          `;
        }
      }

      if (watchlist.length === 0) {
        listHTML = '<div class="watchlist-empty">暂无自选股</div>';
      }

      dialog.innerHTML = `
        <div class="watchlist-header">
          <div class="watchlist-header-left">
            <h3>自选股</h3>
            <button class="watchlist-add-group-btn" id="watchlistAddGroupBtn" title="添加分组">+ 分组</button>
            <button class="watchlist-add-btn-header" id="watchlistAddBtnHeader" title="添加自选股">+ 自选</button>
            <span class="watchlist-count">${count} 只</span>
          </div>
          <button class="dialog-close-btn" title="关闭">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div class="watchlist-add-row" id="watchlistAddRow" style="display:none;">
          <input type="text" id="watchlistAddInput" placeholder="输入股票代码（如601868）" maxlength="6">
          <select id="watchlistAddGroupSelect">
            <option value="ungrouped">未分组</option>
            ${groups.map(g => `<option value="${g.id}">${U().esc(g.name)}</option>`).join('')}
          </select>
          <button class="watchlist-add-btn" id="watchlistAddBtn">添加</button>
        </div>
        <div class="watchlist-list">${listHTML}</div>
      `;

      document.body.appendChild(dialog);

      // 关闭按钮
      dialog.querySelector('.dialog-close-btn').addEventListener('click', () => {
        dialog.remove();
      });

      // "+ 添加"按钮 - 切换添加行显示
      const addBtnHeader = dialog.querySelector('#watchlistAddBtnHeader');
      const addRow = dialog.querySelector('#watchlistAddRow');
      if (addBtnHeader && addRow) {
        addBtnHeader.addEventListener('click', () => {
          const isVisible = addRow.style.display !== 'none';
          addRow.style.display = isVisible ? 'none' : 'flex';
          if (!isVisible) {
            dialog.querySelector('#watchlistAddInput').focus();
          }
        });
      }

      // 添加股票
      dialog.querySelector('#watchlistAddBtn').addEventListener('click', async () => {
        const input = dialog.querySelector('#watchlistAddInput');
        const select = dialog.querySelector('#watchlistAddGroupSelect');
        const code = input.value.trim();
        const groupId = select.value;

        if (!/^\d{6}$/.test(code)) {
          H().showToast('请输入6位股票代码', { type: 'warning' });
          return;
        }

        try {
          const result = await pywebview.api.get_stock_quote(code);
          const resp = U().unwrapResult(result);

          if (resp.status === 'ok' && resp.quote) {
            await window.historyStorage.addWatchlistStock({
              code: code,
              name: resp.quote.name
            }, groupId);

            updateWatchlistBadge();

            dialog.remove();
            showWatchlistDialog();
          } else {
            H().showToast('未找到该股票，请检查代码', { type: 'warning' });
          }
        } catch (err) {
          console.error('添加自选股失败:', err);
          H().showToast('添加失败: ' + err.message, { type: 'error' });
        }
      });

      // 添加分组按钮
      dialog.querySelector('#watchlistAddGroupBtn').addEventListener('click', async () => {
        const name = prompt('输入分组名称：');
        if (name && name.trim()) {
          await window.historyStorage.createWatchlistGroup(name.trim());
          dialog.remove();
          showWatchlistDialog();
        }
      });

      // 分组菜单按钮
      dialog.querySelectorAll('.watchlist-group-menu-btn').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const menu = btn.nextElementSibling;
          document.querySelectorAll('.watchlist-group-menu.show').forEach(m => {
            if (m !== menu) m.classList.remove('show');
          });
          menu.classList.toggle('show');
        };
      });

      // 重命名分组
      dialog.querySelectorAll('.watchlist-group-rename').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const groupId = btn.dataset.group;
          const groupName = btn.closest('.watchlist-group-header').querySelector('.watchlist-group-name').textContent;
          const newName = prompt('输入新名称：', groupName);
          if (newName && newName.trim()) {
            await window.historyStorage.renameWatchlistGroup(groupId, newName.trim());
            dialog.remove();
            showWatchlistDialog();
          }
        };
      });

      // 删除分组
      dialog.querySelectorAll('.watchlist-group-delete').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const groupId = btn.dataset.group;
          if (confirm('删除分组后，组内股票将移至"未分组"，确定删除？')) {
            await window.historyStorage.deleteWatchlistGroup(groupId);
            dialog.remove();
            showWatchlistDialog();
          }
        };
      });

      // 键盘事件
      dialog.querySelector('#watchlistAddInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          dialog.querySelector('#watchlistAddBtn').click();
        }
      });

      // 绑定股票项事件
      bindWatchlistItemEvents(dialog);

    } catch (err) {
      console.error('加载自选股列表失败:', err);
    }
  }

  async function updateWatchlistBadge() {
    if (!D().$watchlistBadge || !window.historyStorage) return;
    try {
      const count = await window.historyStorage.getWatchlistCount();
      if (count > 0) {
        D().$watchlistBadge.textContent = count;
        D().$watchlistBadge.style.display = 'inline';
      } else {
        D().$watchlistBadge.style.display = 'none';
      }
    } catch (e) {}
  }

  function createStockItemHTML(stock) {
    const threshold = stock.alertThreshold || 5;
    return `
      <div class="watchlist-item" data-code="${stock.code}">
        <button class="watchlist-remove-btn" title="移除自选股">×</button>
        <div class="watchlist-stock-info">
          <span class="watchlist-stock-name">${U().esc(stock.name || '未知')}</span>
          <span class="watchlist-stock-code">${U().esc(stock.code)}</span>
        </div>
        <div class="watchlist-threshold-control">
          <span class="watchlist-threshold-label">阈值</span>
          <input type="number" class="watchlist-threshold-input" value="${threshold}" min="0.1" max="50" step="0.1" title="设置预警阈值">
          <span class="watchlist-threshold-unit">%</span>
        </div>
        <button class="watchlist-move-btn" title="移动到分组">→</button>
        <button class="watchlist-quote-btn" title="查看行情">📊</button>
        <button class="watchlist-minute-btn" title="分时图">📈</button>
        <div class="watchlist-minute-container" style="display:none;">
          <canvas class="minute-chart-canvas"></canvas>
        </div>
      </div>
    `;
  }

  function bindWatchlistItemEvents(dialog) {
    // 移除按钮
    dialog.querySelectorAll('.watchlist-remove-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const item = btn.closest('.watchlist-item');
        const code = item.dataset.code;

        if (!confirm(`确定移除 ${code} 吗？`)) return;

        try {
          await window.historyStorage.removeWatchlistStock(code);
          item.remove();

          const newCount = await window.historyStorage.getWatchlistCount();
          dialog.querySelector('.watchlist-count').textContent = newCount + ' 只';
          updateWatchlistBadge();

          // 检查是否需要显示空状态
          const listEl = dialog.querySelector('.watchlist-list');
          if (listEl.querySelectorAll('.watchlist-item').length === 0) {
            listEl.innerHTML = '<div class="watchlist-empty">暂无自选股</div>';
          }
        } catch (err) {
          console.error('移除自选股失败:', err);
        }
      };
    });

    // 查看行情按钮
    dialog.querySelectorAll('.watchlist-quote-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const item = btn.closest('.watchlist-item');
        const code = item.dataset.code;
        await showStockQuoteDialog(code);
      };
    });

    // 分时图按钮
    dialog.querySelectorAll('.watchlist-minute-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const item = btn.closest('.watchlist-item');
        const code = item.dataset.code;
        const container = item.querySelector('.watchlist-minute-container');
        if (!container) return;

        // 切换显示
        const isVisible = container.style.display !== 'none';
        if (isVisible) {
          container.style.display = 'none';
          return;
        }
        container.style.display = 'block';

        // 检查 MinuteChart 是否可用
        if (typeof MinuteChart === 'undefined') {
          container.querySelector('.minute-chart-canvas').insertAdjacentHTML('beforebegin', '<div style="padding:8px;color:var(--text-secondary);font-size:12px;text-align:center;">分时图模块未加载</div>');
          return;
        }

        // 显示加载中
        const canvas = container.querySelector('.minute-chart-canvas');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary') || '#666';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('加载分时数据中...', canvas.width / 2, canvas.height / 2);

        try {
          if (!U().apiHas('get_stock_minutes')) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillText('后端接口不可用', canvas.width / 2, canvas.height / 2);
            return;
          }
          const result = await window.pywebview.api.get_stock_minutes(code);
          const data = U().unwrapResult(result);
          if (data.status !== 'ok' || !data.data) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillText(data.message || '无分时数据', canvas.width / 2, canvas.height / 2);
            return;
          }
          const chart = new MinuteChart(canvas);
          chart.setData(data.data);
          chart.draw();
        } catch (err) {
          console.error('加载分时图失败:', err);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#e53935';
          ctx.fillText('加载失败: ' + (err.message || ''), canvas.width / 2, canvas.height / 2);
        }
      };
    });

    // 移动到分组按钮
    dialog.querySelectorAll('.watchlist-move-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const item = btn.closest('.watchlist-item');
        const code = item.dataset.code;

        const groups = await window.historyStorage.getAllWatchlistGroups();

        // 显示分组选择对话框
        const menu = document.createElement('div');
        menu.className = 'watchlist-move-menu';
        menu.innerHTML = '<div class="watchlist-move-title">移动到分组</div>';

        const ungroupedBtn = document.createElement('button');
        ungroupedBtn.textContent = '未分组';
        ungroupedBtn.onclick = async () => {
          await window.historyStorage.updateWatchlistStockGroup(code, 'ungrouped');
          menu.remove();
          dialog.remove();
          showWatchlistDialog();
        };
        menu.appendChild(ungroupedBtn);

        for (const group of groups) {
          const groupBtn = document.createElement('button');
          groupBtn.textContent = group.name;
          groupBtn.onclick = async () => {
            await window.historyStorage.updateWatchlistStockGroup(code, group.id);
            menu.remove();
            dialog.remove();
            showWatchlistDialog();
          };
          menu.appendChild(groupBtn);
        }

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '取消';
        closeBtn.className = 'watchlist-move-close';
        closeBtn.onclick = () => menu.remove();
        menu.appendChild(closeBtn);

        document.body.appendChild(menu);

        // 定位菜单
        const rect = btn.getBoundingClientRect();
        menu.style.top = (rect.bottom + 5) + 'px';
        menu.style.left = rect.left + 'px';

        // 点击外部关闭
        setTimeout(() => {
          document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) {
              menu.remove();
              document.removeEventListener('click', closeMenu);
            }
          });
        }, 0);
      };
    });

    // 阈值输入框事件
    dialog.querySelectorAll('.watchlist-threshold-input').forEach(input => {
      input.addEventListener('change', async (e) => {
        const item = input.closest('.watchlist-item');
        const code = item.dataset.code;
        const threshold = parseFloat(input.value);

        if (isNaN(threshold) || threshold <= 0) {
          input.value = 5;
          return;
        }

        try {
          await window.historyStorage.updateWatchlistStockAlertThreshold(code, threshold);
          if (H().debugMode) console.log(`[自选股] 已更新 ${code} 的预警阈值为 ${threshold}%`);
        } catch (err) {
          console.error('更新预警阈值失败:', err);
          input.value = 5;
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          input.blur();
        }
      });
    });
  }

  async function showStockQuoteDialog(code) {
    try {
      const result = await pywebview.api.get_stock_quote(code);
      const resp = U().unwrapResult(result);

      if (resp.status !== 'ok' || !resp.quote) {
        H().showToast('获取行情失败', { type: 'error' });
        return;
      }

      const q = resp.quote;
      const changePercent = q.changePercent || 0;
      const changeClass = changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : '';
      const changeSign = changePercent > 0 ? '+' : '';

      const dialog = document.createElement('div');
      dialog.className = 'quote-dialog';

      dialog.innerHTML = `
        <div class="quote-header">
          <div>
            <h3>${U().esc(q.name)}</h3>
            <span class="quote-code">${U().esc(q.code)} · ${U().esc(q.market || '')}</span>
          </div>
          <button class="dialog-close-btn" title="关闭">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div class="quote-body">
          <div class="quote-price ${changeClass}">${q.price.toFixed(2)}</div>
          <div class="quote-change ${changeClass}">
            ${changeSign}${q.change?.toFixed(2) || '0.00'}
            (${changeSign}${changePercent.toFixed(2)}%)
          </div>
          <div class="quote-grid">
            <div class="quote-grid-item">
              <div class="quote-grid-label">今开</div>
              <div class="quote-grid-value">${q.open?.toFixed(2) || '--'}</div>
            </div>
            <div class="quote-grid-item">
              <div class="quote-grid-label">昨收</div>
              <div class="quote-grid-value">${q.yesterdayClose?.toFixed(2) || '--'}</div>
            </div>
            <div class="quote-grid-item">
              <div class="quote-grid-label">最高</div>
              <div class="quote-grid-value up">${q.high?.toFixed(2) || '--'}</div>
            </div>
            <div class="quote-grid-item">
              <div class="quote-grid-label">最低</div>
              <div class="quote-grid-value down">${q.low?.toFixed(2) || '--'}</div>
            </div>
            <div class="quote-grid-item">
              <div class="quote-grid-label">成交量</div>
              <div class="quote-grid-value">${U().formatVolume(q.volume || 0)}</div>
            </div>
            <div class="quote-grid-item">
              <div class="quote-grid-label">成交额</div>
              <div class="quote-grid-value">${U().formatAmount(q.amount || 0)}</div>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(dialog);

      dialog.querySelector('.dialog-close-btn').addEventListener('click', () => {
        dialog.remove();
      });

    } catch (err) {
      console.error('显示行情失败:', err);
      H().showToast('获取行情失败: ' + err.message, { type: 'error' });
    }
  }

  window.ztfi.watchlistView = {
    attach,
    showWatchlistDialog,
    updateWatchlistBadge,
    createStockItemHTML,
    bindWatchlistItemEvents,
    showStockQuoteDialog,
  };
})();
