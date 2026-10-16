"""Build the Persian (Jalali) calendars from the source calendar.

Usage: python3 build_calendar.py SOURCE.ics OUTPUT_DIR

Writes OUTPUT_DIR/calendar.ics: Jalali, Hijri and Gregorian dates, every occasion,
official holidays and reminders.
"""
import datetime
import math
import os
import re
import sys

AUTHOR = "محراب طلایی"
UID_DOMAIN = "mehrab-talaei"
DTSTAMP = "20261016T000000Z"
LAST_SOURCE_YEAR = 1407  # the source ends with this Jalali year; the next one is derived
EXTRA_YEAR = 1408

MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
          "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"]
HIJRI_MONTHS = ["محرم", "صفر", "ربیع‌الاول", "ربیع‌الثانی", "جمادی‌الاول", "جمادی‌الثانی",
                "رجب", "شعبان", "رمضان", "شوال", "ذی‌القعده", "ذی‌الحجه"]
GREGORIAN_MONTHS = ["ژانویه", "فوریه", "مارس", "آوریل", "مه", "ژوئن",
                    "ژوئیه", "اوت", "سپتامبر", "اکتبر", "نوامبر", "دسامبر"]
WEEKDAYS = ["دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه", "شنبه", "یک‌شنبه"]
PERSIAN_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")

# Official holidays fixed on the Jalali calendar: (month, day) -> (occasion, pattern
# that recognises the same occasion as the source spells it)
JALALI_HOLIDAYS = {
    (1, 1): ("عید نوروز", r"نوروز|سال نو"), (1, 2): ("عید نوروز", r"نوروز|سال نو"),
    (1, 3): ("عید نوروز", r"نوروز|سال نو"), (1, 4): ("عید نوروز", r"نوروز|سال نو"),
    (1, 12): ("روز جمهوری اسلامی", r"جمهوری اسلامی"),
    (1, 13): ("روز طبیعت", r"طبیعت|سیزده"),
    (3, 14): ("رحلت امام خمینی", r"خمینی"),
    (3, 15): ("قیام ۱۵ خرداد", r"(۱۵|15) خرداد"),
    (11, 22): ("پیروزی انقلاب اسلامی", r"پیروزی انقلاب"),
    (12, 29): ("روز ملی شدن صنعت نفت", r"ملی شدن صنعت نفت"),
}
# Occasions fixed on the Jalali calendar, added when the source lacks them
JALALI_OCCASIONS = {
    (1, 25): ("روز بزرگداشت عطار نیشابوری", r"عطار"),
    (2, 1): ("روز بزرگداشت سعدی", r"سعدی"),
    (2, 10): ("روز ملی خلیج فارس", r"خلیج فارس"),
    (2, 11): ("روز کارگر", r"کارگر"),
    (2, 12): ("روز معلم", r"معلم"),
    (2, 25): ("روز بزرگداشت فردوسی", r"فردوسی"),
    (2, 28): ("روز بزرگداشت خیام", r"خیام"),
    (4, 13): ("جشن تیرگان", r"تیرگان"),
    (5, 17): ("روز خبرنگار", r"خبرنگار"),
    (6, 1): ("روز بزرگداشت ابوعلی سینا و روز پزشک", r"پزشک"),
    (6, 4): ("روز کارمند", r"کارمند"),
    (6, 5): ("روز بزرگداشت رازی و روز داروساز", r"داروساز"),
    (6, 27): ("روز شعر و ادب پارسی و بزرگداشت شهریار", r"شهریار|شعر و ادب"),
    (7, 7): ("روز آتش‌نشانی و ایمنی", r"آتش\u200c?نشان"),
    (7, 8): ("روز بزرگداشت مولوی", r"مولوی|مولانا"),
    (7, 10): ("جشن مهرگان", r"مهرگان"),
    (7, 14): ("روز دامپزشکی", r"دامپزشک"),
    (7, 20): ("روز بزرگداشت حافظ", r"حافظ"),
    (8, 10): ("جشن آبانگان", r"آبانگان"),
    (8, 24): ("روز کتاب و کتاب‌خوانی", r"کتاب\u200c?خوانی"),
    (9, 9): ("جشن آذرگان", r"آذرگان"),
    (9, 16): ("روز دانشجو", r"دانشجو"),
    (9, 30): ("شب یلدا", r"یلدا"),
    (11, 10): ("جشن سده", r"سده"),
    (11, 29): ("سپندارمذگان، روز عشق ایرانی", r"سپندارمذ|اسفندگان"),
    (12, 5): ("روز بزرگداشت خواجه نصیرالدین طوسی و روز مهندس", r"مهندس"),
}
# Occasions fixed on the Hijri calendar, added when the source lacks them
HIJRI_OCCASIONS = {
    (5, 5): ("ولادت حضرت زینب (س) و روز پرستار", r"پرستار"),
    (6, 20): ("ولادت حضرت فاطمه (س) و روز مادر", r"روز (زن|مادر)"),
    (7, 13): ("روز پدر", r"روز پدر(?! \()"),
}
# Lunar occasions whose Hijri date is fixed; used to place the Hijri calendar
HIJRI_ANCHORS = [
    (r"تاسوعا", 1, 9), (r"عاشورا", 1, 10), (r"اربعین", 2, 20),
    (r"رحلت (پیامبر|رسول)", 2, 28), (r"شهادت امام حسن عسکری", 3, 8),
    (r"(میلاد|ولادت) (پیامبر|رسول)(?!.*اهل سنت)", 3, 17),
    (r"شهادت حضرت فاطمه", 6, 3),
    (r"(ولادت|میلاد) (امام|حضرت) علی(?! ?(النقی|ابن|بن|اکبر|اصغر))", 7, 13),
    (r"مبعث", 7, 27), (r"نیمه شعبان|(ولادت|میلاد) (امام زمان|امام مهدی|حضرت مهدی|حضرت قائم)", 8, 15),
    (r"شهادت (امام|حضرت) علی(?! ?(النقی|ابن|بن|اکبر|اصغر))", 9, 21),
    (r"^(?!تعطیل).*عید (سعید )?فطر", 10, 1), (r"تعطیل.*فطر", 10, 2),
    (r"شهادت امام جعفر صادق", 10, 25), (r"عید (سعید )?قربان", 12, 10),
    (r"عید (سعید )?غدیر", 12, 18),
]
# Official holidays on the Hijri calendar, recognised by their occasion text
LUNAR_HOLIDAY = re.compile("|".join(p for p, _, _ in HIJRI_ANCHORS) + r"|شهادت امام رضا")
NOT_HOLIDAY = re.compile(r"ضربت|هفته|سالروز|اهل سنت")
# Occasions that follow the Hijri calendar, so they move each solar year
LUNAR = re.compile(
    r"امام|حضرت|پیامبر|رسول|عید (سعید )?(فطر|قربان|غدیر)|مبعث|اربعین|تاسوعا|عاشورا"
    r"|شعبان|(?<!\S)(قدر|قدس)(?![^\s)،])|ضربت|عرفه|مباهله|وحدت|اعتکاف|علیه السلام|\((ع|س|ص|عج)\)"
    r"|(?<![^\s(])روز (پدر|مادر|دختر|جوان|جانباز|پاسدار|پرستار|ازدواج|وقف)(?![^\s)،])(?! \()|غدیر")
NOT_LUNAR = re.compile(r"خمینی|انقلاب|خرداد|جهانی|جمهوری|^(زادروز|زاد روز|درگذشت|قتل)|مبدأ تاریخ")
# Occasions worth a reminder three days ahead
REMIND_AHEAD = re.compile(r"روز مادر|روز پدر(?! \()|یلدا|چهارشنبه\u200c?سوری|سپندارمذگان|^(عید )?نوروز$|سال نو")

TYPES = [  # (emoji, pattern), first match wins
    ("🕌", None),  # lunar occasions
    ("🎉", re.compile(r"جشن(?!واره)|نوروز|سال نو|یلدا|سده|مهرگان|تیرگان|سیزده|سوری|سپندارمذگان|آبانگان|آذرگان")),
    ("🕯️", re.compile(r"^درگذشت")),
    ("🎂", re.compile(r"^(زادروز|زاد روز|تولد)")),
    ("🌍", re.compile(r"جهانی|بین\u200c?المللی|بین المللی")),
    ("🇮🇷", re.compile(r"^روز|پیروزی|قیام|رحلت امام خمینی")),
]


def g2j(gy, gm, gd):
    g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    gy2 = gy + 1 if gm > 2 else gy
    days = (355666 + 365 * gy + (gy2 + 3) // 4 - (gy2 + 99) // 100
            + (gy2 + 399) // 400 + gd + g_d_m[gm - 1])
    jy = -1595 + 33 * (days // 12053)
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        jy += (days - 1) // 365
        days = (days - 1) % 365
    if days < 186:
        return jy, 1 + days // 31, 1 + days % 31
    return jy, 7 + (days - 186) // 30, 1 + (days - 186) % 30


def tabular_hijri_start(y, m):
    """Ordinal (datetime.date.toordinal) of 1 m/y in the arithmetical Hijri calendar."""
    jdn = math.ceil(29.5 * (m - 1)) + (y - 1) * 354 + (3 + 11 * y) // 30 + 1948440
    return jdn - 1721425


class Hijri:
    """Hijri calendar as observed in Iran, fitted to the lunar occasions in the source.

    The arithmetical calendar is shifted month by month so that every anchor occasion
    lands on its Hijri date; months without an anchor keep the shift of the month before.
    """

    def __init__(self, anchors):
        shifts = {}
        for ordinal, m, d in anchors:
            y = min(range(1440, 1460), key=lambda y: abs(tabular_hijri_start(y, m) + d - 1 - ordinal))
            shifts.setdefault((y, m), set()).add(ordinal - (tabular_hijri_start(y, m) + d - 1))
        conflicts = {k: v for k, v in shifts.items() if len(v) > 1}
        if conflicts:
            raise ValueError("inconsistent Hijri anchors: %r" % conflicts)
        months = [(y, m) for y in range(1440, 1460) for m in range(1, 13)]
        first = min(shifts)
        shift = next(iter(shifts[first]))
        self.starts = []
        for ym in months:
            if ym in shifts:
                shift = next(iter(shifts[ym]))
            self.starts.append((tabular_hijri_start(*ym) + shift, ym))
        self.anchored = set(shifts)
        # A month without an anchor sits between two shifts; move its start by a day
        # when that keeps both neighbouring months at 29 or 30 days
        for i in range(1, len(self.starts) - 1):
            start, ym = self.starts[i]
            if ym in shifts:
                continue
            for delta in (0, -1, 1):
                if (29 <= start + delta - self.starts[i - 1][0] <= 30
                        and 29 <= self.starts[i + 1][0] - start - delta <= 30):
                    self.starts[i] = (start + delta, ym)
                    break
        for (a, ym), (b, _) in zip(self.starts, self.starts[1:]):
            if ym >= first and not 29 <= b - a <= 30:
                raise ValueError("Hijri month %r would have %d days" % (ym, b - a))
        self.last_anchor = max(shifts)

    def date(self, ordinal):
        start, (y, m) = max(s for s in self.starts if s[0] <= ordinal)
        return y, m, ordinal - start + 1

    def month_length(self, y, m):
        i = [ym for _, ym in self.starts].index((y, m))
        return self.starts[i + 1][0] - self.starts[i][0]

    def approximate(self, ordinal):
        """True when the date lies past the last anchored month."""
        y, m, _ = self.date(ordinal)
        return (y, m) > self.last_anchor


def read_source(path):
    """Return {date: (summary_lines, description_lines)} for the info events."""
    out, cur = {}, None
    for line in open(path, encoding="utf-8").read().replace("\r\n", "\n").split("\n"):
        if line == "BEGIN:VEVENT":
            cur, key = {}, None
        elif line == "END:VEVENT":
            if cur["UID"][0].startswith("jalali-info"):
                d = cur["DTSTART"][0]
                day = datetime.date(int(d[:4]), int(d[4:6]), int(d[6:]))
                out[day] = (cur["SUMMARY"], cur.get("DESCRIPTION", []))
            cur = None
        elif cur is not None:
            if line.startswith((" ", "\t")):
                cur[key].append(line[1:])
            else:
                key, value = line.split(":", 1)
                key = key.split(";")[0]
                cur[key] = [value]
    return out


def repair_description(lines):
    """Undo occasions that were spliced into the first folded line of a description."""
    inserted = None
    if len(lines) > 1 and len(("DESCRIPTION:" + lines[0]).encode()) > 75:
        head, _, inserted = lines[0].rpartition("\\n")
        lines = [head] + lines[1:]
    text = "".join(lines)
    items = text.split("\\n")[1:] if "\\n" in text else []
    if inserted and inserted not in items:
        items.append(inserted)
    return items


def clean(item):
    item = re.sub(r"\s+", " ", item).strip()
    item = item.replace(" قتصاددان", " اقتصاددان")
    item = re.sub(r"\s*؛\s*", "؛ ", item)
    return item.rstrip(".")


def dedupe_key(item):
    return re.sub(r"[\u064B-\u0652\u200c\s]", "", item)


def source_items(day, summary_lines, desc_lines):
    items = repair_description(desc_lines)
    if not items:  # description without an item list: take the occasion from the summary
        summary = "".join(summary_lines)
        if " - " in summary and "مناسبت های روز" not in summary:
            items = [summary.split(" - ", 1)[1]]
    weekdays = [w.replace("\u200c", "") for w in WEEKDAYS]
    out = []
    for item in map(clean, items):
        if "روز جهانی قدس" in item and day.weekday() != 4:
            continue  # Quds Day is always a Friday; the source misplaces it
        if item and item.replace("\u200c", "") not in weekdays:
            out.append(item)
    return out


def is_lunar(item):
    return bool(LUNAR.search(item)) and not NOT_LUNAR.search(item)


def add_missing(days, day, text, pattern, window=2):
    """Add an occasion unless one matching pattern is already within window days."""
    for k in range(-window, window + 1):
        near = day + datetime.timedelta(days=k)
        if near in days and any(re.search(pattern, i) for i in days[near]):
            return
    if day in days:
        days[day].append(text)


def collect(src):
    source = read_source(src)
    days = {day: source_items(day, *source[day]) for day in sorted(source)}
    # Imam Reza's martyrdom is missing from 1407: last day of Safar 1450,
    # the day before 1 Rabi al-Awwal (Imam Hasan Askari, 8 Rabi = 2028-07-31)
    days[datetime.date(2028, 7, 23)].insert(0, "شهادت امام رضا (ع)")

    anchors = []
    for day, items in days.items():
        for pattern, m, d in HIJRI_ANCHORS:
            if any(re.search(pattern, i) and not re.search(r"اهل سنت", i) for i in items):
                anchors.append((day.toordinal(), m, d))
    hijri = Hijri(anchors)

    # The year after the source: Jalali and Gregorian line up exactly as in the last
    # source year, so fixed occasions keep their day and lunar ones follow the Hijri date
    last = [d for d in days if g2j(d.year, d.month, d.day)[0] == LAST_SOURCE_YEAR]
    by_hijri = {}
    for day in last:
        for item in days[day]:
            if is_lunar(item):
                by_hijri.setdefault(hijri.date(day.toordinal())[1:], []).append(item)
    same_jalali = {g2j(d.year, d.month, d.day)[1:]: d for d in last}
    day = max(days) + datetime.timedelta(days=1)
    while g2j(day.year, day.month, day.day)[0] == EXTRA_YEAR:
        jy, jm, jd = g2j(day.year, day.month, day.day)
        before = same_jalali.get((jm, jd))
        items = [i for i in days[before] if not is_lunar(i)] if before else []
        hy, hm, hd = hijri.date(day.toordinal())
        items += by_hijri.get((hm, hd), [])
        if hm == 2 and hd == hijri.month_length(hy, hm):
            items.append("شهادت امام رضا (ع)")
        items = [i for i in items if not (i.startswith("شهادت امام رضا") and (hm, hd) != (2, hijri.month_length(hy, 2)))]
        days[day] = items
        day += datetime.timedelta(days=1)

    for day in list(days):
        jy, jm, jd = g2j(day.year, day.month, day.day)
        if (jm, jd) in JALALI_OCCASIONS:
            add_missing(days, day, *JALALI_OCCASIONS[(jm, jd)])
        hy, hm, hd = hijri.date(day.toordinal())
        if (hm, hd) in HIJRI_OCCASIONS:
            add_missing(days, day, *HIJRI_OCCASIONS[(hm, hd)])
        # Chaharshanbe Suri: the evening of the last Tuesday of the year
        if jm == 12 and day.weekday() == 1 and g2j(*(day + datetime.timedelta(days=7)).timetuple()[:3])[1] == 1:
            add_missing(days, day, "چهارشنبه‌سوری (شب آخرین چهارشنبه‌ی سال)", r"سوری", window=0)

    for day, items in days.items():
        seen, unique = set(), []
        for item in items:
            if dedupe_key(item) not in seen:
                seen.add(dedupe_key(item))
                unique.append(item)
        # drop an occasion that a longer one already spells out ("جشن سده" / "جشن سده، ...")
        days[day] = [i for i in unique if not any(o != i and o.startswith(i + "،") for o in unique)]
    return days, hijri


def classify(day, items):
    jy, jm, jd = g2j(day.year, day.month, day.day)
    fixed = JALALI_HOLIDAYS.get((jm, jd))
    if fixed and not any(re.search(fixed[1], i) for i in items):
        items.insert(0, fixed[0])
    holiday = [i for i in items if (fixed and re.search(fixed[1], i))
               or (LUNAR_HOLIDAY.search(i) and not NOT_HOLIDAY.search(i))]
    return holiday


def emoji(item):
    for mark, pattern in TYPES:
        if (pattern is None and is_lunar(item)) or (pattern is not None and pattern.search(item)):
            return mark
    return "📌"


def is_minor(item):
    """Birthdays, deaths and historical events: listed, but not used in titles first."""
    return emoji(item) in ("🕯️", "🎂", "📌")


HONORIFICS = re.compile(r"\s*(\((ع|س|ص|عج)\)|علیه السلام|علیهاالسلام|سلام الله علیها|عجل الله تعالی فرجه( الشریف)?)")


def short_title(item, holiday=False):
    """A short title for the narrow month view; the description keeps the full text.

    The mark goes last: the month view shows the end of a Persian title and cuts its start.
    """
    mark = "🔴" if holiday else emoji(item)
    text = HONORIFICS.sub("", item)
    parts = [p.strip() for p in re.split(r"[،؛(:]", text) if p.strip()]
    text = next((p for p in parts if p.startswith("جشن")), parts[0])  # the name, not its explanation
    if len(text) > 20 and " و " in text:
        text = text.split(" و ")[0]
    text = re.sub(r"^(روز (جهانی|بین\u200c?المللی|بین المللی|ملی)|روزجهانی|روز بزرگداشت|بزرگداشت"
                  r"|روز|زادروز|زاد روز|درگذشت|تولد)\s+", "", text)
    if mark in ("🕯️", "🎂"):
        text = " ".join(text.split()[:3])
    elif len(text) > 22:
        text = " ".join(text.split()[:4])
    return text.strip() + " " + mark


def escape(text):
    return (text.replace("\\", "\\\\").replace(";", "\\;")
            .replace(",", "\\,").replace("\n", "\\n"))


def fold(line):
    out, cur, size = [], "", 0
    for ch in line:
        n = len(ch.encode())
        limit = 75 if not out else 74
        if size + n > limit:
            out.append(cur)
            cur, size = "", 0
        cur += ch
        size += n
    out.append(cur)
    return "\r\n ".join(out)


def fa(text):
    return text.translate(PERSIAN_DIGITS)


def alarm(trigger, text):
    return ["BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:" + trigger,
            "DESCRIPTION:" + escape(fa(text)), "END:VALARM"]


def event(uid, day, summary, description, categories=None, alarms=()):
    lines = [
        "BEGIN:VEVENT",
        "UID:%s@%s" % (uid, UID_DOMAIN),
        "DTSTAMP:" + DTSTAMP,
        "DTSTART;VALUE=DATE:" + day.strftime("%Y%m%d"),
        "DTEND;VALUE=DATE:" + (day + datetime.timedelta(days=1)).strftime("%Y%m%d"),
        "SUMMARY:" + escape(fa(summary)),
        "DESCRIPTION:" + escape(fa(description)),
    ]
    if categories:
        lines.append("CATEGORIES:" + escape(categories))
    lines.append("TRANSP:TRANSPARENT")
    for a in alarms:
        lines += a
    lines.append("END:VEVENT")
    return lines


def calendar(name, description, events, years):
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0",
        "PRODID:-//Mehrab Talaei//Persian Calendar %d-%d//FA" % years,
        "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        "X-WR-CALNAME:" + escape(name),
        "X-WR-CALDESC:" + escape(fa(description)),
        "X-WR-TIMEZONE:Asia/Tehran",
        "REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H",
    ]
    lines += events
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold(l) for l in lines) + "\r\n"


def build(src, out_dir):
    days, hijri = collect(src)
    first, last = g2j(*min(days).timetuple()[:3])[0], g2j(*max(days).timetuple()[:3])[0]
    signature = "ساخته شده توسط " + AUTHOR
    events = []
    stats = {}
    for day, all_items in sorted(days.items()):
        key = day.strftime("%Y%m%d")
        jy, jm, jd = g2j(day.year, day.month, day.day)
        hy, hm, hd = hijri.date(day.toordinal())
        approx = hijri.approximate(day.toordinal())
        weekday = WEEKDAYS[day.weekday()]
        holiday = classify(day, all_items)
        stats[jy] = stats.get(jy, 0) + bool(holiday)

        hijri_text = "%d %s %d%s" % (hd, HIJRI_MONTHS[hm - 1], hy, " (تقریبی)" if approx else "")
        date_desc = "\n".join([
            "شمسی: %s %d %s %d" % (weekday, jd, MONTHS[jm - 1], jy),
            "قمری: " + hijri_text,
            "میلادی: %d %s %d" % (day.day, GREGORIAN_MONTHS[day.month - 1], day.year),
            "", signature])
        # Month view cells are narrow and cut Persian titles from the start: keep it short
        date_summary = "\u2067%d %s\u2069" % (jd, MONTHS[jm - 1])
        date_event = event("jalali-date-" + key, day, date_summary, date_desc)

        events += date_event
        items = all_items
        if not items:
            continue
        ranked = sorted(items, key=lambda i: (i not in holiday, is_minor(i), emoji(i) == "🌍"))
        # One occasion only, and the holiday mark at the end: the month view shows
        # the end of a Persian title and cuts its start
        title = short_title(ranked[0], ranked[0] in holiday)
        desc = ("🔴 تعطیل رسمی\n" if holiday else "") + "مناسبت‌های این روز:\n"
        desc += "\n".join(emoji(i) + " " + i for i in items)
        if approx and any(is_lunar(i) for i in items):
            desc += "\n\nتاریخ مناسبت‌های قمری این سال تقریبی است و ممکن است یک روز جابه‌جا شود."
        desc += "\n\n" + signature
        alarms = []
        if holiday:
            alarms.append(alarm("-PT4H", "فردا تعطیل رسمی است: " + "، ".join(holiday)))
        ahead = [i for i in items if REMIND_AHEAD.search(i)]
        if ahead:
            alarms.append(alarm("-P2DT15H", "سه روز دیگر: " + "، ".join(ahead)))
        events += event("jalali-info-" + key, day, title, desc,
                        "تعطیل رسمی" if holiday else None, alarms)

    years = (first, last)
    text = calendar(
        "تقویم شمسی - ساخته شده توسط " + AUTHOR,
        "تقویم شمسی روزانه %d تا %d با تاریخ قمری و میلادی، همه‌ی مناسبت‌ها، تعطیلات رسمی و یادآورها؛ %s"
        % (first, last, signature),
        events, years)
    with open(os.path.join(out_dir, "calendar.ics"), "w", encoding="utf-8", newline="") as f:
        f.write(text)
    return stats


if __name__ == "__main__":
    print("holidays per year:", build(sys.argv[1], sys.argv[2]))
