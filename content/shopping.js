(function () {
  "use strict";

  const STORAGE_LOGS = "linger_logs";
  const STORAGE_DISMISSALS = "linger_intervention_dismissals";
  const SESSION_DISMISSED = "linger_intervention_dismissed";
  const SHOW_DELAY_MS = 1500;

  /**
   * kg CO₂e ballpark for new item (manufacturing + shipping).
   * co2 = display range; midKg = midpoint for metaphors (not exact science).
   */
  const ENV_ESTIMATE = {
    tops: { co2: "7–15", midKg: 11 },
    bottoms: { co2: "20–35", midKg: 28 },
    shoes: { co2: "12–25", midKg: 19 },
    accessories: { co2: "5–14", midKg: 10 },
  };

  const METAPHOR_ROTATE_KEY = "linger_carbon_metaphor_idx";

  function nextMetaphorIndex(len) {
    let v = parseInt(sessionStorage.getItem(METAPHOR_ROTATE_KEY) || "0", 10);
    if (!Number.isFinite(v)) v = 0;
    const idx = ((v % len) + len) % len;
    sessionStorage.setItem(METAPHOR_ROTATE_KEY, String(v + 1));
    return idx;
  }

  function buildMetaphorTrees(midKg) {
    const n = Math.max(1, Math.round(midKg / 22));
    const p = document.createElement("p");
    p.className = "linger-shop-impact-metaphor";
    p.appendChild(document.createTextNode("You\u2019d need to plant about "));
    const s = document.createElement("strong");
    s.textContent = String(n);
    p.appendChild(s);
    p.appendChild(
      document.createTextNode(
        n === 1
          ? " tree and let it grow about a year to soak up that much CO\u2082."
          : " trees and let them grow about a year to soak up that much CO\u2082."
      )
    );
    return p;
  }

  function buildMetaphorDriving(midKg) {
    const km = Math.max(1, Math.round(midKg / 0.13));
    const mi = Math.max(1, Math.round(km * 0.621));
    const p = document.createElement("p");
    p.className = "linger-shop-impact-metaphor";
    p.appendChild(document.createTextNode("That\u2019s about the same as driving "));
    const s = document.createElement("strong");
    s.textContent = mi + " mi";
    p.appendChild(s);
    p.appendChild(document.createTextNode(" ("));
    const s2 = document.createElement("strong");
    s2.textContent = km + " km";
    p.appendChild(s2);
    p.appendChild(
      document.createTextNode(") in an average passenger car.")
    );
    return p;
  }

  function buildMetaphorKettle(midKg) {
    const boils = Math.max(1, Math.round(midKg / 0.048));
    const p = document.createElement("p");
    p.className = "linger-shop-impact-metaphor";
    p.appendChild(document.createTextNode("About as much grid electricity as boiling a full kettle "));
    const s = document.createElement("strong");
    s.textContent = String(boils);
    p.appendChild(s);
    p.appendChild(
      document.createTextNode(
        boils === 1 ? " time from cold." : " times from cold."
      )
    );
    return p;
  }

  function buildMetaphorBulb(midKg) {
    const kwh = midKg / 0.38;
    const hours10w = kwh / 0.01;
    const days = Math.max(1, Math.round(hours10w / 24));
    const p = document.createElement("p");
    p.className = "linger-shop-impact-metaphor";
    p.appendChild(document.createTextNode("Like leaving a 10W LED bulb on "));
    const s = document.createElement("strong");
    s.textContent = "about " + days + " day" + (days === 1 ? "" : "s");
    p.appendChild(s);
    p.appendChild(
      document.createTextNode(" straight on a typical grid.")
    );
    return p;
  }

  const CARBON_METAPHORS = [
    buildMetaphorTrees,
    buildMetaphorDriving,
    buildMetaphorKettle,
    buildMetaphorBulb,
  ];

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

  function hasLikelyProductPage() {
    const og = document.querySelector('meta[property="og:type"]');
    if (og && /product/i.test(og.getAttribute("content") || "")) return true;
    try {
      for (const s of document.querySelectorAll(
        'script[type="application/ld+json"]'
      )) {
        const j = JSON.parse(s.textContent || "{}");
        const list = Array.isArray(j) ? j : [j];
        for (const node of list) {
          if (!node || typeof node !== "object") continue;
          const types = [].concat(node["@type"] || []);
          for (const t of types) {
            if (String(t).toLowerCase().includes("product")) return true;
          }
        }
      }
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  function getProductTitle() {
    const og = document.querySelector('meta[property="og:title"]');
    if (og) {
      const c = (og.getAttribute("content") || "").trim();
      if (c.length > 2 && c.length < 300) return c;
    }
    const h1 = document.querySelector("h1");
    if (h1) {
      const t = (h1.textContent || "").trim().replace(/\s+/g, " ");
      if (t.length > 1 && t.length < 280) return t;
    }
    return (
      (document.title || "").replace(/\s*[|\-–—].*$/, "").trim().slice(0, 200) ||
      "Product"
    );
  }

  function getProductDescriptionText() {
    const parts = [];
    const addMeta = (sel) => {
      const m = document.querySelector(sel);
      const c = m && (m.getAttribute("content") || "").trim();
      if (c && c.length > 20) parts.push(c);
    };
    addMeta('meta[property="og:description"]');
    addMeta('meta[name="description"]');
    addMeta('meta[property="product:description"]');
    const desc = document.querySelector(
      '[itemprop="description"], .product-description, [data-product-description], #product-description'
    );
    if (desc) {
      const t = (desc.textContent || "").trim().replace(/\s+/g, " ");
      if (t.length > 20) parts.push(t.slice(0, 2500));
    }
    return parts.join("\n\n").slice(0, 5000);
  }

  function pickPrimaryProductImageUrl() {
    const og = document.querySelector(
      'meta[property="og:image"], meta[property="og:image:url"]'
    );
    if (og) {
      const u = og.getAttribute("content");
      if (u && /^https?:/i.test(u)) return u;
    }
    const tw = document.querySelector('meta[name="twitter:image"]');
    if (tw) {
      const u = tw.getAttribute("content");
      if (u && /^https?:/i.test(u)) return u;
    }
    try {
      for (const s of document.querySelectorAll(
        'script[type="application/ld+json"]'
      )) {
        const j = JSON.parse(s.textContent || "{}");
        const list = Array.isArray(j) ? j : [j];
        for (const node of list) {
          if (!node || typeof node !== "object") continue;
          const types = [].concat(node["@type"] || []);
          if (!types.some((t) => String(t).toLowerCase().includes("product")))
            continue;
          const img = node.image;
          const url = Array.isArray(img)
            ? img[0]
            : typeof img === "object" && img
              ? img.url
              : img;
          if (typeof url === "string" && /^https?:/i.test(url)) return url;
        }
      }
    } catch (_) {
      /* ignore */
    }
    const prop = document.querySelector(
      'img[itemprop="image"], img[data-main-image], .product-single__photo img, .product__media img'
    );
    if (prop && prop.src) return prop.currentSrc || prop.src;
    const main = document.querySelector("main img[src], article img[src]");
    if (
      main &&
      main.src &&
      !/sprite|icon|logo|pixel|1x1/i.test(main.src)
    ) {
      return main.currentSrc || main.src;
    }
    return null;
  }

  async function captureUrlToJpegDataUrl(imageUrl, maxSide) {
    if (!imageUrl) return null;
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            const scale = Math.min(
              maxSide / img.width,
              maxSide / img.height,
              1
            );
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              resolve(null);
              return;
            }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 0.85));
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

  function formatNumberedSnippets(logs) {
    const lines = [];
    let n = 1;
    const sorted = [...logs].sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );
    outer: for (const log of sorted.slice(0, 60)) {
      if (Array.isArray(log.items) && log.items.length) {
        for (const it of log.items) {
          if (n > 85) break outer;
          const bits = [];
          if (it.label) bits.push(it.label);
          if (Array.isArray(it.attributes) && it.attributes.length)
            bits.push(it.attributes.join(", "));
          if (it.note) bits.push(it.note);
          if (bits.length) {
            lines.push(n + ". " + bits.join(" | "));
            n++;
          }
        }
      } else {
        const r = (log.regions || []).join(", ");
        const t = (log.tags || []).join(", ");
        if (r || t) {
          lines.push(
            n + ". regions: " + (r || "—") + " | tags: " + (t || "—")
          );
          n++;
          if (n > 85) break;
        }
      }
    }
    return { text: lines.join("\n"), lineCount: Math.max(0, n - 1) };
  }

  function sendShopEchoMessage(payload) {
    return new Promise((resolve) => {
      try {
        if (!chrome.runtime || !chrome.runtime.id) {
          resolve({ ok: false, error: "Extension context invalidated" });
          return;
        }
        chrome.runtime.sendMessage(payload, (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              ok: false,
              error: chrome.runtime.lastError.message,
            });
            return;
          }
          resolve(response || { ok: false, error: "No response" });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e.message || e) });
      }
    });
  }

  async function runShopEchoPipeline(root, logs) {
    const slot = root._lingerEchoSlot;
    if (!slot) return;

    const { text: numberedSnippets, lineCount: maxSnippetLine } =
      formatNumberedSnippets(logs);
    const title = getProductTitle();
    const desc = getProductDescriptionText();
    const imgUrl = pickPrimaryProductImageUrl();
    let imageBase64 = null;
    let thumbDataUrl = null;
    const mimeType = "image/jpeg";
    if (imgUrl) {
      thumbDataUrl = await captureUrlToJpegDataUrl(imgUrl, 200);
      const hi = await captureUrlToJpegDataUrl(imgUrl, 896);
      if (hi) {
        const comma = hi.indexOf(",");
        imageBase64 = comma >= 0 ? hi.slice(comma + 1) : hi;
      }
    }

    const res = await sendShopEchoMessage({
      type: "LINGER_GEMINI_SHOP_ECHO",
      imageBase64: imageBase64 || "",
      mimeType,
      productTitle: title,
      productDescription: desc,
      numberedSnippets,
      maxSnippetLine,
    });

    if (!slot.parentNode) return;
    fillEchoSlot(slot, res, thumbDataUrl, logs.length);
  }

  function fillEchoSlot(slot, res, thumbDataUrl, logLen) {
    slot.innerHTML = "";
    slot.classList.remove("linger-shop-echo--loading");
    if (!res.ok) {
      const err = document.createElement("p");
      err.className = "linger-shop-echo-fallback";
      err.textContent =
        logLen === 0
          ? "Save pins with Linger on Pinterest to see how this piece echoes your taste."
          : "We couldn't run the AI match right now. Your saves are still in Linger when you're back.";
      slot.appendChild(err);
      return;
    }

    const row = document.createElement("div");
    row.className = "linger-shop-echo-top";
    if (thumbDataUrl) {
      const th = document.createElement("div");
      th.className = "linger-shop-echo-thumb";
      const im = document.createElement("img");
      im.src = thumbDataUrl;
      im.alt = "";
      th.appendChild(im);
      row.appendChild(th);
    }
    const copy = document.createElement("div");
    copy.className = "linger-shop-echo-copy";
    if (res.product_blurb) {
      const bl = document.createElement("p");
      bl.className = "linger-shop-echo-blurb";
      bl.textContent = res.product_blurb;
      copy.appendChild(bl);
    }
    row.appendChild(copy);
    slot.appendChild(row);

    const echoes = Array.isArray(res.echoes) ? res.echoes : [];
    if (echoes.length === 0) {
      const empty = document.createElement("p");
      empty.className = "linger-shop-echo-empty";
      empty.textContent =
        logLen === 0
          ? "No Pinterest saves logged yet — this spot will compare future saves to pieces like this."
          : "No strong overlap with your logged taste yet — worth noticing how this feels new or familiar.";
      slot.appendChild(empty);
      return;
    }
    const ul = document.createElement("ul");
    ul.className = "linger-shop-echo-list";
    echoes.forEach((e) => {
      const li = document.createElement("li");
      li.textContent = e.phrase || "";
      ul.appendChild(li);
    });
    slot.appendChild(ul);
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

  function inferRegionFromItemLabel(label) {
    if (!label || typeof label !== "string") return null;
    const s = label.toLowerCase();
    const shoeKw =
      /\b(boot|boots|heel|heels|sneaker|sneakers|loafer|loafers|oxford|oxfords|sandal|sandals|mule|mules|flat|flats|footwear|trainer|trainers|pump|pumps|clog|clogs|slide|slides|espadrille)\b/;
    const accKw =
      /\b(bag|bags|tote|clutch|earring|earrings|necklace|necklaces|bracelet|bracelets|ring|rings|belt|belts|hat|hats|scarf|scarves|watch|watches|sunglass|sunglasses|wallet|wallets|headband|hair\s+clip|brooch)\b/;
    const bottomKw =
      /\b(jean|jeans|trouser|trousers|pant|pants|skirt|skirts|short|shorts|legging|leggings|jogger|joggers|culotte)\b/;
    const topKw =
      /\b(shirt|shirts|top|tops|blouse|blouses|tee|tees|t-shirt|sweater|sweaters|cardigan|cardigans|jacket|jackets|coat|coats|blazer|blazers|hoodie|hoodies|crop|crops|tank|tanks|bodysuit|bodysuits|knit|knits|polo|henley)\b/;
    if (shoeKw.test(s)) return "shoes";
    if (accKw.test(s)) return "accessories";
    if (bottomKw.test(s)) return "bottoms";
    if (topKw.test(s)) return "tops";
    return null;
  }

  function getTasteProfile(logs) {
    const counts = { tops: 0, bottoms: 0, shoes: 0, accessories: 0 };
    logs.forEach((log) => {
      const regs = Array.isArray(log.regions) ? log.regions : [];
      if (regs.length) {
        regs.forEach((r) => {
          const key = normalizeLogRegion(r);
          if (key && counts[key] !== undefined) counts[key]++;
        });
        return;
      }
      const items = Array.isArray(log.items) ? log.items : [];
      items.forEach((it) => {
        const key = inferRegionFromItemLabel(it && it.label);
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

  function appendEnvironmentalImpact(container, productRegion) {
    const e = ENV_ESTIMATE[productRegion] || ENV_ESTIMATE.tops;
    const midKg = e.midKg != null ? e.midKg : 11;
    const midRounded = Math.round(midKg);

    const title = document.createElement("div");
    title.className = "linger-shop-impact-title";
    title.textContent = "Carbon footprint (ballpark)";

    const numWrap = document.createElement("div");
    numWrap.className = "linger-shop-impact-number";
    numWrap.appendChild(document.createTextNode("~"));
    const numStrong = document.createElement("strong");
    numStrong.textContent = String(midRounded);
    numWrap.appendChild(numStrong);
    numWrap.appendChild(document.createTextNode(" kg CO\u2082e"));

    const range = document.createElement("div");
    range.className = "linger-shop-impact-range";
    range.textContent =
      "Typical range for one new item like this: " +
      e.co2 +
      " kg (making + shipping). Buying secondhand avoids most of that.";

    const idx = nextMetaphorIndex(CARBON_METAPHORS.length);
    const metaphorEl = CARBON_METAPHORS[idx](midKg);

    container.appendChild(title);
    container.appendChild(numWrap);
    container.appendChild(range);
    container.appendChild(metaphorEl);
  }

  function appendThriftSavings(container, productRegion) {
    const { price, currency } = extractRetailPriceAndCurrency();
    const hasPrice = price != null && price > 0;
    const ref = hasPrice ? price : FALLBACK_RETAIL_USD[productRegion] || 45;
    const usedLow = Math.round(ref * 0.26);
    const usedHigh = Math.round(ref * 0.48);
    const saveIfLow = Math.max(0, Math.round(ref - usedHigh));
    const saveIfHigh = Math.max(0, Math.round(ref - usedLow));
    const fmt = (n) => formatMoney(n, currency);

    const title = document.createElement("div");
    title.className = "linger-shop-savings-title";
    title.textContent = hasPrice
      ? "Thrift / resale vs this listing"
      : "Typical secondhand range";
    container.appendChild(title);

    if (hasPrice) {
      const listingRow = document.createElement("div");
      listingRow.className = "linger-shop-savings-listing";
      listingRow.appendChild(document.createTextNode("This listing: "));
      const listStrong = document.createElement("strong");
      listStrong.textContent = fmt(ref);
      listingRow.appendChild(listStrong);
      container.appendChild(listingRow);
    }

    const bandLab = document.createElement("div");
    bandLab.className = "linger-shop-savings-muted";
    bandLab.textContent = hasPrice
      ? "Similar pieces often show up for about:"
      : "We couldn\u2019t read this page\u2019s price. Ballpark secondhand band:";

    const bandNum = document.createElement("div");
    bandNum.className = "linger-shop-savings-highlight";
    bandNum.textContent = fmt(usedLow) + " \u2013 " + fmt(usedHigh);

    const saveLab = document.createElement("div");
    saveLab.className = "linger-shop-savings-muted";
    saveLab.style.marginTop = "10px";
    saveLab.textContent = hasPrice
      ? "You could keep about:"
      : "Versus typical new for this type (~" + fmt(ref) + "), you might save about:";

    const saveNum = document.createElement("div");
    saveNum.className = "linger-shop-savings-savehero";
    const saveStrong = document.createElement("strong");
    saveStrong.textContent = fmt(saveIfLow) + " \u2013 " + fmt(saveIfHigh);
    saveNum.appendChild(saveStrong);

    container.appendChild(bandLab);
    container.appendChild(bandNum);
    container.appendChild(saveLab);
    container.appendChild(saveNum);
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

  function showIntervention(productRegion, percentages) {
    const root = document.createElement("div");
    root.className = "linger-shop-root";
    root.setAttribute("data-linger-shopping", "true");

    const card = document.createElement("div");
    card.className = "linger-shop-card";

    const head = document.createElement("div");
    head.className = "linger-shop-head";
    const brand = document.createElement("div");
    brand.className = "linger-shop-brand";
    const word = document.createElement("img");
    word.className = "linger-shop-logo-word";
    word.src = chrome.runtime.getURL("icons/full-logo.svg");
    word.alt = "linger";
    brand.appendChild(word);
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

    const viewsShell = document.createElement("div");
    viewsShell.className = "linger-shop-views";
    const track = document.createElement("div");
    track.className = "linger-shop-views-track";

    const viewMain = document.createElement("div");
    viewMain.className = "linger-shop-view";
    viewMain.setAttribute("aria-hidden", "false");

    const echoSection = document.createElement("div");
    echoSection.className = "linger-shop-echo linger-shop-echo--loading";
    const echoLoading = document.createElement("p");
    echoLoading.className = "linger-shop-echo-loading";
    echoLoading.textContent =
      "Looking at this product and your Pinterest saves\u2026";
    echoSection.appendChild(echoLoading);
    root._lingerEchoSlot = echoSection;

    const impact = document.createElement("div");
    impact.className = "linger-shop-impact";
    appendEnvironmentalImpact(impact, productRegion);

    const thrift = document.createElement("div");
    thrift.className = "linger-shop-savings";
    appendThriftSavings(thrift, productRegion);

    const chartTitle = document.createElement("div");
    chartTitle.className = "linger-shop-chart-title";
    chartTitle.textContent = "Your Pinterest save mix";

    const chart = document.createElement("div");
    chart.className = "linger-shop-chart";
    renderBarChart(chart, percentages);

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

    const btnSecondhand = document.createElement("button");
    btnSecondhand.type = "button";
    btnSecondhand.className = "linger-shop-btn linger-shop-btn--secondary";
    btnSecondhand.textContent = "Find it secondhand →";

    actions.appendChild(btnWant);
    actions.appendChild(btnSecondhand);

    viewMain.appendChild(echoSection);
    viewMain.appendChild(impact);
    viewMain.appendChild(thrift);
    viewMain.appendChild(chartTitle);
    viewMain.appendChild(chart);
    viewMain.appendChild(footnote);
    viewMain.appendChild(actions);

    const searchQ = encodeURIComponent(productSearchQuery());

    const viewSecond = document.createElement("div");
    viewSecond.className = "linger-shop-view linger-shop-view--second";
    viewSecond.setAttribute("aria-hidden", "true");

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "linger-shop-back";
    backBtn.textContent = "\u2190 Back";

    const secondTitle = document.createElement("h2");
    secondTitle.className = "linger-shop-second-title";
    secondTitle.textContent = "Find it secondhand";

    const secondIntro = document.createElement("p");
    secondIntro.className = "linger-shop-second-intro";
    secondIntro.textContent =
      "Open a resale search, or look for thrift stores nearby.";

    function makeOutboundLink(label, href) {
      const a = document.createElement("a");
      a.className = "linger-shop-btn linger-shop-btn--secondary";
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = label;
      return a;
    }

    const secOnline = document.createElement("div");
    secOnline.className = "linger-shop-second-section";
    const labOnline = document.createElement("div");
    labOnline.className = "linger-shop-second-section-label";
    labOnline.textContent = "Marketplaces & apps";
    const onlineLinks = document.createElement("div");
    onlineLinks.className = "linger-shop-second-link-stack";
    onlineLinks.appendChild(
      makeOutboundLink(
        "Facebook Marketplace",
        "https://www.facebook.com/marketplace/search/?query=" + searchQ
      )
    );
    onlineLinks.appendChild(
      makeOutboundLink(
        "Depop",
        "https://www.depop.com/search/?q=" + searchQ
      )
    );
    onlineLinks.appendChild(
      makeOutboundLink(
        "eBay",
        "https://www.ebay.com/sch/i.html?_nkw=" + searchQ
      )
    );
    onlineLinks.appendChild(
      makeOutboundLink(
        "Vinted",
        "https://www.vinted.com/catalog?search_text=" + searchQ
      )
    );
    onlineLinks.appendChild(
      makeOutboundLink(
        "Poshmark",
        "https://poshmark.com/search?query=" + searchQ
      )
    );
    secOnline.appendChild(labOnline);
    secOnline.appendChild(onlineLinks);

    const secLocal = document.createElement("div");
    secLocal.className = "linger-shop-second-section";
    const labLocal = document.createElement("div");
    labLocal.className = "linger-shop-second-section-label";
    labLocal.textContent = "In person";
    const localLinks = document.createElement("div");
    localLinks.className = "linger-shop-second-link-stack";
    localLinks.appendChild(
      makeOutboundLink(
        "Local Thrift Stores",
        "https://www.google.com/maps/search/?api=1&query=" +
          encodeURIComponent("thrift stores near me")
      )
    );
    secLocal.appendChild(labLocal);
    secLocal.appendChild(localLinks);

    viewSecond.appendChild(backBtn);
    viewSecond.appendChild(secondTitle);
    viewSecond.appendChild(secondIntro);
    viewSecond.appendChild(secOnline);
    viewSecond.appendChild(secLocal);

    function syncShopViewsHeight() {
      const onSecond = track.classList.contains(
        "linger-shop-views-track--second"
      );
      const active = onSecond ? viewSecond : viewMain;
      const h = Math.max(1, Math.ceil(active.scrollHeight));
      track.style.height = h + "px";
      viewsShell.style.height = h + "px";
    }

    function goSecondhandPage(showSecond) {
      card.scrollTop = 0;
      if (showSecond) {
        track.classList.add("linger-shop-views-track--second");
        viewMain.setAttribute("aria-hidden", "true");
        viewSecond.setAttribute("aria-hidden", "false");
        if ("inert" in viewMain) viewMain.inert = true;
        if ("inert" in viewSecond) viewSecond.inert = false;
      } else {
        track.classList.remove("linger-shop-views-track--second");
        viewMain.setAttribute("aria-hidden", "false");
        viewSecond.setAttribute("aria-hidden", "true");
        if ("inert" in viewMain) viewMain.inert = false;
        if ("inert" in viewSecond) viewSecond.inert = true;
      }
      requestAnimationFrame(() => {
        syncShopViewsHeight();
        card.scrollTop = 0;
        requestAnimationFrame(() => {
          syncShopViewsHeight();
          card.scrollTop = 0;
        });
      });
    }

    if ("inert" in viewSecond) viewSecond.inert = true;

    btnSecondhand.addEventListener("click", () => goSecondhandPage(true));
    backBtn.addEventListener("click", () => goSecondhandPage(false));

    track.appendChild(viewMain);
    track.appendChild(viewSecond);
    viewsShell.appendChild(track);

    card.appendChild(head);
    card.appendChild(viewsShell);
    root.appendChild(card);
    document.documentElement.appendChild(root);

    const shopViewsResizeObserver = new ResizeObserver(() => {
      syncShopViewsHeight();
    });
    shopViewsResizeObserver.observe(viewMain);
    shopViewsResizeObserver.observe(viewSecond);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        syncShopViewsHeight();
        card.classList.add("linger-shop-card--in");
      });
    });

    return root;
  }

  function boot() {
    try {
      if (sessionStorage.getItem(SESSION_DISMISSED) === "1") return;
      if (/pinterest\.com$/i.test(location.hostname.replace(/^www\./, "")))
        return;

      let productRegion = detectProductRegion();
      if (!productRegion && hasLikelyProductPage()) productRegion = "tops";
      if (!productRegion) return;

      chrome.storage.local.get([STORAGE_LOGS], (data) => {
        try {
          if (chrome.runtime && chrome.runtime.lastError) return;
          const logs = Array.isArray(data[STORAGE_LOGS]) ? data[STORAGE_LOGS] : [];
          const { percentages } = getTasteProfile(logs);

          window.setTimeout(() => {
            try {
              if (sessionStorage.getItem(SESSION_DISMISSED) === "1") return;
              const root = showIntervention(productRegion, percentages);
              void runShopEchoPipeline(root, logs);
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
