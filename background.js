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
      throw new Error(raw || res.statusText || String(res.status));
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
    return false;
  });
})();
