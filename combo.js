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

async function ask(service) {
  const request = new Request(service.url);
  request.timeoutInterval = 4;
  const started = Date.now();
  const body = service.text ? await request.loadString() : await request.loadJSON();
  const result = service.parse(body);
  if (!result) throw new Error("no answer");
  return { ...result, ping: Date.now() - started };
}

// All services at once; the first good answer wins, so a blocked service costs no time
function lookup() {
  return new Promise((resolve) => {
    let pending = SERVICES.length;
    for (const service of SERVICES) {
      ask(service).then(resolve, () => {
        if (--pending === 0) resolve(null);
      });
    }
  });
}


// The network name: a known Iranian operator, else the first words of the ISP name
function networkName(org) {
  const known = operatorName(org);
  if (known) return known;
  const name = (org || "").replace(/^AS\d+\s*/, "").split(/[ ,]+/).slice(0, 2).join(" ");
  return name || null;
}

function describeVpn(result) {
  if (!result) {
    return { state: "offline", title: "بدون اینترنت", dot: "🟠", short: "بدون اینترنت", long: "بدون اینترنت" };
  }
  const vpn = result.code !== HOME_COUNTRY;
  const where = `${flag(result.code)} ${countryName(result.code)}`;
  // VPN on: the country (and city) of the VPN server; off: the Iranian network in use
  const via = vpn ? result.city : networkName(result.org);
  return {
    state: vpn ? "on" : "off",
    title: vpn ? "VPN وصل" : "VPN قطع",
    dot: vpn ? "🟢" : "🔴",
    short: vpn ? `وصل · ${where}` : `قطع · ${via || where}`,
    long: `${vpn ? "VPN وصل" : "VPN قطع"} · ${where}${via ? "، " + via : ""}`,
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
  const vpnDot = new Color({ on: "#30d158", off: "#ff453a", offline: "#ff9f0a" }[vpn.state]);
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

async function main() {
  const today = new Date();
  const [days, result] = await Promise.all([loadCalendar(), lookup()]);
  const widget = buildWidget(describeDate(days, today), describeBattery(), describeVpn(result),
    config.widgetFamily || "medium");
  // Ask for a redraw after a minute; iOS decides the real moment from its daily budget
  widget.refreshAfterDate = new Date(Date.now() + 60 * 1000);
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
  Script.complete();
}

await main();
