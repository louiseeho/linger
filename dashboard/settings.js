(function () {
  "use strict";

  const STORAGE_LOGS = "linger_logs";
  const STORAGE_TAXONOMY = "linger_taxonomy_cache";
  const STORAGE_SETTINGS = "linger_user_settings";

  const MS_DAY = 24 * 60 * 60 * 1000;

  function el(id) {
    return document.getElementById(id);
  }

  function normHost(h) {
    let s = String(h || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .split(":")[0];
    s = s.replace(/^www\./, "");
    return s;
  }

  function defaultSettings() {
    return {
      shoppingEnabled: true,
      pinterestEnabled: true,
      usePerSiteShopping: false,
      perSiteShopping: {},
      usePerSitePinterest: false,
      perSitePinterest: {},
      snoozeUntilMs: 0,
      maxShoppingInterventionsPerDay: 0,
    };
  }

  function mergeSettings(raw) {
    const d = defaultSettings();
    if (!raw || typeof raw !== "object") return d;
    if (raw.shoppingEnabled === false) d.shoppingEnabled = false;
    if (raw.pinterestEnabled === false) d.pinterestEnabled = false;
    d.usePerSiteShopping = !!raw.usePerSiteShopping;
    d.usePerSitePinterest = !!raw.usePerSitePinterest;
    if (raw.perSiteShopping && typeof raw.perSiteShopping === "object")
      d.perSiteShopping = { ...raw.perSiteShopping };
    if (raw.perSitePinterest && typeof raw.perSitePinterest === "object")
      d.perSitePinterest = { ...raw.perSitePinterest };
    if (typeof raw.snoozeUntilMs === "number" && raw.snoozeUntilMs > 0)
      d.snoozeUntilMs = raw.snoozeUntilMs;
    const max = raw.maxShoppingInterventionsPerDay;
    if (max != null && max !== "") {
      const n = parseInt(max, 10);
      if (Number.isFinite(n) && n >= 0) d.maxShoppingInterventionsPerDay = n;
    }
    return d;
  }

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }

  let currentSettings = defaultSettings();

  function syncSiteList(ul, map, kind) {
    ul.innerHTML = "";
    const hosts = Object.keys(map).sort();
    if (hosts.length === 0) {
      const li = document.createElement("li");
      li.className = "settings-site-item";
      li.textContent = "No sites yet.";
      li.style.color = "#8a8880";
      li.style.fontStyle = "italic";
      ul.appendChild(li);
      return;
    }
    for (const host of hosts) {
      const li = document.createElement("li");
      li.className = "settings-site-item";
      const name = document.createElement("span");
      name.className = "settings-site-host";
      name.textContent = host;
      const actions = document.createElement("div");
      actions.className = "settings-site-item-actions";
      const lab = document.createElement("label");
      lab.className = "settings-site-toggle";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!map[host];
      cb.addEventListener("change", async () => {
        if (kind === "shopping") {
          currentSettings.perSiteShopping[host] = cb.checked;
        } else {
          currentSettings.perSitePinterest[host] = cb.checked;
        }
        await storageSet({ [STORAGE_SETTINGS]: currentSettings });
      });
      lab.appendChild(cb);
      lab.appendChild(
        document.createTextNode(
          kind === "shopping" ? " Allow nudges" : " Allow prompts"
        )
      );
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "settings-remove-host";
      rm.textContent = "Remove";
      rm.addEventListener("click", async () => {
        if (kind === "shopping") delete currentSettings.perSiteShopping[host];
        else delete currentSettings.perSitePinterest[host];
        await storageSet({ [STORAGE_SETTINGS]: currentSettings });
        syncSiteList(ul, kind === "shopping" ? currentSettings.perSiteShopping : currentSettings.perSitePinterest, kind);
      });
      actions.appendChild(lab);
      actions.appendChild(rm);
      li.appendChild(name);
      li.appendChild(actions);
      ul.appendChild(li);
    }
  }

  function updateSnoozeLine() {
    const p = el("settings-snooze-status");
    const until = currentSettings.snoozeUntilMs;
    if (!until || until <= Date.now()) {
      p.textContent = "";
      return;
    }
    const end = new Date(until);
    p.textContent =
      "Snoozed until " +
      end.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }) +
      ".";
  }

  function updatePerSiteUi() {
    const shopWrap = el("settings-shopping-sites-wrap");
    const pinWrap = el("settings-pinterest-sites-wrap");
    shopWrap.classList.toggle("disabled", !currentSettings.usePerSiteShopping);
    pinWrap.classList.toggle("disabled", !currentSettings.usePerSitePinterest);
    syncSiteList(el("settings-shopping-sites"), currentSettings.perSiteShopping, "shopping");
    syncSiteList(el("settings-pinterest-sites"), currentSettings.perSitePinterest, "pinterest");
  }

  async function loadUi() {
    const data = await storageGet([STORAGE_SETTINGS]);
    currentSettings = mergeSettings(data[STORAGE_SETTINGS]);
    el("settings-shopping-global").checked = currentSettings.shoppingEnabled;
    el("settings-pinterest-global").checked = currentSettings.pinterestEnabled;
    el("settings-use-per-site-shopping").checked = currentSettings.usePerSiteShopping;
    el("settings-use-per-site-pinterest").checked = currentSettings.usePerSitePinterest;
    el("settings-max-shopping").value = String(
      currentSettings.maxShoppingInterventionsPerDay || 0
    );
    updateSnoozeLine();
    updatePerSiteUi();
  }

  el("settings-shopping-global").addEventListener("change", async (e) => {
    currentSettings.shoppingEnabled = e.target.checked;
    await storageSet({ [STORAGE_SETTINGS]: currentSettings });
  });

  el("settings-pinterest-global").addEventListener("change", async (e) => {
    currentSettings.pinterestEnabled = e.target.checked;
    await storageSet({ [STORAGE_SETTINGS]: currentSettings });
  });

  el("settings-use-per-site-shopping").addEventListener("change", async (e) => {
    currentSettings.usePerSiteShopping = e.target.checked;
    await storageSet({ [STORAGE_SETTINGS]: currentSettings });
    updatePerSiteUi();
  });

  el("settings-use-per-site-pinterest").addEventListener("change", async (e) => {
    currentSettings.usePerSitePinterest = e.target.checked;
    await storageSet({ [STORAGE_SETTINGS]: currentSettings });
    updatePerSiteUi();
  });

  el("settings-max-shopping").addEventListener("change", async (e) => {
    let n = parseInt(e.target.value, 10);
    if (!Number.isFinite(n) || n < 0) n = 0;
    if (n > 999) n = 999;
    e.target.value = String(n);
    currentSettings.maxShoppingInterventionsPerDay = n;
    await storageSet({ [STORAGE_SETTINGS]: currentSettings });
  });

  el("settings-snooze-24").addEventListener("click", async () => {
    currentSettings.snoozeUntilMs = Date.now() + MS_DAY;
    await storageSet({ [STORAGE_SETTINGS]: currentSettings });
    updateSnoozeLine();
  });

  el("settings-snooze-clear").addEventListener("click", async () => {
    currentSettings.snoozeUntilMs = 0;
    await storageSet({ [STORAGE_SETTINGS]: currentSettings });
    updateSnoozeLine();
  });

  function addSite(kind) {
    const isShop = kind === "shopping";
    const input = el(isShop ? "settings-shopping-host-input" : "settings-pinterest-host-input");
    const enabled = el(isShop ? "settings-shopping-host-enabled" : "settings-pinterest-host-enabled").checked;
    const host = normHost(input.value);
    if (!host) return;
    if (isShop) currentSettings.perSiteShopping[host] = enabled;
    else currentSettings.perSitePinterest[host] = enabled;
    input.value = "";
    void storageSet({ [STORAGE_SETTINGS]: currentSettings }).then(() => updatePerSiteUi());
  }

  el("settings-shopping-host-add").addEventListener("click", () => addSite("shopping"));
  el("settings-pinterest-host-add").addEventListener("click", () => addSite("pinterest"));

  el("settings-shopping-host-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addSite("shopping");
    }
  });
  el("settings-pinterest-host-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addSite("pinterest");
    }
  });

  el("settings-export").addEventListener("click", async () => {
    const status = el("settings-export-status");
    status.textContent = "";
    status.style.color = "";
    try {
      const data = await storageGet([
        STORAGE_LOGS,
        STORAGE_TAXONOMY,
        STORAGE_SETTINGS,
      ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        version: 1,
        [STORAGE_LOGS]: Array.isArray(data[STORAGE_LOGS]) ? data[STORAGE_LOGS] : [],
        [STORAGE_TAXONOMY]: data[STORAGE_TAXONOMY] || { pieces: {}, details: {} },
        [STORAGE_SETTINGS]: mergeSettings(data[STORAGE_SETTINGS]),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "linger-taste-profile-" + localDayKey() + ".json";
      a.click();
      URL.revokeObjectURL(url);
      status.textContent = "Download started.";
    } catch (_) {
      status.textContent = "Export failed.";
      status.style.color = "#c94a48";
    }
  });

  function localDayKey() {
    const d = new Date();
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_SETTINGS]) return;
    void loadUi();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void loadUi());
  } else {
    void loadUi();
  }
})();
