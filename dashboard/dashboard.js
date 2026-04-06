(function () {
  "use strict";

  const STORAGE_KEY = "linger_logs";
  const TAXONOMY_STORAGE = "linger_taxonomy_cache";

  const PIECE_ORDER = [
    "Tops",
    "Bottoms",
    "Dresses & jumpsuits",
    "Jackets & coats",
    "Shoes",
    "Bags",
    "Jewelry",
    "Accessories",
    "Other",
  ];

  const DETAIL_ORDER = [
    "Colour & pattern",
    "Fabric & texture",
    "Fit & silhouette",
    "Styling & pairing",
    "Details & accents",
    "Vibe",
    "Other",
  ];

  const el = (id) => document.getElementById(id);

  let taxonomyLottieAnim = null;

  function destroyTaxonomyLottie() {
    if (taxonomyLottieAnim) {
      try {
        taxonomyLottieAnim.destroy();
      } catch (_) {
        /* ignore */
      }
      taxonomyLottieAnim = null;
    }
  }

  function showTaxonomyLoading() {
    const wrap = el("dash-taxonomy-loading");
    const host = el("dash-taxonomy-lottie");
    if (!wrap || !host) return;
    el("dash-taxonomy-status").textContent = "";
    destroyTaxonomyLottie();
    host.innerHTML = "";
    wrap.classList.remove("hidden");
    try {
      const LottieApi = globalThis.lottie;
      if (LottieApi && typeof LottieApi.loadAnimation === "function") {
        taxonomyLottieAnim = LottieApi.loadAnimation({
          container: host,
          renderer: "svg",
          loop: true,
          path: chrome.runtime.getURL("icons/linger.json"),
        });
      }
    } catch (_) {
      /* ignore */
    }
  }

  function hideTaxonomyLoading() {
    destroyTaxonomyLottie();
    const wrap = el("dash-taxonomy-loading");
    if (wrap) wrap.classList.add("hidden");
  }

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }

  function sendTaxonomy(pieceLabels, detailLabels) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: "LINGER_GEMINI_TAXONOMY",
            pieceLabels,
            detailLabels,
          },
          (resp) => {
            if (chrome.runtime.lastError) {
              resolve({
                ok: false,
                error: chrome.runtime.lastError.message,
              });
              return;
            }
            resolve(resp || { ok: false });
          }
        );
      } catch (e) {
        resolve({ ok: false, error: String(e.message || e) });
      }
    });
  }

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

  function countPieceLabels(logs) {
    const map = Object.create(null);
    for (const row of logs) {
      if (Array.isArray(row.items) && row.items.length) {
        for (const it of row.items) {
          const l = it && typeof it.label === "string" ? it.label.trim() : "";
          if (l) map[l] = (map[l] || 0) + 1;
        }
      } else {
        const arr = row.regions;
        if (!Array.isArray(arr)) continue;
        for (const k of arr) {
          if (!k) continue;
          map[k] = (map[k] || 0) + 1;
        }
      }
    }
    return map;
  }

  function countDetailTags(logs) {
    const map = Object.create(null);
    for (const row of logs) {
      if (Array.isArray(row.items) && row.items.length) {
        for (const it of row.items) {
          const attrs = Array.isArray(it.attributes) ? it.attributes : [];
          for (const a of attrs) {
            if (!a || typeof a !== "string") continue;
            const t = a.trim();
            if (!t || t === "\u2014" || t === "\u2013") continue;
            map[t] = (map[t] || 0) + 1;
          }
        }
      } else {
        const arr = row.tags;
        if (!Array.isArray(arr)) continue;
        for (const k of arr) {
          if (!k) continue;
          map[k] = (map[k] || 0) + 1;
        }
      }
    }
    return map;
  }

  function fallbackPieceCategory(s) {
    const raw = String(s || "").trim();
    const t = raw.toLowerCase();
    if (t === "top" || t === "tops") return "Tops";
    if (t === "bottoms") return "Bottoms";
    if (t === "shoes") return "Shoes";
    if (t === "accessories") return "Accessories";
    if (/whole combo|full outfit|entire look|the whole combo/i.test(raw))
      return "Other";
    if (/\b(bag|tote|clutch|backpack|handbag)\b/.test(t)) return "Bags";
    if (
      /\b(earring|necklace|bracelet|ring\b|jewelry|jewellery|watch|pendant|hoop)\b/.test(
        t
      )
    )
      return "Jewelry";
    if (
      /\b(boot|shoe|heel|sneaker|sandal|loafer|mule|footwear|trainer|pump|clog|slide)\b/.test(
        t
      )
    )
      return "Shoes";
    if (/\b(dress|jumpsuit|romper|gown)\b/.test(t)) return "Dresses & jumpsuits";
    if (/\b(jacket|coat|blazer|parka|anorak|outerwear|cardigan worn as)\b/.test(t))
      return "Jackets & coats";
    if (/\b(jean|trouser|pant|skirt|short|legging|jogger|culotte|bottom)\b/.test(t))
      return "Bottoms";
    if (
      /\b(shirt|top|blouse|sweater|tee|t-shirt|knit|hoodie|tank|cami|polo|crop top)\b/.test(
        t
      )
    )
      return "Tops";
    if (/\b(hat|scarf|belt|sunglass|wallet|headband|hair clip|brooch)\b/.test(t))
      return "Accessories";
    return "Other";
  }

  function fallbackDetailCategory(s) {
    const t = String(s || "").toLowerCase();
    if (
      /\b(colou?r|tone|hue|shade|pattern|print|stripe|plaid|contrast|monochrome|neutral|pastel|bold colou?r)\b/.test(
        t
      )
    )
      return "Colour & pattern";
    if (
      /\b(wool|silk|cotton|linen|denim|leather|suede|knit|texture|fabric|sheen|matte|glossy|ribbed|fleece|cashmere|mesh|lace)\b/.test(
        t
      )
    )
      return "Fabric & texture";
    if (
      /\b(fit|silhouette|cut|taper|wide leg|slim|oversized|cropped|high waist|rise|length|hem|volume|boxy|fitted)\b/.test(
        t
      )
    )
      return "Fit & silhouette";
    if (
      /\b(layer|pair|styled with|together|combo|proportion|balance|outfit)\b/.test(
        t
      )
    )
      return "Styling & pairing";
    if (
      /\b(button|zip|pocket|stitch|hardware|trim|detail|embroidery|logo|strap|buckle)\b/.test(
        t
      )
    )
      return "Details & accents";
    if (
      /\b(vibe|mood|feel|energy|aesthetic|minimal|edgy|classic|retro|romantic|chic|casual|formal)\b/.test(
        t
      )
    )
      return "Vibe";
    return "Other";
  }

  function rollupToGroups(rawCountMap, labelToGroup) {
    const out = Object.create(null);
    for (const label of Object.keys(rawCountMap)) {
      const n = rawCountMap[label];
      const g = labelToGroup[label] || "Other";
      out[g] = (out[g] || 0) + n;
    }
    return out;
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

  function secondTopEntry(map, exclude) {
    let best = null;
    let bestN = -1;
    for (const k of Object.keys(map)) {
      if (k === exclude) continue;
      const n = map[k];
      if (n > bestN || (n === bestN && best !== null && k < best)) {
        bestN = n;
        best = k;
      }
    }
    return best;
  }

  function buildSummary(pieceGrouped, detailGrouped, nLogs) {
    if (nLogs === 0) {
      return "Log saves on Pinterest to see patterns in what pulls your attention.";
    }
    const topP = topEntry(pieceGrouped);
    const topD = topEntry(detailGrouped);
    const hasPieces = Object.keys(pieceGrouped).length > 0;
    const hasDetails = Object.keys(detailGrouped).length > 0;
    if (!hasPieces && !hasDetails) {
      return "Keep logging on Pinterest to sharpen your profile.";
    }
    if (!hasPieces && hasDetails && topD) {
      return `What you notice skews toward ${topD.toLowerCase()}.`;
    }
    if (hasPieces && topP) {
      let line = `You save ${topP.toLowerCase()} most often.`;
      const secondP = secondTopEntry(pieceGrouped, topP);
      if (
        secondP &&
        pieceGrouped[secondP] >= pieceGrouped[topP] * 0.35
      ) {
        line = `You lean toward ${topP.toLowerCase()} and ${secondP.toLowerCase()}.`;
      }
      if (hasDetails && topD) {
        line += ` What you notice skews toward ${topD.toLowerCase()}.`;
      }
      return line;
    }
    return "Keep logging on Pinterest to sharpen your profile.";
  }

  function renderBarsOrdered(container, map, order, emptyMsg) {
    container.innerHTML = "";
    const ordered = order.filter((k) => (map[k] || 0) > 0);
    const extras = Object.keys(map).filter(
      (k) => !order.includes(k) && map[k] > 0
    );
    extras.sort((a, b) => map[b] - map[a] || a.localeCompare(b));
    const keys = [...ordered, ...extras];
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

      const body = document.createElement("div");
      body.className = "dash-card-body";

      const thumb = document.createElement("div");
      if (row.thumbnail) {
        thumb.className = "dash-card-thumb";
        const img = document.createElement("img");
        img.src = row.thumbnail;
        img.alt = "";
        thumb.appendChild(img);
      } else {
        thumb.className = "dash-card-thumb dash-card-thumb--placeholder";
      }
      body.appendChild(thumb);

      const main = document.createElement("div");
      main.className = "dash-card-main";
      if (Array.isArray(row.items) && row.items.length) {
        for (const it of row.items) {
          const block = document.createElement("div");
          block.className = "dash-item-block";
          const pills = document.createElement("div");
          pills.className = "dash-card-pills";
          if (it.label) {
            const p = document.createElement("span");
            p.className = "dash-pill";
            p.textContent = it.label;
            pills.appendChild(p);
          }
          for (const a of it.attributes || []) {
            if (!a || a === "\u2014") continue;
            const p2 = document.createElement("span");
            p2.className = "dash-pill dash-pill--tag";
            p2.textContent = a;
            pills.appendChild(p2);
          }
          block.appendChild(pills);
          if (it.note) {
            const note = document.createElement("p");
            note.className = "dash-card-note";
            note.textContent = it.note;
            block.appendChild(note);
          }
          main.appendChild(block);
        }
      } else {
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
        main.appendChild(pills);
        if (row.note) {
          const note = document.createElement("p");
          note.className = "dash-card-note";
          note.textContent = row.note;
          main.appendChild(note);
        }
      }
      body.appendChild(main);
      card.appendChild(body);
      container.appendChild(card);
    }
  }

  async function render() {
    const data = await storageGet([STORAGE_KEY, TAXONOMY_STORAGE]);
    const raw = data[STORAGE_KEY];
    const logs = Array.isArray(raw) ? raw : [];
    const sorted = [...logs].sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    el("dash-total").textContent = String(sorted.length);

    const summaryEl = el("dash-summary");
    const taxStatus = el("dash-taxonomy-status");
    const pieceRaw = countPieceLabels(sorted);
    const detailRaw = countDetailTags(sorted);

    if (sorted.length === 0) {
      summaryEl.textContent =
        "Log saves on Pinterest to see patterns in what pulls your attention.";
      taxStatus.textContent = "";
      hideTaxonomyLoading();
      renderBarsOrdered(
        el("dash-regions-chart"),
        {},
        PIECE_ORDER,
        "No pieces logged yet."
      );
      renderBarsOrdered(
        el("dash-tags-chart"),
        {},
        DETAIL_ORDER,
        "No details logged yet."
      );
      const recent = el("dash-recent");
      const empty = el("dash-recent-empty");
      recent.classList.add("hidden");
      empty.classList.remove("hidden");
      return;
    }

    let cache = data[TAXONOMY_STORAGE];
    if (!cache || typeof cache !== "object") cache = { pieces: {}, details: {} };
    if (!cache.pieces || typeof cache.pieces !== "object") cache.pieces = {};
    if (!cache.details || typeof cache.details !== "object") cache.details = {};

    const missP = Object.keys(pieceRaw).filter(
      (k) => !Object.prototype.hasOwnProperty.call(cache.pieces, k)
    );
    const missD = Object.keys(detailRaw).filter(
      (k) => !Object.prototype.hasOwnProperty.call(cache.details, k)
    );

    if (missP.length > 0 || missD.length > 0) {
      showTaxonomyLoading();
      let resp;
      try {
        resp = await sendTaxonomy(missP, missD);
      } finally {
        hideTaxonomyLoading();
      }
      if (resp.ok && resp.pieceMap && resp.detailMap) {
        Object.assign(cache.pieces, resp.pieceMap);
        Object.assign(cache.details, resp.detailMap);
      }
      let filledLocal = false;
      for (const k of missP) {
        if (!cache.pieces[k]) {
          cache.pieces[k] = fallbackPieceCategory(k);
          filledLocal = true;
        }
      }
      for (const k of missD) {
        if (!cache.details[k]) {
          cache.details[k] = fallbackDetailCategory(k);
          filledLocal = true;
        }
      }
      await storageSet({ [TAXONOMY_STORAGE]: cache });
      if (!resp.ok && (missP.length || missD.length)) {
        taxStatus.textContent =
          "Grouped with on-device rules (Gemini unavailable).";
        window.setTimeout(() => {
          taxStatus.textContent = "";
        }, 5000);
      } else if (filledLocal && resp.ok) {
        taxStatus.textContent =
          "Some labels grouped on-device (Gemini skipped a few).";
        window.setTimeout(() => {
          taxStatus.textContent = "";
        }, 4000);
      } else {
        taxStatus.textContent = "";
      }
    } else {
      taxStatus.textContent = "";
    }

    const pieceGrouped = rollupToGroups(pieceRaw, cache.pieces);
    const detailGrouped = rollupToGroups(detailRaw, cache.details);

    summaryEl.textContent = buildSummary(
      pieceGrouped,
      detailGrouped,
      sorted.length
    );

    renderBarsOrdered(
      el("dash-regions-chart"),
      pieceGrouped,
      PIECE_ORDER,
      "No pieces logged yet."
    );
    renderBarsOrdered(
      el("dash-tags-chart"),
      detailGrouped,
      DETAIL_ORDER,
      "No details logged yet."
    );

    const recent = el("dash-recent");
    const empty = el("dash-recent-empty");
    recent.classList.remove("hidden");
    empty.classList.add("hidden");
    renderRecent(recent, sorted);
  }

  el("dash-clear").addEventListener("click", () => {
    el("dash-clear-confirm").classList.remove("hidden");
  });

  el("dash-clear-cancel").addEventListener("click", () => {
    el("dash-clear-confirm").classList.add("hidden");
  });

  el("dash-clear-yes").addEventListener("click", () => {
    chrome.storage.local.set(
      {
        [STORAGE_KEY]: [],
        [TAXONOMY_STORAGE]: { pieces: {}, details: {} },
      },
      () => {
        el("dash-clear-confirm").classList.add("hidden");
        render();
      }
    );
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEY] || changes[TAXONOMY_STORAGE]) render();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void render();
    });
  } else {
    void render();
  }
})();
