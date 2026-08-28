/**
 * 主题系统 — 预设皮肤 + 自定义主题编辑器
 *
 * 使用方式:
 *   ThemeSystem.applyTheme('tech-blue')
 *   ThemeSystem.applyCustomTheme({...})
 *   ThemeSystem.setOpacity(80)
 *
 * 约定（对齐 renderer/style.css 的 :root 单一事实源 + Ardot 桌面设计规范板）：
 *   - 预设只覆盖「语义色」令牌；结构令牌（radius / space / fs / shadow / font-scale /
 *     toolbar-h / statusbar-h 等常量）由 style.css :root 统一持有，预设不重复覆盖，避免视觉漂移。
 *   - A股 语义严循「涨红跌绿」：--stock-up 恒为红色系 / --stock-down 恒为绿色系（勿与 --green/--red
 *     状态语义混淆，二者允许独立取值）。
 *   - 预设与暗色开关为互斥模型：预设提供完整语义色集、可独立接管外观，因此 applyTheme 会
 *     摘除 body 上的 dark-mode 类（避免样式表里 body.dark-mode .xxx 的 !important 属性残留压过
 *     预设行内变量），并把暗色开关 UI 复位为关闭。双向切换：先开暗色再选预设，以预设为准。
 */

// ===== 预设主题（完整语义色令牌集，对齐 DESIGN_SYSTEM.md / style.css :root）=====

const PRESET_THEMES = {
    // ===================== 科技蓝（亮，GitHub Blue 主题） =====================
    'tech-blue': {
        name: '科技蓝',
        vars: {
            '--bg': '#ffffff',
            '--bg-card': '#f8f9fa',
            '--bg-card-hover': '#f0f1f3',
            '--hover': '#f1f5f9',
            '--border': '#e1e4e8',
            '--text': '#1b1f23',
            '--text-secondary': '#586069',
            '--text-time': '#0366d6',
            '--accent': '#0366d6',
            '--green': '#28a745',
            '--red': '#d73a49',
            '--stock-up': '#d73a49',
            '--stock-down': '#28a745',
            '--orange': '#e36209',
            '--tag-bg': '#f0f1f3',
            '--tag-text': '#586069',
            '--bg-secondary': '#f7f8fa',
            '--toggle-knob': '#ffffff',
            '--keyword-tag-bg': '#fff3cd',
            '--keyword-tag-text': '#856404',
            '--highlight-bg': '#fff176',
            '--highlight-text': '#1b1f23',
            '--success-bg': '#d4edda',
            '--success-text': '#155724',
            '--danger-bg': '#f8d7da',
            '--danger-text': '#721c24',
            '--risk-bg': '#fff3e0',
            '--risk-text': '#8a4b0a',
            '--warn-bar-bg': '#fff3e0',
            '--warn-bar-text': '#8a4b0a',
            '--priority-critical-bg': '#fff0f0',
            '--priority-high-bg': '#fff4ec',
            '--priority-medium-bg': '#fffbef',
            '--trial-bg': '#fff7e6',
            '--trial-text': '#8a4b0a',
            '--trial-border': '#e7b416',
            '--alert-bg': '#fdebec',
            '--alert-border': '#f0a9aa',
            '--alert-title': '#b33744',
            '--star-color': '#ffc107'
            // 结构令牌不在此覆盖（见文件头注释）
        }
    },

    // ===================== 护眼绿（亮，柔和护眼主题） =====================
    'eye-care-green': {
        name: '护眼绿',
        vars: {
            '--bg': '#f2f8f2',
            '--bg-card': '#e9f3e9',
            '--bg-card-hover': '#dcebdc',
            '--hover': '#dcebdc',
            '--border': '#c5ddc5',
            '--text': '#24402a',
            '--text-secondary': '#577757',
            '--text-time': '#3b8c2e',
            '--accent': '#3b8c2e',
            '--green': '#2f7d32',
            '--red': '#c0392b',
            '--stock-up': '#c0392b',
            '--stock-down': '#2f7d32',
            '--orange': '#b97a1a',
            '--tag-bg': '#ddecdd',
            '--tag-text': '#4b6b4b',
            '--bg-secondary': '#eef6ee',
            '--toggle-knob': '#ffffff',
            '--keyword-tag-bg': '#e6f2e0',
            '--keyword-tag-text': '#3b6b2e',
            '--highlight-bg': '#e0f0d0',
            '--highlight-text': '#24402a',
            '--success-bg': '#d7ead6',
            '--success-text': '#1a5c20',
            '--danger-bg': '#f3d9d7',
            '--danger-text': '#7a2a24',
            '--risk-bg': '#fbeedc',
            '--risk-text': '#7a4a10',
            '--warn-bar-bg': '#fbeedc',
            '--warn-bar-text': '#7a4a10',
            '--priority-critical-bg': '#fbeee9',
            '--priority-high-bg': '#fbf3e4',
            '--priority-medium-bg': '#fbf9e0',
            '--trial-bg': '#f6f4dc',
            '--trial-text': '#7a4a10',
            '--trial-border': '#c1a02a',
            '--alert-bg': '#f7e8e8',
            '--alert-border': '#e0aaaa',
            '--alert-title': '#a53a38',
            '--star-color': '#ffc107'
        }
    },
    // ===================== 经典黑（暗，护眼暗主题） =====================
    'classic-black': {
        name: '经典黑',
        vars: {
            '--bg': '#111418',
            '--bg-card': '#1c2128',
            '--bg-card-hover': '#262c36',
            '--hover': '#262c36',
            '--border': '#3a4048',
            '--text': '#e6edf3',
            '--text-secondary': '#9aa4af',
            '--text-time': '#58a6ff',
            '--accent': '#58a6ff',
            '--green': '#3fb950',
            '--red': '#f85149',
            '--stock-up': '#f85149',
            '--stock-down': '#3fb950',
            '--orange': '#e3b341',
            '--tag-bg': '#262c36',
            '--tag-text': '#9aa4af',
            '--bg-secondary': '#161b22',
            '--toggle-knob': '#e6edf3',
            '--keyword-tag-bg': '#2d2a1a',
            '--keyword-tag-text': '#e3b341',
            '--highlight-bg': '#3a3a1a',
            '--highlight-text': '#f0e68c',
            '--success-bg': '#12251a',
            '--success-text': '#3fb950',
            '--danger-bg': '#2e1517',
            '--danger-text': '#f85149',
            '--risk-bg': '#2b2214',
            '--risk-text': '#e3b341',
            '--warn-bar-bg': '#2b2214',
            '--warn-bar-text': '#e3b341',
            '--priority-critical-bg': '#3a1a1a',
            '--priority-high-bg': '#3a2a1a',
            '--priority-medium-bg': '#3a3a1a',
            '--trial-bg': '#2e2a18',
            '--trial-text': '#e3b341',
            '--trial-border': '#e3b341',
            '--alert-bg': '#3a1c1c',
            '--alert-border': '#7a4646',
            '--alert-title': '#ff8a80',
            '--star-color': '#ffc107'
        }
    },
    // ===================== 活力橙（亮，明亮暖主题） =====================
    'vibrant-orange': {
        name: '活力橙',
        vars: {
            '--bg': '#fff7f0',
            '--bg-card': '#ffeede',
            '--bg-card-hover': '#ffe3cc',
            '--hover': '#ffe3cc',
            '--border': '#ffd4b8',
            '--text': '#3a2a1e',
            '--text-secondary': '#8a6a50',
            '--text-time': '#e3620c',
            '--accent': '#e3620c',
            '--green': '#2f8f46',
            '--red': '#cf3a2f',
            '--stock-up': '#cf3a2f',
            '--stock-down': '#2f8f46',
            '--orange': '#d96b12',
            '--tag-bg': '#ffe8d6',
            '--tag-text': '#7a4a28',
            '--bg-secondary': '#fffaf5',
            '--toggle-knob': '#ffffff',
            '--keyword-tag-bg': '#fff3cd',
            '--keyword-tag-text': '#8a6810',
            '--highlight-bg': '#ffe3ba',
            '--highlight-text': '#3a2f1e',
            '--success-bg': '#dbead6',
            '--success-text': '#1a5c2a',
            '--danger-bg': '#f6deda',
            '--danger-text': '#7a2a22',
            '--risk-bg': '#fff0dc',
            '--risk-text': '#8a4a10',
            '--warn-bar-bg': '#fff0dc',
            '--warn-bar-text': '#8a4a10',
            '--priority-critical-bg': '#ffefeb',
            '--priority-high-bg': '#fff4e8',
            '--priority-medium-bg': '#fffbf0',
            '--trial-bg': '#fff7e6',
            '--trial-text': '#8a4a10',
            '--trial-border': '#e7a51a',
            '--alert-bg': '#fdecea',
            '--alert-border': '#f0abaa',
            '--alert-title': '#b33a33',
            '--star-color': '#ffc107'
        }
    },
    // ===================== 少女粉（亮，柔和粉彩） =====================
    'soft-pink': {
        name: '少女粉',
        vars: {
            '--bg': '#fff5f8',
            '--bg-card': '#ffe8ef',
            '--bg-card-hover': '#ffdce8',
            '--hover': '#ffdce8',
            '--border': '#ffcdd9',
            '--text': '#4a2d35',
            '--text-secondary': '#8a6a72',
            '--text-time': '#d6588c',
            '--accent': '#d6588c',
            '--green': '#2f8f46',
            '--red': '#c93354',
            '--stock-up': '#c93354',
            '--stock-down': '#2f8f46',
            '--orange': '#e0752c',
            '--tag-bg': '#ffdce8',
            '--tag-text': '#7a4a58',
            '--bg-secondary': '#fff9fb',
            '--toggle-knob': '#ffffff',
            '--keyword-tag-bg': '#fff2e6',
            '--keyword-tag-text': '#8a5a2a',
            '--highlight-bg': '#ffe6ee',
            '--highlight-text': '#7a3a4a',
            '--success-bg': '#e3f2e3',
            '--success-text': '#1a5c2a',
            '--danger-bg': '#fadfe4',
            '--danger-text': '#8a2a3a',
            '--risk-bg': '#fff0e0',
            '--risk-text': '#8a4a10',
            '--warn-bar-bg': '#fff0e0',
            '--warn-bar-text': '#8a4a10',
            '--priority-critical-bg': '#fdebe9',
            '--priority-high-bg': '#fff5ec',
            '--priority-medium-bg': '#fffbf0',
            '--trial-bg': '#fff4e6',
            '--trial-text': '#8a4a10',
            '--trial-border': '#e7a51a',
            '--alert-bg': '#fde8ec',
            '--alert-border': '#f0aab4',
            '--alert-title': '#b33a52',
            '--star-color': '#ffc107'
        }
    }
};

// 所有预设可能写往 :root 的行内语义色变量名（用于切换时清除，防串肤）
// 必须与 PRESET_THEMES 中每个预设提供的键集合取并集保持一致。
const ALL_THEME_VARS = [
    '--bg', '--bg-card', '--bg-card-hover', '--hover', '--border',
    '--text', '--text-secondary', '--text-time', '--accent',
    '--green', '--red', '--stock-up', '--stock-down', '--orange',
    '--tag-bg', '--tag-text', '--bg-secondary', '--toggle-knob',
    '--keyword-tag-bg', '--keyword-tag-text', '--highlight-bg', '--highlight-text',
    '--success-bg', '--success-text', '--danger-bg', '--danger-text',
    '--risk-bg', '--risk-text', '--warn-bar-bg', '--warn-bar-text',
    '--priority-critical-bg', '--priority-high-bg', '--priority-medium-bg',
    '--trial-bg', '--trial-text', '--trial-border',
    '--alert-bg', '--alert-border', '--alert-title', '--star-color'
];

// ===== 主题系统 =====
const ThemeSystem = {
    _currentTheme: null,
    _customTheme: null,
    _bgImage: null,
    _opacity: 100,
    _uiAttached: false,

    /**
     * 获取所有预设主题
     */
getPresetThemes() {
        return PRESET_THEMES;
    },

    /**
     * 当前激活的预设主题 id（未激活预设时返回 null）
     * @returns {string|null}
     */
    getCurrentThemeId() {
        const id = this._currentTheme;
        if (id && PRESET_THEMES[id]) return id;
        return null;
    },

    /**
     * 绑定设置面板「主题皮肤」网格的点击事件（自包含，不依赖 app.js 内部函数）。
     * 幂等：重复调用不会重复绑定。可安全地在 DOM ready 后调用。
     */
    attachUI() {
        if (this._uiAttached) return;
        const grid = document.getElementById('themeGrid');
        if (!grid) return;
        const cards = Array.from(grid.querySelectorAll('.theme-card'));
        if (cards.length === 0) return;

        const syncActive = () => {
            const cur = this.getCurrentThemeId();
            let activeId = cur;
            if (!activeId || !this.getPresetThemes()[activeId]) {
                activeId = (window._settings && window._settings.darkMode) ? '__dark' : null;
            }
            cards.forEach(c => c.classList.toggle('active', c.dataset.theme === activeId));
        };

        cards.forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.theme;
                if (id === '__dark') {
                    // 亮/暗卡：交给现有 dark-mode 开关
                    const btn = document.getElementById('btnThemeToggle');
                    if (btn && typeof btn.click === 'function') {
                        btn.click();
                        setTimeout(syncActive, 50);
                    }
                    return;
                }
                this.applyTheme(id);
                syncActive();
            });
        });

        this._uiAttached = true;
        // 恢复上次使用的主题并高亮
        if (!this._currentTheme && !this._customTheme) {
            try { this.loadSettings(); } catch (e) { /* ignore */ }
        }
        syncActive();
    },

    /**
     * 应用预设主题
     */
    applyTheme(themeId) {
        const theme = PRESET_THEMES[themeId];
        if (!theme) {
            console.error('未知主题:', themeId);
            return;
        }

        // 1. 清除所有主题行内变量（避免残留上一套皮肤的变量）
        this._clearCustomVars();

        // 2. 预设已提供完整语义色集，可独立接管全部外观 → 摘除 dark-mode 类，
        //    避免样式表中 body.dark-mode .xxx 的 !important 属性（如工具栏底）残留压过预设。
        //    预设与暗色开关为互斥模型：本函数负责把界面恢复到「不再暗色」状态。
        document.body.classList.remove('dark-mode');
        document.body.className = document.body.className.replace(/theme-\S+/g, '').trim();

        // 3. 写入预设行内变量（优先级最高，覆盖任何类/选择器级联）
        const root = document.documentElement;
        for (const [varName, value] of Object.entries(theme.vars)) {
            root.style.setProperty(varName, value);
        }

        // 4. 标记当前主题
        document.body.classList.add(`theme-${themeId}`);

        // 5. 恢复背景图和透明度
        this._applyBgImage();
        this._applyOpacity();

        this._currentTheme = themeId;
        this._customTheme = null;
        this._saveSettings();

        // 6. 同步暗色开关状态与标题栏（预设接管外观，暗色开关复位为「关」）
        if (window._settings) {
            window._settings.darkMode = false;
        }
        // 亮色预设 → 通知原生窗口切换为 light 标题栏；classic-black 等暗预设 → dark
        const intentDark = this._detectDarkTone(theme.vars);
        if (window.pywebview && window.pywebview.api && window.pywebview.api.set_theme) {
            window.pywebview.api.set_theme(intentDark ? 'dark' : 'light').catch(() => {});
        }

        console.log('主题已切换:', theme.name, themeId);
    },

    /**
     * 应用自定义主题
     */
    applyCustomTheme(vars) {
        this._clearCustomVars();
        document.body.classList.remove('dark-mode');
        document.body.className = document.body.className.replace(/theme-\S+/g, '').trim();

        const root = document.documentElement;
        for (const [varName, value] of Object.entries(vars)) {
            root.style.setProperty(varName, value);
        }
        document.body.classList.add('theme-custom');
        this._customTheme = vars;
        this._applyBgImage();
        this._applyOpacity();
        this._saveSettings();

        if (window._settings) {
            window._settings.darkMode = false;
        }
        // 自定义主题同样按背景明暗通知原生标题栏
        const intentDark = this._detectDarkTone(vars);
        if (window.pywebview && window.pywebview.api && window.pywebview.api.set_theme) {
            window.pywebview.api.set_theme(intentDark ? 'dark' : 'light').catch(() => {});
        }
    },

    /**
     * 设置背景图
     */
    setBgImage(dataUrl) {
        this._bgImage = dataUrl;
        this._applyBgImage();
        this._saveSettings();
    },

    /**
     * 清除背景图
     */
    clearBgImage() {
        this._bgImage = null;
        document.body.style.backgroundImage = '';
        this._saveSettings();
    },

    /**
     * 设置窗口透明度
     */
    setOpacity(opacity) {
        this._opacity = Math.max(30, Math.min(100, opacity));
        this._applyOpacity();
        this._saveSettings();
    },

    /**
     * 获取当前透明度
     */
    getOpacity() {
        return this._opacity;
    },

    // ===== 内部方法 =====

    /**
     * 依据背景色 --bg 的感知明度判断主题深浅，用于决定原生标题栏明暗。
     * @param {Object} vars CSS 变量键值对
     * @returns {boolean} true=暗色主题
     */
    _detectDarkTone(vars) {
        let hex = vars['--bg'] || '#ffffff';
        hex = String(hex).replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const n = parseInt(hex, 16);
        if (isNaN(n)) return false;
        const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        // 感知亮度 ITU-R BT.601
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        return lum < 128;
    },

    _applyBgImage() {
        if (this._bgImage) {
            document.body.style.backgroundImage = `url(${this._bgImage})`;
            document.body.style.backgroundSize = 'cover';
            document.body.style.backgroundPosition = 'center';
            document.body.style.backgroundAttachment = 'fixed';
        } else {
            document.body.style.backgroundImage = '';
        }
    },

    _applyOpacity() {
        if (this._opacity < 100 && window.pywebview && window.pywebview.api && window.pywebview.api.set_window_opacity) {
            try {
                window.pywebview.api.set_window_opacity(this._opacity);
            } catch (e) {
                console.warn('设置窗口透明度失败:', e);
            }
        }
    },

    /**
     * 打开自定义主题编辑器
     */
    openEditor() {
        // 移除已存在的编辑器
        const existing = document.getElementById('themeEditorModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'themeEditorModal';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';

        const editor = document.createElement('div');
        editor.style.cssText = 'background:var(--bg);color:var(--text);border-radius:10px;padding:20px;width:90%;max-width:420px;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.15);border:1px solid var(--border);';

        const fields = [
            { key: '--bg', label: '背景色', default: '#ffffff' },
            { key: '--accent', label: '强调色', default: '#0366d6' },
            { key: '--text', label: '文字色', default: '#1a1a1a' },
            { key: '--bg-card', label: '卡片背景', default: '#f8f9fa' },
            { key: '--border', label: '边框色', default: '#e1e4e8' },
            { key: '--hover', label: '悬停背景', default: '#f1f5f9' },
            { key: '--text-secondary', label: '次要文字', default: '#666' },
            { key: '--tag-bg', label: '标签背景', default: '#e8f0fe' },
        ];

        // 从当前主题加载值
        const currentVars = this._customTheme || {};
        const root = document.documentElement;
        fields.forEach(f => {
            if (!currentVars[f.key]) {
                currentVars[f.key] = root.style.getPropertyValue(f.key) || f.default;
            }
        });

        let html = '<h3 style="margin:0 0 16px;font-size:18px;">自定义主题</h3>';
        fields.forEach(f => {
            html += `
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <label style="flex:1;font-size:13px;">${f.label}</label>
                    <input type="color" data-var="${f.key}" value="${currentVars[f.key]}" style="width:40px;height:30px;border:1px solid var(--border);border-radius:4px;cursor:pointer;background:transparent;">
                    <input type="text" data-var-text="${f.key}" value="${currentVars[f.key]}" style="width:90px;font-size:12px;padding:4px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);">
                </div>
            `;
        });
        html += `
            <div style="display:flex;gap:8px;margin-top:16px;">
                <button id="themeEditorApply" style="flex:1;padding:8px;border:none;border-radius:6px;background:var(--accent);color:#fff;cursor:pointer;font-size:13px;">应用</button>
                <button id="themeEditorReset" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);cursor:pointer;font-size:13px;">重置</button>
                <button id="themeEditorClose" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);cursor:pointer;font-size:13px;">关闭</button>
            </div>
        `;
        editor.innerHTML = html;
        modal.appendChild(editor);
        document.body.appendChild(modal);

        // 同步 color picker 和 text input
        modal.querySelectorAll('input[type="color"]').forEach(colorInput => {
            colorInput.addEventListener('input', (e) => {
                const key = e.target.dataset.var;
                const textInput = modal.querySelector(`input[data-var-text="${key}"]`);
                if (textInput) textInput.value = e.target.value;
            });
        });
        modal.querySelectorAll('input[data-var-text]').forEach(textInput => {
            textInput.addEventListener('change', (e) => {
                const key = e.target.dataset.varText;
                const colorInput = modal.querySelector(`input[data-var="${key}"]`);
                if (colorInput && /^#[0-9a-fA-F]{6}$/.test(e.target.value)) {
                    colorInput.value = e.target.value;
                }
            });
        });

        // 应用
        modal.querySelector('#themeEditorApply').addEventListener('click', () => {
            const vars = {};
            modal.querySelectorAll('input[type="color"]').forEach(input => {
                vars[input.dataset.var] = input.value;
            });
            this.applyCustomTheme(vars);
            modal.remove();
        });

        // 重置
        modal.querySelector('#themeEditorReset').addEventListener('click', () => {
            this.reset();
            modal.remove();
        });

        // 关闭
        modal.querySelector('#themeEditorClose').addEventListener('click', () => {
            modal.remove();
        });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    },

    _clearCustomVars() {
        const root = document.documentElement;
        ALL_THEME_VARS.forEach(v => root.style.removeProperty(v));
    },

    _saveSettings() {
        const settings = {
            theme: this._currentTheme,
            customTheme: this._customTheme,
            bgImage: this._bgImage,
            opacity: this._opacity
        };
        try {
            localStorage.setItem('theme_settings', JSON.stringify(settings));
        } catch (e) {
            console.error('保存主题设置失败:', e);
        }
    },

    /**
     * 从 localStorage 恢复设置
     */
    loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem('theme_settings') || '{}');
            if (saved.theme) {
                this._currentTheme = saved.theme;
            }
            if (saved.customTheme) {
                this._customTheme = saved.customTheme;
            }
            this._bgImage = saved.bgImage || null;
            this._opacity = saved.opacity || 100;

            // 应用
            if (this._customTheme) {
                this.applyCustomTheme(this._customTheme);
            } else if (this._currentTheme && PRESET_THEMES[this._currentTheme]) {
                this.applyTheme(this._currentTheme);
            }
        } catch (e) {
            console.error('加载主题设置失败:', e);
        }
    },

    /**
     * 导出主题配置
     */
    exportTheme() {
        return JSON.stringify({
            theme: this._currentTheme,
            customTheme: this._customTheme,
            opacity: this._opacity
        }, null, 2);
    },

    /**
     * 重置为默认主题
     */
    reset() {
        this._clearCustomVars();
        document.body.classList.remove('dark-mode');
        document.body.className = document.body.className.replace(/theme-\S+/g, '').trim();
        this.clearBgImage();
        this._opacity = 100;
        this._currentTheme = null;
        this._customTheme = null;
        localStorage.removeItem('theme_settings');
        if (window._settings) {
            window._settings.darkMode = false;
        }
        // 恢复默认亮色标题栏
        if (window.pywebview && window.pywebview.api && window.pywebview.api.set_theme) {
            window.pywebview.api.set_theme('light').catch(() => {});
        }
    }
};

// ===== 暴露到全局（关键！）=====
// 顶层 const 声明在浏览器中不会挂到 window 上（window.ThemeSystem 为 undefined），
// 导致 app.js 里 `if (window.ThemeSystem)` 恒为 false，attachUI() 永远不执行、
// 设置皮肤卡片点击全部失效。这里显式挂到全局，供 app.js 稳定调用。
if (typeof window !== 'undefined') {
    window.ThemeSystem = ThemeSystem;
}