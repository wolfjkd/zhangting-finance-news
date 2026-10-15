/**
 * ztfi.voiceService — 语音播报（TTS）子系统
 *
 * 职责：持有语音队列状态机 + Edge/Web 双引擎降级 + 屏蔽词/静音时段过滤。
 * 接缝（seam）说明：
 *   - 模块「私有」：synth / voiceList / speaking / voiceQueue / _tts* / _currentAudio / SKIP_SOURCES。
 *   - 对 app.js 只暴露「浅接口」：init / stop / enqueue / shouldAnnounce / isInSilentPeriod
 *     + 设置面板读写用的 setter/getter（setEngine/getEngine … setSilentPeriods）。
 *   - 设置面板的 DOM 绑定（initTTSSettings / initVoice 的 DOM 事件）留在 app.js，
 *     它们通过下面的 setter 把值写回本模块，避免把 settings-panel 逻辑拖进语音模块。
 *   - 依赖注入：app.js 用 attach(() => settings) 注入「最新设置」访问器
 *     （settings 会被重载/重置，不能持有快照）。
 * 加载顺序：core.js → utils.js → dom.js → settings-store.js → voice-service.js → app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  // ===== 依赖注入 =====
  let _getSettings = () => ({});
  /** 由 app.js 注入：返回当前最新的 settings 对象 */
  function attach(getSettings) { _getSettings = getSettings; }
  function S() { return _getSettings() || {}; }
  function U() { return window.ztfi.utils; }
  function D() { return window.ztfi.dom; }

  // ===== 语音队列状态（模块私有）=====
  let synth = window.speechSynthesis;
  let voiceList = [];
  let speaking = false;
  let voiceQueue = [];
  const VOICE_TIME_THRESHOLD = 180;
  const VOICE_INTERRUPT_MODE_COMPLETE = 'complete';
  const VOICE_INTERRUPT_MODE_IMMEDIATE = 'immediate';

  // ===== Edge TTS 语音引擎状态 =====
  let _ttsEngine = 'web'; // 'web' 或 'edge'
  let _ttsVoice = 'zh-CN-YunyangNeural';
  let _ttsRequestToken = 0; // 请求令牌，stop 时递增，使进行中的异步请求失效
  let _ttsBlockKeywords = [];
  let _ttsSilentEnabled = false;
  let _ttsSilentPeriods = [];
  let _currentAudio = null;

  // ===== 语音播报过滤规则 =====
  const SKIP_SOURCES = ['券商研报', '公告解读'];

  /** 初始化：填充浏览器内置音色下拉（对应原 initVoice） */
  function init() {
    if (!synth) return;

    function populateVoices() {
      voiceList = synth.getVoices().filter(v =>
        v.lang.startsWith('zh') || v.lang === 'cmn'
      );
      const sel = D().$voiceSelect;
      sel.innerHTML = '';
      voiceList.forEach((v, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = v.name;
        sel.appendChild(opt);
      });
      // 选中之前保存的
      const idx = S().voiceIndex;
      if (idx >= 0 && idx < voiceList.length) {
        sel.value = idx;
      }
    }

    populateVoices();
    synth.onvoiceschanged = populateVoices;
  }

  /** 停止一切播报并清空队列（对应原 stopVoice） */
  function stop() {
    if (synth) {
      synth.cancel();
    }
    // 停止 Edge TTS 音频播放
    if (_currentAudio) {
      try { _currentAudio.pause(); _currentAudio.currentTime = 0; } catch (e) {}
      _currentAudio = null;
    }
    voiceQueue = [];
    speaking = false;
    // 递增令牌，使正在进行的 Edge TTS 异步请求失效
    _ttsRequestToken++;
  }

  async function speakWithEdgeTTS(text) {
    if (!window.pywebview || !window.pywebview.api) return false;
    const myToken = _ttsRequestToken; // 记录当前令牌
    try {
      const rateEl = D().$voiceRate;
      const rateStr = (parseFloat((rateEl && rateEl.value) || 1.5) - 1) * 100;
      const rate = (rateStr >= 0 ? '+' : '') + rateStr + '%';
      const result = await window.pywebview.api.tts_synthesize(text, _ttsVoice, rate, '+0%');
      // 检查令牌：如果在异步等待期间被 stop 了，放弃播放
      if (myToken !== _ttsRequestToken) return true; // 返回 true 避免回退到 web
      // 定时静音期间：放弃播放，并清空队列（覆盖合成期间进入静音时段的场景）
      if (isInSilentPeriod()) {
        voiceQueue = [];
        speaking = false;
        return true;
      }
      const data = JSON.parse(result);
      if (data.status === 'ok' && data.audio_data) {
        // 再次检查令牌
        if (myToken !== _ttsRequestToken) return true;
        _currentAudio = new Audio(data.audio_data);
        _currentAudio.onended = () => {
          if (myToken === _ttsRequestToken) { _currentAudio = null; processVoiceQueue(); }
        };
        _currentAudio.onerror = () => {
          if (myToken === _ttsRequestToken) { _currentAudio = null; processVoiceQueue(); }
        };
        _currentAudio.play().catch(e => console.error('Edge TTS 播放失败:', e));
        return true;
      } else if (data.status === 'ok' && data.audio_path) {
        if (myToken !== _ttsRequestToken) return true;
        _currentAudio = new Audio('file:///' + data.audio_path.replace(/\\/g, '/'));
        _currentAudio.onended = () => {
          if (myToken === _ttsRequestToken) { _currentAudio = null; processVoiceQueue(); }
        };
        _currentAudio.onerror = () => {
          if (myToken === _ttsRequestToken) { _currentAudio = null; processVoiceQueue(); }
        };
        _currentAudio.play().catch(e => console.error('Edge TTS 播放失败:', e));
        return true;
      }
      console.warn('Edge TTS 返回异常:', data.message);
    } catch (e) {
      console.error('Edge TTS 播放失败:', e);
    }
    return false;
  }

  function shouldSkipByKeyword(text) {
    if (!_ttsBlockKeywords || _ttsBlockKeywords.length === 0) return false;
    const escaped = _ttsBlockKeywords.map(kw => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(escaped.join('|'), 'gi');
    return regex.test(text);
  }

  function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  function isInSilentPeriod() {
    if (!_ttsSilentEnabled || _ttsSilentPeriods.length === 0) return false;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    for (const period of _ttsSilentPeriods) {
      const start = timeToMinutes(period.start);
      const end = timeToMinutes(period.end);
      if (start <= end) {
        if (currentMinutes >= start && currentMinutes < end) return true;
      } else {
        if (currentMinutes >= start || currentMinutes < end) return true;
      }
    }
    return false;
  }

  /** 入队播报（对应原 enqueueVoice） */
  function enqueue(text, ctime) {
    if (!synth || !text) return;

    if (shouldSkipByKeyword(text)) return;
    if (isInSilentPeriod()) return;

    // 注意：不再基于 ctime（新闻发布时间）判断是否播报。
    // 原因：各子源 API 时效性不同（如新浪财经接近实时，同花顺/东方财富可能有数分钟延迟），
    //       用 ctime 过滤会导致延迟子源的新闻被静默跳过。
    //       后端已通过 skip_tts=true 机制（基于入队时间，5分钟超时）统一控制，
    //       shouldAnnounce 已检查 skip_tts，此处无需重复过滤。

    const speakText = text.length > 80 ? text.substring(0, 80) + '...' : text;

    if (S().voiceInterruptMode === VOICE_INTERRUPT_MODE_IMMEDIATE) {
      stop();
      voiceQueue = [speakText];
      processVoiceQueue();
    } else {
      // 队列上限 10 条，满时丢弃最旧消息，保留最新消息，防止集中推送语音积压
      if (voiceQueue.length >= 10) {
        voiceQueue.shift();
      }
      voiceQueue.push(speakText);
      if (!speaking) {
        processVoiceQueue();
      }
    }
  }

  function processVoiceQueue() {
    if (voiceQueue.length === 0) {
      speaking = false;
      return;
    }
    // 定时静音期间：清空队列，不播报（覆盖静音时段开始前已排队的语音）
    if (isInSilentPeriod()) {
      voiceQueue = [];
      speaking = false;
      return;
    }
    speaking = true;
    const text = voiceQueue.shift();

    // 根据引擎选择：Edge TTS 优先（如果可用且已选择）
    if (_ttsEngine === 'edge' && U().apiHas('tts_synthesize')) {
      speakWithEdgeTTS(text).then(ok => {
        if (!ok) {
          // Edge TTS 失败，回退到浏览器内置
          _speakWithWeb(text);
        }
      });
      return;
    }
    _speakWithWeb(text);
  }

  // 浏览器内置语音播报
  function _speakWithWeb(text) {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-CN';
    utter.rate = parseFloat(D().$voiceRate.value) || 1.5;

    if (voiceList.length > 0) {
      const idx = parseInt(D().$voiceSelect.value) || 0;
      if (voiceList[idx]) utter.voice = voiceList[idx];
    }

    utter.onend = () => processVoiceQueue();
    utter.onerror = () => processVoiceQueue();
    synth.speak(utter);
  }

  /** 判断一条消息是否需要播报（对应原 shouldAnnounce） */
  function shouldAnnounce(item) {
    // 超时消息：后端标记 skip_tts=true，只展示不播报
    if (item.skip_tts === true) {
      return false;
    }

    const source = item.comefrom || '';
    const st = S();

    // 检查是否命中关键词高亮（标题或内容包含关键词）
    if (st.keywordHighlight && st.keywords.length > 0) {
      const text = (item.title || '') + ' ' + (item.content || '');
      const escaped = st.keywords.map(kw => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const regex = new RegExp(escaped.join('|'), 'gi');
      if (regex.test(text)) {
        return true;
      }
    }

    // 检查是否涉及自选股（同步检查，通过item.stocks字段）
    if (item.stocks && item.stocks.length > 0) {
      return true;
    }

    // 来源黑名单：这些数据源的消息不播报
    for (const skip of SKIP_SOURCES) {
      if (source.includes(skip)) {
        return false;
      }
    }

    // 默认：播报所有其他消息
    return true;
  }

  /** 试听：用浏览器内置引擎播报一段测试文本（不回灌队列，对应原 $voiceTest 处理器） */
  function testSpeak(text) {
    if (!synth) return;
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-CN';
    utter.rate = parseFloat(D().$voiceRate.value) || 1.5;
    if (voiceList.length > 0) {
      const idx = parseInt(D().$voiceSelect.value) || 0;
      if (voiceList[idx]) utter.voice = voiceList[idx];
    }
    synth.speak(utter);
  }

  // ===== 状态访问器（供 app.js 设置面板读写，替代直接改 _tts* 变量）=====
  function getEngine() { return _ttsEngine; }
  function setEngine(v) { _ttsEngine = v; }
  function getVoice() { return _ttsVoice; }
  function setVoice(v) { _ttsVoice = v; }
  /** 返回模块内屏蔽词的「活引用」数组，供 app.js 就地 push/splice */
  function blockKeywords() { return _ttsBlockKeywords; }
  function setBlockKeywords(arr) { _ttsBlockKeywords = arr; }
  function isSilentEnabled() { return _ttsSilentEnabled; }
  function setSilentEnabled(b) { _ttsSilentEnabled = b; }
  function setSilentPeriods(arr) { _ttsSilentPeriods = arr; }

  window.ztfi.voiceService = {
    attach,
    init,
    stop,
    enqueue,
    shouldAnnounce,
    isInSilentPeriod,
    testSpeak,
    getEngine,
    setEngine,
    getVoice,
    setVoice,
    blockKeywords,
    setBlockKeywords,
    isSilentEnabled,
    setSilentEnabled,
    setSilentPeriods,
  };
})();
