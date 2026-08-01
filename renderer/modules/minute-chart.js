/**
 * 分时图绘制模块 — Canvas 绘制当日分时走势
 * 
 * 使用方式:
 *   const chart = new MinuteChart(canvasElement);
 *   chart.setData({prices: [], volumes: [], times: [], pre_close: 10.5});
 *   chart.draw();
 */

class MinuteChart {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.data = null;
        this._hoverIndex = -1;

        // 绑定鼠标事件
        canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        canvas.addEventListener('mouseleave', () => {
            this._hoverIndex = -1;
            this.draw();
        });

        // 高分屏适配
        this._setupDPR();
    }

    _setupDPR() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);
        this._width = rect.width;
        this._height = rect.height;
    }

    setData(data) {
        this.data = data;
    }

    draw() {
        if (!this.data || !this.data.prices || this.data.prices.length === 0) {
            this._drawEmpty();
            return;
        }

        this._setupDPR();
        const ctx = this.ctx;
        const W = this._width;
        const H = this._height;

        ctx.clearRect(0, 0, W, H);

        const priceH = H * 0.65;  // 价格区域高度
        const volH = H * 0.25;    // 成交量区域高度
        const volY = priceH + H * 0.05;  // 成交量区域起始Y
        const padding = { left: 2, right: 40, top: 5, bottom: 15 };

        const prices = this.data.prices;
        const volumes = this.data.volumes || [];
        const preClose = this.data.pre_close || prices[0];
        const times = this.data.times || [];

        // 计算价格范围
        let maxPrice = Math.max(...prices, preClose);
        let minPrice = Math.min(...prices, preClose);
        const range = Math.max(maxPrice - minPrice, 0.01);
        maxPrice += range * 0.1;
        minPrice -= range * 0.1;

        const drawW = W - padding.left - padding.right;
        const drawH = priceH - padding.top - padding.bottom;

        // ===== 绘制网格 =====
        ctx.strokeStyle = 'rgba(128,128,128,0.15)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = padding.top + (drawH / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(W - padding.right, y);
            ctx.stroke();
        }
        // 竖线（时间分割）
        const timeMarks = [0, Math.floor(prices.length * 0.25), Math.floor(prices.length * 0.5), Math.floor(prices.length * 0.75), prices.length - 1];
        timeMarks.forEach(i => {
            const x = padding.left + (drawW / (prices.length - 1)) * i;
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, priceH);
            ctx.stroke();
        });

        // ===== 绘制昨收线 =====
        const preCloseY = padding.top + drawH * (1 - (preClose - minPrice) / (maxPrice - minPrice));
        ctx.strokeStyle = 'rgba(128,128,128,0.5)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padding.left, preCloseY);
        ctx.lineTo(W - padding.right, preCloseY);
        ctx.stroke();
        ctx.setLineDash([]);

        // ===== 绘制价格走势 =====
        const isUp = prices[prices.length - 1] >= preClose;
        const lineColor = isUp ? '#e53935' : '#43a047';
        const fillColor = isUp ? 'rgba(229,57,53,0.1)' : 'rgba(67,160,71,0.1)';

        // 填充区域
        ctx.fillStyle = fillColor;
        ctx.beginPath();
        ctx.moveTo(padding.left, preCloseY);
        prices.forEach((p, i) => {
            const x = padding.left + (drawW / (prices.length - 1)) * i;
            const y = padding.top + drawH * (1 - (p - minPrice) / (maxPrice - minPrice));
            ctx.lineTo(x, y);
        });
        ctx.lineTo(W - padding.right, preCloseY);
        ctx.closePath();
        ctx.fill();

        // 价格线
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        prices.forEach((p, i) => {
            const x = padding.left + (drawW / (prices.length - 1)) * i;
            const y = padding.top + drawH * (1 - (p - minPrice) / (maxPrice - minPrice));
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // ===== 绘制成交量 =====
        if (volumes.length > 0) {
            const maxVol = Math.max(...volumes, 1);
            const barW = drawW / volumes.length * 0.7;
            volumes.forEach((v, i) => {
                const x = padding.left + (drawW / (volumes.length - 1 || 1)) * i;
                const barH = (v / maxVol) * (volH - 5);
                const volPrice = prices[i] || preClose;
                ctx.fillStyle = volPrice >= preClose ? 'rgba(229,57,53,0.4)' : 'rgba(67,160,71,0.4)';
                ctx.fillRect(x - barW / 2, volY + volH - barH, barW, barH);
            });
        }

        // ===== 绘制坐标轴标签 =====
        ctx.fillStyle = 'rgba(128,128,128,0.8)';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        // 价格标签
        ctx.fillText(maxPrice.toFixed(2), W - 2, padding.top + 8);
        ctx.fillText(minPrice.toFixed(2), W - 2, priceH - padding.bottom + 3);
        ctx.fillText(preClose.toFixed(2), W - 2, preCloseY + 3);
        // 时间标签
        ctx.textAlign = 'center';
        const timeLabels = ['09:30', '10:30', '11:30/13:00', '14:00', '15:00'];
        timeLabels.forEach((label, i) => {
            const x = padding.left + (drawW / 4) * i;
            ctx.fillText(label, x, H - 2);
        });

        // ===== 绘制悬停十字线 =====
        if (this._hoverIndex >= 0 && this._hoverIndex < prices.length) {
            const x = padding.left + (drawW / (prices.length - 1)) * this._hoverIndex;
            const y = padding.top + drawH * (1 - (prices[this._hoverIndex] - minPrice) / (maxPrice - minPrice));

            // 十字线
            ctx.strokeStyle = 'rgba(128,128,128,0.5)';
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, priceH);
            ctx.moveTo(padding.left, y);
            ctx.lineTo(W - padding.right, y);
            ctx.stroke();
            ctx.setLineDash([]);

            // 价格标签
            ctx.fillStyle = lineColor;
            ctx.fillRect(W - padding.right, y - 8, padding.right, 16);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(prices[this._hoverIndex].toFixed(2), W - padding.right / 2, y + 3);

            // 时间标签
            if (times[this._hoverIndex]) {
                ctx.fillStyle = 'rgba(0,0,0,0.7)';
                ctx.fillRect(x - 25, padding.top - 2, 50, 14);
                ctx.fillStyle = '#fff';
                ctx.font = '10px sans-serif';
                ctx.fillText(times[this._hoverIndex], x, padding.top + 9);
            }
        }

        // ===== 涨跌幅标记 =====
        const lastPrice = prices[prices.length - 1];
        const changePct = ((lastPrice - preClose) / preClose * 100).toFixed(2);
        ctx.fillStyle = isUp ? '#e53935' : '#43a047';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${isUp ? '+' : ''}${changePct}%`, padding.left + 2, padding.top + 10);
    }

    _drawEmpty() {
        this._setupDPR();
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this._width, this._height);
        ctx.fillStyle = 'rgba(128,128,128,0.5)';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('暂无分时数据', this._width / 2, this._height / 2);
    }

    _onMouseMove(e) {
        if (!this.data || !this.data.prices || this.data.prices.length === 0) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const padding = { left: 2, right: 40 };
        const drawW = this._width - padding.left - padding.right;

        const idx = Math.round((x - padding.left) / drawW * (this.data.prices.length - 1));
        if (idx >= 0 && idx < this.data.prices.length) {
            this._hoverIndex = idx;
            this.draw();
        }
    }

    /**
     * 定时刷新数据
     */
    startAutoRefresh(code, interval = 30) {
        this._refreshCode = code;
        this._refreshInterval = interval;
        this._refreshTimer = setInterval(async () => {
            if (!window.pywebview || !window.pywebview.api) return;
            try {
                const result = await window.pywebview.api.get_stock_minutes(code);
                const data = JSON.parse(result);
                if (data.status === 'ok') {
                    this.setData(data);
                    this.draw();
                }
            } catch (e) {
                console.error('刷新分时数据失败:', e);
            }
        }, interval * 1000);
    }

    stopAutoRefresh() {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
    }
}
