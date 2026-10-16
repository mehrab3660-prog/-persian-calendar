// تقویم شمسی - ویجت Scriptable
// ساخته شده توسط طلایی
//
// تاریخ شمسی امروز، مناسبت امروز و فاصله تا تعطیلی بعدی را نشان می‌دهد.
// اندازه‌های کوچک، متوسط و ویجت‌های صفحه‌ی قفل را پشتیبانی می‌کند.

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
function describe(days, today) {
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
  const red = new Color("#e5383b");
  const dayColor = info.holiday ? red : text;
  const nextText = info.next
    ? (info.next.inDays === 1 ? "فردا تعطیل است" : `${fa(info.next.inDays)} روز تا تعطیلی`)
    : null;

  const widget = new ListWidget();
  widget.url = "calshow://";

  if (family === "accessoryInline") {
    widget.addText(`${info.weekday} ${info.day} ${info.month}`);
    return widget;
  }
  if (family === "accessoryCircular") {
    widget.addAccessoryWidgetBackground = true;
    const day = widget.addText(info.day);
    day.font = Font.boldSystemFont(22);
    day.centerAlignText();
    const month = widget.addText(info.month);
    month.font = Font.systemFont(10);
    month.centerAlignText();
    return widget;
  }
  if (family === "accessoryRectangular") {
    addLine(widget, `${info.weekday} ${info.day} ${info.month}`, 15, Color.white(), true);
    if (info.occasion) addLine(widget, info.occasion, 12, Color.white());
    if (nextText) addLine(widget, nextText, 12, Color.white());
    return widget;
  }

  widget.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));
  widget.setPadding(14, 14, 14, 14);

  if (family === "small") {
    // everything centred, the date in the middle of the widget
    widget.addSpacer();
    addLine(widget, info.weekday, 15, dayColor, true).centerAlignText();
    addLine(widget, info.day, 50, dayColor, true).centerAlignText();
    addLine(widget, `${info.month} ${info.year}`, 14, muted).centerAlignText();
    widget.addSpacer();
    if (info.occasion) addLine(widget, info.occasion, 12, info.occasionHoliday ? red : text).centerAlignText();
    else if (nextText) addLine(widget, nextText, 12, muted).centerAlignText();
    return widget;
  }

  // medium and large: the date on the right, the details on the left
  const row = widget.addStack();
  row.centerAlignContent();
  const details = row.addStack();
  details.layoutVertically();
  if (info.occasion) {
    addLine(details, "مناسبت امروز", 11, muted);
    const occasion = addLine(details, info.occasion, 15, info.occasionHoliday ? red : text, true);
    occasion.lineLimit = 2;
    details.addSpacer(8);
  }
  if (info.next) {
    addLine(details, nextText, 11, muted);
    addLine(details, info.next.title, 13, text);
  }
  row.addSpacer();
  const date = row.addStack();
  date.layoutVertically();
  addLine(date, info.weekday, 15, dayColor, true).rightAlignText();
  addLine(date, info.day, 52, dayColor, true).rightAlignText();
  addLine(date, `${info.month} ${info.year}`, 14, muted).rightAlignText();
  widget.addSpacer();
  addLine(widget, "ساخته شده توسط طلایی", 8, muted).centerAlignText();
  return widget;
}

async function main() {
  const today = new Date();
  const info = describe(await loadCalendar(), today);
  const family = config.widgetFamily || "medium";
  const widget = buildWidget(info, family);
  // Redraw just after midnight, when the date changes
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 0, 1);
  widget.refreshAfterDate = midnight;
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
  Script.complete();
}

await main();
