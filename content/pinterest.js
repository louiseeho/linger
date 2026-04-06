(function () {
  "use strict";

  const STORAGE_KEY = "linger_logs";
  const DEBOUNCE_MS = 420;
  const SAVE_INTENT_MS = 3500;
  const POLL_MS = 220;
  const POLL_MAX_TICKS = 18;

  const STORAGE_BUDGET_BYTES = 8 * 1024 * 1024;
  const SETTINGS_STORAGE = "linger_user_settings";

  let debounceTimer = null;
  let overlayEl = null;
  let saveIntentAt = 0;
  let pollTimer = null;
  let pollTicks = 0;
  let lastPinPreviewUrl = null;

  let cachedPinterestSettings = null;

  function normPinterestHost(h) {
    return String(h || "")
      .replace(/^www\./i, "")
      .toLowerCase();
  }

  function parsePinterestUserSettings(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    return {
      usePerSitePinterest: !!o.usePerSitePinterest,
      pinterestEnabled: o.pinterestEnabled !== false,
      perSitePinterest:
        o.perSitePinterest && typeof o.perSitePinterest === "object"
          ? o.perSitePinterest
          : {},
      snoozeUntilMs: typeof o.snoozeUntilMs === "number" ? o.snoozeUntilMs : 0,
    };
  }

  function pinterestSettingsSnoozed(settings) {
    return settings.snoozeUntilMs > Date.now();
  }

  function pinterestAllowedForHost(settings, hostname) {
    const h = normPinterestHost(hostname);
    if (
      settings.usePerSitePinterest &&
      Object.prototype.hasOwnProperty.call(settings.perSitePinterest, h)
    ) {
      return !!settings.perSitePinterest[h];
    }
    return settings.pinterestEnabled;
  }

  function refreshPinterestSettingsCache() {
    chrome.storage.local.get([SETTINGS_STORAGE], (data) => {
      if (chrome.runtime && chrome.runtime.lastError) return;
      cachedPinterestSettings = parsePinterestUserSettings(
        data[SETTINGS_STORAGE]
      );
    });
  }

  /** One capital at the start of the phrase; rest lower — consistent UI for chips and pills. */
  function toSentenceCase(s) {
    const t = String(s || "").trim();
    if (!t) return t;
    const lower = t.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  function saveIntentRecent() {
    return Date.now() - saveIntentAt < SAVE_INTENT_MS;
  }

  function markSaveIntent(ev) {
    saveIntentAt = Date.now();
    if (ev && eventPathIncludesSaveTarget(ev)) {
      const saveEl = getSaveLikeElementFromPath(ev);
      lastPinPreviewUrl =
        findPinImageUrlNearSaveButton(saveEl) || findFallbackPinImageUrl();
    }
    startSavePoll();
    scheduleShowOverlay();
  }

  function getSaveLikeElementFromPath(ev) {
    const path =
      typeof ev.composedPath === "function" ? ev.composedPath() : [];
    for (const n of path) {
      if (isSaveLikeElement(n)) return n;
    }
    let t = ev.target;
    if (t && t.nodeType === Node.TEXT_NODE) t = t.parentElement;
    while (t && t !== document && t !== window) {
      if (isSaveLikeElement(t)) return t;
      t = t.parentElement;
    }
    return null;
  }

  function isPinImageCandidate(img) {
    if (!(img instanceof HTMLImageElement) || !img.src) return false;
    const s = img.src.toLowerCase();
    if (
      !s.includes("pinimg") &&
      !s.includes("pinimg.com") &&
      !s.includes("media.pinterest.com")
    ) {
      return false;
    }
    if (s.includes("avatar") || s.includes("profile")) return false;
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    return w * h > 2000;
  }

  function pickLargestPinImageUrl(root) {
    if (!(root instanceof Element)) return null;
    let bestUrl = null;
    let bestArea = 0;
    for (const img of root.querySelectorAll("img")) {
      if (!isPinImageCandidate(img)) continue;
      const w = img.naturalWidth || img.width || 1;
      const h = img.naturalHeight || img.height || 1;
      const a = w * h;
      if (a > bestArea) {
        bestArea = a;
        bestUrl = img.currentSrc || img.src;
      }
    }
    return bestUrl;
  }

  function findPinRootFromElement(el) {
    if (!(el instanceof Element)) return null;
    return (
      el.closest('[data-test-id="pin"]') ||
      el.closest('[data-test-id="pinWrapper"]') ||
      el.closest('[data-test-id*="PinCard"]') ||
      el.closest('[data-test-id*="pinCard"]') ||
      el.closest("article") ||
      el.closest('div[role="listitem"]')
    );
  }

  function findPinImageUrlNearSaveButton(saveBtn) {
    if (!(saveBtn instanceof Element)) return null;
    const root = findPinRootFromElement(saveBtn);
    if (root) {
      const u = pickLargestPinImageUrl(root);
      if (u) return u;
    }
    let p = saveBtn;
    for (let d = 0; d < 12 && p; d++) {
      const u = pickLargestPinImageUrl(p);
      if (u) return u;
      p = p.parentElement;
    }
    return null;
  }

  function findFallbackPinImageUrl() {
    const dialogs = document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"]'
    );
    for (const d of dialogs) {
      if (!isVisible(d)) continue;
      const u = pickLargestPinImageUrl(d);
      if (u) return u;
    }
    if (!/\/pin\//.test(window.location.pathname)) return null;
    const scope =
      document.querySelector('[data-test-id="pinrep"]') ||
      document.querySelector("main") ||
      document.body;
    return pickLargestPinImageUrl(scope);
  }

  function resolveOverlayPreviewUrl() {
    if (saveIntentRecent() && lastPinPreviewUrl) return lastPinPreviewUrl;
    const fb = findFallbackPinImageUrl();
    return fb || lastPinPreviewUrl || null;
  }

  function pruneThumbnailsIfOverBudget(logs) {
    if (JSON.stringify(logs).length <= STORAGE_BUDGET_BYTES) return false;
    const order = logs
      .map((e, i) => ({ i, t: new Date(e.timestamp).getTime() }))
      .sort((a, b) => a.t - b.t);
    let cleared = 0;
    for (const { i } of order) {
      if (cleared >= 10) break;
      if (logs[i].thumbnail) {
        logs[i].thumbnail = null;
        cleared++;
      }
    }
    if (cleared > 0) {
      console.warn(
        "Linger: linger_logs exceeded 8MB; removed thumbnails from up to 10 oldest entries."
      );
    }
    return cleared > 0;
  }

  async function captureImageAsBase64(imageUrl) {
    if (!imageUrl) return null;
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            const MAX = 200;
            const scale = Math.min(MAX / img.width, MAX / img.height, 1);
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              resolve(null);
              return;
            }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 0.7));
          } catch (_) {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = imageUrl;
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function captureImageAsBase64WithMax(imageUrl, maxSide) {
    if (!imageUrl) return null;
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            const scale = Math.min(maxSide / img.width, maxSide / img.height, 1);
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              resolve(null);
              return;
            }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 0.88));
          } catch (_) {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = imageUrl;
      } catch (_) {
        resolve(null);
      }
    });
  }

  /** False after the extension is reloaded while this tab still runs an old content script. */
  function extensionContextAlive() {
    try {
      return !!(
        typeof chrome !== "undefined" &&
        chrome.runtime &&
        chrome.runtime.id
      );
    } catch (_) {
      return false;
    }
  }

  function isContextInvalidatedMessage(msg) {
    return /context invalidated|extension context/i.test(String(msg || ""));
  }

  function isGeminiQuotaOrUsageMessage(msg) {
    return /usage limit was reached|free tier cap/i.test(String(msg || ""));
  }

  function storageLocalGet(keys) {
    return new Promise((resolve, reject) => {
      try {
        if (!extensionContextAlive()) {
          reject(new Error("Extension context invalidated"));
          return;
        }
        chrome.storage.local.get(keys, (data) => {
          const err = chrome.runtime.lastError;
          if (err) {
            reject(new Error(err.message));
            return;
          }
          resolve(data);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function storageLocalSet(obj) {
    return new Promise((resolve, reject) => {
      try {
        if (!extensionContextAlive()) {
          reject(new Error("Extension context invalidated"));
          return;
        }
        chrome.storage.local.set(obj, () => {
          const err = chrome.runtime.lastError;
          if (err) {
            reject(new Error(err.message));
            return;
          }
          resolve();
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function sendGeminiMessage(payload) {
    return new Promise((resolve) => {
      try {
        if (!extensionContextAlive()) {
          resolve({ ok: false, error: "Extension context invalidated" });
          return;
        }
        chrome.runtime.sendMessage(payload, (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
            resolve({ ok: false, error: err.message });
            return;
          }
          resolve(response || { ok: false, error: "No response" });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e.message || e) });
      }
    });
  }

  async function appendLog(entry) {
    const data = await storageLocalGet(STORAGE_KEY);
    const logs = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
    pruneThumbnailsIfOverBudget(logs);
    entry.thumbnail = null;
    logs.push(entry);
    await storageLocalSet({ [STORAGE_KEY]: logs });
  }

  async function patchLogThumbnail(id, dataUrl) {
    if (!dataUrl) return;
    try {
      if (!extensionContextAlive()) return;
      const data = await storageLocalGet(STORAGE_KEY);
      const logs = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
      const row = logs.find((x) => x.id === id);
      if (!row) return;
      row.thumbnail = dataUrl;
      pruneThumbnailsIfOverBudget(logs);
      await storageLocalSet({ [STORAGE_KEY]: logs });
    } catch (e) {
      console.error("Linger: failed to store thumbnail", e);
    }
  }

  function startSavePoll() {
    stopSavePoll();
    pollTicks = 0;
    pollTimer = window.setInterval(() => {
      pollTicks += 1;
      if (pollTicks > POLL_MAX_TICKS || overlayEl || !saveIntentRecent()) {
        stopSavePoll();
        return;
      }
      if (looksLikeSaveConfirmation()) {
        stopSavePoll();
        scheduleShowOverlay();
      }
    }, POLL_MS);
  }

  function stopSavePoll() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function pinUrlFromPage() {
    const m = window.location.pathname.match(/\/pin\/(\d+)/);
    if (m) {
      return `${window.location.origin}/pin/${m[1]}/`;
    }
    const links = document.querySelectorAll('a[href*="/pin/"]');
    let best = window.location.href.split("?")[0];
    for (const a of links) {
      const href = a.getAttribute("href");
      if (!href) continue;
      try {
        const u = new URL(href, window.location.origin);
        const pm = u.pathname.match(/\/pin\/(\d+)/);
        if (pm) return `${window.location.origin}/pin/${pm[1]}/`;
      } catch (_) {
        /* ignore */
      }
    }
    return best;
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = window.getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0)
      return false;
    return true;
  }

  function toastOrBannerLooksLikeSave(el) {
    if (!isVisible(el)) return false;
    const t = (el.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (t.length > 200) return false;
    const savedish =
      t.includes("saved") ||
      t.includes("pinned") ||
      t.includes("enregistr") ||
      t.includes("guardad") ||
      t.includes("gespeichert") ||
      t.includes("salvat") ||
      t.includes("保存");
    if (!savedish) return false;
    const context =
      t.includes("board") ||
      t.includes("profile") ||
      t.includes("pin") ||
      t.includes("tablero") ||
      t.includes("profil") ||
      t.includes("profilo") ||
      t.includes("brett") ||
      t.includes("carte");
    return savedish && (context || t.length < 80);
  }

  function scanToastsAndAlerts() {
    const sel = [
      '[data-test-id="toast"]',
      '[data-test-id="lego-toast"]',
      '[data-test-id*="toast" i]',
      '[role="alert"]',
      '[role="status"]',
    ].join(", ");
    const nodes = document.querySelectorAll(sel);
    for (const el of nodes) {
      if (toastOrBannerLooksLikeSave(el)) return true;
    }
    const loose = document.querySelectorAll(
      '[class*="Toast" i], [class*="Snackbar" i], [class*="Banner" i]'
    );
    for (const el of loose) {
      if (toastOrBannerLooksLikeSave(el)) return true;
    }
    return false;
  }

  function dialogHasSavedControl(d) {
    if (!isVisible(d)) return false;
    const buttons = d.querySelectorAll(
      'button, [role="button"], div[role="button"], a[role="button"]'
    );
    for (const el of buttons) {
      if (!isVisible(el)) continue;
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      if (!label.includes("saved")) continue;
      if (label.includes("unsave") || label.includes("remove")) continue;
      return true;
    }
    return false;
  }

  function scanDialogsForSaved() {
    const dialogs = document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], [data-test-id*="modal" i], [data-test-id*="Modal" i]'
    );
    for (const d of dialogs) {
      if (dialogHasSavedControl(d)) return true;
    }
    return false;
  }

  function looksLikeSaveConfirmation() {
    if (scanToastsAndAlerts()) return true;
    if (scanDialogsForSaved()) return true;
    if (/\/pin\//.test(window.location.pathname)) {
      const scope =
        document.querySelector('[data-test-id="pin"]') ||
        document.querySelector("main") ||
        document.querySelector('[data-test-id="pinrep"]') ||
        document.body;
      const saved = scope.querySelector(
        '[aria-label="Saved"], [aria-label^="Saved "]'
      );
      if (saved && isVisible(saved)) return true;
    }
    return false;
  }

  function isSaveLikeElement(el) {
    if (!(el instanceof Element)) return false;
    const tid = (el.getAttribute("data-test-id") || "").toLowerCase();
    if (tid) {
      if (/unsave|un-save|remove/i.test(tid)) return false;
      if (
        /save|board.?picker|pin.?save|save.?pin|save.?button|bookmark|pin.?it/i.test(
          tid
        )
      ) {
        return true;
      }
    }
    const tag = (el.tagName || "").toLowerCase();
    const isClickableRole =
      tag === "button" ||
      tag === "a" ||
      el.getAttribute("role") === "button" ||
      el.getAttribute("role") === "menuitem";
    if (!isClickableRole) return false;
    const label = (
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      ""
    ).trim();
    const lower = label.toLowerCase();
    if (lower.includes("unsave") || lower.includes("remove")) return false;
    if (
      /^save\b/.test(lower) ||
      lower.includes("save to") ||
      lower.includes("save pin") ||
      lower.includes("pin it") ||
      lower.includes("add pin") ||
      lower.includes("enregistr") ||
      lower.includes("guardar") ||
      lower.includes("speichern") ||
      lower.includes("salvar") ||
      lower.includes("保存")
    ) {
      return true;
    }
    return false;
  }

  function eventPathIncludesSaveTarget(ev) {
    const path =
      typeof ev.composedPath === "function" ? ev.composedPath() : [];
    if (path.length) {
      for (const n of path) {
        if (isSaveLikeElement(n)) return true;
      }
    }
    let t = ev.target;
    if (t && t.nodeType === Node.TEXT_NODE) t = t.parentElement;
    while (t && t !== document && t !== window) {
      if (isSaveLikeElement(t)) return true;
      t = t.parentElement;
    }
    return false;
  }

  function scheduleShowOverlay() {
    if (overlayEl) return;
    if (cachedPinterestSettings) {
      if (pinterestSettingsSnoozed(cachedPinterestSettings)) return;
      if (
        !pinterestAllowedForHost(
          cachedPinterestSettings,
          location.hostname
        )
      )
        return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (overlayEl) return;
      if (!looksLikeSaveConfirmation()) return;
      showOverlay();
    }, DEBOUNCE_MS);
  }

  function observe() {
    const obs = new MutationObserver(() => {
      if (looksLikeSaveConfirmation()) scheduleShowOverlay();
    });
    obs.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  }

  function bindSaveIntentListeners() {
    const onIntent = (ev) => {
      if (eventPathIncludesSaveTarget(ev)) markSaveIntent(ev);
    };
    document.addEventListener("click", onIntent, true);
    document.addEventListener("pointerdown", onIntent, true);
  }

  function removeOverlay() {
    if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
    overlayEl = null;
  }

  function showSuccessThenDismiss(card) {
    card.innerHTML = "";
    card.classList.add("linger-card--success");
    const t = document.createElement("p");
    t.className = "linger-success-text";
    t.textContent = "Logged ✓";
    card.appendChild(t);
    setTimeout(() => {
      card.classList.add("linger-fade-out");
      setTimeout(() => removeOverlay(), 450);
    }, 1200);
  }

  function showOverlayInner() {
    if (overlayEl) return;

    const root = document.createElement("div");
    root.className = "linger-root";
    root.setAttribute("data-linger-overlay", "true");

    const card = document.createElement("div");
    card.className = "linger-card";

    const overlayPreviewUrl = resolveOverlayPreviewUrl();

    const mediaCol = document.createElement("div");
    mediaCol.className =
      "linger-media" +
      (overlayPreviewUrl ? "" : " linger-media--placeholder");
    if (overlayPreviewUrl) {
      const previewImg = document.createElement("img");
      previewImg.src = overlayPreviewUrl;
      previewImg.alt = "";
      mediaCol.appendChild(previewImg);
    }

    const contentCol = document.createElement("div");
    contentCol.className = "linger-content";

    const header = document.createElement("div");
    header.className = "linger-header";
    const logoWrap = document.createElement("div");
    logoWrap.className = "linger-logo";
    const logoImg = document.createElement("img");
    logoImg.className = "linger-logo-img";
    logoImg.src = chrome.runtime.getURL("icons/full-logo.svg");
    logoImg.alt = "linger";
    logoWrap.appendChild(logoImg);
    const loadingHint = document.createElement("p");
    loadingHint.className = "linger-loading-hint linger-hidden";
    loadingHint.setAttribute("aria-live", "polite");
    const sub = document.createElement("div");
    sub.className = "linger-sub";
    sub.textContent = "Select what you love.";
    header.appendChild(logoWrap);
    header.appendChild(loadingHint);
    header.appendChild(sub);

    const panel = document.createElement("div");
    panel.className = "linger-ai-panel";

    const CUSTOM_FOCUS_MAX = 200;

    const state = {
      imageBase64: null,
      mimeType: "image/jpeg",
      labels: [],
      itemListReady: false,
      staged: [],
      attrCache: Object.create(null),
      currentItemLabel: null,
      currentUserFocus: false,
      attrSelected: [],
      attrChoices: [],
    };

    let panelLottieAnim = null;
    let cardHeightTransitionCleanup = null;
    let cardMeasureTimeoutId = 0;

    const reduceMotion =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    function cancelCardHeightTransition() {
      if (cardMeasureTimeoutId) {
        clearTimeout(cardMeasureTimeoutId);
        cardMeasureTimeoutId = 0;
      }
      if (cardHeightTransitionCleanup) {
        cardHeightTransitionCleanup();
        cardHeightTransitionCleanup = null;
      }
    }

    function beginCardHeightLock() {
      cancelCardHeightTransition();
      if (reduceMotion) return;
      const h = card.getBoundingClientRect().height;
      card.style.height = `${Math.round(h)}px`;
      card.style.overflow = "hidden";
    }

    function endCardHeightTransition(revealLogo) {
      cancelCardHeightTransition();
      if (revealLogo) logoWrap.classList.remove("linger-logo--concealed");
      if (reduceMotion) {
        card.style.height = "";
        card.style.overflow = "";
        return;
      }
      const runMeasure = () => {
        const end = Math.ceil(card.scrollHeight);
        const start = Math.round(card.getBoundingClientRect().height);
        if (Math.abs(end - start) < 2) {
          card.style.height = "";
          card.style.overflow = "";
          return;
        }
        card.style.transition =
          "height 0.42s cubic-bezier(0.33, 1, 0.68, 1)";
        card.style.height = `${end}px`;
        const onEnd = (e) => {
          if (e.propertyName !== "height") return;
          card.removeEventListener("transitionend", onEnd);
          card.style.height = "";
          card.style.overflow = "";
          card.style.transition = "";
          cardHeightTransitionCleanup = null;
        };
        cardHeightTransitionCleanup = () => {
          card.removeEventListener("transitionend", onEnd);
          card.style.height = "";
          card.style.overflow = "";
          card.style.transition = "";
        };
        card.addEventListener("transitionend", onEnd);
      };
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (revealLogo) {
            cardMeasureTimeoutId = window.setTimeout(() => {
              cardMeasureTimeoutId = 0;
              runMeasure();
            }, 90);
          } else {
            runMeasure();
          }
        });
      });
    }

    const actions = document.createElement("div");
    actions.className = "linger-actions";
    const logBtn = document.createElement("button");
    logBtn.type = "button";
    logBtn.className = "linger-btn-log";
    logBtn.textContent = "Log it";
    logBtn.disabled = true;
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "linger-skip";
    skip.textContent = "Skip";

    function setLogEnabled() {
      logBtn.disabled = state.staged.length === 0;
      logBtn.textContent =
        state.staged.length > 0
          ? "Log it (" + state.staged.length + ")"
          : "Log it";
    }

    function clearPanel() {
      if (panelLottieAnim) {
        try {
          panelLottieAnim.destroy();
        } catch (_) {
          /* ignore */
        }
        panelLottieAnim = null;
      }
      panel.innerHTML = "";
      loadingHint.textContent = "";
      loadingHint.classList.add("linger-hidden");
    }

    function showShimmer(caption, opts) {
      beginCardHeightLock();
      clearPanel();
      const wrap = document.createElement("div");
      wrap.className = "linger-shimmer-wrap";
      const cap = document.createElement("div");
      cap.className = "linger-shimmer-caption";
      cap.textContent = caption;
      wrap.appendChild(cap);
      const stage = document.createElement("div");
      stage.className = "linger-brand-load";
      stage.setAttribute("aria-hidden", "true");
      const lottieHost = document.createElement("div");
      lottieHost.className = "linger-lottie-host";
      stage.appendChild(lottieHost);
      wrap.appendChild(stage);
      for (let i = 0; i < 3; i++) {
        const row = document.createElement("div");
        row.className = "linger-shimmer-row";
        wrap.appendChild(row);
      }
      panel.appendChild(wrap);
      try {
        const LottieApi = globalThis.lottie;
        if (LottieApi && typeof LottieApi.loadAnimation === "function") {
          panelLottieAnim = LottieApi.loadAnimation({
            container: lottieHost,
            renderer: "svg",
            loop: true,
            path: chrome.runtime.getURL("icons/linger.json"),
          });
        }
      } catch (_) {
        /* ignore */
      }
      if (panelLottieAnim) logoWrap.classList.add("linger-logo--concealed");
      const hint =
        opts && typeof opts.headerHint === "string" ? opts.headerHint.trim() : "";
      if (hint && panelLottieAnim) {
        loadingHint.textContent = hint;
        loadingHint.classList.remove("linger-hidden");
      }
      endCardHeightTransition(false);
    }

    function showError(msg, showBackToGrid) {
      beginCardHeightLock();
      clearPanel();
      const invalidated = isContextInvalidatedMessage(msg);
      const p = document.createElement("p");
      p.className = "linger-ai-error";
      p.textContent = invalidated
        ? "This tab is still running an old Linger session (common right after you reload the extension in Chrome)."
        : msg;
      panel.appendChild(p);
      const hint = document.createElement("p");
      hint.className = "linger-ai-error-hint";
      hint.textContent = invalidated
        ? "Refresh this Pinterest page once (F5 or the reload button). After that, saves and AI will work again."
        : isGeminiQuotaOrUsageMessage(msg)
          ? "That limit is set by Google\u2019s API, not Linger. You can retry after a short wait or check usage at Google AI Studio."
          : "Add LINGER_GEMINI_API_KEY to a .env file in the extension folder, run npm run sync-env to create linger-config.local.json, then reload the extension. Get a key from Google AI Studio.";
      panel.appendChild(hint);
      if (showBackToGrid && state.itemListReady) {
        const back = document.createElement("button");
        back.type = "button";
        back.className = "linger-ai-back";
        back.textContent = "\u2190 Back to items";
        back.addEventListener("click", () => renderItemGrid());
        panel.appendChild(back);
      }
      endCardHeightTransition(true);
    }

    function stagedHas(label) {
      return state.staged.some((x) => x.label === label);
    }

    function renderItemGrid() {
      beginCardHeightLock();
      clearPanel();
      if (state.staged.length > 0) {
        const sum = document.createElement("div");
        sum.className = "linger-ai-staged-sum";
        sum.textContent =
          state.staged.length +
          " piece" +
          (state.staged.length === 1 ? "" : "s") +
          " queued to log.";
        panel.appendChild(sum);
      }
      const lab = document.createElement("div");
      lab.className = "linger-step-label";
      lab.textContent = "What stands out?";
      panel.appendChild(lab);
      if (state.labels.length === 0) {
        const emptyHint = document.createElement("p");
        emptyHint.className = "linger-ai-custom-hint";
        emptyHint.textContent =
          "We didn\u2019t pick out separate pieces on this pin. You can still describe what you love below.";
        panel.appendChild(emptyHint);
      }
      const grid = document.createElement("div");
      grid.className = "linger-item-grid";
      state.labels.forEach((label) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "linger-item-card";
        if (stagedHas(label)) btn.classList.add("linger-item-card--done");
        btn.textContent = label;
        btn.addEventListener("click", () => {
          void openAttributeFlow(label, { userFocus: false });
        });
        grid.appendChild(btn);
      });
      panel.appendChild(grid);

      const customWrap = document.createElement("div");
      customWrap.className = "linger-custom-focus";
      const customLab = document.createElement("div");
      customLab.className = "linger-step-label";
      customLab.style.marginTop = "14px";
      customLab.textContent = "Or describe it yourself";
      const customTa = document.createElement("textarea");
      customTa.className = "linger-note";
      customTa.rows = 2;
      customTa.maxLength = CUSTOM_FOCUS_MAX;
      customTa.placeholder =
        "e.g. how the top and bottom work together, the whole look, a vibe\u2026";
      const customHint = document.createElement("div");
      customHint.className = "linger-note-hint";
      const syncCustomHint = () => {
        customHint.textContent =
          customTa.value.length + " / " + CUSTOM_FOCUS_MAX;
      };
      customTa.addEventListener("input", syncCustomHint);
      syncCustomHint();
      const customErr = document.createElement("div");
      customErr.className = "linger-custom-focus-error linger-hidden";
      customErr.setAttribute("aria-live", "polite");
      const customBtn = document.createElement("button");
      customBtn.type = "button";
      customBtn.className = "linger-custom-focus-submit";
      customBtn.textContent = "Continue with what I wrote";
      customBtn.addEventListener("click", () => {
        customErr.classList.add("linger-hidden");
        const text = toSentenceCase(
          (customTa.value || "").trim().slice(0, CUSTOM_FOCUS_MAX)
        );
        if (!text) {
          customErr.textContent = "Add a short description to continue.";
          customErr.classList.remove("linger-hidden");
          return;
        }
        void openAttributeFlow(text, { userFocus: true });
      });
      customWrap.appendChild(customLab);
      customWrap.appendChild(customTa);
      customWrap.appendChild(customHint);
      customWrap.appendChild(customErr);
      customWrap.appendChild(customBtn);
      panel.appendChild(customWrap);
      endCardHeightTransition(true);
    }

    function filterAttrPills(attrs) {
      const out = [];
      const seen = Object.create(null);
      for (const a of attrs) {
        if (typeof a !== "string") continue;
        const t = a.trim();
        if (!t || t === "\u2014" || t === "—") continue;
        const sc = toSentenceCase(t);
        const k = sc.toLowerCase();
        if (seen[k]) continue;
        seen[k] = true;
        out.push(sc);
      }
      return out;
    }

    function renderAttributeView() {
      beginCardHeightLock();
      clearPanel();
      const back = document.createElement("button");
      back.type = "button";
      back.className = "linger-ai-back";
      back.textContent = "\u2190 Back to items";
      back.addEventListener("click", () => renderItemGrid());

      const title = document.createElement("div");
      title.className =
        "linger-step-label" +
        (state.currentUserFocus ? " linger-step-label--focus-body" : "");
      title.style.marginTop = "2px";
      title.textContent = state.currentItemLabel;

      const sub = document.createElement("div");
      sub.className = "linger-ai-sub";
      sub.textContent = state.currentUserFocus
        ? "What do you love about that? Pick any that fit."
        : "What do you love about it?";

      const pills = document.createElement("div");
      pills.className = "linger-pills";
      state.attrChoices.forEach((attr) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "linger-pill";
        b.dataset.value = attr;
        b.textContent = attr;
        if (state.attrSelected.includes(attr))
          b.classList.add("linger-pill--selected");
        b.addEventListener("click", () => {
          const idx = state.attrSelected.indexOf(attr);
          if (idx >= 0) {
            state.attrSelected.splice(idx, 1);
            b.classList.remove("linger-pill--selected");
          } else {
            state.attrSelected.push(attr);
            b.classList.add("linger-pill--selected");
          }
        });
        pills.appendChild(b);
      });

      const noteLab = document.createElement("div");
      noteLab.className = "linger-step-label";
      noteLab.style.marginTop = "10px";
      noteLab.textContent = "Your words (optional)";

      const ta = document.createElement("textarea");
      ta.className = "linger-note";
      ta.rows = 2;
      ta.maxLength = 200;
      ta.placeholder = "Anything else?";
      const existing = state.staged.find((x) => x.label === state.currentItemLabel);
      ta.value = (existing && existing.note) || "";
      const hint = document.createElement("div");
      hint.className = "linger-note-hint";
      const sync = () => {
        hint.textContent = ta.value.length + " / 200";
      };
      ta.addEventListener("input", sync);
      sync();

      const done = document.createElement("button");
      done.type = "button";
      done.className = "linger-btn-log linger-btn-log--secondary";
      done.style.marginTop = "12px";
      done.textContent = "Done with this piece";
      done.addEventListener("click", () => {
        const note = (ta.value || "").trim().slice(0, 200);
        const attrs = [...state.attrSelected];
        state.staged = state.staged.filter((x) => x.label !== state.currentItemLabel);
        const row = {
          label: state.currentItemLabel,
          attributes: attrs,
        };
        if (note) row.note = note;
        state.staged.push(row);
        setLogEnabled();
        renderItemGrid();
      });

      panel.appendChild(back);
      panel.appendChild(title);
      panel.appendChild(sub);
      panel.appendChild(pills);
      panel.appendChild(noteLab);
      panel.appendChild(ta);
      panel.appendChild(hint);
      panel.appendChild(done);
      endCardHeightTransition(true);
    }

    function attrCacheKey(label, userFocus) {
      return userFocus ? "\ufefffocus:" + label : label;
    }

    async function openAttributeFlow(label, opts) {
      const userFocus = opts && opts.userFocus === true;
      state.currentItemLabel = label;
      state.currentUserFocus = userFocus;
      const existing = state.staged.find((x) => x.label === label);
      state.attrSelected = existing ? [...(existing.attributes || [])] : [];

      const cKey = attrCacheKey(label, userFocus);
      const cached = state.attrCache[cKey];
      if (cached) {
        showShimmer("Refreshing details\u2026");
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 120)));
        state.attrChoices = filterAttrPills(cached);
        renderAttributeView();
        return;
      }

      showShimmer(
        userFocus
          ? "Thinking about what you said\u2026"
          : "Describing \u201c" + label + "\u201d\u2026"
      );

      const r = await sendGeminiMessage({
        type: "LINGER_GEMINI_ATTRIBUTES",
        imageBase64: state.imageBase64,
        mimeType: state.mimeType,
        itemLabel: label,
        userFocus: userFocus,
      });

      if (!r.ok) {
        showError(
          r.error || "Couldn\u2019t describe this item.",
          !isContextInvalidatedMessage(r.error) && state.itemListReady
        );
        return;
      }
      const raw = Array.isArray(r.attributes) ? r.attributes : [];
      state.attrCache[cKey] = raw;
      state.attrChoices = filterAttrPills(raw);
      renderAttributeView();
    }

    async function runListItems() {
      showShimmer("Scanning the pin\u2026");
      const hi = await captureImageAsBase64WithMax(overlayPreviewUrl, 896);
      if (!hi) {
        showError("Could not read this image.", false);
        return;
      }
      const comma = hi.indexOf(",");
      state.imageBase64 = comma >= 0 ? hi.slice(comma + 1) : hi;
      const r = await sendGeminiMessage({
        type: "LINGER_GEMINI_ITEMS",
        imageBase64: state.imageBase64,
        mimeType: state.mimeType,
      });
      if (!r.ok) {
        showError(
          r.error || "AI request failed.",
          !isContextInvalidatedMessage(r.error) && state.itemListReady
        );
        return;
      }
      const rawLabels = Array.isArray(r.items) ? r.items : [];
      state.labels = rawLabels
        .map((s) =>
          typeof s === "string" ? toSentenceCase(s.trim()) : ""
        )
        .filter(Boolean)
        .slice(0, 6);
      state.itemListReady = true;
      renderItemGrid();
    }

    skip.addEventListener("click", () => {
      removeOverlay();
    });

    logBtn.addEventListener("click", async () => {
      if (state.staged.length === 0) return;
      const entryId = crypto.randomUUID();
      const entry = {
        id: entryId,
        timestamp: new Date().toISOString(),
        url: pinUrlFromPage(),
        items: state.staged.map(({ label, attributes, note }) => {
          const row = { label, attributes: [...(attributes || [])] };
          if (note && String(note).trim()) row.note = String(note).trim();
          return row;
        }),
      };
      const captureSrc = overlayPreviewUrl;
      try {
        await appendLog(entry);
      } catch (e) {
        console.error("Linger: failed to save log", e);
        if (isContextInvalidatedMessage(e.message)) {
          showError(e.message, false);
        }
        return;
      }
      logBtn.disabled = true;
      showSuccessThenDismiss(card);
      void captureImageAsBase64(captureSrc).then((b64) => {
        if (b64) patchLogThumbnail(entryId, b64);
      });
    });

    actions.appendChild(skip);
    actions.appendChild(logBtn);

    contentCol.appendChild(header);
    contentCol.appendChild(panel);
    contentCol.appendChild(actions);

    card.appendChild(mediaCol);
    card.appendChild(contentCol);
    root.appendChild(card);
    document.documentElement.appendChild(root);
    overlayEl = root;
    stopSavePoll();

    setLogEnabled();
    void runListItems();
  }

  function showOverlay() {
    if (overlayEl) return;
    chrome.storage.local.get([SETTINGS_STORAGE], (data) => {
      try {
        if (chrome.runtime && chrome.runtime.lastError) return;
        const settings = parsePinterestUserSettings(data[SETTINGS_STORAGE]);
        if (pinterestSettingsSnoozed(settings)) return;
        if (!pinterestAllowedForHost(settings, location.hostname)) return;
        showOverlayInner();
      } catch (_) {
        /* silent */
      }
    });
  }

  function boot() {
    chrome.storage.local.get([SETTINGS_STORAGE], (data) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        cachedPinterestSettings = parsePinterestUserSettings(null);
      } else {
        cachedPinterestSettings = parsePinterestUserSettings(
          data[SETTINGS_STORAGE]
        );
      }
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes[SETTINGS_STORAGE]) return;
        refreshPinterestSettingsCache();
      });
      bindSaveIntentListeners();
      observe();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
