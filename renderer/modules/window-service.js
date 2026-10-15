/**
 * ztfi.windowService — 窗口 / 主题 / 启动探测
 *
 * 覆盖：waitForApi（等后端就绪 → 读后端设置 → init 或弹隐私声明）、Ctrl+S 统计报告快捷键、
 *       frameless 边缘拖拽缩放（initFramelessResize）、主题面板 UI 初始化（initThemeUI），
 *       以及 DOMContentLoaded / pywebviewready 两处启动 bootstrap 与 resize 绑定。
 * 接缝：
 *   - waitForApi 会「把 app.js 的 settings 重新赋值为 loadSettings() 结果」并同步 window._settings，
 *     故通过 host.reloadSettings() 桥接（不能在模块里持有 settings 引用）。
 *   - host 其余钩子：getSettings / init / showPrivacyDialog / setStatus / showToast / getStatsReport。
 *   - utils：apiHas / unwrapResult；版本号走 settingsStore.getCurrentVersion。
 * 说明：本模块的 bootstrap（DOMContentLoaded / resize 绑定 / Ctrl+S）在模块加载时执行；
 *       index.html 中本模块排在 app.js 之前、DOM 之后，与原 app.js 顶层执行时机等价。
 * 加载顺序：core → utils → dom → settings-store → … → window-service → app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  let _host = null;
  function attach(host) { _host = host; }
  function H() { return _host; }
  function U() { return window.ztfi.utils; }

  async function waitForApi(retries) {
    if (typeof pywebview !== 'undefined' && pywebview.api && typeof pywebview.api.fetch_initial === 'function') {
      // 优先从后端读取设置（打包后 localStorage 不稳定）
      try {
        if (U().apiHas('get_settings')) {
          const backendSettings = await pywebview.api.get_settings();
          if (backendSettings) {
            const parsed = U().unwrapResult(backendSettings);
            if (Object.keys(parsed).length > 0) {
              localStorage.setItem('ztfi-settings', JSON.stringify(parsed));
              // settings 被重新赋值成新对象后，同步 window._settings 引用，
              // 避免主题系统/暗色开关读到已失效的旧 settings 对象。
              H().reloadSettings();
            }
          }
        }
      } catch (e) {}

      const st = H().getSettings() || {};
      if (st.privacyAccepted && st.privacyAcceptedVersion === window.ztfi.settingsStore.getCurrentVersion()) {
        H().init();
      } else {
        H().showPrivacyDialog();
      }
    } else if (retries > 0) {
      setTimeout(() => waitForApi(retries - 1), 300);
    } else {
      H().setStatus('error', '后端 API 未就绪');
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const report = H().getStatsReport();
      console.log('[统计报告]', JSON.stringify(report, null, 2));
      H().showToast('统计报告已输出到控制台，按 F12 查看', { type: 'info', duration: 4000 });
    }
  });

  // ===== frameless 窗口边缘拖拽缩放 =====
  // pywebview 官方限制：frameless 窗口不支持鼠标 resize（resizable=True 无效）。
  // 方案：JS 检测窗口边缘热区（8px），按住拖动时实时调用后端 resize_window(w,h) 缩放。
  function initFramelessResize() {
    if (!window.pywebview || !window.pywebview.api || !window.pywebview.api.resize_window) return;
    const EDGE = 8;               // 边缘热区宽度
    const MIN_W = 320, MIN_H = 400; // 与 app.py min_size 一致
    let resizing = null;          // { edge: 'e'|'s'|'se', startX, startY, startW, startH }
    let hoverEdge = null;

    const api = window.pywebview.api;

    function getEdge(e) {
      const w = window.innerWidth, h = window.innerHeight;
      const x = e.clientX, y = e.clientY;
      const right = w - x <= EDGE;
      const left = x <= EDGE;
      const bottom = h - y <= EDGE;
      // 顶部边缘排除标题栏区域（标题栏是拖拽区，不是 resize 热区，避免冲突）
      const titlebarH = 32;
      const top = y <= EDGE && y > titlebarH;
      if (right && bottom) return 'se';
      if (left && bottom) return 'sw';
      if (right && top) return 'ne';
      if (left && top) return 'nw';
      if (right) return 'e';
      if (left) return 'w';
      if (bottom) return 's';
      if (top) return 'n';
      return null;
    }

    function cursorFor(edge) {
      if (edge === 'e' || edge === 'w') return 'ew-resize';
      if (edge === 'n' || edge === 's') return 'ns-resize';
      if (edge === 'se' || edge === 'nw') return 'nwse-resize';
      if (edge === 'sw' || edge === 'ne') return 'nesw-resize';
      return '';
    }

    document.addEventListener('mousemove', (e) => {
      if (resizing) {
        // 实时缩放
        let nw = resizing.startW, nh = resizing.startH;
        const dx = e.clientX - resizing.startX;
        const dy = e.clientY - resizing.startY;
        if (resizing.edge.includes('e')) nw = resizing.startW + dx;
        if (resizing.edge.includes('s')) nh = resizing.startH + dy;
        if (resizing.edge.includes('w')) nw = resizing.startW - dx;
        if (resizing.edge.includes('n')) nh = resizing.startH - dy;
        nw = Math.max(MIN_W, Math.round(nw));
        nh = Math.max(MIN_H, Math.round(nh));
        api.resize_window(nw, nh).catch(() => {});
        return;
      }
      const edge = getEdge(e);
      if (edge !== hoverEdge) {
        hoverEdge = edge;
        document.body.style.cursor = cursorFor(edge) || '';
      }
    });

    document.addEventListener('mousedown', (e) => {
      const edge = getEdge(e);
      if (!edge) return;
      // 边缘按下：进入缩放模式，阻止默认行为（避免选中文本等）
      e.preventDefault();
      resizing = {
        edge,
        startX: e.clientX,
        startY: e.clientY,
        startW: window.innerWidth,
        startH: window.innerHeight
      };
    });

    document.addEventListener('mouseup', () => {
      if (resizing) {
        resizing = null;
        document.body.style.cursor = '';
      }
    });

    // 离开窗口时复位
    document.addEventListener('mouseleave', () => {
      hoverEdge = null;
      if (!resizing) document.body.style.cursor = '';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      try { initThemeUI(); } catch (e) { console.warn('[theme]', e); }
      waitForApi(30);
    });
  } else {
    try { initThemeUI(); } catch (e) { console.warn('[theme]', e); }
    waitForApi(30);
  }

  // frameless 边缘缩放依赖 pywebview js_api（resize_window），
  // 必须等 pywebviewready 注入完成后绑定；在此独立监听，不依赖 init() 是否执行。
  if (U().apiHas('resize_window')) {
    try { initFramelessResize(); } catch (e) { console.warn('[resize]', e); }
  } else {
    window.addEventListener('pywebviewready', () => {
      try { initFramelessResize(); } catch (e) { console.warn('[resize]', e); }
    });
  }

  // 初始化主题设置面板 UI（attachUI 绑定卡片点击 + 恢复上次主题）
  // 兼容两种暴露方式：window.ThemeSystem（显式挂载）或同 realm 词法绑定 ThemeSystem。
  function initThemeUI() {
    const ts = (typeof window !== 'undefined' && window.ThemeSystem) ||
               (typeof ThemeSystem !== 'undefined' ? ThemeSystem : null);
    if (ts && typeof ts.attachUI === 'function') {
      ts.attachUI();
    } else {
      console.warn('[theme] ThemeSystem 未就绪，跳过初始化');
    }
  }

  window.ztfi.windowService = {
    attach,
    waitForApi,
    initFramelessResize,
    initThemeUI,
  };
})();
