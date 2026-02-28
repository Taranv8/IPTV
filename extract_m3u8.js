#!/usr/bin/env node

/**
 * M3U8 Playlist Extractor — with Channel Name & Logo
 * Usage:
 *   node extract_m3u8.js <url> [output_file] [--format=txt|m3u8|json|csv]
 *
 * Examples:
 *   node extract_m3u8.js https://kliv.fun/NFus6
 *   node extract_m3u8.js https://kliv.fun/NFus6 out.m3u8  --format=m3u8
 *   node extract_m3u8.js https://kliv.fun/NFus6 out.json  --format=json
 *   node extract_m3u8.js https://kliv.fun/NFus6 out.csv   --format=csv
 *   DEBUG=1 node extract_m3u8.js https://kliv.fun/NFus6   <- dumps raw response
 */

const https = require("https");
const http  = require("http");
const fs    = require("fs");
const url   = require("url");

const TARGET_URL  = process.argv[2];
const OUTPUT_FILE = process.argv[3] || "m3u8_urls.txt";

// --format=txt | m3u8 | json | csv  (auto-detected from file extension if not given)
const formatArg = (process.argv.find(a => a.startsWith("--format=")) || "").replace("--format=", "");
const ext       = OUTPUT_FILE.split(".").pop().toLowerCase();
const FORMAT    = formatArg || (["m3u8","json","csv","txt"].includes(ext) ? ext : "txt");

if (!TARGET_URL) {
  console.error("Usage: node extract_m3u8.js <url> [output_file] [--format=txt|m3u8|json|csv]");
  process.exit(1);
}

// ── Fetch with redirect following ─────────────────────────────────────────────

function fetchUrl(targetUrl, maxRedirects, depth) {
  maxRedirects = maxRedirects === undefined ? 15 : maxRedirects;
  depth        = depth        === undefined ? 0  : depth;

  return new Promise(function(resolve, reject) {
    if (depth > maxRedirects) return reject(new Error("Too many redirects"));

    var parsed = url.parse(targetUrl);
    var proto  = parsed.protocol === "https:" ? https : http;

    var req = proto.request({
      hostname : parsed.hostname,
      port     : parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path     : parsed.path || "/",
      method   : "GET",
      headers  : {
        "User-Agent"      : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept"          : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language" : "en-US,en;q=0.5",
        "Accept-Encoding" : "identity",
        "Connection"      : "keep-alive",
      },
    }, function(res) {
      var loc = res.headers.location;
      console.log("  [" + depth + "] " + targetUrl + " -> " + res.statusCode + (loc ? " -> " + loc : ""));

      if ([301,302,303,307,308].indexOf(res.statusCode) !== -1 && loc) {
        var next = loc.indexOf("http") === 0 ? loc : url.resolve(targetUrl, loc);
        res.resume();
        return resolve(fetchUrl(next, maxRedirects, depth + 1));
      }

      var chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end",  function()  {
        resolve({ body: Buffer.concat(chunks).toString("utf8"), finalUrl: targetUrl, statusCode: res.statusCode });
      });
    });

    req.on("error", reject);
    req.setTimeout(20000, function() { req.destroy(); reject(new Error("Timeout: " + targetUrl)); });
    req.end();
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function cleanUrl(raw) {
  return raw.trim().split(/[\s"'<>#\r\n]/)[0];
}

function isValidUrl(u) {
  return /^https?:\/\/.{4,}/i.test(u);
}

// ── Parse a single #EXTINF line into structured metadata ──────────────────────
//
// Format:  #EXTINF:-1 tvg-id="X" tvg-name="Y" tvg-logo="Z" group-title="G",Display Name
//
// Returns: { duration, tvgId, name, logo, group }

function parseExtinf(line) {
  var meta = {
    duration : "-1",
    tvgId    : "",
    name     : "",
    logo     : "",
    group    : "",
  };

  // Duration (number right after #EXTINF:)
  var durMatch = line.match(/^#EXTINF:\s*(-?\d+(?:\.\d+)?)/);
  if (durMatch) meta.duration = durMatch[1];

  // tvg-id
  var idMatch = line.match(/tvg-id\s*=\s*"([^"]*)"/i);
  if (idMatch) meta.tvgId = idMatch[1];

  // tvg-name (preferred for channel name)
  var nameMatch = line.match(/tvg-name\s*=\s*"([^"]*)"/i);
  if (nameMatch) meta.name = nameMatch[1];

  // tvg-logo
  var logoMatch = line.match(/tvg-logo\s*=\s*"([^"]*)"/i);
  if (logoMatch) meta.logo = logoMatch[1];

  // group-title
  var groupMatch = line.match(/group-title\s*=\s*"([^"]*)"/i);
  if (groupMatch) meta.group = groupMatch[1];

  // Display name = everything after the last comma
  var commaIdx = line.lastIndexOf(",");
  if (commaIdx !== -1) {
    var display = line.slice(commaIdx + 1).trim();
    if (display) {
      // If tvg-name wasn't set, use display name as fallback
      if (!meta.name) meta.name = display;
      meta.displayName = display;
    }
  }

  if (!meta.displayName) meta.displayName = meta.name;

  return meta;
}

// ── Method 1: Proper M3U8 playlist parser ─────────────────────────────────────

function parseM3u8(text) {
  var entries = [];
  var lines   = text.split(/\r?\n/);
  var pending = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();

    if (line.indexOf("#EXTINF") === 0) {
      pending = parseExtinf(line);
      pending._raw = line;
    } else if (pending !== null) {
      if (isValidUrl(line)) {
        pending.streamUrl = cleanUrl(line);
        entries.push(pending);
      }
      pending = null;
    }
  }

  return entries;
}

// ── Method 2: Plain URL lines ─────────────────────────────────────────────────

function parsePlainLines(text) {
  var found = [];
  var lines = text.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    if (t.indexOf("#") !== 0 && isValidUrl(t)) {
      found.push({ streamUrl: cleanUrl(t), name: "", logo: "", group: "", tvgId: "", duration: "-1", displayName: "" });
    }
  }
  return found;
}

// ── Method 3: Regex sweep (catches URLs in HTML/JS wrappers) ──────────────────

var PATTERNS = [
  /https?:\/\/[^\s"'<>\r\n,]+\.m3u8(?:\?[^\s"'<>\r\n,]*)?/gi,
  /https?:\/\/[^\s"'<>\r\n,"'`]+\/(?:live|hls|stream|play|playlist|channel|index|chunklist|master)[^\s"'<>\r\n,"'`]*/gi,
  /https?:\/\/[^\s"'<>\r\n,]+(?:\?|&)[^\s"'<>\r\n,]*m3u8[^\s"'<>\r\n,]*/gi,
  /(?:file|src|source|url|hls|stream|hlsUrl|streamUrl|m3u8|playUrl|videoUrl|link)\s*[=:]\s*["'`]?(https?:\/\/[^"'`\s,<>\r\n]+)/gi,
  /"(?:url|src|file|stream|hls|link|video|source)"\s*:\s*"(https?:\/\/[^"]+)"/gi,
  /(?:href|src|action)\s*=\s*["'](https?:\/\/[^"']+)/gi,
];

function regexSweep(text, existingUrls) {
  var found = [];
  var seen  = new Set(existingUrls);

  for (var p = 0; p < PATTERNS.length; p++) {
    var re = new RegExp(PATTERNS[p].source, PATTERNS[p].flags);
    var match;
    while ((match = re.exec(text)) !== null) {
      var raw     = match[1] || match[0];
      var cleaned = cleanUrl(raw);
      if (isValidUrl(cleaned) && !seen.has(cleaned)) {
        seen.add(cleaned);
        found.push({ streamUrl: cleaned, name: "", logo: "", group: "", tvgId: "", duration: "-1", displayName: "" });
      }
    }
  }

  return found;
}

// ── Output formatters ─────────────────────────────────────────────────────────

function toPlainTxt(entries) {
  return entries.map(function(e) { return e.streamUrl; }).join("\n") + "\n";
}

function toM3u8(entries, headerLine) {
  var lines = [headerLine || "#EXTM3U"];
  entries.forEach(function(e) {
    var attrs = '#EXTINF:' + e.duration;
    if (e.tvgId)  attrs += ' tvg-id="'      + e.tvgId  + '"';
    if (e.name)   attrs += ' tvg-name="'    + e.name   + '"';
    if (e.logo)   attrs += ' tvg-logo="'    + e.logo   + '"';
    if (e.group)  attrs += ' group-title="' + e.group  + '"';
    attrs += "," + (e.displayName || e.name || "Unknown");
    lines.push(attrs);
    lines.push(e.streamUrl);
  });
  return lines.join("\n") + "\n";
}

function toJson(entries) {
  var out = entries.map(function(e) {
    return {
      name      : e.displayName || e.name || null,
      tvgId     : e.tvgId  || null,
      group     : e.group  || null,
      logo      : e.logo   || null,
      streamUrl : e.streamUrl,
    };
  });
  return JSON.stringify(out, null, 2);
}

function escapeCsv(val) {
  if (!val) return "";
  val = String(val);
  if (val.indexOf(",") !== -1 || val.indexOf('"') !== -1 || val.indexOf("\n") !== -1) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

function toCsv(entries) {
  var rows = ["name,tvg_id,group,logo,stream_url"];
  entries.forEach(function(e) {
    rows.push([
      escapeCsv(e.displayName || e.name),
      escapeCsv(e.tvgId),
      escapeCsv(e.group),
      escapeCsv(e.logo),
      escapeCsv(e.streamUrl),
    ].join(","));
  });
  return rows.join("\n") + "\n";
}

// ── Pretty console table (preview) ────────────────────────────────────────────

function printTable(entries, max) {
  max = max || 25;
  var shown = entries.slice(0, max);

  // Column widths
  var W = { num: 4, name: 30, group: 18, logo: 5, url: 55 };

  function pad(s, n) {
    s = String(s || "");
    if (s.length > n) s = s.slice(0, n - 1) + "~";
    while (s.length < n) s += " ";
    return s;
  }

  var sep = "-".repeat(W.num + W.name + W.group + W.logo + W.url + 10);
  console.log(sep);
  console.log(
    pad("#",    W.num)  + "  " +
    pad("Name", W.name) + "  " +
    pad("Group",W.group)+ "  " +
    pad("Logo?",W.logo) + "  " +
    pad("Stream URL", W.url)
  );
  console.log(sep);

  shown.forEach(function(e, i) {
    console.log(
      pad(i+1,              W.num)  + "  " +
      pad(e.displayName||e.name, W.name) + "  " +
      pad(e.group,          W.group)+ "  " +
      pad(e.logo ? "YES" : "-", W.logo) + "  " +
      pad(e.streamUrl,      W.url)
    );
  });

  console.log(sep);
  if (entries.length > max) {
    console.log("  ... and " + (entries.length - max) + " more  ->  " + OUTPUT_FILE);
  }
}

// ── Stats summary ─────────────────────────────────────────────────────────────

function printStats(entries) {
  var withName  = entries.filter(function(e) { return !!(e.displayName || e.name); }).length;
  var withLogo  = entries.filter(function(e) { return !!e.logo; }).length;
  var withGroup = entries.filter(function(e) { return !!e.group; }).length;

  // Group breakdown
  var groups = {};
  entries.forEach(function(e) {
    var g = e.group || "(no group)";
    groups[g] = (groups[g] || 0) + 1;
  });
  var groupList = Object.keys(groups).sort(function(a,b){ return groups[b]-groups[a]; });

  console.log("\n  Total channels : " + entries.length);
  console.log("  With name      : " + withName);
  console.log("  With logo      : " + withLogo);
  console.log("  With group     : " + withGroup);
  console.log("\n  Top groups:");
  groupList.slice(0, 10).forEach(function(g) {
    console.log("    " + String(groups[g]).padStart(4) + "  " + g);
  });
  if (groupList.length > 10) console.log("    ... and " + (groupList.length-10) + " more groups");
}

// ── Main ───────────────────────────────────────────────────────────────────────

(async function() {
  console.log("=".repeat(65));
  console.log(" M3U8 Extractor  (name + logo + group aware)");
  console.log("=".repeat(65));
  console.log(" URL    : " + TARGET_URL);
  console.log(" Output : " + OUTPUT_FILE + "  [format=" + FORMAT + "]");
  console.log("-".repeat(65));

  var result;
  try {
    result = await fetchUrl(TARGET_URL);
  } catch(err) {
    console.error("X Fetch failed: " + err.message);
    process.exit(1);
  }

  var body       = result.body;
  var finalUrl   = result.finalUrl;
  var statusCode = result.statusCode;

  console.log("-".repeat(65));
  console.log(" Final URL  : " + finalUrl);
  console.log(" Status     : " + statusCode);
  console.log(" Body       : " + (body.length / 1024).toFixed(1) + " KB");
  console.log("=".repeat(65));

  var m3u8Entries = parseM3u8(body);
  var plainUrls   = parsePlainLines(body);

  // Collect all known URLs so regex sweep won't double-add them
  var knownUrls   = m3u8Entries.map(function(e){ return e.streamUrl; })
                    .concat(plainUrls.map(function(e){ return e.streamUrl; }));

  var regexExtra  = regexSweep(body, knownUrls);

  console.log("\n[M3U8 parser]   " + m3u8Entries.length + " entries  (with metadata)");
  console.log("[Plain lines]   " + plainUrls.length  + " URLs");
  console.log("[Regex sweep]   " + regexExtra.length + " extra URLs");

  // Merge (M3U8 entries first — they have metadata; extras appended)
  var allEntries = m3u8Entries.concat(
    plainUrls.filter(function(e) {
      return !m3u8Entries.some(function(m){ return m.streamUrl === e.streamUrl; });
    })
  ).concat(regexExtra);

  // Stats & table
  printStats(allEntries);
  console.log("");
  printTable(allEntries, 25);

  if (allEntries.length === 0) {
    console.log("\nWarning: Nothing found.");
    console.log("Re-run with DEBUG=1 to dump raw response -> debug.html");
    if (process.env.DEBUG) fs.writeFileSync("debug.html", body, "utf8");
    process.exit(0);
  }

  // Build output
  var output;
  var headerLine = (body.match(/^#EXTM3U[^\r\n]*/m) || ["#EXTM3U"])[0];

  if      (FORMAT === "m3u8") output = toM3u8(allEntries, headerLine);
  else if (FORMAT === "json") output = toJson(allEntries);
  else if (FORMAT === "csv")  output = toCsv(allEntries);
  else                        output = toPlainTxt(allEntries);

  fs.writeFileSync(OUTPUT_FILE, output, "utf8");
  console.log("\nSaved -> " + OUTPUT_FILE);

  if (process.env.DEBUG) {
    fs.writeFileSync("debug.html", body, "utf8");
    console.log("Debug: raw response -> debug.html");
  }
})();