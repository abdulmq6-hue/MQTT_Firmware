/**
 * ATG Console - Professional Dashboard Application
 * Stingray Technologies - v2.0
 */

// ============================================
// CONFIGURATION & STATE
// ============================================
const CONFIG = {
    defaultCredentials: { username: 'admin', password: 'admin123' },
    defaultPin: '1234',
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
    tankConfigs: {},  // Store tank configurations (capacity, etc.)
    alarms: [],
    currentTankId: null,
    charts: {},
    chartTypes: {
        volume: 'area',
        temp: 'area',
        water: 'area',
        consumption: 'bar',
        deliveries: 'bar'
    },
    settings: {
        lowAlarm: 100,        // Lower default - most tanks have more than 100L
        highAlarm: 100000,    // Higher default for large tanks
        waterAlarm: 100,      // 100mm water threshold
        tempAlarm: 50,        // 50°C temperature threshold
        theftThreshold: 100,  // Theft alarm threshold in liters
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

    // Initialize theme
    initTheme();

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

// ============================================
// THEME MANAGEMENT
// ============================================
function initTheme() {
    const savedTheme = localStorage.getItem('atg_theme') || 'dark';
    applyTheme(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    localStorage.setItem('atg_theme', newTheme);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const themeIcon = document.getElementById('theme-icon');
    if (themeIcon) {
        if (theme === 'light') {
            themeIcon.className = 'fas fa-sun';
        } else {
            themeIcon.className = 'fas fa-moon';
        }
    }
}

function checkAuth() {
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

    // PIN pad setup
    setupPinPad('login-pin-pad', 'pin-dots', 'pin-submit', 'login');
    setupPinPad('modal-pin-pad', 'modal-pin-dots', 'modal-pin-submit', 'modal');
    setupPinPad('current-pin-pad', 'current-pin-dots', null, 'currentPin');
    setupPinPad('new-pin-pad', 'new-pin-dots', null, 'newPin');

    // Navigation
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;

            // Require PIN for settings
            if (view === 'settings') {
                showPasswordModal(
                    'Settings Access',
                    'Enter admin PIN to access settings:',
                    'accessSettings'
                );
                return;
            }

            // Require PIN for calibration
            if (view === 'calibration') {
                showPasswordModal(
                    'Calibration Access',
                    'Enter admin PIN to access calibration:',
                    'accessCalibration'
                );
                return;
            }

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

// ============================================
// PIN PAD SYSTEM
// ============================================
const PIN_MAX_LENGTH = 6;
const PIN_MIN_LENGTH = 4;
const pinEntries = { login: '', modal: '', currentPin: '', newPin: '' };

function setupPinPad(padId, dotsId, submitBtnId, entryKey) {
    const pad = document.getElementById(padId);
    if (!pad) return;

    pad.querySelectorAll('.pin-key').forEach(key => {
        key.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const value = key.dataset.key;
            if (value === 'clear') {
                pinEntries[entryKey] = '';
            } else if (value === 'backspace') {
                pinEntries[entryKey] = pinEntries[entryKey].slice(0, -1);
            } else if (pinEntries[entryKey].length < PIN_MAX_LENGTH) {
                pinEntries[entryKey] += value;
            }
            updatePinDots(dotsId, pinEntries[entryKey]);
            if (submitBtnId) {
                const btn = document.getElementById(submitBtnId);
                if (btn) btn.disabled = pinEntries[entryKey].length < PIN_MIN_LENGTH;
            }
        });
    });
}

function updatePinDots(dotsId, value) {
    const dots = document.querySelectorAll(`#${dotsId} .pin-dot`);
    dots.forEach((dot, i) => {
        dot.classList.toggle('filled', i < value.length);
    });
}

async function handleLogin(e) {
    e.preventDefault();
    const pin = pinEntries.login;
    const errorEl = document.getElementById('login-error');

    if (pin.length < PIN_MIN_LENGTH) {
        errorEl.textContent = 'PIN must be at least 4 digits';
        errorEl.classList.remove('hidden');
        return;
    }

    try {
        const response = await fetch('/api/credentials/verify-pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin })
        });
        const result = await response.json();

        if (result.valid) {
            localStorage.setItem('atg_token', 'demo_token_' + Date.now());
            localStorage.setItem('atg_user', 'admin');
            STATE.isAuthenticated = true;
            STATE.currentUser = 'admin';
            pinEntries.login = '';
            updatePinDots('pin-dots', '');
            showApp();
            showToast('Welcome back, Administrator', 'success');
        } else {
            pinEntries.login = '';
            updatePinDots('pin-dots', '');
            const submitBtn = document.getElementById('pin-submit');
            if (submitBtn) submitBtn.disabled = true;
            errorEl.textContent = 'Invalid PIN';
            errorEl.classList.remove('hidden');
            document.getElementById('pin-display')?.classList.add('shake');
            setTimeout(() => document.getElementById('pin-display')?.classList.remove('shake'), 500);
        }
    } catch (err) {
        console.error('Login error:', err);
        // Fallback to default PIN if server unavailable
        if (pin === CONFIG.defaultPin) {
            localStorage.setItem('atg_token', 'demo_token_' + Date.now());
            localStorage.setItem('atg_user', 'admin');
            STATE.isAuthenticated = true;
            STATE.currentUser = 'admin';
            pinEntries.login = '';
            updatePinDots('pin-dots', '');
            showApp();
            showToast('Welcome back, Administrator', 'success');
        } else {
            pinEntries.login = '';
            updatePinDots('pin-dots', '');
            const submitBtn = document.getElementById('pin-submit');
            if (submitBtn) submitBtn.disabled = true;
            errorEl.textContent = 'Invalid PIN';
            errorEl.classList.remove('hidden');
            document.getElementById('pin-display')?.classList.add('shake');
            setTimeout(() => document.getElementById('pin-display')?.classList.remove('shake'), 500);
        }
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

    // Auto-enter fullscreen on kiosk devices
    if (window.innerWidth <= 1280 && window.innerHeight <= 800 && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
    }
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

    socket.on('mqtt_message', handleMqttMessage);
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

            // Fetch configs for all tanks
            await fetchAllTankConfigs();

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

        // Load stations
        await loadStations();

    } catch (e) {
        console.error('Failed to fetch initial state:', e);
        showToast('Failed to load tank data', 'error');
    }
}

// Fetch configurations for all tanks
async function fetchAllTankConfigs() {
    const tankIds = Object.keys(STATE.tanks);

    await Promise.all(tankIds.map(async (tankId) => {
        try {
            const response = await fetch(`/api/tanks/${tankId}/config`);
            const result = await response.json();

            if (result.success && result.config) {
                STATE.tankConfigs[tankId] = {
                    capacity: parseFloat(result.config.capacity_liters) || 50000,
                    height: parseFloat(result.config.height_mm) || 2500,
                    diameter: parseFloat(result.config.diameter_mm) || 2000,
                    productType: result.config.product_type || 'HSD',
                    lowLevel: parseFloat(result.config.low_level_alert) || 1000,
                    highLevel: parseFloat(result.config.high_level_alert) || 45000
                };
            }
        } catch (err) {
            console.warn(`Failed to fetch config for tank ${tankId}:`, err);
        }
    }));
}

function handleMqttMessage(data) {
    try {
        console.log('[SOCKET] Received mqtt_message:', data.topic);
        const payload = data.payload;
        const topic = data.topic;
        const tankId = topic;

        if (!payload || !tankId) {
            console.warn('Invalid MQTT message received:', data);
            return;
        }

        // Preserve existing ProductType if the new one is empty/undefined
        const existingProductType = STATE.tanks[tankId]?.ProductType;
        const newProductType = payload.ProductType || existingProductType || 'HSD';

        // Fetch config for new tank if not already loaded
        if (!STATE.tankConfigs[tankId]) {
            fetchTankConfig(tankId);
        }

        // Update state - preserve existing data, override with new payload
        STATE.tanks[tankId] = {
            ...STATE.tanks[tankId],  // Preserve existing data
            ...payload,              // Override with new data
            ProductType: newProductType,  // Use resolved ProductType
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
    } catch (err) {
        console.error('Error handling MQTT message:', err);
    }
}

// Fetch config for a single tank
async function fetchTankConfig(tankId) {
    try {
        const response = await fetch(`/api/tanks/${tankId}/config`);
        const result = await response.json();

        if (result.success && result.config) {
            STATE.tankConfigs[tankId] = {
                capacity: parseFloat(result.config.capacity_liters) || 50000,
                height: parseFloat(result.config.height_mm) || 2500,
                diameter: parseFloat(result.config.diameter_mm) || 2000,
                productType: result.config.product_type || 'HSD',
                lowLevel: parseFloat(result.config.low_level_alert) || 1000,
                highLevel: parseFloat(result.config.high_level_alert) || 45000
            };
            // Update the tank card with new config
            updateTankCard(tankId);
        }
    } catch (err) {
        console.warn(`Failed to fetch config for tank ${tankId}:`, err);
    }
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

    // Get tank config for capacity and height
    const tankConfig = STATE.tankConfigs?.[tankId];
    const capacity = tankConfig?.capacity || 20000;
    const tankHeight = tankConfig?.tank_height || 5000;
    const ullage = Math.max(0, capacity - volume);

    // Calculate water volume based on water level and tank geometry
    const waterVol = Math.round((water / tankHeight) * capacity);

    // Get sensor status (0 = Ok, 1 = Error)
    const sensorStatus = data.Status;
    const isStatusOk = sensorStatus === "0" || sensorStatus === 0 || sensorStatus === undefined;

    // Update status indicator
    const statusValEl = card.querySelector('.status-val');
    if (statusValEl) {
        statusValEl.textContent = isStatusOk ? 'Ok' : 'Error';
        statusValEl.className = `detail-val status-val ${isStatusOk ? 'ok' : 'error'}`;
    }

    // Update values
    card.querySelector('.volume-val').textContent = `${volume.toLocaleString()} L`;
    card.querySelector('.product-val').textContent = `${product.toFixed(0)} mm`;
    card.querySelector('.temp-val').textContent = `${temp.toFixed(1)} °C`;

    // Update new parameters
    const ullageEl = card.querySelector('.ullage-val');
    if (ullageEl) ullageEl.textContent = `${ullage.toLocaleString()} L`;

    const waterEl = card.querySelector('.water-val');
    if (waterEl) waterEl.textContent = `${water.toFixed(1)} mm`;

    const waterVolEl = card.querySelector('.water-vol-val');
    if (waterVolEl) waterVolEl.textContent = `${waterVol.toLocaleString()} L`;

    // Update product type badge
    const productBadge = card.querySelector('.product-type-badge');
    if (productBadge) {
        productBadge.textContent = productType;
        productBadge.className = `product-type-badge ${productType.toLowerCase()}`;
    }

    // Update timestamp
    const timestampEl = card.querySelector('.timestamp-val');
    if (timestampEl && data.lastSeen) {
        timestampEl.textContent = data.lastSeen.toLocaleTimeString();
    }

    // Update horizontal tank visual
    const fillPercent = Math.min((volume / capacity) * 100, 100);

    // Update tank liquid fill and color
    const tankLiquid = card.querySelector('.tank-liquid');
    if (tankLiquid) {
        tankLiquid.style.height = `${fillPercent}%`;
        tankLiquid.className = `tank-liquid ${productType.toLowerCase()}`;
    }

    // Update percentage display
    const tankPercentage = card.querySelector('.tank-percentage');
    if (tankPercentage) {
        tankPercentage.textContent = `${fillPercent.toFixed(0)}%`;
        // Add low warning class if below 20%
        tankPercentage.className = `tank-percentage${fillPercent < 20 ? ' low' : ''}`;
    }

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
    const productType = data.ProductType || 'HSD';

    const card = document.createElement('div');
    card.className = 'tank-card';
    card.id = `tank-card-${tankId}`;
    card.onclick = (e) => {
        // Don't navigate if clicking on dropdown
        if (e.target.classList.contains('product-type-select')) return;
        showTankDetails(tankId);
    };

    card.innerHTML = `
        <div class="tank-header">
            <span class="tank-name">Tank ${tankId}</span>
            <span class="tank-status online">Online</span>
        </div>
        <div class="tank-product-type">
            <span class="product-type-badge ${productType.toLowerCase()}">${productType}</span>
        </div>
        <div class="tank-visual-container">
            <div class="horizontal-tank">
                <div class="tank-liquid ${productType.toLowerCase()}" style="height: 0%"></div>
                <div class="tank-reflection"></div>
                <span class="tank-percentage">0%</span>
            </div>
            <div class="tank-legs">
                <div class="tank-leg"></div>
                <div class="tank-leg"></div>
            </div>
        </div>
        <div class="tank-params-grid">
            <div class="tank-details-row">
                <span class="detail-label">Status</span>
                <span class="detail-val status-val ok">Ok</span>
            </div>
            <div class="tank-details-row">
                <span class="detail-label">Product Vol</span>
                <span class="detail-val volume-val">-- L</span>
            </div>
            <div class="tank-details-row">
                <span class="detail-label">Prod.level</span>
                <span class="detail-val product-val">-- mm</span>
            </div>
            <div class="tank-details-row">
                <span class="detail-label">Ullage</span>
                <span class="detail-val ullage-val">-- L</span>
            </div>
            <div class="tank-details-row">
                <span class="detail-label">Water Level</span>
                <span class="detail-val water-val">-- mm</span>
            </div>
            <div class="tank-details-row">
                <span class="detail-label">Water Vol</span>
                <span class="detail-val water-vol-val">-- L</span>
            </div>
            <div class="tank-details-row">
                <span class="detail-label">Temperature</span>
                <span class="detail-val temp-val">-- °C</span>
            </div>
        </div>
        <div class="tank-details-row tank-timestamp">
            <span class="detail-label">Updated</span>
            <span class="detail-val timestamp-val">--</span>
        </div>
    `;

    return card;
}

function updateSummary() {
    let onlineCount = 0;
    let totalTemp = 0;
    const productVolumes = { petrol: 0, diesel: 0, hobc: 0 };

    Object.values(STATE.tanks).forEach(tank => {
        const volume = tank.Volume || 0;
        const temp = parseFloat(tank.Temp) || 0;
        const productType = (tank.ProductType || 'HSD').toUpperCase();

        const probeStatus = getProbeStatus(tank);

        // Only count volume and temp from active probes
        if (probeStatus.status === 'active' || probeStatus.status === 'alarm') {
            totalTemp += temp;
            onlineCount++;

            // Categorize volume by product type
            if (productType === 'PMG' || productType === 'PG' || productType === 'PETROL' || productType === 'MOGAS') {
                productVolumes.petrol += volume;
            } else if (productType === 'HOBC' || productType === 'HI-OCTANE' || productType === 'HIGH OCTANE') {
                productVolumes.hobc += volume;
            } else {
                // HSD, Diesel, and any other default to diesel
                productVolumes.diesel += volume;
            }
        }
    });

    // Count actual unacknowledged alarms from STATE.alarms
    const alarmCount = STATE.alarms.filter(a => !a.acknowledged && !a.resolved).length;

    const avgTemp = onlineCount > 0 ? (totalTemp / onlineCount).toFixed(1) : '--';

    document.getElementById('volume-petrol').textContent = productVolumes.petrol.toLocaleString();
    document.getElementById('volume-diesel').textContent = productVolumes.diesel.toLocaleString();
    document.getElementById('volume-hobc').textContent = productVolumes.hobc.toLocaleString();
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

    // Update daily change percentage
    updateDailyChange();
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
    // Delay chart loading to allow container to render properly
    setTimeout(() => {
        loadDetailChart();
        // Resize after data loads
        setTimeout(() => {
            if (STATE.charts.detail) {
                STATE.charts.detail.resize();
            }
        }, 200);
    }, 50);
}

function updateDetailView(tankId) {
    const data = STATE.tanks[tankId];
    if (!data) return;

    const volume = data.Volume || 0;
    const product = parseFloat(data.Product) || 0;
    const water = parseFloat(data.Water) || 0;
    const temp = parseFloat(data.Temp) || 0;
    const status = data.Status;  // 0 = Ok, 1 = Error
    const productType = data.ProductType || 'HSD';
    const productTypeClass = productType.toLowerCase();

    // Update Tank Name
    const tankNameEl = document.getElementById('detail-tank-name');
    if (tankNameEl) tankNameEl.textContent = `Tank ${tankId}`;

    // Update Product Type Badge
    const productBadge = document.getElementById('detail-product-type-badge');
    if (productBadge) {
        productBadge.textContent = productType;
        productBadge.className = `product-badge-lg ${productTypeClass}`;
    }

    // Update Status Indicator
    const statusIndicator = document.getElementById('detail-status-indicator');
    const statusDot = statusIndicator?.querySelector('.status-dot-lg');
    const statusText = document.getElementById('detail-probe-status');
    if (statusDot) {
        statusDot.className = `status-dot-lg ${status === 0 || status === '0' ? 'ok' : 'error'}`;
    }
    if (statusText) {
        statusText.textContent = status === 0 || status === '0' ? 'Status Ok' : 'Status Error';
    }

    // Update ATG Probe Sensor Data
    const sensorStatus = document.getElementById('detail-sensor-status');
    if (sensorStatus) {
        const isOk = status === 0 || status === '0';
        sensorStatus.textContent = isOk ? 'Ok' : 'Error';
        sensorStatus.style.color = isOk ? 'var(--success)' : 'var(--danger)';
        // Update status icon
        const statusIcon = sensorStatus.closest('.sensor-item')?.querySelector('.sensor-icon');
        if (statusIcon) {
            statusIcon.className = `sensor-icon status${isOk ? '' : ' error'}`;
            const icon = statusIcon.querySelector('i');
            if (icon) icon.className = isOk ? 'fas fa-check-circle' : 'fas fa-exclamation-circle';
        }
    }

    const productLevelEl = document.getElementById('detail-product-level');
    if (productLevelEl) productLevelEl.textContent = `${product.toFixed(1)} mm`;

    const waterLevelEl = document.getElementById('detail-water-level');
    if (waterLevelEl) waterLevelEl.textContent = `${water.toFixed(1)} mm`;

    const temperatureEl = document.getElementById('detail-temperature');
    if (temperatureEl) temperatureEl.textContent = `${temp.toFixed(1)} °C`;

    // Update Inventory Data
    const volumeEl = document.getElementById('detail-volume');
    if (volumeEl) volumeEl.textContent = `${volume.toLocaleString()} L`;

    // TC Volume calculation (temperature compensated to 15°C)
    // Formula: TC Volume = Volume * (1 - expansionCoeff * (temp - 15))
    const expansionCoeffs = { 'PMG': 0.00105, 'PG': 0.00105, 'HOBC': 0.00095, 'HSD': 0.00083 };
    const expansionCoeff = expansionCoeffs[productType] || 0.00083;
    const tcVolume = volume * (1 - expansionCoeff * (temp - 15));
    const tcVolumeEl = document.getElementById('detail-tc-volume');
    if (tcVolumeEl) tcVolumeEl.textContent = `${Math.round(tcVolume).toLocaleString()} L`;

    // Update timestamp
    const timestampEl = document.getElementById('detail-timestamp');
    if (timestampEl && data.lastSeen) {
        timestampEl.textContent = data.lastSeen.toLocaleString();
    }

    // Update Tank Visual (horizontal underground tank)
    const tankLiquid = document.getElementById('detail-tank-liquid');
    const tankWater = document.getElementById('detail-tank-water');
    const fillPercentEl = document.getElementById('detail-fill-percent');

    // Update Tank Information section (fetches capacity, alarms, etc.)
    updateTankInformation(tankId, data);
}

// Update the tank visual with fill levels
function updateTankVisual(tankId, fillPercent, waterPercent, productType) {
    const tankLiquid = document.getElementById('detail-tank-liquid');
    const tankWater = document.getElementById('detail-tank-water');
    const fillPercentEl = document.getElementById('detail-fill-percent');
    const fillPctEl = document.getElementById('detail-fill-pct');
    const availableEl = document.getElementById('detail-available');

    if (tankLiquid) {
        tankLiquid.style.height = `${fillPercent}%`;
        tankLiquid.className = `tank-liquid-fill ${productType.toLowerCase()}`;
    }
    if (tankWater) {
        tankWater.style.height = `${Math.min(waterPercent, fillPercent)}%`;
    }
    if (fillPercentEl) {
        fillPercentEl.textContent = `${Math.round(fillPercent)}%`;
    }
    if (fillPctEl) {
        fillPctEl.textContent = `${fillPercent.toFixed(1)} %`;
    }
    if (availableEl) {
        availableEl.textContent = `${(100 - fillPercent).toFixed(1)} %`;
    }
}

// Update Tank Information panel with config and live data
async function updateTankInformation(tankId, data) {
    const productType = data.ProductType || 'HSD';
    const volume = data.Volume || 0;
    const product = parseFloat(data.Product) || 0;
    const water = parseFloat(data.Water) || 0;

    // Set Device Address (Tank ID)
    const addressEl = document.getElementById('detail-address');
    if (addressEl) addressEl.textContent = tankId;

    // Update product type in params
    const productTypeEl = document.getElementById('detail-product-type');
    if (productTypeEl) productTypeEl.textContent = productType;

    // First, try to get parameters from DIP chart (most accurate source)
    let dipParams = null;
    try {
        const dipResponse = await fetch(`/api/tanks/${tankId}/dip-params`);
        const dipResult = await dipResponse.json();
        if (dipResult.success && dipResult.params) {
            dipParams = dipResult.params;
            console.log(`DIP chart params for tank ${tankId}:`, dipParams);
        }
    } catch (e) {
        console.log('Could not fetch DIP params:', e.message);
    }

    // Fetch tank configuration from server
    try {
        const response = await fetch(`/api/tanks/${tankId}/config`);
        const result = await response.json();

        const config = (result.success && result.config) ? result.config : {};

        // PRIORITY: DIP chart values FIRST (most accurate), then config, then defaults
        // DIP chart is the calibration source - it defines actual tank dimensions
        let capacity, tankHeight;

        if (dipParams && dipParams.tankCapacity) {
            // Use DIP chart values (most accurate)
            capacity = dipParams.tankCapacity;
            tankHeight = dipParams.tankHeight;
            console.log(`Using DIP chart params: Capacity=${capacity}L, Height=${tankHeight}mm`);
        } else if (config.capacity_liters && config.capacity_liters !== 50000) {
            // Use config values only if they're not defaults
            capacity = parseFloat(config.capacity_liters);
            tankHeight = parseFloat(config.tank_height) || CONFIG.maxDepth || 2500;
            console.log(`Using config params: Capacity=${capacity}L, Height=${tankHeight}mm`);
        } else {
            // Fallback to defaults
            capacity = 50000;
            tankHeight = CONFIG.maxDepth || 2500;
            console.log(`Using default params: Capacity=${capacity}L, Height=${tankHeight}mm`);
        }

        const lowAlarm = config.low_alarm_threshold || STATE.settings.lowAlarm || 100;
        const highAlarm = config.high_alarm_threshold || STATE.settings.highAlarm || 48000;

        // Update capacity
        const capacityEl = document.getElementById('detail-capacity');
        if (capacityEl) capacityEl.textContent = `${capacity.toLocaleString()} L`;

        // Update tank height
        const tankHeightEl = document.getElementById('detail-tank-height');
        if (tankHeightEl) tankHeightEl.textContent = `${tankHeight.toLocaleString()} mm`;

        // Update low level alarm
        const lowAlarmEl = document.getElementById('detail-low-alarm');
        if (lowAlarmEl) lowAlarmEl.textContent = `${parseFloat(lowAlarm).toLocaleString()} L`;

        // Update high level alarm
        const highAlarmEl = document.getElementById('detail-high-alarm');
        if (highAlarmEl) highAlarmEl.textContent = `${parseFloat(highAlarm).toLocaleString()} L`;

        // Update station assignment
        const stationEl = document.getElementById('detail-station');
        if (stationEl) {
            if (config.station_id) {
                // Try to get station name from cached data
                const station = stationsData.find(s => s.station_id === config.station_id);
                if (station) {
                    stationEl.textContent = station.name;
                } else {
                    stationEl.textContent = config.station_id;
                }
            } else {
                stationEl.textContent = 'Not Assigned';
            }
        }

        // Update Ullage (Capacity - Current Volume)
        const ullage = Math.max(0, capacity - volume);
        const ullageEl = document.getElementById('detail-ullage');
        if (ullageEl) ullageEl.textContent = `${ullage.toLocaleString()} L`;

        // Update Water Volume (approximation based on water level and tank geometry)
        const waterVolume = Math.round((water / tankHeight) * capacity);
        const waterVolEl = document.getElementById('detail-water-vol');
        if (waterVolEl) waterVolEl.textContent = `${waterVolume.toLocaleString()} L`;

        // Calculate fill percentages
        const fillPercent = Math.min((volume / capacity) * 100, 100);
        const waterPercent = Math.min((waterVolume / capacity) * 100, 100);

        // Update tank visual
        updateTankVisual(tankId, fillPercent, waterPercent, productType);
    } catch (err) {
        console.error('Failed to fetch tank config:', err);
        setDefaultTankInfo(data, dipParams);
    }

    // Fetch last delivery for this tank
    try {
        const deliveryResponse = await fetch(`/api/tanks/${tankId}/last-delivery`);
        const deliveryResult = await deliveryResponse.json();
        const lastDeliveryEl = document.getElementById('detail-last-delivery');

        if (lastDeliveryEl) {
            if (deliveryResult.success && deliveryResult.delivery) {
                const deliveryDate = new Date(deliveryResult.delivery.start_time);
                lastDeliveryEl.textContent = deliveryDate.toLocaleDateString() + ' ' +
                    deliveryDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } else {
                lastDeliveryEl.textContent = 'No deliveries';
            }
        }
    } catch (err) {
        console.error('Failed to fetch last delivery:', err);
        const lastDeliveryEl = document.getElementById('detail-last-delivery');
        if (lastDeliveryEl) lastDeliveryEl.textContent = '--';
    }
}

// Set default values for Tank Information
function setDefaultTankInfo(data = {}, dipParams = null) {
    // Use DIP chart params if available, otherwise defaults
    const capacity = dipParams?.tankCapacity || 50000;
    const tankHeight = dipParams?.tankHeight || CONFIG.maxDepth || 2500;
    const volume = data.Volume || 0;
    const water = parseFloat(data.Water) || 0;
    const productType = data.ProductType || 'HSD';

    const defaults = {
        'detail-capacity': `${capacity.toLocaleString()} L`,
        'detail-tank-height': `${tankHeight.toLocaleString()} mm`,
        'detail-low-alarm': '100 L',
        'detail-high-alarm': '48,000 L',
        'detail-ullage': `${Math.max(0, capacity - volume).toLocaleString()} L`,
        'detail-water-vol': `${Math.round((water / tankHeight) * capacity).toLocaleString()} L`,
        'detail-last-delivery': '--'
    };

    Object.entries(defaults).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    });

    // Update tank visual with values
    const fillPercent = Math.min((volume / capacity) * 100, 100);
    const waterVolume = Math.round((water / tankHeight) * capacity);
    const waterPercent = Math.min((waterVolume / capacity) * 100, 100);
    updateTankVisual(null, fillPercent, waterPercent, productType);
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

            // Update liquid fill color in detail view
            const liquidEl = document.getElementById('detail-liquid');
            if (liquidEl) {
                liquidEl.className = `liquid-fill ${newProductType.toLowerCase()}`;
            }

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

// Update product type for a tank from dashboard card dropdown
async function updateTankProductType(tankId, productType) {
    try {
        const response = await fetch(`/api/tanks/${tankId}/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productType })
        });

        const result = await response.json();

        if (result.success) {
            // Update local state
            if (STATE.tanks[tankId]) {
                STATE.tanks[tankId].ProductType = productType;
            }

            // Update the dropdown styling
            const card = document.getElementById(`tank-card-${tankId}`);
            if (card) {
                const productSelect = card.querySelector('.product-type-select');
                if (productSelect) {
                    productSelect.className = `product-type-select ${productType.toLowerCase()}`;
                }
            }

            // Update tanks table
            updateTanksTable();

            showToast(`Product type updated to ${productType}`, 'success');
        } else {
            showToast('Failed to update product type', 'error');
        }
    } catch (e) {
        console.error('Update product type error:', e);
        showToast('Failed to update product type', 'error');
    }
}

// Fetch and update daily volume change percentage
async function updateDailyChange() {
    try {
        const res = await fetch('/api/stats/daily-change');
        const data = await res.json();

        if (data.success) {
            const trendEl = document.getElementById('volume-trend');
            const changeEl = document.getElementById('volume-change');

            if (trendEl && changeEl) {
                const change = parseFloat(data.change) || 0;
                const volumeChange = parseFloat(data.volumeChange) || 0;
                const opening = parseFloat(data.opening) || 0;
                const current = parseFloat(data.current) || 0;

                // Positive = gain (delivery), Negative = loss (consumption)
                const isGain = change >= 0;

                // Update styling - green for gain, red for loss
                trendEl.className = `stat-trend ${isGain ? 'up' : 'down'}`;

                const icon = trendEl.querySelector('i');
                if (icon) {
                    icon.className = `fas fa-arrow-${isGain ? 'up' : 'down'}`;
                }

                // Show absolute percentage value
                changeEl.textContent = Math.abs(change).toFixed(1);

                // Update tooltip with details
                const changeSign = isGain ? '+' : '';
                const volumeChangeFormatted = volumeChange.toLocaleString(undefined, { maximumFractionDigits: 0 });
                trendEl.title = `Daily change: ${changeSign}${volumeChangeFormatted} L (${changeSign}${change.toFixed(1)}%)\nOpening: ${opening.toLocaleString()} L\nCurrent: ${current.toLocaleString()} L`;
            }
        }
    } catch (err) {
        console.error('Failed to fetch daily change:', err);
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
            triggerOn: 'click',
            confine: true,
            backgroundColor: 'rgba(26, 34, 52, 0.95)',
            borderColor: '#374151',
            textStyle: { color: '#f9fafb', fontSize: 14 }
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

    // Initial resize after a short delay
    setTimeout(() => {
        STATE.charts.dashboard && STATE.charts.dashboard.resize();
    }, 100);

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
                    triggerOn: 'click',
                    confine: true,
                    backgroundColor: 'rgba(26, 34, 52, 0.95)',
                    borderColor: '#374151',
                    textStyle: { color: '#f9fafb', fontSize: 14 }
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
            // Resize after setting option to ensure proper dimensions
            setTimeout(() => {
                STATE.charts.detail && STATE.charts.detail.resize();
            }, 100);
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
    const containers = ['volume-trend-chart', 'temp-chart', 'water-chart', 'consumption-chart', 'deliveries-chart'];
    containers.forEach(id => {
        const container = document.getElementById(id);
        if (container && !STATE.charts[id]) {
            STATE.charts[id] = echarts.init(container);
            // Handle resize
            window.addEventListener('resize', () => {
                STATE.charts[id]?.resize();
            });
        }
    });

    try {
        const response = await fetch(`/api/history/${tankId}?range=${range}`);
        const result = await response.json();

        if (result.success && result.data && result.data.length > 0) {
            const times = result.data.map(d => formatChartTime(d.time, range));
            const data = result.data;

            // Update stats cards
            updateAnalyticsStats(data, range);

            // Calculate consumption data
            const consumptionData = calculateConsumption(data);

            // Volume trend chart
            if (STATE.charts['volume-trend-chart']) {
                STATE.charts['volume-trend-chart'].setOption(createChartOption(
                    'Volume Trend',
                    times,
                    [
                        { name: 'Volume (L)', data: data.map(d => d.volume), color: '#3b82f6', yAxisName: 'Volume (Liters)' },
                        { name: 'Product Level (mm)', data: data.map(d => d.product), color: '#10b981' }
                    ],
                    range,
                    STATE.chartTypes.volume || 'area',
                    'Time',
                    'Volume (L) / Level (mm)'
                ), true);
            }

            // Temperature chart
            if (STATE.charts['temp-chart']) {
                STATE.charts['temp-chart'].setOption(createChartOption(
                    'Temperature',
                    times,
                    [{ name: 'Temperature (°C)', data: data.map(d => d.temp), color: '#f59e0b' }],
                    range,
                    STATE.chartTypes.temp || 'area',
                    'Time',
                    'Temperature (°C)'
                ), true);
            }

            // Water chart
            if (STATE.charts['water-chart']) {
                STATE.charts['water-chart'].setOption(createChartOption(
                    'Water Level',
                    times,
                    [{ name: 'Water (mm)', data: data.map(d => d.water), color: '#06b6d4' }],
                    range,
                    STATE.chartTypes.water || 'area',
                    'Time',
                    'Water Level (mm)'
                ), true);
            }

            // Consumption chart
            if (STATE.charts['consumption-chart']) {
                STATE.charts['consumption-chart'].setOption(createConsumptionChart(consumptionData, range, STATE.chartTypes.consumption || 'bar'), true);
            }
        }

        // Load deliveries chart separately
        await loadDeliveriesChart(tankId, range);

        // Resize all analytics charts after loading
        setTimeout(() => {
            resizeAllCharts();
        }, 100);
    } catch (e) {
        console.error('Failed to load analytics:', e);
    }
}

// Update analytics stats cards
function updateAnalyticsStats(data, range) {
    if (!data || data.length === 0) return;

    const latest = data[data.length - 1];
    const first = data[0];

    // Current volume
    const currentVolume = document.getElementById('analytics-current-volume');
    if (currentVolume) {
        currentVolume.textContent = `${parseFloat(latest.volume).toLocaleString()} L`;
    }

    // Average consumption
    const avgConsumption = document.getElementById('analytics-avg-consumption');
    if (avgConsumption) {
        const totalConsumption = Math.max(0, first.volume - latest.volume);
        const hours = getHoursFromRange(range);
        const avgPerHour = hours > 0 ? totalConsumption / hours : 0;
        avgConsumption.textContent = `${avgPerHour.toFixed(1)} L/hr`;
    }

    // Average temperature
    const avgTemp = document.getElementById('analytics-avg-temp');
    if (avgTemp) {
        const validTemps = data.filter(d => d.temp !== null && d.temp !== undefined && !isNaN(d.temp));
        if (validTemps.length > 0) {
            const avg = validTemps.reduce((sum, d) => sum + parseFloat(d.temp), 0) / validTemps.length;
            avgTemp.textContent = `${avg.toFixed(1)} °C`;
        } else {
            avgTemp.textContent = '-- °C';
        }
    }

    // Water level
    const waterLevel = document.getElementById('analytics-water-level');
    if (waterLevel) {
        waterLevel.textContent = `${parseFloat(latest.water).toFixed(1)} mm`;
    }
}

// Calculate consumption data for chart
function calculateConsumption(data) {
    const consumption = [];
    for (let i = 1; i < data.length; i++) {
        const diff = data[i - 1].volume - data[i].volume;
        consumption.push({
            time: data[i].time,
            value: Math.max(0, diff) // Only positive consumption (ignore deliveries)
        });
    }
    return consumption;
}

// Get hours from range string
function getHoursFromRange(range) {
    const map = { '1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720 };
    return map[range] || 24;
}

// Create consumption chart option
function createConsumptionChart(data, range, chartType = 'bar') {
    const isDarkTheme = document.documentElement.getAttribute('data-theme') !== 'light';
    const themeColors = {
        textColor: isDarkTheme ? '#e5e7eb' : '#374151',
        axisLineColor: isDarkTheme ? '#4b5563' : '#d1d5db',
        splitLineColor: isDarkTheme ? 'rgba(75, 85, 99, 0.5)' : 'rgba(209, 213, 219, 0.5)',
        tooltipBg: isDarkTheme ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        tooltipBorder: isDarkTheme ? '#374151' : '#e5e7eb',
        tooltipText: isDarkTheme ? '#f9fafb' : '#111827'
    };

    const seriesConfig = {
        name: 'Consumption (L)',
        type: chartType === 'bar' ? 'bar' : 'line',
        data: data.map(d => d.value),
        smooth: chartType !== 'bar' ? 0.4 : false,
        itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: '#8b5cf6' },
                { offset: 1, color: '#6366f1' }
            ]),
            borderRadius: chartType === 'bar' ? [4, 4, 0, 0] : 0
        },
        emphasis: {
            itemStyle: {
                shadowBlur: 10,
                shadowColor: 'rgba(139, 92, 246, 0.5)'
            }
        }
    };

    // Add area style for area chart
    if (chartType === 'area') {
        seriesConfig.areaStyle = {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(139, 92, 246, 0.4)' },
                { offset: 1, color: 'rgba(0, 0, 0, 0)' }
            ])
        };
        seriesConfig.lineStyle = { width: 2.5 };
    }

    return {
        animation: true,
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            triggerOn: 'click',
            confine: true,
            backgroundColor: themeColors.tooltipBg,
            borderColor: themeColors.tooltipBorder,
            borderRadius: 8,
            textStyle: { color: themeColors.tooltipText, fontSize: 14, fontWeight: 'bold' }
        },
        legend: {
            data: ['Consumption (L)'],
            textStyle: { color: themeColors.textColor, fontSize: 14, fontWeight: 'bold' },
            top: 5
        },
        grid: {
            left: '3%',
            right: '4%',
            top: '55',
            bottom: '18%',
            containLabel: true
        },
        xAxis: {
            type: 'category',
            boundaryGap: chartType === 'bar',
            data: data.map(d => formatChartTime(d.time, range)),
            name: 'Time',
            nameLocation: 'middle',
            nameGap: 40,
            nameTextStyle: { color: themeColors.textColor, fontSize: 14, fontWeight: 'bold' },
            axisLine: { lineStyle: { color: themeColors.axisLineColor, width: 2 } },
            axisLabel: { color: themeColors.textColor, fontSize: 13, fontWeight: 'bold' }
        },
        yAxis: {
            type: 'value',
            name: 'Consumption (Liters)',
            nameLocation: 'middle',
            nameGap: 55,
            nameTextStyle: { color: themeColors.textColor, fontSize: 14, fontWeight: 'bold' },
            axisLine: { show: false },
            axisLabel: { color: themeColors.textColor, fontSize: 13, fontWeight: 'bold' },
            splitLine: { lineStyle: { color: themeColors.splitLineColor, type: 'dashed' } }
        },
        series: [seriesConfig]
    };
}

// Load deliveries chart
async function loadDeliveriesChart(tankId, range) {
    if (!STATE.charts['deliveries-chart']) return;

    try {
        const response = await fetch(`/api/deliveries/${tankId}`);
        const result = await response.json();

        if (result.success && result.data && result.data.length > 0) {
            // Filter deliveries based on range
            const now = new Date();
            const rangeHours = getHoursFromRange(range);
            const cutoff = new Date(now.getTime() - rangeHours * 60 * 60 * 1000);

            // Use start_time field from database
            let filteredDeliveries = result.data.filter(d => new Date(d.start_time) >= cutoff);

            // Reverse to show oldest first (ascending order: left to right)
            filteredDeliveries = filteredDeliveries.reverse();

            if (filteredDeliveries.length > 0) {
                const chartType = STATE.chartTypes.deliveries || 'bar';
                STATE.charts['deliveries-chart'].setOption(createDeliveriesChart(filteredDeliveries, range, chartType), true);
            } else {
                // Show empty state
                STATE.charts['deliveries-chart'].setOption(createEmptyDeliveriesChart(), true);
            }
        } else {
            STATE.charts['deliveries-chart'].setOption(createEmptyDeliveriesChart(), true);
        }
    } catch (e) {
        console.error('Failed to load deliveries chart:', e);
    }
}

// Create deliveries chart option
function createDeliveriesChart(deliveries, range, chartType = 'bar') {
    const isDarkTheme = document.documentElement.getAttribute('data-theme') !== 'light';
    const themeColors = {
        textColor: isDarkTheme ? '#e5e7eb' : '#374151',
        axisLineColor: isDarkTheme ? '#4b5563' : '#d1d5db',
        splitLineColor: isDarkTheme ? 'rgba(75, 85, 99, 0.5)' : 'rgba(209, 213, 219, 0.5)',
        tooltipBg: isDarkTheme ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        tooltipBorder: isDarkTheme ? '#374151' : '#e5e7eb',
        tooltipText: isDarkTheme ? '#f9fafb' : '#111827'
    };

    // Use correct field names from database
    const times = deliveries.map(d => formatChartTime(d.start_time, range));
    const volumes = deliveries.map(d => parseFloat(d.delivered_volume_l) || 0);

    const seriesConfig = {
        name: 'Delivery Volume',
        type: chartType === 'bar' ? 'bar' : 'line',
        data: volumes,
        smooth: chartType !== 'bar' ? 0.4 : false,
        barWidth: chartType === 'bar' ? '60%' : undefined,
        itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: '#10b981' },
                { offset: 1, color: '#059669' }
            ]),
            borderRadius: chartType === 'bar' ? [4, 4, 0, 0] : 0
        },
        emphasis: {
            itemStyle: {
                shadowBlur: 10,
                shadowColor: 'rgba(16, 185, 129, 0.5)'
            }
        },
        label: chartType === 'bar' ? {
            show: true,
            position: 'top',
            color: themeColors.textColor,
            fontSize: 12,
            fontWeight: 'bold',
            formatter: function(params) {
                return params.value >= 1000 ? (params.value / 1000).toFixed(1) + 'K' : params.value;
            }
        } : { show: false }
    };

    // Add area style for area chart
    if (chartType === 'area') {
        seriesConfig.areaStyle = {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(16, 185, 129, 0.4)' },
                { offset: 1, color: 'rgba(0, 0, 0, 0)' }
            ])
        };
        seriesConfig.lineStyle = { width: 2.5 };
    }

    return {
        animation: true,
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            triggerOn: 'click',
            confine: true,
            backgroundColor: themeColors.tooltipBg,
            borderColor: themeColors.tooltipBorder,
            borderWidth: 1,
            borderRadius: 8,
            padding: [12, 16],
            textStyle: {
                color: themeColors.tooltipText,
                fontSize: 14,
                fontWeight: 'bold'
            },
            formatter: function(params) {
                const idx = params[0].dataIndex;
                const delivery = deliveries[idx];
                const volume = parseFloat(delivery.delivered_volume_l) || 0;
                const before = parseFloat(delivery.start_volume_l) || 0;
                const after = parseFloat(delivery.end_volume_l) || 0;
                return `<strong>${params[0].axisValue}</strong><br/>
                        Delivered: <strong>${volume.toLocaleString()} L</strong><br/>
                        Before: ${before.toLocaleString()} L<br/>
                        After: ${after.toLocaleString()} L`;
            }
        },
        legend: {
            data: ['Delivery Volume'],
            textStyle: { color: themeColors.textColor, fontSize: 14, fontWeight: 'bold' },
            top: 5
        },
        grid: {
            left: '3%',
            right: '4%',
            top: '55',
            bottom: '18%',
            containLabel: true
        },
        xAxis: {
            type: 'category',
            boundaryGap: chartType === 'bar',
            data: times,
            name: 'Time',
            nameLocation: 'middle',
            nameGap: 40,
            nameTextStyle: { color: themeColors.textColor, fontSize: 14, fontWeight: 'bold' },
            axisLine: { lineStyle: { color: themeColors.axisLineColor, width: 2 } },
            axisLabel: {
                color: themeColors.textColor,
                rotate: range === '7d' || range === '30d' ? 45 : 0,
                fontSize: 13,
                fontWeight: 'bold'
            }
        },
        yAxis: {
            type: 'value',
            name: 'Delivered Volume (Liters)',
            nameLocation: 'middle',
            nameGap: 55,
            nameTextStyle: { color: themeColors.textColor, fontSize: 14, fontWeight: 'bold' },
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { color: themeColors.textColor, fontSize: 13, fontWeight: 'bold' },
            splitLine: {
                lineStyle: { color: themeColors.splitLineColor, type: 'dashed' }
            }
        },
        series: [seriesConfig]
    };
}

// Create empty deliveries chart
function createEmptyDeliveriesChart() {
    const isDarkTheme = document.documentElement.getAttribute('data-theme') !== 'light';
    return {
        backgroundColor: 'transparent',
        title: {
            text: 'No Deliveries in Selected Period',
            left: 'center',
            top: 'center',
            textStyle: {
                color: isDarkTheme ? '#9ca3af' : '#6b7280',
                fontSize: 16,
                fontWeight: 'bold'
            }
        }
    };
}

// Set chart type for any analytics chart
function setChartType(chart, type) {
    // Store chart type for specific chart
    STATE.chartTypes[chart] = type;

    // Update button states for this specific chart
    document.querySelectorAll(`.chart-btn[data-chart="${chart}"]`).forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.chartType === type) {
            btn.classList.add('active');
        }
    });

    // Reload charts
    loadAnalyticsChart();
}

function createChartOption(title, times, series, range = '24h', chartType = 'area', xAxisName = 'Time', yAxisName = '') {
    const isDarkTheme = document.documentElement.getAttribute('data-theme') !== 'light';

    const themeColors = {
        textColor: isDarkTheme ? '#e5e7eb' : '#374151',
        axisLineColor: isDarkTheme ? '#4b5563' : '#d1d5db',
        splitLineColor: isDarkTheme ? 'rgba(75, 85, 99, 0.5)' : 'rgba(209, 213, 219, 0.5)',
        tooltipBg: isDarkTheme ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        tooltipBorder: isDarkTheme ? '#374151' : '#e5e7eb',
        tooltipText: isDarkTheme ? '#f9fafb' : '#111827'
    };

    return {
        animation: true,
        animationDuration: 500,
        animationEasing: 'cubicOut',
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            triggerOn: 'click',
            confine: true,
            backgroundColor: themeColors.tooltipBg,
            borderColor: themeColors.tooltipBorder,
            borderWidth: 1,
            borderRadius: 8,
            padding: [12, 16],
            textStyle: {
                color: themeColors.tooltipText,
                fontSize: 14,
                fontWeight: 'bold'
            },
            axisPointer: {
                type: 'cross',
                crossStyle: { color: themeColors.textColor },
                lineStyle: { color: themeColors.axisLineColor, type: 'dashed' }
            }
        },
        legend: {
            data: series.map(s => s.name),
            textStyle: { color: themeColors.textColor, fontSize: 14, fontWeight: 'bold' },
            top: 5,
            icon: 'roundRect',
            itemWidth: 16,
            itemHeight: 10,
            itemGap: 25
        },
        grid: {
            left: '3%',
            right: '4%',
            top: '55',
            bottom: '18%',
            containLabel: true
        },
        xAxis: {
            type: 'category',
            boundaryGap: chartType === 'bar',
            data: times,
            name: xAxisName,
            nameLocation: 'middle',
            nameGap: 40,
            nameTextStyle: {
                color: themeColors.textColor,
                fontSize: 14,
                fontWeight: 'bold'
            },
            axisLine: {
                lineStyle: { color: themeColors.axisLineColor, width: 2 }
            },
            axisTick: {
                alignWithLabel: true,
                lineStyle: { color: themeColors.axisLineColor }
            },
            axisLabel: {
                color: themeColors.textColor,
                rotate: range === '7d' || range === '30d' ? 45 : 0,
                fontSize: 13,
                fontWeight: 'bold',
                margin: 14
            }
        },
        yAxis: {
            type: 'value',
            name: yAxisName,
            nameLocation: 'middle',
            nameGap: 55,
            nameTextStyle: {
                color: themeColors.textColor,
                fontSize: 14,
                fontWeight: 'bold'
            },
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: {
                color: themeColors.textColor,
                fontSize: 13,
                fontWeight: 'bold'
            },
            splitLine: {
                lineStyle: {
                    color: themeColors.splitLineColor,
                    type: 'dashed'
                }
            }
        },
        series: series.map(s => {
            const baseSeries = {
                name: s.name,
                type: chartType === 'bar' ? 'bar' : 'line',
                smooth: chartType !== 'bar' ? 0.4 : false,
                data: s.data,
                symbol: 'circle',
                symbolSize: 6,
                showSymbol: false,
                emphasis: {
                    focus: 'series',
                    itemStyle: {
                        shadowBlur: 10,
                        shadowColor: s.color
                    }
                },
                itemStyle: {
                    color: s.color,
                    borderRadius: chartType === 'bar' ? [4, 4, 0, 0] : 0
                },
                lineStyle: {
                    width: 2.5,
                    shadowColor: s.color,
                    shadowBlur: 8,
                    shadowOffsetY: 4
                }
            };

            if (chartType === 'area') {
                baseSeries.areaStyle = {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: hexToRgba(s.color, 0.4) },
                        { offset: 1, color: 'rgba(0, 0, 0, 0)' }
                    ])
                };
            }

            return baseSeries;
        }),
        dataZoom: range === '7d' || range === '30d' ? [
            {
                type: 'inside',
                start: 70,
                end: 100
            },
            {
                type: 'slider',
                show: true,
                height: 20,
                bottom: 0,
                borderColor: themeColors.axisLineColor,
                backgroundColor: 'transparent',
                fillerColor: 'rgba(59, 130, 246, 0.2)',
                handleStyle: { color: '#3b82f6' },
                textStyle: { color: themeColors.textColor }
            }
        ] : []
    };
}

// Helper function to convert hex to rgba
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
// REPORTS - Enhanced Reporting System
// ============================================

// Switch report tabs
function switchReportTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.report-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.report-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
    });

    // Load data for the active tab
    switch (tabName) {
        case 'deliveries':
            loadDeliveryReport();
            break;
        case 'alarms':
            loadAlarmReport();
            break;
        case 'reconciliation':
            initReconciliationDropdowns();
            break;
        case 'trends':
            initTrendDropdowns();
            loadTrendChart();
            break;
    }
}

// Load delivery reports
async function loadDeliveryReport() {
    const period = document.getElementById('delivery-period')?.value || 'daily';
    const date = document.getElementById('delivery-date')?.value || new Date().toISOString().split('T')[0];
    const tankId = document.getElementById('delivery-tank')?.value || '';

    try {
        const params = new URLSearchParams({ period, date });
        if (tankId) params.append('tankId', tankId);

        const res = await fetch(`/api/reports/deliveries?${params}`);
        const data = await res.json();

        if (data.success) {
            // Update summary
            document.getElementById('delivery-count').textContent = data.summary.deliveryCount;
            document.getElementById('delivery-total').textContent = `${parseFloat(data.summary.totalDelivered).toLocaleString()} L`;

            // Render table
            const tbody = document.getElementById('delivery-table-body');
            if (tbody) {
                tbody.innerHTML = data.data.length > 0 ? data.data.map(d => `
                    <tr>
                        <td>${new Date(d.start_time).toLocaleString()}</td>
                        <td>Tank ${d.tank_id}</td>
                        <td>${d.product_type || '-'}</td>
                        <td>${parseFloat(d.start_volume_l || 0).toFixed(0)}</td>
                        <td>${parseFloat(d.end_volume_l || 0).toFixed(0)}</td>
                        <td><strong>${parseFloat(d.delivered_volume_l || 0).toFixed(0)}</strong></td>
                        <td>${parseFloat(d.water_level_mm || 0).toFixed(1)}</td>
                    </tr>
                `).join('') : '<tr><td colspan="7" class="text-center text-muted">No deliveries found</td></tr>';
            }
        }
    } catch (err) {
        console.error('Failed to load delivery report:', err);
    }
}

// Load alarm reports
async function loadAlarmReport() {
    const type = document.getElementById('alarm-type-filter')?.value || '';
    const severity = document.getElementById('alarm-severity-filter')?.value || '';
    const range = document.getElementById('alarm-report-range')?.value || '7d';

    try {
        const params = new URLSearchParams({ range });
        if (type) params.append('type', type);
        if (severity) params.append('severity', severity);

        const res = await fetch(`/api/alarms?${params}`);
        const data = await res.json();

        const tbody = document.getElementById('alarm-report-body');
        if (tbody) {
            const alarms = Array.isArray(data) ? data : (data.data || data.alarms || []);
            tbody.innerHTML = alarms.length > 0 ? alarms.map(a => `
                <tr>
                    <td>${new Date(a.created_at).toLocaleString()}</td>
                    <td>Tank ${a.tank_id}</td>
                    <td>${a.alarm_type}</td>
                    <td><span class="tank-status ${a.severity?.toLowerCase() === 'critical' ? 'alarm' : 'online'}">${a.severity}</span></td>
                    <td>${parseFloat(a.current_value || 0).toFixed(1)}</td>
                    <td>${parseFloat(a.threshold_value || 0).toFixed(1)}</td>
                    <td>${a.acknowledged ? 'Acknowledged' : 'Active'}</td>
                </tr>
            `).join('') : '<tr><td colspan="7" class="text-center text-muted">No alarms found</td></tr>';
        }
    } catch (err) {
        console.error('Failed to load alarm report:', err);
    }
}

// Initialize reconciliation dropdowns
function initReconciliationDropdowns() {
    const tankIds = Object.keys(STATE.tanks);
    const reconTankSelect = document.getElementById('recon-tank');
    const salesTankSelect = document.getElementById('sales-tank');

    [reconTankSelect, salesTankSelect].forEach(select => {
        if (select && select.options.length <= 1) {
            tankIds.forEach(id => {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = `Tank ${id}`;
                select.appendChild(opt);
            });
        }
    });

    // Set default dates
    const today = new Date().toISOString().split('T')[0];
    const reconDate = document.getElementById('recon-date');
    const salesDate = document.getElementById('sales-date');
    if (reconDate && !reconDate.value) reconDate.value = today;
    if (salesDate && !salesDate.value) salesDate.value = today;
}

// Load reconciliation data
// Store reconciliation data for calculations
let reconData = null;

async function loadReconciliation() {
    const tankId = document.getElementById('recon-tank')?.value;
    const period = document.getElementById('recon-period')?.value || 'daily';
    const date = document.getElementById('recon-date')?.value;

    if (!tankId) {
        showToast('Please select a tank', 'warning');
        return;
    }

    try {
        const params = new URLSearchParams({ tankId, period });
        if (date) params.append('date', date);

        const res = await fetch(`/api/reports/reconciliation?${params}`);
        const data = await res.json();

        if (data.success && data.reconciliation) {
            reconData = data.reconciliation;
            const r = reconData;

            // Display basic values
            document.getElementById('recon-opening').textContent = `${parseFloat(r.openingVolume).toLocaleString()} L`;
            document.getElementById('recon-deliveries').textContent = `+ ${parseFloat(r.totalDeliveries).toLocaleString()} L`;
            document.getElementById('recon-sales').textContent = `- ${parseFloat(r.calculatedSales).toLocaleString()} L`;
            document.getElementById('recon-actual').textContent = `${parseFloat(r.actualClosing).toLocaleString()} L`;

            // Calculate with dispenser sales if entered
            calculateReconciliation();

            document.getElementById('recon-results').style.display = 'block';
        }
    } catch (err) {
        console.error('Failed to load reconciliation:', err);
        showToast('Failed to load reconciliation data', 'error');
    }
}

// Calculate reconciliation with dispenser sales
function calculateReconciliation() {
    if (!reconData) return;

    const dispenserSalesInput = document.getElementById('dispenser-sales');
    const dispenserSales = parseFloat(dispenserSalesInput?.value) || 0;
    const atgSales = parseFloat(reconData.calculatedSales) || 0;
    const openingVolume = parseFloat(reconData.openingVolume) || 0;
    const totalDeliveries = parseFloat(reconData.totalDeliveries) || 0;
    const actualClosing = parseFloat(reconData.actualClosing) || 0;

    // Display dispenser sales
    const dispenserSalesEl = document.getElementById('recon-dispenser-sales');
    if (dispenserSales > 0) {
        dispenserSalesEl.textContent = `- ${dispenserSales.toLocaleString()} L`;
        dispenserSalesEl.className = 'recon-value negative';
    } else {
        dispenserSalesEl.textContent = 'Not entered';
        dispenserSalesEl.className = 'recon-value muted';
    }

    // Calculate expected closing based on dispenser sales (if entered)
    let expectedClosing;
    if (dispenserSales > 0) {
        expectedClosing = openingVolume + totalDeliveries - dispenserSales;
    } else {
        expectedClosing = openingVolume + totalDeliveries - atgSales;
    }
    document.getElementById('recon-expected').textContent = `${expectedClosing.toLocaleString()} L`;

    // Calculate variance analysis
    const salesDiffEl = document.getElementById('recon-sales-diff');
    const toleranceEl = document.getElementById('recon-tolerance');
    const statusEl = document.getElementById('recon-status');
    const statusBox = document.getElementById('recon-status-box');

    if (dispenserSales > 0) {
        // Sales difference (ATG vs Dispenser)
        const salesDiff = atgSales - dispenserSales;
        const salesDiffPercent = dispenserSales > 0 ? (salesDiff / dispenserSales * 100) : 0;

        // Tolerance is ±1% of dispenser sales
        const toleranceValue = dispenserSales * 0.01;

        // Display sales difference
        salesDiffEl.textContent = `${salesDiff >= 0 ? '+' : ''}${salesDiff.toFixed(2)} L (${salesDiffPercent >= 0 ? '+' : ''}${salesDiffPercent.toFixed(2)}%)`;
        salesDiffEl.className = `recon-value ${Math.abs(salesDiffPercent) <= 1 ? 'positive' : 'negative'}`;

        // Display tolerance
        toleranceEl.textContent = `± ${toleranceValue.toFixed(2)} L`;

        // Determine status
        if (Math.abs(salesDiffPercent) <= 1) {
            statusEl.textContent = 'WITHIN TOLERANCE';
            statusEl.className = 'recon-value positive';
            statusBox.className = 'variance-item status-box status-ok';
        } else if (salesDiff > 0) {
            statusEl.textContent = `OVER BY ${salesDiffPercent.toFixed(2)}% - Possible ATG Error`;
            statusEl.className = 'recon-value negative';
            statusBox.className = 'variance-item status-box status-warning';
        } else {
            statusEl.textContent = `SHORT BY ${Math.abs(salesDiffPercent).toFixed(2)}% - Possible Loss/Theft`;
            statusEl.className = 'recon-value negative';
            statusBox.className = 'variance-item status-box status-danger';
        }
    } else {
        // No dispenser sales entered
        salesDiffEl.textContent = 'Enter dispenser sales to compare';
        salesDiffEl.className = 'recon-value muted';
        toleranceEl.textContent = '--';
        toleranceEl.className = 'recon-value muted';
        statusEl.textContent = 'Awaiting dispenser data';
        statusEl.className = 'recon-value muted';
        statusBox.className = 'variance-item status-box';
    }
}

// Initialize trend dropdowns
function initTrendDropdowns() {
    const tankIds = Object.keys(STATE.tanks);
    const trendTankSelect = document.getElementById('trend-tank');

    if (trendTankSelect && trendTankSelect.options.length <= 1) {
        tankIds.forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = `Tank ${id}`;
            trendTankSelect.appendChild(opt);
        });
    }
}

// Load trend chart
async function loadTrendChart() {
    const chartType = document.getElementById('trend-chart-type')?.value || 'volume';
    const tankId = document.getElementById('trend-tank')?.value || '';
    const period = document.getElementById('trend-period')?.value || '7d';

    try {
        let endpoint = '';
        switch (chartType) {
            case 'volume':
                endpoint = `/api/trends/volume?period=${period}${tankId ? `&tankId=${tankId}` : ''}`;
                break;
            case 'temperature':
                endpoint = `/api/trends/temperature?period=${period}${tankId ? `&tankId=${tankId}` : ''}`;
                break;
            case 'deliveries':
                endpoint = `/api/reports/deliveries?period=monthly`;
                break;
            case 'alarms':
                endpoint = `/api/trends/alarms?period=${period}`;
                break;
        }

        const res = await fetch(endpoint);
        const data = await res.json();

        if (data.success || data.data) {
            renderTrendChart(chartType, data.data || data.rows || []);
        }
    } catch (err) {
        console.error('Failed to load trend chart:', err);
    }
}

// Render trend chart using ECharts
function renderTrendChart(chartType, data) {
    const chartContainer = document.getElementById('trend-chart');
    if (!chartContainer) return;

    let trendChart = echarts.getInstanceByDom(chartContainer);
    if (!trendChart) {
        trendChart = echarts.init(chartContainer);
    }

    let option = {};

    switch (chartType) {
        case 'volume':
            option = {
                title: { text: 'Volume Trend', textStyle: { color: '#f9fafb' } },
                tooltip: { trigger: 'axis', triggerOn: 'click', confine: true },
                xAxis: {
                    type: 'category',
                    data: data.map(d => new Date(d.bucket).toLocaleString()),
                    axisLabel: { color: '#9ca3af' }
                },
                yAxis: {
                    type: 'value',
                    name: 'Volume (L)',
                    axisLabel: { color: '#9ca3af' }
                },
                series: [{
                    name: 'Avg Volume',
                    type: 'line',
                    data: data.map(d => parseFloat(d.avg_volume || 0)),
                    smooth: true,
                    areaStyle: { opacity: 0.3 },
                    lineStyle: { color: '#3b82f6' },
                    itemStyle: { color: '#3b82f6' }
                }],
                backgroundColor: 'transparent'
            };
            break;
        case 'temperature':
            option = {
                title: { text: 'Temperature Trend', textStyle: { color: '#f9fafb' } },
                tooltip: { trigger: 'axis', triggerOn: 'click', confine: true },
                xAxis: {
                    type: 'category',
                    data: data.map(d => new Date(d.bucket).toLocaleString()),
                    axisLabel: { color: '#9ca3af' }
                },
                yAxis: {
                    type: 'value',
                    name: 'Temperature (°C)',
                    axisLabel: { color: '#9ca3af' }
                },
                series: [{
                    name: 'Avg Temp',
                    type: 'line',
                    data: data.map(d => parseFloat(d.avg_temp || 0)),
                    smooth: true,
                    lineStyle: { color: '#f59e0b' },
                    itemStyle: { color: '#f59e0b' }
                }],
                backgroundColor: 'transparent'
            };
            break;
        case 'deliveries':
            option = {
                title: { text: 'Delivery History', textStyle: { color: '#f9fafb' } },
                tooltip: { trigger: 'axis', triggerOn: 'click', confine: true },
                xAxis: {
                    type: 'category',
                    data: data.map(d => new Date(d.start_time).toLocaleDateString()),
                    axisLabel: { color: '#9ca3af' }
                },
                yAxis: {
                    type: 'value',
                    name: 'Volume (L)',
                    axisLabel: { color: '#9ca3af' }
                },
                series: [{
                    name: 'Delivered',
                    type: 'bar',
                    data: data.map(d => parseFloat(d.delivered_volume_l || 0)),
                    itemStyle: { color: '#10b981' }
                }],
                backgroundColor: 'transparent'
            };
            break;
        case 'alarms':
            option = {
                title: { text: 'Alarm Frequency', textStyle: { color: '#f9fafb' } },
                tooltip: { trigger: 'axis', triggerOn: 'click', confine: true },
                xAxis: {
                    type: 'category',
                    data: [...new Set(data.map(d => new Date(d.day).toLocaleDateString()))],
                    axisLabel: { color: '#9ca3af' }
                },
                yAxis: {
                    type: 'value',
                    name: 'Count',
                    axisLabel: { color: '#9ca3af' }
                },
                series: [{
                    name: 'Alarms',
                    type: 'bar',
                    data: data.map(d => parseInt(d.count || 0)),
                    itemStyle: { color: '#ef4444' }
                }],
                backgroundColor: 'transparent'
            };
            break;
    }

    trendChart.setOption(option);
    window.addEventListener('resize', () => trendChart.resize());
}

// Export delivery report to Excel
async function exportDeliveryReport() {
    const period = document.getElementById('delivery-period')?.value || 'daily';
    const date = document.getElementById('delivery-date')?.value || new Date().toISOString().split('T')[0];
    const tankId = document.getElementById('delivery-tank')?.value || '';

    try {
        const params = new URLSearchParams({ period, date, format: 'excel' });
        if (tankId) params.append('tankId', tankId);

        window.open(`/api/reports/deliveries/export?${params}`, '_blank');
    } catch (err) {
        console.error('Failed to export delivery report:', err);
        showToast('Failed to export report', 'error');
    }
}

// Export alarm report to Excel
async function exportAlarmReport() {
    const range = document.getElementById('alarm-report-range')?.value || '7d';
    window.open(`/api/reports/alarms/export?range=${range}`, '_blank');
}

// Download full Excel report
async function downloadFullExcelReport() {
    const reportType = document.getElementById('excel-report-type')?.value || 'daily';
    const date = document.getElementById('excel-report-date')?.value || new Date().toISOString().split('T')[0];

    window.open(`/api/reports/full/export?type=${reportType}&date=${date}`, '_blank');
}

// Initialize report dropdowns on page load
function initReportDropdowns() {
    const deliveryDate = document.getElementById('delivery-date');
    if (deliveryDate && !deliveryDate.value) {
        deliveryDate.value = new Date().toISOString().split('T')[0];
    }

    const deliveryTankSelect = document.getElementById('delivery-tank');
    if (deliveryTankSelect) {
        Object.keys(STATE.tanks).forEach(id => {
            if (!Array.from(deliveryTankSelect.options).find(opt => opt.value === id)) {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = `Tank ${id}`;
                deliveryTankSelect.appendChild(opt);
            }
        });
    }
}

// ============================================
// LEGACY REPORTS
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
async function loadSettings() {
    // Load local settings from localStorage
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

    // Load server-side settings (theft threshold, etc.)
    try {
        const response = await fetch('/api/settings');
        const result = await response.json();
        if (result.success && result.settings) {
            // Apply server settings
            if (result.settings.theft_threshold) {
                STATE.settings.theftThreshold = parseFloat(result.settings.theft_threshold.value) || 100;
            }
            if (result.settings.water_alarm_threshold) {
                STATE.settings.waterAlarm = parseFloat(result.settings.water_alarm_threshold.value) || 50;
            }
        }
    } catch (err) {
        console.log('Could not load server settings, using local values');
    }

    // Populate form fields
    setTimeout(() => {
        const fields = {
            'setting-low-alarm': STATE.settings.lowAlarm,
            'setting-high-alarm': STATE.settings.highAlarm,
            'setting-water-alarm': STATE.settings.waterAlarm,
            'setting-temp-alarm': STATE.settings.tempAlarm,
            'setting-theft-threshold': STATE.settings.theftThreshold,
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

async function saveAlarmSettings() {
    STATE.settings.lowAlarm = parseFloat(document.getElementById('setting-low-alarm')?.value) || 100;
    STATE.settings.highAlarm = parseFloat(document.getElementById('setting-high-alarm')?.value) || 100000;
    STATE.settings.waterAlarm = parseFloat(document.getElementById('setting-water-alarm')?.value) || 100;
    STATE.settings.tempAlarm = parseFloat(document.getElementById('setting-temp-alarm')?.value) || 50;
    STATE.settings.theftThreshold = parseFloat(document.getElementById('setting-theft-threshold')?.value) || 100;

    // Save to localStorage
    localStorage.setItem('atg_settings', JSON.stringify(STATE.settings));

    // Save server-side settings (theft threshold is used by server for detection)
    try {
        const response = await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                theft_threshold: STATE.settings.theftThreshold,
                water_alarm_threshold: STATE.settings.waterAlarm
            })
        });
        const result = await response.json();
        if (result.success) {
            showToast('Alarm thresholds saved', 'success');
        } else {
            showToast('Settings saved locally, but server sync failed', 'warning');
        }
    } catch (err) {
        console.error('Failed to save settings to server:', err);
        showToast('Settings saved locally, but server sync failed', 'warning');
    }

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

// Initialize settings dropdowns with tank list
function initSettingsDropdowns() {
    const tankIds = Object.keys(STATE.tanks);
    const configSelect = document.getElementById('config-tank-select');

    if (configSelect) {
        configSelect.innerHTML = '<option value="">Select Tank</option>' +
            tankIds.map(id => `<option value="${id}">${id}</option>`).join('');
    }

    // Also update DIP tank select
    const dipSelect = document.getElementById('dip-tank-select');
    if (dipSelect) {
        dipSelect.innerHTML = '<option value="">Select Tank</option>' +
            tankIds.map(id => `<option value="${id}">${id}</option>`).join('');
    }

    // Initialize numeric steppers for settings
    initNumericSteppers([
        'setting-low-alarm', 'setting-high-alarm',
        'setting-water-alarm', 'setting-temp-alarm',
        'setting-theft-threshold',
        'config-capacity', 'config-low-alert', 'config-high-alert'
    ]);
}

function initCalibrationDropdowns() {
    const tankIds = Object.keys(STATE.tanks);
    const calSelect = document.getElementById('calibration-tank-select');
    if (calSelect) {
        calSelect.innerHTML = '<option value="">Select Tank</option>' +
            tankIds.map(id => `<option value="${id}">${id}</option>`).join('');
    }
    // Initialize numeric steppers for calibration
    initNumericSteppers(['calibration-product-offset', 'calibration-water-offset']);
}

// Load tank configuration when selected
async function loadTankConfig() {
    const tankId = document.getElementById('config-tank-select')?.value;
    if (!tankId) return;

    // Populate station dropdown
    await populateStationDropdown();

    try {
        const response = await fetch(`/api/tanks/${tankId}/config`);
        const result = await response.json();

        if (result.success && result.config) {
            const config = result.config;
            document.getElementById('config-product-type').value = config.product_type || 'HSD';
            document.getElementById('config-capacity').value = config.capacity_liters || 50000;
            document.getElementById('config-low-alert').value = config.low_alarm_threshold || 1000;
            document.getElementById('config-high-alert').value = config.high_alarm_threshold || 45000;

            // Set station dropdown
            const stationSelect = document.getElementById('config-station-select');
            if (stationSelect) {
                stationSelect.value = config.station_id || '';
            }
        }
    } catch (err) {
        console.error('Failed to load tank config:', err);
        showToast('Failed to load tank configuration', 'error');
    }
}

// Populate station dropdown for tank configuration
async function populateStationDropdown() {
    const select = document.getElementById('config-station-select');
    if (!select) return;

    // Preserve current selection
    const currentValue = select.value;

    // Clear and add default option
    select.innerHTML = '<option value="">No Station Assigned</option>';

    try {
        // Use cached stations data if available, otherwise fetch
        let stations = stationsData;
        if (!stations || stations.length === 0) {
            const response = await fetch('/api/stations');
            const result = await response.json();
            if (result.success) {
                stations = result.stations || [];
            }
        }

        // Add station options
        stations.forEach(station => {
            if (station.is_active !== false) {
                const option = document.createElement('option');
                option.value = station.station_id;
                option.textContent = `${station.name} (${station.station_id})`;
                select.appendChild(option);
            }
        });

        // Restore selection
        select.value = currentValue;
    } catch (err) {
        console.error('Failed to load stations for dropdown:', err);
    }
}

// Save tank configuration
async function saveTankConfig() {
    const tankId = document.getElementById('config-tank-select')?.value;
    if (!tankId) {
        showToast('Please select a tank', 'warning');
        return;
    }

    const productType = document.getElementById('config-product-type')?.value;
    const capacity = parseFloat(document.getElementById('config-capacity')?.value) || 50000;
    const lowAlert = parseFloat(document.getElementById('config-low-alert')?.value) || 1000;
    const highAlert = parseFloat(document.getElementById('config-high-alert')?.value) || 45000;
    const stationId = document.getElementById('config-station-select')?.value || null;

    try {
        const response = await fetch(`/api/tanks/${tankId}/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                productType,
                capacity_liters: capacity,
                low_alarm_threshold: lowAlert,
                high_alarm_threshold: highAlert,
                station_id: stationId
            })
        });
        const result = await response.json();

        if (result.success) {
            // Update local state
            if (STATE.tanks[tankId]) {
                STATE.tanks[tankId].ProductType = productType;
            }
            // Update dashboard
            updateDashboard();
            // Refresh stations data to update tank counts
            loadStations();
            showToast('Tank configuration saved', 'success');
        } else {
            showToast(result.message || 'Failed to save configuration', 'error');
        }
    } catch (err) {
        console.error('Failed to save tank config:', err);
        showToast('Failed to save tank configuration', 'error');
    }
}

// Change user credentials
async function changePin() {
    const currentPin = pinEntries.currentPin;
    const newPin = pinEntries.newPin;
    const statusEl = document.getElementById('pin-change-status');

    if (currentPin.length < PIN_MIN_LENGTH) {
        showToast('Please enter current PIN (4-6 digits)', 'warning');
        return;
    }

    if (newPin.length < PIN_MIN_LENGTH) {
        showToast('New PIN must be 4-6 digits', 'warning');
        return;
    }

    try {
        statusEl.innerHTML = '<span class="text-warning"><i class="fas fa-spinner fa-spin"></i> Updating...</span>';

        const response = await fetch('/api/credentials/pin', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPin, newPin })
        });

        const result = await response.json();

        if (result.success) {
            statusEl.innerHTML = '<span class="text-success"><i class="fas fa-check"></i> PIN updated successfully!</span>';
            showToast('PIN updated successfully', 'success');

            // Clear PIN entries
            pinEntries.currentPin = '';
            pinEntries.newPin = '';
            updatePinDots('current-pin-dots', '');
            updatePinDots('new-pin-dots', '');

            setTimeout(() => { statusEl.innerHTML = ''; }, 3000);
        } else {
            statusEl.innerHTML = `<span class="text-error"><i class="fas fa-times"></i> ${result.message}</span>`;
            showToast(result.message || 'Failed to update PIN', 'error');
        }
    } catch (err) {
        console.error('Failed to change PIN:', err);
        statusEl.innerHTML = '<span class="text-error"><i class="fas fa-times"></i> Failed to update</span>';
        showToast('Failed to update PIN', 'error');
    }
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

    // Resize all charts after view switch (with delay for DOM rendering)
    setTimeout(() => {
        resizeAllCharts();
    }, 150);

    // Load view-specific data
    if (viewName === 'dashboard') {
        setTimeout(() => {
            if (STATE.charts.dashboard) {
                STATE.charts.dashboard.resize();
            }
        }, 200);
    }

    if (viewName === 'charts') {
        // Initialize analytics dropdowns and load data
        initAnalyticsDropdowns();
        setTimeout(() => {
            loadAnalyticsChart();
            resizeAllCharts();
        }, 200);
    }

    if (viewName === 'details') {
        setTimeout(() => {
            if (STATE.charts.detail) {
                STATE.charts.detail.resize();
            }
        }, 200);
    }

    if (viewName === 'events') {
        loadEvents();
    }

    if (viewName === 'calibration') {
        loadCalibrationTable();
    }

    if (viewName === 'reports') {
        initReportDropdowns();
        // Load initial delivery report data
        setTimeout(() => loadDeliveryReport(), 100);
    }
}

// Resize all charts in STATE
function resizeAllCharts() {
    Object.values(STATE.charts).forEach(chart => {
        if (chart && typeof chart.resize === 'function') {
            try {
                chart.resize();
            } catch (e) {
                // Chart might be disposed, ignore
            }
        }
    });
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

// PIN protection configuration
let pendingPasswordAction = null;
let pendingPasswordData = null;

function deleteTank(tankId) {
    if (!tankId) tankId = STATE.currentTankId;
    if (!tankId) {
        showToast('No tank selected', 'error');
        return;
    }

    // Show PIN modal for delete action
    showPasswordModal(
        'Delete Tank',
        `Enter admin PIN to delete Tank ${tankId}. This action cannot be undone.`,
        'deleteTank',
        tankId
    );
}

function clearAllAlarms() {
    if (STATE.alarms.length === 0) {
        showToast('No alarms to clear', 'info');
        return;
    }

    // Show PIN modal for clear alarms action
    showPasswordModal(
        'Clear All Alarms',
        `Enter admin PIN to clear all ${STATE.alarms.length} alarms. This action cannot be undone.`,
        'clearAlarms',
        null
    );
}

function showPasswordModal(title, message, action, data) {
    pendingPasswordAction = action;
    pendingPasswordData = data;
    pinEntries.modal = '';
    updatePinDots('modal-pin-dots', '');

    const modal = document.getElementById('password-modal');
    const titleEl = document.getElementById('password-title');
    const messageEl = document.getElementById('password-message');
    const errorEl = document.getElementById('password-error');
    const submitBtn = document.getElementById('modal-pin-submit');

    if (modal && titleEl && messageEl) {
        titleEl.innerHTML = `<i class="fas fa-lock"></i> ${title}`;
        messageEl.textContent = message;
        if (errorEl) errorEl.style.display = 'none';
        if (submitBtn) submitBtn.disabled = true;
        modal.classList.remove('hidden');
    }
}

function closePasswordModal() {
    const modal = document.getElementById('password-modal');
    if (modal) modal.classList.add('hidden');
    pinEntries.modal = '';
    updatePinDots('modal-pin-dots', '');
    pendingPasswordAction = null;
    pendingPasswordData = null;
}

function executePendingAction(action, data) {
    if (action === 'deleteTank') {
        executeDeleteTank(data);
    } else if (action === 'deleteAllTanks') {
        executeDeleteAllTanks();
    } else if (action === 'deleteStation') {
        executeDeleteStation(data);
    } else if (action === 'clearAlarms') {
        executeClearAllAlarms();
    } else if (action === 'clearDeliveries') {
        executeClearAllDeliveries();
    } else if (action === 'accessSettings') {
        switchView('settings');
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        document.querySelector('.nav-item[data-view="settings"]')?.classList.add('active');
        initSettingsDropdowns();
    } else if (action === 'accessCalibration') {
        switchView('calibration');
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        document.querySelector('.nav-item[data-view="calibration"]')?.classList.add('active');
        initCalibrationDropdowns();
    }
}

async function verifyPassword() {
    const errorEl = document.getElementById('password-error');
    const pin = pinEntries.modal;

    if (pin.length < PIN_MIN_LENGTH) return;

    try {
        const response = await fetch('/api/credentials/verify-pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin })
        });
        const result = await response.json();

        if (result.valid) {
            const action = pendingPasswordAction;
            const data = pendingPasswordData;
            closePasswordModal();
            executePendingAction(action, data);
        } else {
            pinEntries.modal = '';
            updatePinDots('modal-pin-dots', '');
            const submitBtn = document.getElementById('modal-pin-submit');
            if (submitBtn) submitBtn.disabled = true;
            if (errorEl) errorEl.style.display = 'block';
        }
    } catch (err) {
        console.error('PIN verification error:', err);
        // Fallback to default PIN if server unavailable
        if (pin === CONFIG.defaultPin) {
            const action = pendingPasswordAction;
            const data = pendingPasswordData;
            closePasswordModal();
            executePendingAction(action, data);
        } else {
            pinEntries.modal = '';
            updatePinDots('modal-pin-dots', '');
            const submitBtn = document.getElementById('modal-pin-submit');
            if (submitBtn) submitBtn.disabled = true;
            if (errorEl) errorEl.style.display = 'block';
        }
    }
}

async function executeClearAllAlarms() {
    try {
        const response = await fetch('/api/alarms/clear', {
            method: 'POST'
        });
        const result = await response.json();

        if (result.success) {
            STATE.alarms = [];
            updateAlarmsDisplay();
            updateSummary();
            showToast('All alarms cleared successfully', 'success');
        } else {
            showToast(result.message || 'Failed to clear alarms', 'error');
        }
    } catch (e) {
        console.error('Clear alarms error:', e);
        showToast('Failed to clear alarms', 'error');
    }
}

function clearAllDeliveries() {
    showPasswordModal(
        'Clear All Delivery Reports',
        'Enter admin PIN to clear all delivery reports. This action cannot be undone.',
        'clearDeliveries',
        null
    );
}

async function executeClearAllDeliveries() {
    try {
        const response = await fetch('/api/deliveries/clear', {
            method: 'POST'
        });
        const result = await response.json();

        if (result.success) {
            // Refresh the delivery report to show empty state
            loadDeliveryReport();
            showToast(`Cleared ${result.count || 0} delivery reports successfully`, 'success');
        } else {
            showToast(result.message || 'Failed to clear delivery reports', 'error');
        }
    } catch (e) {
        console.error('Clear deliveries error:', e);
        showToast('Failed to clear delivery reports', 'error');
    }
}

// Delete All Tanks functionality
function deleteAllTanks() {
    const tankCount = Object.keys(STATE.tanks).length;
    if (tankCount === 0) {
        showToast('No tanks to delete', 'warning');
        return;
    }

    showPasswordModal(
        'Delete All Tanks',
        `Enter admin PIN to delete ALL ${tankCount} tanks. This will remove all tank data, configurations, and DIP charts. This action cannot be undone!`,
        'deleteAllTanks',
        null
    );
}

async function executeDeleteAllTanks() {
    try {
        const response = await fetch('/api/tanks/delete-all', {
            method: 'DELETE'
        });
        const result = await response.json();

        if (result.success) {
            // Clear local state
            STATE.tanks = {};
            STATE.currentTankId = null;

            // Clear UI
            document.getElementById('tanks-grid').innerHTML = '';
            document.getElementById('tanks-table-body').innerHTML = '';

            // Update summary
            updateSummary();

            // Switch to dashboard view
            switchView('dashboard');

            showToast(`Successfully deleted ${result.count || 'all'} tanks`, 'success');
        } else {
            showToast(result.message || 'Failed to delete tanks', 'error');
        }
    } catch (e) {
        console.error('Delete all tanks error:', e);
        showToast('Failed to delete all tanks', 'error');
    }
}

async function executeDeleteTank(tankId) {
    if (!tankId) {
        showToast('No tank ID provided', 'error');
        return;
    }

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

// ============================================
// STATION MANAGEMENT
// ============================================

// Station state
let stationsData = [];
let currentStationId = null;

// Load stations on page load
async function loadStations() {
    try {
        const response = await fetch('/api/stations');
        const result = await response.json();

        if (result.success) {
            stationsData = result.stations || [];
            renderStations();
            updateStationSummary();
            populateStationFilters();
        }
    } catch (e) {
        console.error('Failed to load stations:', e);
    }
}

// Render station cards
function renderStations() {
    const grid = document.getElementById('stations-grid');
    const emptyMessage = document.getElementById('no-stations-message');

    if (!grid) return;

    // Clear existing cards (except empty message)
    const cards = grid.querySelectorAll('.station-card');
    cards.forEach(card => card.remove());

    if (stationsData.length === 0) {
        if (emptyMessage) emptyMessage.style.display = 'block';
        return;
    }

    if (emptyMessage) emptyMessage.style.display = 'none';

    stationsData.forEach(station => {
        const card = createStationCard(station);
        grid.appendChild(card);
    });
}

// Create station card element
function createStationCard(station) {
    const card = document.createElement('div');
    card.className = 'station-card';
    card.onclick = (e) => {
        if (!e.target.closest('.station-card-actions')) {
            openStationDetail(station.station_id);
        }
    };

    const tankCount = station.tank_count || 0;
    const isActive = station.is_active !== false;

    card.innerHTML = `
        <div class="station-card-header">
            <div class="station-icon">
                <i class="fas fa-gas-pump"></i>
            </div>
            <div class="station-info">
                <div class="station-name">${station.name || 'Unnamed Station'}</div>
                <div class="station-id">${station.station_id}</div>
            </div>
            <span class="station-status ${isActive ? 'active' : 'inactive'}">
                ${isActive ? 'Active' : 'Inactive'}
            </span>
        </div>
        <div class="station-card-body">
            <div class="station-detail-row">
                <i class="fas fa-map-marker-alt"></i>
                <span>${station.location || station.address || 'No location set'}</span>
            </div>
            <div class="station-detail-row">
                <i class="fas fa-user"></i>
                <span>${station.contact_name || 'No contact'}</span>
            </div>
            <div class="station-detail-row">
                <i class="fas fa-phone"></i>
                <span>${station.contact_phone || 'No phone'}</span>
            </div>
        </div>
        <div class="station-card-footer">
            <div class="station-tanks-badge">
                <i class="fas fa-database"></i>
                <span><strong>${tankCount}</strong> Tanks</span>
            </div>
            <div class="station-card-actions">
                <button class="btn-edit" onclick="event.stopPropagation(); editStation('${station.station_id}')" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn-delete" onclick="event.stopPropagation(); deleteStation('${station.station_id}')" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;

    return card;
}

// Update station summary stats
function updateStationSummary() {
    const totalEl = document.getElementById('total-stations-count');
    const activeEl = document.getElementById('active-stations-count');
    const tanksEl = document.getElementById('total-tanks-stations');

    if (totalEl) totalEl.textContent = stationsData.length;
    if (activeEl) activeEl.textContent = stationsData.filter(s => s.is_active !== false).length;
    if (tanksEl) tanksEl.textContent = stationsData.reduce((sum, s) => sum + (s.tank_count || 0), 0);
}

// Filter stations by search
function filterStations() {
    const searchInput = document.getElementById('station-search');
    const searchTerm = searchInput?.value.toLowerCase() || '';

    const cards = document.querySelectorAll('.station-card');
    cards.forEach(card => {
        const name = card.querySelector('.station-name')?.textContent.toLowerCase() || '';
        const id = card.querySelector('.station-id')?.textContent.toLowerCase() || '';
        const location = card.querySelector('.station-detail-row span')?.textContent.toLowerCase() || '';

        if (name.includes(searchTerm) || id.includes(searchTerm) || location.includes(searchTerm)) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
}

// Open Add Station Modal
function openAddStationModal() {
    currentStationId = null;
    document.getElementById('station-modal-title').innerHTML = '<i class="fas fa-industry"></i> Add New Station';
    document.getElementById('station-edit-id').value = '';
    document.getElementById('station-id-input').value = '';
    document.getElementById('station-id-input').disabled = false;
    document.getElementById('station-name-input').value = '';
    document.getElementById('station-location-input').value = '';
    document.getElementById('station-address-input').value = '';
    document.getElementById('station-lat-input').value = '';
    document.getElementById('station-lng-input').value = '';
    document.getElementById('station-contact-name-input').value = '';
    document.getElementById('station-contact-phone-input').value = '';
    document.getElementById('station-contact-email-input').value = '';
    document.getElementById('station-timezone-input').value = 'Asia/Karachi';
    document.getElementById('station-active-input').value = 'true';

    document.getElementById('station-modal').classList.remove('hidden');
}

// Edit Station
function editStation(stationId) {
    const station = stationsData.find(s => s.station_id === stationId);
    if (!station) {
        showToast('Station not found', 'error');
        return;
    }

    currentStationId = stationId;
    document.getElementById('station-modal-title').innerHTML = '<i class="fas fa-industry"></i> Edit Station';
    document.getElementById('station-edit-id').value = stationId;
    document.getElementById('station-id-input').value = station.station_id;
    document.getElementById('station-id-input').disabled = true; // Can't change ID
    document.getElementById('station-name-input').value = station.name || '';
    document.getElementById('station-location-input').value = station.location || '';
    document.getElementById('station-address-input').value = station.address || '';
    document.getElementById('station-lat-input').value = station.latitude || '';
    document.getElementById('station-lng-input').value = station.longitude || '';
    document.getElementById('station-contact-name-input').value = station.contact_name || '';
    document.getElementById('station-contact-phone-input').value = station.contact_phone || '';
    document.getElementById('station-contact-email-input').value = station.contact_email || '';
    document.getElementById('station-timezone-input').value = station.timezone || 'Asia/Karachi';
    document.getElementById('station-active-input').value = station.is_active !== false ? 'true' : 'false';

    document.getElementById('station-modal').classList.remove('hidden');
}

// Close Station Modal
function closeStationModal() {
    document.getElementById('station-modal').classList.add('hidden');
    currentStationId = null;
}

// Save Station (Create or Update)
async function saveStation() {
    const editId = document.getElementById('station-edit-id').value;
    const stationId = document.getElementById('station-id-input').value.trim();
    const name = document.getElementById('station-name-input').value.trim();

    if (!stationId || !name) {
        showToast('Station ID and Name are required', 'error');
        return;
    }

    const stationData = {
        station_id: stationId,
        name: name,
        location: document.getElementById('station-location-input').value.trim(),
        address: document.getElementById('station-address-input').value.trim(),
        latitude: parseFloat(document.getElementById('station-lat-input').value) || null,
        longitude: parseFloat(document.getElementById('station-lng-input').value) || null,
        contact_name: document.getElementById('station-contact-name-input').value.trim(),
        contact_phone: document.getElementById('station-contact-phone-input').value.trim(),
        contact_email: document.getElementById('station-contact-email-input').value.trim(),
        timezone: document.getElementById('station-timezone-input').value,
        is_active: document.getElementById('station-active-input').value === 'true'
    };

    try {
        const isEdit = !!editId;
        const url = isEdit ? `/api/stations/${editId}` : '/api/stations';
        const method = isEdit ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(stationData)
        });

        const result = await response.json();

        if (result.success) {
            showToast(`Station ${isEdit ? 'updated' : 'created'} successfully`, 'success');
            closeStationModal();
            loadStations();
        } else {
            showToast(result.message || 'Failed to save station', 'error');
        }
    } catch (e) {
        console.error('Save station error:', e);
        showToast('Failed to save station', 'error');
    }
}

// Delete Station
function deleteStation(stationId) {
    const station = stationsData.find(s => s.station_id === stationId);
    if (!station) return;

    showPasswordModal(
        'Delete Station',
        `Enter admin PIN to delete station "${station.name}". ${station.tank_count > 0 ? `Warning: This station has ${station.tank_count} tanks assigned!` : ''}`,
        'deleteStation',
        stationId
    );
}

// Execute Delete Station
async function executeDeleteStation(stationId) {
    try {
        const response = await fetch(`/api/stations/${stationId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            showToast('Station deleted successfully', 'success');
            closeStationDetailModal();
            loadStations();
        } else {
            showToast(result.message || 'Failed to delete station', 'error');
        }
    } catch (e) {
        console.error('Delete station error:', e);
        showToast('Failed to delete station', 'error');
    }
}

// Open Station Detail Modal
async function openStationDetail(stationId) {
    const station = stationsData.find(s => s.station_id === stationId);
    if (!station) {
        showToast('Station not found', 'error');
        return;
    }

    currentStationId = stationId;

    document.getElementById('station-detail-title').innerHTML = `<i class="fas fa-industry"></i> ${station.name}`;
    document.getElementById('detail-station-id').textContent = station.station_id;
    document.getElementById('detail-station-name').textContent = station.name || '--';
    document.getElementById('detail-station-location').textContent = station.location || '--';
    document.getElementById('detail-station-address').textContent = station.address || '--';
    document.getElementById('detail-station-contact').textContent = station.contact_name || '--';
    document.getElementById('detail-station-phone').textContent = station.contact_phone || '--';
    document.getElementById('detail-station-status').textContent = station.is_active !== false ? 'Active' : 'Inactive';
    document.getElementById('detail-station-status').style.color = station.is_active !== false ? 'var(--success)' : 'var(--danger)';

    // Load tanks for this station
    await loadStationTanks(stationId);

    document.getElementById('station-detail-modal').classList.remove('hidden');
}

// Load tanks assigned to a station
async function loadStationTanks(stationId) {
    const tanksList = document.getElementById('station-tanks-list');
    const tankCountEl = document.getElementById('detail-station-tank-count');

    try {
        const response = await fetch(`/api/stations/${stationId}/tanks`);
        const result = await response.json();

        if (result.success && result.tanks.length > 0) {
            tankCountEl.textContent = result.tanks.length;
            tanksList.innerHTML = result.tanks.map(tank => `
                <div class="station-tank-item">
                    <div class="tank-icon ${(tank.product_type || 'hsd').toLowerCase()}">
                        <i class="fas fa-gas-pump"></i>
                    </div>
                    <div class="tank-info">
                        <div class="tank-name">${tank.tank_id}</div>
                        <div class="tank-type">${tank.product_type || 'Unknown'}</div>
                    </div>
                    <div class="tank-volume">${(tank.volume || 0).toLocaleString()} L</div>
                </div>
            `).join('');
        } else {
            tankCountEl.textContent = '0';
            tanksList.innerHTML = `
                <div class="no-tanks-message">
                    <i class="fas fa-database"></i>
                    <p>No tanks assigned to this station</p>
                </div>
            `;
        }
    } catch (e) {
        console.error('Load station tanks error:', e);
        tankCountEl.textContent = '0';
        tanksList.innerHTML = '<div class="no-tanks-message">Failed to load tanks</div>';
    }
}

// Close Station Detail Modal
function closeStationDetailModal() {
    document.getElementById('station-detail-modal').classList.add('hidden');
    currentStationId = null;
}

// Edit Station from Detail Modal
function editStationFromDetail() {
    if (currentStationId) {
        closeStationDetailModal();
        editStation(currentStationId);
    }
}

// Delete Station from Detail Modal
function deleteStationFromDetail() {
    if (currentStationId) {
        deleteStation(currentStationId);
    }
}

// Populate station filters across the app
function populateStationFilters() {
    const filters = document.querySelectorAll('#station-filter, #tank-station-select');

    filters.forEach(select => {
        if (!select) return;

        const currentValue = select.value;

        // Keep the first option (All Stations or Select Station)
        const firstOption = select.options[0];
        select.innerHTML = '';
        select.appendChild(firstOption);

        // Add station options
        stationsData.forEach(station => {
            const option = document.createElement('option');
            option.value = station.station_id;
            option.textContent = station.name;
            select.appendChild(option);
        });

        // Restore previous selection if valid
        if (currentValue && Array.from(select.options).some(o => o.value === currentValue)) {
            select.value = currentValue;
        }
    });
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

// Handle window resize for charts (debounced)
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        resizeAllCharts();
    }, 150);
});

// ============================================
// NUMERIC STEPPER COMPONENT (touch-friendly)
// ============================================
function initNumericSteppers(inputIds) {
    inputIds.forEach(id => {
        const input = document.getElementById(id);
        if (input && !input.dataset.stepperInit) {
            createNumericStepper(input);
            input.dataset.stepperInit = 'true';
        }
    });
}

function createNumericStepper(inputElement) {
    const wrapper = document.createElement('div');
    wrapper.className = 'numeric-stepper';

    const step = parseFloat(inputElement.step) || 1;
    const bigStep = step * 10;

    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.className = 'stepper-btn stepper-minus';
    minusBtn.innerHTML = '<i class="fas fa-minus"></i>';

    const display = document.createElement('span');
    display.className = 'stepper-display';
    display.textContent = inputElement.value || '0';

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'stepper-btn stepper-plus';
    plusBtn.innerHTML = '<i class="fas fa-plus"></i>';

    const numpadBtn = document.createElement('button');
    numpadBtn.type = 'button';
    numpadBtn.className = 'stepper-btn stepper-numpad';
    numpadBtn.innerHTML = '<i class="fas fa-keyboard"></i>';

    wrapper.appendChild(minusBtn);
    wrapper.appendChild(display);
    wrapper.appendChild(plusBtn);
    wrapper.appendChild(numpadBtn);

    function updateValue(amount) {
        let val = parseFloat(inputElement.value) || 0;
        val = Math.max(0, val + amount);
        val = Math.round(val * 100) / 100;
        inputElement.value = val;
        display.textContent = val;
        inputElement.dispatchEvent(new Event('change'));
    }

    minusBtn.addEventListener('click', (e) => { e.preventDefault(); updateValue(-step); });
    plusBtn.addEventListener('click', (e) => { e.preventDefault(); updateValue(step); });

    // Long press for fast increment
    [minusBtn, plusBtn].forEach((btn, i) => {
        const mult = i === 0 ? -1 : 1;
        let holdTimeout, holdInterval;
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            updateValue(mult * step);
            holdTimeout = setTimeout(() => {
                holdInterval = setInterval(() => updateValue(mult * bigStep), 150);
            }, 500);
        }, { passive: false });
        btn.addEventListener('touchend', () => {
            clearTimeout(holdTimeout);
            clearInterval(holdInterval);
        });
        btn.addEventListener('touchcancel', () => {
            clearTimeout(holdTimeout);
            clearInterval(holdInterval);
        });
    });

    numpadBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showNumericKeypad(inputElement, display);
    });

    inputElement.style.display = 'none';
    inputElement.parentElement.appendChild(wrapper);

    // Observe input value changes from external code
    const observer = new MutationObserver(() => {
        display.textContent = inputElement.value || '0';
    });
    observer.observe(inputElement, { attributes: true, attributeFilter: ['value'] });

    // Also listen for programmatic value sets
    inputElement.addEventListener('change', () => {
        display.textContent = inputElement.value || '0';
    });

    return wrapper;
}

function showNumericKeypad(inputElement, displayElement) {
    const overlay = document.createElement('div');
    overlay.className = 'numpad-overlay';

    let numpadValue = inputElement.value || '';

    const popup = document.createElement('div');
    popup.className = 'numpad-popup';

    const valueDisplay = document.createElement('div');
    valueDisplay.className = 'numpad-popup-display';
    valueDisplay.textContent = numpadValue;

    const grid = document.createElement('div');
    grid.className = 'numpad-popup-grid';

    const keys = ['1','2','3','4','5','6','7','8','9','.','0',''];
    keys.forEach(key => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pin-key';
        if (key === '') {
            btn.innerHTML = '<i class="fas fa-backspace"></i>';
            btn.classList.add('pin-key-backspace');
            btn.dataset.key = 'backspace';
        } else {
            btn.textContent = key;
            btn.dataset.key = key;
        }
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (key === '') {
                numpadValue = numpadValue.slice(0, -1);
            } else if (key === '.' && numpadValue.includes('.')) {
                return;
            } else {
                numpadValue += key;
            }
            valueDisplay.textContent = numpadValue || '0';
        });
        grid.appendChild(btn);
    });

    const actions = document.createElement('div');
    actions.className = 'numpad-popup-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => overlay.remove());

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn-primary';
    confirmBtn.innerHTML = '<i class="fas fa-check"></i> OK';
    confirmBtn.addEventListener('click', () => {
        const val = parseFloat(numpadValue) || 0;
        inputElement.value = val;
        if (displayElement) displayElement.textContent = val;
        inputElement.dispatchEvent(new Event('change'));
        overlay.remove();
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);

    popup.appendChild(valueDisplay);
    popup.appendChild(grid);
    popup.appendChild(actions);
    overlay.appendChild(popup);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
}

// ============================================
// KIOSK SIDEBAR EXPAND/COLLAPSE
// ============================================
function initKioskSidebar() {
    if (window.innerWidth > 1280 || window.innerHeight > 800) return;

    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    // Click on collapsed sidebar to expand
    sidebar.addEventListener('click', (e) => {
        if (!sidebar.classList.contains('expanded') && window.innerWidth <= 1280) {
            sidebar.classList.add('expanded');
            e.stopPropagation();
        }
    });

    // Click outside to collapse
    document.addEventListener('click', (e) => {
        if (sidebar.classList.contains('expanded') && !sidebar.contains(e.target)) {
            sidebar.classList.remove('expanded');
        }
    });

    // Collapse after navigation
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
        item.addEventListener('click', () => {
            setTimeout(() => sidebar.classList.remove('expanded'), 300);
        });
    });

    // Mobile menu button toggles expanded state
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('expanded');
        });
    }
}

// Initialize kiosk sidebar after DOM ready
document.addEventListener('DOMContentLoaded', initKioskSidebar);
