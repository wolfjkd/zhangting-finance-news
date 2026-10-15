/**
 * ztfi.dialogsOnboarding — 首次启动引导（分步卡片）
 *
 * 分步式卡片：欢迎 → 新闻来源 → 自选股 → AI/TTS → 完成。
 * 通过 settings.onboardingCompletedVersion 标记（由后端 settings.json 持久化），按版本号区分。
 * 接缝：
 *   - 依赖 host：getSettings / getCurrentVersion / saveSettings
 *   - 「查看数据源」动作直接调 window.ztfi.dialogsDataSource（模块间走命名空间，不进 host）
 *   - 「打开自选股」用 dom.$btnWatchlist；「去配置 AI」用 window.openSettingsAtSection
 *   - 4 个冻结接口 window._closeOnboarding / closeOnboarding / hideOnboardingTemporarily / resumeOnboarding
 *     仍由本模块在展示时挂到 window（签名与语义不变）。
 * 加载顺序：core → utils → dom → dialogs-datasource → dialogs-onboarding → app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  let _host = null;
  function attach(host) { _host = host; }
  function H() { return _host; }
  function S() { return _host.getSettings() || {}; }
  function D() { return window.ztfi.dom; }

  // ===== 首次启动引导（详细版）=====
  // 分步式卡片：欢迎 → 新闻来源 → 自选股 → AI/TTS → 完成
  // 通过 localStorage.onboarding_completed_v{版本号} 标记，按版本号区分——每个新版本首次运行都会弹一次
  function showOnboardingDialog() {
    const steps = [
      {
        title: '欢迎使用涨停财经聚合播报',
        icon: '🎉',
        content: `
          <p style="font-size:14px;line-height:1.7;margin-bottom:12px;">
            这是一个 A 股财经新闻聚合桌面端，实时推送 15+ 主流财经源的资讯电报。
          </p>
          <p style="font-size:13px;color:var(--text-soft);line-height:1.6;">
            接下来用 3 分钟带你了解核心功能。随时可在"关于"里重新打开本引导。
          </p>
        `
      },
      {
        title: '① 新闻来源已默认开启',
        icon: '📰',
        content: `
          <p style="font-size:13px;line-height:1.7;margin-bottom:10px;">
            默认已为你开启<strong>传统聚合</strong>数据源——聚合了财联社、新浪财经、
            东方财富、同花顺、华尔街见闻、格隆汇等 15 家主流财经媒体的实时电报。
          </p>
          <p style="font-size:12px;color:var(--text-soft);line-height:1.6;">
            想要更多源？进入<strong>设置 → 数据源管理</strong>，可按需开启东方财富公告、
            券商研报、北向资金、龙虎榜、外网资讯等（需要 Token 的源会引导你配置）。
          </p>
        `,
        action: { label: '查看数据源', callback: () => { window.ztfi.dialogsDataSource.showDataSourceDialog(); } }
      },
      {
        title: '② 添加你的自选股',
        icon: '⭐',
        content: `
          <p style="font-size:13px;line-height:1.7;margin-bottom:10px;">
            点击底部的<strong>自选股图标</strong>（五角星按钮），输入 6 位股票代码即可添加。
            支持按分组管理（如：底仓、观察、短线）。
          </p>
          <p style="font-size:12px;color:var(--text-soft);line-height:1.6;">
            添加后，<strong>交易时间段</strong>（9:25-11:30 / 13:00-15:00）会在价格异动时
            弹提醒，非交易时段不打扰你。
          </p>
        `,
        action: { label: '打开自选股', callback: () => { D().$btnWatchlist.click(); } }
      },
      {
        title: '③ AI 解读 & 语音播报（可选）',
        icon: '🤖',
        content: `
          <p style="font-size:13px;line-height:1.7;margin-bottom:10px;">
            每条新闻右侧的<strong>"AI 解读"按钮</strong>会用大模型分析利好/利空/中性，
            并给出摘要——<em>需要先配置 API 密钥才能用</em>。
          </p>
          <p style="font-size:12px;color:var(--text-soft);line-height:1.6;margin-bottom:10px;">
            <strong>语音播报</strong>（TTS）支持浏览器内置或 Edge TTS 高质量音色，
            内置无需配置；Edge TTS 也是免费的。
          </p>
          <p style="font-size:12px;color:var(--text-soft);line-height:1.6;">
            两者都在<strong>设置 → AI 分析 / 语音播报</strong>里配置。
          </p>
        `,
        action: { label: '去配置 AI', callback: () => { window.openSettingsAtSection('ai'); } }
      },
      {
        title: '④ 还有这些贴心功能',
        icon: '✨',
        content: `
          <ul style="font-size:13px;line-height:1.9;padding-left:18px;margin:0;">
            <li><strong>主题切换</strong>：亮色/暗色，跟随系统或手动切换</li>
            <li><strong>窗口置顶</strong>：盯盘时压在其他窗口上方</li>
            <li><strong>自动滚动</strong>：新消息自动滚到可视区</li>
            <li><strong>收藏 & 搜索</strong>：重要消息一键收藏，历史可搜索</li>
            <li><strong>关键词高亮</strong>：设置面板里配置自定义关键词</li>
            <li><strong>T+0 复盘</strong>：内置底仓股盘后分析工具</li>
          </ul>
        `
      },
      {
        title: '准备就绪，开始使用',
        icon: '🚀',
        content: `
          <p style="font-size:14px;line-height:1.7;margin-bottom:12px;">
            一切就绪！默认新闻源已经为你开启，几秒内就会看到第一条电报。
          </p>
          <p style="font-size:12px;color:var(--text-soft);line-height:1.6;">
            有问题可在<strong>关于 → 检查更新</strong>里查看版本，或访问 GitHub 仓库提 issue。
          </p>
        `
      }
    ];

    let currentStep = 0;
    const overlay = document.createElement('div');
    overlay.className = 'onboarding-overlay';
    overlay.id = 'onboardingDialog';

    // ===== 临时隐藏/恢复机制（支持"去配置后回到当前步骤继续引导"）=====
    // 用户点动作按钮（查看数据源/打开自选股/去配置 AI）时，引导不销毁，
    // 只临时隐藏（加 onboarding-hidden class），并打开对应面板；
    // 当用户关闭那个面板后，引导自动回到当前步骤继续显示。
    let isPaused = false;           // 是否处于"临时隐藏等待用户返回"状态
    let pauseWatcher = null;        // MutationObserver 实例
    let pauseIntervalId = null;     // 轮询定时器
    let pauseInitialTimerId = null; // 首次延迟检测定时器

    function hideOnboardingTemporarily() {
      if (isPaused) return;
      isPaused = true;
      overlay.classList.add('onboarding-hidden');
      if (pauseWatcher) pauseWatcher.disconnect();
      if (pauseIntervalId) clearInterval(pauseIntervalId);

      // 状态机：每 300ms 检查一次其它面板是否都关了。
      // 一旦检测到没有任何阻挡面板，立刻恢复引导。
      // 上限 5 分钟（超过则强制恢复，避免引导永久消失）。
      let elapsed = 0;
      const MAX_WAIT = 5 * 60 * 1000;
      const TICK = 300;

      const tick = () => {
        if (!isPaused) return;  // 已被 resume
        if (!overlay.parentNode) { stopWatchers(); return; }  // 引导已被销毁
        elapsed += TICK;
        if (elapsed > MAX_WAIT) {
          console.warn('[onboarding] 超过最大等待时长，强制恢复');
          resumeOnboarding();
          return;
        }
        const blocking = isAnyOtherBlockingPanelOpen();
        if (!blocking) {
          resumeOnboarding();
        }
      };

      // MutationObserver + 轮询双保险
      pauseWatcher = new MutationObserver(tick);
      pauseWatcher.observe(document.body, {
        childList: true,
        subtree: false,
        attributes: true,
        attributeFilter: ['class', 'style']
      });
      pauseIntervalId = setInterval(tick, TICK);
      // 首次延迟 200ms 再检测，确保目标面板已经渲染到 DOM
      pauseInitialTimerId = setTimeout(tick, 200);

      function stopWatchers() {
        if (pauseWatcher) { pauseWatcher.disconnect(); pauseWatcher = null; }
        if (pauseIntervalId) { clearInterval(pauseIntervalId); pauseIntervalId = null; }
        if (pauseInitialTimerId) { clearTimeout(pauseInitialTimerId); pauseInitialTimerId = null; }
      }
      // 把 stopWatchers 暴露给 resume 用
      hideOnboardingTemporarily._stopWatchers = stopWatchers;
    }

    // 检查当前是否还有任何阻挡引导的其它面板/对话框开着
    // 关键：必须真正"显示中"的才返回 true。
    // 有些对话框是常驻 DOM（如 search-dialog / favorites-dialog），平时 display:none 隐藏，
    // 用 display:flex 显示——这些必须检查 style.display 而不是仅看 className。
    function isAnyOtherBlockingPanelOpen() {
      const allElements = document.body.children;
      for (let i = 0; i < allElements.length; i++) {
        const el = allElements[i];
        if (el === overlay) continue;            // 跳过引导自身
        if (!(el instanceof HTMLElement)) continue;
        const cls = el.className || '';
        const id = el.id || '';
        if (!cls) continue;

        // 是否在视觉上"显示中"——综合 offsetParent 和 style.display
        // offsetParent 为 null 通常意味着 display:none 或祖先隐藏
        const isVisible = el.offsetParent !== null ||
                          (el.style.display && el.style.display !== 'none' && el.style.display !== '');

        // 1) 常驻切换型（settingsOverlay 等）：通过 .show class 显示
        //    必须同时满足 (overlay + show) 两个 class 才算显示
        if (/\boverlay\b/.test(cls) && /\bshow\b/.test(cls)) return true;
        // 2) 动态创建型对话框（watchlist-dialog / quote-dialog / license-dialog / datasource-overlay）
        //    这类都是 createElement 后 appendChild 显示，remove() 后从 DOM 移除。
        //    所以只要它还在 body 子节点里，就一定是显示中。
        if (/(watchlist-dialog|quote-dialog|watchlist-alert-dialog|license-dialog|datasource-overlay|news-detail-overlay|multi-condition-popup|orderbook-alert|context-menu|watchlist-move-menu|toast|kw-alert-notification)\b/.test(cls)) {
          // 但要排除常驻 DOM 的 search-dialog / favorites-dialog（它们靠 display 控制）
          if (id !== 'searchDialog' && id !== 'favoritesDialog') return true;
        }
        // 3) 通过 style.display 控制的常驻对话框
        if (isVisible && (id === 'favoritesDialog' || id === 'searchDialog')) return true;
      }
      return false;
    }

    function resumeOnboarding() {
      if (!isPaused) return;
      isPaused = false;
      overlay.classList.remove('onboarding-hidden');
      if (hideOnboardingTemporarily._stopWatchers) hideOnboardingTemporarily._stopWatchers();
    }

    function render() {
      const s = steps[currentStep];
      const isLast = currentStep === steps.length - 1;
      const hasAction = s.action;
      overlay.innerHTML = `
        <div class="onboarding-panel">
          <div class="onboarding-header">
            <span class="onboarding-icon">${s.icon}</span>
            <span class="onboarding-title">${s.title}</span>
            <button class="onboarding-skip" title="${isLast ? '完成' : '跳过引导'}">${isLast ? '✓' : '跳过'}</button>
          </div>
          <div class="onboarding-body">${s.content}</div>
          <div class="onboarding-footer">
            <div class="onboarding-progress">${currentStep + 1} / ${steps.length}</div>
            <div class="onboarding-actions">
              ${currentStep > 0 ? '<button class="onboarding-prev">上一步</button>' : ''}
              ${hasAction ? `<button class="onboarding-action">${s.action.label}</button>` : ''}
              <button class="onboarding-next ${isLast ? 'primary' : ''}">${isLast ? '开始使用' : '下一步'}</button>
            </div>
          </div>
        </div>
      `;
      bindEvents();
    }

    function bindEvents() {
      // 跳过/完成 —— 用户主动跳过，标记完成避免下次再弹（视为用户放弃引导）
      overlay.querySelector('.onboarding-skip').addEventListener('click', () => {
        closeOnboarding(true);
      });
      // 上一步
      const prev = overlay.querySelector('.onboarding-prev');
      if (prev) prev.addEventListener('click', () => { currentStep--; render(); });
      // 动作按钮（如"查看数据源"/"打开自选股"/"去配置 AI"）
      // 关键改动：先打开目标面板，再隐藏引导——确保目标面板先进入 DOM，
      // 避免兜底检测误判为"所有面板都关了"导致引导立刻回来
      const actionBtn = overlay.querySelector('.onboarding-action');
      if (actionBtn) actionBtn.addEventListener('click', () => {
        const cb = steps[currentStep].action.callback;
        try { cb(); } catch (e) { console.warn('onboarding action error:', e); }
        // 用 requestAnimationFrame 等 callback 创建的面板渲染到 DOM 后再隐藏引导
        requestAnimationFrame(() => hideOnboardingTemporarily());
      });
      // 下一步/完成 —— 只有走到最后一步点"开始使用"才标记完成
      overlay.querySelector('.onboarding-next').addEventListener('click', () => {
        if (currentStep < steps.length - 1) { currentStep++; render(); }
        else { closeOnboarding(true); }
      });
    }

    function closeOnboarding(markCompleted) {
      // 清理所有 watchers
      if (pauseWatcher) { pauseWatcher.disconnect(); pauseWatcher = null; }
      if (pauseIntervalId) { clearInterval(pauseIntervalId); pauseIntervalId = null; }
      if (pauseInitialTimerId) { clearTimeout(pauseInitialTimerId); pauseInitialTimerId = null; }
      if (hideOnboardingTemporarily._stopWatchers) hideOnboardingTemporarily._stopWatchers();
      if (overlay.parentNode) overlay.remove();
      if (markCompleted) {
        // 仅当用户走完全部步骤点"开始使用"、或主动点"跳过"时才标记完成。
        // 标记按版本号区分——同一版本只弹一次，下次升级到新版本才会重新弹。
        // 关键：存到 settings.onboardingCompletedVersion，由后端 settings.json 持久化，
        // 而不是 localStorage（pywebview 在调试模式下 localStorage 可能每次启动被清空）
        S().onboardingCompletedVersion = H().getCurrentVersion();
        H().saveSettings();
        // 同时清理旧的 localStorage 标记（向前兼容旧版本）
        try {
          localStorage.removeItem('onboarding_completed');
          localStorage.removeItem('onboarding_completed_v' + H().getCurrentVersion());
        } catch (e) {}
      }
    }
    // 暴露给步骤内 action 的关闭函数（保留兼容性，但现在 action 一般用 hide 而不是 close）
    window._closeOnboarding = closeOnboarding;
    window.closeOnboarding = closeOnboarding;
    window.hideOnboardingTemporarily = hideOnboardingTemporarily;
    window.resumeOnboarding = resumeOnboarding;

    document.body.appendChild(overlay);
    render();
  }

  window.ztfi.dialogsOnboarding = {
    attach,
    showOnboardingDialog,
  };
})();
