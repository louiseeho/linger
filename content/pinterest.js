(function () {
  "use strict";

  const STORAGE_KEY = "linger_logs";
  const SKIP_KEY = "linger_skip_streak";
  const DEBOUNCE_MS = 420;
  const SAVE_INTENT_MS = 3500;
  const POLL_MS = 220;
  const POLL_MAX_TICKS = 18;

  const REGIONS = [
    "Top",
    "Bottoms",
    "Shoes",
    "Accessories",
    "The whole combo",
  ];
  const TAGS = [
    "Silhouette",
    "Colour palette",
    "Texture or fabric",
    "Proportions",
    "How it's styled",
    "The vibe",
    "A specific item",
  ];

  let debounceTimer = null;
  let overlayEl = null;
  let saveIntentAt = 0;
  let pollTimer = null;
  let pollTicks = 0;

  function getSkipStreak() {
    const n = parseInt(sessionStorage.getItem(SKIP_KEY) || "0", 10);
    return Number.isFinite(n) ? n : 0;
  }

  function setSkipStreak(n) {
    sessionStorage.setItem(SKIP_KEY, String(Math.max(0, n)));
  }

  function saveIntentRecent() {
    return Date.now() - saveIntentAt < SAVE_INTENT_MS;
  }

  function markSaveIntent() {
    saveIntentAt = Date.now();
    startSavePoll();
    scheduleShowOverlay();
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
    if (getSkipStreak() >= 3) return;
    if (overlayEl) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (getSkipStreak() >= 3) return;
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
      if (eventPathIncludesSaveTarget(ev)) markSaveIntent();
    };
    document.addEventListener("click", onIntent, true);
    document.addEventListener(
      "pointerdown",
      (ev) => {
        if (eventPathIncludesSaveTarget(ev)) markSaveIntent();
      },
      true
    );
  }

  function togglePill(btn, list) {
    btn.classList.toggle("linger-pill--selected");
    const label = btn.dataset.value;
    const i = list.indexOf(label);
    if (btn.classList.contains("linger-pill--selected")) {
      if (i < 0) list.push(label);
    } else if (i >= 0) list.splice(i, 1);
  }

  function buildPills(values, multiselect, stateArray) {
    const wrap = document.createElement("div");
    wrap.className = "linger-pills";
    for (const v of values) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "linger-pill";
      b.dataset.value = v;
      b.textContent = v;
      b.addEventListener("click", () => {
        if (multiselect) {
          togglePill(b, stateArray);
        } else {
          wrap.querySelectorAll(".linger-pill").forEach((p) => {
            p.classList.remove("linger-pill--selected");
          });
          stateArray.length = 0;
          b.classList.add("linger-pill--selected");
          stateArray.push(v);
        }
        updateLogEnabled();
      });
      wrap.appendChild(b);
    }
    return wrap;
  }

  let regionsState = [];
  let tagsState = [];
  let noteInput = null;
  let logBtn = null;

  function updateLogEnabled() {
    if (logBtn) logBtn.disabled = regionsState.length === 0;
  }

  function removeOverlay() {
    if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
    overlayEl = null;
    regionsState = [];
    tagsState = [];
    noteInput = null;
    logBtn = null;
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

  async function appendLog(entry) {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const logs = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
    logs.push(entry);
    await chrome.storage.local.set({ [STORAGE_KEY]: logs });
  }

  function showOverlay() {
    if (overlayEl) return;

    regionsState = [];
    tagsState = [];

    const root = document.createElement("div");
    root.className = "linger-root";
    root.setAttribute("data-linger-overlay", "true");

    const card = document.createElement("div");
    card.className = "linger-card";

    const header = document.createElement("div");
    header.className = "linger-header";
    header.innerHTML =
      '<div><div class="linger-logo">Linger<span class="linger-logo-dot">.</span></div><div class="linger-sub">What do you love about this pin?</div></div>';

    const step1 = document.createElement("div");
    step1.className = "linger-step";
    const l1 = document.createElement("div");
    l1.className = "linger-step-label";
    l1.textContent = "Step 1 — Which part?";
    step1.appendChild(l1);
    step1.appendChild(buildPills(REGIONS, true, regionsState));

    const step2 = document.createElement("div");
    step2.className = "linger-step";
    const l2 = document.createElement("div");
    l2.className = "linger-step-label";
    l2.textContent = "Step 2 — What about it?";
    step2.appendChild(l2);
    step2.appendChild(buildPills(TAGS, true, tagsState));

    const step3 = document.createElement("div");
    step3.className = "linger-step";
    const l3 = document.createElement("div");
    l3.className = "linger-step-label";
    l3.textContent = "Step 3 — Anything else? (optional)";
    noteInput = document.createElement("textarea");
    noteInput.className = "linger-note";
    noteInput.rows = 2;
    noteInput.maxLength = 80;
    noteInput.placeholder = "A few words…";
    const hint = document.createElement("div");
    hint.className = "linger-note-hint";
    const syncHint = () => {
      hint.textContent = `${noteInput.value.length} / 80`;
    };
    noteInput.addEventListener("input", syncHint);
    syncHint();
    step3.appendChild(l3);
    step3.appendChild(noteInput);
    step3.appendChild(hint);

    const actions = document.createElement("div");
    actions.className = "linger-actions";
    logBtn = document.createElement("button");
    logBtn.type = "button";
    logBtn.className = "linger-btn-log";
    logBtn.textContent = "Log it";
    logBtn.disabled = true;
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "linger-skip";
    skip.textContent = "Skip";

    skip.addEventListener("click", () => {
      setSkipStreak(getSkipStreak() + 1);
      removeOverlay();
    });

    logBtn.addEventListener("click", async () => {
      if (regionsState.length === 0) return;
      const note = (noteInput.value || "").trim().slice(0, 80);
      const entry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        url: pinUrlFromPage(),
        regions: [...regionsState],
        tags: [...tagsState],
        note: note || undefined,
      };
      if (!entry.note) delete entry.note;
      try {
        await appendLog(entry);
      } catch (e) {
        console.error("Linger: failed to save log", e);
        return;
      }
      setSkipStreak(0);
      logBtn.disabled = true;
      showSuccessThenDismiss(card);
    });

    actions.appendChild(skip);
    actions.appendChild(logBtn);

    card.appendChild(header);
    card.appendChild(step1);
    card.appendChild(step2);
    card.appendChild(step3);
    card.appendChild(actions);
    root.appendChild(card);
    document.documentElement.appendChild(root);
    overlayEl = root;
    stopSavePoll();
  }

  function boot() {
    bindSaveIntentListeners();
    observe();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
