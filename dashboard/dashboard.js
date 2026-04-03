(function () {
  "use strict";

  const STORAGE_KEY = "linger_logs";

  const el = (id) => document.getElementById(id);

  function relativeTime(iso) {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const sec = Math.floor((now - then) / 1000);
    if (sec < 45) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return min === 1 ? "1 minute ago" : `${min} minutes ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr === 1 ? "1 hour ago" : `${hr} hours ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return day === 1 ? "1 day ago" : `${day} days ago`;
    const wk = Math.floor(day / 7);
    if (wk < 5) return wk === 1 ? "1 week ago" : `${wk} weeks ago`;
    const mo = Math.floor(day / 30);
    return mo <= 1 ? "about a month ago" : `${mo} months ago`;
  }

  function countKeys(logs, field) {
    const map = Object.create(null);
    for (const row of logs) {
      const arr = row[field];
      if (!Array.isArray(arr)) continue;
      for (const k of arr) {
        if (!k) continue;
        map[k] = (map[k] || 0) + 1;
      }
    }
    return map;
  }

  function topEntry(map) {
    let best = null;
    let bestN = -1;
    for (const k of Object.keys(map)) {
      const n = map[k];
      if (n > bestN || (n === bestN && best !== null && k < best)) {
        bestN = n;
        best = k;
      }
    }
    return best;
  }

  function renderBars(container, map, emptyMsg) {
    container.innerHTML = "";
    const keys = Object.keys(map);
    if (keys.length === 0) {
      const p = document.createElement("p");
      p.className = "dash-chart-empty";
      p.textContent = emptyMsg;
      container.appendChild(p);
      return;
    }
    const max = Math.max(...keys.map((k) => map[k]), 1);
    const sorted = keys.sort((a, b) => map[b] - map[a] || a.localeCompare(b));
    for (const label of sorted) {
      const n = map[label];
      const pct = Math.round((n / max) * 100);
      const row = document.createElement("div");
      row.className = "dash-bar-row";
      const left = document.createElement("div");
      left.className = "dash-bar-label";
      left.textContent = label;
      const mid = document.createElement("div");
      mid.className = "dash-bar-track";
      const fill = document.createElement("div");
      fill.className = "dash-bar-fill";
      fill.style.width = pct + "%";
      mid.appendChild(fill);
      const count = document.createElement("div");
      count.className = "dash-bar-count";
      count.textContent = String(n);
      row.appendChild(left);
      row.appendChild(mid);
      row.appendChild(count);
      container.appendChild(row);
    }
  }

  function renderRecent(container, logs) {
    container.innerHTML = "";
    const slice = logs.slice(0, 10);
    for (const row of slice) {
      const card = document.createElement("article");
      card.className = "dash-card";
      const time = document.createElement("div");
      time.className = "dash-card-time";
      time.textContent = relativeTime(row.timestamp);
      card.appendChild(time);
      const pills = document.createElement("div");
      pills.className = "dash-card-pills";
      for (const r of row.regions || []) {
        const p = document.createElement("span");
        p.className = "dash-pill";
        p.textContent = r;
        pills.appendChild(p);
      }
      for (const t of row.tags || []) {
        const p = document.createElement("span");
        p.className = "dash-pill dash-pill--tag";
        p.textContent = t;
        pills.appendChild(p);
      }
      card.appendChild(pills);
      if (row.note) {
        const note = document.createElement("p");
        note.className = "dash-card-note";
        note.textContent = row.note;
        card.appendChild(note);
      }
      container.appendChild(card);
    }
  }

  function render() {
    chrome.storage.local.get(STORAGE_KEY, (data) => {
      const raw = data[STORAGE_KEY];
      const logs = Array.isArray(raw) ? raw : [];
      const sorted = [...logs].sort(
        (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
      );

      el("dash-total").textContent = String(sorted.length);

      const regionCounts = countKeys(sorted, "regions");
      const tagCounts = countKeys(sorted, "tags");

      const topRegion = topEntry(regionCounts);
      const topTag = topEntry(tagCounts);
      const summaryEl = el("dash-summary");
      if (sorted.length === 0) {
        summaryEl.textContent =
          "Log saves on Pinterest to see patterns in what pulls your attention.";
      } else if (topRegion) {
        let line = `Your eye is drawn to ${topRegion} most.`;
        if (topTag) line += ` You often notice ${topTag.toLowerCase()}.`;
        summaryEl.textContent = line;
      } else {
        summaryEl.textContent = "Keep logging regions and tags to sharpen your profile.";
      }

      renderBars(
        el("dash-regions-chart"),
        regionCounts,
        "No regions logged yet."
      );
      renderBars(el("dash-tags-chart"), tagCounts, "No tags logged yet.");

      const recent = el("dash-recent");
      const empty = el("dash-recent-empty");
      if (sorted.length === 0) {
        recent.classList.add("hidden");
        empty.classList.remove("hidden");
      } else {
        recent.classList.remove("hidden");
        empty.classList.add("hidden");
        renderRecent(recent, sorted);
      }
    });
  }

  el("dash-clear").addEventListener("click", () => {
    el("dash-clear-confirm").classList.remove("hidden");
  });

  el("dash-clear-cancel").addEventListener("click", () => {
    el("dash-clear-confirm").classList.add("hidden");
  });

  el("dash-clear-yes").addEventListener("click", () => {
    chrome.storage.local.set({ [STORAGE_KEY]: [] }, () => {
      el("dash-clear-confirm").classList.add("hidden");
      render();
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) render();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
