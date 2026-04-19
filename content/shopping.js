(function () {
  "use strict";

  const STORAGE_LOGS = "linger_logs";
  const STORAGE_DISMISSALS = "linger_intervention_dismissals";
  const SESSION_DISMISSED = "linger_intervention_dismissed";
  const SETTINGS_STORAGE = "linger_user_settings";
  const DAILY_SHOP_INTERVENTIONS = "linger_shop_intervention_daily";
  const SHOW_DELAY_MS = 1500;

  function normSettingsHost(h) {
    return String(h || "")
      .replace(/^www\./i, "")
      .toLowerCase();
  }

  function parseUserSettings(raw) {
    const o = raw && typeof raw === "object" ? raw : {};
    const max = o.maxShoppingInterventionsPerDay;
    let maxN = null;
    if (max != null && max !== "") {
      const n = parseInt(max, 10);
      if (Number.isFinite(n) && n > 0) maxN = n;
    }
    return {
      usePerSiteShopping: !!o.usePerSiteShopping,
      shoppingEnabled: o.shoppingEnabled !== false,
      perSiteShopping:
        o.perSiteShopping && typeof o.perSiteShopping === "object"
          ? o.perSiteShopping
          : {},
      snoozeUntilMs: typeof o.snoozeUntilMs === "number" ? o.snoozeUntilMs : 0,
      maxShoppingInterventionsPerDay: maxN,
    };
  }

  function settingsSnoozed(settings) {
    return settings.snoozeUntilMs > Date.now();
  }

  function shoppingAllowedForHost(settings, hostname) {
    const h = normSettingsHost(hostname);
    if (
      settings.usePerSiteShopping &&
      Object.prototype.hasOwnProperty.call(settings.perSiteShopping, h)
    ) {
      return !!settings.perSiteShopping[h];
    }
    return settings.shoppingEnabled;
  }

  function localCalendarDayKey() {
    const d = new Date();
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  function tryConsumeShoppingDailySlot(maxPerDay, cb) {
    if (maxPerDay == null) {
      cb(true);
      return;
    }
    const key = DAILY_SHOP_INTERVENTIONS;
    chrome.storage.local.get([key], (data) => {
      try {
        if (chrome.runtime && chrome.runtime.lastError) {
          cb(false);
          return;
        }
        const today = localCalendarDayKey();
        let rec = data[key];
        if (!rec || typeof rec !== "object" || rec.day !== today) {
          rec = { day: today, count: 0 };
        }
        const n = typeof rec.count === "number" ? rec.count : 0;
        if (n >= maxPerDay) {
          cb(false);
          return;
        }
        chrome.storage.local.set({ [key]: { day: today, count: n + 1 } }, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            cb(false);
            return;
          }
          cb(true);
        });
      } catch (_) {
        cb(false);
      }
    });
  }

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

  /**
   * kg CO₂e planning band (manufacturing + distribution; use-phase excluded).
   * Rule-based archetypes, material signals (with exclusions), optional price
   * and brand-tier nudges. Heuristic only — not formal LCA.
   */
  function extractStructuredData() {
    const result = {
      brand: null,
      category: null,
      material: null,
      price: null,
      currency: null,
    };
    try {
      const scripts = document.querySelectorAll(
        'script[type="application/ld+json"]'
      );
      for (const script of scripts) {
        let data;
        try {
          data = JSON.parse(script.textContent || "{}");
        } catch (_) {
          continue;
        }
        const roots = Array.isArray(data) ? data : [data];
        const nodes = [];
        for (const root of roots) {
          if (root && typeof root === "object" && Array.isArray(root["@graph"])) {
            for (const g of root["@graph"]) nodes.push(g);
          } else if (root) {
            nodes.push(root);
          }
        }
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;
          const rawT = node["@type"];
          const typeArr = Array.isArray(rawT) ? rawT : rawT != null ? [rawT] : [];
          const isProduct = typeArr.some((t) => {
            const s = String(t).trim();
            const tail = s.replace(/^https?:\/\/schema\.org\//i, "");
            const low = tail.toLowerCase();
            return low === "product" || low === "individualproduct";
          });
          if (!isProduct) continue;

          if (node.brand != null) {
            if (typeof node.brand === "string") result.brand = node.brand;
            else if (node.brand.name) result.brand = node.brand.name;
          }
          if (node.category != null) result.category = String(node.category);
          if (node.material != null) result.material = String(node.material);

          const offers = node.offers;
          const off = Array.isArray(offers) ? offers[0] : offers;
          if (off && off.price != null) {
            const p = parseFloat(String(off.price).replace(/[^\d.\-]/g, ""));
            if (Number.isFinite(p) && p > 0) {
              result.price = p;
              if (off.priceCurrency)
                result.currency = String(off.priceCurrency).toUpperCase();
            }
          }
        }
      }
    } catch (_) {
      /* fail silently */
    }
    return result;
  }

  const CARBON_REGION_FALLBACK = {
    tops: [3.5, 9],
    bottoms: [4, 11],
    shoes: [6, 15],
    accessories: [2, 7],
    unknown: [3, 10],
  };

  const CARBON_ARCHETYPES = {
    tops: [
      {
        keywords: ["down jacket", "puffer jacket", "puffer coat", "quilted jacket", "padded jacket"],
        band: [18, 38],
        priceKey: "down jacket",
      },
      {
        keywords: ["parka", "anorak", "ski jacket", "insulated jacket"],
        band: [14, 30],
        priceKey: "parka",
      },
      {
        keywords: ["coat", "overcoat", "trench coat", "wool coat", "peacoat"],
        band: [10, 22],
        priceKey: "coat",
      },
      {
        keywords: ["blazer", "suit jacket", "sport coat", "dinner jacket"],
        band: [7, 15],
        priceKey: "blazer",
      },
      {
        keywords: ["hoodie", "hooded sweatshirt", "zip hoodie"],
        band: [5, 10],
        priceKey: "hoodie",
      },
      {
        keywords: ["sweatshirt", "crewneck", "pullover fleece"],
        band: [4, 9],
        priceKey: "sweatshirt",
      },
      {
        keywords: ["knit sweater", "jumper", "knitwear", "chunky knit", "cardigan"],
        band: [4, 9],
        priceKey: "knit sweater",
      },
      {
        keywords: ["woven shirt", "oxford shirt", "flannel shirt", "linen shirt", "dress shirt"],
        band: [3.5, 7],
        priceKey: "woven shirt",
      },
      {
        keywords: ["blouse", "chiffon top", "silk top", "satin blouse"],
        band: [3, 6.5],
        priceKey: "blouse",
      },
      {
        keywords: ["polo shirt", "polo"],
        band: [3, 6],
        priceKey: "polo shirt",
      },
      {
        keywords: ["long sleeve", "longsleeve", "thermal top", "base layer"],
        band: [2.5, 5.5],
        priceKey: "long sleeve",
      },
      {
        keywords: ["t-shirt", "tshirt", "tee", "graphic tee", "vest top", "tank top", "crop top", "camisole"],
        band: [2, 4.5],
        priceKey: "t-shirt",
      },
    ],
    bottoms: [
      {
        keywords: ["suit trousers", "tailored trousers", "dress trousers", "wool trousers"],
        band: [6, 13],
        priceKey: "suit trousers",
      },
      {
        keywords: ["jeans", "denim jeans", "skinny jeans", "wide leg jeans", "mom jeans", "bootcut"],
        band: [8, 18],
        priceKey: "jeans",
      },
      {
        keywords: ["chinos", "chino", "khaki trousers", "cotton trousers"],
        band: [4, 9],
        priceKey: "chinos",
      },
      {
        keywords: ["joggers", "sweatpants", "track pants", "lounge pants"],
        band: [3.5, 7.5],
        priceKey: "joggers",
      },
      {
        keywords: ["shorts", "denim shorts", "chino shorts", "swim shorts", "board shorts"],
        band: [2.5, 6],
        priceKey: "shorts",
      },
      {
        keywords: ["leggings", "yoga pants", "cycling shorts", "compression tights"],
        band: [2.5, 5.5],
        priceKey: "leggings",
      },
      {
        keywords: ["midi skirt", "maxi skirt", "pleated skirt", "wrap skirt"],
        band: [3, 7],
        priceKey: "skirt",
      },
      {
        keywords: ["mini skirt", "skirt"],
        band: [2, 5],
        priceKey: "skirt",
      },
      {
        keywords: ["trousers", "pants", "slacks", "wide leg", "flares"],
        band: [4, 9],
        priceKey: "default",
      },
    ],
    shoes: [
      {
        keywords: ["hiking boot", "walking boot", "work boot", "chelsea boot", "ankle boot", "leather boot", "knee boot"],
        band: [10, 22],
        priceKey: "hiking boot",
      },
      {
        keywords: ["leather shoe", "oxford", "derby", "brogue", "loafer", "leather sandal"],
        band: [8, 18],
        priceKey: "leather shoe",
      },
      {
        keywords: ["running shoe", "running trainer", "performance trainer", "athletic shoe"],
        band: [7, 16],
        priceKey: "running shoe",
      },
      {
        keywords: ["trainer", "sneaker", "casual shoe", "plimsoll", "canvas shoe"],
        band: [5, 12],
        priceKey: "trainer",
      },
      {
        keywords: ["flip flop", "sandal", "slides", "mule", "slip on"],
        band: [3, 8],
        priceKey: "sandal",
      },
      {
        keywords: ["slipper", "indoor shoe"],
        band: [2, 5],
        priceKey: "slipper",
      },
    ],
    accessories: [
      {
        keywords: ["leather bag", "leather handbag", "tote bag", "shoulder bag", "crossbody", "backpack leather", "leather purse", "leather wallet"],
        band: [8, 20],
        priceKey: "leather bag",
      },
      {
        keywords: ["canvas bag", "nylon bag", "fabric tote", "backpack", "rucksack"],
        band: [3, 8],
        priceKey: "canvas bag",
      },
      {
        keywords: ["leather belt", "leather gloves"],
        band: [3, 8],
        priceKey: "leather belt",
      },
      {
        keywords: ["wool scarf", "cashmere scarf", "knit scarf", "beanie", "wool hat", "knit hat"],
        band: [1.5, 4],
        priceKey: "wool scarf",
      },
      {
        keywords: ["cap", "baseball cap", "hat", "bucket hat"],
        band: [1, 3],
        priceKey: "cap",
      },
      {
        keywords: ["scarf", "gloves", "socks", "tights"],
        band: [0.8, 2.5],
        priceKey: "scarf",
      },
      {
        keywords: ["sunglasses", "jewellery", "jewelry", "watch", "belt"],
        band: [1, 3],
        priceKey: "default",
      },
    ],
  };

  const MATERIAL_SIGNALS = [
    {
      phrases: ["faux leather", "pu leather", "vegan leather", "pleather", "leatherette"],
      multiplier: 0.85,
      excludes: ["genuine leather", "real leather", "full-grain", "top-grain", "suede"],
    },
    {
      phrases: ["genuine leather", "real leather", "full-grain leather", "top-grain leather", "suede", "nubuck"],
      multiplier: 1.62,
      excludes: ["faux", "vegan", "pu leather"],
    },
    {
      phrases: ["recycled polyester", "recycled nylon", "recycled poly", "repreve", "econyl", "recycled plastic"],
      multiplier: 0.72,
      excludes: [],
    },
    {
      phrases: ["100% polyester", "virgin polyester", "virgin nylon", "acrylic", "elastane", "spandex"],
      multiplier: 1.28,
      excludes: ["recycled"],
    },
    {
      phrases: ["organic cotton", "gots certified", "gots cotton", "fair trade cotton"],
      multiplier: 0.78,
      excludes: [],
    },
    {
      phrases: ["100% cotton", "pure cotton", "combed cotton", "ring-spun cotton"],
      multiplier: 1.05,
      excludes: ["organic", "recycled"],
    },
    {
      phrases: ["linen", "hemp", "ramie", "jute"],
      multiplier: 0.65,
      excludes: [],
    },
    {
      phrases: ["merino wool", "lambswool", "cashmere", "alpaca", "wool blend"],
      multiplier: 1.15,
      excludes: ["recycled wool"],
    },
    {
      phrases: ["recycled wool", "regenerated wool", "shetland reclaimed"],
      multiplier: 0.68,
      excludes: [],
    },
    {
      phrases: ["tencel", "lyocell", "modal", "ecovero"],
      multiplier: 0.82,
      excludes: [],
    },
    {
      phrases: ["viscose", "rayon", "bamboo viscose"],
      multiplier: 1.18,
      excludes: ["tencel", "lyocell", "ecovero", "modal"],
    },
    {
      phrases: ["down fill", "goose down", "duck down", "800 fill", "600 fill", "down jacket", "puffer"],
      multiplier: 1.45,
      excludes: ["synthetic fill", "primaloft", "recycled down"],
    },
    {
      phrases: ["recycled down", "primaloft", "synthetic fill", "polyfill", "thermolite"],
      multiplier: 0.88,
      excludes: [],
    },
  ];

  function materialCarbonMultiplier(signalText) {
    const lower = signalText.toLowerCase();
    let bestMultiplier = 1.0;
    let bestMatch = null;

    for (const signal of MATERIAL_SIGNALS) {
      const hasPhrase = signal.phrases.some((p) => lower.includes(p));
      if (!hasPhrase) continue;

      const isVetoed = signal.excludes.some((ex) => lower.includes(ex));
      if (isVetoed) continue;

      if (
        bestMatch === null ||
        Math.abs(signal.multiplier - 1.0) > Math.abs(bestMultiplier - 1.0)
      ) {
        bestMultiplier = signal.multiplier;
        bestMatch = signal;
      }
    }

    return {
      multiplier: Math.max(0.55, Math.min(1.85, bestMultiplier)),
      matched: bestMatch !== null,
    };
  }

  const ARCHETYPE_MEDIAN_PRICE_GBP = {
    "down jacket": 180,
    parka: 150,
    coat: 130,
    blazer: 90,
    hoodie: 45,
    sweatshirt: 38,
    "knit sweater": 55,
    "woven shirt": 45,
    blouse: 38,
    "polo shirt": 35,
    "long sleeve": 28,
    "t-shirt": 22,
    jeans: 60,
    "suit trousers": 80,
    chinos: 50,
    joggers: 38,
    shorts: 30,
    leggings: 28,
    skirt: 35,
    "hiking boot": 110,
    "leather shoe": 100,
    "running shoe": 95,
    trainer: 75,
    sandal: 40,
    slipper: 25,
    "leather bag": 120,
    "canvas bag": 40,
    "leather belt": 35,
    "wool scarf": 30,
    cap: 22,
    scarf: 18,
    default: 45,
  };

  function priceWeightMultiplier(priceGBP, archetypeKey) {
    if (!priceGBP || priceGBP <= 0) return 1.0;

    const median =
      ARCHETYPE_MEDIAN_PRICE_GBP[archetypeKey] ??
      ARCHETYPE_MEDIAN_PRICE_GBP["default"];
    const ratio = priceGBP / median;

    const raw = 0.72 + (Math.log(ratio + 0.1) / Math.log(12)) * 0.56;
    return Math.max(0.72, Math.min(1.3, raw));
  }

  /**
   * Heuristic brand tiers — not certification. Informed by public sustainability
   * ratings and transparency indices; treat as a soft nudge only.
   */
  const BRAND_TIERS = {
    shein: 1,
    sheglam: 1,
    romwe: 1,
    temu: 1,
    cider: 1,
    "princess polly": 1,
    zaful: 1,
    rosegal: 1,
    dresslily: 1,
    newchic: 1,
    joom: 1,
    urbanic: 1,
    boohoo: 2,
    prettylittlething: 2,
    plt: 2,
    missguided: 2,
    "nasty gal": 2,
    "fashion nova": 2,
    "forever 21": 2,
    "h&m": 2,
    hm: 2,
    zara: 2,
    bershka: 2,
    "pull&bear": 2,
    stradivarius: 2,
    oysho: 2,
    asos: 2,
    topshop: 2,
    primark: 2,
    penneys: 2,
    george: 2,
    select: 2,
    "new look": 2,
    "dorothy perkins": 2,
    "river island": 2,
    quiz: 2,
    "joe browns": 2,
    "in the style": 2,
    "i saw it first": 2,
    "oh polly": 2,
    misspap: 2,
    "urban outfitters": 2,
    "free people": 2,
    anthropologie: 2,
    gap: 2,
    "old navy": 2,
    "banana republic": 2,
    express: 2,
    "forever new": 2,
    mango: 2,
    uniqlo: 2,
    terranova: 2,
    calzedonia: 2,
    intimissimi: 2,
    tezenis: 2,
    "c&a": 2,
    takko: 2,
    kik: 2,
    pepco: 2,
    "george at asda": 2,
    matalan: 2,
    peacocks: 2,
    bonmarche: 2,
    "shein curve": 1,
    "levi's": 4,
    levis: 4,
    columbia: 4,
    "the north face": 4,
    timberland: 4,
    puma: 4,
    adidas: 4,
    nike: 4,
    "marks & spencer": 4,
    "marks and spencer": 4,
    "m&s": 4,
    next: 4,
    "fat face": 4,
    "white stuff": 4,
    seasalt: 4,
    "helly hansen": 4,
    "arc'teryx": 4,
    arcteryx: 4,
    "fjällräven": 4,
    fjallraven: 4,
    icebreaker: 4,
    smartwool: 4,
    veja: 4,
    allbirds: 4,
    rothys: 4,
    "rothy's": 4,
    "girlfriend collective": 4,
    "thought clothing": 4,
    preworn: 4,
    kotn: 4,
    pact: 4,
    outerknown: 4,
    finisterre: 4,
    howies: 4,
    rapanui: 4,
    boden: 4,
    patagonia: 5,
    "eileen fisher": 5,
    "stella mccartney": 5,
    reformation: 5,
    tentree: 5,
    "ten tree": 5,
    "people tree": 5,
    pangaia: 5,
    "organic basics": 5,
    thought: 5,
    "hemp republic": 5,
    "sancho's": 5,
    "toad&co": 5,
    "toad co": 5,
    prAna: 5,
    prana: 5,
    "picture organic": 5,
    ecoalf: 5,
    armedangels: 5,
    "knows supply": 5,
    "known supply": 5,
    "christy dawn": 5,
    "mara hoffman": 5,
    "tonlé": 5,
    tonle: 5,
    "honest by": 5,
    "vege threads": 5,
    nau: 5,
  };

  const BRAND_TIER_MULTIPLIER = {
    1: 1.15,
    2: 1.08,
    3: 1.0,
    4: 0.92,
    5: 0.85,
  };

  function brandTierMultiplier(brandName, hostname) {
    const candidates = [];
    if (brandName) candidates.push(String(brandName).toLowerCase().trim());
    if (hostname) {
      const stripped = String(hostname)
        .replace(/^www\./i, "")
        .split(".")[0]
        .replace(/-/g, " ");
      candidates.push(stripped.toLowerCase());
    }

    const brandEntries = Object.entries(BRAND_TIERS).sort(
      (a, b) => b[0].length - a[0].length
    );

    for (const candidate of candidates) {
      for (const [brand, tier] of brandEntries) {
        if (candidate.includes(brand) || brand.includes(candidate)) {
          return { multiplier: BRAND_TIER_MULTIPLIER[tier], tier };
        }
      }
    }
    return { multiplier: 1.0, tier: 3 };
  }

  const CURRENCY_TO_GBP = {
    GBP: 1.0,
    USD: 0.79,
    EUR: 0.86,
    CAD: 0.58,
    AUD: 0.51,
    SEK: 0.073,
    DKK: 0.115,
    NOK: 0.073,
    CHF: 0.9,
    JPY: 0.0053,
  };

  function toPriceGBP(price, currency) {
    if (price == null || !Number.isFinite(price) || price <= 0) return null;
    const c = (currency || "GBP").toUpperCase();
    const rate = CURRENCY_TO_GBP[c];
    if (rate == null) return null;
    return price * rate;
  }

  const FALLBACK_RETAIL_GBP = {
    tops: { 1: 11, 2: 28, 3: 42, 4: 72, 5: 110 },
    bottoms: { 1: 13, 2: 32, 3: 52, 4: 80, 5: 115 },
    shoes: { 1: 16, 2: 42, 3: 75, 4: 110, 5: 155 },
    accessories: { 1: 9, 2: 24, 3: 42, 4: 68, 5: 115 },
  };

  // Resale fractions of new retail by region × brand tier (heuristic).
  // See product brief: Vestiaire / ThredUp / Scaleorder / Attire / Worn Wear.
  const RESALE_BANDS = {
    tops: {
      1: [0.04, 0.14],
      2: [0.12, 0.26],
      3: [0.22, 0.42],
      4: [0.35, 0.58],
      5: [0.48, 0.72],
    },
    bottoms: {
      1: [0.04, 0.12],
      2: [0.14, 0.28],
      3: [0.25, 0.44],
      4: [0.38, 0.58],
      5: [0.48, 0.68],
    },
    shoes: {
      1: [0.06, 0.16],
      2: [0.18, 0.36],
      3: [0.28, 0.5],
      4: [0.4, 0.62],
      5: [0.52, 0.76],
    },
    accessories: {
      1: [0.04, 0.12],
      2: [0.14, 0.3],
      3: [0.26, 0.48],
      4: [0.38, 0.6],
      5: [0.52, 0.78],
    },
  };

  const RESALE_BAND_FALLBACK = {
    1: [0.04, 0.13],
    2: [0.13, 0.28],
    3: [0.23, 0.43],
    4: [0.37, 0.59],
    5: [0.5, 0.73],
  };

  function getResaleBand(productRegion, brandTier) {
    const tier = typeof brandTier === "number" && brandTier >= 1 && brandTier <= 5 ? brandTier : 3;
    const regionBands = RESALE_BANDS[productRegion] ?? RESALE_BAND_FALLBACK;
    const band = regionBands[tier] ?? regionBands[3] ?? RESALE_BAND_FALLBACK[3];
    return band;
  }

  const RESALE_ARCHETYPE_MODIFIER = {
    "denim jeans": 1.32,
    "leather jacket": 1.4,
    "down jacket": 1.28,
    "puffer jacket": 1.28,
    parka: 1.22,
    "wool coat": 1.2,
    blazer: 1.18,
    "leather boot": 1.3,
    "ankle boot": 1.2,
    "running shoe": 1.22,
    trainer: 1.18,
    "leather bag": 1.45,
    "leather handbag": 1.45,
    crossbody: 1.3,
    backpack: 1.2,
    cashmere: 1.35,
    "wool sweater": 1.15,
    "t-shirt": 0.62,
    "graphic tee": 0.7,
    "vest top": 0.52,
    "crop top": 0.5,
    camisole: 0.48,
    leggings: 0.65,
    "yoga pants": 0.65,
    shorts: 0.68,
    swimwear: 0.3,
    "flip flop": 0.45,
    slipper: 0.35,
    socks: 0.1,
    tights: 0.12,
    underwear: 0.05,
    jeans: 1.32,
    "knit sweater": 1.15,
  };

  function archetypeResaleModifier(archetypeKey) {
    if (!archetypeKey || archetypeKey === "default") return 1.0;
    if (RESALE_ARCHETYPE_MODIFIER[archetypeKey] !== undefined) {
      return RESALE_ARCHETYPE_MODIFIER[archetypeKey];
    }
    const entries = Object.entries(RESALE_ARCHETYPE_MODIFIER).sort(
      (a, b) => b[0].length - a[0].length
    );
    for (const [key, mod] of entries) {
      if (archetypeKey.includes(key) || key.includes(archetypeKey)) {
        return mod;
      }
    }
    return 1.0;
  }

  function buildCarbonSignalText(structured) {
    const prefix = [];
    if (structured && structured.material)
      prefix.push(String(structured.material).toLowerCase());
    if (structured && structured.category)
      prefix.push(String(structured.category).toLowerCase());
    if (structured && structured.brand) prefix.push(String(structured.brand).toLowerCase());
    try {
      const rest = [
        collectPageText(),
        (getProductTitle() || "").toLowerCase(),
        (getProductDescriptionText() || "").toLowerCase(),
      ].join("\n");
      const head = prefix.filter(Boolean).join("\n");
      return head ? head + "\n" + rest : rest;
    } catch (_) {
      const head = prefix.filter(Boolean).join("\n");
      return head ? head + "\n" + collectPageText() : collectPageText();
    }
  }

  function pickCarbonArchetypeBand(textLower, region) {
    const fbKey = CARBON_REGION_FALLBACK[region] ? region : "unknown";
    const fb = CARBON_REGION_FALLBACK[fbKey] || CARBON_REGION_FALLBACK.unknown;
    const list = CARBON_ARCHETYPES[region];
    if (!list || !list.length) {
      return {
        band: fb.slice(),
        archetypeKey: "default",
        archetypeMatched: false,
      };
    }
    for (const row of list) {
      for (const kw of row.keywords) {
        if (keywordMatches(textLower, kw)) {
          return {
            band: row.band.slice(),
            archetypeKey: row.priceKey || "default",
            archetypeMatched: true,
          };
        }
      }
    }
    return {
      band: fb.slice(),
      archetypeKey: "default",
      archetypeMatched: false,
    };
  }

  function confidenceLabel(c) {
    let score = 0;
    if (c.archetypeMatched) score += 2;
    if (c.materialMatched) score += 1;
    if (c.priceFound) score += 1;
    if (c.brandTier !== 3) score += 1;
    if (score >= 4) return "high";
    if (score >= 2) return "medium";
    return "low";
  }

  function estimateGarmentCarbonKg(productRegion) {
    const region = ["tops", "bottoms", "shoes", "accessories"].includes(
      productRegion
    )
      ? productRegion
      : "tops";

    const structured = extractStructuredData();
    const signalText = buildCarbonSignalText(structured);

    let price = structured.price;
    let currency = structured.currency;
    if (price == null || !Number.isFinite(price) || price <= 0) {
      const scrap = extractRetailPriceAndCurrency();
      price = scrap.price;
      currency = scrap.currency;
    }
    const priceGBP = toPriceGBP(price, currency);

    const { band, archetypeKey, archetypeMatched } = pickCarbonArchetypeBand(
      signalText,
      region
    );
    const [min0, max0] = band;

    const mat = materialCarbonMultiplier(signalText);
    const matMult = mat.multiplier;
    const priceMult = priceWeightMultiplier(priceGBP, archetypeKey);
    const brandRes = brandTierMultiplier(structured.brand, location.hostname);
    const brandMult = brandRes.multiplier;
    const brandTier = brandRes.tier;

    let scaledMin = min0 * matMult * priceMult * brandMult;
    let scaledMax = max0 * matMult * priceMult * brandMult;
    if (scaledMin > scaledMax) {
      const t = scaledMin;
      scaledMin = scaledMax;
      scaledMax = t;
    }
    scaledMin = Math.max(0.3, scaledMin);
    scaledMax = Math.max(scaledMin + 0.5, scaledMax);

    const midKg = (scaledMin + scaledMax) / 2;
    const ra = Math.round(scaledMin);
    const rb = Math.round(scaledMax);
    const rangeLabel = ra === rb ? String(ra) : ra + "\u2013" + rb;

    const confidence = {
      archetypeMatched,
      materialMatched: mat.matched,
      priceFound: priceGBP != null && priceGBP > 0,
      brandTier,
    };
    const confLabel = confidenceLabel(confidence);

    let detailLine = archetypeMatched
      ? "Style phrases on this page narrowed the band."
      : "Few style clues; using a broad category band.";
    if (mat.matched) detailLine += " Material phrases adjusted it.";
    if (confidence.priceFound) detailLine += " Price vs typical nudged the range.";
    if (brandTier !== 3) detailLine += " Brand tier nudge applied.";
    detailLine += " Planning estimate, not formal LCA.";

    return {
      minKg: scaledMin,
      maxKg: scaledMax,
      midKg,
      rangeLabel,
      detailLine,
      confidence,
      confidenceLabel: confLabel,
    };
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
    let salePrice = null;
    let origPrice = null;
    let currency = "USD";

    function isProductNode(node) {
      const typeArr = Array.isArray(node["@type"])
        ? node["@type"]
        : node["@type"] != null
          ? [node["@type"]]
          : [];
      return typeArr.some((t) => {
        const tail = String(t).trim().replace(/^https?:\/\/schema\.org\//i, "");
        const low = tail.toLowerCase();
        return low === "product" || low === "individualproduct";
      });
    }

    function parseMoney(v) {
      const p = parseFloat(String(v).replace(/[^\d.\-]/g, ""));
      return Number.isFinite(p) && p > 0 && p <= 250000 ? p : null;
    }

    try {
      for (const script of document.querySelectorAll(
        'script[type="application/ld+json"]'
      )) {
        try {
          const raw = JSON.parse(script.textContent || "{}");
          const roots = Array.isArray(raw) ? raw : [raw];
          const nodes = [];
          for (const root of roots) {
            if (root && typeof root === "object" && Array.isArray(root["@graph"])) {
              for (const g of root["@graph"]) nodes.push(g);
            } else if (root) nodes.push(root);
          }
          for (const node of nodes) {
            if (!node || typeof node !== "object") continue;
            if (!isProductNode(node)) continue;

            const offersRaw = node.offers;
            const offerList = Array.isArray(offersRaw)
              ? offersRaw
              : [offersRaw].filter(Boolean);

            for (const offer of offerList) {
              if (!offer || typeof offer !== "object") continue;
              if (offer.priceCurrency)
                currency = String(offer.priceCurrency).toUpperCase();

              if (offer.price != null && salePrice == null) {
                const p = parseMoney(offer.price);
                if (p != null) salePrice = p;
              }

              const specs = [].concat(offer.priceSpecification || []).filter(Boolean);
              for (const spec of specs) {
                if (!spec || typeof spec !== "object") continue;
                const pt = String(spec.priceType || "");
                const isStrikethrough =
                  pt.includes("StrikethroughPrice") || pt.includes("ListPrice");
                if (spec.priceCurrency)
                  currency = String(spec.priceCurrency).toUpperCase();
                const specPrice = spec.price != null ? parseMoney(spec.price) : null;
                if (isStrikethrough) {
                  if (origPrice == null && specPrice != null) origPrice = specPrice;
                } else if (!spec.validForMemberTier) {
                  if (salePrice == null && specPrice != null) salePrice = specPrice;
                }
              }
            }
          }
        } catch (_) {
          continue;
        }
      }

      if (salePrice == null) {
        const m1 = document.querySelector(
          'meta[property="og:price:amount"], meta[property="product:price:amount"]'
        );
        if (m1) {
          const ogPrice = m1.getAttribute("content");
          if (ogPrice) {
            const p = parseMoney(ogPrice);
            if (p != null) salePrice = p;
          }
        }
        const m2 = document.querySelector(
          'meta[property="product:price:currency"], meta[property="og:price:currency"], meta[itemprop="priceCurrency"]'
        );
        if (m2) {
          const cur = m2.getAttribute("content");
          if (cur) currency = cur.toUpperCase();
        }
      }

      if (salePrice == null) {
        const el = document.querySelector(
          '[itemprop="price"][content], [itemprop="price"]'
        );
        if (el) {
          const c = el.getAttribute("content") || el.textContent;
          const p = parseMoney(c);
          if (p != null) salePrice = p;
        }
      }

      if (origPrice == null) {
        const strikeSel = [
          "s [itemprop='price']",
          "del [itemprop='price']",
          ".original-price",
          ".was-price",
          ".price-was",
          ".price__compare",
          ".compare-at-price",
          "[data-price-compare]",
          ".product__price--compare",
          ".woocommerce-Price-amount del",
        ].join(", ");
        const strikeEl = document.querySelector(strikeSel);
        if (strikeEl) {
          const raw = String(strikeEl.textContent || "")
            .replace(/[^\d.,]/g, "")
            .replace(",", ".");
          const val = parseFloat(raw);
          if (Number.isFinite(val) && val > 0 && val <= 250000) {
            if (!salePrice || val > salePrice) origPrice = val;
          }
        }
      }
    } catch (_) {
      /* ignore */
    }

    const resolvedPrice =
      origPrice != null && origPrice > (salePrice ?? 0) ? origPrice : salePrice;
    const isOriginalPrice =
      origPrice != null && origPrice > (salePrice ?? 0);

    return {
      price: resolvedPrice,
      currency,
      isOriginalPrice,
      salePrice,
    };
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
    const est = estimateGarmentCarbonKg(productRegion);
    const midRounded = Math.round(est.midKg);

    const title = document.createElement("div");
    title.className = "linger-shop-impact-title";
    title.textContent = "Carbon footprint";

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
      est.rangeLabel +
      " kg (making + shipping). Buying secondhand avoids most of that.";

    const meta = document.createElement("div");
    meta.className = "linger-shop-impact-meta";
    meta.appendChild(document.createTextNode(est.detailLine + " \u00b7 estimate confidence: "));
    const confSpan = document.createElement("span");
    confSpan.className =
      "linger-shop-impact-confidence-" + (est.confidenceLabel || "low");
    confSpan.textContent = est.confidenceLabel || "low";
    meta.appendChild(confSpan);

    const details = document.createElement("details");
    details.className = "linger-shop-impact-details";
    const summary = document.createElement("summary");
    summary.className = "linger-shop-impact-details-summary";
    summary.textContent = "How we estimated this";
    const detailsBody = document.createElement("div");
    detailsBody.className = "linger-shop-impact-details-body";
    const ballparkNote = document.createElement("p");
    ballparkNote.className = "linger-shop-impact-details-note";
    ballparkNote.textContent =
      "Ballpark only (manufacturing + shipping, not use-phase or formal carbon accounting).";
    detailsBody.appendChild(ballparkNote);
    detailsBody.appendChild(range);
    detailsBody.appendChild(meta);
    details.appendChild(summary);
    details.appendChild(detailsBody);

    const idx = nextMetaphorIndex(CARBON_METAPHORS.length);
    const metaphorEl = CARBON_METAPHORS[idx](est.midKg);

    container.appendChild(title);
    container.appendChild(numWrap);
    container.appendChild(details);
    container.appendChild(metaphorEl);
  }

  function appendThriftSavings(container, productRegion) {
    const { price, currency, isOriginalPrice, salePrice } =
      extractRetailPriceAndCurrency();
    const hasPrice = price != null && price > 0;
    const fmt = (n) => formatMoney(n, currency || "USD");

    const structured = extractStructuredData();
    const { tier: brandTier } = brandTierMultiplier(
      structured.brand,
      location.hostname
    );
    const region = ["tops", "bottoms", "shoes", "accessories"].includes(
      productRegion
    )
      ? productRegion
      : "tops";
    const signalText = buildCarbonSignalText(structured);
    const { archetypeKey } = pickCarbonArchetypeBand(signalText, region);

    const curU = (currency || "GBP").toUpperCase();
    const toGBP = CURRENCY_TO_GBP[curU] ?? 1.0;
    const fromGBP = 1 / toGBP;
    const tierRow = FALLBACK_RETAIL_GBP[region];
    const fallbackGBP =
      tierRow && tierRow[brandTier] != null ? tierRow[brandTier] : 42;
    const refGBP = hasPrice ? price * toGBP : fallbackGBP;
    const ref = refGBP * fromGBP;

    const [lowFrac, highFrac] = getResaleBand(region, brandTier);
    const archMod = archetypeResaleModifier(archetypeKey);
    const adjLowFrac = Math.min(0.95, Math.max(0.03, lowFrac * archMod));
    const adjHighFrac = Math.min(0.95, Math.max(0.03, highFrac * archMod));
    const usedLow = Math.round(ref * adjLowFrac);
    const usedHigh = Math.round(ref * adjHighFrac);

    const saveIfLow = Math.max(0, Math.round(ref - usedHigh));
    const saveIfHigh = Math.max(0, Math.round(ref - usedLow));

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
      if (isOriginalPrice && salePrice != null && Number.isFinite(salePrice)) {
        const note = document.createElement("div");
        note.className = "linger-shop-savings-note";
        note.textContent =
          "Compared to full price — this listing is on sale at " +
          fmt(salePrice) +
          ".";
        container.appendChild(note);
      }
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

    const secondhandSlot = document.createElement("div");
    secondhandSlot.className = "linger-shop-secondhand-slot";
    const btnSecondhand = document.createElement("button");
    btnSecondhand.type = "button";
    btnSecondhand.className = "linger-shop-btn linger-shop-btn--cta";
    btnSecondhand.textContent = "Find it secondhand →";
    secondhandSlot.appendChild(btnSecondhand);

    const wantFriction = document.createElement("div");
    wantFriction.className = "linger-shop-want-friction";

    const wantStepInitial = document.createElement("div");
    wantStepInitial.className = "linger-shop-want-step";
    const btnWant = document.createElement("button");
    btnWant.type = "button";
    btnWant.className =
      "linger-shop-btn linger-shop-btn--secondary linger-shop-btn--demoted";
    btnWant.textContent = "I still want it";
    wantStepInitial.appendChild(btnWant);

    const wantStepConfirm = document.createElement("div");
    wantStepConfirm.className = "linger-shop-want-step";
    wantStepConfirm.hidden = true;
    const confirmMsg = document.createElement("p");
    confirmMsg.className = "linger-shop-want-confirm-msg";
    confirmMsg.textContent =
      "Are you sure? Secondhand and thrift usually save money and are gentler on the environment.";
    const confirmActions = document.createElement("div");
    confirmActions.className = "linger-shop-want-confirm-actions";
    const btnConfirmBack = document.createElement("button");
    btnConfirmBack.type = "button";
    btnConfirmBack.className =
      "linger-shop-btn linger-shop-btn--secondary linger-shop-btn--demoted";
    btnConfirmBack.textContent = "Go back";
    const btnConfirmDismiss = document.createElement("button");
    btnConfirmDismiss.type = "button";
    btnConfirmDismiss.className =
      "linger-shop-btn linger-shop-btn--secondary linger-shop-btn--demoted";
    btnConfirmDismiss.textContent = "Yes, dismiss anyway";
    confirmActions.appendChild(btnConfirmBack);
    confirmActions.appendChild(btnConfirmDismiss);
    wantStepConfirm.appendChild(confirmMsg);
    wantStepConfirm.appendChild(confirmActions);

    wantFriction.appendChild(wantStepInitial);
    wantFriction.appendChild(wantStepConfirm);

    function bumpShopLayoutAfterWantStepChange() {
      requestAnimationFrame(() => {
        syncShopViewsHeight();
        requestAnimationFrame(() => {
          syncShopViewsHeight();
          wantStepConfirm.hidden
            ? wantFriction.scrollIntoView({ block: "end", behavior: "smooth" })
            : wantStepConfirm.scrollIntoView({ block: "end", behavior: "smooth" });
        });
      });
    }

    btnWant.addEventListener("click", () => {
      wantStepInitial.hidden = true;
      wantStepConfirm.hidden = false;
      bumpShopLayoutAfterWantStepChange();
    });

    btnConfirmBack.addEventListener("click", () => {
      wantStepConfirm.hidden = true;
      wantStepInitial.hidden = false;
      bumpShopLayoutAfterWantStepChange();
    });

    btnConfirmDismiss.addEventListener("click", () =>
      dismissCard(root, productRegion, true)
    );

    viewMain.appendChild(echoSection);
    viewMain.appendChild(impact);
    viewMain.appendChild(thrift);
    viewMain.appendChild(secondhandSlot);
    viewMain.appendChild(chartTitle);
    viewMain.appendChild(chart);
    viewMain.appendChild(footnote);
    viewMain.appendChild(wantFriction);

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

  /**
   * True when at least two independent product-page signals match.
   * Uses querySelector(All) only; short-circuits once two signals hit.
   */
  function isProductPage() {
    let score = 0;

    const path = location.pathname.toLowerCase();
    if (
      path.includes("product") ||
      path.includes("item") ||
      path.includes("pdp") ||
      path.includes("/p/")
    ) {
      score++;
      if (score >= 2) return true;
    }

    if (document.querySelector('meta[property="product:price:amount"]')) {
      score++;
      if (score >= 2) return true;
    }

    const ogType = document.querySelector('meta[property="og:type"]');
    if (ogType) {
      const c = (ogType.getAttribute("content") || "").trim().toLowerCase();
      if (c === "product") {
        score++;
        if (score >= 2) return true;
      }
    }

    const priceEls = document.querySelectorAll(
      '[class*="price"], [class*="Price"], [id*="price"], [id*="Price"]'
    );
    for (let i = 0; i < priceEls.length; i++) {
      if (/\d/.test(priceEls[i].textContent || "")) {
        score++;
        break;
      }
    }
    if (score >= 2) return true;

    const btns = document.querySelectorAll("button");
    for (let i = 0; i < btns.length; i++) {
      if (
        /add to cart|add to bag|buy now|purchase/i.test(
          btns[i].textContent || ""
        )
      ) {
        score++;
        break;
      }
    }

    return score >= 2;
  }

  function boot() {
    try {
      if (!isProductPage()) return;
      if (/pinterest\.com$/i.test(location.hostname.replace(/^www\./, "")))
        return;
      if (sessionStorage.getItem(SESSION_DISMISSED) === "1") return;

      let productRegion = detectProductRegion();
      if (!productRegion && hasLikelyProductPage()) productRegion = "tops";
      if (!productRegion) return;

      chrome.storage.local.get([STORAGE_LOGS, SETTINGS_STORAGE], (data) => {
        try {
          if (chrome.runtime && chrome.runtime.lastError) return;
          const settings = parseUserSettings(data[SETTINGS_STORAGE]);
          if (settingsSnoozed(settings)) return;
          if (!shoppingAllowedForHost(settings, location.hostname)) return;
          const logs = Array.isArray(data[STORAGE_LOGS]) ? data[STORAGE_LOGS] : [];
          const { percentages } = getTasteProfile(logs);

          window.setTimeout(() => {
            try {
              if (sessionStorage.getItem(SESSION_DISMISSED) === "1") return;
              chrome.storage.local.get([SETTINGS_STORAGE], (d2) => {
                try {
                  if (chrome.runtime && chrome.runtime.lastError) return;
                  const s2 = parseUserSettings(d2[SETTINGS_STORAGE]);
                  if (settingsSnoozed(s2)) return;
                  if (!shoppingAllowedForHost(s2, location.hostname)) return;
                  tryConsumeShoppingDailySlot(
                    s2.maxShoppingInterventionsPerDay,
                    (ok) => {
                      if (!ok) return;
                      try {
                        const root = showIntervention(productRegion, percentages);
                        void runShopEchoPipeline(root, logs);
                      } catch (_) {
                        /* silent */
                      }
                    }
                  );
                } catch (_) {
                  /* silent */
                }
              });
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
