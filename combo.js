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
const HOME_COUNTRY = "IR"; // وصل بودن از این کشور یعنی VPN خاموش است

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


function describeVpn(result) {
  if (!result) return { state: "offline", title: "بدون اینترنت", dot: "🟠", short: "قطع", place: "" };
  const vpn = result.code !== HOME_COUNTRY;
  return {
    state: vpn ? "on" : "off",
    title: vpn ? "VPN روشن" : "VPN خاموش",
    dot: vpn ? "🟢" : "🔴",
    short: vpn ? "روشن" : "خاموش",
    flag: flag(result.code),
    place: [countryName(result.code), !vpn ? operatorName(result.org) : null].filter(Boolean).join(" · "),
    ip: result.ip || "",
    ping: result.ping,
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
function ringImage(fraction, color, label, size, dark) {
  const dc = new DrawContext();
  dc.size = new Size(size, size);
  dc.opaque = false;
  dc.respectScreenScale = true;
  const width = size * 0.11;
  const center = size / 2;
  const radius = center - width / 2 - 1;
  const arc = (to, stroke) => {
    const steps = Math.max(2, Math.round(180 * to));
    const path = new Path();
    for (let i = 0; i <= steps; i++) {
      const angle = -Math.PI / 2 + 2 * Math.PI * to * (i / steps);
      const point = new Point(center + radius * Math.cos(angle), center + radius * Math.sin(angle));
      if (i === 0) path.move(point);
      else path.addLine(point);
    }
    dc.addPath(path);
    dc.setStrokeColor(stroke);
    dc.setLineWidth(width);
    dc.strokePath();
  };
  arc(1, new Color(dark ? "#3a3a3c" : "#e5e5ea"));
  if (fraction > 0) arc(Math.min(fraction, 1), new Color(color));
  dc.setFont(Font.boldSystemFont(size * 0.22));
  dc.setTextColor(new Color(dark ? "#f2f2f7" : "#1c1c1e"));
  dc.setTextAlignedCenter();
  dc.drawTextInRect(label, new Rect(0, center - size * 0.15, size, size * 0.3));
  return dc.getImage();
}

// ---------- ویجت ----------

function addLine(stack, text, size, color, bold = false) {
  const line = stack.addText(text);
  line.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  line.textColor = color;
  line.lineLimit = 1;
  line.minimumScaleFactor = 0.6;
  return line;
}

function buildWidget(date, battery, vpn, family) {
  const dark = Device.isUsingDarkAppearance();
  const text = Color.dynamic(new Color("#1c1c1e"), new Color("#f2f2f7"));
  const muted = Color.dynamic(new Color("#6e6e73"), new Color("#a1a1a6"));
  const red = new Color("#e5383b");
  const vpnColor = new Color({ on: dark ? "#30d158" : "#248a3d", off: "#d70015", offline: "#ff9f0a" }[vpn.state]);
  const dayColor = date.holiday ? red : text;
  const vpnLine = `${vpn.dot} ${vpn.title}${vpn.place ? " · " + vpn.place : ""}`;

  const widget = new ListWidget();
  widget.url = `scriptable:///run/${encodeURIComponent(Script.name())}`;

  if (family === "accessoryInline") {
    widget.addText(`${date.day} ${date.month} · 🔋${battery.text} · ${vpn.dot} VPN`);
    return widget;
  }
  if (family === "accessoryCircular") {
    widget.addAccessoryWidgetBackground = true;
    const ring = widget.addImage(ringImage(battery.level / 100, "#ffffff", battery.text, 120, true));
    ring.centerAlignImage();
    return widget;
  }
  if (family === "accessoryRectangular") {
    addLine(widget, `${date.weekday} ${date.day} ${date.month}`, 15, Color.white(), true);
    addLine(widget, `🔋 ${battery.text}${battery.charging ? " ⚡" : ""}`, 12, Color.white());
    addLine(widget, `${vpn.dot} ${vpn.title}`, 12, Color.white());
    return widget;
  }

  widget.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));
  widget.setPadding(14, 14, 14, 14);

  if (family === "small") {
    addLine(widget, date.weekday, 13, dayColor, true).centerAlignText();
    addLine(widget, date.day, 40, dayColor, true).centerAlignText();
    addLine(widget, `${date.month} ${date.year}`, 12, muted).centerAlignText();
    widget.addSpacer();
    const row = widget.addStack();
    row.addSpacer();
    addLine(row, `${vpn.dot} VPN`, 11, vpnColor, true);
    row.addSpacer(8);
    addLine(row, `🔋${battery.text}${battery.charging ? "⚡" : ""}`, 11, new Color(battery.color), true);
    row.addSpacer();
    return widget;
  }

  // medium and large: the date on the right, the battery ring on the left, VPN below
  const large = family === "large";
  const row = widget.addStack();
  row.centerAlignContent();
  const left = row.addStack();
  left.layoutVertically();
  const ring = left.addImage(ringImage(battery.level / 100, battery.color, battery.text, large ? 110 : 84, dark));
  ring.imageSize = new Size(large ? 110 : 84, large ? 110 : 84);
  left.addSpacer(2);
  addLine(left, battery.hint, 10, battery.level <= 20 && !battery.charging ? red : muted);
  row.addSpacer();
  const right = row.addStack();
  right.layoutVertically();
  addLine(right, date.weekday, 14, dayColor, true).rightAlignText();
  addLine(right, date.day, large ? 56 : 44, dayColor, true).rightAlignText();
  addLine(right, `${date.month} ${date.year}`, 13, muted).rightAlignText();
  if (date.occasion) addLine(right, date.occasion, 12, date.occasionHoliday ? red : text).rightAlignText();

  widget.addSpacer(large ? 14 : 6);
  const bottom = widget.addStack();
  bottom.addSpacer();
  addLine(bottom, vpnLine, 12, vpnColor, true);

  if (large) {
    widget.addSpacer(10);
    if (vpn.ip) addLine(widget, `IP: ${vpn.ip}${vpn.ping != null ? " · " + fa(vpn.ping) + "ms" : ""}`, 11, muted).rightAlignText();
    if (date.next) {
      const nextText = date.next.inDays === 1 ? "فردا تعطیل است" : `${fa(date.next.inDays)} روز تا تعطیلی`;
      addLine(widget, `${nextText}: ${date.next.title}`, 12, text).rightAlignText();
    }
    widget.addSpacer();
    addLine(widget, "ساخته شده توسط طلایی", 8, muted).centerAlignText();
  }
  return widget;
}

async function main() {
  const today = new Date();
  const [days, result] = await Promise.all([loadCalendar(), lookup()]);
  const widget = buildWidget(describeDate(days, today), describeBattery(), describeVpn(result),
    config.widgetFamily || "medium");
  // Every few minutes for battery and VPN; iOS decides the exact moment
  widget.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
  Script.complete();
}

await main();
