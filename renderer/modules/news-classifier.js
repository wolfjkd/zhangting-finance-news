/**
 * 新闻分类与优先级系统
 * 自动对新闻进行分类和优先级判断
 */

class NewsClassifier {
  constructor() {
    // 分类规则配置
    this.categories = {
      '政策': {
        keywords: ['央行', '财政部', '国务院', '发改委', '银保监', '政策', '法规', '监管改革', '调控', '降准', '加息', '降息', 'MLF', 'LPR', '逆回购', '国债', '财政部发文', '证监会政策'],
        color: '#FF6B6B',
        icon: '🏛️'
      },
      '资金': {
        keywords: ['北向资金', '融资融券', '主力资金', '资金流向', '流入', '流出', '净买入', '净卖出', '大单', '机构'],
        color: '#4ECDC4',
        icon: '💰'
      },
      '公司': {
        keywords: ['业绩', '财报', '营收', '净利润', '公告', '重组', '并购', '增持', '减持', '回购', '分红', '证监会问询', '问询函', '关注函', '警示函', '处罚', '立案', '被ST', '摘帽', '业绩预告', '业绩快报'],
        color: '#45B7D1',
        icon: '🏢'
      },
      '宏观': {
        keywords: ['GDP', 'CPI', 'PMI', '利率', '汇率', '通胀', '就业', '经济', '增长', '衰退', '复苏'],
        color: '#96CEB4',
        icon: '🌍'
      },
      '行业': {
        keywords: ['板块', '行业', '概念', '热点', '龙头', '涨停', '跌停', '异动', '爆发', '轮动'],
        color: '#FFEAA7',
        icon: '📊'
      },
      '技术指标': {
        keywords: ['突破', '支撑', '压力', '均线', 'MACD', 'KDJ', 'RSI', '金叉', '死叉', '背离', '布林', '成交量', '换手率', '量价'],
        color: '#DDA0DD',
        icon: '📈'
      }
    };

    // 优先级规则
    this.priorityRules = {
      'critical': {
        keywords: ['央行降准', '央行加息', '美联储', '闪崩', '跌停潮', '涨停潮', '黑天鹅', '系统性风险'],
        color: '#FF0000',
        sound: 'critical',
        weight: 100
      },
      'high': {
        keywords: ['重磅', '突发', '紧急', '重要', '利好', '利空', '异动', '涨停', '跌停'],
        color: '#FF6B35',
        sound: 'high',
        weight: 80
      },
      'medium': {
        keywords: ['关注', '留意', '注意', '风险', '机会'],
        color: '#FFC107',
        sound: 'medium',
        weight: 60
      },
      'low': {
        keywords: [],
        color: '#6C757D',
        sound: 'low',
        weight: 40
      }
    };

    // 股票代码正则
    this.stockRegex = /(?:000[0-9]{3}|002[0-9]{3}|300[0-9]{3}|600[0-9]{3}|601[0-9]{3}|603[0-9]{3}|688[0-9]{3})/g;
    
    // 金额正则
    this.amountRegex = /(\d+(?:\.\d+)?)\s*(?:亿|万|百万|千万)/g;
  }

  /**
   * 对新闻进行分类
   */
  classifyNews(title, content = '') {
    const text = `${title} ${content}`;
    const result = {
      categories: [],
      priority: '',
      priorityScore: 0,
      stocks: [],
      amounts: [],
      keywords: []
    };

    // 1. 分类检测
    for (const [category, config] of Object.entries(this.categories)) {
      const matchedKeywords = config.keywords.filter(kw => text.includes(kw));
      if (matchedKeywords.length > 0) {
        result.categories.push({
          name: category,
          confidence: matchedKeywords.length / config.keywords.length,
          matchedKeywords,
          color: config.color,
          icon: config.icon
        });
      }
    }

    // 2. 优先级判断
    for (const [level, config] of Object.entries(this.priorityRules)) {
      const matched = config.keywords.filter(kw => text.includes(kw));
      if (matched.length > 0) {
        const score = config.weight * matched.length;
        if (score > result.priorityScore) {
          result.priority = level;
          result.priorityScore = score;
          result.priorityColor = config.color;
          result.prioritySound = config.sound;
        }
      }
    }

    // 3. 提取股票代码
    const stockMatches = text.match(this.stockRegex);
    if (stockMatches) {
      result.stocks = [...new Set(stockMatches)];
    }

    // 4. 提取金额
    const amountMatches = text.match(this.amountRegex);
    if (amountMatches) {
      result.amounts = amountMatches;
    }

    // 5. 提取关键词（用于高亮）
    const allKeywords = Object.values(this.categories).flatMap(c => c.keywords);
    result.keywords = allKeywords.filter(kw => text.includes(kw));

    return result;
  }

  /**
   * 获取分类标签HTML
   */
  getCategoryTagsHTML(classification) {
    return classification.categories.map(cat => 
      `<span class="news-tag" style="background-color: ${cat.color}20; color: ${cat.color}; border: 1px solid ${cat.color}40">
        ${cat.icon} ${cat.name}
      </span>`
    ).join('');
  }

  /**
   * 获取优先级标识HTML
   */
  getPriorityBadgeHTML(classification) {
    if (!classification.priority || classification.priority === 'low') return '';
    const config = this.priorityRules[classification.priority];
    if (!config) return '';
    const priorityNames = {
      'critical': '重要',
      'high': '高',
      'medium': '中',
      'low': '普通'
    };
    return `<span class="priority-badge priority-${classification.priority}" 
      style="background-color: ${config.color}20; color: ${config.color}; border: 1px solid ${config.color}40">
      ${priorityNames[classification.priority]}
    </span>`;
  }

  /**
   * 获取股票标签HTML
   */
  getStockTagsHTML(classification) {
    if (classification.stocks.length === 0) return '';
    
    return `<div class="stock-tags">
      ${classification.stocks.map(stock => 
        `<span class="stock-tag" data-code="${stock}">${stock}</span>`
      ).join('')}
    </div>`;
  }

  /**
   * 判断是否为重磅消息
   */
  isCriticalNews(classification) {
    return classification.priority === 'critical' || classification.priorityScore >= 80;
  }

  /**
   * 获取推荐声音类型
   */
  getRecommendedSound(classification) {
    return classification.prioritySound || 'default';
  }
}

// 导出单例
window.newsClassifier = new NewsClassifier();