/**
 * 新闻分类与优先级系统
 * 自动对新闻进行分类和优先级判断
 */

class NewsClassifier {
  constructor() {
    // 分类规则配置
    this.categories = {
      '政策': {
        keywords: ['央行', '财政部', '国务院', '发改委', '银保监', '证监会', '政策', '法规', '监管改革', '调控', '降准', '加息', '降息', 'MLF', 'LPR', '逆回购', '国债', '存款准备金', '央行票据', '公开市场操作', 'SLF', 'SLO', 'PSL', '定向降准', '全面降准', '准备金率', '货币政策', '财政政策', '产业政策', '税收政策', '利率政策', '汇率政策', '信贷政策', '房地产政策', '资本市场改革', '注册制', '退市新规', '再融资新规', '减持新规', '并购重组新规', '财政部发文', '证监会发布', '证监会政策'],
        color: '#FF6B6B',
        icon: '🏛️'
      },
      '资金': {
        keywords: ['北向资金', '融资融券', '主力资金', '资金流向', '流入', '流出', '净买入', '净卖出', '大单', '机构', 'QFII', 'RQFII', '社保资金', '保险资金', '公募基金', '私募基金', '游资', '龙虎榜', '北向资金净流入', '北向资金净流出', '南向资金', '融资余额', '融券余额', '杠杆资金', '场外配资', '大宗交易', '沪股通', '深股通', '港股通', '互联互通'],
        color: '#4ECDC4',
        icon: '💰'
      },
      '公司': {
        keywords: ['业绩', '财报', '营收', '净利润', '公告', '重组', '并购', '增持', '减持', '回购', '分红', '证监会问询', '问询函', '关注函', '警示函', '处罚', '立案', '被ST', '摘帽', '业绩预告', '业绩快报', 'IPO', '上市', '定增', '配股', '可转债', '可交换债', '发行股份购买资产', '重大资产重组', '终止重组', '复牌', '停牌', '退市', '暂停上市', '恢复上市', '股权变更', '控制权变更', '实控人变更', '董事长变更', '总经理变更', '高管变动', '股权激励', '员工持股计划', '商誉减值', '计提减值', '资产减值', '坏账准备', '财务造假', '虚假陈述', '信息披露违规', '关联交易', '对外投资', '战略合作', '中标', '签约', '订单', '产能扩张', '产能收缩'],
        color: '#45B7D1',
        icon: '🏢'
      },
      '宏观': {
        keywords: ['GDP', 'CPI', 'PMI', 'PPI', '利率', '汇率', '通胀', '就业', '经济', '增长', '衰退', '复苏', '社融', 'M2', 'M1', '货币供应量', '贸易顺差', '贸易逆差', '进出口', '消费', '投资', '固定资产投资', '基建投资', '房地产投资', '制造业投资', '消费信心指数', '企业家信心指数', '景气指数', '先行指标', '滞后指标', '同步指标'],
        color: '#96CEB4',
        icon: '🌍'
      },
      '行业': {
        keywords: ['板块', '行业', '概念', '热点', '龙头', '涨停', '跌停', '异动', '爆发', '轮动', '产业链', '上下游', '赛道', '景气度', '产能', '产能过剩', '产能利用率', '供需', '供不应求', '行业龙头', '细分龙头', '龙头企业', '行业老大', '龙头股', '板块轮动', '热点切换', '政策利好', '政策支持', '行业政策', '产业升级', '技术突破', '国产化替代'],
        color: '#FFEAA7',
        icon: '📊'
      },
      '技术指标': {
        keywords: ['突破', '支撑', '压力', '均线', 'MACD', 'KDJ', 'RSI', '金叉', '死叉', '背离', '布林', '成交量', '换手率', '量价', '涨停板', '跌停板', '连板', '地天板', '天地板', '炸板', '回封', '首板', '二板', '三板', '缩量', '放量'],
        color: '#DDA0DD',
        icon: '📈'
      }
    };

    // 优先级规则
    this.priorityRules = {
      'critical': {
        keywords: ['央行降准', '央行加息', '美联储', '闪崩', '跌停潮', '涨停潮', '黑天鹅', '系统性风险', '央行宣布', '证监会发布', '重大政策', '紧急通知', '突发消息', '全球市场', '熔断', '暴涨暴跌', '千股跌停', '千股涨停'],
        color: '#FF0000',
        sound: 'critical',
        weight: 100
      },
      'high': {
        keywords: ['重磅', '突发', '紧急', '重要', '利好', '利空', '异动', '涨停', '跌停', '业绩暴增', '业绩预增', '业绩大幅增长', '业绩下滑', '业绩亏损', '减持计划', '增持计划', '回购计划', '重大合同', '重大订单', '涨停板', '跌停板', '连板'],
        color: '#FF6B35',
        sound: 'high',
        weight: 80
      },
      'medium': {
        keywords: ['关注', '留意', '注意', '风险', '机会', '注意事项', '值得关注', '建议关注', '短期波动', '市场情绪', '板块轮动', '资金关注', '机构调研', '投资者关系', '股东户数'],
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

    // AI自动触发关键词（自动触发AI分析的分类关键词）
    this.aiTriggerKeywords = [
      // 政策
      '央行', '降准', '加息', '降息', '退市新规', '货币政策', '财政政策', '定向降准', '全面降准',
      // 资金
      '北向资金', '主力资金', '净流入', '净流出', '社保资金', '龙虎榜',
      // 公司
      '重组', '并购', '增持', '减持', '回购', 'IPO', '退市',
      // 宏观
      'GDP', 'CPI', 'PMI', 'PPI', '利率', '汇率', 'LPR',
      // 行业
      '技术突破', '异动', '爆发', '热点切换'
    ];

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

  /**
   * 检查是否应该自动触发AI分析
   * @param {Object} classification - 分类结果
   * @param {string} text - 新闻文本（标题+内容）
   * @returns {boolean} 是否应该触发
   */
  shouldAutoTriggerAI(classification, text = '') {
    // 检查优先级：critical 或 high
    if (classification.priority !== 'critical' && classification.priority !== 'high') {
      return false;
    }

    // 检查是否匹配AI触发关键词
    const hasTriggerKeyword = this.aiTriggerKeywords.some(kw => text.includes(kw));
    return hasTriggerKeyword;
  }
}

// 导出单例
window.newsClassifier = new NewsClassifier();