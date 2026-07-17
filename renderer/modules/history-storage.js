/**
 * 历史消息存储与检索模块
 * 本地存储 + 全文检索
 */

class HistoryStorage {
  constructor() {
    this.dbName = 'ZTFINewsHistory';
    this.dbVersion = 5; // 升级版本以添加自选股预警阈值
    this.db = null;
    this.maxRecords = 10000; // 最大存储记录数
    this.cleanupThreshold = 12000; // 清理阈值
    
    this.init();
  }

  /**
   * 初始化数据库
   */
  async init() {
    try {
      await this.openDB();
      console.log('历史消息数据库初始化完成');
    } catch (e) {
      console.error('初始化历史消息数据库失败:', e);
    }
  }

  /**
   * 打开数据库
   */
  openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // 创建消息存储
        if (!db.objectStoreNames.contains('messages')) {
          const store = db.createObjectStore('messages', { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('aid', 'aid', { unique: true });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('priority', 'priority', { unique: false });
        }
        
        // 创建收藏存储
        if (!db.objectStoreNames.contains('favorites')) {
          const favStore = db.createObjectStore('favorites', { keyPath: 'id' });
          favStore.createIndex('timestamp', 'timestamp', { unique: false });
          favStore.createIndex('aid', 'aid', { unique: false });
        }
        
        // 创建全文索引存储
        if (!db.objectStoreNames.contains('searchIndex')) {
          const indexStore = db.createObjectStore('searchIndex', { keyPath: 'id', autoIncrement: true });
          indexStore.createIndex('word', 'word', { unique: false });
          indexStore.createIndex('messageId', 'messageId', { unique: false });
        }
        
        // 创建自选股存储
        if (!db.objectStoreNames.contains('watchlist')) {
          const watchStore = db.createObjectStore('watchlist', { keyPath: 'code' });
          watchStore.createIndex('addedAt', 'addedAt', { unique: false });
          watchStore.createIndex('groupId', 'groupId', { unique: false });
        }
        
        // 创建自选股分组存储
        if (!db.objectStoreNames.contains('watchlistGroups')) {
          const groupStore = db.createObjectStore('watchlistGroups', { keyPath: 'id' });
          groupStore.createIndex('order', 'order', { unique: false });
        }
      };
      
      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 存储消息
   */
  async storeMessage(message) {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['messages', 'searchIndex'], 'readwrite');
      const messagesStore = transaction.objectStore('messages');
      const indexStore = transaction.objectStore('searchIndex');
      
      // 存储消息
      const messageData = {
        id: message.aid || Date.now().toString(),
        aid: message.aid,
        title: message.title,
        content: message.content || '',
        source: message.comefrom,
        timestamp: message.ctime || Date.now(),
        category: message.category || '未分类',
        priority: message.priority || 'low',
        stocks: message.stocks || [],
        keywords: message.keywords || [],
        classification: message.classification || {}
      };
      
      const addRequest = messagesStore.put(messageData);
      
      addRequest.onsuccess = () => {
        // 创建全文索引
        this.createSearchIndex(messageData, indexStore);
        resolve(true);
      };
      
      addRequest.onerror = (event) => {
        reject(event.target.error);
      };
      
      // 检查是否需要清理
      this.checkAndCleanup();
    });
  }

  /**
   * 批量存储消息（性能优化）
   */
  async storeMessagesBatch(messages) {
    if (!this.db) await this.openDB();
    if (!messages || messages.length === 0) return;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['messages', 'searchIndex'], 'readwrite');
      const messagesStore = transaction.objectStore('messages');
      const indexStore = transaction.objectStore('searchIndex');
      
      let processed = 0;
      let error = null;
      
      transaction.oncomplete = () => {
        if (error) reject(error);
        else resolve(processed);
      };
      
      transaction.onerror = (event) => {
        reject(event.target.error);
      };
      
      messages.forEach(message => {
        const messageData = {
          id: message.aid || Date.now().toString() + '_' + processed,
          aid: message.aid,
          title: message.title,
          content: message.content || '',
          source: message.comefrom,
          timestamp: message.ctime || Date.now(),
          category: message.category || '未分类',
          priority: message.priority || 'low',
          stocks: message.stocks || [],
          keywords: message.keywords || [],
          classification: message.classification || {}
        };
        
        messagesStore.put(messageData);
        
        // 创建全文索引
        this.createSearchIndex(messageData, indexStore);
        
        processed++;
      });
      
      // 检查是否需要清理
      if (processed > 0) {
        this.checkAndCleanup();
      }
    });
  }

  /**
   * 创建搜索索引
   */
  createSearchIndex(message, indexStore) {
    const words = this.extractWords(message.title + ' ' + message.content);
    
    words.forEach(word => {
      if (word.length >= 2) { // 只索引2个字符以上的词
        indexStore.add({
          word: word.toLowerCase(),
          messageId: message.id
        });
      }
    });
  }

  /**
   * 提取关键词
   */
  extractWords(text) {
    // 简单的中英文分词
    const words = [];
    
    // 中文字符（2-4字组合）
    const chineseRegex = /[\u4e00-\u9fa5]{2,4}/g;
    const chineseMatches = text.match(chineseRegex);
    if (chineseMatches) {
      words.push(...chineseMatches);
    }
    
    // 英文单词
    const englishRegex = /[a-zA-Z]{3,}/g;
    const englishMatches = text.match(englishRegex);
    if (englishMatches) {
      words.push(...englishMatches);
    }
    
    // 股票代码
    const stockRegex = /\d{6}/g;
    const stockMatches = text.match(stockRegex);
    if (stockMatches) {
      words.push(...stockMatches);
    }
    
    return [...new Set(words)];
  }

  /**
   * 全文搜索
   */
  async searchMessages(query, options = {}) {
    if (!this.db) await this.openDB();
    
    const {
      limit = 50,
      offset = 0,
      category = null,
      priority = null,
      startDate = null,
      endDate = null
    } = options;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['messages', 'searchIndex'], 'readonly');
      const messagesStore = transaction.objectStore('messages');
      const indexStore = transaction.objectStore('searchIndex');
      
      const results = [];
      const seenIds = new Set();
      
      // 如果是空查询，返回最近的消息
      if (!query || query.trim() === '') {
        const request = messagesStore.index('timestamp').openCursor(null, 'prev');
        
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor && results.length < limit) {
            const message = cursor.value;
            
            // 应用过滤条件
            if (this.matchesFilters(message, { category, priority, startDate, endDate })) {
              if (!seenIds.has(message.id)) {
                results.push(message);
                seenIds.add(message.id);
              }
            }
            
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        
        request.onerror = (event) => {
          reject(event.target.error);
        };
        
        return;
      }
      
      // 全文搜索
      const searchWords = this.extractWords(query);
      const wordPromises = searchWords.map(word => {
        return new Promise((resolveWord, rejectWord) => {
          const index = indexStore.index('word');
          const request = index.getAll(word.toLowerCase());
          
          request.onsuccess = (event) => {
            resolveWord(event.target.result.map(item => item.messageId));
          };
          
          request.onerror = (event) => {
            rejectWord(event.target.error);
          };
        });
      });
      
      Promise.all(wordPromises).then(wordResults => {
        // 合并所有匹配的消息ID
        const allMessageIds = wordResults.flat();
        const idCounts = {};
        
        allMessageIds.forEach(id => {
          idCounts[id] = (idCounts[id] || 0) + 1;
        });
        
        // 按匹配度排序
        const sortedIds = Object.keys(idCounts)
          .sort((a, b) => idCounts[b] - idCounts[a])
          .slice(offset, offset + limit);
        
        // 获取完整消息
        const messagePromises = sortedIds.map(id => {
          return new Promise((resolveMsg, rejectMsg) => {
            const request = messagesStore.get(id);
            request.onsuccess = (event) => {
              resolveMsg(event.target.result);
            };
            request.onerror = (event) => {
              rejectMsg(event.target.error);
            };
          });
        });
        
        Promise.all(messagePromises).then(messages => {
          const filteredMessages = messages.filter(msg => {
            if (!msg) return false;
            return this.matchesFilters(msg, { category, priority, startDate, endDate });
          });
          
          resolve(filteredMessages);
        }).catch(reject);
      }).catch(reject);
    });
  }

  /**
   * 检查消息是否匹配过滤条件
   */
  matchesFilters(message, filters) {
    const { category, priority, startDate, endDate } = filters;
    
    if (category && message.category !== category) return false;
    if (priority && message.priority !== priority) return false;
    if (startDate && message.timestamp < startDate) return false;
    if (endDate && message.timestamp > endDate) return false;
    
    return true;
  }

  /**
   * 获取消息统计
   */
  async getStatistics() {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['messages'], 'readonly');
      const store = transaction.objectStore('messages');
      const request = store.count();
      
      request.onsuccess = (event) => {
        const total = event.target.result;
        
        // 获取分类统计
        const categoryStats = {};
        const priorityStats = {};
        
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const message = cursor.value;
            
            // 分类统计
            categoryStats[message.category] = (categoryStats[message.category] || 0) + 1;
            
            // 优先级统计
            priorityStats[message.priority] = (priorityStats[message.priority] || 0) + 1;
            
            cursor.continue();
          } else {
            resolve({
              total,
              categories: categoryStats,
              priorities: priorityStats
            });
          }
        };
        
        cursorRequest.onerror = (event) => {
          reject(event.target.error);
        };
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 检查并清理旧数据
   */
  async checkAndCleanup() {
    if (!this.db) return;
    
    try {
      const stats = await this.getStatistics();
      if (stats.total > this.cleanupThreshold) {
        await this.cleanupOldMessages(stats.total - this.maxRecords);
      }
    } catch (e) {
      console.warn('清理历史消息失败:', e);
    }
  }

  /**
   * 清理旧消息
   */
  async cleanupOldMessages(count) {
    if (!this.db || count <= 0) return;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['messages', 'searchIndex'], 'readwrite');
      const messagesStore = transaction.objectStore('messages');
      const indexStore = transaction.objectStore('searchIndex');
      
      // 获取最旧的消息
      const request = messagesStore.index('timestamp').openCursor();
      let deleted = 0;
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && deleted < count) {
          const message = cursor.value;
          
          // 删除消息
          cursor.delete();
          
          // 删除相关的搜索索引
          this.deleteSearchIndex(message.id, indexStore);
          
          deleted++;
          cursor.continue();
        } else {
          console.log(`清理了 ${deleted} 条旧消息`);
          resolve(deleted);
        }
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 删除搜索索引
   */
  deleteSearchIndex(messageId, indexStore) {
    const index = indexStore.index('messageId');
    const request = index.openCursor(messageId);
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
  }

  /**
   * 导出消息为文档
   */
  async exportMessages(options = {}) {
    const messages = await this.searchMessages('', options);
    
    const exportData = {
      exportTime: new Date().toISOString(),
      totalMessages: messages.length,
      messages: messages.map(msg => ({
        time: new Date(msg.timestamp).toLocaleString(),
        title: msg.title,
        content: msg.content,
        source: msg.source,
        category: msg.category,
        priority: msg.priority,
        stocks: msg.stocks
      }))
    };
    
    return exportData;
  }

  /**
   * 生成Markdown格式的导出内容
   */
  generateMarkdownExport(exportData) {
    let md = `# 财经聚合消息导出\n\n`;
    md += `**导出时间**: ${exportData.exportTime}\n`;
    md += `**消息总数**: ${exportData.totalMessages}\n\n`;
    
    // 按优先级分组
    const grouped = {};
    exportData.messages.forEach(msg => {
      if (!grouped[msg.priority]) grouped[msg.priority] = [];
      grouped[msg.priority].push(msg);
    });
    
    const priorityOrder = ['critical', 'high', 'medium', 'low'];
    const priorityNames = {
      'critical': '🔴 重磅消息',
      'high': '🟠 重要消息', 
      'medium': '🟡 关注消息',
      'low': '⚪ 一般消息'
    };
    
    priorityOrder.forEach(priority => {
      if (grouped[priority] && grouped[priority].length > 0) {
        md += `## ${priorityNames[priority]}\n\n`;
        
        grouped[priority].forEach(msg => {
          md += `### ${msg.title}\n`;
          md += `- **时间**: ${msg.time}\n`;
          md += `- **来源**: ${msg.source}\n`;
          md += `- **分类**: ${msg.category}\n`;
          if (msg.stocks.length > 0) {
            md += `- **相关股票**: ${msg.stocks.join(', ')}\n`;
          }
          md += `\n${msg.content}\n\n---\n\n`;
        });
      }
    });
    
    return md;
  }

  /**
   * 清空所有数据
   */
  async clearAll() {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['messages', 'searchIndex', 'favorites', 'watchlist', 'watchlistGroups'], 'readwrite');
      const messagesStore = transaction.objectStore('messages');
      const indexStore = transaction.objectStore('searchIndex');
      const favoritesStore = transaction.objectStore('favorites');
      const watchlistStore = transaction.objectStore('watchlist');
      const groupsStore = transaction.objectStore('watchlistGroups');
      
      const clearMessages = messagesStore.clear();
      const clearIndex = indexStore.clear();
      const clearFavorites = favoritesStore.clear();
      const clearWatchlist = watchlistStore.clear();
      const clearGroups = groupsStore.clear();
      
      clearMessages.onsuccess = () => {
        clearIndex.onsuccess = () => {
          clearFavorites.onsuccess = () => {
            clearWatchlist.onsuccess = () => {
              clearGroups.onsuccess = () => {
                console.log('所有数据已清空');
                resolve(true);
              };
            };
          };
        };
      };
      
      clearMessages.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  // ===== 收藏功能 =====

  /**
   * 添加收藏
   */
  async addFavorite(message) {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['favorites'], 'readwrite');
      const store = transaction.objectStore('favorites');
      
      const favData = {
        id: message.aid || message.id || Date.now().toString(),
        aid: message.aid,
        title: message.title,
        content: message.content || '',
        source: message.comefrom || message.source,
        timestamp: message.ctime || message.timestamp || Date.now(),
        category: message.category || '未分类',
        priority: message.priority || 'low',
        stocks: message.stocks || [],
        keywords: message.keywords || [],
        favoritedAt: Date.now() // 收藏时间
      };
      
      const request = store.put(favData);
      
      request.onsuccess = () => {
        console.log('消息已收藏:', favData.title);
        resolve(true);
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 移除收藏
   */
  async removeFavorite(messageId) {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['favorites'], 'readwrite');
      const store = transaction.objectStore('favorites');
      
      const request = store.delete(messageId);
      
      request.onsuccess = () => {
        console.log('收藏已移除:', messageId);
        resolve(true);
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 检查是否已收藏
   */
  async isFavorite(messageId) {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['favorites'], 'readonly');
      const store = transaction.objectStore('favorites');
      
      const request = store.get(messageId);
      
      request.onsuccess = (event) => {
        resolve(event.target.result !== undefined);
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 获取所有收藏
   */
  async getAllFavorites(options = {}) {
    if (!this.db) await this.openDB();
    
    const { limit = 100, offset = 0 } = options;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['favorites'], 'readonly');
      const store = transaction.objectStore('favorites');
      
      const results = [];
      const request = store.index('timestamp').openCursor(null, 'prev');
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && results.length < limit + offset) {
          if (results.length >= offset) {
            results.push(cursor.value);
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 获取收藏数量
   */
  async getFavoritesCount() {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['favorites'], 'readonly');
      const store = transaction.objectStore('favorites');
      
      const request = store.count();
      
      request.onsuccess = (event) => {
        resolve(event.target.result);
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 删除过期消息（清理内存占用）
   */
  async deleteOldMessages(cutoffTime) {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['messages', 'searchIndex'], 'readwrite');
      const messagesStore = transaction.objectStore('messages');
      const indexStore = transaction.objectStore('searchIndex');
      
      let deletedCount = 0;
      const deletedIds = [];
      
      const index = messagesStore.index('timestamp');
      const request = index.openCursor(null, 'next');
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.timestamp < cutoffTime) {
            deletedIds.push(cursor.value.id);
            cursor.delete();
            deletedCount++;
            cursor.continue();
          } else {
            cursor.continue();
          }
        } else {
          if (deletedIds.length > 0) {
            const indexRequest = indexStore.openCursor();
            indexRequest.onsuccess = (e) => {
              const c = e.target.result;
              if (c) {
                if (deletedIds.includes(c.value.messageId)) {
                  c.delete();
                }
                c.continue();
              } else {
                resolve(deletedCount);
              }
            };
            indexRequest.onerror = () => resolve(deletedCount);
          } else {
            resolve(deletedCount);
          }
        }
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  // ===== 复盘报告功能 =====

  /**
   * 生成复盘报告（按日期范围）
   */
  async generateReviewReport(startDate, endDate) {
    if (!this.db) await this.openDB();
    
    const messages = await this.searchMessages('', { 
      limit: 1000, 
      startDate, 
      endDate 
    });
    
    if (messages.length === 0) {
      return {
        total: 0,
        keywords: [],
        categories: {},
        priorities: {},
        sources: {},
        timeline: []
      };
    }
    
    // 关键词频率统计
    const keywordCounts = {};
    messages.forEach(msg => {
      if (msg.keywords && Array.isArray(msg.keywords)) {
        msg.keywords.forEach(kw => {
          keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
        });
      }
      // 从标题和内容提取关键词
      const words = this.extractWords(msg.title + ' ' + msg.content);
      words.forEach(word => {
        keywordCounts[word] = (keywordCounts[word] || 0) + 1;
      });
    });
    
    // Top 20 高频关键词
    const topKeywords = Object.entries(keywordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, count]) => ({ word, count }));
    
    // 分类统计
    const categoryStats = {};
    messages.forEach(msg => {
      const cat = msg.category || '未分类';
      categoryStats[cat] = (categoryStats[cat] || 0) + 1;
    });
    
    // 优先级统计
    const priorityStats = { critical: 0, high: 0, medium: 0, low: 0 };
    messages.forEach(msg => {
      const pri = msg.priority || 'low';
      priorityStats[pri] = (priorityStats[pri] || 0) + 1;
    });
    
    // 来源统计
    const sourceStats = {};
    messages.forEach(msg => {
      const src = msg.source || '未知';
      sourceStats[src] = (sourceStats[src] || 0) + 1;
    });
    
    // 时间线（按小时统计）
    const hourStats = {};
    messages.forEach(msg => {
      const hour = new Date(msg.timestamp).getHours();
      hourStats[hour] = (hourStats[hour] || 0) + 1;
    });
    
    // 按小时排序
    const timeline = Object.entries(hourStats)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([hour, count]) => ({ hour: parseInt(hour), count }));
    
    return {
      total: messages.length,
      keywords: topKeywords,
      categories: categoryStats,
      priorities: priorityStats,
      sources: sourceStats,
      timeline,
      startTime: startDate,
      endTime: endDate
    };
  }

  /**
   * 生成Markdown复盘报告
   */
  generateReviewMarkdown(report) {
    const now = new Date().toLocaleString();
    let md = `# 📊 财经新闻复盘报告\n\n`;
    md += `**生成时间**: ${now}\n`;
    md += `**统计范围**: ${new Date(report.startTime).toLocaleDateString()} ~ ${new Date(report.endTime).toLocaleDateString()}\n`;
    md += `**消息总数**: ${report.total} 条\n\n`;
    
    if (report.total === 0) {
      md += `> 该时间段内无消息记录\n`;
      return md;
    }
    
    // 高频关键词
    md += `## 🔥 高频关键词 Top 20\n\n`;
    md += `| 关键词 | 出现次数 |\n`;
    md += `|--------|----------|\n`;
    report.keywords.forEach(kw => {
      md += `| ${kw.word} | ${kw.count} |\n`;
    });
    md += `\n`;
    
    // 分类分布
    md += `## 📁 分类分布\n\n`;
    md += `| 分类 | 数量 | 占比 |\n`;
    md += `|------|------|------|\n`;
    Object.entries(report.categories)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, count]) => {
        const percent = ((count / report.total) * 100).toFixed(1);
        md += `| ${cat} | ${count} | ${percent}% |\n`;
      });
    md += `\n`;
    
    // 优先级分布
    md += `## ⚡ 优先级分布\n\n`;
    const priorityNames = {
      critical: '🔴 重磅',
      high: '🟠 重要',
      medium: '🟡 关注',
      low: '⚪ 一般'
    };
    md += `| 优先级 | 数量 | 占比 |\n`;
    md += `|--------|------|------|\n`;
    Object.entries(report.priorities)
      .sort((a, b) => {
        const order = { critical: 0, high: 1, medium: 2, low: 3 };
        return order[a[0]] - order[b[0]];
      })
      .forEach(([pri, count]) => {
        const percent = ((count / report.total) * 100).toFixed(1);
        md += `| ${priorityNames[pri] || pri} | ${count} | ${percent}% |\n`;
      });
    md += `\n`;
    
    // 来源分布
    md += `## 📰 消息来源\n\n`;
    md += `| 来源 | 数量 | 占比 |\n`;
    md += `|------|------|------|\n`;
    Object.entries(report.sources)
      .sort((a, b) => b[1] - a[1])
      .forEach(([src, count]) => {
        const percent = ((count / report.total) * 100).toFixed(1);
        md += `| ${src} | ${count} | ${percent}% |\n`;
      });
    md += `\n`;
    
    // 时间分布
    md += `## 🕐 时间分布（按小时）\n\n`;
    md += `| 时间段 | 消息数 |\n`;
    md += `|--------|--------|\n`;
    report.timeline.forEach(t => {
      const hourStr = `${t.hour}:00-${t.hour + 1}:00`;
      md += `| ${hourStr} | ${t.count} |\n`;
    });
    md += `\n`;
    
    return md;
  }

  // ===== 自选股功能 =====

  /**
   * 添加自选股
   * @param {Object} stock - 股票对象
   * @param {string} stock.code - 股票代码
   * @param {string} stock.name - 股票名称
   * @param {string} [stock.groupId] - 分组ID，默认为'ungrouped'
   */
  async addWatchlistStock(stock, groupId = 'ungrouped') {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['watchlist'], 'readwrite');
      const store = transaction.objectStore('watchlist');
      
      const stockData = {
        code: stock.code,
        name: stock.name || '',
        groupId: groupId,
        alertThreshold: stock.alertThreshold || 5,
        addedAt: Date.now()
      };
      
      const request = store.put(stockData);
      
      request.onsuccess = () => {
        console.log('已添加自选股:', stockData.code, stockData.name, '分组:', groupId);
        this._syncWatchlistToBackend();
        resolve(true);
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 更新自选股分组
   */
  async updateWatchlistStockGroup(code, groupId) {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['watchlist'], 'readwrite');
      const store = transaction.objectStore('watchlist');
      
      const request = store.get(code);
      
      request.onsuccess = () => {
        const stock = request.result;
        if (stock) {
          stock.groupId = groupId;
          store.put(stock);
          this._syncWatchlistToBackend();
          this._syncWatchlistGroupsToBackend();
          resolve(true);
        } else {
          resolve(false);
        }
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 更新自选股预警阈值
   */
  async updateWatchlistStockAlertThreshold(code, threshold) {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['watchlist'], 'readwrite');
      const store = transaction.objectStore('watchlist');
      
      const request = store.get(code);
      
      request.onsuccess = () => {
        const stock = request.result;
        if (stock) {
          stock.alertThreshold = threshold;
          store.put(stock);
          this._syncWatchlistToBackend();
          resolve(true);
        } else {
          resolve(false);
        }
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 移除自选股
   */
  async removeWatchlistStock(code) {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['watchlist'], 'readwrite');
      const store = transaction.objectStore('watchlist');
      
      const request = store.delete(code);
      
      request.onsuccess = () => {
        console.log('已移除自选股:', code);
        this._syncWatchlistToBackend();
        resolve(true);
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 检查是否为自选股
   */
  async isInWatchlist(code) {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['watchlist'], 'readonly');
      const store = transaction.objectStore('watchlist');
      
      const request = store.get(code);
      
      request.onsuccess = (event) => {
        resolve(event.target.result !== undefined);
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 获取所有自选股
   */
  async getAllWatchlist() {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['watchlist'], 'readonly');
      const store = transaction.objectStore('watchlist');
      
      const results = [];
      const request = store.index('addedAt').openCursor(null, 'prev');
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 获取自选股数量
   */
  async getWatchlistCount() {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['watchlist'], 'readonly');
      const store = transaction.objectStore('watchlist');
      
      const request = store.count();
      
      request.onsuccess = (event) => {
        resolve(event.target.result);
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 检查文本中是否包含自选股（返回匹配的股票列表）
   */
  async matchWatchlistInText(text) {
    if (!text || !this.db) return [];
    
    const watchlist = await this.getAllWatchlist();
    const matches = [];
    
    watchlist.forEach(stock => {
      if (stock.code && text.includes(stock.code)) {
        matches.push(stock);
      } else if (stock.name && text.includes(stock.name)) {
        matches.push(stock);
      }
    });
    
    return matches;
  }

  // ===== 自选股分组管理 =====

  /**
   * 创建分组
   */
  async createWatchlistGroup(name) {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['watchlistGroups'], 'readwrite');
      const store = transaction.objectStore('watchlistGroups');
      
      const group = {
        id: 'group_' + Date.now(),
        name: name,
        order: Date.now(),
        createdAt: Date.now()
      };
      
      const request = store.add(group);
      
      request.onsuccess = () => {
        console.log('已创建分组:', name);
        this._syncWatchlistGroupsToBackend();
        resolve(group);
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 删除分组（分组内的股票会移到"未分组"）
   */
  async deleteWatchlistGroup(groupId) {
    if (!this.db || groupId === 'ungrouped') return false;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['watchlistGroups', 'watchlist'], 'readwrite');
      const groupStore = transaction.objectStore('watchlistGroups');
      const watchStore = transaction.objectStore('watchlist');
      
      // 先删除分组
      const deleteGroupReq = groupStore.delete(groupId);
      
      deleteGroupReq.onsuccess = () => {
        // 将该分组的股票移到未分组
        const index = watchStore.index('groupId');
        const request = index.openCursor(groupId);
        
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.value.groupId = 'ungrouped';
            cursor.update(cursor.value);
            cursor.continue();
          }
        };
        
        console.log('已删除分组:', groupId);
        this._syncWatchlistToBackend();
        this._syncWatchlistGroupsToBackend();
        resolve(true);
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 重命名分组
   */
  async renameWatchlistGroup(groupId, newName) {
    if (!this.db) return false;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['watchlistGroups'], 'readwrite');
      const store = transaction.objectStore('watchlistGroups');
      
      const request = store.get(groupId);
      
      request.onsuccess = () => {
        const group = request.result;
        if (group) {
          group.name = newName;
          store.put(group);
          console.log('已重命名分组:', groupId, '->', newName);
          this._syncWatchlistGroupsToBackend();
          resolve(true);
        } else {
          resolve(false);
        }
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 获取所有分组
   */
  async getAllWatchlistGroups() {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['watchlistGroups'], 'readonly');
      const store = transaction.objectStore('watchlistGroups');
      
      const results = [];
      const request = store.index('order').openCursor(null, 'prev');
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 获取分组下的自选股
   */
  async getWatchlistByGroup(groupId) {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['watchlist'], 'readonly');
      const store = transaction.objectStore('watchlist');
      const index = store.index('groupId');
      
      const results = [];
      const request = index.openCursor(groupId);
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  /**
   * 获取分组数量
   */
  async getWatchlistGroupCount() {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['watchlistGroups'], 'readonly');
      const store = transaction.objectStore('watchlistGroups');
      
      const request = store.count();
      
      request.onsuccess = (event) => {
        resolve(event.target.result);
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  async _syncWatchlistToBackend() {
    try {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.persist_watchlist) {
        const watchlist = await this.getAllWatchlist();
        await pywebview.api.persist_watchlist(JSON.stringify(watchlist));
      }
    } catch (e) {
      console.warn('同步自选股到后端失败:', e);
    }
  }

  async _syncWatchlistGroupsToBackend() {
    try {
      if (window.pywebview && window.pywebview.api && window.pywebview.api.persist_watchlist_groups) {
        const groups = await this.getAllWatchlistGroups();
        await pywebview.api.persist_watchlist_groups(JSON.stringify(groups));
      }
    } catch (e) {
      console.warn('同步自选股分组到后端失败:', e);
    }
  }

  async _clearWatchlistStores() {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['watchlist', 'watchlistGroups'], 'readwrite');
      const watchStore = transaction.objectStore('watchlist');
      const groupStore = transaction.objectStore('watchlistGroups');
      
      const clearWatch = watchStore.clear();
      const clearGroup = groupStore.clear();
      
      clearWatch.onsuccess = () => {
        clearGroup.onsuccess = () => {
          resolve(true);
        };
      };
      
      clearWatch.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  async _importWatchlistGroup(group) {
    if (!this.db) await this.openDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['watchlistGroups'], 'readwrite');
      const store = transaction.objectStore('watchlistGroups');
      
      store.put(group);
      transaction.oncomplete = () => {
        resolve(group);
      };
      transaction.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }

  async initFromBackend() {
    try {
      if (window.pywebview && window.pywebview.api) {
        const backendWatchlist = await pywebview.api.get_watchlist();
        const backendGroups = await pywebview.api.get_watchlist_groups();
        
        const hasWatchlist = backendWatchlist && 
          (typeof backendWatchlist === 'string' ? JSON.parse(backendWatchlist) : backendWatchlist).length > 0;
        
        const hasGroups = backendGroups && 
          (typeof backendGroups === 'string' ? JSON.parse(backendGroups) : backendGroups).length > 0;
        
        if (hasWatchlist || hasGroups) {
          await this._clearWatchlistStores();
          
          if (hasGroups) {
            const parsedGroups = typeof backendGroups === 'string' ? JSON.parse(backendGroups) : backendGroups;
            for (const group of parsedGroups) {
              await this._importWatchlistGroup(group);
            }
          }
          
          if (hasWatchlist) {
            const parsedWatchlist = typeof backendWatchlist === 'string' ? JSON.parse(backendWatchlist) : backendWatchlist;
            for (const stock of parsedWatchlist) {
              await this.addWatchlistStock({ code: stock.code, name: stock.name }, stock.groupId || 'ungrouped');
            }
          }
        }
      }
    } catch (e) {
      console.warn('从后端初始化自选股失败:', e);
    }
  }
}

// 导出单例
window.historyStorage = new HistoryStorage();