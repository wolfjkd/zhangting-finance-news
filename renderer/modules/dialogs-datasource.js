/**
 * ztfi.dialogsDataSource — 数据源管理对话框群
 *
 * 覆盖：数据源列表（开关 / 测试 / 配置入口）、Tushare 配置弹窗、Wind 高级设置弹窗，
 *       以及开启数据源前的「Token/API Key 已配置」前置依赖检查。
 * 接缝：几乎全是「DOM 构建 + pywebview 调用」，只依赖：
 *   - showToast（app.js）
 *   - utils.esc
 *   后端调用（get_data_sources / enable_data_source / test_data_source / tushare / wind 系列）走 window.pywebview。
 * 加载顺序：core → utils → … → dialogs-datasource → app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  let _host = null;
  function attach(host) { _host = host; }
  function H() { return _host; }
  function U() { return window.ztfi.utils; }

  /**
   * 数据源开启前置依赖检查
   * @returns {object|null} 返回 {message, action} 表示不满足依赖；返回 null 表示通过
   * 注意：tushare/wind 的 Token 检查是异步的（要读配置文件），但 UI 层开关是同步事件——
   * 这里只做本地缓存检查（settings 内的标记），后端实际连接失败会有日志兜底。
   * akshare_beta 的模块检测是纯前端无法做的（akshare 装在 Python 环境），
   * 所以这里只覆盖 tushare/wind 的 Token 配置检查。
   */
  function checkSourceDependency(sourceId) {
    // 读取缓存的 Token 配置状态（由后端定期同步到 settings 对象）
    // 这里用 localStorage 兜底，避免首次开启就需要等后端
    if (sourceId === 'tushare') {
      const tokenReady = localStorage.getItem('tushare_token_configured') === '1';
      if (!tokenReady) {
        return {
          message: 'Tushare 需要 Token 才能工作，请先配置',
          action: {
            label: '去配置 Token',
            callback: () => showTushareConfigDialog()
          }
        };
      }
    }
    if (sourceId === 'wind') {
      const keyReady = localStorage.getItem('wind_apikey_configured') === '1';
      if (!keyReady) {
        return {
          message: 'Wind 需要 API Key 才能工作，请先配置',
          action: {
            label: '去配置 API Key',
            callback: () => showWindConfigDialog()
          }
        };
      }
    }
    // akshare_beta: 纯前端无法检测 Python 模块，跳过——用户开启后如果没消息，
    // 可以通过"测试"按钮定位（已有功能）
    // 其他源（eastmoney/research/northbound 等）：无外部依赖，直接放行
    return null;
  }

  // 数据源管理对话框
  async function showDataSourceDialog() {
    if (!window.pywebview || !window.pywebview.api) {
      H().showToast('数据源管理需要 pywebview 后端支持，请稍后重试', { type: 'warning' });
      return;
    }
    try {
      const resp = await pywebview.api.get_data_sources();
      const data = JSON.parse(resp);
      if (data.status !== 'ok') { H().showToast('获取数据源失败', { type: 'error' }); return; }
      const sources = data.sources || [];
      const dialog = document.createElement('div');
      dialog.className = 'datasource-overlay';
      // 需要"配置"按钮的数据源
      const configableIds = ['tushare', 'wind'];
      dialog.innerHTML = `
        <div class="datasource-panel">
          <div class="datasource-header">
            <span class="datasource-title">数据源管理</span>
            <button class="dialog-close-btn" title="关闭">
              <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
          <div class="datasource-list">
            ${sources.map(s => `
              <div class="datasource-item" data-source-id="${s.id}">
                <div class="datasource-item-left">
                  <div class="datasource-status-dot ${s.enabled ? 'dot-on' : 'dot-off'}"></div>
                  <div class="datasource-info">
                    <div class="datasource-name">${U().esc(s.name)}</div>
                    <div class="datasource-desc">${U().esc(s.description || '')}</div>
                  </div>
                </div>
                <div class="datasource-item-right">
                  ${configableIds.includes(s.id) ? `<button class="datasource-config-btn" data-source-id="${s.id}" title="配置 ${U().esc(s.name)} 的 Token/API Key" aria-label="配置 ${U().esc(s.name)}"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l0,0l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94l-0.36-2.54c-0.05-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41l-0.36,2.54c-0.59,0.24-1.13,0.57-1.62,0.94l-2.39-0.96c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87c-0.12,0.21-0.08,0.47,0.12,0.61l2.03,1.58l0,0C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l0,0l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.43-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.57,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.2,0.07-0.47-0.12-0.61L19.14,12.94L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg></button>` : ''}
                  <button class="datasource-test-btn" data-source-id="${s.id}">测试</button>
                  <label class="datasource-toggle">
                    <input type="checkbox" ${s.enabled ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
            `).join('')}
          </div>
          <div class="datasource-test-result"></div>
        </div>
      `;
      document.body.appendChild(dialog);
      dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });
      dialog.querySelector('.dialog-close-btn').addEventListener('click', () => dialog.remove());
      dialog.querySelectorAll('.datasource-toggle input').forEach(input => {
        input.addEventListener('change', async (e) => {
          const item = e.target.closest('.datasource-item');
          const sourceId = item.dataset.sourceId;
          const enabled = e.target.checked;

          // 前置检测：开启需要 Token/模块的源时，检查依赖是否就绪
          if (enabled) {
            const checkResult = checkSourceDependency(sourceId);
            if (checkResult) {  // 返回非空表示不满足
              H().showToast(checkResult.message, {
                type: 'warning',
                action: checkResult.action
              });
              e.target.checked = false;  // 回滚开关
              item.querySelector('.datasource-status-dot').className = 'datasource-status-dot dot-off';
              return;
            }
          }

          try {
            const apiMethod = enabled ? 'enable_data_source' : 'disable_data_source';
            await pywebview.api[apiMethod](sourceId);
            item.querySelector('.datasource-status-dot').className = `datasource-status-dot ${enabled ? 'dot-on' : 'dot-off'}`;
            H().showToast(enabled ? '数据源已启用' : '数据源已关闭', { type: enabled ? 'success' : 'info', duration: 1500 });
          } catch (err) {
            H().showToast('操作失败: ' + err.message, { type: 'error' });
            e.target.checked = !enabled;
          }
        });
      });
      dialog.querySelectorAll('.datasource-test-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const sourceId = btn.dataset.sourceId;
          const resultDiv = dialog.querySelector('.datasource-test-result');
          btn.disabled = true; btn.textContent = '测试中...';
          try {
            const resp = await pywebview.api.test_data_source(sourceId);
            const d = JSON.parse(resp); const r = d.result || {};
            resultDiv.textContent = `${r.success ? '✓' : '✗'} ${r.message || '连接失败'}${r.latency ? ' (' + r.latency + 'ms)' : ''}`;
            resultDiv.style.color = r.success ? '#4caf50' : '#f44336';
          } catch (err) { resultDiv.textContent = '测试失败: ' + err.message; resultDiv.style.color = '#f44336'; }
          btn.disabled = false; btn.textContent = '测试';
        });
      });
      // 配置按钮
      dialog.querySelectorAll('.datasource-config-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const sourceId = btn.dataset.sourceId;
          if (sourceId === 'tushare') showTushareConfigDialog();
          else if (sourceId === 'wind') showWindConfigDialog();
        });
      });
    } catch (e) { H().showToast('数据源管理加载失败: ' + e.message, { type: 'error' }); }
  }

  // ===== Tushare 配置弹窗 =====
  async function showTushareConfigDialog() {
    if (!window.pywebview || !window.pywebview.api) return;
    let currentData = null;
    try {
      const resp = await pywebview.api.get_tushare_config();
      currentData = JSON.parse(resp);
      // 同步 Token 已配置标记供前置检测
      if (currentData.status === 'ok' && currentData.has_token) {
        localStorage.setItem('tushare_token_configured', '1');
      } else {
        localStorage.removeItem('tushare_token_configured');
      }
    } catch (e) { H().showToast('加载 Tushare 配置失败: ' + e.message, { type: 'error' }); return; }

    const dialog = document.createElement('div');
    dialog.className = 'datasource-overlay';
    dialog.innerHTML = `
      <div class="datasource-panel">
        <div class="datasource-header">
          <span class="datasource-title">Tushare 配置</span>
          <button class="dialog-close-btn" title="关闭">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div class="datasource-config-body">
          <div class="config-row">
            <label class="config-label">API Token</label>
            <input type="password" id="tushare-token-input" class="config-input" placeholder="粘贴 Tushare Pro Token" autocomplete="off">
            <div class="config-hint" id="tushare-token-hint">
              ${currentData.status === 'ok' && currentData.has_token ? '当前 Token: ' + U().esc(currentData.token_masked) : '尚未配置 Token'}
            </div>
          </div>
          <div class="config-actions">
            <button id="tushare-save-btn" class="config-save-btn">保存 Token</button>
            <button id="tushare-detect-btn" class="config-secondary-btn">检测接口权限</button>
          </div>
          <div class="config-row">
            <label class="config-label">可用接口</label>
            <div id="tushare-apis-list" class="config-apis">
              <div class="config-hint">点击"检测接口权限"按钮，自动探测 Token 可用的接口</div>
            </div>
          </div>
          <div class="config-tip">
            <div class="config-tip-title">提示</div>
            <div>· Token 获取：<a href="#" id="tushare-reg-link">tushare.pro</a> 注册后在个人主页复制</div>
            <div>· 免费权限：日线行情、股票基础信息</div>
            <div>· 高积分权限：财经新闻、资金流向、龙虎榜、涨停板</div>
            <div>· 接口按 Token 权限自动开放，无需手动选择</div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });
    dialog.querySelector('.dialog-close-btn').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#tushare-reg-link').addEventListener('click', (e) => {
      e.preventDefault();
      window.open('https://tushare.pro/register', '_blank');
    });
    // 保存 Token
    dialog.querySelector('#tushare-save-btn').addEventListener('click', async () => {
      const token = dialog.querySelector('#tushare-token-input').value.trim();
      if (!token) { H().showToast('请输入 Token', { type: 'warning' }); return; }
      try {
        const resp = await pywebview.api.save_tushare_token(token);
        const d = JSON.parse(resp);
        if (d.status === 'ok') {
          localStorage.setItem('tushare_token_configured', '1');  // 同步标记供前置检测
          H().showToast('Tushare Token 保存成功', { type: 'success' });
          // 刷新显示
          const cfgResp = await pywebview.api.get_tushare_config();
          const cfg = JSON.parse(cfgResp);
          if (cfg.status === 'ok') {
            dialog.querySelector('#tushare-token-hint').textContent = '当前 Token: ' + cfg.token_masked;
          }
          dialog.querySelector('#tushare-token-input').value = '';
        } else {
          H().showToast('保存失败', { type: 'error' });
        }
      } catch (err) { H().showToast('保存失败: ' + err.message, { type: 'error' }); }
    });
    // 检测接口权限
    dialog.querySelector('#tushare-detect-btn').addEventListener('click', async () => {
      const apisDiv = dialog.querySelector('#tushare-apis-list');
      apisDiv.innerHTML = '<div class="config-hint">检测中...</div>';
      try {
        const resp = await pywebview.api.get_tushare_apis();
        const d = JSON.parse(resp);
        if (d.status === 'ok' && d.detected) {
          if (d.apis && d.apis.length > 0) {
            apisDiv.innerHTML = d.apis.map(a => `
              <div class="config-api-item">
                <span class="api-name">${U().esc(a.name)}</span>
                <span class="api-desc">${U().esc(a.desc)}</span>
              </div>
            `).join('');
          } else {
            apisDiv.innerHTML = '<div class="config-hint">未检测到可用接口，请检查 Token 权限</div>';
          }
        } else {
          apisDiv.innerHTML = '<div class="config-hint">' + U().esc(d.message || '检测失败') + '</div>';
        }
      } catch (err) {
        apisDiv.innerHTML = '<div class="config-hint">检测失败: ' + U().esc(err.message) + '</div>';
      }
    });
  }

  // ===== Wind 独立设置页弹窗 =====
  async function showWindConfigDialog() {
    if (!window.pywebview || !window.pywebview.api) return;
    let cfg = null;
    try {
      const resp = await pywebview.api.get_wind_config();
      const d = JSON.parse(resp);
      if (d.status === 'ok') cfg = d.config;
      else { H().showToast('加载 Wind 配置失败: ' + (d.message || ''), { type: 'error' }); return; }
      // 同步 API Key 已配置标记供前置检测
      if (cfg && cfg.api_key_masked) {
        localStorage.setItem('wind_apikey_configured', '1');
      } else {
        localStorage.removeItem('wind_apikey_configured');
      }
    } catch (e) { H().showToast('加载 Wind 配置失败: ' + e.message, { type: 'error' }); return; }

    const modules = cfg.modules || {};
    const news = modules.news || {};
    const ann = modules.announcements || {};
    const macro = modules.macro || {};

    const dialog = document.createElement('div');
    dialog.className = 'datasource-overlay';
    dialog.innerHTML = `
      <div class="datasource-panel wind-panel">
        <div class="datasource-header">
          <span class="datasource-title">Wind 高级设置</span>
          <button class="dialog-close-btn" title="关闭">
            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
        <div class="datasource-config-body wind-config-body">
          <!-- API Key -->
          <div class="config-section">
            <div class="config-section-title">API Key</div>
            <div class="config-row">
              <input type="password" id="wind-apikey-input" class="config-input" placeholder="粘贴 Wind API Key" autocomplete="off">
              <div class="config-hint" id="wind-apikey-hint">
                ${cfg.has_api_key ? '当前 Key: ' + U().esc(cfg.api_key_masked) : '尚未配置 API Key'}
              </div>
            </div>
            <div class="config-actions">
              <button id="wind-save-key-btn" class="config-save-btn">保存 Key</button>
            </div>
          </div>

          <!-- 额度 -->
          <div class="config-section">
            <div class="config-section-title">日额度</div>
            <div class="config-quota" id="wind-quota-display">
              <span>${cfg.daily_quota_used || 0} / ${cfg.daily_quota_limit || 500}</span>
              <span class="config-hint">(日期: ${U().esc(cfg.daily_quota_date || '未记录')})</span>
              <button id="wind-refresh-quota-btn" class="config-secondary-btn">刷新</button>
            </div>
          </div>

          <!-- 模块1: 财经新闻 -->
          <div class="config-section">
            <div class="config-section-title">
              <label class="datasource-toggle">
                <input type="checkbox" id="wind-news-enabled" ${news.enabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
              模块1：财经新闻 RAG
            </div>
            <div class="config-row">
              <label class="config-label">关键词（逗号分隔，最多 5 个）</label>
              <input type="text" id="wind-news-keywords" class="config-input" 
                     value="${U().esc((news.keywords || []).join(', '))}" 
                     placeholder="如: 半导体, 新能源, 央行">
            </div>
            <div class="config-row">
              <label class="config-label">每次返回条数 (top_k)</label>
              <input type="number" id="wind-news-topk" class="config-input" 
                     value="${news.top_k || 5}" min="1" max="20" style="width:80px">
            </div>
          </div>

          <!-- 模块2: 上市公司公告 -->
          <div class="config-section">
            <div class="config-section-title">
              <label class="datasource-toggle">
                <input type="checkbox" id="wind-ann-enabled" ${ann.enabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
              模块2：上市公司公告
            </div>
            <div class="config-row">
              <label class="config-label">关注股票（逗号分隔，留空则按公告类型）</label>
              <input type="text" id="wind-ann-stocks" class="config-input" 
                     value="${U().esc((ann.watch_stocks || []).join(', '))}" 
                     placeholder="如: 贵州茅台, 中国平安">
            </div>
            <div class="config-row">
              <label class="config-label">公告类型（逗号分隔）</label>
              <input type="text" id="wind-ann-types" class="config-input" 
                     value="${U().esc((ann.types || []).join(', '))}" 
                     placeholder="如: 定报, 重大事项, 分红">
            </div>
          </div>

          <!-- 模块3: 宏观经济指标 -->
          <div class="config-section">
            <div class="config-section-title">
              <label class="datasource-toggle">
                <input type="checkbox" id="wind-macro-enabled" ${macro.enabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
              模块3：宏观经济指标
            </div>
            <div class="config-row">
              <label class="config-label">监控指标（逗号分隔）</label>
              <input type="text" id="wind-macro-indicators" class="config-input" 
                     value="${U().esc((macro.indicators || []).join(', '))}" 
                     placeholder="如: CPI, PPI, PMI, 社融">
            </div>
          </div>

          <div class="config-actions config-actions-bottom">
            <button id="wind-save-modules-btn" class="config-save-btn">保存模块配置</button>
            <button id="wind-test-btn" class="config-secondary-btn">测试连接</button>
          </div>
          <div class="config-tip">
            <div class="config-tip-title">说明</div>
            <div>· API Key 获取：<a href="#" id="wind-portal-link">aifinmarket.wind.com.cn</a> 开发者中心</div>
            <div>· Wind 通过 MCP 协议直连，3 个模块独立开关、独立轮询</div>
            <div>· 公告每 5 轮、宏观每 10 轮抓取一次（按数据更新频率优化）</div>
            <div>· 日额度耗尽后将自动停止调用，次日重置</div>
          </div>
          <div class="wind-test-result"></div>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });
    dialog.querySelector('.dialog-close-btn').addEventListener('click', () => dialog.remove());
    dialog.querySelector('#wind-portal-link').addEventListener('click', (e) => {
      e.preventDefault();
      window.open('https://aifinmarket.wind.com.cn/#/user/overview', '_blank');
    });
    // 保存 API Key
    dialog.querySelector('#wind-save-key-btn').addEventListener('click', async () => {
      const key = dialog.querySelector('#wind-apikey-input').value.trim();
      if (!key) { H().showToast('请输入 API Key', { type: 'warning' }); return; }
      try {
        const resp = await pywebview.api.save_wind_api_key(key);
        const d = JSON.parse(resp);
        if (d.status === 'ok') {
          localStorage.setItem('wind_apikey_configured', '1');  // 同步标记供前置检测
          H().showToast('Wind API Key 保存成功', { type: 'success' });
          const cfgResp = await pywebview.api.get_wind_config();
          const cfgD = JSON.parse(cfgResp);
          if (cfgD.status === 'ok') {
            dialog.querySelector('#wind-apikey-hint').textContent = '当前 Key: ' + cfgD.config.api_key_masked;
          }
          dialog.querySelector('#wind-apikey-input').value = '';
        } else { H().showToast('保存失败', { type: 'error' }); }
      } catch (err) { H().showToast('保存失败: ' + err.message, { type: 'error' }); }
    });
    // 保存模块配置
    dialog.querySelector('#wind-save-modules-btn').addEventListener('click', async () => {
      const newsKeywords = dialog.querySelector('#wind-news-keywords').value
        .split(',').map(s => s.trim()).filter(s => s).slice(0, 5);
      const annStocks = dialog.querySelector('#wind-ann-stocks').value
        .split(',').map(s => s.trim()).filter(s => s);
      const annTypes = dialog.querySelector('#wind-ann-types').value
        .split(',').map(s => s.trim()).filter(s => s);
      const macroIndicators = dialog.querySelector('#wind-macro-indicators').value
        .split(',').map(s => s.trim()).filter(s => s);
      const modules = {
        news: {
          enabled: dialog.querySelector('#wind-news-enabled').checked,
          keywords: newsKeywords,
          top_k: parseInt(dialog.querySelector('#wind-news-topk').value) || 5,
        },
        announcements: {
          enabled: dialog.querySelector('#wind-ann-enabled').checked,
          watch_stocks: annStocks,
          types: annTypes,
        },
        macro: {
          enabled: dialog.querySelector('#wind-macro-enabled').checked,
          indicators: macroIndicators,
        },
      };
      try {
        const resp = await pywebview.api.save_wind_modules(JSON.stringify(modules));
        const d = JSON.parse(resp);
        if (d.status === 'ok') {
          H().showToast('模块配置已保存', { type: 'success' });
        } else { H().showToast('保存失败', { type: 'error' }); }
      } catch (err) { H().showToast('保存失败: ' + err.message, { type: 'error' }); }
    });
    // 刷新额度
    dialog.querySelector('#wind-refresh-quota-btn').addEventListener('click', async () => {
      try {
        const resp = await pywebview.api.get_wind_quota();
        const d = JSON.parse(resp);
        if (d.status === 'ok') {
          dialog.querySelector('#wind-quota-display').innerHTML = `
            <span>${d.used} / ${d.limit}</span>
            <span class="config-hint">(日期: ${U().esc(d.date)})</span>
            <button id="wind-refresh-quota-btn" class="config-secondary-btn">刷新</button>
          `;
          // 重新绑定刷新按钮
          dialog.querySelector('#wind-refresh-quota-btn').addEventListener('click', () => {
            dialog.querySelector('#wind-refresh-quota-btn').click();
          });
        }
      } catch (err) { H().showToast('刷新失败: ' + err.message, { type: 'error' }); }
    });
    // 测试连接
    dialog.querySelector('#wind-test-btn').addEventListener('click', async () => {
      const resultDiv = dialog.querySelector('.wind-test-result');
      const btn = dialog.querySelector('#wind-test-btn');
      btn.disabled = true; btn.textContent = '测试中...';
      try {
        const resp = await pywebview.api.test_data_source('wind');
        const d = JSON.parse(resp); const r = d.result || {};
        resultDiv.textContent = `${r.success ? '✓' : '✗'} ${r.message || '连接失败'}${r.latency ? ' (' + r.latency + 'ms)' : ''}`;
        resultDiv.style.color = r.success ? '#4caf50' : '#f44336';
      } catch (err) {
        resultDiv.textContent = '测试失败: ' + err.message;
        resultDiv.style.color = '#f44336';
      }
      btn.disabled = false; btn.textContent = '测试连接';
    });
  }

  window.ztfi.dialogsDataSource = {
    attach,
    checkSourceDependency,
    showDataSourceDialog,
    showTushareConfigDialog,
    showWindConfigDialog,
  };
})();
