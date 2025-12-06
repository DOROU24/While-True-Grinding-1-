// Impulse Blocker - Background Service Worker

const ALARM_NAME = 'checkDelayItems';
const DEFAULT_PERIOD_MINUTES = 60; // 1 hour default
const PROFILE_KEY = 'userProfile';
const STORAGE_KEY = 'delayedItems';

// --- Initialization ---
chrome.runtime.onInstalled.addListener(() => {
    // Set default alarm
    chrome.alarms.create(ALARM_NAME, {
        periodInMinutes: DEFAULT_PERIOD_MINUTES
    });
});

// --- Alarm Handler ---
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
        checkItemsAndNotify();
    }
});

// --- Message Handler (for settings updates) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateAlarm') {
        const period = message.periodInMinutes || DEFAULT_PERIOD_MINUTES;
        chrome.alarms.create(ALARM_NAME, {
            periodInMinutes: parseInt(period)
        });
        sendResponse({ status: 'updated' });
    }
});

// --- Logic ---
function checkItemsAndNotify() {
    chrome.storage.local.get([PROFILE_KEY, STORAGE_KEY], (result) => {
        const profile = result[PROFILE_KEY] || {};
        const items = result[STORAGE_KEY] || {};
        const keys = Object.keys(items);

        if (keys.length === 0) return;

        let readyCount = 0;
        const now = Date.now();

        keys.forEach(id => {
            const item = items[id];

            // Calculate delay for this item
            let delayMinutes = profile.delayMinutes || 60;
            if (profile.coolingRules && profile.coolingRules.length > 0) {
                const price = item.price || 0;
                // Find matching rule
                const rule = profile.coolingRules.find(r => {
                    const minOk = price >= r.min;
                    const maxOk = (r.max === 0 || r.max === undefined || price <= r.max);
                    return minOk && maxOk;
                });
                if (rule) delayMinutes = rule.delayMinutes;
            }
            const delayMs = delayMinutes * 60 * 1000;
            const timePassed = now - item.timestamp;

            if (timePassed >= delayMs) {
                readyCount++;
            }
        });

        if (readyCount > 0) {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon.png',
                title: 'Impulse Blocker',
                message: `Доступно для покупки: ${readyCount} товаров. Проверьте инвентарь! 🧠`,
                priority: 2
            });
        }
    });
}

// --- Notification Click ---
chrome.notifications.onClicked.addListener(() => {
    // Open the popup or dashboard via a new tab (since we can't open popup programmatically easily)
    // Actually, usually users just click and open the extension. 
    // We can open an options page or just focus something.
    // For now, let's just do nothing (Chrome notification click usually dismisses it).
    // Or we could open a specific "Inventory" page if we had one.
});
