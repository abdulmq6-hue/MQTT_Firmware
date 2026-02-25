/**
 * ATG Console - Professional Dashboard Application
 * Stingray Technologies - v2.0
 */

// ============================================
// CONFIGURATION & STATE
// ============================================
const CONFIG = {
    defaultCredentials: { username: 'admin', password: 'admin123' },
    // When true the UI will skip the login screen and show the app immediately.
    // Set to false to restore the default login behavior.
    autoLogin: true,
    maxDepth: 5000, // mm - for tank visual calculation
    refreshInterval: 10000, // ms
    inactiveTimeout: 600000, // 10 minutes in ms - mark probe deactive if no data
    chartColors: {
        volume: '#3b82f6',
        product: '#10b981',
        water: '#06b6d4',
        temp: '#f59e0b'
    }
};

const STATE = {
    isAuthenticated: false,
    currentUser: null,
    tanks: {},
    alarms: [],
    currentTankId: null,
    charts: {},
    settings: {
        lowAlarm: 100,        // Lower default - most tanks have more than 100L
        highAlarm: 100000,    // Higher default for large tanks
        waterAlarm: 100,      // 100mm water threshold
        tempAlarm: 50,        // 50°C temperature threshold
        refreshInterval: 10,
        volumeUnit: 'liters',
        tempUnit: 'celsius'
    }
};

// Socket connection
let socket = null;

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

function initializeApp() {
    // Load saved settings
    loadSettings();

    // Initialize socket connection early so UI can receive polling data even before login
    initializeSocket();

    // Check authentication
    checkAuth();

    // Setup event listeners
    setupEventListeners();

    // Start clock
    updateClock();
    setInterval(updateClock, 1000);

    // Start periodic check for inactive probes (every 60 seconds)
    setInterval(checkInactiveProbes, 60000);
}

function checkAuth() {
    // If autoLogin is enabled, shortcut authentication so the UI shows immediately
    if (CONFIG.autoLogin) {
        const user = localStorage.getItem('atg_user') || 'local';
        localStorage.setItem('atg_token', 'auto_token');
        localStorage.setItem('atg_user', user);
        STATE.isAuthenticated = true;
        STATE.currentUser = user;
        showApp();
        return;
    }

    const token = localStorage.getItem('atg_token');
    const user = localStorage.getItem('atg_user');

    if (token && user) {
        STATE.isAuthenticated = true;
        STATE.currentUser = user;
        showApp();
    } else {
        showLogin();
    }
}

// ============================================
// AUTHENTICATION
// ============================================
function setupEventListeners() {
    // Login form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    // Navigation
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;
            switchView(view);

            // Update active state
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
        });
    });

    // Mobile menu
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', toggleMobileMenu);
    }

    // Global search
    const globalSearch = document.getElementById('global-search');
    if (globalSearch) {
        globalSearch.addEventListener('input', handleGlobalSearch);
    }

    // Alarm filter buttons
    document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterAlarms(btn.dataset.filter);
        });
    });

    // Chart tank select
    const chartTankSelect = document.getElementById('chart-tank-select');
    if (chartTankSelect) {
        chartTankSelect.addEventListener('change', (e) => {
            if (e.target.value) {
                loadDashboardChart(e.target.value);
            }
        });
    }

    // Analytics tank select
    const analyticsTank = document.getElementById('analytics-tank');
    if (analyticsTank) {
        analyticsTank.addEventListener('change', loadAnalyticsChart);
    }

    const analyticsRange = document.getElementById('analytics-range');
    if (analyticsRange) {
        analyticsRange.addEventListener('change', loadAnalyticsChart);
    }

    // Calibration tank select
    const calibrationTankSelect = document.getElementById('calibration-tank-select');
    if (calibrationTankSelect) {
        calibrationTankSelect.addEventListener('change', (e) => {
            if (e.target.value) {
                loadCalibrationForTank(e.target.value);
            } else {
                hideCalibrationReadings();
            }
        });
    }
}

function handleLogin(e) {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('login-error');

    // Simple authentication (in production, use proper backend auth)
    if (username === CONFIG.defaultCredentials.username &&
        password === CONFIG.defaultCredentials.password) {

        // Store auth
        localStorage.setItem('atg_token', 'demo_token_' + Date.now());
        localStorage.setItem('atg_user', username);

        STATE.isAuthenticated = true;
        STATE.currentUser = username;

        showApp();
        showToast('Welcome back, ' + username, 'success');
    } else {
        errorEl.textContent = 'Invalid username or password';
        errorEl.classList.remove('hidden');
    }
}

function logout() {
    localStorage.removeItem('atg_token');
    localStorage.removeItem('atg_user');
    STATE.isAuthenticated = false;
    STATE.currentUser = null;

    // Disconnect socket
    if (socket) {
        socket.disconnect();
    }

    showLogin();
    showToast('You have been logged out', 'info');
}

function showLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app-container').classList.add('hidden');
}

function showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');

    // Update user display
    const userEl = document.getElementById('current-user');
    if (userEl) {
        userEl.textContent = STATE.currentUser || 'User';
    }

    // Initialize socket connection
    initializeSocket();

    // Fetch initial data
    fetchInitialState();

    // Initialize charts
    initializeDashboardChart();
}

// ============================================
// SOCKET CONNECTION
// ============================================
function initializeSocket() {
    socket = io();

    socket.on('connect', () => {
        updateConnectionStatus(true);
        updateSystemStatus('ws-status', true, 'Connected');
    });

    socket.on('disconnect', () => {
        updateConnectionStatus(false);
        updateSystemStatus('ws-status', false, 'Disconnected');
    });

    // Listen to polling data (primary source - UI displays polling data only)
    socket.on('polling-data', handlePollingData);
}

function updateConnectionStatus(connected) {
    const statusDot = document.getElementById('connection-status');
    const statusText = document.getElementById('status-text');

    if (connected) {
        statusDot.classList.add('connected');
        statusText.textContent = 'Connected';
    } else {
        statusDot.classList.remove('connected');
        statusText.textContent = 'Disconnected';
    }
}

function updateSystemStatus(elementId, online, text) {
    const el = document.getElementById(elementId);
    if (el) {
        el.className = 'status-indicator ' + (online ? 'online' : 'offline');
        el.innerHTML = `<i class="fas fa-circle"></i> ${text}`;
    }
}

// ============================================
// DATA HANDLING
// ============================================
async function fetchInitialState() {
    try {
        const response = await fetch('/api/tanks/latest');
        const result = await response.json();

        if (result.success && result.data) {
            result.data.forEach(tank => {
                const tankId = tank.Address || tank.tank_id;
                STATE.tanks[tankId] = {
                    ...tank,
                    lastSeen: new Date(tank.lastSeen || tank.time)
                };
            });

            updateDashboard();
            updateDropdowns();

            // Update system status
            updateSystemStatus('mqtt-status', true, 'Online');
            updateSystemStatus('db-status', true, 'Online');
            updateSystemStatus('poller-status', Object.keys(STATE.tanks).length > 0,
                Object.keys(STATE.tanks).length > 0 ? 'Active' : 'No Data');
        }

        // Load alarms from database
        await loadAlarms();

    } catch (e) {
        console.error('Failed to fetch initial state:', e);
        showToast('Failed to load tank data', 'error');
    }
}

function handlePollingData(data) {
    const payload = data.payload;
    const topic = data.topic;
    const tankId = topic;

    // Update state
    STATE.tanks[tankId] = {
        ...payload,
        Address: tankId,
        lastSeen: new Date()
    };

    // Update UI
    updateTankCard(tankId);
    updateSummary();
    updateLastUpdateTime();

    // Update detail view if viewing this tank
    if (STATE.currentTankId === tankId) {
        updateDetailView(tankId);
        // Update detail chart with new data point
        updateDetailChartRealtime(payload);
    }

    // Check alarms
    checkAlarms(tankId);

    // Update dropdowns if new tank
    updateDropdowns();
}

// Update detail chart in real-time with new data point
function updateDetailChartRealtime(payload) {
    if (!STATE.charts.detail) return;

    const chart = STATE.charts.detail;
    const option = chart.getOption();

    if (!option || !option.xAxis || !option.series) return;

    const now = new Date();
    const timeLabel = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Get current data arrays
    const xAxisData = option.xAxis[0].data || [];
    const volumeData = option.series[0].data || [];
    const productData = option.series[1].data || [];
    const waterData = option.series[2].data || [];
    const tempData = option.series[3].data || [];

    // Add new data point
    xAxisData.push(timeLabel);
    volumeData.push(payload.Volume || 0);
    productData.push(parseFloat(payload.Product) || 0);
    waterData.push(parseFloat(payload.Water) || 0);
    tempData.push(parseFloat(payload.Temp) || 0);

    // Keep only last 100 points to prevent memory issues
    const maxPoints = 100;
    if (xAxisData.length > maxPoints) {
        xAxisData.shift();
        volumeData.shift();
        productData.shift();
        waterData.shift();
        tempData.shift();
    }

    // Update chart immediately without animation
    chart.setOption({
        xAxis: { data: xAxisData },
        series: [
            { data: volumeData },
            { data: productData },
            { data: waterData },
            { data: tempData }
        ]
    });
}

// ============================================
// PROBE STATUS DETECTION
// ============================================

/**
 * Determine probe status based on:
 * 1. ATG device Status field: "0" = OK, "1" = error
 * 2. Data timeout: No data for 10 minutes = Deactive
 * 3. Alarm thresholds
 *
 * Priority: Deactive > Error > Alarm > Active
 */
function getProbeStatus(tankData) {
    if (!tankData) return { status: 'deactive', label: 'Deactive', cssClass: 'offline' };

    const now = new Date();
    const lastSeen = tankData.lastSeen instanceof Date ? tankData.lastSeen : new Date(tankData.lastSeen);
    const timeSinceLastData = now - lastSeen;

    // Check for inactive probe (no data for 10 minutes)
    if (timeSinceLastData > CONFIG.inactiveTimeout) {
        return { status: 'deactive', label: 'Deactive', cssClass: 'offline' };
    }

    // Check ATG device Status field (0 = OK, 1 = error)
    const atgStatus = tankData.Status;
    if (atgStatus === '1' || atgStatus === 1) {
        return { status: 'error', label: 'Error', cssClass: 'error' };
    }

    // Check alarm thresholds
    const volume = tankData.Volume || 0;
    const water = parseFloat(tankData.Water) || 0;
    const temp = parseFloat(tankData.Temp) || 0;

    const hasAlarm = volume < STATE.settings.lowAlarm ||
                     volume > STATE.settings.highAlarm ||
                     water > STATE.settings.waterAlarm ||
                     temp > STATE.settings.tempAlarm;

    if (hasAlarm) {
        return { status: 'alarm', label: 'ALARM', cssClass: 'alarm' };
    }

    // All OK
    return { status: 'active', label: 'Active', cssClass: 'online' };
}

/**
 * Check all probes for inactive status periodically
 */
function checkInactiveProbes() {
    Object.keys(STATE.tanks).forEach(tankId => {
        updateTankCard(tankId);
    });
    updateTanksTable();
    updateSummary();
}

// ============================================
// DASHBOARD
// ============================================
function updateDashboard() {
    const grid = document.getElementById('tanks-grid');
    if (!grid) return;

    // Clear empty state
    const emptyState = grid.querySelector('.empty-state');
    if (emptyState && Object.keys(STATE.tanks).length > 0) {
        emptyState.remove();
    }

    // Update or create cards
    Object.keys(STATE.tanks).forEach(tankId => {
        updateTankCard(tankId);
    });
}

function updateTankCard(tankId) {
    const grid = document.getElementById('tanks-grid');
    if (!grid) return;

    let card = document.getElementById(`tank-card-${tankId}`);
    const data = STATE.tanks[tankId];

    if (!card) {
        // Remove empty state
        const emptyState = grid.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        card = createTankCard(tankId);
        grid.appendChild(card);
    }

    // Update card content
    const volume = data.Volume || 0;
    const product = parseFloat(data.Product) || 0;
    const water = parseFloat(data.Water) || 0;
    const temp = parseFloat(data.Temp) || 0;
    const productType = data.ProductType || 'Diesel';

    // Update values
    card.querySelector('.volume-val').textContent = `${volume.toFixed(0)} L`;
    card.querySelector('.product-val').textContent = `${product.toFixed(1)} mm`;
    card.querySelector('.temp-val').textContent = `${temp.toFixed(1)} °C`;

    // Update product badge
    const badge = card.querySelector('.product-badge');
    if (badge) {
        badge.textContent = productType;
        badge.className = `product-badge ${productType.toLowerCase()}`;
    }

    // Update timestamp
    const timestampEl = card.querySelector('.timestamp-val');
    if (timestampEl && data.lastSeen) {
        timestampEl.textContent = data.lastSeen.toLocaleTimeString();
    }

    // Update visual
    const productPercent = Math.min((product / CONFIG.maxDepth) * 100, 100);
    const waterPercent = Math.min((water / CONFIG.maxDepth) * 100, 100);

    card.querySelector('.liquid').style.height = `${productPercent}%`;
    card.querySelector('.water').style.height = `${waterPercent}%`;

    // Get probe status using new status logic
    const probeStatus = getProbeStatus(data);
    const statusEl = card.querySelector('.tank-status');

    // Update card and status element
    if (probeStatus.status === 'alarm' || probeStatus.status === 'error') {
        card.classList.add('alarm');
    } else {
        card.classList.remove('alarm');
    }

    statusEl.textContent = probeStatus.label;
    statusEl.className = `tank-status ${probeStatus.cssClass}`;
}

function createTankCard(tankId) {
    const data = STATE.tanks[tankId];
    const productType = data.ProductType || 'Diesel';

    const card = document.createElement('div');
    card.className = 'tank-card';
    card.id = `tank-card-${tankId}`;
    card.onclick = () => showTankDetails(tankId);

    card.innerHTML = `
        <div class="tank-header">
            <span class="tank-name">Tank ${tankId}</span>
            <span class="tank-status online">Online</span>
        </div>
        <div class="tank-product-type">
            <span class="product-badge ${productType.toLowerCase()}">${productType}</span>
        </div>
        <div class="tank-visual-mini">
            <div class="liquid" style="height: 0%"></div>
            <div class="water" style="height: 0%"></div>
        </div>
        <div class="tank-details-row">
            <span class="detail-label">Volume</span>
            <span class="detail-val volume-val">-- L</span>
        </div>
        <div class="tank-details-row">
            <span class="detail-label">Product</span>
            <span class="detail-val product-val">-- mm</span>
        </div>
        <div class="tank-details-row">
            <span class="detail-label">Temp</span>
            <span class="detail-val temp-val">-- °C</span>
        </div>
        <div class="tank-details-row tank-timestamp">
            <span class="detail-label">Updated</span>
            <span class="detail-val timestamp-val">--</span>
        </div>
    `;

    return card;
}

function updateSummary() {
    let totalVolume = 0;
    let onlineCount = 0;
    let alarmCount = 0;
    let totalTemp = 0;

    Object.values(STATE.tanks).forEach(tank => {
        const volume = tank.Volume || 0;
        const temp = parseFloat(tank.Temp) || 0;

        const probeStatus = getProbeStatus(tank);

        // Only count volume and temp from active probes
        if (probeStatus.status === 'active' || probeStatus.status === 'alarm') {
            totalVolume += volume;
            totalTemp += temp;
            onlineCount++;
        }

        // Count alarms and errors
        if (probeStatus.status === 'alarm' || probeStatus.status === 'error') {
            alarmCount++;
        }
    });

    const avgTemp = onlineCount > 0 ? (totalTemp / onlineCount).toFixed(1) : '--';

    document.getElementById('total-volume').textContent = totalVolume.toLocaleString();
    document.getElementById('online-tanks').textContent = onlineCount;
    document.getElementById('active-alarms').textContent = alarmCount;
    document.getElementById('avg-temp').textContent = avgTemp + '°C';

    // Update badge
    const badge = document.getElementById('alarm-badge');
    if (badge) {
        badge.textContent = alarmCount;
        badge.style.display = alarmCount > 0 ? 'flex' : 'none';
    }

    const notificationCount = document.getElementById('notification-count');
    if (notificationCount) {
        notificationCount.textContent = alarmCount;
    }

    // Show alert banner if alarms
    if (alarmCount > 0) {
        showAlertBanner(`${alarmCount} active alarm(s) detected`);
    }
}

function updateDropdowns() {
    const dropdowns = [
        'chart-tank-select',
        'analytics-tank',
        'report-tank-select',
        'dip-tank-select',
        'calibration-tank-select'
    ];

    dropdowns.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;

        const existing = Array.from(select.options).map(o => o.value);

        Object.keys(STATE.tanks).forEach(tankId => {
            if (!existing.includes(tankId)) {
                const option = document.createElement('option');
                option.value = tankId;
                option.textContent = `Tank ${tankId}`;
                select.appendChild(option);
            }
        });
    });

    // Update tanks table
    updateTanksTable();
}

function updateTanksTable() {
    const tbody = document.getElementById('tanks-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    Object.entries(STATE.tanks).forEach(([tankId, tank]) => {
        const probeStatus = getProbeStatus(tank);
        const row = document.createElement('tr');

        row.innerHTML = `
            <td><strong>${tankId}</strong></td>
            <td>Station 1</td>
            <td><span class="product-badge ${(tank.ProductType || 'diesel').toLowerCase()}">${tank.ProductType || 'Diesel'}</span></td>
            <td>${parseFloat(tank.Product || 0).toFixed(1)}</td>
            <td>${(tank.Volume || 0).toLocaleString()}</td>
            <td>${parseFloat(tank.Water || 0).toFixed(1)}</td>
            <td>${parseFloat(tank.Temp || 0).toFixed(1)}</td>
            <td><span class="tank-status ${probeStatus.cssClass}">${probeStatus.label}</span></td>
            <td>
                <button class="btn-icon" onclick="showTankDetails('${tankId}')">
                    <i class="fas fa-eye"></i>
                </button>
            </td>
        `;

        tbody.appendChild(row);
    });
}

// ============================================
// TANK DETAILS
// ============================================
function showTankDetails(tankId) {
    STATE.currentTankId = tankId;
    switchView('details');
    updateDetailView(tankId);
    loadDetailChart();
}

function updateDetailView(tankId) {
    const data = STATE.tanks[tankId];
    if (!data) return;

    const volume = data.Volume || 0;
    const product = parseFloat(data.Product) || 0;
    const water = parseFloat(data.Water) || 0;
    const temp = parseFloat(data.Temp) || 0;

    document.getElementById('detail-tank-name').textContent = `Tank ${tankId}`;
    document.getElementById('detail-volume').textContent = volume.toLocaleString();
    document.getElementById('detail-product').textContent = product.toFixed(1);
    document.getElementById('detail-water-val').textContent = water.toFixed(1);
    document.getElementById('detail-temp').textContent = temp.toFixed(1);

    // Update product type dropdown
    const productType = data.ProductType || 'HSD';
    const productTypeSelect = document.getElementById('detail-product-type-select');
    if (productTypeSelect) {
        productTypeSelect.value = productType;
        // Update border color based on product type
        productTypeSelect.className = `product-type-select ${productType.toLowerCase()}`;
    }

    // Update timestamp
    const timestampEl = document.getElementById('detail-timestamp');
    if (timestampEl && data.lastSeen) {
        timestampEl.textContent = data.lastSeen.toLocaleString();
    }

    // Update visual
    const productPercent = Math.min((product / CONFIG.maxDepth) * 100, 100);
    const waterPercent = Math.min((water / CONFIG.maxDepth) * 100, 100);

    const liquidEl = document.getElementById('detail-liquid');
    const waterEl = document.getElementById('detail-water');

    if (liquidEl) liquidEl.style.height = `${productPercent}%`;
    if (waterEl) waterEl.style.height = `${waterPercent}%`;
}

// Update product type for the current tank
async function updateProductType() {
    if (!STATE.currentTankId) return;

    const productTypeSelect = document.getElementById('detail-product-type-select');
    if (!productTypeSelect) return;

    const newProductType = productTypeSelect.value;

    try {
        const response = await fetch(`/api/tanks/${STATE.currentTankId}/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productType: newProductType })
        });

        const result = await response.json();

        if (result.success) {
            // Update local state
            if (STATE.tanks[STATE.currentTankId]) {
                STATE.tanks[STATE.currentTankId].ProductType = newProductType;
            }

            // Update border color
            productTypeSelect.className = `product-type-select ${newProductType.toLowerCase()}`;

            // Update tank card on dashboard
            updateTankCard(STATE.currentTankId);

            showToast(`Product type updated to ${newProductType}`, 'success');
        } else {
            showToast('Failed to update product type', 'error');
        }
    } catch (e) {
        console.error('Update product type error:', e);
        showToast('Failed to update product type', 'error');
    }
}

function showDashboard() {
    STATE.currentTankId = null;
    switchView('dashboard');

    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.view === 'dashboard') {
            item.classList.add('active');
        }
    });
}

// ============================================
// CHARTS
// ============================================

// Helper function to format chart time based on range
function formatChartTime(dateStr, range) {
    const date = new Date(dateStr);

    switch (range) {
        case '1h':
        case '6h':
            // Show time only for short ranges
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        case '24h':
            // Show time only
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        case '7d':
            // Show date and time for week view
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
                   date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        case '30d':
            // Show date only for month view
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        default:
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}

function initializeDashboardChart() {
    const container = document.getElementById('dashboard-chart');
    if (!container) return;

    STATE.charts.dashboard = echarts.init(container);

    const option = {
        animation: false, // Disable animation for instant updates
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(26, 34, 52, 0.95)',
            borderColor: '#374151',
            textStyle: { color: '#f9fafb' }
        },
        legend: {
            data: ['Volume', 'Temperature'],
            textStyle: { color: '#9ca3af' },
            top: 10
        },
        grid: {
            left: '3%',
            right: '4%',
            bottom: '3%',
            containLabel: true
        },
        xAxis: {
            type: 'category',
            boundaryGap: false,
            data: [],
            axisLine: { lineStyle: { color: '#374151' } },
            axisLabel: { color: '#9ca3af' }
        },
        yAxis: [
            {
                type: 'value',
                name: 'Volume (L)',
                axisLine: { lineStyle: { color: '#374151' } },
                axisLabel: { color: '#9ca3af' },
                splitLine: { lineStyle: { color: '#1f2937' } }
            },
            {
                type: 'value',
                name: 'Temp (°C)',
                axisLine: { lineStyle: { color: '#374151' } },
                axisLabel: { color: '#9ca3af' },
                splitLine: { show: false }
            }
        ],
        series: [
            {
                name: 'Volume',
                type: 'line',
                smooth: true,
                data: [],
                itemStyle: { color: CONFIG.chartColors.volume },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(59, 130, 246, 0.3)' },
                        { offset: 1, color: 'rgba(59, 130, 246, 0.05)' }
                    ])
                }
            },
            {
                name: 'Temperature',
                type: 'line',
                smooth: true,
                yAxisIndex: 1,
                data: [],
                itemStyle: { color: CONFIG.chartColors.temp },
                lineStyle: { type: 'dashed' }
            }
        ]
    };

    STATE.charts.dashboard.setOption(option);

    // Handle resize
    window.addEventListener('resize', () => {
        STATE.charts.dashboard && STATE.charts.dashboard.resize();
    });
}

async function loadDashboardChart(tankId) {
    if (!STATE.charts.dashboard) return;

    try {
        const response = await fetch(`/api/history/${tankId}?range=24h`);
        const result = await response.json();

        if (result.success && result.data) {
            const times = result.data.map(d =>
                new Date(d.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            );
            const volumes = result.data.map(d => d.volume);
            const temps = result.data.map(d => d.temp);

            STATE.charts.dashboard.setOption({
                xAxis: { data: times },
                series: [
                    { data: volumes },
                    { data: temps }
                ]
            });
        }
    } catch (e) {
        console.error('Failed to load chart:', e);
    }
}

async function loadDetailChart() {
    if (!STATE.currentTankId) return;

    const container = document.getElementById('detail-history-chart');
    if (!container) return;

    if (!STATE.charts.detail) {
        STATE.charts.detail = echarts.init(container);
    }

    const range = document.getElementById('detail-chart-range')?.value || '24h';

    try {
        const response = await fetch(`/api/history/${STATE.currentTankId}?range=${range}`);
        const result = await response.json();

        if (result.success && result.data) {
            const times = result.data.map(d => formatChartTime(d.time, range));

            const option = {
                animation: false, // Disable animation for instant updates
                backgroundColor: 'transparent',
                tooltip: {
                    trigger: 'axis',
                    backgroundColor: 'rgba(26, 34, 52, 0.95)',
                    borderColor: '#374151',
                    textStyle: { color: '#f9fafb' }
                },
                legend: {
                    data: ['Volume', 'Product Level', 'Water', 'Temperature'],
                    textStyle: { color: '#9ca3af' },
                    top: 10
                },
                grid: {
                    left: '3%',
                    right: '4%',
                    bottom: '10%',
                    containLabel: true
                },
                xAxis: {
                    type: 'category',
                    boundaryGap: false,
                    data: times,
                    axisLine: { lineStyle: { color: '#374151' } },
                    axisLabel: {
                        color: '#9ca3af',
                        rotate: range === '7d' ? 45 : 0,
                        fontSize: range === '7d' || range === '30d' ? 10 : 12
                    }
                },
                yAxis: [
                    {
                        type: 'value',
                        name: 'Volume/Level',
                        axisLine: { lineStyle: { color: '#374151' } },
                        axisLabel: { color: '#9ca3af' },
                        splitLine: { lineStyle: { color: '#1f2937' } }
                    },
                    {
                        type: 'value',
                        name: 'Temp (°C)',
                        axisLine: { lineStyle: { color: '#374151' } },
                        axisLabel: { color: '#9ca3af' },
                        splitLine: { show: false }
                    }
                ],
                series: [
                    {
                        name: 'Volume',
                        type: 'line',
                        smooth: true,
                        data: result.data.map(d => d.volume),
                        itemStyle: { color: CONFIG.chartColors.volume },
                        areaStyle: {
                            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                                { offset: 0, color: 'rgba(59, 130, 246, 0.3)' },
                                { offset: 1, color: 'rgba(59, 130, 246, 0.05)' }
                            ])
                        }
                    },
                    {
                        name: 'Product Level',
                        type: 'line',
                        smooth: true,
                        data: result.data.map(d => d.product),
                        itemStyle: { color: CONFIG.chartColors.product }
                    },
                    {
                        name: 'Water',
                        type: 'line',
                        smooth: true,
                        data: result.data.map(d => d.water),
                        itemStyle: { color: CONFIG.chartColors.water }
                    },
                    {
                        name: 'Temperature',
                        type: 'line',
                        smooth: true,
                        yAxisIndex: 1,
                        data: result.data.map(d => d.temp),
                        itemStyle: { color: CONFIG.chartColors.temp },
                        lineStyle: { type: 'dashed' }
                    }
                ]
            };

            STATE.charts.detail.setOption(option);
        }
    } catch (e) {
        console.error('Failed to load detail chart:', e);
    }
}

async function loadAnalyticsChart() {
    const tankId = document.getElementById('analytics-tank')?.value;
    const range = document.getElementById('analytics-range')?.value || '24h';

    if (!tankId) return;

    // Initialize charts if needed
    const containers = ['volume-trend-chart', 'temp-chart', 'water-chart'];
    containers.forEach(id => {
        const container = document.getElementById(id);
        if (container && !STATE.charts[id]) {
            STATE.charts[id] = echarts.init(container);
        }
    });

    try {
        const response = await fetch(`/api/history/${tankId}?range=${range}`);
        const result = await response.json();

        if (result.success && result.data) {
            const times = result.data.map(d => formatChartTime(d.time, range));

            // Volume trend
            if (STATE.charts['volume-trend-chart']) {
                STATE.charts['volume-trend-chart'].setOption(createChartOption(
                    'Volume Trend',
                    times,
                    [
                        { name: 'Volume (L)', data: result.data.map(d => d.volume), color: CONFIG.chartColors.volume },
                        { name: 'Product (mm)', data: result.data.map(d => d.product), color: CONFIG.chartColors.product }
                    ],
                    range
                ));
            }

            // Temperature
            if (STATE.charts['temp-chart']) {
                STATE.charts['temp-chart'].setOption(createChartOption(
                    'Temperature',
                    times,
                    [{ name: 'Temperature (°C)', data: result.data.map(d => d.temp), color: CONFIG.chartColors.temp }],
                    range
                ));
            }

            // Water
            if (STATE.charts['water-chart']) {
                STATE.charts['water-chart'].setOption(createChartOption(
                    'Water Level',
                    times,
                    [{ name: 'Water (mm)', data: result.data.map(d => d.water), color: CONFIG.chartColors.water }],
                    range
                ));
            }
        }
    } catch (e) {
        console.error('Failed to load analytics:', e);
    }
}

function createChartOption(title, times, series, range = '24h') {
    return {
        animation: false, // Disable animation for instant updates
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            backgroundColor: 'rgba(26, 34, 52, 0.95)',
            borderColor: '#374151',
            textStyle: { color: '#f9fafb' }
        },
        legend: {
            data: series.map(s => s.name),
            textStyle: { color: '#9ca3af' },
            top: 10
        },
        grid: {
            left: '3%',
            right: '4%',
            bottom: '10%',
            containLabel: true
        },
        xAxis: {
            type: 'category',
            boundaryGap: false,
            data: times,
            axisLine: { lineStyle: { color: '#374151' } },
            axisLabel: {
                color: '#9ca3af',
                rotate: range === '7d' ? 45 : 0,
                fontSize: range === '7d' || range === '30d' ? 10 : 12
            }
        },
        yAxis: {
            type: 'value',
            axisLine: { lineStyle: { color: '#374151' } },
            axisLabel: { color: '#9ca3af' },
            splitLine: { lineStyle: { color: '#1f2937' } }
        },
        series: series.map(s => ({
            name: s.name,
            type: 'line',
            smooth: true,
            data: s.data,
            itemStyle: { color: s.color },
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: s.color.replace(')', ', 0.3)').replace('rgb', 'rgba') },
                    { offset: 1, color: s.color.replace(')', ', 0.05)').replace('rgb', 'rgba') }
                ])
            }
        }))
    };
}

// ============================================
// ALARMS
// ============================================
function checkAlarms(tankId) {
    const tank = STATE.tanks[tankId];
    if (!tank) return;

    const volume = tank.Volume || 0;
    const water = parseFloat(tank.Water) || 0;
    const temp = parseFloat(tank.Temp) || 0;

    if (volume < STATE.settings.lowAlarm) {
        addAlarm(tankId, 'LOW_LEVEL', 'warning', volume, STATE.settings.lowAlarm);
    }

    if (volume > STATE.settings.highAlarm) {
        addAlarm(tankId, 'HIGH_LEVEL', 'critical', volume, STATE.settings.highAlarm);
    }

    if (water > STATE.settings.waterAlarm) {
        addAlarm(tankId, 'HIGH_WATER', 'warning', water, STATE.settings.waterAlarm);
    }

    if (temp > STATE.settings.tempAlarm) {
        addAlarm(tankId, 'HIGH_TEMP', 'warning', temp, STATE.settings.tempAlarm);
    }
}

async function addAlarm(tankId, type, severity, value, threshold) {
    const alarmId = `ALM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const message = `${type.replace('_', ' ')} on Tank ${tankId}: Value ${value} exceeded threshold ${threshold}`;

    // Check if similar alarm already exists in local state
    const existing = STATE.alarms.find(a =>
        a.tankId === tankId && a.type === type && !a.resolved
    );

    if (existing) return;

    // Save to database
    try {
        const response = await fetch('/api/alarms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                alarmId,
                tankId,
                type,
                severity,
                value,
                threshold,
                message
            })
        });
        const result = await response.json();

        if (result.success && result.alarm) {
            const alarm = {
                id: result.alarm.alarm_id,
                tankId: result.alarm.tank_id,
                type: result.alarm.alarm_type,
                severity: result.alarm.severity,
                value: result.alarm.current_value,
                threshold: result.alarm.threshold_value,
                message: result.alarm.message,
                time: new Date(result.alarm.created_at),
                acknowledged: result.alarm.acknowledged,
                resolved: result.alarm.resolved
            };

            // Only add if not already in state
            if (!STATE.alarms.find(a => a.id === alarm.id)) {
                STATE.alarms.unshift(alarm);
                updateAlarmsDisplay();
                showToast(`${type.replace('_', ' ')} alarm on Tank ${tankId}`, 'warning');
            }
        }
    } catch (e) {
        console.error('Failed to save alarm:', e);
        // Add to local state anyway
        const alarm = {
            id: alarmId,
            tankId,
            type,
            severity,
            value,
            threshold,
            time: new Date(),
            acknowledged: false,
            resolved: false
        };
        STATE.alarms.unshift(alarm);
        updateAlarmsDisplay();
        showToast(`${type.replace('_', ' ')} alarm on Tank ${tankId}`, 'warning');
    }
}

// Load alarms from database
async function loadAlarms() {
    try {
        const response = await fetch('/api/alarms');
        const result = await response.json();

        if (result.success && result.data) {
            STATE.alarms = result.data.map(a => ({
                id: a.alarm_id,
                tankId: a.tank_id,
                type: a.alarm_type,
                severity: a.severity,
                value: a.current_value,
                threshold: a.threshold_value,
                message: a.message,
                time: new Date(a.created_at),
                acknowledged: a.acknowledged,
                resolved: a.resolved
            }));
            updateAlarmsDisplay();
            updateSummary();
        }
    } catch (e) {
        console.error('Failed to load alarms:', e);
    }
}

function updateAlarmsDisplay() {
    const recentList = document.getElementById('recent-alarms-list');
    const tableBody = document.getElementById('alarms-table-body');

    // Recent alarms (dashboard)
    if (recentList) {
        if (STATE.alarms.length === 0) {
            recentList.innerHTML = `
                <div class="no-alarms">
                    <i class="fas fa-check-circle"></i>
                    <p>No active alarms</p>
                </div>
            `;
        } else {
            recentList.innerHTML = STATE.alarms.slice(0, 5).map(alarm => `
                <div class="alarm-item ${alarm.severity === 'critical' ? '' : 'warning'}">
                    <div class="alarm-icon">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <div class="alarm-info">
                        <div class="alarm-title">Tank ${alarm.tankId} - ${alarm.type.replace('_', ' ')}</div>
                        <div class="alarm-desc">Value: ${alarm.value} | Threshold: ${alarm.threshold}</div>
                    </div>
                    <div class="alarm-time">${alarm.time.toLocaleTimeString()}</div>
                </div>
            `).join('');
        }
    }

    // Alarms table
    if (tableBody) {
        tableBody.innerHTML = STATE.alarms.map(alarm => `
            <tr>
                <td>${alarm.time.toLocaleString()}</td>
                <td>Tank ${alarm.tankId}</td>
                <td>${alarm.type.replace('_', ' ')}</td>
                <td><span class="tank-status ${alarm.severity === 'critical' ? 'alarm' : 'online'}">${alarm.severity.toUpperCase()}</span></td>
                <td>${alarm.value}</td>
                <td>${alarm.threshold}</td>
                <td><span class="tank-status ${alarm.acknowledged ? 'online' : 'alarm'}">${alarm.acknowledged ? 'Ack' : 'Active'}</span></td>
                <td>
                    <button class="btn-icon" onclick="acknowledgeAlarm('${alarm.id}')" ${alarm.acknowledged ? 'disabled' : ''}>
                        <i class="fas fa-check"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }
}

async function acknowledgeAlarm(alarmId) {
    try {
        const response = await fetch(`/api/alarms/${alarmId}/acknowledge`, {
            method: 'PUT'
        });
        const result = await response.json();

        if (result.success) {
            const alarm = STATE.alarms.find(a => a.id === alarmId);
            if (alarm) {
                alarm.acknowledged = true;
            }
            updateAlarmsDisplay();
            updateSummary();
            showToast('Alarm acknowledged', 'success');
        } else {
            showToast('Failed to acknowledge alarm', 'error');
        }
    } catch (e) {
        console.error('Acknowledge alarm error:', e);
        showToast('Failed to acknowledge alarm', 'error');
    }
}

async function acknowledgeAllAlarms() {
    try {
        const response = await fetch('/api/alarms/acknowledge-all', {
            method: 'PUT'
        });
        const result = await response.json();

        if (result.success) {
            STATE.alarms.forEach(a => a.acknowledged = true);
            updateAlarmsDisplay();
            updateSummary();
            showToast('All alarms acknowledged', 'success');
        } else {
            showToast('Failed to acknowledge alarms', 'error');
        }
    } catch (e) {
        console.error('Acknowledge all alarms error:', e);
        showToast('Failed to acknowledge alarms', 'error');
    }
}

async function filterAlarms(filter) {
    try {
        const response = await fetch(`/api/alarms?filter=${filter}`);
        const result = await response.json();

        if (result.success && result.data) {
            STATE.alarms = result.data.map(a => ({
                id: a.alarm_id,
                tankId: a.tank_id,
                type: a.alarm_type,
                severity: a.severity,
                value: a.current_value,
                threshold: a.threshold_value,
                message: a.message,
                time: new Date(a.created_at),
                acknowledged: a.acknowledged,
                resolved: a.resolved
            }));
            updateAlarmsDisplay();
        }
    } catch (e) {
        console.error('Filter alarms error:', e);
    }
}

function showAlarms() {
    switchView('alarms');
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.view === 'alarms') {
            item.classList.add('active');
        }
    });
}

// ============================================
// REPORTS
// ============================================
async function downloadReport() {
    const tankId = document.getElementById('report-tank-select')?.value;
    const range = document.getElementById('report-range')?.value || '24h';

    if (!tankId) {
        showToast('Please select a tank', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/history/${tankId}?range=${range}`);
        const result = await response.json();

        if (result.success && result.data.length > 0) {
            const headers = ['Time', 'Volume (L)', 'Product Level (mm)', 'Water Level (mm)', 'Temperature (C)'];
            const rows = result.data.map(d => [d.time, d.volume, d.product, d.water, d.temp]);
            const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

            downloadFile(csvContent, `tank_${tankId}_report_${range}.csv`, 'text/csv');
            showToast('Report downloaded successfully', 'success');
        } else {
            showToast('No data found for this range', 'error');
        }
    } catch (e) {
        console.error('Failed to generate report:', e);
        showToast('Failed to generate report', 'error');
    }
}

function generateSummary() {
    showToast('PDF generation not implemented in demo', 'info');
}

function downloadAlarmReport() {
    if (STATE.alarms.length === 0) {
        showToast('No alarms to export', 'info');
        return;
    }

    const headers = ['Time', 'Tank', 'Type', 'Severity', 'Value', 'Threshold', 'Acknowledged'];
    const rows = STATE.alarms.map(a => [
        a.time.toISOString(),
        a.tankId,
        a.type,
        a.severity,
        a.value,
        a.threshold,
        a.acknowledged
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    downloadFile(csvContent, `alarm_report_${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
    showToast('Alarm report downloaded', 'success');
}

function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function downloadDetailChart() {
    if (STATE.charts.detail) {
        const url = STATE.charts.detail.getDataURL({
            type: 'png',
            backgroundColor: '#1a2234'
        });
        const link = document.createElement('a');
        link.href = url;
        link.download = `tank_${STATE.currentTankId}_chart.png`;
        link.click();
        showToast('Chart downloaded', 'success');
    }
}

// ============================================
// SETTINGS
// ============================================
function loadSettings() {
    const saved = localStorage.getItem('atg_settings');
    if (saved) {
        const parsedSettings = JSON.parse(saved);
        // Only apply saved settings if they look reasonable
        // If old restrictive settings are saved, use defaults instead
        if (parsedSettings.lowAlarm >= 1000) {
            // Old restrictive setting detected, don't apply it
            parsedSettings.lowAlarm = 100;
        }
        if (parsedSettings.waterAlarm <= 50) {
            parsedSettings.waterAlarm = 100;
        }
        STATE.settings = { ...STATE.settings, ...parsedSettings };
    }

    // Populate form fields
    setTimeout(() => {
        const fields = {
            'setting-low-alarm': STATE.settings.lowAlarm,
            'setting-high-alarm': STATE.settings.highAlarm,
            'setting-water-alarm': STATE.settings.waterAlarm,
            'setting-temp-alarm': STATE.settings.tempAlarm,
            'refresh-interval': STATE.settings.refreshInterval,
            'volume-unit': STATE.settings.volumeUnit,
            'temp-unit': STATE.settings.tempUnit
        };

        Object.entries(fields).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.value = value;
        });
    }, 100);
}

function resetAlarms() {
    STATE.alarms = [];
    updateAlarmsDisplay();
    closeAlertBanner();
}

function saveAlarmSettings() {
    STATE.settings.lowAlarm = parseFloat(document.getElementById('setting-low-alarm')?.value) || 100;
    STATE.settings.highAlarm = parseFloat(document.getElementById('setting-high-alarm')?.value) || 100000;
    STATE.settings.waterAlarm = parseFloat(document.getElementById('setting-water-alarm')?.value) || 100;
    STATE.settings.tempAlarm = parseFloat(document.getElementById('setting-temp-alarm')?.value) || 50;

    localStorage.setItem('atg_settings', JSON.stringify(STATE.settings));
    showToast('Alarm thresholds saved', 'success');

    // Clear existing alarms and re-check with new thresholds
    resetAlarms();
    updateSummary();
}

function saveNotificationSettings() {
    showToast('Notification settings saved', 'success');
}

function saveDisplaySettings() {
    STATE.settings.refreshInterval = parseInt(document.getElementById('refresh-interval')?.value) || 10;
    STATE.settings.volumeUnit = document.getElementById('volume-unit')?.value || 'liters';
    STATE.settings.tempUnit = document.getElementById('temp-unit')?.value || 'celsius';

    localStorage.setItem('atg_settings', JSON.stringify(STATE.settings));
    showToast('Display settings saved', 'success');
}

async function uploadDipChart() {
    const tankId = document.getElementById('dip-tank-select')?.value;
    const fileInput = document.getElementById('dip-file-input');
    const statusEl = document.getElementById('dip-upload-status');

    if (!tankId) {
        showToast('Please select a tank', 'error');
        return;
    }

    if (!fileInput?.files[0]) {
        showToast('Please select a file', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('dipChart', fileInput.files[0]);

    statusEl.textContent = 'Uploading...';
    statusEl.className = 'upload-status';

    try {
        const response = await fetch(`/api/upload-dip/${tankId}`, {
            method: 'POST',
            body: formData
        });
        const result = await response.json();

        if (result.success) {
            statusEl.textContent = 'Upload successful!';
            statusEl.className = 'upload-status success';
            showToast('DIP chart uploaded successfully', 'success');
        } else {
            statusEl.textContent = `Error: ${result.message}`;
            statusEl.className = 'upload-status error';
            showToast('Upload failed', 'error');
        }
    } catch (e) {
        console.error('Upload failed:', e);
        statusEl.textContent = 'Upload failed';
        statusEl.className = 'upload-status error';
        showToast('Upload failed', 'error');
    }
}

// ============================================
// NAVIGATION & UI
// ============================================
function switchView(viewName) {
    // Hide all views
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));

    // Show selected view
    const viewEl = document.getElementById(`view-${viewName}`);
    if (viewEl) {
        viewEl.classList.remove('hidden');
    }

    // Update page title
    const titles = {
        dashboard: 'Dashboard',
        stations: 'Stations',
        tanks: 'Tank Inventory',
        charts: 'Live Analytics',
        reports: 'Reports & Export',
        alarms: 'Alarm Management',
        events: 'Event Log',
        settings: 'System Settings',
        calibration: 'Tank Calibration',
        details: 'Tank Details'
    };

    document.getElementById('current-page-title').textContent = titles[viewName] || 'Dashboard';

    // Close mobile menu
    document.getElementById('sidebar')?.classList.remove('open');

    // Load view-specific data
    if (viewName === 'charts') {
        // Resize charts after view switch
        setTimeout(() => {
            Object.values(STATE.charts).forEach(chart => {
                chart && chart.resize();
            });
        }, 100);
    }

    if (viewName === 'events') {
        loadEvents();
    }

    if (viewName === 'calibration') {
        loadCalibrationTable();
    }
}

function toggleMobileMenu() {
    document.getElementById('sidebar')?.classList.toggle('open');
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

function handleGlobalSearch(e) {
    const query = e.target.value.toLowerCase();

    // Filter tank cards
    document.querySelectorAll('.tank-card').forEach(card => {
        const tankName = card.querySelector('.tank-name')?.textContent.toLowerCase() || '';
        card.style.display = tankName.includes(query) ? '' : 'none';
    });
}

// ============================================
// EVENTS
// ============================================
function loadEvents() {
    const timeline = document.getElementById('events-timeline');
    if (!timeline) return;

    // Generate sample events
    const events = [
        { type: 'system', title: 'System Started', desc: 'ATG Monitoring System initialized', time: new Date() },
        { type: 'device', title: 'Device Connected', desc: 'ATG device online', time: new Date(Date.now() - 300000) },
        { type: 'alarm', title: 'Low Level Alert', desc: 'Tank level below threshold', time: new Date(Date.now() - 600000) },
        { type: 'user', title: 'User Login', desc: 'Administrator logged in', time: new Date(Date.now() - 900000) }
    ];

    timeline.innerHTML = events.map(event => `
        <div class="event-item">
            <div class="event-icon ${event.type}">
                <i class="fas fa-${event.type === 'system' ? 'cog' : event.type === 'device' ? 'microchip' : event.type === 'alarm' ? 'bell' : 'user'}"></i>
            </div>
            <div class="event-content">
                <div class="event-title">${event.title}</div>
                <div class="event-desc">${event.desc}</div>
            </div>
            <div class="event-time">${event.time.toLocaleTimeString()}</div>
        </div>
    `).join('');
}

function refreshEvents() {
    loadEvents();
    showToast('Events refreshed', 'info');
}

// ============================================
// UTILITIES
// ============================================
function updateClock() {
    const now = new Date();

    const clockEl = document.getElementById('header-clock');
    if (clockEl) {
        clockEl.textContent = now.toLocaleTimeString();
    }

    const dateEl = document.getElementById('header-date');
    if (dateEl) {
        dateEl.textContent = now.toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });
    }
}

function updateLastUpdateTime() {
    const el = document.getElementById('last-update-time');
    if (el) {
        el.textContent = new Date().toLocaleTimeString();
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: 'check-circle',
        error: 'exclamation-circle',
        warning: 'exclamation-triangle',
        info: 'info-circle'
    };

    toast.innerHTML = `
        <i class="fas fa-${icons[type]} toast-icon"></i>
        <span class="toast-message">${message}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;

    container.appendChild(toast);

    // Auto remove after 5 seconds
    setTimeout(() => toast.remove(), 5000);
}

function showAlertBanner(message) {
    const banner = document.getElementById('alert-banner');
    const msgEl = document.getElementById('alert-message');

    if (banner && msgEl) {
        msgEl.textContent = message;
        banner.classList.remove('hidden');
    }
}

function closeAlertBanner() {
    document.getElementById('alert-banner')?.classList.add('hidden');
}

function refreshTanks() {
    fetchInitialState();
    showToast('Tank data refreshed', 'info');
}

function refreshTankDetails() {
    if (STATE.currentTankId) {
        updateDetailView(STATE.currentTankId);
        loadDetailChart();
        showToast('Tank details refreshed', 'info');
    }
}

function openTankSettings() {
    switchView('settings');
}

function deleteTank(tankId) {
    if (!tankId) tankId = STATE.currentTankId;
    if (!tankId) {
        showToast('No tank selected', 'error');
        return;
    }

    // Show confirmation
    const confirmModal = document.getElementById('confirm-modal');
    const confirmTitle = document.getElementById('confirm-title');
    const confirmMessage = document.getElementById('confirm-message');
    const confirmBtn = document.getElementById('confirm-btn');

    if (confirmModal && confirmTitle && confirmMessage && confirmBtn) {
        confirmTitle.textContent = 'Delete Tank';
        confirmMessage.textContent = `Are you sure you want to delete Tank ${tankId}? This will remove all historical data and cannot be undone.`;
        confirmBtn.textContent = 'Delete';
        confirmBtn.onclick = () => executeDeleteTank(tankId);
        confirmModal.classList.remove('hidden');
    } else {
        // Fallback to native confirm
        if (confirm(`Are you sure you want to delete Tank ${tankId}? This will remove all historical data.`)) {
            executeDeleteTank(tankId);
        }
    }
}

async function executeDeleteTank(tankId) {
    closeConfirmModal();

    try {
        const response = await fetch(`/api/tanks/${tankId}`, {
            method: 'DELETE'
        });
        const result = await response.json();

        if (result.success) {
            // Remove from state
            delete STATE.tanks[tankId];

            // Update UI
            const card = document.getElementById(`tank-card-${tankId}`);
            if (card) card.remove();

            // Update dropdowns
            updateDropdowns();
            updateSummary();

            // Go back to dashboard if viewing deleted tank
            if (STATE.currentTankId === tankId) {
                STATE.currentTankId = null;
                showDashboard();
            }

            showToast(`Tank ${tankId} deleted successfully`, 'success');
        } else {
            showToast(result.message || 'Failed to delete tank', 'error');
        }
    } catch (e) {
        console.error('Delete tank error:', e);
        showToast('Failed to delete tank', 'error');
    }
}

function openAddStationModal() {
    showToast('Station management coming soon', 'info');
}

function closeConfirmModal() {
    document.getElementById('confirm-modal')?.classList.add('hidden');
}

function confirmAction() {
    // Placeholder for confirmation actions
    closeConfirmModal();
}

// ============================================
// CALIBRATION
// ============================================
let calibrationData = {}; // Store calibration offsets for all tanks { tankId: { product_offset, water_offset } }

async function loadCalibrationForTank(tankId) {
    const readingsDiv = document.getElementById('calibration-current-readings');
    const productEl = document.getElementById('cal-current-product');
    const waterEl = document.getElementById('cal-current-water');
    const volumeEl = document.getElementById('cal-current-volume');
    const productOffsetInput = document.getElementById('calibration-product-offset');
    const waterOffsetInput = document.getElementById('calibration-water-offset');
    const productOffsetCurrent = document.getElementById('cal-product-offset-current');
    const waterOffsetCurrent = document.getElementById('cal-water-offset-current');

    if (!readingsDiv) return;

    // Show the readings section
    readingsDiv.style.display = 'block';

    // Get current tank data
    const tankData = STATE.tanks[tankId];
    if (tankData) {
        const product = parseFloat(tankData.Product) || 0;
        const water = parseFloat(tankData.Water) || 0;
        const volume = tankData.Volume || 0;
        if (productEl) productEl.textContent = `${product.toFixed(1)} mm`;
        if (waterEl) waterEl.textContent = `${water.toFixed(1)} mm`;
        if (volumeEl) volumeEl.textContent = `${volume.toFixed(0)} L`;
    } else {
        if (productEl) productEl.textContent = '-- mm';
        if (waterEl) waterEl.textContent = '-- mm';
        if (volumeEl) volumeEl.textContent = '-- L';
    }

    // Load calibration offsets from server
    try {
        const response = await fetch(`/api/tanks/${tankId}/calibration`);
        const result = await response.json();

        if (result.success && result.calibration) {
            const productOffset = parseFloat(result.calibration.product_offset) || 0;
            const waterOffset = parseFloat(result.calibration.water_offset) || 0;
            calibrationData[tankId] = result.calibration;

            if (productOffsetCurrent) productOffsetCurrent.textContent = `${productOffset.toFixed(1)} mm`;
            if (waterOffsetCurrent) waterOffsetCurrent.textContent = `${waterOffset.toFixed(1)} mm`;
            if (productOffsetInput) productOffsetInput.value = productOffset;
            if (waterOffsetInput) waterOffsetInput.value = waterOffset;
        } else {
            calibrationData[tankId] = { product_offset: 0, water_offset: 0 };
            if (productOffsetCurrent) productOffsetCurrent.textContent = '0 mm';
            if (waterOffsetCurrent) waterOffsetCurrent.textContent = '0 mm';
            if (productOffsetInput) productOffsetInput.value = 0;
            if (waterOffsetInput) waterOffsetInput.value = 0;
        }
    } catch (e) {
        console.error('Failed to load calibration:', e);
        calibrationData[tankId] = { product_offset: 0, water_offset: 0 };
        if (productOffsetCurrent) productOffsetCurrent.textContent = '0 mm';
        if (waterOffsetCurrent) waterOffsetCurrent.textContent = '0 mm';
        if (productOffsetInput) productOffsetInput.value = 0;
        if (waterOffsetInput) waterOffsetInput.value = 0;
    }

    // Load calibration table
    loadCalibrationTable();
}

function hideCalibrationReadings() {
    const readingsDiv = document.getElementById('calibration-current-readings');
    if (readingsDiv) {
        readingsDiv.style.display = 'none';
    }
}

function setZeroPoint(type) {
    const tankId = document.getElementById('calibration-tank-select')?.value;
    if (!tankId) {
        showToast('Please select a tank first', 'error');
        return;
    }

    const tankData = STATE.tanks[tankId];
    if (!tankData) {
        showToast('No data available for this tank', 'error');
        return;
    }

    if (type === 'product') {
        const currentProduct = parseFloat(tankData.Product) || 0;
        const offsetInput = document.getElementById('calibration-product-offset');
        if (offsetInput) {
            offsetInput.value = currentProduct.toFixed(1);
        }
        showToast(`Product zero point set to ${currentProduct.toFixed(1)} mm`, 'info');
    } else if (type === 'water') {
        const currentWater = parseFloat(tankData.Water) || 0;
        const offsetInput = document.getElementById('calibration-water-offset');
        if (offsetInput) {
            offsetInput.value = currentWater.toFixed(1);
        }
        showToast(`Water zero point set to ${currentWater.toFixed(1)} mm`, 'info');
    }
}

async function saveCalibration() {
    const tankId = document.getElementById('calibration-tank-select')?.value;
    const productOffsetInput = document.getElementById('calibration-product-offset');
    const waterOffsetInput = document.getElementById('calibration-water-offset');

    if (!tankId) {
        showToast('Please select a tank first', 'error');
        return;
    }

    const productOffset = productOffsetInput ? parseFloat(productOffsetInput.value) || 0 : 0;
    const waterOffset = waterOffsetInput ? parseFloat(waterOffsetInput.value) || 0 : 0;

    try {
        const response = await fetch(`/api/tanks/${tankId}/calibration`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productOffset, waterOffset })
        });

        const result = await response.json();

        if (result.success) {
            calibrationData[tankId] = {
                product_offset: productOffset,
                water_offset: waterOffset,
                updated_at: new Date().toISOString()
            };

            // Update display
            const productOffsetCurrent = document.getElementById('cal-product-offset-current');
            const waterOffsetCurrent = document.getElementById('cal-water-offset-current');
            if (productOffsetCurrent) productOffsetCurrent.textContent = `${productOffset.toFixed(1)} mm`;
            if (waterOffsetCurrent) waterOffsetCurrent.textContent = `${waterOffset.toFixed(1)} mm`;

            // Reload calibration table
            loadCalibrationTable();

            showToast(`Calibration saved: Product=${productOffset.toFixed(1)}mm, Water=${waterOffset.toFixed(1)}mm`, 'success');
        } else {
            showToast(result.message || 'Failed to save calibration', 'error');
        }
    } catch (e) {
        console.error('Save calibration error:', e);
        showToast('Failed to save calibration', 'error');
    }
}

async function loadCalibrationTable() {
    const tbody = document.getElementById('calibration-table-body');
    if (!tbody) return;

    try {
        const response = await fetch('/api/calibrations');
        const result = await response.json();

        if (result.success && result.data && result.data.length > 0) {
            tbody.innerHTML = result.data.map(cal => {
                const lastCalibrated = cal.updated_at
                    ? new Date(cal.updated_at).toLocaleString()
                    : 'Never';
                const productOffset = parseFloat(cal.product_offset) || 0;
                const waterOffset = parseFloat(cal.water_offset) || 0;

                return `
                    <tr>
                        <td><strong>${cal.tank_id}</strong></td>
                        <td>${productOffset.toFixed(1)}</td>
                        <td>${waterOffset.toFixed(1)}</td>
                        <td>${lastCalibrated}</td>
                        <td>
                            <button class="btn-icon" onclick="editCalibration('${cal.tank_id}')" title="Edit">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-icon" onclick="resetCalibration('${cal.tank_id}')" title="Reset to 0">
                                <i class="fas fa-undo"></i>
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        } else {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5">
                        <div class="calibration-empty">
                            <i class="fas fa-sliders-h"></i>
                            <p>No calibration data yet. Select a tank above to set calibration.</p>
                        </div>
                    </td>
                </tr>
            `;
        }
    } catch (e) {
        console.error('Failed to load calibration table:', e);
        tbody.innerHTML = `
            <tr>
                <td colspan="5">
                    <div class="calibration-empty">
                        <i class="fas fa-exclamation-circle"></i>
                        <p>Failed to load calibration data</p>
                    </div>
                </td>
            </tr>
        `;
    }
}

function editCalibration(tankId) {
    // Select the tank in dropdown
    const select = document.getElementById('calibration-tank-select');
    if (select) {
        select.value = tankId;
        // Trigger change event
        select.dispatchEvent(new Event('change'));
    }
}

async function resetCalibration(tankId) {
    if (!confirm(`Reset all calibration offsets to 0 for Tank ${tankId}?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/tanks/${tankId}/calibration`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productOffset: 0, waterOffset: 0 })
        });

        const result = await response.json();

        if (result.success) {
            calibrationData[tankId] = { product_offset: 0, water_offset: 0 };
            loadCalibrationTable();

            // Update UI if this tank is currently selected
            const select = document.getElementById('calibration-tank-select');
            if (select && select.value === tankId) {
                const productOffsetCurrent = document.getElementById('cal-product-offset-current');
                const waterOffsetCurrent = document.getElementById('cal-water-offset-current');
                const productOffsetInput = document.getElementById('calibration-product-offset');
                const waterOffsetInput = document.getElementById('calibration-water-offset');

                if (productOffsetCurrent) productOffsetCurrent.textContent = '0 mm';
                if (waterOffsetCurrent) waterOffsetCurrent.textContent = '0 mm';
                if (productOffsetInput) productOffsetInput.value = 0;
                if (waterOffsetInput) waterOffsetInput.value = 0;
            }

            showToast(`Calibration reset for Tank ${tankId}`, 'success');
        } else {
            showToast('Failed to reset calibration', 'error');
        }
    } catch (e) {
        console.error('Reset calibration error:', e);
        showToast('Failed to reset calibration', 'error');
    }
}

// Handle window resize for charts
window.addEventListener('resize', () => {
    Object.values(STATE.charts).forEach(chart => {
        chart && chart.resize();
    });
});
