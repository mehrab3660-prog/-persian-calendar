// وضعیت VPN - ویجت Scriptable
// ساخته شده توسط طلایی
//
// نشان می‌دهد VPN روشن است، خاموش است، یا وضعیت را نمی‌شود مطمئن فهمید.
// اندازه‌های کوچک، متوسط، بزرگ و ویجت‌های صفحه‌ی قفل را پشتیبانی می‌کند.

// <vpn-detect>
// A country other than Iran is not enough to say the VPN is on. Cloudflare's
// loc field is the datacenter, not the phone; a failed lookup must not become
// "on"; and a normal foreign ISP is not a VPN. "On" needs a tunnel flag
// (VPN, proxy, Tor, WARP), a datacenter/hosting flag outside Iran, or a known
// VPN network name. Otherwise: unknown.
//
// A refresh does not ask every service. The usual check is two HTTPS calls
// (an IP/WARP trace, then one flag lookup for that IP) and stops. Fallbacks
// run only when those two produce nothing usable.

const HOME_COUNTRY = "IR";
const VPN_CACHE_FILE = "vpn-status.json";
const VPN_CACHE_MS = 15 * 60 * 1000;
const FRESH_MS = 2 * 60 * 1000;
const LOOKUP_TIMEOUT = 1.5;

const REASON = {
  failed: "خطا در بررسی",
  conflict: "پاسخ‌ها ناسازگار",
  foreignClean: "آی‌پی خارجی، بدون VPN",
  foreignUnconfirmed: "کشور خارجی؛ VPN تأیید نشد",
  locationUnconfirmed: "مکان تأیید نشد",
  warp: "وارپ کلادفلر",
};

const COUNTRY_NAMES = {
  IR: "ایران", DE: "آلمان", NL: "هلند", FR: "فرانسه", GB: "انگلیس", US: "آمریکا",
  CA: "کانادا", TR: "ترکیه", AE: "امارات", SE: "سوئد", FI: "فنلاند", CH: "سوئیس",
  AT: "اتریش", IT: "ایتالیا", ES: "اسپانیا", PL: "لهستان", RU: "روسیه", AM: "ارمنستان",
  GE: "گرجستان", AZ: "آذربایجان", IQ: "عراق", QA: "قطر", OM: "عمان", BH: "بحرین",
  SG: "سنگاپور", JP: "ژاپن", HK: "هنگ‌کنگ", IN: "هند", LU: "لوکزامبورگ", NO: "نروژ",
  DK: "دانمارک", BE: "بلژیک", IE: "ایرلند", CZ: "چک", RO: "رومانی", BG: "بلغارستان",
  UA: "اوکراین", LT: "لیتوانی", LV: "لتونی", EE: "استونی", CY: "قبرس", GR: "یونان",
  AU: "استرالیا", KR: "کره جنوبی",
};

// Iranian operators, recognised in the ISP name the lookup service returns
const OPERATORS = [
  [/mobile communication|mci|hamrah/i, "همراه اول"],
  [/irancell|mtn/i, "ایرانسل"],
  [/rightel/i, "رایتل"],
  [/telecommunication company of iran|tci|mokhaberat/i, "مخابرات"],
  [/shatel/i, "شاتل"],
  [/asiatech/i, "آسیاتک"],
  [/pars ?online/i, "پارس‌آنلاین"],
  [/mobinnet/i, "مبین‌نت"],
  [/respina/i, "رسپینا"],
];

// Codes geo databases use for "unknown", not a real country.
const BAD_CODES = { XX: 1, T1: 1, A1: 1, A2: 1, O1: 1, AP: 1, EU: 1 };

// ISP names that are VPN exits or datacenters even when a flag service is down.
const STRONG_VPN_ORG = /\b(mullvad|nordvpn|expressvpn|surfshark|proton\s?vpn|cyberghost|ipvanish|windscribe|tunnelbear|purevpn|privado|azire|psiphon|hotspot shield|private internet access|wireguard|openvpn|m247|datacamp|31173|choopa|constant company|leaseweb|digitalocean|linode|hetzner|contabo|vultr|ovh|hostroyale|scaleway|zenlayer|cdn77|frantech|buyvm|psychz|colocrossing|serverius|packethub|24shells|ramnode|hostwinds|quasi networks|amazon|google cloud|microsoft azure)\b/i;
const WEAK_VPN_ORG = /\b(vpn|vps|datacenter|data\s*center|hosting)\b/i;

function flag(code) {
  if (!/^[A-Z]{2}$/.test(code || "")) return "🌐";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

function countryName(code, fallback) {
  return COUNTRY_NAMES[code] || fallback || code || "نامشخص";
}

function operatorName(org) {
  for (const [pattern, name] of OPERATORS) if (pattern.test(org || "")) return name;
  return null;
}

function cleanCode(value) {
  if (!value || typeof value !== "string") return "";
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || BAD_CODES[code]) return "";
  return code;
}

function cleanIp(value) {
  if (!value || typeof value !== "string") return "";
  const ip = value.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
  if (ip.indexOf(":") !== -1 && /^[0-9a-fA-F:]+$/.test(ip) && ip.length <= 45) return ip;
  return "";
}

function clip(value) {
  if (!value || typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function strongVpnOrg(org) {
  return STRONG_VPN_ORG.test(org || "");
}

function weakVpnOrg(org) {
  return WEAK_VPN_ORG.test(org || "");
}

function parseIpwho(j) {
  if (!j || j.success === false) return null;
  const code = cleanCode(j.country_code);
  if (!code) return null;
  const connection = j.connection || {};
  return { ip: cleanIp(j.ip), code: code, city: clip(j.city), org: clip(connection.isp || connection.org) };
}

function parseIpapiCo(j) {
  if (!j || j.error) return null;
  const code = cleanCode(j.country_code);
  if (!code) return null;
  return { ip: cleanIp(j.ip), code: code, city: clip(j.city), org: clip(j.org) };
}

function parseIfconfig(j) {
  if (!j) return null;
  const code = cleanCode(j.country_iso);
  if (!code) return null;
  return { ip: cleanIp(j.ip), code: code, city: clip(j.city), org: clip(j.asn_org) };
}

function parseCountryIs(j) {
  if (!j) return null;
  const code = cleanCode(j.country);
  if (!code) return null;
  return { ip: cleanIp(j.ip), code: code };
}

function parseGeojs(j) {
  if (!j) return null;
  const code = cleanCode(j.country_code);
  if (!code) return null;
  return { ip: cleanIp(j.ip), code: code, city: clip(j.city), org: clip(j.organization_name || j.organization) };
}

function parseIpSb(j) {
  if (!j) return null;
  const code = cleanCode(j.country_code);
  if (!code) return null;
  return { ip: cleanIp(j.ip), code: code, city: clip(j.city), org: clip(j.isp || j.organization || j.asn_organization) };
}

// Free ip-api.com includes proxy and hosting, but only over HTTP.
function parseIpApi(j) {
  if (!j || j.status !== "success") return null;
  const code = cleanCode(j.countryCode);
  if (!code) return null;
  const report = { ip: cleanIp(j.query), code: code, city: clip(j.city), org: clip(j.isp || j.org || j.as) };
  if (typeof j.proxy === "boolean") report.proxy = j.proxy;
  if (typeof j.hosting === "boolean") report.hosting = j.hosting;
  if (typeof report.proxy === "boolean" || typeof report.hosting === "boolean") report.flagSource = "ipapi";
  return report;
}

// loc here is Cloudflare's datacenter, so it is intentionally ignored.
// warp/gateway are the phone's own tunnel flags.
function parseTrace(text) {
  const body = String(text || "");
  const ipMatch = /^ip=(.+)$/m.exec(body);
  const warp = /^warp=(\w+)$/m.exec(body);
  const gateway = /^gateway=(\w+)$/m.exec(body);
  if (!ipMatch) return null;
  const ip = cleanIp(ipMatch[1]);
  const tunneled = (warp && warp[1] === "on") || (gateway && gateway[1] === "on");
  if (!ip && !tunneled) return null;
  return { ip: ip, warp: !!tunneled };
}

function parseIpquery(j) {
  if (!j || !j.location) return null;
  const code = cleanCode(j.location.country_code);
  if (!code) return null;
  const risk = j.risk || {};
  const isp = j.isp || {};
  const report = {
    ip: cleanIp(j.ip),
    code: code,
    city: clip(j.location.city),
    org: clip(isp.isp || isp.org),
    flagSource: "ipquery",
  };
  if (typeof risk.is_vpn === "boolean") report.vpn = risk.is_vpn;
  if (typeof risk.is_proxy === "boolean") report.proxy = risk.is_proxy;
  if (typeof risk.is_tor === "boolean") report.tor = risk.is_tor;
  if (typeof risk.is_datacenter === "boolean") report.hosting = risk.is_datacenter;
  return report;
}

function parseProxycheck(ip, j) {
  if (!j || j.status !== "ok" || !j[ip]) return null;
  const row = j[ip];
  const code = cleanCode(row.isocode);
  if (!code) return null;
  const type = String(row.type || "");
  // proxycheck often labels ordinary datacenters as "VPN", so this is only a hosting hint.
  const risky = row.proxy === "yes" || /vpn|tor/i.test(type);
  return {
    ip: ip,
    code: code,
    city: clip(row.city),
    org: clip(row.provider || row.organisation),
    flagSource: "proxycheck",
    proxy: row.proxy === "no" ? false : null,
    hosting: risky ? true : row.proxy === "no" ? false : null,
    tor: /tor/i.test(type) ? true : null,
  };
}

// Asked in order. Later ones run only if the earlier ones did not already decide.
const TRACE_SERVICE = { url: "https://1.1.1.1/cdn-cgi/trace", text: true, parse: parseTrace };
const FLAG_FALLBACK = {
  url: "http://ip-api.com/json/?fields=status,countryCode,city,isp,org,as,proxy,hosting,query",
  parse: parseIpApi,
};

function commonIp(list) {
  const counts = {};
  const order = [];
  for (let i = 0; i < list.length; i++) {
    const ip = list[i] && list[i].ip;
    if (!ip) continue;
    if (!counts[ip]) {
      counts[ip] = 0;
      order.push(ip);
    }
    counts[ip] += 1;
  }
  let best = "";
  let bestCount = 0;
  for (let i = 0; i < order.length; i++) {
    if (counts[order[i]] > bestCount) {
      best = order[i];
      bestCount = counts[order[i]];
    }
  }
  return best;
}

function fastestPing(list) {
  let best = null;
  for (let i = 0; i < list.length; i++) {
    const ping = list[i] && list[i].ping;
    if (typeof ping !== "number" || ping < 0 || ping > 60000) continue;
    if (best == null || ping < best) best = ping;
  }
  return best;
}

function codesOf(list) {
  const codes = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].code) codes.push(list[i].code);
  }
  return codes;
}

function majority(codes) {
  const counts = {};
  for (let i = 0; i < codes.length; i++) counts[codes[i]] = (counts[codes[i]] || 0) + 1;
  const entries = Object.keys(counts).map((code) => ({ code: code, n: counts[code] }));
  entries.sort((a, b) => b.n - a.n);
  if (!entries.length) return { code: "", votes: 0, agreed: false, conflict: false };
  const top = entries[0];
  const second = entries.length > 1 ? entries[1].n : 0;
  if (entries.length > 1 && top.n === second) return { code: "", votes: top.n, agreed: false, conflict: true };
  return { code: top.code, votes: top.n, agreed: top.n >= 2, conflict: false };
}

function sameNetwork(report, list) {
  if (!report || !report.ip) return false;
  const geos = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i] && !list[i].flagSource && list[i].ip) geos.push(list[i]);
  }
  if (!geos.length) return true;
  return commonIp(geos) === report.ip;
}

function matchingFlag(list) {
  const rank = { ipquery: 3, ipapi: 2, proxycheck: 1 };
  let best = null;
  let bestRank = 0;
  for (let i = 0; i < list.length; i++) {
    const report = list[i];
    if (!report || !report.flagSource || !rank[report.flagSource]) continue;
    if (!sameNetwork(report, list)) continue;
    if (rank[report.flagSource] > bestRank) {
      best = report;
      bestRank = rank[report.flagSource];
    }
  }
  return best;
}

function isClean(report) {
  if (!report || report.hosting !== false) return false;
  if (report.proxy === true || report.vpn === true || report.tor === true) return false;
  return report.proxy === false || report.vpn === false;
}

function displayFields(list, code, preferred) {
  let org = "";
  let city = "";
  const matching = [];
  for (let i = 0; i < list.length; i++) if (list[i] && list[i].code === code) matching.push(list[i]);
  const pool = matching.length ? matching : list;
  for (let i = 0; i < pool.length; i++) {
    if (!org && pool[i].org) org = pool[i].org;
    if (!city && pool[i].city) city = pool[i].city;
  }
  if (preferred && (!code || preferred.code === code)) {
    if (preferred.org) org = preferred.org;
    if (preferred.city) city = preferred.city;
  }
  const ip = (preferred && preferred.ip) || commonIp(list);
  return { ip: ip || "", code: code || "", city: city, org: org };
}

function judge(reports, probes) {
  const list = [];
  for (let i = 0; i < (reports || []).length; i++) if (reports[i]) list.push(reports[i]);
  const probesSafe = probes || {};
  const online = probesSafe.online === true || list.length > 0;
  const siteOpen = typeof probesSafe.siteOpen === "boolean" ? probesSafe.siteOpen : null;

  function pack(state, fields, reason, failed) {
    return {
      state: state,
      failed: !!failed,
      ip: (fields && fields.ip) || "",
      code: (fields && fields.code) || "",
      city: (fields && fields.city) || "",
      org: (fields && fields.org) || "",
      ping: fastestPing(list),
      reason: reason || "",
    };
  }

  if (!list.length && !online) return pack("offline", null, "", true);
  if (!list.length) return pack("unknown", null, REASON.failed, true);

  const flag = matchingFlag(list);
  const warped = list.some((report) => report.warp);
  const tunnel = warped || (flag && (flag.vpn === true || flag.proxy === true || flag.tor === true));
  if (tunnel) {
    const vote = majority(codesOf(list));
    const code = (flag && flag.code) || vote.code || "";
    return pack("on", displayFields(list, code, flag), code ? "" : (warped ? REASON.warp : ""), false);
  }

  const geoVote = majority(codesOf(list.filter((report) => !report.flagSource)));
  if (flag && flag.code === HOME_COUNTRY) {
    return pack("off", displayFields(list, HOME_COUNTRY, flag), "", false);
  }
  if (flag && flag.hosting === true && flag.code && flag.code !== HOME_COUNTRY) {
    // Several Iran answers plus a blocked site outweigh one foreign datacenter claim.
    if (geoVote.agreed && geoVote.code === HOME_COUNTRY && siteOpen !== true) {
      return pack("unknown", { ip: (flag && flag.ip) || commonIp(list) }, REASON.conflict, false);
    }
    // ipquery is the accurate keyless source. A lone HTTP or proxycheck "yes" still
    // needs a second sign: another country vote, the blocked site loading, or a known VPN name.
    const backed = flag.flagSource === "ipquery"
      || geoVote.agreed
      || siteOpen === true
      || strongVpnOrg(flag.org);
    if (backed) return pack("on", displayFields(list, flag.code, flag), "", false);
  }
  if (flag && isClean(flag) && flag.code && flag.code !== HOME_COUNTRY) {
    if (geoVote.agreed && geoVote.code === HOME_COUNTRY && siteOpen !== true) {
      return pack("off", displayFields(list, HOME_COUNTRY), "", false);
    }
    return pack("unknown", displayFields(list, flag.code, flag), REASON.foreignClean, false);
  }

  const vote = majority(codesOf(list));
  if (vote.conflict) return pack("unknown", { ip: commonIp(list) }, REASON.conflict, false);
  if (vote.code === HOME_COUNTRY) return pack("off", displayFields(list, HOME_COUNTRY), "", false);
  if (vote.code) {
    const fields = displayFields(list, vote.code);
    if (operatorName(fields.org)) return pack("unknown", fields, REASON.conflict, false);
    if (strongVpnOrg(fields.org) || (weakVpnOrg(fields.org) && (vote.agreed || siteOpen === true))) {
      return pack("on", fields, "", false);
    }
    if (vote.agreed && siteOpen === true && !flag) return pack("on", fields, "", false);
    if (siteOpen === false) return pack("unknown", fields, REASON.locationUnconfirmed, false);
    return pack("unknown", fields, REASON.foreignUnconfirmed, false);
  }
  return pack("unknown", { ip: commonIp(list) }, REASON.failed, true);
}

async function ask(service, timeout) {
  try {
    const request = new Request(service.url);
    request.timeoutInterval = timeout || LOOKUP_TIMEOUT;
    request.headers = {
      "User-Agent": "Mozilla/5.0",
      "Accept": service.text ? "text/plain" : "application/json",
    };
    const started = Date.now();
    const body = service.text ? await request.loadString() : await request.loadJSON();
    let result = null;
    try {
      result = service.parse(body);
    } catch (e) {
      return null;
    }
    if (!result || (!result.code && !result.ip && !result.warp)) return null;
    result.ping = Date.now() - started;
    return result;
  } catch (e) {
    return null;
  }
}

async function probeUrl(url, timeout) {
  try {
    const request = new Request(url);
    request.timeoutInterval = timeout || 1;
    request.headers = { "User-Agent": "Mozilla/5.0" };
    const body = await request.loadString();
    const status = request.response && request.response.statusCode;
    if (!status) return null;
    const head = String(body || "").slice(0, 600);
    if (status === 403 || status === 451) return false;
    if (/peyvandha|10\.10\.34\.|دسترسی شما|access has been denied|internet\.ir/i.test(head)) return false;
    if (status >= 200 && status < 400) return true;
    return null;
  } catch (e) {
    return false;
  }
}

// ipquery.io is keyless and reports vpn, proxy, tor, and datacenter for one IP.
async function askIpquery(ip, timeout) {
  try {
    const request = new Request("https://api.ipquery.io/" + encodeURIComponent(ip));
    request.timeoutInterval = timeout || LOOKUP_TIMEOUT;
    request.headers = { "User-Agent": "Mozilla/5.0", "Accept": "application/json" };
    const started = Date.now();
    const parsed = parseIpquery(await request.loadJSON());
    if (!parsed) return null;
    parsed.ping = Date.now() - started;
    return parsed;
  } catch (e) {
    return null;
  }
}

function withReports(reports, probes) {
  return judge(reports, probes || { online: reports.length > 0, siteOpen: null });
}

// Two calls cover the normal cases. Nothing after them is started once they decide.
async function lookup() {
  const reports = [];
  const trace = await ask(TRACE_SERVICE, LOOKUP_TIMEOUT);
  if (trace) reports.push(trace);
  if (trace && trace.warp) return withReports(reports);

  if (trace && trace.ip) {
    const risk = await askIpquery(trace.ip, LOOKUP_TIMEOUT);
    if (risk) reports.push(risk);
    if (risk && risk.code) return withReports(reports);
  }

  // Trace or the flag service failed. One fallback that carries country and flags.
  if (!reports.some((report) => report.code)) {
    const backup = await ask(FLAG_FALLBACK, 1.2);
    if (backup) reports.push(backup);
    if (backup && backup.code) return withReports(reports);
    const online = await probeUrl("https://connectivitycheck.gstatic.com/generate_204", 1);
    return judge(reports, { online: online === true, siteOpen: null });
  }
  return withReports(reports);
}

function readVpnCache(fm, path, maxAge) {
  try {
    if (!fm.fileExists(path)) return null;
    const saved = JSON.parse(fm.readString(path));
    if (!saved || !saved.status) return null;
    if (saved.status.state !== "on" && saved.status.state !== "off") return null;
    const checked = Date.parse(saved.checkedAt);
    if (!isFinite(checked)) return null;
    const age = Date.now() - checked;
    const limit = typeof maxAge === "number" ? maxAge : VPN_CACHE_MS;
    if (age >= limit || age < 0) return null;
    return saved;
  } catch (e) {
    return null;
  }
}

function writeVpnCache(fm, path, status, checkedAt) {
  try {
    fm.writeString(path, JSON.stringify({
      checkedAt: checkedAt.toISOString(),
      status: {
        state: status.state,
        ip: status.ip || "",
        code: status.code || "",
        city: status.city || "",
        org: status.org || "",
        ping: typeof status.ping === "number" ? status.ping : null,
        reason: status.reason || "",
      },
    }));
  } catch (e) {
    // a full documents folder should not blank the widget
  }
}

// Widget refreshes keep the last real on/off for 15 minutes when a check fails.
// Opening the script by hand shows the fresh failure instead of a saved answer.
function settleVpnStatus(fm, status) {
  const path = fm.joinPath(fm.documentsDirectory(), VPN_CACHE_FILE);
  const now = new Date();
  if (status && (status.state === "on" || status.state === "off") && !status.failed) {
    writeVpnCache(fm, path, status, now);
    return { status: status, checkedAt: now, cached: false };
  }
  const inWidget = typeof config !== "undefined" && config.runsInWidget;
  if (status && status.failed && inWidget) {
    const saved = readVpnCache(fm, path);
    if (saved) {
      return {
        status: {
          state: saved.status.state,
          ip: saved.status.ip || "",
          code: saved.status.code || "",
          city: saved.status.city || "",
          org: saved.status.org || "",
          ping: typeof saved.status.ping === "number" ? saved.status.ping : null,
          reason: saved.status.reason || "",
          failed: false,
        },
        checkedAt: new Date(saved.checkedAt),
        cached: true,
      };
    }
  }
  return { status: status, checkedAt: now, cached: false };
}

// Background widget refreshes reuse an on/off answer from the last two minutes
// and do not touch the network. Opening the script by hand always checks.
function freshWidgetCache(fm) {
  if (typeof config === "undefined" || !config.runsInWidget) return null;
  const path = fm.joinPath(fm.documentsDirectory(), VPN_CACHE_FILE);
  const saved = readVpnCache(fm, path, FRESH_MS);
  if (!saved) return null;
  return {
    status: {
      state: saved.status.state,
      ip: saved.status.ip || "",
      code: saved.status.code || "",
      city: saved.status.city || "",
      org: saved.status.org || "",
      ping: typeof saved.status.ping === "number" ? saved.status.ping : null,
      reason: saved.status.reason || "",
      failed: false,
    },
    checkedAt: new Date(saved.checkedAt),
    cached: true,
  };
}
// </vpn-detect>

function fa(value) {
  return String(value).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
}

function describe(status, checkedAt, cached) {
  const time = fa(checkedAt.toTimeString().slice(0, 5));
  const view = {
    time: time,
    cached: !!cached,
    ping: status && status.ping != null ? status.ping : null,
    ip: (status && status.ip) || "",
  };
  if (!status || status.state === "offline") {
    return Object.assign(view, {
      state: "offline", title: "بدون اینترنت", flag: "📵", place: "", detail: "", ip: "", ping: null,
    });
  }
  if (status.state === "unknown") {
    return Object.assign(view, {
      state: "unknown",
      title: "نامشخص",
      flag: status.code ? flag(status.code) : "❔",
      place: [status.code ? countryName(status.code) : "", status.reason].filter(Boolean).join(" · "),
      detail: status.city || "",
    });
  }
  const on = status.state === "on";
  const country = status.code ? countryName(status.code) : "";
  const operator = on ? null : operatorName(status.org);
  const place = on
    ? [country || status.reason, status.city]
    : [country, operator || status.city];
  return Object.assign(view, {
    state: on ? "on" : "off",
    title: on ? "VPN روشن" : "VPN خاموش",
    flag: status.code ? flag(status.code) : "🌐",
    place: place.filter(Boolean).join(" · "),
    detail: status.org || "",
  });
}

function addLine(stack, text, size, color, bold = false) {
  const line = stack.addText(text);
  line.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  line.textColor = color;
  line.lineLimit = 1;
  line.minimumScaleFactor = 0.6;
  return line;
}

function buildWidget(info, family) {
  const text = Color.dynamic(new Color("#1c1c1e"), new Color("#f2f2f7"));
  const muted = Color.dynamic(new Color("#6e6e73"), new Color("#a1a1a6"));
  const colors = {
    on: new Color("#248a3d"),
    off: new Color("#d70015"),
    offline: new Color("#ff9f0a"),
    unknown: new Color("#8e8e93"),
  };
  const dark = info.state === "on"
    ? new Color("#30d158")
    : info.state === "unknown" ? new Color("#aeaeb2") : colors[info.state];
  const stateColor = Color.dynamic(colors[info.state], dark);
  const dot = { on: "🟢", off: "🔴", offline: "🟠", unknown: "❔" }[info.state];
  const ping = info.ping != null ? `${fa(info.ping)}ms` : "";
  const timeLabel = info.cached ? `آخرین سالم: ${info.time}` : `بررسی: ${info.time}`;

  const widget = new ListWidget();
  // Tapping the widget runs the check again right away
  widget.url = `scriptable:///run/${encodeURIComponent(Script.name())}`;
  widget.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);

  if (family === "accessoryInline") {
    const head = info.place ? info.place.split(" · ")[0] : "";
    const extra = head && (info.state === "on" || info.state === "unknown") ? " · " + head : "";
    widget.addText(`${dot} ${info.title}${extra}`);
    return widget;
  }
  if (family === "accessoryCircular") {
    widget.addAccessoryWidgetBackground = true;
    const icon = widget.addText(info.flag);
    icon.font = Font.systemFont(26);
    icon.centerAlignText();
    const label = { on: "روشن", off: "خاموش", offline: "قطع", unknown: "نامشخص" }[info.state];
    const state = widget.addText(label);
    state.font = Font.boldSystemFont(10);
    state.centerAlignText();
    return widget;
  }
  if (family === "accessoryRectangular") {
    addLine(widget, `${dot} ${info.title}`, 15, Color.white(), true);
    const second = info.state === "offline"
      ? `بررسی ${info.time}`
      : [info.place, ping, info.cached ? info.time : ""].filter(Boolean).join(" · ");
    addLine(widget, second, 12, Color.white());
    return widget;
  }

  widget.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));
  widget.setPadding(14, 14, 14, 14);

  if (family === "small") {
    widget.addSpacer();
    const icon = widget.addText(info.flag);
    icon.font = Font.systemFont(36);
    icon.centerAlignText();
    widget.addSpacer(4);
    addLine(widget, info.title, 18, stateColor, true).centerAlignText();
    if (info.place) addLine(widget, info.place, 12, muted).centerAlignText();
    const foot = info.cached
      ? `آخرین بررسی سالم ${info.time}`
      : (info.ip ? `IP: ${info.ip}` : `آخرین بررسی ${info.time}`);
    addLine(widget, foot, 10, muted).centerAlignText();
    widget.addSpacer();
    return widget;
  }

  // medium and large: status and place on the right, ping on the left
  const row = widget.addStack();
  row.centerAlignContent();
  const left = row.addStack();
  left.layoutVertically();
  left.centerAlignContent();
  addLine(left, "سرعت پاسخ", 11, muted).centerAlignText();
  addLine(left, info.ping != null ? fa(info.ping) : "—", 30, text, true).centerAlignText();
  addLine(left, "میلی‌ثانیه", 11, muted).centerAlignText();
  left.addSpacer(6);
  addLine(left, timeLabel, 10, muted).centerAlignText();
  row.addSpacer();
  const right = row.addStack();
  right.layoutVertically();
  addLine(right, "وضعیت اتصال", 11, muted).rightAlignText();
  addLine(right, `${dot} ${info.title}`, 20, stateColor, true).rightAlignText();
  right.addSpacer(4);
  if (info.place) addLine(right, `${info.flag} ${info.place}`, 14, text).rightAlignText();
  if (info.detail) addLine(right, info.detail, 11, muted).rightAlignText();
  if (info.ip) addLine(right, `IP: ${info.ip}`, 11, muted).rightAlignText();
  widget.addSpacer();
  addLine(widget, "ساخته شده توسط طلایی", 8, muted).centerAlignText();
  return widget;
}

async function main() {
  const fm = FileManager.local();
  const fresh = freshWidgetCache(fm);
  const settled = fresh ? fresh : settleVpnStatus(fm, await lookup());
  const widget = buildWidget(describe(settled.status, settled.checkedAt, settled.cached), config.widgetFamily || "medium");
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
  Script.complete();
}

await main();
