/**
 * 股票行情查询模块
 * 集成 trader-finance-hub 和 tdx-connector 的实时行情能力
 */

class StockQuoteManager {
  constructor() {
    // 股票信息缓存
    this.stockCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5分钟缓存
    
    // 支持的股票代码格式
    this.codeFormats = {
      'SH': /^6[089]\d{4}$/,  // 上海主板
      'SZ': /^[0-3]\d{5}$/,   // 深圳主板+创业板+中小板
      'BJ': /^[48]\d{5}$/     // 北交所
    };
    
    // 股票名称映射（常用股票）
    this.stockNames = {
      '600000': '浦发银行',
      '600036': '招商银行',
      '601318': '中国平安',
      '600519': '贵州茅台',
      '000001': '平安银行',
      '000002': '万科A',
      '300750': '宁德时代',
      '601868': '中国能建',
      '600048': '保利发展',
      '601390': '中国中铁'
    };
    
    this.init();
  }

  /**
   * 初始化模块
   */
  init() {
    console.log('股票行情模块初始化');
    this.loadStockNames();
  }

  /**
   * 加载股票名称映射
   */
  async loadStockNames() {
    try {
      // 从本地存储加载
      const stored = localStorage.getItem('stockNames');
      if (stored) {
        const names = JSON.parse(stored);
        Object.assign(this.stockNames, names);
      }
    } catch (e) {
      console.warn('加载股票名称失败:', e);
    }
  }

  /**
   * 获取股票市场
   */
  getMarket(code) {
    if (this.codeFormats.SH.test(code)) return 'SH';
    if (this.codeFormats.SZ.test(code)) return 'SZ';
    if (this.codeFormats.BJ.test(code)) return 'BJ';
    return null;
  }

  /**
   * 获取股票行情
   */
  async getStockQuote(code) {
    // 检查缓存
    const cached = this.stockCache.get(code);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    try {
      // 优先使用 tdx-connector
      const quote = await this.getQuoteFromTdx(code);
      
      if (quote) {
        // 更新缓存
        this.stockCache.set(code, {
          data: quote,
          timestamp: Date.now()
        });
        
        // 更新股票名称映射
        if (quote.name) {
          this.stockNames[code] = quote.name;
          this.saveStockNames();
        }
        
        return quote;
      }
      
      return null;
    } catch (e) {
      console.error('获取股票行情失败:', code, e);
      return null;
    }
  }

  /**
   * 从后端获取实时行情（腾讯财经 API，通过 pywebview.api 直连）
   */
  async getQuoteFromTdx(code) {
    try {
      if (typeof pywebview === 'undefined' || !pywebview.api || !pywebview.api.get_stock_quote) {
        // pywebview 未就绪，返回 null（不返回假数据）
        console.warn('pywebview API 未就绪，跳过行情查询');
        return null;
      }
      const result = await pywebview.api.get_stock_quote(code);
      const resp = typeof result === 'string' ? JSON.parse(result) : result;
      if (resp.status !== 'ok' || !resp.quote) {
        console.warn('行情查询失败:', resp.message);
        return null;
      }
      return resp.quote;
    } catch (e) {
      console.error('获取行情异常:', code, e);
      return null;
    }
  }

  /**
   * 获取股票名称
   */
  getStockName(code) {
    return this.stockNames[code] || `股票${code}`;
  }

  /**
   * 保存股票名称映射
   */
  saveStockNames() {
    try {
      localStorage.setItem('stockNames', JSON.stringify(this.stockNames));
    } catch (e) {
      console.warn('保存股票名称失败:', e);
    }
  }

  /**
   * 格式化涨跌幅
   */
  formatChange(change) {
    if (change > 0) return `+${change.toFixed(2)}%`;
    if (change < 0) return `${change.toFixed(2)}%`;
    return '0.00%';
  }

  /**
   * 获取涨跌颜色
   */
  getChangeColor(change) {
    if (change > 0) return '#FF4444'; // 红色 - 涨
    if (change < 0) return '#00AA00'; // 绿色 - 跌
    return '#666666'; // 灰色 - 平
  }

  /**
   * 生成行情标签HTML
   */
  generateQuoteHTML(code, quote) {
    if (!quote) {
      return `<span class="stock-quote" data-code="${code}">
        <span class="stock-name">${this.getStockName(code)}</span>
        <span class="stock-price">--</span>
      </span>`;
    }

    const color = this.getChangeColor(quote.changePercent);
    const changeText = this.formatChange(quote.changePercent);
    
    return `<span class="stock-quote" data-code="${code}" style="color: ${color}">
      <span class="stock-name">${quote.name}</span>
      <span class="stock-price">${quote.price.toFixed(2)}</span>
      <span class="stock-change">${changeText}</span>
    </span>`;
  }

  /**
   * 批量获取股票行情
   */
  async batchGetQuotes(codes) {
    const promises = codes.map(code => this.getStockQuote(code));
    const results = await Promise.all(promises);
    
    const quotesMap = {};
    codes.forEach((code, index) => {
      if (results[index]) {
        quotesMap[code] = results[index];
      }
    });
    
    return quotesMap;
  }

  /**
   * 搜索股票
   */
  async searchStock(keyword) {
    // 这里需要调用 Python 后端的股票搜索功能
    // 暂时返回模拟结果
    const results = [];
    for (const [code, name] of Object.entries(this.stockNames)) {
      if (name.includes(keyword) || code.includes(keyword)) {
        results.push({
          code,
          name,
          market: this.getMarket(code)
        });
      }
    }
    return results.slice(0, 10); // 最多返回10个结果
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.stockCache.clear();
    console.log('股票行情缓存已清除');
  }
}

// 导出单例
window.stockQuoteManager = new StockQuoteManager();