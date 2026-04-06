(function () {
  "use strict";

  const GEMINI_KEY = "linger_gemini_api_key";
  const MODEL = "gemini-flash-latest";

  function parseJsonFromModelText(text) {
    let t = String(text || "").trim();
    if (t.startsWith("```")) {
      t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
    }
    return JSON.parse(t);
  }

  /** Loaded from gitignored linger-config.local.json (see npm run sync-env). */
  let cachedFileKey = undefined;

  async function loadKeyFromLocalFile() {
    try {
      const res = await fetch(
        chrome.runtime.getURL("linger-config.local.json")
      );
      if (!res.ok) return null;
      const j = await res.json();
      const k = j.linger_gemini_api_key;
      return typeof k === "string" && k.trim().length > 0 ? k.trim() : null;
    } catch (_) {
      return null;
    }
  }

  async function getApiKey() {
    if (cachedFileKey === undefined) {
      cachedFileKey = await loadKeyFromLocalFile();
    }
    if (cachedFileKey) return cachedFileKey;
    const data = await chrome.storage.local.get(GEMINI_KEY);
    const k = data[GEMINI_KEY];
    return typeof k === "string" && k.trim().length > 0 ? k.trim() : null;
  }

  function humanizeGeminiHttpError(status, rawBody) {
    const raw = String(rawBody || "").trim();
    let parsed = null;
    if (raw.startsWith("{")) {
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        /* ignore */
      }
    }
    const apiErr = parsed && parsed.error;
    const code =
      apiErr && typeof apiErr.code === "number" ? apiErr.code : status;
    const apiMsg =
      apiErr && typeof apiErr.message === "string" ? apiErr.message : "";
    const haystack = (apiMsg + "\n" + raw).toLowerCase();

    if (
      code === 429 ||
      apiErr?.status === "RESOURCE_EXHAUSTED" ||
      /quota exceeded|exceeded your current quota|rate limit|resource_exhausted|generate_content_free_tier|generaterequestsperday/.test(
        haystack
      )
    ) {
      return (
        "Gemini\u2019s usage limit was reached for the moment."
      );
    }

    if (raw.length > 400) {
      return (
        "The AI request failed. Check your API key, network connection, and Google AI Studio if this keeps happening."
      );
    }

    return raw || "HTTP " + String(status);
  }

  async function geminiGenerate(apiKey, parts, maxOutputTokens) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: maxOutputTokens ?? 1024,
          responseMimeType: "application/json",
        },
      }),
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(humanizeGeminiHttpError(res.status, raw));
    }
    const data = JSON.parse(raw);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty model response");
    return parseJsonFromModelText(text);
  }

  const TAX_PIECE = [
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
  const TAX_DETAIL = [
    "Colour & pattern",
    "Fabric & texture",
    "Fit & silhouette",
    "Styling & pairing",
    "Details & accents",
    "Vibe",
    "Other",
  ];

  function normTaxPiece(s) {
    const t = String(s || "").trim();
    return TAX_PIECE.includes(t) ? t : "Other";
  }

  function normTaxDetail(s) {
    const t = String(s || "").trim();
    return TAX_DETAIL.includes(t) ? t : "Other";
  }

  async function taxonomyClassifyChunk(apiKey, labels, kind) {
    if (!labels.length) return [];
    const allowed = kind === "piece" ? TAX_PIECE.join(" | ") : TAX_DETAIL.join(" | ");
    const rules =
      kind === "piece"
        ? "Pieces: Jewelry = earrings, rings, necklaces, watches. Bags = handbags, totes, clutches, backpacks. Shoes = all footwear. Jackets & coats = blazers, coats, outer layers. Dresses & jumpsuits = dresses, jumpsuits, rompers. Accessories = hats, scarves, belts, sunglasses (not jewelry). Tops/Bottoms as usual."
        : "Details: Colour & pattern = colours, prints, contrast. Fabric & texture = material, weave, shine. Fit & silhouette = cut, length, volume, rise. Styling & pairing = how items work together, layering. Details & accents = hardware, stitching, pockets. Vibe = mood, era, energy.";
    const prompt =
      "Classify each user label into exactly one category.\n\n" +
      "Categories: " +
      allowed +
      "\n\n" +
      rules +
      '\n\nInput JSON array of strings: ' +
      JSON.stringify(labels) +
      '\n\nReturn ONLY JSON: {"categories":["<category>",...]} — same length and order as input. Each value must match a category name exactly (character-for-character as listed).';

    const parsed = await geminiGenerate(
      apiKey,
      [{ text: prompt }],
      Math.min(8192, 256 + labels.length * 48)
    );
    let arr = parsed.categories;
    if (!Array.isArray(arr)) arr = [];
    while (arr.length < labels.length) arr.push("Other");
    return arr.slice(0, labels.length).map((c) =>
      kind === "piece" ? normTaxPiece(c) : normTaxDetail(c)
    );
  }

  async function taxonomyMaps(pieceLabels, detailLabels) {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error("Missing API key");
    const CHUNK = 32;
    const pieceMap = Object.create(null);
    const detailMap = Object.create(null);
    const uniqPieces = [...new Set(pieceLabels.map((s) => String(s || "").trim()).filter(Boolean))];
    const uniqDetails = [...new Set(detailLabels.map((s) => String(s || "").trim()).filter(Boolean))];
    for (let i = 0; i < uniqPieces.length; i += CHUNK) {
      const chunk = uniqPieces.slice(i, i + CHUNK);
      const cats = await taxonomyClassifyChunk(apiKey, chunk, "piece");
      chunk.forEach((lab, j) => {
        pieceMap[lab] = cats[j] || "Other";
      });
    }
    for (let i = 0; i < uniqDetails.length; i += CHUNK) {
      const chunk = uniqDetails.slice(i, i + CHUNK);
      const cats = await taxonomyClassifyChunk(apiKey, chunk, "detail");
      chunk.forEach((lab, j) => {
        detailMap[lab] = cats[j] || "Other";
      });
    }
    return { pieceMap, detailMap };
  }

  async function shopProductEcho(
    imageBase64,
    mimeType,
    productTitle,
    productDescription,
    numberedSnippets,
    maxSnippetLine
  ) {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error("Missing API key");

    const title = String(productTitle || "")
      .replace(/`/g, "'")
      .slice(0, 500);
    const desc = String(productDescription || "")
      .replace(/`/g, "'")
      .slice(0, 3500);
    const blockRaw = String(numberedSnippets || "").trim();
    const block = blockRaw
      ? blockRaw.replace(/`/g, "'").slice(0, 14000)
      : "(No saved Pinterest items yet.)";
    const maxL = Math.max(0, parseInt(String(maxSnippetLine), 10) || 0);

    const prompt =
      "You compare a retail product to the user's past Pinterest saves (fashion taste notes).\n\n" +
      "PRODUCT TITLE:\n" +
      title +
      "\n\nPRODUCT DESCRIPTION:\n" +
      desc +
      "\n\nNUMBERED SAVES (each line is N. … — valid N is 1 through " +
      String(maxL) +
      " only):\n" +
      block +
      "\n\nTASK:\n" +
      "1) One concise sentence describing this product (use the image when provided, plus title/description).\n" +
      "2) Up to 3 groups of saves that clearly relate to this product (category, colour, silhouette, fabric, or vibe). " +
      "For each group return line_ids (only integers from the list above) and phrase — e.g. " +
      "\"You've saved 3 tops in this colour\" or \"You've saved 1 bottom with a wide-leg silhouette\". " +
      "The number in the sentence MUST equal line_ids.length.\n" +
      "If there are no saves or no good match, return echoes: [].\n\n" +
      "Return ONLY JSON: {\"product_blurb\":\"...\",\"echoes\":[{\"line_ids\":[1,2],\"phrase\":\"...\"}]}";

    const parts = [{ text: prompt }];
    if (imageBase64 && String(imageBase64).length > 80) {
      parts.push({
        inline_data: {
          mime_type: mimeType || "image/jpeg",
          data: imageBase64,
        },
      });
    }

    const parsed = await geminiGenerate(apiKey, parts, 2048);
    let blurb =
      typeof parsed.product_blurb === "string"
        ? parsed.product_blurb.trim()
        : "";
    let echoes = Array.isArray(parsed.echoes) ? parsed.echoes : [];
    const cleaned = [];
    for (const e of echoes) {
      if (cleaned.length >= 3) break;
      let ids = Array.isArray(e.line_ids) ? e.line_ids : [];
      ids = [
        ...new Set(
          ids
            .map((x) => parseInt(String(x), 10))
            .filter((n) => Number.isFinite(n) && n >= 1 && n <= maxL)
        ),
      ];
      if (ids.length === 0) continue;
      let phrase = typeof e.phrase === "string" ? e.phrase.trim() : "";
      const n = ids.length;
      if (!phrase) {
        phrase =
          "You've saved " +
          n +
          " Pinterest " +
          (n === 1 ? "save" : "saves") +
          " that relate to this piece.";
      } else {
        phrase = phrase.replace(
          /you('ve|’ve) saved\s+\d+/i,
          "You$1 saved " + n
        );
      }
      cleaned.push({ line_ids: ids, phrase });
    }

    return { product_blurb: blurb, echoes: cleaned };
  }

  async function listItems(imageBase64, mimeType) {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error("Missing API key");

    const prompt =
      "You are a fashion vision assistant. Examine this outfit or product image. " +
      "List every distinct visible clothing item and wearable accessory as specific short labels " +
      "(2–5 words when needed), sentence case only (capitalize the first letter, rest lowercase), " +
      "e.g. \"Knee high boots\", \"Oversized wool blazer\", \"Gold hoop earrings\". " +
      "Do not use generic buckets like \"shoes\", \"top\", or \"accessories\". " +
      "Return ONLY valid JSON: an object with a single key \"items\" whose value is an array of strings, maximum 6 strings. " +
      "If nothing wearable is visible, return {\"items\":[]}.";

    const parts = [
      { text: prompt },
      {
        inline_data: {
          mime_type: mimeType || "image/jpeg",
          data: imageBase64,
        },
      },
    ];

    const parsed = await geminiGenerate(apiKey, parts, 1024);
    let items = parsed.items;
    if (!Array.isArray(items)) items = [];
    items = items
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean)
      .slice(0, 6);
    return { items };
  }

  async function itemAttributes(imageBase64, mimeType, itemLabel, userFocus) {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error("Missing API key");

    const escaped = itemLabel.replace(/"/g, '\\"');
    const prompt = userFocus
      ? "The viewer wrote what they notice or love about this image: \"" +
        escaped +
        "\". " +
        "Using the image, suggest exactly 5 short, specific things they might appreciate that align with or build on what they said " +
        "(e.g. colour, proportion, how pieces work together, styling, fabrics, silhouette, vibe). " +
        "Each string should be concise (a few words), sentence case (first letter only capitalized). " +
        "Return ONLY valid JSON: an object with a single key \"attributes\" whose value is an array of exactly 5 strings."
      : "Given this image and the specific item: \"" +
        escaped +
        "\", list exactly 5 short, specific things a shopper might love about how that item appears here " +
        "(colour, material, silhouette, length, details, styling, etc.). " +
        "Each string should be concise (a few words), sentence case (first letter only capitalized). " +
        "Return ONLY valid JSON: an object with a single key \"attributes\" whose value is an array of exactly 5 strings.";

    const parts = [
      { text: prompt },
      {
        inline_data: {
          mime_type: mimeType || "image/jpeg",
          data: imageBase64,
        },
      },
    ];

    const parsed = await geminiGenerate(apiKey, parts, 1024);
    let attrs = parsed.attributes;
    if (!Array.isArray(attrs)) attrs = [];
    attrs = attrs
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean)
      .slice(0, 5);
    while (attrs.length < 5) attrs.push("—");
    return { attributes: attrs.slice(0, 5) };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "LINGER_GEMINI_ITEMS") {
      listItems(message.imageBase64, message.mimeType)
        .then((r) => sendResponse({ ok: true, items: r.items }))
        .catch((e) =>
          sendResponse({ ok: false, error: e.message || String(e) })
        );
      return true;
    }
    if (message?.type === "LINGER_GEMINI_ATTRIBUTES") {
      itemAttributes(
        message.imageBase64,
        message.mimeType,
        message.itemLabel,
        message.userFocus === true
      )
        .then((r) => sendResponse({ ok: true, attributes: r.attributes }))
        .catch((e) =>
          sendResponse({ ok: false, error: e.message || String(e) })
        );
      return true;
    }
    if (message?.type === "LINGER_GEMINI_TAXONOMY") {
      const pl = Array.isArray(message.pieceLabels) ? message.pieceLabels : [];
      const dl = Array.isArray(message.detailLabels) ? message.detailLabels : [];
      taxonomyMaps(pl, dl)
        .then((r) =>
          sendResponse({
            ok: true,
            pieceMap: r.pieceMap,
            detailMap: r.detailMap,
          })
        )
        .catch((e) =>
          sendResponse({ ok: false, error: e.message || String(e) })
        );
      return true;
    }
    if (message?.type === "LINGER_GEMINI_SHOP_ECHO") {
      shopProductEcho(
        message.imageBase64,
        message.mimeType,
        message.productTitle,
        message.productDescription,
        message.numberedSnippets,
        message.maxSnippetLine
      )
        .then((r) =>
          sendResponse({
            ok: true,
            product_blurb: r.product_blurb,
            echoes: r.echoes,
          })
        )
        .catch((e) =>
          sendResponse({ ok: false, error: e.message || String(e) })
        );
      return true;
    }
    return false;
  });

  const DASHBOARD_PAGE = "dashboard/dashboard.html";

  chrome.action.onClicked.addListener(async () => {
    const dashboardUrl = chrome.runtime.getURL(DASHBOARD_PAGE);
    try {
      const existing = await chrome.tabs.query({ url: dashboardUrl });
      if (existing.length > 0) {
        const tab = existing[0];
        await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.tabs.update(tab.id, { active: true });
        return;
      }
      await chrome.tabs.create({ url: dashboardUrl });
    } catch (e) {
      console.error("Linger: could not open dashboard", e);
    }
  });
})();
