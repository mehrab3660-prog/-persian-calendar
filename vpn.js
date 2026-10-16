// وضعیت VPN - ویجت Scriptable
// ساخته شده توسط طلایی
//
// نشان می‌دهد VPN روشن است یا خاموش، به کدام کشور وصلید، IP و سرعت پاسخ.
// اندازه‌های کوچک، متوسط، بزرگ و ویجت‌های صفحه‌ی قفل را پشتیبانی می‌کند.

const HOME_COUNTRY = "IR"; // وصل بودن از این کشور یعنی VPN خاموش است
const CACHE_FILE = "vpn-status.json";

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

function fa(value) {
  return String(value).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
}

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

// Lookup services, tried in order until one answers; each returns {ip, code, city, org}
const SERVICES = [
  {
    url: "https://ipwho.is/",
    parse: (j) => j.success !== false && j.country_code
      && { ip: j.ip, code: j.country_code, city: j.city, org: (j.connection || {}).isp || (j.connection || {}).org },
  },
  {
    url: "https://ipapi.co/json/",
    parse: (j) => j.country_code && { ip: j.ip, code: j.country_code, city: j.city, org: j.org },
  },
  {
    url: "https://ifconfig.co/json",
    parse: (j) => j.country_iso && { ip: j.ip, code: j.country_iso, city: j.city, org: j.asn_org },
  },
  {
    url: "https://api.country.is/",
    parse: (j) => j.country && { ip: j.ip, code: j.country },
  },
  {
    url: "https://1.1.1.1/cdn-cgi/trace",
    text: true,
    parse: (t) => {
      const ip = /^ip=(.+)$/m.exec(t);
      const loc = /^loc=([A-Z]{2})$/m.exec(t);
      return loc && { ip: ip && ip[1], code: loc[1] };
    },
  },
];

async function lookup() {
  for (const service of SERVICES) {
    try {
      const request = new Request(service.url);
      request.timeoutInterval = 6;
      const started = Date.now();
      const body = service.text ? await request.loadString() : await request.loadJSON();
      const result = service.parse(body);
      if (result) return { ...result, ping: Date.now() - started };
    } catch (e) {
      // try the next service
    }
  }
  return null;
}

// What the widget shows
function describe(result, checkedAt) {
  const time = fa(checkedAt.toTimeString().slice(0, 5));
  if (!result) {
    return { state: "offline", title: "بدون اینترنت", flag: "📵", place: "", detail: "", ip: "", ping: null, time };
  }
  const vpn = result.code !== HOME_COUNTRY;
  const country = countryName(result.code);
  const operator = !vpn ? operatorName(result.org) : null;
  return {
    state: vpn ? "on" : "off",
    title: vpn ? "VPN روشن" : "VPN خاموش",
    flag: flag(result.code),
    place: [country, operator || result.city].filter(Boolean).join(" · "),
    detail: result.org || "",
    ip: result.ip || "",
    ping: result.ping,
    time,
  };
}

function loadCache(fm, path) {
  try {
    return fm.fileExists(path) ? JSON.parse(fm.readString(path)) : null;
  } catch (e) {
    return null;
  }
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
  const colors = { on: new Color("#248a3d"), off: new Color("#d70015"), offline: new Color("#ff9f0a") };
  const stateColor = Color.dynamic(colors[info.state], info.state === "on" ? new Color("#30d158") : colors[info.state]);
  const dot = { on: "🟢", off: "🔴", offline: "🟠" }[info.state];
  const ping = info.ping != null ? `${fa(info.ping)}ms` : "";

  const widget = new ListWidget();
  // Tapping the widget runs the check again right away
  widget.url = `scriptable:///run/${encodeURIComponent(Script.name())}`;
  widget.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);

  if (family === "accessoryInline") {
    widget.addText(`${dot} ${info.title}${info.state === "on" ? " · " + info.place.split(" · ")[0] : ""}`);
    return widget;
  }
  if (family === "accessoryCircular") {
    widget.addAccessoryWidgetBackground = true;
    const icon = widget.addText(info.flag);
    icon.font = Font.systemFont(26);
    icon.centerAlignText();
    const state = widget.addText(info.state === "on" ? "روشن" : info.state === "off" ? "خاموش" : "قطع");
    state.font = Font.boldSystemFont(10);
    state.centerAlignText();
    return widget;
  }
  if (family === "accessoryRectangular") {
    addLine(widget, `${dot} ${info.title}`, 15, Color.white(), true);
    addLine(widget, info.state === "offline" ? `بررسی ${info.time}` : [info.place, ping].filter(Boolean).join(" · "),
      12, Color.white());
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
    addLine(widget, info.ip ? `IP: ${info.ip}` : `آخرین بررسی ${info.time}`, 10, muted).centerAlignText();
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
  addLine(left, `بررسی: ${info.time}`, 10, muted).centerAlignText();
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
  const path = fm.joinPath(fm.documentsDirectory(), CACHE_FILE);
  let result = await lookup();
  let checkedAt = new Date();
  if (result) {
    fm.writeString(path, JSON.stringify({ result, checkedAt: checkedAt.toISOString() }));
  } else if (!config.runsInWidget) {
    // Opened by hand with no answer: really offline
  } else {
    // In a widget, a failed check keeps showing nothing older than 15 minutes
    const cached = loadCache(fm, path);
    if (cached && Date.now() - Date.parse(cached.checkedAt) < 15 * 60 * 1000) {
      result = cached.result;
      checkedAt = new Date(cached.checkedAt);
    }
  }
  const widget = buildWidget(describe(result, checkedAt), config.widgetFamily || "medium");
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
  Script.complete();
}

await main();
