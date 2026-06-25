/**
 * UI增强模块
 * 整合所有新功能到主界面
 */

class UIEnhancements {
  constructor() {
    this.modules = {};
    this.initialized = false;
    
    // 功能开关
    this.features = {
      classification: true,
      stockQuote: true,
      history: true,
      dataSources: true,
      multiWindow: false, // 暂时关闭多窗口
      export: true
    };
    
    this.init();
  }

  /**
   * 初始化UI增强
   */
  async init() {
    console.log('UI增强模块初始化');
    
    try {
      // 等待主界面加载
      await this.waitForMainUI();
      
      // 初始化子模块
      await this.initModules();
      
      // 绑定事件
      this.bindEvents();
      
      // 注入样式
      this.injectStyles();
      
      this.initialized = true;
      console.log('UI增强模块初始化完成');
      
    } catch (e) {
      console.error('UI增强模块初始化失败:', e);
    }
  }

  /**
   * 等待主界面加载
   */
  waitForMainUI() {
    return new Promise((resolve) => {
      const check = () => {
        if (document.getElementById('newsList') && window.newsClassifier) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  /**
   * 初始化子模块
   */
  async initModules() {
    // 新闻分类器
    if (this.features.classification && window.newsClassifier) {
      this.modules.classifier = window.newsClassifier;
      console.log('新闻分类器已加载');
    }
    
    // 股票行情
    if (this.features.stockQuote && window.stockQuoteManager) {
      this.modules.stockQuote = window.stockQuoteManager;
      console.log('股票行情模块已加载');
    }
    
    // 历史存储
    if (this.features.history && window.historyStorage) {
      this.modules.history = window.historyStorage;
      console.log('历史存储模块已加载');
    }
    
    // 数据源管理
    if (this.features.dataSources && window.dataSourceManager) {
      this.modules.dataSources = window.dataSourceManager;
      console.log('数据源管理模块已加载');
    }
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    // 监听新消息事件
    window.addEventListener('newMessage', (event) => {
      this.handleNewMessage(event.detail);
    });
    
    // 监听关键词触发事件
    window.addEventListener('keywordAlert', (event) => {
      this.handleKeywordAlert(event.detail);
    });
    
    // 监听股票点击事件
    document.addEventListener('click', (event) => {
      if (event.target.classList.contains('stock-tag')) {
        this.handleStockClick(event.target.dataset.code);
      }
    });
    
    // 监听导出按钮
    const exportBtn = document.getElementById('btnExport');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.showExportDialog());
    }
    
    // 监听历史搜索按钮
    const historyBtn = document.getElementById('btnHistory');
    if (historyBtn) {
      historyBtn.addEventListener('click', () => this.showHistoryDialog());
    }
    
    // 监听数据源管理按钮
    const dataSourceBtn = document.getElementById('btnDataSources');
    if (dataSourceBtn) {
      dataSourceBtn.addEventListener('click', () => this.showDataSourceDialog());
    }
  }

  /**
   * 注入样式
   */
  injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* 新闻标签样式 */
      .news-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin: 4px 0;
      }
      
      .news-tag {
        display: inline-flex;
        align-items: center;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 500;
        white-space: nowrap;
      }
      
      .priority-badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      
      .priority-critical {
        animation: pulse 1s infinite;
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }
      
      /* 股票标签样式 */
      .stock-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin: 4px 0;
      }
      
      .stock-tag {
        display: inline-flex;
        align-items: center;
        padding: 2px 6px;
        background-color: #e3f2fd;
        color: #1976d2;
        border-radius: 4px;
        font-size: 11px;
        cursor: pointer;
        transition: background-color 0.2s;
      }
      
      .stock-tag:hover {
        background-color: #bbdefb;
      }
      
      /* 股票行情样式 */
      .stock-quote {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        background-color: #f5f5f5;
        border-radius: 4px;
        font-size: 12px;
      }
      
      .stock-name {
        font-weight: 500;
        color: #333;
      }
      
      .stock-price {
        font-weight: 600;
      }
      
      .stock-change {
        font-size: 11px;
      }
      
      /* 消息卡片增强 */
      .news-item-enhanced {
        border-left: 3px solid transparent;
        transition: border-color 0.2s;
      }
      
      .news-item-enhanced.priority-critical {
        border-left-color: #FF0000;
        background-color: #fff5f5;
      }
      
      .news-item-enhanced.priority-high {
        border-left-color: #FF6B35;
        background-color: #fff8f0;
      }
      
      .news-item-enhanced.priority-medium {
        border-left-color: #FFC107;
        background-color: #fffdf0;
      }
      
      /* 导出对话框样式 */
      .export-dialog {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        z-index: 10000;
        width: 500px;
        max-height: 80vh;
        overflow-y: auto;
      }
      
      .export-header {
        padding: 20px;
        border-bottom: 1px solid #eee;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .export-content {
        padding: 20px;
      }
      
      .export-options {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      
      .export-option {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .export-option input[type="checkbox"] {
        width: 16px;
        height: 16px;
      }
      
      .export-buttons {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 20px;
        border-top: 1px solid #eee;
      }
      
      .btn-export {
        padding: 8px 16px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
      }
      
      .btn-export.primary {
        background-color: #2196F3;
        color: white;
      }
      
      .btn-export.secondary {
        background-color: #f5f5f5;
        color: #333;
      }
      
      /* 历史搜索对话框样式 */
      .history-dialog {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        z-index: 10000;
        width: 700px;
        max-height: 80vh;
        overflow-y: auto;
      }
      
      .history-header {
        padding: 20px;
        border-bottom: 1px solid #eee;
      }
      
      .history-search {
        display: flex;
        gap: 8px;
        margin-top: 12px;
      }
      
      .history-search input {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid #ddd;
        border-radius: 6px;
        font-size: 14px;
      }
      
      .history-search button {
        padding: 8px 16px;
        background-color: #2196F3;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
      }
      
      .history-filters {
        display: flex;
        gap: 8px;
        margin-top: 12px;
        flex-wrap: wrap;
      }
      
      .filter-select {
        padding: 6px 10px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 12px;
      }
      
      .history-results {
        padding: 20px;
        max-height: 400px;
        overflow-y: auto;
      }
      
      .history-item {
        padding: 12px;
        border: 1px solid #eee;
        border-radius: 8px;
        margin-bottom: 8px;
      }
      
      .history-item-title {
        font-weight: 600;
        margin-bottom: 4px;
      }
      
      .history-item-meta {
        font-size: 12px;
        color: #666;
        display: flex;
        gap: 12px;
      }
      
      .history-item-content {
        margin-top: 8px;
        font-size: 13px;
        color: #444;
      }
      
      /* 数据源管理对话框样式 */
      .datasource-dialog {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        z-index: 10000;
        width: 600px;
        max-height: 80vh;
        overflow-y: auto;
      }
      
      .datasource-header {
        padding: 20px;
        border-bottom: 1px solid #eee;
      }
      
      .datasource-list {
        padding: 20px;
      }
      
      .datasource-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px;
        border: 1px solid #eee;
        border-radius: 8px;
        margin-bottom: 8px;
      }
      
      .datasource-info {
        flex: 1;
      }
      
      .datasource-name {
        font-weight: 600;
        margin-bottom: 4px;
      }
      
      .datasource-desc {
        font-size: 12px;
        color: #666;
      }
      
      .datasource-status {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .status-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }
      
      .status-connected {
        background-color: #4CAF50;
      }
      
      .status-disconnected {
        background-color: #f44336;
      }
      
      .datasource-toggle {
        position: relative;
        width: 44px;
        height: 24px;
      }
      
      .datasource-toggle input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      
      .toggle-slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: #ccc;
        transition: .4s;
        border-radius: 24px;
      }
      
      .toggle-slider:before {
        position: absolute;
        content: "";
        height: 16px;
        width: 16px;
        left: 4px;
        bottom: 4px;
        background-color: white;
        transition: .4s;
        border-radius: 50%;
      }
      
      input:checked + .toggle-slider {
        background-color: #2196F3;
      }
      
      input:checked + .toggle-slider:before {
        transform: translateX(20px);
      }
      
      /* 通知样式增强 */
      .kw-alert-notification.enhanced {
        border-left: 4px solid #FF0000;
      }
      
      .kw-alert-notification.enhanced .kw-alert-header {
        background-color: #fff5f5;
      }
    `;
    
    document.head.appendChild(style);
  }

  /**
   * 处理新消息
   */
  async handleNewMessage(message) {
    try {
      // 1. 分类和优先级判断
      let classification = null;
      if (this.modules.classifier) {
        classification = this.modules.classifier.classifyNews(message.title, message.content);
        message.classification = classification;
        message.category = classification.categories[0]?.name || '未分类';
        message.priority = classification.priority;
        message.stocks = classification.stocks;
        message.keywords = classification.keywords;
      }
      
      // 2. 获取股票行情
      if (this.modules.stockQuote && classification?.stocks?.length > 0) {
        const quotes = await this.modules.stockQuote.batchGetQuotes(classification.stocks);
        message.stockQuotes = quotes;
      }
      
      // 3. 存储到历史
      if (this.modules.history) {
        await this.modules.history.storeMessage(message);
      }
      
      // 4. 增强消息显示
      this.enhanceMessageDisplay(message);
      
    } catch (e) {
      console.error('处理新消息失败:', e);
    }
  }

  /**
   * 增强消息显示
   */
  enhanceMessageDisplay(message) {
    // 找到对应的消息元素
    const messageElements = document.querySelectorAll('.news-item');
    let targetElement = null;
    
    messageElements.forEach(el => {
      if (el.dataset.aid === message.aid) {
        targetElement = el;
      }
    });
    
    if (!targetElement) return;
    
    // 添加分类标签
    if (message.classification) {
      const tagsHTML = this.modules.classifier.getCategoryTagsHTML(message.classification);
      const priorityHTML = this.modules.classifier.getPriorityBadgeHTML(message.classification);
      const stockTagsHTML = this.modules.classifier.getStockTagsHTML(message.classification);
      
      const tagsContainer = document.createElement('div');
      tagsContainer.className = 'news-tags';
      tagsContainer.innerHTML = `${priorityHTML} ${tagsHTML}`;
      
      const contentElement = targetElement.querySelector('.news-content') || targetElement;
      contentElement.insertBefore(tagsContainer, contentElement.firstChild);
      
      // 添加股票标签
      if (stockTagsHTML) {
        const stockContainer = document.createElement('div');
        stockContainer.innerHTML = stockTagsHTML;
        contentElement.appendChild(stockContainer);
      }
      
      // 添加股票行情
      if (message.stockQuotes) {
        Object.entries(message.stockQuotes).forEach(([code, quote]) => {
          const quoteHTML = this.modules.stockQuote.generateQuoteHTML(code, quote);
          const quoteContainer = document.createElement('div');
          quoteContainer.className = 'stock-quotes';
          quoteContainer.innerHTML = quoteHTML;
          contentElement.appendChild(quoteContainer);
        });
      }
      
      // 根据优先级添加样式
      targetElement.classList.add('news-item-enhanced');
      targetElement.classList.add(`priority-${message.priority}`);
    }
  }

  /**
   * 处理关键词触发
   */
  handleKeywordAlert(detail) {
    // 增强关键词通知
    if (detail.priority === 'critical' || detail.priority === 'high') {
      this.showEnhancedNotification(detail);
    }
  }

  /**
   * 显示增强通知
   */
  showEnhancedNotification(detail) {
    const notification = document.createElement('div');
    notification.className = 'kw-alert-notification enhanced';
    notification.innerHTML = `
      <div class="kw-alert-header">
        <span class="kw-alert-icon">🚨</span>
        <span class="kw-alert-title">重要消息提醒</span>
        <span class="kw-alert-close">&times;</span>
      </div>
      <div class="kw-alert-body">
        <div class="kw-alert-keyword">关键词: ${detail.keyword}</div>
        <div class="kw-alert-message">${detail.title}</div>
        ${detail.stocks ? `<div class="kw-alert-stocks">相关股票: ${detail.stocks.join(', ')}</div>` : ''}
      </div>
    `;
    
    document.body.appendChild(notification);
    
    // 绑定关闭事件
    notification.querySelector('.kw-alert-close').addEventListener('click', () => {
      notification.remove();
    });
    
    // 自动关闭
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 8000);
    
    // 播放增强声音
    this.playEnhancedAlertSound(detail.priority);
  }

  /**
   * 播放增强警报声音
   */
  playEnhancedAlertSound(priority) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      
      const sounds = {
        'critical': [
          { freq: 880, duration: 0.2, delay: 0 },
          { freq: 1100, duration: 0.2, delay: 0.2 },
          { freq: 880, duration: 0.2, delay: 0.4 }
        ],
        'high': [
          { freq: 880, duration: 0.15, delay: 0 },
          { freq: 1000, duration: 0.15, delay: 0.15 }
        ],
        'medium': [
          { freq: 880, duration: 0.1, delay: 0 }
        ]
      };
      
      const soundPattern = sounds[priority] || sounds['medium'];
      
      soundPattern.forEach(sound => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.value = sound.freq;
        
        gain.gain.setValueAtTime(0.3, ctx.currentTime + sound.delay);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + sound.delay + sound.duration);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start(ctx.currentTime + sound.delay);
        osc.stop(ctx.currentTime + sound.delay + sound.duration);
      });
      
    } catch (e) {
      console.warn('播放警报声音失败:', e);
    }
  }

  /**
   * 处理股票点击
   */
  handleStockClick(code) {
    if (!code) return;
    
    // 显示股票详情弹窗
    this.showStockDetailDialog(code);
  }

  /**
   * 显示股票详情弹窗
   */
  async showStockDetailDialog(code) {
    let quote = null;
    
    if (this.modules.stockQuote) {
      quote = await this.modules.stockQuote.getStockQuote(code);
    }
    
    const dialog = document.createElement('div');
    dialog.className = 'stock-detail-dialog';
    dialog.innerHTML = `
      <div class="dialog-overlay">
        <div class="dialog-content">
          <div class="dialog-header">
            <h3>${quote?.name || `股票 ${code}`}</h3>
            <span class="dialog-close">&times;</span>
          </div>
          <div class="dialog-body">
            ${quote ? `
              <div class="stock-info">
                <div class="stock-price-large" style="color: ${this.modules.stockQuote.getChangeColor(quote.changePercent)}">
                  ${quote.price.toFixed(2)}
                </div>
                <div class="stock-change-large" style="color: ${this.modules.stockQuote.getChangeColor(quote.changePercent)}">
                  ${this.modules.stockQuote.formatChange(quote.changePercent)}
                </div>
                <div class="stock-details">
                  <div>开盘: ${quote.open.toFixed(2)}</div>
                  <div>最高: ${quote.high.toFixed(2)}</div>
                  <div>最低: ${quote.low.toFixed(2)}</div>
                  <div>昨收: ${quote.yesterdayClose.toFixed(2)}</div>
                  <div>成交量: ${(quote.volume / 10000).toFixed(2)}万手</div>
                  <div>成交额: ${(quote.amount / 100000000).toFixed(2)}亿</div>
                </div>
              </div>
            ` : '<div class="stock-loading">加载中...</div>'}
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // 绑定关闭事件
    dialog.querySelector('.dialog-close').addEventListener('click', () => {
      dialog.remove();
    });
    
    dialog.querySelector('.dialog-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        dialog.remove();
      }
    });
  }

  /**
   * 显示导出对话框
   */
  showExportDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'export-dialog';
    dialog.innerHTML = `
      <div class="export-header">
        <h3>导出消息</h3>
        <span class="dialog-close">&times;</span>
      </div>
      <div class="export-content">
        <div class="export-options">
          <div class="export-option">
            <input type="checkbox" id="exportAll" checked>
            <label for="exportAll">导出所有消息</label>
          </div>
          <div class="export-option">
            <input type="checkbox" id="exportPriority">
            <label for="exportPriority">仅导出重要消息</label>
          </div>
          <div class="export-option">
            <input type="checkbox" id="exportToday">
            <label for="exportToday">仅导出今日消息</label>
          </div>
          <div class="export-option">
            <input type="checkbox" id="exportWithStocks">
            <label for="exportWithStocks">包含股票信息</label>
          </div>
        </div>
        <div class="export-format">
          <label>导出格式:</label>
          <select id="exportFormat">
            <option value="markdown">Markdown</option>
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
          </select>
        </div>
      </div>
      <div class="export-buttons">
        <button class="btn-export secondary" id="exportCancel">取消</button>
        <button class="btn-export primary" id="exportConfirm">导出</button>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // 绑定事件
    dialog.querySelector('.dialog-close').addEventListener('click', () => {
      dialog.remove();
    });
    
    dialog.querySelector('#exportCancel').addEventListener('click', () => {
      dialog.remove();
    });
    
    dialog.querySelector('#exportConfirm').addEventListener('click', async () => {
      await this.executeExport(dialog);
      dialog.remove();
    });
  }

  /**
   * 执行导出
   */
  async executeExport(dialog) {
    if (!this.modules.history) {
      alert('历史存储模块未加载');
      return;
    }
    
    const options = {
      limit: dialog.querySelector('#exportAll').checked ? 10000 : 1000,
      priority: dialog.querySelector('#exportPriority').checked ? 'high' : null,
      startDate: dialog.querySelector('#exportToday').checked ? 
        new Date().setHours(0, 0, 0, 0) : null
    };
    
    const format = dialog.querySelector('#exportFormat').value;
    
    try {
      const exportData = await this.modules.history.exportMessages(options);
      
      let content;
      let filename;
      let mimeType;
      
      switch (format) {
        case 'markdown':
          content = this.modules.history.generateMarkdownExport(exportData);
          filename = `guzhang-news-${new Date().toISOString().slice(0, 10)}.md`;
          mimeType = 'text/markdown';
          break;
        case 'json':
          content = JSON.stringify(exportData, null, 2);
          filename = `guzhang-news-${new Date().toISOString().slice(0, 10)}.json`;
          mimeType = 'application/json';
          break;
        case 'csv':
          content = this.convertToCSV(exportData.messages);
          filename = `guzhang-news-${new Date().toISOString().slice(0, 10)}.csv`;
          mimeType = 'text/csv';
          break;
      }
      
      // 下载文件
      this.downloadFile(content, filename, mimeType);
      
    } catch (e) {
      console.error('导出失败:', e);
      alert('导出失败: ' + e.message);
    }
  }

  /**
   * 转换为CSV格式
   */
  convertToCSV(messages) {
    const headers = ['时间', '标题', '内容', '来源', '分类', '优先级', '相关股票'];
    const rows = messages.map(msg => [
      msg.time,
      `"${msg.title.replace(/"/g, '""')}"`,
      `"${msg.content.replace(/"/g, '""')}"`,
      msg.source,
      msg.category,
      msg.priority,
      msg.stocks.join('; ')
    ]);
    
    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  /**
   * 下载文件
   */
  downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(url);
  }

  /**
   * 显示历史搜索对话框
   */
  showHistoryDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'history-dialog';
    dialog.innerHTML = `
      <div class="history-header">
        <h3>历史消息搜索</h3>
        <span class="dialog-close">&times;</span>
        <div class="history-search">
          <input type="text" id="historySearchInput" placeholder="搜索关键词...">
          <button id="historySearchBtn">搜索</button>
        </div>
        <div class="history-filters">
          <select class="filter-select" id="historyCategory">
            <option value="">所有分类</option>
            <option value="政策">政策</option>
            <option value="资金">资金</option>
            <option value="公司">公司</option>
            <option value="宏观">宏观</option>
            <option value="行业">行业</option>
          </select>
          <select class="filter-select" id="historyPriority">
            <option value="">所有优先级</option>
            <option value="critical">重磅</option>
            <option value="high">重要</option>
            <option value="medium">关注</option>
            <option value="low">一般</option>
          </select>
          <input type="date" class="filter-select" id="historyStartDate">
          <input type="date" class="filter-select" id="historyEndDate">
        </div>
      </div>
      <div class="history-results" id="historyResults">
        <div class="history-empty">输入关键词开始搜索...</div>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // 绑定事件
    dialog.querySelector('.dialog-close').addEventListener('click', () => {
      dialog.remove();
    });
    
    dialog.querySelector('#historySearchBtn').addEventListener('click', async () => {
      await this.executeHistorySearch(dialog);
    });
    
    dialog.querySelector('#historySearchInput').addEventListener('keypress', async (e) => {
      if (e.key === 'Enter') {
        await this.executeHistorySearch(dialog);
      }
    });
  }

  /**
   * 执行历史搜索
   */
  async executeHistorySearch(dialog) {
    if (!this.modules.history) {
      alert('历史存储模块未加载');
      return;
    }
    
    const query = dialog.querySelector('#historySearchInput').value;
    const category = dialog.querySelector('#historyCategory').value;
    const priority = dialog.querySelector('#historyPriority').value;
    const startDate = dialog.querySelector('#historyStartDate').value;
    const endDate = dialog.querySelector('#historyEndDate').value;
    
    const options = {
      limit: 50,
      category: category || null,
      priority: priority || null,
      startDate: startDate ? new Date(startDate).getTime() : null,
      endDate: endDate ? new Date(endDate + 'T23:59:59').getTime() : null
    };
    
    try {
      const results = await this.modules.history.searchMessages(query, options);
      
      const resultsContainer = dialog.querySelector('#historyResults');
      
      if (results.length === 0) {
        resultsContainer.innerHTML = '<div class="history-empty">未找到匹配的消息</div>';
        return;
      }
      
      resultsContainer.innerHTML = results.map(msg => `
        <div class="history-item">
          <div class="history-item-title">${msg.title}</div>
          <div class="history-item-meta">
            <span>${new Date(msg.timestamp).toLocaleString()}</span>
            <span>${msg.source}</span>
            <span>${msg.category}</span>
            <span class="priority-${msg.priority}">${msg.priority}</span>
          </div>
          <div class="history-item-content">${msg.content}</div>
          ${msg.stocks.length > 0 ? `
            <div class="stock-tags">
              ${msg.stocks.map(stock => `<span class="stock-tag">${stock}</span>`).join('')}
            </div>
          ` : ''}
        </div>
      `).join('');
      
    } catch (e) {
      console.error('历史搜索失败:', e);
      alert('搜索失败: ' + e.message);
    }
  }

  /**
   * 显示数据源管理对话框
   */
  showDataSourceDialog() {
    if (!this.modules.dataSources) {
      alert('数据源管理模块未加载');
      return;
    }
    
    const sources = this.modules.dataSources.getAllSources();
    
    const dialog = document.createElement('div');
    dialog.className = 'datasource-dialog';
    dialog.innerHTML = `
      <div class="datasource-header">
        <h3>数据源管理</h3>
        <span class="dialog-close">&times;</span>
      </div>
      <div class="datasource-list">
        ${sources.map(source => `
          <div class="datasource-item" data-source-id="${source.id}">
            <div class="datasource-info">
              <div class="datasource-name">${source.name}</div>
              <div class="datasource-desc">${source.description}</div>
            </div>
            <div class="datasource-status">
              <div class="status-indicator ${source.status?.connected ? 'status-connected' : 'status-disconnected'}"></div>
              <span class="status-text">${source.status?.connected ? '已连接' : '未连接'}</span>
            </div>
            <label class="datasource-toggle">
              <input type="checkbox" ${source.enabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        `).join('')}
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // 绑定事件
    dialog.querySelector('.dialog-close').addEventListener('click', () => {
      dialog.remove();
    });
    
    // 绑定开关事件
    dialog.querySelectorAll('.datasource-toggle input').forEach(input => {
      input.addEventListener('change', async (e) => {
        const sourceId = e.target.closest('.datasource-item').dataset.sourceId;
        const enabled = e.target.checked;
        
        try {
          if (enabled) {
            await this.modules.dataSources.enableSource(sourceId);
          } else {
            await this.modules.dataSources.disableSource(sourceId);
          }
        } catch (e) {
          console.error('切换数据源失败:', e);
          alert('操作失败: ' + e.message);
          e.target.checked = !enabled;
        }
      });
    });
  }
}

// 导出单例
window.uiEnhancements = new UIEnhancements();