/**
 * ztfi.updateCheck — 更新检测与下载
 *
 * 覆盖：更新弹窗 / 紧急更新遮罩 / 检查更新 / 下载更新 / 下载进度，以及这些按钮的事件绑定。
 * 接缝：host 仅 showToast；utils.apiHas；DOM 引用走 window.ztfi.dom（$updateDialog 等）。
 * 说明：模块加载时即完成按钮绑定（index.html 中本模块排在 app.js 之前、DOM 之后，等价于原
 *       app.js 顶层绑定时机）。冻结接口 window._onUpdateAvailable 仍留在 app.js，它调用本模块。
 * 加载顺序：core → utils → dom → … → update-check → app.js。
 */
(function () {
  'use strict';
  window.ztfi = window.ztfi || {};

  const DOM = window.ztfi.dom;

  let _host = null;
  function attach(host) { _host = host; }
  function H() { return _host; }
  function U() { return window.ztfi.utils; }

  function showUpdateDialog(data) {
    document.getElementById('updateLatestVersion').textContent = data.latest_version || '';
    document.getElementById('updateReleaseDate').textContent = data.release_date ? '发布日期: ' + data.release_date : '';

    const changelogUl = document.getElementById('updateChangelog');
    changelogUl.innerHTML = '';
    if (data.changelog && Array.isArray(data.changelog)) {
      data.changelog.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item;
        changelogUl.appendChild(li);
      });
    }

    document.getElementById('updateProgress').style.display = 'none';
    DOM.$updateDialog.style.display = 'flex';
  }

  function showUrgentOverlay(data) {
    document.getElementById('urgentMessage').textContent = data.urgent_message || '请立即更新到最新版本以获取安全修复';
    DOM.$urgentOverlay.style.display = 'flex';
  }

  async function performUpdateCheck() {
    if (!DOM.$btnCheckUpdate) return;
    const originalText = DOM.$btnCheckUpdate.textContent;
    DOM.$btnCheckUpdate.textContent = '检查中...';
    DOM.$btnCheckUpdate.disabled = true;

    try {
      if (U().apiHas('check_update')) {
        const result = await pywebview.api.check_update();
        const data = JSON.parse(result);

        if (data.status === 'update_available') {
          if (data.urgent) {
            showUrgentOverlay(data);
          } else {
            showUpdateDialog(data);
          }
        } else if (data.status === 'latest') {
          H().showToast('✅ 当前版本已是最新版本（' + (data.current_version || '') + '）', { type: 'success' });
        } else {
          // 错误提示更明确
          const msg = data.message || '未知错误';
          if (msg.includes('网络连接') || msg.includes('无法连接') || msg.includes('timeout')) {
            H().showToast('检查更新失败：无法连接 GitHub，请检查网络/代理', { type: 'error', duration: 6000 });
            console.log('[更新检查失败详情]', msg);
          } else {
            H().showToast('检查更新失败：' + msg, { type: 'error' });
          }
        }
      } else {
        H().showToast('更新检查功能不可用', { type: 'warning' });
      }
    } catch (e) {
      H().showToast('检查更新异常: ' + e.message, { type: 'error' });
    } finally {
      DOM.$btnCheckUpdate.textContent = originalText;
      DOM.$btnCheckUpdate.disabled = false;
    }
  }

  async function downloadAndUpdate() {
    document.getElementById('updateProgress').style.display = 'block';
    document.getElementById('updateProgressFill').style.width = '0%';
    document.getElementById('updateProgressText').textContent = '0%';
    DOM.$btnUpdateNow.disabled = true;
    DOM.$btnUpdateLater.disabled = true;

    try {
      if (U().apiHas('download_update')) {
        const result = await pywebview.api.download_update();
        const data = JSON.parse(result);
        if (data.status === 'ok') {
          H().showToast(data.message, { type: 'success', duration: 5000 });
        } else {
          H().showToast('下载失败：' + (data.message || '未知错误'), { type: 'error' });
        }
      } else {
        H().showToast('更新下载 API 不可用', { type: 'error' });
      }
    } catch (e) {
      H().showToast('下载更新失败：' + e.message, { type: 'error' });
    } finally {
      DOM.$btnUpdateNow.disabled = false;
      DOM.$btnUpdateLater.disabled = false;
    }
  }

  function updateDownloadProgress(percent) {
    document.getElementById('updateProgressFill').style.width = percent + '%';
    document.getElementById('updateProgressText').textContent = percent + '%';
  }

  // ===== 按钮绑定（本模块加载时执行）=====
  if (DOM.$btnCheckUpdate) {
    DOM.$btnCheckUpdate.addEventListener('click', performUpdateCheck);
  }

  if (DOM.$btnUpdateLater) {
    DOM.$btnUpdateLater.addEventListener('click', () => {
      DOM.$updateDialog.style.display = 'none';
    });
  }

  if (DOM.$btnUpdateNow) {
    DOM.$btnUpdateNow.addEventListener('click', downloadAndUpdate);
  }

  if (DOM.$btnUrgentUpdate) {
    DOM.$btnUrgentUpdate.addEventListener('click', () => {
      DOM.$urgentOverlay.style.display = 'none';
      downloadAndUpdate();
    });
  }

  if (DOM.$btnUrgentExit) {
    DOM.$btnUrgentExit.addEventListener('click', () => {
      if (U().apiHas('exit_app')) {
        pywebview.api.exit_app();
      } else {
        window.close();
      }
    });
  }

  if (DOM.$updateDialog) {
    DOM.$updateDialog.querySelector('.dialog-close-btn').addEventListener('click', () => {
      DOM.$updateDialog.style.display = 'none';
    });
  }

  window.ztfi.updateCheck = {
    attach,
    showUpdateDialog,
    showUrgentOverlay,
    performUpdateCheck,
    downloadAndUpdate,
    updateDownloadProgress,
  };
})();
