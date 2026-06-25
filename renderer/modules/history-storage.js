/**
 * 历史消息存储与检索模块
 * 本地存储 + 全文检索
 */

class HistoryStorage {
  constructor() {
    this.dbName = 'GuzhangNewsHistory';
    this.dbVersion = 1;
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
        
        // 创建全文索引存储
        if (!db.objectStoreNames.contains('searchIndex')) {
          const indexStore = db.createObjectStore('searchIndex', { keyPath: 'id', autoIncrement: true });
          indexStore.createIndex('word', 'word', { unique: false });
          indexStore.createIndex('messageId', 'messageId', { unique: false });
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
    let md = `# 鼓掌财经消息导出\n\n`;
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
      const transaction = this.db.transaction(['messages', 'searchIndex'], 'readwrite');
      const messagesStore = transaction.objectStore('messages');
      const indexStore = transaction.objectStore('searchIndex');
      
      const clearMessages = messagesStore.clear();
      const clearIndex = indexStore.clear();
      
      clearMessages.onsuccess = () => {
        clearIndex.onsuccess = () => {
          console.log('所有历史消息已清空');
          resolve(true);
        };
      };
      
      clearMessages.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }
}

// 导出单例
window.historyStorage = new HistoryStorage();