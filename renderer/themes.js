/**
 * 主题系统 — 预设皮肤 + 自定义主题编辑器
 *
 * 使用方式:
 *   ThemeSystem.applyTheme('tech-blue')
 *   ThemeSystem.applyCustomTheme({...})
 *   ThemeSystem.setOpacity(80)
 *
 * 注意：预设主题通过在 body 上添加 theme-xxx 类来覆盖 CSS 变量，
 * 优先级与 body.dark-mode 相同，确保能正确切换。
 */

// ===== 预设主题（完整变量集，参考 dark-mode 实现）=====
const PRESET_THEMES = {
    'tech-blue': {
        name: '科技蓝',
        vars: {
            '--bg': '#ffffff',
            '--bg-card': '#f8f9fa',
            '--bg-card-hover': '#f0f1f3',
            '--hover': '#f1f5f9',
            '--border': '#e1e4e8',
            '--text': '#1a1a1a',
            '--text-secondary': '#586069',
            '--text-time': '#0366d6',
            '--accent': '#0366d6',
            '--green': '#28a745',
            '--red': '#d73a49',
            '--orange': '#e36209',
            '--tag-bg': '#f0f1f3',
            '--toggle-knob': '#ffffff',
            '--keyword-tag-bg': '#fff3cd',
            '--keyword-tag-text': '#856404',
            '--highlight-bg': '#fff176',
            '--highlight-text': '#333'
        }
    },
    'eye-care-green': {
        name: '护眼绿',
        vars: {
            '--bg': '#f0f7f0',
            '--bg-card': '#e8f5e8',
            '--bg-card-hover': '#d4edd4',
            '--hover': '#d4edd4',
            '--border': '#c3e6c3',
            '--text': '#2d4a2d',
            '--text-secondary': '#5a7a5a',
            '--text-time': '#52c41a',
            '--accent': '#52c41a',
            '--green': '#389e0d',
            '--red': '#cf1322',
            '--orange': '#d46b08',
            '--tag-bg': '#d4edda',
            '--toggle-knob': '#ffffff',
            '--keyword-tag-bg': '#e8f5e8',
            '--keyword-tag-text': '#389e0d',
            '--highlight-bg': '#d4edda',
            '--highlight-text': '#2d4a2d'
        }
    },
    'classic-black': {
        name: '经典黑',
        vars: {
            '--bg': '#1a1a1a',
            '--bg-card': '#2d2d2d',
            '--bg-card-hover': '#383838',
            '--hover': '#383838',
            '--border': '#404040',
            '--text': '#e0e0e0',
            '--text-secondary': '#999',
            '--text-time': '#ffd700',
            '--accent': '#ffd700',
            '--green': '#52c41a',
            '--red': '#ff4d4f',
            '--orange': '#fa8c16',
            '--tag-bg': '#3d3d3d',
            '--toggle-knob': '#e0e0e0',
            '--keyword-tag-bg': '#3d3520',
            '--keyword-tag-text': '#ffd700',
            '--highlight-bg': '#4a4a1a',
            '--highlight-text': '#ffd700'
        }
    },
    'vibrant-orange': {
        name: '活力橙',
        vars: {
            '--bg': '#fff8f0',
            '--bg-card': '#ffeede',
            '--bg-card-hover': '#ffe0c4',
            '--hover': '#ffe0c4',
            '--border': '#ffd4b8',
            '--text': '#3d2817',
            '--text-secondary': '#8a6a4a',
            '--text-time': '#ff6b35',
            '--accent': '#ff6b35',
            '--green': '#52c41a',
            '--red': '#cf1322',
            '--orange': '#d46b08',
            '--tag-bg': '#ffe8d6',
            '--toggle-knob': '#ffffff',
            '--keyword-tag-bg': '#fff3cd',
            '--keyword-tag-text': '#856404',
            '--highlight-bg': '#ffe0c4',
            '--highlight-text': '#3d2817'
        }
    },
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
            '--text-time': '#ff6b9d',
            '--accent': '#ff6b9d',
            '--green': '#52c41a',
            '--red': '#cf1322',
            '--orange': '#fa8c16',
            '--tag-bg': '#ffdce8',
            '--toggle-knob': '#ffffff',
            '--keyword-tag-bg': '#fff3cd',
            '--keyword-tag-text': '#856404',
            '--highlight-bg': '#ffdce8',
            '--highlight-text': '#4a2d35'
        }
    }
};

// 所有主题可能用到的 CSS 变量名（用于清除）
const ALL_THEME_VARS = [
    '--bg', '--bg-card', '--bg-card-hover', '--hover', '--border',
    '--text', '--text-secondary', '--text-time', '--accent',
    '--green', '--red', '--orange', '--tag-bg', '--toggle-knob',
    '--keyword-tag-bg', '--keyword-tag-text', '--highlight-bg', '--highlight-text'
];

// ===== 主题系统 =====
const ThemeSystem = {
    _currentTheme: null,
    _customTheme: null,
    _bgImage: null,
    _opacity: 100,

    /**
     * 获取所有预设主题
     */
    getPresetThemes() {
        return PRESET_THEMES;
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

        // 1. 清除所有主题变量（行内样式）
        this._clearCustomVars();
        // 2. 移除 dark-mode 类和 theme-xxx 类（关键：避免 dark-mode 覆盖预设主题变量）
        document.body.classList.remove('dark-mode');
        document.body.className = document.body.className.replace(/theme-\S+/g, '').trim();

        // 3. 应用预设主题变量（行内样式，优先级最高）
        const root = document.documentElement;
        for (const [varName, value] of Object.entries(theme.vars)) {
            root.style.setProperty(varName, value);
        }

        // 4. 设置 body class
        document.body.classList.add(`theme-${themeId}`);

        // 5. 恢复背景图和透明度
        this._applyBgImage();
        this._applyOpacity();

        this._currentTheme = themeId;
        this._customTheme = null;
        this._saveSettings();

        // 6. 同步 settings.darkMode = false（预设主题不是 dark-mode）
        if (window._settings) {
            window._settings.darkMode = false;
        }

        console.log('主题已切换:', theme.name);
    },

    /**
     * 应用自定义主题
     */
    applyCustomTheme(vars) {
        this._clearCustomVars();
        // 移除 dark-mode 和 theme-xxx 类
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
    }
};
