#!/usr/bin/env node
/**
 * Reads .env and writes linger-config.local.json for the extension
 * (gitignored). Chrome cannot read .env at runtime.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");
const outPath = path.join(root, "linger-config.local.json");
const KEY_NAME = "LINGER_GEMINI_API_KEY";

function parseEnv(text) {
  const out = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/
    );
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

if (!fs.existsSync(envPath)) {
  console.error(
    "Missing .env. Copy .env.example to .env and set " + KEY_NAME + "."
  );
  process.exit(1);
}

const raw = fs.readFileSync(envPath, "utf8");
const env = parseEnv(raw);
const key = (env[KEY_NAME] || "").trim();
if (!key) {
  console.error(KEY_NAME + " is missing or empty in .env");
  process.exit(1);
}

fs.writeFileSync(
  outPath,
  JSON.stringify({ linger_gemini_api_key: key }, null, 2) + "\n",
  "utf8"
);
console.log("Wrote", path.relative(root, outPath));
