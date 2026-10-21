// تقویم + باتری + VPN - ویجت Scriptable
// ساخته شده توسط طلایی
//
// تاریخ شمسی و مناسبت امروز، شارژ باتری و وضعیت VPN را با هم نشان می‌دهد.
// اندازه‌های کوچک، متوسط، بزرگ و ویجت‌های صفحه‌ی قفل را پشتیبانی می‌کند.

// ---------- تقویم شمسی ----------
const CALENDAR_URL =
  "https://raw.githubusercontent.com/mehrab3660-prog/-persian-calendar/main/calendar.ics";
const CACHE_FILE = "persian-calendar.ics";

const MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
// Indexed by Date.getDay(): 0 is Sunday
const WEEKDAYS = ["یک‌شنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه", "شنبه"];

function g2j(gy, gm, gd) {
  const gDM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100)
    + Math.floor((gy2 + 399) / 400) + gd + gDM[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  if (days < 186) return [jy, 1 + Math.floor(days / 31), 1 + (days % 31)];
  return [jy, 7 + Math.floor((days - 186) / 30), 1 + ((days - 186) % 30)];
}

function fa(value) {
  return String(value).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
}

function dateKey(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function keyToDate(key) {
  return new Date(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8));
}

function unescapeText(text) {
  return text.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

// Returns {YYYYMMDD: {title, holiday}} for the occasion events of the calendar
function parseCalendar(ics) {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const days = {};
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const uid = /^UID:jalali-info-(\d{8})@/m.exec(block);
    const summary = /^SUMMARY:(.*)$/m.exec(block);
    if (!uid || !summary) continue;
    days[uid[1]] = {
      title: unescapeText(summary[1].trim()),
      holiday: /^CATEGORIES:/m.test(block),
    };
  }
  return days;
}

function nextHoliday(days, today) {
  const todayKey = dateKey(today);
  const key = Object.keys(days).filter((k) => k > todayKey && days[k].holiday).sort()[0];
  if (!key) return null;
  const inDays = Math.round((keyToDate(key) - keyToDate(todayKey)) / 86400000);
  return { title: days[key].title.replace(/\s*🔴$/, ""), inDays };
}

// What the widget shows for a given day
function describeDate(days, today) {
  const [jy, jm, jd] = g2j(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const occasion = days[dateKey(today)];
  const weekday = WEEKDAYS[today.getDay()];
  return {
    day: fa(jd),
    month: MONTHS[jm - 1],
    year: fa(jy),
    weekday,
    // Weekday-only events mean "no occasion"
    occasion: occasion && occasion.title !== weekday ? occasion.title : null,
    // the occasion itself is an official holiday (red occasion text)
    occasionHoliday: Boolean(occasion && occasion.holiday),
    // the date is red on official holidays and Fridays
    holiday: Boolean(occasion && occasion.holiday) || today.getDay() === 5,
    next: nextHoliday(days, today),
  };
}

async function loadCalendar() {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.documentsDirectory(), CACHE_FILE);
  // The calendar rarely changes: reuse the saved copy for 12 hours so each refresh stays fast
  if (fm.fileExists(path) && Date.now() - fm.modificationDate(path).getTime() < 12 * 3600 * 1000) {
    return parseCalendar(fm.readString(path));
  }
  try {
    const request = new Request(CALENDAR_URL);
    request.timeoutInterval = 15;
    const text = await request.loadString();
    if (text.includes("BEGIN:VCALENDAR")) {
      fm.writeString(path, text);
      return parseCalendar(text);
    }
  } catch (e) {
    // offline: fall back to the last copy
  }
  return fm.fileExists(path) ? parseCalendar(fm.readString(path)) : {};
}

// ---------- VPN ----------
// <vpn-detect>
// A country other than Iran is not enough to say the VPN is on. Cloudflare's
// loc field is the datacenter, not the phone; a failed lookup must not become
// "on"; and a normal foreign ISP is not a VPN. "On" needs a tunnel flag
// (VPN, proxy, Tor, WARP), a datacenter/hosting flag outside Iran, a known
// VPN network name, or two geo sources agreeing on a foreign country while a
// site that is usually blocked in Iran actually loads. Otherwise: unknown.

const HOME_COUNTRY = "IR";
const VPN_CACHE_FILE = "vpn-status.json";
const VPN_CACHE_MS = 15 * 60 * 1000;
const LOOKUP_TIMEOUT = 4;

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

const SERVICES = [
  { url: "https://ipwho.is/", parse: parseIpwho },
  { url: "https://ipapi.co/json/", parse: parseIpapiCo },
  { url: "https://ifconfig.co/json", parse: parseIfconfig },
  { url: "https://api.country.is/", parse: parseCountryIs },
  { url: "https://get.geojs.io/v1/ip/geo.json", parse: parseGeojs },
  { url: "https://api.ip.sb/geoip", parse: parseIpSb },
  {
    url: "http://ip-api.com/json/?fields=status,countryCode,city,isp,org,as,proxy,hosting,query",
    parse: parseIpApi,
  },
  { url: "https://1.1.1.1/cdn-cgi/trace", text: true, parse: parseTrace },
];

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

async function ask(service) {
  try {
    const request = new Request(service.url);
    request.timeoutInterval = LOOKUP_TIMEOUT;
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

async function probeUrl(url) {
  try {
    const request = new Request(url);
    request.timeoutInterval = LOOKUP_TIMEOUT;
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

function probeNetwork() {
  return Promise.all([
    probeUrl("https://connectivitycheck.gstatic.com/generate_204"),
    probeUrl("https://www.youtube.com/generate_204"),
  ]).then((answers) => ({ online: answers[0] === true, siteOpen: answers[1] }));
}

async function loadJson(url) {
  const request = new Request(url);
  request.timeoutInterval = LOOKUP_TIMEOUT;
  request.headers = { "User-Agent": "Mozilla/5.0", "Accept": "application/json" };
  const started = Date.now();
  const body = await request.loadJSON();
  return { body: body, ping: Date.now() - started };
}

// ipquery.io is keyless and reports vpn/proxy/tor/datacenter. proxycheck.io is the fallback.
async function riskForIp(ip) {
  try {
    const loaded = await loadJson("https://api.ipquery.io/" + encodeURIComponent(ip));
    const parsed = parseIpquery(loaded.body);
    if (!parsed) throw new Error("no ipquery");
    parsed.ping = loaded.ping;
    return parsed;
  } catch (e) {
    try {
      const loaded = await loadJson("https://proxycheck.io/v2/" + encodeURIComponent(ip) + "?vpn=1&asn=1");
      const parsed = parseProxycheck(ip, loaded.body);
      if (!parsed) return null;
      parsed.ping = loaded.ping;
      return parsed;
    } catch (e2) {
      return null;
    }
  }
}

async function lookup() {
  const probesPromise = probeNetwork();
  const reports = [];
  await Promise.all(SERVICES.map(async (service) => {
    const result = await ask(service);
    if (result) reports.push(result);
  }));
  const ip = commonIp(reports);
  if (ip) {
    const extra = await riskForIp(ip);
    if (extra) reports.push(extra);
  }
  return judge(reports, await probesPromise);
}

function readVpnCache(fm, path) {
  try {
    if (!fm.fileExists(path)) return null;
    const saved = JSON.parse(fm.readString(path));
    if (!saved || !saved.status) return null;
    if (saved.status.state !== "on" && saved.status.state !== "off") return null;
    const checked = Date.parse(saved.checkedAt);
    if (!isFinite(checked)) return null;
    const age = Date.now() - checked;
    if (age >= VPN_CACHE_MS || age < 0) return null;
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
// </vpn-detect>

// The network name: a known Iranian operator, else the first words of the ISP name
function networkName(org) {
  const known = operatorName(org);
  if (known) return known;
  const name = (org || "").replace(/^AS\d+\s*/, "").split(/[ ,]+/).slice(0, 2).join(" ");
  return name || null;
}

function describeVpn(status, checkedAt, cached) {
  const time = fa(checkedAt.toTimeString().slice(0, 5));
  if (!status || status.state === "offline") {
    return { state: "offline", title: "بدون اینترنت", dot: "🟠", short: "بدون اینترنت", long: "بدون اینترنت", ip: "", ping: null };
  }
  if (status.state === "unknown") {
    const where = status.code ? `${flag(status.code)} ${countryName(status.code)}` : "";
    const why = status.reason || "خطا در بررسی";
    return {
      state: "unknown",
      title: "نامشخص",
      dot: "❔",
      short: where ? `نامشخص · ${where}` : "نامشخص",
      long: where ? `نامشخص · ${where} · ${why}` : `نامشخص · ${why}`,
      ip: status.ip || "",
      ping: status.ping,
    };
  }
  const on = status.state === "on";
  const where = status.code
    ? `${flag(status.code)} ${countryName(status.code)}`
    : (status.reason || "وارپ کلادفلر");
  const via = on ? status.city : networkName(status.org);
  const cachedNote = cached ? ` · ${time}` : "";
  return {
    state: status.state,
    title: on ? "VPN وصل" : "VPN قطع",
    dot: on ? "🟢" : "🔴",
    short: on ? `وصل · ${where}` : `قطع · ${via || where}`,
    long: `${on ? "VPN وصل" : "VPN قطع"} · ${where}${via ? "، " + via : ""}${cachedNote}`,
    ip: status.ip || "",
    ping: status.ping,
  };
}

// ---------- باتری ----------

function describeBattery() {
  const level = Math.round(Device.batteryLevel() * 100);
  const charging = Device.isCharging();
  const color = charging || level > 50 ? "#34c759" : level > 20 ? "#ff9f0a" : "#ff3b30";
  return { level, charging, color, text: `${fa(level)}٪`, hint: charging ? "⚡ در حال شارژ" : level <= 20 ? "شارژر را وصل کنید" : "باتری" };
}

// A ring drawn as an image: Scriptable has no arc shapes, so the arc is many short lines
function ringImage(fraction, color, label, size, textColor, trackColor) {
  const dc = new DrawContext();
  dc.size = new Size(size, size);
  dc.opaque = false;
  dc.respectScreenScale = true;
  const width = size * 0.12;
  const center = size / 2;
  const radius = center - width / 2 - 1;
  const pointAt = (to) => {
    const angle = -Math.PI / 2 + 2 * Math.PI * to;
    return new Point(center + radius * Math.cos(angle), center + radius * Math.sin(angle));
  };
  const arc = (to, stroke) => {
    const steps = Math.max(2, Math.round(180 * to));
    const path = new Path();
    for (let i = 0; i <= steps; i++) {
      if (i === 0) path.move(pointAt(0));
      else path.addLine(pointAt(to * (i / steps)));
    }
    dc.addPath(path);
    dc.setStrokeColor(stroke);
    dc.setLineWidth(width);
    dc.strokePath();
    // round caps at both ends
    dc.setFillColor(stroke);
    for (const end of [pointAt(0), pointAt(to)]) {
      dc.fillEllipse(new Rect(end.x - width / 2, end.y - width / 2, width, width));
    }
  };
  arc(1, trackColor);
  if (fraction > 0) arc(Math.min(fraction, 0.999), new Color(color));
  dc.setFont(Font.boldRoundedSystemFont(size * 0.24));
  dc.setTextColor(textColor);
  dc.setTextAlignedCenter();
  dc.drawTextInRect(label, new Rect(0, center - size * 0.16, size, size * 0.32));
  return dc.getImage();
}

// A battery icon: outlined body, coloured fill with a glossy top, terminal nub and label
function batteryImage(fraction, color, label, width, height) {
  const dc = new DrawContext();
  dc.size = new Size(width, height);
  dc.opaque = false;
  dc.respectScreenScale = true;
  const line = Math.max(2, height * 0.07);
  const nub = width * 0.06;
  const bodyWidth = width - nub - line;
  const outline = new Color("#ffffff", 0.55);

  const body = new Path();
  body.addRoundedRect(new Rect(line / 2, line / 2, bodyWidth - line, height - line), height * 0.22, height * 0.22);
  dc.addPath(body);
  dc.setStrokeColor(outline);
  dc.setLineWidth(line);
  dc.strokePath();

  const pad = line * 1.6;
  const innerHeight = height - 2 * pad;
  const innerWidth = (bodyWidth - 2 * pad) * Math.max(0.04, Math.min(fraction, 1));
  const fill = new Path();
  fill.addRoundedRect(new Rect(pad, pad, innerWidth, innerHeight), height * 0.14, height * 0.14);
  dc.addPath(fill);
  dc.setFillColor(new Color(color));
  dc.fillPath();
  const gloss = new Path();
  gloss.addRoundedRect(new Rect(pad, pad, innerWidth, innerHeight * 0.45), height * 0.14, height * 0.14);
  dc.addPath(gloss);
  dc.setFillColor(new Color("#ffffff", 0.22));
  dc.fillPath();

  const terminal = new Path();
  terminal.addRoundedRect(new Rect(bodyWidth + line * 0.3, height * 0.32, nub, height * 0.36), nub / 2, nub / 2);
  dc.addPath(terminal);
  dc.setFillColor(outline);
  dc.fillPath();

  if (label) {
    dc.setFont(Font.heavyRoundedSystemFont(height * 0.44));
    dc.setTextAlignedCenter();
    // a soft shadow keeps the label readable on any fill
    dc.setTextColor(new Color("#000000", 0.35));
    dc.drawTextInRect(label, new Rect(1, height * 0.24 + 1, bodyWidth, height * 0.56));
    dc.setTextColor(WHITE);
    dc.drawTextInRect(label, new Rect(0, height * 0.24, bodyWidth, height * 0.56));
  }
  return dc.getImage();
}

// ---------- ویجت ----------

const WHITE = new Color("#ffffff");
const SOFT = new Color("#ffffff", 0.7);
const FAINT = new Color("#ffffff", 0.16);
const CORAL = new Color("#ff7a7a");

function addLine(stack, text, size, color, bold = false) {
  const line = stack.addText(text);
  line.font = bold ? Font.boldRoundedSystemFont(size) : Font.mediumRoundedSystemFont(size);
  line.textColor = color;
  line.lineLimit = 1;
  line.minimumScaleFactor = 0.6;
  return line;
}

// A rounded capsule with a coloured dot and a label
function pill(stack, label, dotColor) {
  const capsule = stack.addStack();
  capsule.backgroundColor = FAINT;
  capsule.cornerRadius = 10;
  capsule.setPadding(4, 9, 4, 9);
  capsule.centerAlignContent();
  if (dotColor) {
    const dot = capsule.addStack();
    dot.size = new Size(7, 7);
    dot.cornerRadius = 3.5;
    dot.backgroundColor = dotColor;
    capsule.addSpacer(5);
  }
  addLine(capsule, label, 11, WHITE, true);
  return capsule;
}

function background(widget, holiday) {
  const gradient = new LinearGradient();
  gradient.colors = holiday
    ? [new Color("#5b2a6e"), new Color("#2a1638")]
    : [new Color("#4a3d8f"), new Color("#1d1a3d")];
  gradient.locations = [0, 1];
  gradient.startPoint = new Point(1, 0);
  gradient.endPoint = new Point(0, 1);
  widget.backgroundGradient = gradient;
}

function buildWidget(date, battery, vpn, family) {
  const vpnDot = new Color({ on: "#30d158", off: "#ff453a", offline: "#ff9f0a", unknown: "#aeaeb2" }[vpn.state]);
  const dayColor = date.holiday ? CORAL : WHITE;

  const widget = new ListWidget();
  widget.url = `scriptable:///run/${encodeURIComponent(Script.name())}`;

  if (family === "accessoryInline") {
    widget.addText(`${date.day} ${date.month} · 🔋${battery.text} · ${vpn.dot} ${vpn.short}`);
    return widget;
  }
  if (family === "accessoryCircular") {
    widget.addAccessoryWidgetBackground = true;
    const ring = widget.addImage(ringImage(battery.level / 100, "#ffffff", battery.text, 120, WHITE, FAINT));
    ring.centerAlignImage();
    return widget;
  }
  if (family === "accessoryRectangular") {
    addLine(widget, `${date.weekday} ${date.day} ${date.month}`, 15, WHITE, true);
    addLine(widget, `🔋 ${battery.text}${battery.charging ? " ⚡" : ""}`, 12, WHITE);
    addLine(widget, `${vpn.dot} ${vpn.short}`, 12, WHITE);
    return widget;
  }

  background(widget, date.holiday);

  if (family === "small") {
    widget.setPadding(12, 12, 12, 12);
    const top = widget.addStack();
    top.centerAlignContent();
    const batteryStack = top.addStack();
    batteryStack.layoutVertically();
    const icon = batteryStack.addImage(batteryImage(battery.level / 100, battery.color, "", 88, 42));
    icon.imageSize = new Size(44, 21);
    addLine(batteryStack, `${battery.charging ? "⚡" : ""}${battery.text}`, 12, WHITE, true);
    top.addSpacer();
    const titles = top.addStack();
    titles.layoutVertically();
    addLine(titles, date.weekday, 14, dayColor, true).rightAlignText();
    addLine(titles, `${date.month} ${date.year}`, 11, SOFT).rightAlignText();
    widget.addSpacer();
    const dayRow = widget.addStack();
    dayRow.addSpacer();
    addLine(dayRow, date.day, 50, dayColor, true);
    dayRow.addSpacer();
    if (date.occasion) addLine(widget, date.occasion, 10, date.occasionHoliday ? CORAL : SOFT).centerAlignText();
    widget.addSpacer();
    const bottom = widget.addStack();
    bottom.addSpacer();
    pill(bottom, vpn.short, vpnDot);
    bottom.addSpacer();
    return widget;
  }

  // medium and large: the battery on the left, the date on the right, capsules below
  const large = family === "large";
  widget.setPadding(14, 16, 14, 16);
  const row = widget.addStack();
  row.centerAlignContent();
  const left = row.addStack();
  left.layoutVertically();
  left.centerAlignContent();
  const iconWidth = large ? 130 : 110;
  const iconHeight = Math.round(iconWidth * 0.46);
  const icon = left.addImage(batteryImage(battery.level / 100, battery.color,
    `${battery.charging ? "⚡" : ""}${battery.text}`, iconWidth * 2, iconHeight * 2));
  icon.imageSize = new Size(iconWidth, iconHeight);
  left.addSpacer(6);
  const hint = left.addStack();
  hint.size = new Size(iconWidth, 0);
  addLine(hint, battery.hint, 10, battery.level <= 20 && !battery.charging ? CORAL : SOFT).centerAlignText();
  row.addSpacer();
  const right = row.addStack();
  right.layoutVertically();
  const weekdayRow = right.addStack();
  weekdayRow.addSpacer();
  addLine(weekdayRow, date.weekday, 15, dayColor, true);
  const dayRow = right.addStack();
  dayRow.addSpacer();
  addLine(dayRow, date.day, large ? 64 : 50, dayColor, true);
  const monthRow = right.addStack();
  monthRow.addSpacer();
  addLine(monthRow, `${date.month} ${date.year}`, 13, SOFT);
  if (date.occasion) {
    right.addSpacer(3);
    const occasionRow = right.addStack();
    occasionRow.addSpacer();
    addLine(occasionRow, date.occasion, 12, date.occasionHoliday ? CORAL : WHITE, true);
  }

  widget.addSpacer(large ? 16 : 8);
  const bottom = widget.addStack();
  bottom.centerAlignContent();
  if (date.next) {
    pill(bottom, date.next.inDays === 1 ? "فردا تعطیل" : `${fa(date.next.inDays)} روز تا تعطیلی`, CORAL);
  }
  bottom.addSpacer();
  pill(bottom, vpn.long, vpnDot);

  if (large) {
    widget.addSpacer(12);
    if (date.next) addLine(widget, `تعطیلی بعد: ${date.next.title}`, 12, SOFT).rightAlignText();
    if (vpn.ip) addLine(widget, `IP: ${vpn.ip}${vpn.ping != null ? " · " + fa(vpn.ping) + "ms" : ""}`, 11, SOFT).rightAlignText();
    widget.addSpacer();
    addLine(widget, "ساخته شده توسط طلایی", 8, SOFT).centerAlignText();
  }
  return widget;
}

// ---------- صفحه‌ی انیمیشنی (با زدن روی ویجت) ----------

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// A full-screen page: a big battery with a waving liquid, rising bubbles while charging,
// the percentage counting up, and the date and VPN status below
function animationHTML(date, battery, vpn) {
  const dot = { on: "#30d158", off: "#ff453a", offline: "#ff9f0a", unknown: "#aeaeb2" }[vpn.state];
  const bubbles = battery.charging
    ? Array.from({ length: 14 }, (_, i) => {
      const size = 6 + (i * 7) % 14;
      return `<i class="bubble" style="left:${(i * 37) % 86 + 5}%;width:${size}px;height:${size}px;`
        + `animation-delay:${(i * 0.43) % 3}s;animation-duration:${2.4 + (i % 5) * 0.5}s"></i>`;
    }).join("")
    : "";
  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>
*{box-sizing:border-box;margin:0}
body{min-height:100vh;font-family:-apple-system,system-ui;color:#fff;overflow:hidden;
 background:radial-gradient(circle at 30% 20%,#4a3d8f,#1d1a3d 55%,#0d0c1d);
 display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;padding:40px 20px}
.battery{position:relative;width:170px;height:300px;border-radius:38px;border:6px solid rgba(255,255,255,.55);
 padding:9px;box-shadow:0 0 60px ${battery.color}55;animation:pulse 2.6s ease-in-out infinite}
.battery:before{content:"";position:absolute;top:-22px;left:50%;transform:translateX(-50%);
 width:56px;height:14px;border-radius:7px 7px 0 0;background:rgba(255,255,255,.55)}
.tank{position:relative;width:100%;height:100%;border-radius:28px;overflow:hidden;background:rgba(255,255,255,.07)}
.liquid{position:absolute;left:0;right:0;bottom:0;height:0;background:${battery.color};
 transition:height 1.8s cubic-bezier(.2,.8,.2,1)}
.wave{position:absolute;left:0;width:200%;height:26px;top:-24px;animation:wave 3s linear infinite}
.wave.back{opacity:.45;animation-duration:5s;animation-direction:reverse;top:-20px}
.wave path{fill:${battery.color}}
.gloss{position:absolute;inset:0;border-radius:28px;
 background:linear-gradient(90deg,rgba(255,255,255,.22),rgba(255,255,255,0) 35%,rgba(255,255,255,0) 70%,rgba(255,255,255,.12))}
.bubble{position:absolute;bottom:-20px;border-radius:50%;background:rgba(255,255,255,.55);animation:rise linear infinite}
.label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
 text-shadow:0 2px 10px rgba(0,0,0,.45)}
.percent{font-size:64px;font-weight:800;letter-spacing:-1px}
.bolt{font-size:34px;animation:blink 1.4s ease-in-out infinite}
.date{text-align:center}
.weekday{font-size:20px;font-weight:700;color:${date.holiday ? "#ff7a7a" : "#fff"}}
.day{font-size:72px;font-weight:800;line-height:1.05;color:${date.holiday ? "#ff7a7a" : "#fff"}}
.month{font-size:18px;opacity:.7}
.occasion{margin-top:8px;font-size:16px;font-weight:600}
.pills{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.pill{background:rgba(255,255,255,.14);border-radius:14px;padding:7px 14px;font-size:15px;font-weight:600;
 display:flex;align-items:center;gap:8px;backdrop-filter:blur(10px)}
.pill i{width:9px;height:9px;border-radius:50%}
.sign{position:fixed;bottom:22px;font-size:11px;opacity:.45}
@keyframes wave{to{transform:translateX(-50%)}}
@keyframes rise{0%{transform:translateY(0);opacity:0}15%{opacity:1}100%{transform:translateY(-300px);opacity:0}}
@keyframes blink{50%{opacity:.35;transform:scale(.85)}}
@keyframes pulse{50%{box-shadow:0 0 90px ${battery.color}88}}
</style></head><body>
<div class="battery"><div class="tank">
 <div class="liquid" id="liquid">
  <svg class="wave back" viewBox="0 0 400 26" preserveAspectRatio="none"><path d="M0 13 Q50 0 100 13 T200 13 T300 13 T400 13 V26 H0Z"/></svg>
  <svg class="wave" viewBox="0 0 400 26" preserveAspectRatio="none"><path d="M0 13 Q50 26 100 13 T200 13 T300 13 T400 13 V26 H0Z"/></svg>
 </div>
 ${bubbles}<div class="gloss"></div>
 <div class="label"><div class="percent" id="percent">۰٪</div>${battery.charging ? '<div class="bolt">⚡</div>' : ""}</div>
</div></div>
<div class="date">
 <div class="weekday">${escapeHtml(date.weekday)}</div>
 <div class="day">${escapeHtml(date.day)}</div>
 <div class="month">${escapeHtml(date.month)} ${escapeHtml(date.year)}</div>
 ${date.occasion ? `<div class="occasion">${escapeHtml(date.occasion)}</div>` : ""}
</div>
<div class="pills">
 <div class="pill"><i style="background:${dot}"></i>${escapeHtml(vpn.long)}</div>
 <div class="pill">🔋 ${escapeHtml(battery.hint)}</div>
</div>
<div class="sign">ساخته شده توسط طلایی</div>
<script>
const level = ${battery.level};
const fa = (n) => String(n).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
setTimeout(() => { document.getElementById("liquid").style.height = level + "%"; }, 150);
const started = performance.now();
(function count(now) {
  const t = Math.min(1, (now - started) / 1600);
  const eased = 1 - Math.pow(1 - t, 3);
  document.getElementById("percent").textContent = fa(Math.round(level * eased)) + "٪";
  if (t < 1) requestAnimationFrame(count);
})(started);
</script></body></html>`;
}

async function main() {
  const today = new Date();
  const fm = FileManager.local();
  const [days, judged] = await Promise.all([loadCalendar(), lookup()]);
  const settled = settleVpnStatus(fm, judged);
  const date = describeDate(days, today);
  const battery = describeBattery();
  const vpn = describeVpn(settled.status, settled.checkedAt, settled.cached);
  if (config.runsInWidget) {
    const widget = buildWidget(date, battery, vpn, config.widgetFamily || "medium");
    // Ask for a redraw after a minute; iOS decides the real moment from its daily budget
    widget.refreshAfterDate = new Date(Date.now() + 60 * 1000);
    Script.setWidget(widget);
  } else {
    // Opened from the widget or the app: the animated full-screen page
    const page = new WebView();
    await page.loadHTML(animationHTML(date, battery, vpn));
    await page.present(true);
  }
  Script.complete();
}

await main();
