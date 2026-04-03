(function () {
  "use strict";

  const STORAGE_LOGS = "linger_logs";
  const STORAGE_DISMISSALS = "linger_intervention_dismissals";
  const SESSION_DISMISSED = "linger_intervention_dismissed";
  const SHOW_DELAY_MS = 1500;
  const MIN_LOGS = 5;
  const THRESHOLD_PCT = 20;

  /** kg CO₂e order-of-magnitude for new item lifecycle (varies widely by brand/material). */
  const ENV_ESTIMATE = {
    tops: { co2: "7–15" },
    bottoms: { co2: "20–35" },
    shoes: { co2: "12–25" },
    accessories: { co2: "5–14" },
  };

  /** Typical new fast-fashion price midpoints (USD) when page price missing. */
  const FALLBACK_RETAIL_USD = {
    tops: 38,
    bottoms: 58,
    shoes: 88,
    accessories: 42,
  };

  const CATEGORY_MAP = {
    tops: [
      "t-shirt",
      "tshirt",
      "sweatshirt",
      "knitwear",
      "cardigan",
      "hoodie",
      "sweater",
      "jumper",
      "blouse",
      "shirt",
      "tee",
      "top",
      "jacket",
      "coat",
      "blazer",
      "vest",
    ],
    bottoms: [
      "trousers",
      "jeans",
      "pants",
      "shorts",
      "skirt",
      "leggings",
      "denim",
    ],
    shoes: [
      "sneakers",
      "trainers",
      "sandals",
      "loafers",
      "mules",
      "flats",
      "boots",
      "heels",
      "shoes",
    ],
    accessories: [
      "handbag",
      "jewellery",
      "jewelry",
      "sunglasses",
      "scarf",
      "belt",
      "watch",
      "bag",
      "hat",
    ],
  };

  const REGION_LABEL = {
    tops: "tops",
    bottoms: "bottoms",
    shoes: "shoes",
    accessories: "accessories",
  };

  const KEYWORD_REGION = [];
  Object.keys(CATEGORY_MAP).forEach((region) => {
    CATEGORY_MAP[region].forEach((kw) => {
      KEYWORD_REGION.push({ kw: kw.toLowerCase(), region });
    });
  });
  KEYWORD_REGION.sort((a, b) => b.kw.length - a.kw.length);

  function keywordMatches(textLower, kw) {
    if (kw.includes("-") || kw.includes(" ")) {
      return textLower.includes(kw);
    }
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("\\b" + esc + "\\b", "i").test(textLower);
  }

  function collectPageText() {
    const parts = [];
    try {
      if (document.title) parts.push(document.title);
      const h1 = document.querySelector("h1");
      if (h1 && h1.textContent) parts.push(h1.textContent);
      parts.push(decodeURIComponent(location.pathname).replace(/[/\-_]+/g, " "));
      const crumbSelectors = [
        'nav[aria-label*="breadcrumb" i]',
        '[aria-label="breadcrumb"]',
        '[class*="breadcrumb" i]',
        '[class*="Breadcrumb" i]',
      ];
      const seen = new Set();
      crumbSelectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          if (seen.has(el)) return;
          seen.add(el);
          el.querySelectorAll("a, span").forEach((n) => {
            const t = (n.textContent || "").trim();
            if (t && t.length < 80) parts.push(t);
          });
        });
      });
    } catch (_) {
      /* ignore */
    }
    return parts.join(" ").toLowerCase();
  }

  function detectProductRegion() {
    const text = collectPageText();
    if (!text.trim()) return null;
    for (const { kw, region } of KEYWORD_REGION) {
      if (keywordMatches(text, kw)) return region;
    }
    return null;
  }

  function normalizeLogRegion(r) {
    if (!r || typeof r !== "string") return null;
    const k = r.toLowerCase().trim();
    if (k === "top" || k === "tops") return "tops";
    if (k === "bottoms") return "bottoms";
    if (k === "shoes") return "shoes";
    if (k === "accessories") return "accessories";
    return null;
  }

  function getTasteProfile(logs) {
    const counts = { tops: 0, bottoms: 0, shoes: 0, accessories: 0 };
    logs.forEach((log) => {
      const regs = Array.isArray(log.regions) ? log.regions : [];
      regs.forEach((r) => {
        const key = normalizeLogRegion(r);
        if (key && counts[key] !== undefined) counts[key]++;
      });
    });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const percentages = {};
    Object.keys(counts).forEach((k) => {
      percentages[k] = total > 0 ? Math.round((counts[k] / total) * 100) : 0;
    });
    return { counts, percentages, total };
  }

  function topRegionsByPercentage(percentages, exclude) {
    return Object.entries(percentages)
      .filter(([k]) => k !== exclude)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
  }

  function buildInsight(percentages, currentRegion) {
    const pct = percentages[currentRegion] ?? 0;
    const others = topRegionsByPercentage(percentages, currentRegion);
    const names = others
      .slice(0, 2)
      .map((k) => REGION_LABEL[k] || k)
      .filter(Boolean);
    const label = REGION_LABEL[currentRegion] || currentRegion;
    if (names.length === 0) {
      return `Only ${pct}% of your Pinterest saves are for ${label}.`;
    }
    const mostly =
      names.length === 2 ? `${names[0]} and ${names[1]}` : names[0];
    return `Only ${pct}% of your Pinterest saves are for ${label} — you mostly save for ${mostly}.`;
  }

  function getTopTasteRegion(percentages) {
    const entries = Object.entries(percentages).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    });
    return entries[0] ? entries[0][0] : null;
  }

  function buildNudge(productRegion, topTasteRegion) {
    if (productRegion === "tops") {
      if (topTasteRegion === "bottoms") {
        return "Your eye is really on the silhouette and the cut. Will this top make it into outfits you'd actually wear?";
      }
      if (topTasteRegion === "shoes") {
        return "You tend to build outfits from the shoe up. Does this top fit that?";
      }
      if (topTasteRegion === "accessories") {
        return "Accessories drive your saves more than anything. Is this piece filling a real gap?";
      }
    }
    return "You've saved this category less than any other. Worth a pause before adding to cart.";
  }

  function extractRetailPriceAndCurrency() {
    let price = null;
    let currency = "USD";

    function trySet(n, cur) {
      if (!Number.isFinite(n) || n <= 0 || n > 250000) return;
      price = n;
      if (cur && typeof cur === "string" && cur.length === 3) currency = cur.toUpperCase();
    }

    try {
      const metas = document.querySelectorAll(
        'meta[property="og:price:amount"], meta[property="product:price:amount"], meta[itemprop="price"]'
      );
      metas.forEach((m) => {
        const c = m.getAttribute("content");
        if (c) trySet(parseFloat(String(c).replace(/[^\d.]/g, "")), null);
      });
      const curMeta = document.querySelector(
        'meta[property="product:price:currency"], meta[itemprop="priceCurrency"]'
      );
      if (curMeta && curMeta.getAttribute("content"))
        currency = curMeta.getAttribute("content").toUpperCase();

      document
        .querySelectorAll('script[type="application/ld+json"]')
        .forEach((s) => {
          try {
            const j = JSON.parse(s.textContent || "{}");
            const list = Array.isArray(j) ? j : [j];
            list.forEach((node) => {
              if (!node || typeof node !== "object") return;
              const types = [].concat(node["@type"] || []);
              if (
                types.includes("Product") ||
                (typeof node["@type"] === "string" &&
                  String(node["@type"]).includes("Product"))
              ) {
                const offers = node.offers;
                const off = Array.isArray(offers) ? offers[0] : offers;
                if (off && off.price != null) {
                  trySet(
                    parseFloat(String(off.price).replace(/[^\d.]/g, "")),
                    off.priceCurrency
                  );
                }
              }
            });
          } catch (_) {
            /* ignore */
          }
        });

      const ip = document.querySelector(
        '[itemprop="price"][content], [itemprop="price"]'
      );
      if (ip) {
        const c = ip.getAttribute("content") || ip.textContent;
        if (c) trySet(parseFloat(String(c).replace(/[^\d.]/g, "")), null);
      }
    } catch (_) {
      /* ignore */
    }

    return { price, currency };
  }

  function formatMoney(amount, currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
        maximumFractionDigits: 0,
      }).format(amount);
    } catch (_) {
      return "$" + Math.round(amount);
    }
  }

  function buildEnvironmentalCopy(productRegion) {
    const e = ENV_ESTIMATE[productRegion] || ENV_ESTIMATE.tops;
    return (
      "Rough footprint ballpark: manufacturing & shipping a **new** item like this is often on the order of **" +
      e.co2 +
      " kg CO₂e** (varies by fabric, brand, and country). Buying **secondhand** skips most of that production — a real emissions cut, even if we can’t know the exact grams."
    );
  }

  function buildThriftSavingsCopy(productRegion) {
    const { price, currency } = extractRetailPriceAndCurrency();
    const ref =
      price != null && price > 0
        ? price
        : FALLBACK_RETAIL_USD[productRegion] || 45;
    const usedLow = Math.round(ref * 0.26);
    const usedHigh = Math.round(ref * 0.48);
    const saveIfLow = Math.max(0, Math.round(ref - usedHigh));
    const saveIfHigh = Math.max(0, Math.round(ref - usedLow));
    const fmt = (n) => formatMoney(n, currency);

    if (price != null && price > 0) {
      return {
        title: "Thrift / resale vs this listing",
        p1:
          "Similar pieces often show up at charity shops or thrift stores for about **" +
          fmt(usedLow) +
          "–" +
          fmt(usedHigh) +
          "** (very rough — depends on brand, city, and luck).",
        p2:
          "If you found one like that instead of paying **" +
          fmt(ref) +
          "** here, you could keep roughly **" +
          fmt(saveIfLow) +
          "–" +
          fmt(saveIfHigh) +
          "** in your pocket.",
      };
    }
    const cat = REGION_LABEL[productRegion] || "item";
    return {
      title: "Typical secondhand range",
      p1:
        "We couldn’t read this page’s price, but **" +
        cat +
        "** like this often resell secondhand around **" +
        fmt(usedLow) +
        "–" +
        fmt(usedHigh) +
        "** in many cities (USD-style ballpark).",
      p2:
        "Compared to buying **new** at a typical fast-fashion price (~" +
        fmt(ref) +
        "), that’s often **" +
        fmt(saveIfLow) +
        "–" +
        fmt(saveIfHigh) +
        "** less if the thrift gods smile.",
    };
  }

  function productSearchQuery() {
    const h1 = document.querySelector("h1");
    const fromH1 = h1 && (h1.textContent || "").trim();
    if (fromH1 && fromH1.length > 1 && fromH1.length < 200) return fromH1;
    let t = (document.title || "").replace(/\s*[|\-–—].*$/, "").trim();
    return t.slice(0, 120) || "fashion";
  }

  function logInterventionDismissed(region) {
    try {
      chrome.storage.local.get([STORAGE_DISMISSALS], (data) => {
        try {
          if (chrome.runtime && chrome.runtime.lastError) return;
          const arr = Array.isArray(data[STORAGE_DISMISSALS])
            ? data[STORAGE_DISMISSALS]
            : [];
          arr.push({
            type: "intervention_dismissed",
            timestamp: new Date().toISOString(),
            region,
            site: location.hostname,
          });
          chrome.storage.local.set({ [STORAGE_DISMISSALS]: arr });
        } catch (_) {
          /* silent */
        }
      });
    } catch (_) {
      /* silent */
    }
  }

  function dismissCard(root, region, logEvent) {
    sessionStorage.setItem(SESSION_DISMISSED, "1");
    if (logEvent) logInterventionDismissed(region || "unknown");
    if (root && root.parentNode) root.parentNode.removeChild(root);
  }

  function appendFormattedLine(container, text) {
    const re = /\*\*([^*]+)\*\*/g;
    let last = 0;
    let matched = false;
    let m;
    while ((m = re.exec(text)) !== null) {
      matched = true;
      if (m.index > last) {
        container.appendChild(document.createTextNode(text.slice(last, m.index)));
      }
      const s = document.createElement("strong");
      s.textContent = m[1];
      container.appendChild(s);
      last = m.lastIndex;
    }
    if (matched && last < text.length) {
      container.appendChild(document.createTextNode(text.slice(last)));
    }
    if (!matched) {
      container.appendChild(document.createTextNode(text));
    }
  }

  function renderBarChart(container, percentages) {
    const order = ["tops", "bottoms", "shoes", "accessories"];
    const max = Math.max(...order.map((k) => percentages[k] || 0), 1);
    order.forEach((k) => {
      const pct = percentages[k] || 0;
      const row = document.createElement("div");
      row.className = "linger-shop-bar-row";
      const lab = document.createElement("div");
      lab.className = "linger-shop-bar-label";
      lab.textContent = REGION_LABEL[k] || k;
      const track = document.createElement("div");
      track.className = "linger-shop-bar-track";
      const fill = document.createElement("div");
      fill.className = "linger-shop-bar-fill";
      fill.style.width = Math.round((pct / max) * 100) + "%";
      track.appendChild(fill);
      const num = document.createElement("div");
      num.className = "linger-shop-bar-pct";
      num.textContent = pct + "%";
      row.appendChild(lab);
      row.appendChild(track);
      row.appendChild(num);
      container.appendChild(row);
    });
  }

  function showIntervention(productRegion, percentages, showTasteMismatch) {
    const root = document.createElement("div");
    root.className = "linger-shop-root";
    root.setAttribute("data-linger-shopping", "true");

    const card = document.createElement("div");
    card.className = "linger-shop-card";

    const head = document.createElement("div");
    head.className = "linger-shop-head";
    const brand = document.createElement("div");
    brand.className = "linger-shop-brand";
    const dot = document.createElement("span");
    dot.className = "linger-shop-dot";
    dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "linger-shop-name";
    name.textContent = "Linger";
    brand.appendChild(dot);
    brand.appendChild(name);
    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "linger-shop-dismiss";
    dismissBtn.setAttribute("aria-label", "Dismiss");
    dismissBtn.textContent = "×";
    dismissBtn.addEventListener("click", () =>
      dismissCard(root, productRegion, true)
    );
    head.appendChild(brand);
    head.appendChild(dismissBtn);

    const impact = document.createElement("div");
    impact.className = "linger-shop-impact";
    appendFormattedLine(impact, buildEnvironmentalCopy(productRegion));

    const thrift = document.createElement("div");
    thrift.className = "linger-shop-savings";
    const thriftCopy = buildThriftSavingsCopy(productRegion);
    const thriftTitle = document.createElement("div");
    thriftTitle.className = "linger-shop-savings-title";
    thriftTitle.textContent = thriftCopy.title;
    thrift.appendChild(thriftTitle);
    const p1 = document.createElement("p");
    p1.style.margin = "0 0 6px";
    appendFormattedLine(p1, thriftCopy.p1);
    thrift.appendChild(p1);
    const p2 = document.createElement("p");
    p2.style.margin = "0";
    appendFormattedLine(p2, thriftCopy.p2);
    thrift.appendChild(p2);

    const footnote = document.createElement("p");
    footnote.className = "linger-shop-footnote";
    footnote.textContent =
      "Ballpark figures only — not carbon accounting or financial advice. Thrift prices vary by city, store, and luck.";

    const actions = document.createElement("div");
    actions.className = "linger-shop-actions";

    const btnWant = document.createElement("button");
    btnWant.type = "button";
    btnWant.className = "linger-shop-btn linger-shop-btn--primary";
    btnWant.textContent = "I still want it";
    btnWant.addEventListener("click", () =>
      dismissCard(root, productRegion, true)
    );

    const depopUrl =
      "https://www.depop.com/search/?q=" +
      encodeURIComponent(productSearchQuery());
    const btnDepop = document.createElement("a");
    btnDepop.className = "linger-shop-btn linger-shop-btn--secondary";
    btnDepop.href = depopUrl;
    btnDepop.target = "_blank";
    btnDepop.rel = "noopener noreferrer";
    btnDepop.textContent = "Find it secondhand →";

    actions.appendChild(btnWant);
    actions.appendChild(btnDepop);

    card.appendChild(head);
    card.appendChild(impact);
    card.appendChild(thrift);
    card.appendChild(footnote);

    if (showTasteMismatch) {
      const topTaste = getTopTasteRegion(percentages);
      const nudgeFinal = buildNudge(productRegion, topTaste);

      const div = document.createElement("div");
      div.className = "linger-shop-divider";

      const insight = document.createElement("p");
      insight.className = "linger-shop-insight";
      insight.textContent = buildInsight(percentages, productRegion);

      const nudgeEl = document.createElement("p");
      nudgeEl.className = "linger-shop-nudge";
      nudgeEl.textContent = nudgeFinal;

      const chartTitle = document.createElement("div");
      chartTitle.className = "linger-shop-chart-title";
      chartTitle.textContent = "Your Pinterest save mix";

      const chart = document.createElement("div");
      chart.className = "linger-shop-chart";
      renderBarChart(chart, percentages);

      card.appendChild(div);
      card.appendChild(insight);
      card.appendChild(nudgeEl);
      card.appendChild(chartTitle);
      card.appendChild(chart);
    }

    card.appendChild(actions);
    root.appendChild(card);
    document.documentElement.appendChild(root);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        card.classList.add("linger-shop-card--in");
      });
    });
  }

  function boot() {
    try {
      if (sessionStorage.getItem(SESSION_DISMISSED) === "1") return;
      if (/pinterest\.com$/i.test(location.hostname.replace(/^www\./, "")))
        return;

      const productRegion = detectProductRegion();
      if (!productRegion) return;

      chrome.storage.local.get([STORAGE_LOGS], (data) => {
        try {
          if (chrome.runtime && chrome.runtime.lastError) return;
          const logs = Array.isArray(data[STORAGE_LOGS]) ? data[STORAGE_LOGS] : [];
          const { percentages, total } = getTasteProfile(logs);
          const p = percentages[productRegion] ?? 0;
          const showTasteMismatch =
            logs.length >= MIN_LOGS &&
            total > 0 &&
            p < THRESHOLD_PCT;

          window.setTimeout(() => {
            try {
              if (sessionStorage.getItem(SESSION_DISMISSED) === "1") return;
              showIntervention(productRegion, percentages, showTasteMismatch);
            } catch (_) {
              /* silent */
            }
          }, SHOW_DELAY_MS);
        } catch (_) {
          /* silent */
        }
      });
    } catch (_) {
      /* silent */
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
