// Impulse Blocker - Content Script v3.1
const STORAGE_KEY = 'delayedItems';
const DELAY_DURATION_MS = 1 * 60 * 1000; // 1 minute (Synced with popup.js)
const PROFILE_KEY = 'userProfile';
const TOTAL_CATEGORIES_COUNT = 17; // Must match popup.js list length

// Specific button identifiers
const EXACT_MATCH_KEYWORDS = [
    "купить сейчас",
    "купить в один клик",
    "оформить заказ",
    "перейти к оформлению",
    "заказать",
    "купить",
    "оплатить"
];

// Category Keywords Mapping
// Maps the "Clean Name" from popup.js to list of possible substrings in breadcrumbs
// Category Keywords Mapping
// Maps the "Clean Name" from popup.js to list of possible substrings in breadcrumbs
const CATEGORY_KEYWORDS = {
    "Красота": ["красота", "красоты", "косметика", "парфюмерия", "уход"],
    "Дача и сад": ["дача", "сад", "огород", "растения", "семена"],
    "Товары для строительства и ремонта": ["строительство", "ремонт", "инструменты", "стройматериалы"],
    "Автотовары": ["автотовары", "автотехник", "мототехник", "товары для авто", "запчасти", "шины", "масла"],
    "Хобби и творчество": ["хобби", "творчество", "рукоделие", "рисование"],
    "Одежда и обувь": ["одежда", "обувь", "аксессуары", "женщинам", "мужчинам", "детям"],
    "Продукты питания": ["продукты", "питание", "еда", "напитки"],
    "Спорт и отдых": ["спорт", "отдых", "туризм", "кемпинг"],
    "Электроника": ["электроника", "смартфоны", "гаджеты", "компьютеры"],
    "Бытовая техника": ["бытовая техника", "техника для дома", "кухня"],
    "Детские товары": ["детские", "игрушки", "коляски", "подгузники"],
    "Мебель": ["мебель", "интерьер", "диваны", "столы"],
    "Цветы": ["цветы", "букеты"],
    "Ювелирные украшения": ["ювелирные", "украшения", "золото", "серебро"],
    "Книги": ["книги", "литература", "учебники"],
    "Для школы и офиса": ["школа", "офис", "канцелярия"]
};

// Helper to check Stop List
function isCategoryBlocked(stopList, callback) {
    if (!stopList || stopList.length === 0) {
        // If empty, functionality is disabled
        callback(false);
        return;
    }

    // Short-circuit: If user selected ALL categories, block everything without scraping
    if (stopList.length >= TOTAL_CATEGORIES_COUNT) {
        callback(true);
        return;
    }

    // Otherwise, check categories
    // 1. Scrape standard breadcrumbs via CSS
    const breadcrumbSelectors = [
        '.breadcrumbs', '[data-widget="Breadcrumbs"]', '[data-auto="breadcrumbs"]',
        'nav[aria-label="Breadcrumb"]', '.product-page__header', // WB sometimes
        // Add more generic or specific ones if needed
        '.breadcrumbs__container', 'ul.breadcrumbs',
        '[data-zone-name="breadcrumbs"]', '[role="navigation"]' // Yandex/General additions
    ];

    let pageText = "";

    breadcrumbSelectors.forEach(sel => {
        const el = document.querySelector(sel);
        if (el) {
            const foundText = el.textContent;
            // console.log(`Impulse Debug: Selector ${sel} found:`, foundText.substring(0, 50) + "...");
            pageText += foundText + " ";
        }
    });

    // 2. Scrape JSON-LD (Schema.org) - Very reliable for Yandex/Ozon/WB
    try {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        scripts.forEach(script => {
            try {
                const data = JSON.parse(script.textContent);

                // Helper to extract strings from object
                const extractStrings = (obj) => {
                    if (!obj) return;
                    if (typeof obj === 'string') {
                        pageText += obj + " ";
                    } else if (Array.isArray(obj)) {
                        obj.forEach(extractStrings);
                    } else if (typeof obj === 'object') {
                        // Look for BreadcrumbList or Product 'category'
                        if (obj['@type'] === 'BreadcrumbList' && obj.itemListElement) {
                            extractStrings(obj.itemListElement);
                        }
                        if (obj.name) pageText += obj.name + " ";
                        if (obj.category) pageText += obj.category + " ";
                        if (obj.item && obj.item.name) pageText += obj.item.name + " ";
                    }
                };

                extractStrings(data);
            } catch (e) {
                // ignore parse error
            }
        });
        if (scripts.length > 0) {
            console.log("Impulse Debug (v3.4): JSON-LD extraction successful.");
        }
    } catch (e) {
        // ignore
    }

    // 3. Fallback to Title
    pageText += document.title;

    const lowerText = pageText.toLowerCase();

    console.log("Impulse Debug (v3.4): Page Text collected:", lowerText.substring(0, 200) + "...");

    const isBlocked = stopList.some(category => {
        // Old check: exact match of category name
        // const match = lowerText.includes(category.toLowerCase());

        // New check: Fuzzy keyword match
        let keywords = [category.toLowerCase()]; // Default to category itself
        if (CATEGORY_KEYWORDS[category]) {
            keywords = CATEGORY_KEYWORDS[category];
        }

        // Check if ANY keyword for this category is present in page text
        const match = keywords.some(kw => lowerText.includes(kw.toLowerCase()));

        if (match) console.log(`Impulse Debug: Blocked by category match: ${category} (Found keyword: ${keywords.find(kw => lowerText.includes(kw.toLowerCase()))})`);
        return match;
    });

    callback(isBlocked);
}

// Helper to generate a consistent ID for the current product/page
function getProductId() {
    return window.location.href.split('?')[0];
}

// Helper to scrape price independently
function scrapePrice() {
    let price = 0;
    try {
        let priceText = "";

        // WB
        const wbPrice = document.querySelector('.price-block__final-price, .product-page__price-block .price-block__content');
        if (wbPrice) priceText = wbPrice.textContent;

        // Ozon
        if (!priceText) {
            const ozonPrice = document.querySelector('[data-widget="webPrice"]');
            if (ozonPrice) priceText = ozonPrice.textContent;
        }

        // Yandex
        if (!priceText) {
            // Specific Yandex Design System class + Headline 3 (Main Price)
            // User snippet: <span class="... ds-text_color_price-term ds-text_typography_headline-3 ...">
            const yaPriceSpecific = document.querySelector('.ds-text_color_price-term.ds-text_typography_headline-3');
            if (yaPriceSpecific) {
                priceText = yaPriceSpecific.textContent;
            } else {
                // Fallback to just color term if headline not found (popup view?)
                const yaPriceFallback = document.querySelector('.ds-text_color_price-term');
                if (yaPriceFallback) {
                    priceText = yaPriceFallback.textContent;
                } else {
                    const yaPrice = document.querySelector('[data-auto="snippet-price-current"], [data-zone-name="price"]');
                    if (yaPrice) priceText = yaPrice.textContent;
                }
            }
        }

        if (priceText) {
            const currencyMatch = priceText.match(/([\d\s.,\u00A0\u2000-\u200A]+)\s*(?:₽|р|rub|руб|currency)/i);

            if (currencyMatch) {
                const raw = currencyMatch[1];
                const digits = raw.replace(/[^\d.,]/g, '').replace(',', '.');
                price = parseFloat(digits);
            } else {
                const firstNumMatch = priceText.match(/([\d\s.,\u00A0\u2000-\u200A]+)/);
                if (firstNumMatch) {
                    const digits = firstNumMatch[1].replace(/[^\d.,]/g, '').replace(',', '.');
                    price = parseFloat(digits);
                }
            }
        }

        if (price > 0) {
            console.log("Impulse Blocker Debug: Parsed Price =", price, "from text:", priceText);
        } else {
            console.log("Impulse Blocker Debug: Failed to parse price from:", priceText);
        }

    } catch (e) {
        console.error("Impulse Blocker: Could not parse price", e);
    }
    return price;
}

function getProductInfo() {
    // Try explicit metadata first
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    const ogImage = document.querySelector('meta[property="og:image"]')?.content;

    // Fallbacks
    const title = ogTitle || document.title || "Товар";
    // Try to find an image if OG is missing
    let image = ogImage;
    if (!image) {
        const imgEl = document.querySelector('img[src*="wb.ru"], img[src*="ozon"]'); // rough guess
        image = imgEl ? imgEl.src : null;
    }

    const price = scrapePrice();

    return {
        id: getProductId(),
        url: window.location.href,
        title: title,
        image: image,
        price: price || 0, // 0 means "Unknown"
        timestamp: Date.now()
    };
}

// Check if this product is currently "unlocked" (timer finished)
function checkIsUnlocked(callback) {
    const id = getProductId();
    chrome.storage.local.get([STORAGE_KEY], (result) => {
        const items = result[STORAGE_KEY] || {};
        const item = items[id];

        if (!item) {
            callback(false); // Not in storage -> Locked
            return;
        }

        // Get delay duration from user profile (default 60 minutes)
        chrome.storage.local.get([PROFILE_KEY], (profileResult) => {
            const profile = profileResult[PROFILE_KEY] || {};

            let delayMinutes = profile.delayMinutes || 60;

            // Check for Dynamic Cooling Rules
            if (profile.coolingRules && profile.coolingRules.length > 0) {
                const price = item.price || 0;
                const rule = profile.coolingRules.find(r => {
                    const minOk = price >= r.min;
                    const maxOk = (r.max === 0 || r.max === undefined || price <= r.max);
                    return minOk && maxOk;
                });
                if (rule) delayMinutes = rule.delayMinutes;
            }

            const delayMs = delayMinutes * 60 * 1000;

            const timePassed = Date.now() - item.timestamp;

            if (timePassed >= delayMs) {
                callback(true); // Timer finished -> Unlocked
            } else {
                callback(false); // Timer running -> Locked
            }
        });
    });
}

function createDelayButton(originalButton) {
    const btn = document.createElement('button');
    btn.className = 'impulse-blocker-btn';
    btn.textContent = 'Отложить';
    btn.title = 'Импульсивная покупка? Отложите, и если это важно - купите через час.';

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const product = getProductInfo();

        chrome.storage.local.get([STORAGE_KEY], (result) => {
            const items = result[STORAGE_KEY] || {};
            items[product.id] = product;

            chrome.storage.local.set({ [STORAGE_KEY]: items }, () => {
                showToast("Покупка отложена! Таймер запущен.");
                // Change button state
                btn.textContent = 'Отложено';
                btn.classList.add('impulse-blocker-btn-delayed');
            });
        });
    });

    return btn;
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'impulse-toast-overlay';
    toast.innerHTML = `
        <div class="impulse-toast-title">Импульсивная покупка предотвращена</div>
        <div class="impulse-toast-body">${message}</div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function shouldProcess(element) {
    if (!element || !element.textContent) return false;
    const text = element.textContent.toLowerCase().trim();
    if (element.classList.contains('impulse-blocker-btn')) return false; // Don't process our own button

    // Logic: Is it a "Buy Now" button?
    return EXACT_MATCH_KEYWORDS.some(keyword => text.includes(keyword));
}


let processInterval;

function processPage() {
    // Safety check for invalidated context
    if (!chrome.runtime?.id) {
        if (processInterval) clearInterval(processInterval);
        return;
    }

    // Check Profile and Budget
    chrome.storage.local.get([PROFILE_KEY, STORAGE_KEY], (result) => {
        const profile = result[PROFILE_KEY];
        const items = result[STORAGE_KEY] || {};

        if (!profile) return; // No profile, do nothing? Or block? Assume do nothing for now.

        // Calculate Remaining Budget
        // User request v3.3: Delayed items do NOT count as spent yet. Only check against the absolute limit.
        const monthlyLimit = profile.limit || 0;
        const availableBudget = monthlyLimit; // Was: monthlyLimit - totalDelayedCost

        // Get Current Price
        const currentPrice = scrapePrice();

        // Check Category (Stop List)
        isCategoryBlocked(profile.stopList, (isCategoryBlocked) => {

            // BLOCKING LOGIC:
            // 1. Is Category Blocked?
            // 2. Is (Available Budget < Current Price) ? (Assuming currentPrice > 0)

            let shouldBlock = false;
            let reason = "";
            const hasBudgetLimit = monthlyLimit > 0;

            if (isCategoryBlocked) {
                shouldBlock = true;
                reason = "Category Stop List";
            } else if (hasBudgetLimit) {
                // Only check budget if the user actually set a limit
                if (availableBudget < currentPrice && currentPrice > 0) {
                    shouldBlock = true;
                    reason = "Over Budget"; // e.g. Item 6000 vs Limit 5000
                } else if (availableBudget <= 0) {
                    shouldBlock = true;
                    reason = "No Free Money";
                }
            }

            if (!shouldBlock) {
                // Determine if we should UNBLOCK (restore) if we previously blocked?
                // Simplest default behavior: checkIsUnlocked is irrelevant if we shouldn't block.
                // Restore original buttons if they were hidden
                document.querySelectorAll('.impulse-blocker-btn').forEach(b => b.remove());
                document.querySelectorAll('[data-impulse-hidden="true"]').forEach(el => {
                    el.style.display = '';
                    delete el.dataset.impulseHidden;
                });
                return;
            }

            // Proceed with blocking logic
            checkIsUnlocked((isUnlocked) => {
                if (isUnlocked) {
                    document.querySelectorAll('.impulse-blocker-btn').forEach(b => b.remove());
                    document.querySelectorAll('[data-impulse-hidden="true"]').forEach(el => {
                        el.style.display = '';
                        delete el.dataset.impulseHidden;
                    });
                    return;
                }

                // If Locked:
                const candidates = document.querySelectorAll('button, a, div[role="button"]');
                candidates.forEach(candidate => {
                    if (shouldProcess(candidate)) {
                        if (candidate.dataset.impulseHidden) return;

                        console.log(`Impulse Blocker: Replacing (${reason})`, candidate.textContent);

                        // Hide original
                        candidate.style.display = 'none';
                        candidate.dataset.impulseHidden = "true";

                        // Insert our button
                        const delayBtn = createDelayButton(candidate);
                        candidate.parentNode.insertBefore(delayBtn, candidate.nextSibling);
                    }
                });
            });
        });
    });
}

// Observer for dynamic content
const observer = new MutationObserver((mutations) => {
    processPage();
    checkForSuccessPage();
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

processInterval = setInterval(processPage, 2000);

processPage();

console.log("Impulse Blocker v3.4: Loaded.");

// --- Success Detection Logic ---
const SUCCESS_KEYWORDS = [
    "спасибо за заказ",
    "заказ оформлен",
    "заказ успешно",
    "оплата прошла",
    "ваш заказ принят",
    "покупка совершена"
];

function checkForSuccessPage() {
    // Robust check: Scan the full visible text of the body (or a large chunk)
    // We rely on 'lastActiveItem' to prevent false positives, so we can be aggressive here.
    const bodyText = document.body.innerText.toLowerCase();

    // Also check title specifically as it's often updated
    const titleText = document.title.toLowerCase();

    const isSuccess = SUCCESS_KEYWORDS.some(kw =>
        bodyText.includes(kw) || titleText.includes(kw)
    );

    if (isSuccess) {
        // Check if we have an active item waiting for confirmation
        chrome.storage.local.get(['lastActiveItem', STORAGE_KEY], (result) => {
            const lastId = result['lastActiveItem'];
            if (!lastId) return; // No pending item

            const items = result[STORAGE_KEY] || {};
            const item = items[lastId];

            if (item) {
                // Prevent double showing
                if (document.getElementById('impulse-history-modal')) return;

                showHistoryModal(item);
            }
        });
    }
}

function showHistoryModal(product) {
    // Remove existing if any
    const existing = document.getElementById('impulse-history-modal');
    if (existing) existing.remove();

    const price = product.price || 0;

    const modal = document.createElement('div');
    modal.id = 'impulse-history-modal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(2px); font-family: sans-serif;
    `;

    modal.innerHTML = `
        <div style="background: white; padding: 24px; border-radius: 16px; width: 300px; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
            <h3 style="margin: 0 0 12px 0; font-size: 18px; color: #111;">Вы оформили заказ?</h3>
            <p style="font-size: 14px; color: #555; margin-bottom: 20px;">
                Сохранить "${product.title.substring(0, 30)}..." в историю покупок за ${price} ₽?
            </p>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                 <button id="ihm-no" style="padding: 8px 16px; border: 1px solid #ddd; background: white; border-radius: 8px; cursor: pointer; color: #555;">Нет</button>
                 <button id="ihm-yes" style="padding: 8px 16px; border: none; background: #2563eb; color: white; border-radius: 8px; cursor: pointer;">Да, сохранить</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('ihm-no').addEventListener('click', () => {
        // User saw "Success" but clicked "No" (Maybe bought something else?)
        // Clear the active item flag so we don't ask again
        chrome.storage.local.remove('lastActiveItem');
        modal.remove();
    });

    document.getElementById('ihm-yes').addEventListener('click', () => {
        addToHistoryAndRemove(product);
        chrome.storage.local.remove('lastActiveItem'); // Clear flag
        modal.remove();
    });
}

function addToHistoryAndRemove(product) {
    chrome.storage.local.get([PROFILE_KEY, STORAGE_KEY], (result) => {
        const profile = result[PROFILE_KEY];
        if (!profile) return;

        const price = product.price || 0;

        if (profile.limit) {
            profile.limit -= price;
            if (profile.limit < 0) profile.limit = 0;
        }

        // Add to History
        if (!profile.history) profile.history = [];
        profile.history.push({
            ...product,
            buyDate: Date.now()
        });

        // Save Profile
        chrome.storage.local.set({ [PROFILE_KEY]: profile }, () => {
            // Remove from Delayed
            const items = result[STORAGE_KEY] || {};
            delete items[product.id];
            chrome.storage.local.set({ [STORAGE_KEY]: items }, () => {
                showToast("Сохранено в историю! 🎉");
            });
        });
    });
}
