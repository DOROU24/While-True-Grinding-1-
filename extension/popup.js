const STORAGE_KEY = 'delayedItems';
const PROFILE_KEY = 'userProfile';
const DELAY_DURATION_MS = 1 * 60 * 1000; // 60 minutes


// DOM Elements
const views = {
    onboardingStep1: document.getElementById('view-onboarding-step1'),
    onboardingStep2: document.getElementById('view-onboarding-step2'),
    dashboard: document.getElementById('view-dashboard'),
    settings: document.getElementById('view-settings'),
    chat: document.getElementById('view-chat'),
    history: document.getElementById('view-history'),
    savedDetails: document.getElementById('view-saved-details'),
    coolingRules: document.getElementById('view-cooling-rules')
};

// State
let currentUser = null;
let currentChatItemId = null;
let chatHistory = [];
const CHAT_API_URL = 'http://localhost:8000/chat';

const STOP_LIST_CATEGORIES = [
    "Одежда и обувь", "Дом", "Детские товары", "Красота", "Электроника",
    "Бытовая техника", "Цветы", "Дача и сад", "Продукты питания",
    "Товары для строительства и ремонта", "Мебель", "Автотовары", "Спорт и отдых",
    "Ювелирные украшения", "Книги", "Хобби и творчество",
    "Для школы и офиса"
];

// --- Navigation ---
function showView(viewName) {
    Object.values(views).forEach(el => el.classList.remove('active'));
    views[viewName].classList.add('active');
}

// --- Logic ---
function calculateHourlyRate(monthlyIncome) {
    return (monthlyIncome / 160) || 1;
}

function calculateTimeCost(price, monthlyIncome) {
    const rate = calculateHourlyRate(monthlyIncome);
    return price / rate;
}

function formatHours(hours) {
    if (hours < 1) {
        return `${Math.round(hours * 60)} мин жизни`;
    }
    return `${hours.toFixed(1)} ч. жизни`;
}

function formatTimeLeft(ms) {
    if (ms <= 0) return '00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function renderStopList(containerId, savedList) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    STOP_LIST_CATEGORIES.forEach(cat => {
        const div = document.createElement('div');
        div.className = 'stop-list-item';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = cat;
        checkbox.id = `${containerId}-${cat}`;
        if (savedList && savedList.includes(cat)) checkbox.checked = true;
        const label = document.createElement('label');
        label.htmlFor = `${containerId}-${cat}`;
        label.textContent = cat;
        label.style.marginBottom = '0';
        div.appendChild(checkbox);
        div.appendChild(label);
        container.appendChild(div);
    });
}

function getSelectedCategories(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
}

function saveProfile(name, income, limit, currentAssets, monthlySavings, stopList, delayMinutes, notificationPeriod, callback) {
    // Preserve existing savedAmount and history if present
    chrome.storage.local.get([PROFILE_KEY], (result) => {
        const oldProfile = result[PROFILE_KEY] || {};
        const savedAmount = oldProfile.savedAmount || 0;
        const history = oldProfile.history || [];
        const cancelledItems = oldProfile.cancelledItems || [];
        const coolingRules = oldProfile.coolingRules || [];

        const profile = {
            name,
            income: parseFloat(income),
            limit: parseFloat(limit),
            currentAssets: parseFloat(currentAssets) || 0,
            monthlySavings: parseFloat(monthlySavings) || 0,
            stopList,
            savedAmount,
            history,
            cancelledItems,
            coolingRules,
            notificationPeriod: parseInt(notificationPeriod) || 60,
            delayMinutes: parseInt(delayMinutes) || 60
        };
        chrome.storage.local.set({ [PROFILE_KEY]: profile }, () => {
            currentUser = profile;
            // Notify background script about alarm change
            chrome.runtime.sendMessage({
                action: 'updateAlarm',
                periodInMinutes: profile.notificationPeriod
            });
            callback();
        });
    });
}

function loadProfile(callback) {
    chrome.storage.local.get([PROFILE_KEY], (result) => {
        currentUser = result[PROFILE_KEY];
        callback(currentUser);
    });
}

function logout() {
    chrome.storage.local.remove([PROFILE_KEY], () => {
        currentUser = null;
        renderStopList('ob-stop-list', []); // Clear checkboxes
        showView('onboardingStep1');
    });
}

// --- Dashboard Rendering ---
function renderDashboard() {
    if (!currentUser) return;

    document.getElementById('dash-name').textContent = currentUser.name;
    document.getElementById('dash-limit').textContent = `${currentUser.limit.toLocaleString()} ₽`;
    document.getElementById('dash-total-saved').textContent = `${(currentUser.savedAmount || 0).toLocaleString()} ₽`;

    chrome.storage.local.get([STORAGE_KEY], (result) => {
        const items = result[STORAGE_KEY] || {};
        const itemList = document.getElementById('itemList');
        itemList.innerHTML = '';

        let totalPendingCost = 0;
        const keys = Object.keys(items);

        if (keys.length === 0) {
            document.getElementById('emptyState').style.display = 'block';
        } else {
            document.getElementById('emptyState').style.display = 'none';
            const sorted = Object.values(items).sort((a, b) => b.timestamp - a.timestamp);

            sorted.forEach(item => {
                totalPendingCost += (item.price || 0);
                const timeCost = calculateTimeCost(item.price || 0, currentUser.income);
                const isExpensive = timeCost > 10;
                const timePassed = Date.now() - item.timestamp;

                // Calculate Delay based on Rules
                let delayMinutes = currentUser.delayMinutes || 60;
                if (currentUser.coolingRules && currentUser.coolingRules.length > 0) {
                    const price = item.price || 0;
                    // Find matching rule
                    const rule = currentUser.coolingRules.find(r => {
                        const minOk = price >= r.min;
                        const maxOk = (r.max === 0 || r.max === undefined || price <= r.max);
                        return minOk && maxOk;
                    });
                    if (rule) delayMinutes = rule.delayMinutes;
                }
                const delayMs = delayMinutes * 60 * 1000;

                const timeLeft = delayMs - timePassed;
                const isReady = timeLeft <= 0;

                // Affordability Logic
                let affordStatusHTML = '';
                const assets = currentUser.currentAssets || 0;
                const savingsRate = currentUser.monthlySavings || 0;
                const price = item.price || 0;

                if (assets > 0 || savingsRate > 0) {
                    if (price <= assets) {
                        // Can buy now. Check safety.
                        const remaining = assets - price;
                        const ratio = remaining / assets;
                        if (ratio < 0.5) {
                            affordStatusHTML = `<div style="font-size:11px; color:#f59e0b; margin-top:4px;">⚠️ Рискованно (съест >50% накоплений)</div>`;
                        } else {
                            affordStatusHTML = `<div style="font-size:11px; color:#10b981; margin-top:4px;">✅ Безопасная покупка</div>`;
                        }
                    } else {
                        // Cannot buy now
                        if (savingsRate > 0) {
                            const deficit = price - assets;
                            const months = Math.ceil(deficit / savingsRate);
                            affordStatusHTML = `<div style="font-size:11px; color:#ef4444; margin-top:4px;">⏳ Копить ещё ${months} мес.</div>`;
                        } else {
                            affordStatusHTML = `<div style="font-size:11px; color:#ef4444; margin-top:4px;">❌ Не хватает средств</div>`;
                        }
                    }
                }

                const div = document.createElement('div');
                div.className = 'item-card';
                div.innerHTML = `
                    ${item.image ? `<img src="${item.image}" class="item-image" alt="Product">` : ''}
                    <div class="item-content">
                        <div class="item-title" title="${item.title}">${item.title}</div>
                        <div class="item-price">${(item.price || 0).toLocaleString()} ₽</div>
                        ${item.price ? `<div class="time-cost ${isExpensive ? 'expensive' : ''}"> ${formatHours(timeCost)}</div>` : ''}
                        ${affordStatusHTML}
                        <div style="margin-top: 8px; display: flex; gap: 8px; align-items: center">
                            <button class="buy-btn" style="background: ${isReady ? '#ffdd2d' : '#d1d5db'}; border: none;
    color: #333; font-size: 14px; border-radius: 12px; padding: 10px; width: 90px; cursor: ${isReady ? 'pointer' : 'not-allowed'};">${isReady ? 'Купить' : formatTimeLeft(timeLeft)}</button>
                            ${!isReady ? `<button class="brain-btn" style="background: #e0e7ff; color: #4338ca; border: none; border-radius: 12px; padding: 10px; cursor: pointer; font-size: 16px;">🧠</button>` : ''}
                            <button class="delete-btn" style="color: #2563eb;  background: none; border-radius: 50%; width: 32px; height: 32px; border: 1px solid rgba(0, 0, 0, 0.13); cursor: pointer;">✕</button>
                        </div>
                    </div>
                `;
                itemList.appendChild(div);

                if (!isReady) {
                    const brainBtn = div.querySelector('.brain-btn');
                    if (brainBtn) {
                        brainBtn.addEventListener('click', () => {
                            startChat(item);
                        });
                    }
                }

                div.querySelector('.buy-btn').addEventListener('click', () => {
                    if (isReady) {
                        // User decided to buy. 
                        // We do NOT deduct money or add to history yet.
                        // We mark this item as "Active Purchase" and open the site.
                        // content.js will handle the actual logging upon "Order Success".

                        chrome.storage.local.set({ 'lastActiveItem': item.id }, () => {
                            chrome.tabs.create({ url: item.url });
                        });
                    }
                });
                div.querySelector('.delete-btn').addEventListener('click', () => {
                    // Update stats: Add price to savedAmount
                    const price = item.price || 0;
                    if (price > 0) {
                        currentUser.savedAmount = (currentUser.savedAmount || 0) + price;

                        // Save to Cancelled History
                        if (!currentUser.cancelledItems) currentUser.cancelledItems = [];
                        currentUser.cancelledItems.push({
                            ...item,
                            cancelDate: Date.now()
                        });

                        chrome.storage.local.set({ [PROFILE_KEY]: currentUser }, () => {
                            // Then delete the item
                            const newItems = { ...items };
                            delete newItems[item.id];
                            chrome.storage.local.set({ [STORAGE_KEY]: newItems }, () => renderDashboard());
                        });
                    } else {
                        // Just delete if no price
                        const newItems = { ...items };
                        delete newItems[item.id];
                        chrome.storage.local.set({ [STORAGE_KEY]: newItems }, () => renderDashboard());
                    }
                });
            });
        }
        document.getElementById('dash-saved').textContent = `${totalPendingCost.toLocaleString()} ₽`;
        const percent = Math.min(100, (totalPendingCost / currentUser.limit) * 100);
        const progBar = document.getElementById('dash-progress');
        progBar.style.width = `${percent}%`;
        if (percent > 90) progBar.className = 'progress-bar-fill danger';
        else if (percent > 50) progBar.className = 'progress-bar-fill warning';
        else progBar.className = 'progress-bar-fill';
    });
}

function updateTimersOnDashboard() {
    if (views.dashboard.classList.contains('active')) {
        renderDashboard();
    }
}

function renderHistory() {
    const historyList = document.getElementById('history-list');
    const emptyState = document.getElementById('history-empty');

    historyList.innerHTML = '';

    const history = currentUser?.history || [];

    if (history.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    // Sort by date descending (newest first)
    const sorted = [...history].sort((a, b) => (b.buyDate || 0) - (a.buyDate || 0));

    sorted.forEach(item => {
        const div = document.createElement('div');
        div.className = 'item-card';

        const buyDate = item.buyDate ? new Date(item.buyDate).toLocaleDateString('ru-RU') : 'Неизвестно';

        div.innerHTML = `
            ${item.image ? `<img src="${item.image}" class="item-image" alt="Product">` : ''}
            <div class="item-content">
                <div class="item-title" title="${item.title}">${item.title}</div>
                <div class="item-price">${(item.price || 0).toLocaleString()} ₽</div>
                <div style="font-size: 11px; color: #9ca3af; margin-top: 4px;">Куплено: ${buyDate}</div>
            </div>
        `;
        historyList.appendChild(div);
    });
}

function renderSavedDetails() {
    const list = document.getElementById('saved-list');
    const empty = document.getElementById('saved-empty');
    if (!list) return;
    list.innerHTML = '';

    const items = currentUser?.cancelledItems || [];

    if (items.length === 0) {
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    // Sort by cancelDate descending
    const sorted = [...items].sort((a, b) => (b.cancelDate || 0) - (a.cancelDate || 0));

    sorted.forEach(item => {
        const div = document.createElement('div');
        div.className = 'item-card';
        const dateStr = item.cancelDate ? new Date(item.cancelDate).toLocaleDateString('ru-RU') : 'Неизвестно';

        div.innerHTML = `
            ${item.image ? `<img src="${item.image}" class="item-image" alt="Product">` : ''}
            <div class="item-content">
                <a href="${item.url}" target="_blank" class="item-title" title="${item.title}" style="text-decoration: none; color: inherit; display: block; margin-bottom: 4px;">${item.title}</a>
                <div class="item-price" style="color: #10b981;">+${(item.price || 0).toLocaleString()} ₽</div>
                <div style="font-size: 11px; color: #9ca3af;">Сэкономлено: ${dateStr}</div>
            </div>
        `;
        list.appendChild(div);
    });
}

function renderCoolingRules() {
    const list = document.getElementById('rules-list');
    const empty = document.getElementById('rules-empty');
    if (!list) return;
    list.innerHTML = '';

    const rules = currentUser?.coolingRules || [];

    if (rules.length === 0) {
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    // Sort by Min Price ascending
    const sorted = [...rules].sort((a, b) => a.min - b.min);

    sorted.forEach((rule, index) => {
        const div = document.createElement('div');
        div.className = 'item-card';
        div.style.alignItems = 'center';

        const rangeText = (rule.max && rule.max > 0)
            ? `${rule.min.toLocaleString()} - ${rule.max.toLocaleString()} ₽`
            : `От ${rule.min.toLocaleString()} ₽`;

        div.innerHTML = `
            <div class="item-content">
                <div class="item-title" style="font-weight: 600;">${rangeText}</div>
                <div class="item-price" style="color: #6366f1;">⏳ ${rule.delayMinutes} мин.</div>
            </div>
            <button class="delete-btn" data-index="${index}" style="color: #ef4444; background: none; border-radius: 50%; width: 32px; height: 32px; border: 1px solid rgba(0, 0, 0, 0.13); cursor: pointer;">✕</button>
        `;
        list.appendChild(div);

        div.querySelector('.delete-btn').addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.index);
            currentUser.coolingRules.splice(idx, 1);
            chrome.storage.local.set({ [PROFILE_KEY]: currentUser }, () => renderCoolingRules());
        });
    });
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadProfile((profile) => {
        if (profile) {
            showView('dashboard');
            renderDashboard();
        } else {
            renderStopList('ob-stop-list', []);
            showView('onboardingStep1');
        }
    });


    // Timer Loop
    setInterval(updateTimersOnDashboard, 1000);

    // Onboarding Step 1 -> Step 2
    document.getElementById('btn-next-step1').addEventListener('click', () => {
        const name = document.getElementById('ob-name').value;
        if (name && name.trim() !== "") {
            showView('onboardingStep2');
        } else {
            alert('Пожалуйста, введите имя!');
        }
    });

    // Onboarding Step 2 Back
    document.getElementById('btn-back-step1').addEventListener('click', () => {
        showView('onboardingStep1');
    });

    // Onboarding Final Save
    document.getElementById('btn-start').addEventListener('click', () => {
        const name = document.getElementById('ob-name').value; // Still accessible
        const income = document.getElementById('ob-income').value;
        const limit = document.getElementById('ob-limit').value;
        const assets = document.getElementById('ob-assets').value;
        const savings = document.getElementById('ob-monthly-savings').value;
        const delayMinutes = document.getElementById('ob-delay').value || 60;
        const stopList = getSelectedCategories('ob-stop-list');

        if (name && income && limit) {
            saveProfile(name, income, limit, assets, savings, stopList, delayMinutes, 60, () => {
                showView('dashboard');
                renderDashboard();
            });
        } else {
            alert('Пожалуйста, заполните все поля!');
        }
    });

    // Settings handlers
    document.getElementById('btn-settings').addEventListener('click', () => {
        // Pre-fill
        document.getElementById('set-name').value = currentUser.name;
        document.getElementById('set-income').value = currentUser.income;
        document.getElementById('set-limit').value = currentUser.limit;
        document.getElementById('set-assets').value = currentUser.currentAssets || '';
        document.getElementById('set-monthly-savings').value = currentUser.monthlySavings || '';
        document.getElementById('set-delay').value = currentUser.delayMinutes || 60;
        document.getElementById('set-notify-freq').value = currentUser.notificationPeriod || 60;
        renderStopList('set-stop-list', currentUser.stopList || []);
        showView('settings');
    });

    document.getElementById('btn-back').addEventListener('click', () => {
        showView('dashboard');
        renderDashboard();
    });

    // History handlers
    document.getElementById('btn-history').addEventListener('click', () => {
        renderHistory();
        showView('history');
    });

    document.getElementById('btn-back-history').addEventListener('click', () => {
        showView('dashboard');
        renderDashboard();
    });

    // Saved Details handlers
    document.getElementById('btn-saved-details').addEventListener('click', () => {
        renderSavedDetails();
        showView('savedDetails');
    });

    document.getElementById('btn-back-saved').addEventListener('click', () => {
        showView('dashboard');
        renderDashboard();
    });

    // Cooling Rules handlers
    document.getElementById('btn-open-rules').addEventListener('click', () => {
        renderCoolingRules();
        showView('coolingRules');
    });

    document.getElementById('btn-back-rules').addEventListener('click', () => {
        showView('settings'); // Back to settings, not dashboard
    });

    document.getElementById('btn-add-rule').addEventListener('click', () => {
        const min = parseInt(document.getElementById('rule-min').value) || 0;
        const max = parseInt(document.getElementById('rule-max').value) || 0;
        const delay = parseInt(document.getElementById('rule-delay').value);

        if (!delay || delay < 1) {
            alert('Введите время охлаждения!');
            return;
        }
        if (max > 0 && min > max) {
            alert('Мин. цена не может быть больше макс. цены!');
            return;
        }

        if (!currentUser.coolingRules) currentUser.coolingRules = [];
        currentUser.coolingRules.push({ min, max, delayMinutes: delay });

        // Save automatically
        chrome.storage.local.set({ [PROFILE_KEY]: currentUser }, () => {
            renderCoolingRules();
            // Clear inputs
            document.getElementById('rule-min').value = '';
            document.getElementById('rule-max').value = '';
            document.getElementById('rule-delay').value = '';
        });
    });

    document.getElementById('btn-save-settings').addEventListener('click', () => {
        const name = document.getElementById('set-name').value;
        const income = document.getElementById('set-income').value;
        const limit = document.getElementById('set-limit').value;
        const assets = document.getElementById('set-assets').value;
        const savings = document.getElementById('set-monthly-savings').value;
        const delayMinutes = document.getElementById('set-delay').value || 60;
        const notificationPeriod = document.getElementById('set-notify-freq').value || 60;
        const stopList = getSelectedCategories('set-stop-list');
        saveProfile(name, income, limit, assets, savings, stopList, delayMinutes, notificationPeriod, () => {
            showView('dashboard');
            renderDashboard();
        });
    });

    document.getElementById('set-select-all').addEventListener('click', () => {
        document.querySelectorAll('#ob-stop-list input[type="checkbox"]').forEach(cb => cb.checked = true);
    });

    document.getElementById('set-clear-all').addEventListener('click', () => {
        document.querySelectorAll('#ob-stop-list input[type="checkbox"]').forEach(cb => cb.checked = false);
    });

    document.getElementById('select-all').addEventListener('click', () => {
        document.querySelectorAll('#set-stop-list input[type="checkbox"]').forEach(cb => cb.checked = true);
    });

    document.getElementById('clear-all').addEventListener('click', () => {
        document.querySelectorAll('#set-stop-list input[type="checkbox"]').forEach(cb => cb.checked = false);
    });


    document.getElementById('toggle-list')?.addEventListener('click', function () {
        const list = document.getElementById('set-stop-list');
        const toggleText = document.getElementById('toggle-text');

        list.classList.toggle('expanded');

        if (list.classList.contains('expanded')) {
            toggleText.textContent = 'Скрыть';
        } else {
            toggleText.textContent = 'Показать ещё...';
        }
    });
    document.getElementById('set-toggle-list')?.addEventListener('click', function () {
        const list = document.getElementById('ob-stop-list');
        const toggleText = document.getElementById('set-toggle-text');

        list.classList.toggle('expanded');

        if (list.classList.contains('expanded')) {
            toggleText.textContent = 'Скрыть';
        } else {
            toggleText.textContent = 'Показать ещё...';
        }
    });

    document.getElementById('btn-logout').addEventListener('click', logout);

    // Chat Handlers
    document.getElementById('btn-close-chat').addEventListener('click', () => {
        showView('dashboard');
    });

    document.getElementById('btn-send-chat').addEventListener('click', () => {
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if (text) {
            sendChatMessage(text);
            input.value = '';
        }
    });

    document.getElementById('chat-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const text = e.target.value.trim();
            if (text) {
                sendChatMessage(text);
                e.target.value = '';
            }
        }
    });
});


// --- Chat Functions ---

function startChat(item) {
    currentChatItemId = item.id;
    chatHistory = []; // Reset history

    // Update UI title
    const titleEl = document.getElementById('chat-item-title');
    if (titleEl) titleEl.textContent = item.title;

    // Show View
    showView('chat');

    // Auto-send context to AI
    renderChat(); // Clear previous messages

    // Initial "Hidden" message to trigger the bot
    sendChatMessage(null, { title: item.title, price: (item.price || 0) + ' ₽' });
}

function renderChat() {
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';

    chatHistory.forEach(msg => {
        const div = document.createElement('div');
        div.className = `message ${msg.role === 'user' ? 'user' : 'bot'}`;
        // Simple markdown-ish bold check or plain text
        div.textContent = msg.content;
        container.appendChild(div);
    });

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
}

function sendChatMessage(text, context = null) {
    const container = document.getElementById('chat-messages');

    // Add User Message locally
    if (text) {
        chatHistory.push({ role: 'user', content: text });

        const userDiv = document.createElement('div');
        userDiv.className = 'message user';
        userDiv.textContent = text;
        container.appendChild(userDiv);
        container.scrollTop = container.scrollHeight;
    }

    // Add "Typing..." indicator
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message bot';
    typingDiv.textContent = '...';
    container.appendChild(typingDiv);
    container.scrollTop = container.scrollHeight;

    // Prepare payload
    const payload = {
        history: chatHistory.filter(m => m.role !== 'system'), // Don't send system prompts if we had them client side (we don't here)
        message: text, // Can be null if it's context-only
        context: context
    };

    fetch(CHAT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
        .then(r => r.json())
        .then(data => {
            // Remove typing indicator
            typingDiv.remove();

            if (data.error) {
                const errDiv = document.createElement('div');
                errDiv.className = 'message bot';
                errDiv.style.color = 'red';
                errDiv.textContent = 'Ошибка сервера: ' + data.error;
                container.appendChild(errDiv);
                return;
            }

            const botText = data.text;
            chatHistory.push({ role: 'assistant', content: botText });

            const botDiv = document.createElement('div');
            botDiv.className = 'message bot';
            botDiv.textContent = botText;
            container.appendChild(botDiv);
            container.scrollTop = container.scrollHeight;

            if (data.approved) {
                handleApproval();
            }
        })
        .catch(err => {
            typingDiv.remove();
            const errDiv = document.createElement('div');
            errDiv.className = 'message bot';
            errDiv.style.color = 'red';
            errDiv.textContent = 'Ошибка соединения. Запустите сервер (llm/server.py). ' + err.message;
            container.appendChild(errDiv);
        });
}

function handleApproval() {
    // AI Approved!
    // 1. Show celebration
    const container = document.getElementById('chat-messages');
    const successDiv = document.createElement('div');
    successDiv.className = 'message bot';
    successDiv.style.background = '#dcfce7'; // green-100
    successDiv.style.color = '#166534'; // green-800
    successDiv.style.fontWeight = 'bold';
    successDiv.textContent = '🎉 Аргументы приняты! Товар разблокирован.';
    container.appendChild(successDiv);
    container.scrollTop = container.scrollHeight;

    // 2. Unlock item
    chrome.storage.local.get([STORAGE_KEY], (result) => {
        const items = result[STORAGE_KEY] || {};
        const item = items[currentChatItemId];

        if (item) {
            // Set timestamp to make it ready NOW
            // item.timestamp = Date.now() - DELAY_DURATION_MS - 1000;
            // Actually, let's just cheat and assume the current calculation checks timestamp.
            // Yes.
            item.timestamp = Date.now() - DELAY_DURATION_MS - 10000;

            items[currentChatItemId] = item;

            chrome.storage.local.set({ [STORAGE_KEY]: items }, () => {
                // 3. Return to dashboard after delay
                setTimeout(() => {
                    showView('dashboard');
                    renderDashboard(); // It will re-render and show 'Buy' button
                }, 2000);
            });
        }
    });
}

