/**
 * ztfi.settingsPanel — 设置面板初始化与各分区事件绑定
 *
 * 覆盖：initSettings（P4 拆出的 8 个 bind* 的统一入口）+ 语音/关键词/显示/自选股提醒/
 *       字体/AI/面板与窗口控件/主题与生命周期 八个 bind 子函数。
 * 接缝：
 *   - settings 通过 host.getSettings() 拿最新（面板大量读写 settings）
 *   - DOM 引用集中在 window.ztfi.dom（本模块加载于 dom.js 之后）
 *   - 「留在 app.js」的能力以回调注入：saveSettings / applyFontSize / 关键词高亮与标签 /
 *     addKeyword / 自选股预警启停 / stopVoice / showToast / 收藏 / 搜索 / 版本号
 *   - 跨模块交互走命名空间：voiceService / dialogsDataSource / watchlistView / dialogsOnboarding
 *   - 冻结接口 window.openSettingsAtSection 仍由本模块在绑定时挂到 window（签名不变）
 * 说明：原 app.js 的 `windowResizeTimer` 只被本处使用，故随函数一并移入本模块。
 * 加载顺序：core → utils → dom → … → settings-panel → app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  const DOM = window.ztfi.dom;

  let _host = null;
  function attach(host) { _host = host; }
  function H() { return _host; }
  function S() { return _host.getSettings() || {}; }
  function U() { return window.ztfi.utils; }

  let windowResizeTimer = null; // 窗口大小保存防抖定时器

  function initSettings() {
    // P4 重构（2026-10-15）：原 409 行单函数按功能域拆为 8 个子函数。
    // 子函数均定义在 IIFE 顶层、共享同一闭包；调用顺序与原同步执行顺序一致，
    // 因此初始化时序与行为不变。原"消息来源"chip 列表已于 2026-10-15 移除。
    bindVoiceSettings();
    bindKeywordSettings();
    bindDisplaySettings();
    bindWatchlistAlertSettings();
    bindFontSizeSettings();
    bindAiSettings();
    bindPanelAndWindowControls();
    bindThemeAndLifecycle();
  }

  // ===== 设置面板：语音播报 =====
  function bindVoiceSettings() {
    // 语音
    DOM.$voiceEnabled.checked = S().voiceEnabled;
    DOM.$voiceSpeedRow.style.display = S().voiceEnabled ? 'flex' : 'none';
    DOM.$voiceSettings.style.display = S().voiceEnabled ? 'flex' : 'none';
    DOM.$voiceInterruptModeRow.style.display = S().voiceEnabled ? 'flex' : 'none';
    const $ttsEngineRow = document.getElementById('ttsEngineRow');
    if ($ttsEngineRow) $ttsEngineRow.style.display = S().voiceEnabled ? 'flex' : 'none';

    DOM.$voiceEnabled.addEventListener('change', () => {
      S().voiceEnabled = DOM.$voiceEnabled.checked;
      DOM.$voiceSettings.style.display = S().voiceEnabled ? 'flex' : 'none';
      DOM.$voiceSpeedRow.style.display = S().voiceEnabled ? 'flex' : 'none';
      DOM.$voiceInterruptModeRow.style.display = S().voiceEnabled ? 'flex' : 'none';
      if ($ttsEngineRow) $ttsEngineRow.style.display = S().voiceEnabled ? 'flex' : 'none';
      // 根据当前 TTS 引擎显示对应音色行
      updateTtsVoiceRowVisibility();
      // 关闭语音播报时，立即停止正在播放/排队的语音（含 Edge TTS 异步请求）
      if (!S().voiceEnabled) {
        H().stopVoice();
      }
      H().saveSettings();
    });

    // 根据当前 TTS 引擎显示/隐藏对应音色选择行
    function updateTtsVoiceRowVisibility() {
      const engine = localStorage.getItem('tts_engine') || 'web';
      if (DOM.$voiceSettings) DOM.$voiceSettings.style.display = (S().voiceEnabled && engine === 'web') ? 'flex' : 'none';
      const $ttsVoiceRow = document.getElementById('ttsVoiceRow');
      if ($ttsVoiceRow) $ttsVoiceRow.style.display = (S().voiceEnabled && engine === 'edge') ? 'flex' : 'none';
    }
    updateTtsVoiceRowVisibility();

    DOM.$voiceRate.value = S().voiceRate;
    DOM.$voiceRate.addEventListener('change', () => {
      S().voiceRate = parseFloat(DOM.$voiceRate.value);
      H().saveSettings();
    });

    DOM.$voiceInterruptMode.value = S().voiceInterruptMode;
    DOM.$voiceInterruptMode.addEventListener('change', () => {
      S().voiceInterruptMode = DOM.$voiceInterruptMode.value;
      H().saveSettings();
    });

    DOM.$voiceSelect.addEventListener('change', () => {
      S().voiceIndex = parseInt(DOM.$voiceSelect.value);
      H().saveSettings();
    });

    DOM.$voiceTest.addEventListener('click', () => {
      window.ztfi.voiceService.testSpeak('这是一条测试语音，财经聚合消息推送已开启。');
    });
  }

  // ===== 设置面板：关键词（高亮 / 警报） =====
  function bindKeywordSettings() {
    // 隐藏相似消息
    DOM.$hideDuplicates.checked = S().hideDuplicates;
    DOM.$hideDuplicates.addEventListener('change', () => {
      S().hideDuplicates = DOM.$hideDuplicates.checked;
      H().saveSettings();
    });

    // 关键词高亮
    DOM.$keywordHighlight.checked = S().keywordHighlight;
    DOM.$keywordInputRow.style.display = S().keywordHighlight ? 'flex' : 'none';
    DOM.$keywordTags.style.display = S().keywordHighlight ? 'flex' : 'none';

    DOM.$keywordHighlight.addEventListener('change', () => {
      S().keywordHighlight = DOM.$keywordHighlight.checked;
      DOM.$keywordInputRow.style.display = S().keywordHighlight ? 'flex' : 'none';
      DOM.$keywordTags.style.display = S().keywordHighlight ? 'flex' : 'none';
      H().saveSettings();
      if (S().keywordHighlight) {
        H().applyHighlightAll();
      } else {
        H().removeHighlightAll();
      }
    });

    // 关键词警报开关
    DOM.$keywordAlert.checked = S().keywordAlert;
    DOM.$keywordAlert.addEventListener('change', () => {
      S().keywordAlert = DOM.$keywordAlert.checked;
      H().saveSettings();
    });

    H().renderKeywordTags();

    DOM.$keywordAddBtn.addEventListener('click', () => H().addKeyword());
    DOM.$keywordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') H().addKeyword();
    });
  }

  // ===== 设置面板：显示内容开关 =====
  function bindDisplaySettings() {
    // 显示设置
    DOM.$showStocks.checked = S().showStocks;
    DOM.$showStocks.addEventListener('change', () => {
      S().showStocks = DOM.$showStocks.checked;
      H().saveSettings();
    });

    DOM.$showRelated.checked = S().showRelated;
    DOM.$showRelated.addEventListener('change', () => {
      S().showRelated = DOM.$showRelated.checked;
      H().saveSettings();
    });
  }

  // ===== 设置面板：自选股异动提醒 =====
  function bindWatchlistAlertSettings() {
    // 自选股异动提醒设置
    const $watchlistAlertEnabled = document.getElementById('watchlistAlertEnabled');
    const $watchlistAlertThreshold = document.getElementById('watchlistAlertThreshold');
    const $watchlistAlertInterval = document.getElementById('watchlistAlertInterval');
    const $watchlistAlertSound = document.getElementById('watchlistAlertSound');

    $watchlistAlertEnabled.checked = S().watchlistAlertEnabled;
    $watchlistAlertThreshold.value = S().watchlistAlertThreshold;
    $watchlistAlertInterval.value = S().watchlistAlertInterval;
    $watchlistAlertSound.checked = S().watchlistAlertSound;

    $watchlistAlertEnabled.addEventListener('change', () => {
      S().watchlistAlertEnabled = $watchlistAlertEnabled.checked;
      H().saveSettings();
      if (S().watchlistAlertEnabled) {
        H().startWatchlistAlertMonitor();
      } else {
        H().stopWatchlistAlertMonitor();
      }
    });

    $watchlistAlertThreshold.addEventListener('change', () => {
      S().watchlistAlertThreshold = parseFloat($watchlistAlertThreshold.value) || 5;
      H().saveSettings();
    });

    $watchlistAlertInterval.addEventListener('change', () => {
      S().watchlistAlertInterval = parseInt($watchlistAlertInterval.value) || 5;
      H().saveSettings();
    });

    $watchlistAlertSound.addEventListener('change', () => {
      S().watchlistAlertSound = $watchlistAlertSound.checked;
      H().saveSettings();
    });

    // 如果开启，启动异动监控
    if (S().watchlistAlertEnabled) {
      H().startWatchlistAlertMonitor();
    }
  }

  // ===== 设置面板：字体大小 =====
  function bindFontSizeSettings() {
    // 字体大小设置
    DOM.$fontSize.value = S().fontSize || 'small';
    H().applyFontSize(S().fontSize || 'small');

    DOM.$fontSize.addEventListener('change', () => {
      S().fontSize = DOM.$fontSize.value;
      H().applyFontSize(S().fontSize);
      H().saveSettings();
    });
  }

  // ===== 设置面板：AI 深度分析 =====
  function bindAiSettings() {
    // AI深度分析设置
    DOM.$aiEnabled.checked = S().aiEnabled || false;
    DOM.$aiApiKey.value = S().aiApiKey || '';
    DOM.$aiApiUrl.value = S().aiApiUrl || '';
    DOM.$aiModelName.value = S().aiModelName || '';

    const updateAiVisibility = () => {
      const enabled = DOM.$aiEnabled.checked;
      DOM.$aiApiKeyRow.style.display = enabled ? 'flex' : 'none';
      DOM.$aiApiUrlRow.style.display = enabled ? 'flex' : 'none';
      DOM.$aiModelNameRow.style.display = enabled ? 'flex' : 'none';
      DOM.$aiTestRow.style.display = enabled ? 'flex' : 'none';
      DOM.$aiConfigHint.style.display = enabled ? 'block' : 'none';
    };
    updateAiVisibility();

    DOM.$aiEnabled.addEventListener('change', () => {
      S().aiEnabled = DOM.$aiEnabled.checked;
      updateAiVisibility();
      H().saveSettings();
    });

    DOM.$aiApiKey.addEventListener('change', () => {
      S().aiApiKey = DOM.$aiApiKey.value;
      H().saveSettings();
    });

    DOM.$aiApiUrl.addEventListener('change', () => {
      S().aiApiUrl = DOM.$aiApiUrl.value;
      H().saveSettings();
    });

    DOM.$aiModelName.addEventListener('change', () => {
      S().aiModelName = DOM.$aiModelName.value;
      H().saveSettings();
    });

    DOM.$btnAiTest.addEventListener('click', async () => {
      if (!S().aiEnabled || !S().aiApiKey) {
        H().showToast('请先启用 AI 分析并配置 API 密钥', {
          type: 'warning',
          action: { label: '去配置', callback: () => window.openSettingsAtSection('ai') }
        });
        return;
      }

      const originalText = DOM.$btnAiTest.textContent;
      DOM.$btnAiTest.textContent = '测试中...';
      DOM.$btnAiTest.disabled = true;

      try {
        if (U().apiHas('ai_analyze')) {
          const result = await pywebview.api.ai_analyze(
            '央行宣布下调存款准备金率',
            '央行决定下调金融机构存款准备金率0.25个百分点',
            'custom',
            S().aiApiKey,
            S().aiApiUrl || '',
            S().aiModelName || ''
          );
          const parsed = JSON.parse(result);
          if (parsed.error) {
            H().showToast('AI 测试失败：' + parsed.error, { type: 'error', duration: 5000 });
          } else {
            const detail = `分类: ${parsed.category} | 优先级: ${parsed.priority} | 情感: ${parsed.sentiment} | 摘要: ${parsed.summary}`;
            H().showToast('AI 测试成功！' + detail, { type: 'success', duration: 6000 });
            console.log('[AI 测试详细结果]', parsed);
          }
        } else {
          H().showToast('AI 分析 API 不可用', { type: 'error' });
        }
      } catch (e) {
        H().showToast('AI 测试失败：' + e.message, { type: 'error' });
      } finally {
        DOM.$btnAiTest.textContent = originalText;
        DOM.$btnAiTest.disabled = false;
      }
    });
  }

  // ===== 设置面板：面板开关 / 工具栏按钮 / 对话框 =====
  function bindPanelAndWindowControls() {
    // 打开/关闭
    DOM.$btnSettings.addEventListener('click', () => {
      DOM.$settingsOverlay.classList.add('show');
    });

    // 打开设置面板并定位到指定区域（'ai' | 'tushare' | 'wind' | 'datasource'）
    // 用于 toast 的"去配置"按钮一键直达
    function openSettingsAtSection(section) {
      DOM.$settingsOverlay.classList.add('show');
      // 等面板渲染完再滚动/聚焦
      setTimeout(() => {
        try {
          if (section === 'ai') {
            // 滚到 AI 配置区并勾选启用
            const aiRow = document.getElementById('aiEnabledRow') || document.getElementById('aiApiKeyRow');
            if (aiRow) aiRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const aiEnabled = document.getElementById('aiEnabled');
            if (aiEnabled && !aiEnabled.checked) aiEnabled.focus();
          } else if (section === 'datasource' || section === 'tushare' || section === 'wind') {
            // 打开数据源管理弹窗
            window.ztfi.dialogsDataSource.showDataSourceDialog();
            if (section === 'tushare' || section === 'wind') {
              // 数据源弹窗打开后再打开对应 Token 配置
              setTimeout(() => {
                const cfgBtn = document.querySelector(`.datasource-config-btn[data-source-id="${section}"]`);
                if (cfgBtn) cfgBtn.click();
              }, 300);
            }
          }
        } catch (e) { console.warn('openSettingsAtSection error:', e); }
      }, 100);
    }
    // 暴露给其他模块使用（如 toast action）
    window.openSettingsAtSection = openSettingsAtSection;

    DOM.$btnWatchlist.addEventListener('click', () => {
      window.ztfi.watchlistView.showWatchlistDialog();
    });

    DOM.$btnSearch.addEventListener('click', () => {
      DOM.$searchDialog.style.display = 'flex';
      DOM.$searchInput.focus();
    });

    DOM.$btnFavorites.addEventListener('click', () => {
      H().loadFavorites();
      DOM.$favoritesDialog.style.display = 'flex';
    });

    // 自绘标题栏窗口按钮（frameless，见 DESIGN_SYSTEM.md A.6）
    document.getElementById('btnMinimize')?.addEventListener('click', () => {
      if (U().apiHas('minimize_window')) {
        pywebview.api.minimize_window().catch(() => {});
      }
    });
    document.getElementById('btnMaximize')?.addEventListener('click', () => {
      if (U().apiHas('toggle_maximize')) {
        pywebview.api.toggle_maximize().catch(() => {});
      }
    });
    document.getElementById('btnClose')?.addEventListener('click', () => {
      if (U().apiHas('exit_app')) {
        pywebview.api.exit_app();
      }
    });

    DOM.$searchDialog.querySelector('.dialog-close-btn').addEventListener('click', () => {
      DOM.$searchDialog.style.display = 'none';
    });

    DOM.$favoritesDialog.querySelector('.dialog-close-btn').addEventListener('click', () => {
      DOM.$favoritesDialog.style.display = 'none';
    });

    DOM.$searchBtn.addEventListener('click', () => {
      H().performSearch();
    });

    DOM.$searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        H().performSearch();
      }
    });

    document.addEventListener('click', (e) => {
      if (!DOM.$searchDialog.contains(e.target) && !DOM.$btnSearch.contains(e.target)) {
        DOM.$searchDialog.style.display = 'none';
      }
      if (!DOM.$favoritesDialog.contains(e.target) && !DOM.$btnFavorites.contains(e.target)) {
        DOM.$favoritesDialog.style.display = 'none';
      }
    });

    H().updateFavoritesBadge();
  }

  // ===== 主题 / 窗口生命周期 / 首次启动引导触发 =====
  function bindThemeAndLifecycle() {
    // 主题切换
    function applyTheme() {
      if (S().darkMode) {
        document.body.classList.add('dark-mode');
      } else {
        document.body.classList.remove('dark-mode');
      }
      setWindowTitlebarTheme(S().darkMode);
    }

    function setWindowTitlebarTheme(isDark) {
      if (U().apiHas('set_theme')) {
        pywebview.api.set_theme(isDark ? 'dark' : 'light').catch(() => {});
      }
    }

    applyTheme();

    // pywebview API 就绪后重新应用主题（解决初始化时序问题）
    window.addEventListener('pywebviewready', () => {
      setWindowTitlebarTheme(S().darkMode);
      if (S().isPinned && U().apiHas('toggle_pin')) {
        pywebview.api.toggle_pin(true).catch(() => {});
      }
      // 监听窗口大小变化，保存到后端
      window.addEventListener('resize', () => {
        if (windowResizeTimer) clearTimeout(windowResizeTimer);
        windowResizeTimer = setTimeout(() => {
          const width = window.outerWidth;
          const height = window.outerHeight;
          if (U().apiHas('set_window_size')) {
            window.pywebview.api.set_window_size(width, height).catch(() => {});
          }
        }, 1000);
      });
    });

    // 首次启动引导（按版本号判断——每个新版本首次运行都弹一次）
    // 必须放在 init() 同步执行路径上，不能放进 pywebviewready 监听器——
    // 因为免责声明接受后才调用 init()，此时 pywebviewready 事件早已触发，
    // 新注册的监听器不会再执行，会导致引导永远弹不出。
    // 注意：判定标记存到 settings.onboardingCompletedVersion（由后端 settings.json
    // 持久化），不依赖 localStorage——pywebview/WebView2 的 localStorage 在源代码
    // 调试模式下可能每次启动都被重置，导致"每次都弹"。
    setTimeout(() => {
      const currentVer = H().getCurrentVersion();
      if (S().onboardingCompletedVersion !== currentVer) {
        window.ztfi.dialogsOnboarding.showOnboardingDialog();
      }
    }, 800);  // 延迟 800ms 避免和启动动画抢镜

    DOM.$btnThemeToggle.addEventListener('click', () => {
      S().darkMode = !S().darkMode;
      applyTheme();
      H().saveSettings();
    });

    DOM.$settingsClose.addEventListener('click', () => {
      DOM.$settingsOverlay.classList.remove('show');
    });

    DOM.$settingsOverlay.addEventListener('click', (e) => {
      if (e.target === DOM.$settingsOverlay) {
        DOM.$settingsOverlay.classList.remove('show');
      }
    });
  }

  window.ztfi.settingsPanel = {
    attach,
    initSettings,
  };
})();
