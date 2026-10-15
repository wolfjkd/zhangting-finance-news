/**
 * ztfi.dialogsLegal — 静态 / 法律类对话框
 *
 * 覆盖：赞赏支持、隐私与免责声明、条款详情（隐私政策/金融风险/数据合规/赞助/开源/通用）、MIT License。
 * 接缝：这些对话框基本是「静态 HTML 构建 + 关闭」，只依赖少量 host 钩子：
 *   - getSettings()：拿最新 settings（同意隐私会写回 settings）
 *   - saveSettings() / getCurrentVersion() / reinit()（同意后重新 init）
 *   - utils.apiHas（退出 App）
 * 加载顺序：core → utils → … → dialogs-legal → app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  let _host = null;
  function attach(host) { _host = host; }
  function H() { return _host; }
  function S() { return _host.getSettings() || {}; }
  function U() { return window.ztfi.utils; }

  // ===== 赞赏功能 =====
  function showDonateDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay show';
    overlay.innerHTML = `
      <div class="settings-panel">
        <div class="settings-header">
          <h3>💝 赞赏支持</h3>
          <button class="settings-close" title="关闭">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="#e53935" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
        <div class="settings-section" style="text-align: center;">
          <p class="donate-desc">本工具完全免费开放，若对你有帮助，可自愿小额赞助<br>支持后续更新</p>
          <div class="donate-qrcode" style="margin: 16px auto; max-width: 250px;">
            <img src="赞赏码.png" alt="赞赏码" style="width: 100%; border-radius: 8px;" />
          </div>
          <div class="donate-tips" style="text-align: left; font-size: 13px; color: var(--text-secondary);">
            <p>💡 提示：扫码后可自定义打赏金额</p>
            <p style="color: #E53935;">🔓 所有功能完全免费开放，打赏不会解锁任何额外功能</p>
          </div>
          <div class="donate-thanks" style="margin-top: 16px; color: var(--text-secondary);">
            <p>🙏 感谢您的支持！</p>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.settings-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  // ===== 隐私声明弹窗 =====
  function showPrivacyDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay show';
    overlay.innerHTML = `
      <div class="settings-panel" style="max-width: 420px;">
        <div class="settings-header">
          <h3>📋 关于软件技术 & 隐私保护 & 开源 & 金融风险的免责声明</h3>
        </div>
        <div class="settings-section" style="padding: 16px;">
          <div style="background: #fff3e0; padding: 12px; border-radius: 8px; border-left: 4px solid #ff9800; margin-bottom: 16px;">
            <p style="margin: 0; font-size: 14px; font-weight: bold; color: #e65100;">重要风险提示</p>
          </div>
          <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.8;">
            <p style="margin: 8px 0;">1. 本软件为免费学习工具，行情数据仅作参考，<strong>不构成任何投资建议，所有交易盈亏自行承担。</strong></p>
            <p style="margin: 8px 0;">2. 软件仅低频抓取公开免费行情，禁止批量爬取、商用分发第三方数据，违规后果由使用者自负。</p>
            <p style="margin: 8px 0;">3. 软件全功能免费使用，内置收款码仅自愿赞助，无付费解锁功能，赞助无对应服务对价。</p>
            <p style="margin: 8px 0;">4. 本软件不采集您证券、身份、银行卡等隐私信息，仅本地临时读取硬件标识，不上传个人数据。</p>
            <p style="margin: 8px 0;">5. 软件集成开源工具，开源版权归原作者；禁止反编译、破解、公开发布本程序。</p>
            <p style="margin: 8px 0;">6. 使用本软件即代表您知晓并承担全部金融、网络、数据合规风险。</p>
          </div>
          <div style="margin-top: 16px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <a href="#" class="policy-link" data-section="privacy" style="font-size: 12px; color: #0366d6; cursor: pointer; text-align: left;">🔒 隐私政策</a>
              <a href="#" class="policy-link" data-section="risk" style="font-size: 12px; color: #0366d6; cursor: pointer; text-align: left;">⚠️ 金融风险免责</a>
              <a href="#" class="policy-link" data-section="compliance" style="font-size: 12px; color: #0366d6; cursor: pointer; text-align: left;">📊 数据抓取合规</a>
              <a href="#" class="policy-link" data-section="donate" style="font-size: 12px; color: #0366d6; cursor: pointer; text-align: left;">💝 自愿赞助说明</a>
              <a href="#" class="policy-link" data-section="open-source" style="font-size: 12px; color: #0366d6; cursor: pointer; text-align: left;">📜 开源版权说明</a>
              <a href="#" class="policy-link" data-section="general" style="font-size: 12px; color: #0366d6; cursor: pointer; text-align: left;">⚖️ 通用免责条款</a>
            </div>
          </div>
        </div>
        <div class="settings-section" style="padding: 16px; border-top: 1px solid var(--border);">
          <div style="display: flex; gap: 8px;">
            <button id="btnRejectPrivacy" style="flex: 2; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 14px; transition: background 0.15s;">
              我拒绝
            </button>
            <button id="btnAcceptPrivacy" class="primary-btn" style="flex: 3;">
              我已阅读并同意
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#btnAcceptPrivacy').addEventListener('click', () => {
      S().privacyAccepted = true;
      S().privacyAcceptedVersion = H().getCurrentVersion();
      H().saveSettings();
      overlay.remove();
      H().reinit();
    });
    overlay.querySelector('#btnRejectPrivacy').addEventListener('click', () => {
      if (U().apiHas('exit_app')) {
        pywebview.api.exit_app();
      } else {
        window.close();
      }
    });
    overlay.querySelectorAll('.policy-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const section = link.dataset.section;
        showPolicyDetail(section);
      });
    });
  }

  function showPolicyDetail(section) {
    const policies = {
      'privacy': {
        title: '🔒 隐私政策',
        content: `<strong>一、数据收集</strong>
<p style="margin: 8px 0;">本软件仅在用户本地设备上收集和存储以下数据：</p>
<table style="width:100%; border-collapse: collapse; font-size: 12px; margin: 8px 0;">
<tr style="background: var(--bg-secondary);"><th style="padding: 6px; border: 1px solid var(--border); text-align: left;">数据类型</th><th style="padding: 6px; border: 1px solid var(--border); text-align: left;">存储位置</th><th style="padding: 6px; border: 1px solid var(--border); text-align: left;">用途</th></tr>
<tr><td style="padding: 6px; border: 1px solid var(--border);">已读消息ID</td><td style="padding: 6px; border: 1px solid var(--border);">%APPDATA%/ZTFINews/</td><td style="padding: 6px; border: 1px solid var(--border);">消息去重</td></tr>
<tr><td style="padding: 6px; border: 1px solid var(--border);">用户设置</td><td style="padding: 6px; border: 1px solid var(--border);">settings.json</td><td style="padding: 6px; border: 1px solid var(--border);">保存偏好配置</td></tr>
<tr><td style="padding: 6px; border: 1px solid var(--border);">收藏消息</td><td style="padding: 6px; border: 1px solid var(--border);">%APPDATA%/ZTFINews/</td><td style="padding: 6px; border: 1px solid var(--border);">收藏管理</td></tr>
<tr><td style="padding: 6px; border: 1px solid var(--border);">自选股列表</td><td style="padding: 6px; border: 1px solid var(--border);">%APPDATA%/ZTFINews/</td><td style="padding: 6px; border: 1px solid var(--border);">自选股管理</td></tr>
</table>
<strong>二、不收集的数据</strong>
<p style="margin: 8px 0;">本软件<strong>不会</strong>收集以下数据：</p>
<p style="margin: 4px 0 4px 16px;">• 用户个人身份信息（姓名、手机号、邮箱等）</p>
<p style="margin: 4px 0 4px 16px;">• 用户设备硬件信息（MAC地址、CPU序列号等）</p>
<p style="margin: 4px 0 4px 16px;">• 用户浏览记录或行为分析数据</p>
<p style="margin: 4px 0 4px 16px;">• 用户交易记录或账户信息</p>
<strong>三、数据使用与合规声明</strong>
<p style="margin: 8px 0;">1. 软件不会后台静默联网，所有网络请求仅为行情数据实时展示</p>
<p style="margin: 4px 0;">2. 从第三方获取的数据仅用于：在软件界面展示财经资讯、提供实时行情查询、支持消息详情查看</p>
<p style="margin: 4px 0;">3. 所有网络请求严格限流串行访问，不破解反爬机制，不使用多线程高频抓取</p>
<p style="margin: 4px 0;">4. 仅选用交易所、正规金融服务商官方免费开放 API</p>
<strong>四、数据共享</strong>
<p style="margin: 8px 0;">本软件<strong>不会</strong>将任何用户数据共享给第三方：</p>
<p style="margin: 4px 0 4px 16px;">• 不向广告商提供用户数据</p>
<p style="margin: 4px 0 4px 16px;">• 不向数据分析公司提供用户数据</p>
<p style="margin: 4px 0 4px 16px;">• 不向任何第三方平台传输用户数据</p>
<strong>五、数据安全</strong>
<p style="margin: 8px 0;">1. 所有本地数据存储在用户设备上，仅用户本人可访问</p>
<p style="margin: 4px 0;">2. 网络请求使用 HTTPS 加密传输</p>
<p style="margin: 4px 0;">3. 仅在司法机关依法出具法定文书要求时配合提供可留存的本地交互记录</p>
<strong>六、开源声明</strong>
<p style="margin: 8px 0;">本软件是开源项目（MIT License），源代码托管在 GitHub：</p>
<p style="margin: 4px 0 4px 16px;">• <a href="https://github.com/wolfjkd/zhangting-finance-news" target="_blank" style="color: #0366d6;">https://github.com/wolfjkd/zhangting-finance-news</a></p>
<p style="margin: 4px 0;">用户可自行审查源代码，确认数据处理逻辑符合本隐私政策。</p>`
      },
      'risk': {
        title: '⚠️ 金融投资重大风险免责',
        content: `1. 本软件仅为个人学习、数据展示工具，软件内全部行情、指标、数据、图表均仅作参考，<strong>绝对不构成任何投资建议、买卖操作指导、盈利预测、理财推荐，不承诺任何收益。</strong>
2. 证券、期货、基金等金融产品存在极高市场波动风险，任何依据本软件数据做出的开仓、平仓、买入、卖出操作，全部决策风险、资金盈亏损失由使用者本人全额自行承担，软件开发者不承担任何直接、间接经济赔偿责任。
3. 软件抓取的第三方公开行情存在延迟、误差、缺失、临时关停、接口失效等客观问题，开发者不保证数据实时、完整、准确，不因数据偏差承担任何损失赔偿。
4. 严禁以本软件数据作为唯一交易依据，建议使用者自行前往证券交易所、正规持牌金融机构核验真实行情与资讯。`
      },
      'compliance': {
        title: '📊 数据抓取合规声明',
        content: `1. 本软件通过开源数据工具访问互联网公开免费行情，所有网络请求严格限流串行访问，不使用代理池、多线程高频抓取、不破解任何网站验证码、登录校验、IP限制等反爬防护机制。
2. 软件仅实时临时展示行情，不批量下载、导出、分发、二次售卖第三方平台原始财经数据库，使用者不得利用本软件批量爬取、囤积、商用转发第三方数据。
3. 第三方财经网站、数据平台享有全部行情数据著作权与财产权益，若使用者违规大量抓取、商用分发引发平台维权、诉讼，全部法律责任由操作人自行承担，开发者不承担连带责任。
4. 若对应数据源平台调整访问规则、封禁接口导致软件数据功能失效，开发者无义务永久维护、补偿使用者，不承担任何损失。`
      },
      'donate': {
        title: '💝 软件使用与自愿赞助说明',
        content: `1. 本软件全部功能永久免费开放，无功能阉割、无付费解锁、无激活码强制授权机制，无论是否向开发者小额赞助，均可完整使用全部数据、展示功能。
2. 软件内置收款二维码仅为自愿开发赞助通道，属于使用者无偿赠予行为，不存在"付费换取功能、付费获取专属服务"的交易对价关系，赞助金额不代表购买软件使用权。
3. 赞助完全自愿，开发者不主动索要、不诱导、不限制未赞助用户使用；所有赞助资金仅用于软件后续优化、数据源维护，不承诺赞助后提供专属定制、一对一技术服务。
4. 本软件已开源至GitHub仓库（MIT License），用户可通过官方仓库获取源码和安装包，禁止修改后以闭源形式商用分发。`
      },
      'open-source': {
        title: '📜 开源组件版权说明',
        content: `1. 本软件采用 MIT License 开源，源代码托管于 GitHub：https://github.com/wolfjkd/zhangting-finance-news。
2. 本软件使用以下第三方开源组件：
   - pywebview（MIT License）：桌面应用框架
   - requests（Apache License 2.0）：HTTP请求库
   - websocket-client（BSD License）：WebSocket客户端
3. 开源组件版权、知识产权归原作者所有；使用者需遵守对应开源协议约束，不得拆分、剥离开源模块单独商用牟利。
4. 软件自研界面、本地逻辑代码为开发者原创（AI仅辅助代码生成），享有完整软件著作权；禁止逆向工程、破解、反编译、篡改软件程序。`
      },
      'general': {
        title: '⚖️ 通用软件免责条款',
        content: `1. 本软件按"现状"免费提供，开发者不保证程序无BUG、无崩溃、永久稳定运行；因系统兼容、网络故障、电脑硬件问题造成的程序异常，开发者不承担修复、赔偿义务。
2. 禁止使用者将本软件用于非法证券操作、内幕交易、市场操纵、数据窃取、爬虫攻击、商业侵权等任何违反《网络安全法》《著作权法》《证券法》相关法律法规的行为，违规使用全部法律责任由使用者独立承担。
3. 因不可抗力、运营商网络故障、第三方接口关停、政策监管调整导致软件无法使用，开发者无需承担任何补偿、退款、赔偿责任。
4. 使用者不得利用本软件从事盈利性批量服务、二次转售、打包售卖等商用行为，仅限个人非经营性学习使用。
5. 凡因使用本软件产生的纠纷，优先由双方友好协商解决；协商无法达成一致，争议提交软件开发者住所地人民法院管辖。
6. 本声明可随软件版本更新调整，新版声明随更新同步展示，使用者持续使用即视为接受更新后条款。`
      }
    };

    const policy = policies[section] || policies['privacy'];
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay show';
    overlay.innerHTML = `
      <div class="settings-panel" style="max-width: 520px; max-height: 90vh;">
        <div class="settings-header">
          <h3>${policy.title}</h3>
          <button class="settings-close" title="关闭">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="#e53935" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
        <div class="settings-section" style="padding: 16px; overflow-y: auto;">
          <div style="font-size: 13px; line-height: 1.8; color: var(--text-secondary);">
            ${policy.content}
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.settings-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  function showLicenseDialog() {
    const dialog = document.createElement('div');
    dialog.className = 'license-dialog';
    dialog.innerHTML = `
      <div class="license-header">
        <h3>MIT License</h3>
        <button class="dialog-close-btn" title="关闭">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
      <div class="license-content">
        <p>Copyright (c) 2026 wolfjkd</p>
        <p>Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:</p>
        <p>The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.</p>
        <p>THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.</p>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector('.dialog-close-btn').addEventListener('click', () => dialog.remove());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.remove();
    });
  }

  window.ztfi.dialogsLegal = {
    attach,
    showDonateDialog,
    showPrivacyDialog,
    showPolicyDetail,
    showLicenseDialog,
  };
})();
