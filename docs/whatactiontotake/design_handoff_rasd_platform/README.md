# Handoff: رَصد (Rasd) — منصة متابعة الفريق التنفيذي للنطاق التعليمي

> Supervision-district reporting platform. Arabic-first, RTL, two roles: **عضو الفريق التنفيذي** (executive team member, owns a cluster of ~6 schools) and **رئيسة النطاق** (district head, oversees 25 members / ~150 schools).

---

## 1. Overview

Today the district head collects daily/near-daily reports from 25 executive team members by hand (WhatsApp/email), then merges them and uploads a consolidated report to the ministry platform. Rasd replaces that with:

1. Each **member** maintains a structured **cluster file** (7 sections: profile, school data, evaluation indicators, Madrasati indicators, discipline indicators, tasks, professional development) and files daily field work from their phone.
2. The **district head** sees everything live: KPIs, who submitted and who hasn't, per-cluster performance, member profiles, an AI assistant over all the data, and a one-click **consolidated report** ready to paste into the ministry platform.

**Primary outcomes:** zero manual aggregation, daily visibility on the 25 members, auditable per-school data, AI answers over report content.

---

## 2. About the design files

The files in this bundle are **design references created in HTML** — prototypes that communicate intended look, structure, and behavior. **They are not production code to copy.**

The task is to **recreate these designs inside the target codebase** using its existing framework, component library, state management, and conventions (React/Next, Vue, Laravel+Blade, Flutter, etc.). If no codebase exists yet, pick the most appropriate stack for an Arabic RTL web app with a mobile companion view, and implement there.

`Rasd Platform.dc.html` is the canonical, most complete design. `Rasd Reports v2.dc.html` is the previous iteration (no auth) kept for reference only.

---

## 3. Fidelity

**High-fidelity.** Final colors, typography, spacing, radii, states, and copy. Recreate pixel-faithfully using the codebase's own primitives. All Arabic copy in this document is production-intent copy — use it verbatim.

---

## 4. Global foundations

### 4.1 Direction & language
- `dir="rtl"` on the document root. All layouts mirror: sidebar on the **right**, content on the **left**, text right-aligned.
- Use logical CSS properties (`margin-inline-start`, `border-inline-end`, `padding-inline`) — not `left`/`right`.
- Latin content (emails, URLs) is wrapped with `dir="ltr"; text-align:left` inside its field.
- **All numerals render as Arabic-Indic digits** (٠١٢٣٤٥٦٧٨٩). Implement one formatter at the display layer; store Western digits in data.

### 4.2 Typography
- Family: **IBM Plex Sans Arabic** (Google Fonts), weights 400 / 500 / 600 / 700. Fallback `system-ui, sans-serif`.
- `-webkit-font-smoothing: antialiased`.

| Role | Size | Weight | Line-height | Notes |
|---|---|---|---|---|
| Page title (h1) | 24–26px | 600 | default | `letter-spacing: -0.02em` |
| Login title | 26px | 600 | — | |
| Login panel headline | 32px | 600 | 48px | on dark |
| Section eyebrow | 11px | 600 | — | `letter-spacing: .1em`, color `#009688` |
| Card title | 14–15px | 600 | — | |
| KPI number | 28–30px | 600 | 1 | `letter-spacing: -0.02em` |
| Stat number (small) | 20–22px | 600 | 1.1 | |
| Body | 13.5–14px | 400 | 23–28px | |
| Table cell | 12.5–13px | 400/600 | — | |
| Field label | 11.5–12px | 600 | — | color `#00000099` |
| Meta / caption | 11–11.5px | 400 | 17–19px | color `#00000080` |
| Pill / badge | 11px | 600 | — | |

Minimum body size anywhere: **11px** (meta only); interactive text never below 12px.

### 4.3 Color tokens

| Token | Hex | Use |
|---|---|---|
| `primary` | `#009688` | brand, primary buttons, active nav, progress fills |
| `primary-dark` | `#007970` | text on tint, hover |
| `primary-tint` | `#e1f5f2` | active nav bg, avatar bg, badges |
| `primary-tint-soft` | `#f0faf8` | selected list row bg |
| `ink-dark` | `#001d1a` | dark panels (login hero, AI summary card) |
| `ink-deep` | `#003935` | head-role avatar, dark accents |
| `mint` | `#80d5cb` | eyebrow text on dark |
| `bar-soft` | `#a2e0d8` | non-current chart bars |
| `canvas` | `#f2f4f4` | app background |
| `surface` | `#ffffff` | cards, header, sidebar |
| `surface-alt` | `#f7f8f8` | inner stat tiles, read-only fields |
| `text` | `#000000de` | primary text |
| `text-2` | `#00000099` | secondary text |
| `text-3` | `#00000080` | tertiary / labels |
| `text-4` | `#00000073` | captions |
| `text-5` | `#00000059` | disabled, em-dash values |
| `border` | `#00000014` | card/section borders |
| `border-soft` | `#00000010` | row dividers |
| `border-input` | `#0000001f` | input borders |
| `success` | `#067647` | "تم", "تميز", positive delta |
| `warning` | `#b45309` / `#92400e` | late, "انطلاق"; `#f59e0b` dot |
| `warning-bg` | `#fff7ed`, border `#f59e0b2e` | warning cards |
| `danger` | `#dc2626` | missing, "تهيئة", logout |
| `danger-bg` | `#fef2f2` | missing-state row bg |

**Percentage color scale** (used across all indicator values):
`≥95 → #067647` · `≥85 → #009688` · `≥75 → #b45309` · `<75 → #dc2626`

**School tier (تصنيف المدرسة) colors:** تميز `#067647` · تقدم `#009688` · انطلاق `#b45309` · تهيئة `#dc2626`. Rendered as a pill: `background: <color>14` (8% alpha), `color: <color>`.

### 4.4 Spacing, radius, elevation
- Spacing scale: 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 26, 28, 46 px. Page padding `24px 28px 46px`; card padding 17–26px; grid gaps 9–16px.
- Radius: pill `99px` · card `14px` · inner tile / dropdown `11–13px` · input & small button `9–10px` · nav item `9px` · logo tile `9–10px`.
- Shadows: cards are **border-only** (`1px solid #00000014`), no shadow. Exceptions: primary button `inset 0 0 0 1px rgba(255,255,255,.16), 0 2px 10px rgba(0,150,136,.24)`; dropdowns `0 12px 32px rgba(10,13,18,.14)`; segmented active `0 1px 2px rgba(0,0,0,.08)`.

### 4.5 Component primitives

**Primary button** — h 42–46px, radius 10–11px, bg `#009688`, text #fff 13.5–14.5px/600, inset highlight + teal glow, `cursor:pointer`.
**Secondary button** — h 38–40px, radius 9px, bg #fff, border `1px solid #00000014`, text `#00000099` 12.5–13px/500–600.
**Input / select** — h 40–44px, radius 9–10px, border `1px solid #0000001f`, bg #fff, font 13–13.5px. Placeholder `#00000047`.
**Textarea** — padding 11px, radius 10px, same border, line-height 21–23px, `resize:none`.
**Chip (filter/toggle)** — padding 7–8px × 12–13px, radius 99px. Off: bg #fff, border `#00000014`, text `#00000099`, weight 500. On: bg `#e1f5f2`, border `#009688`, text `#007970`, weight 600.
**Nav item** — full width, min-h 38px, padding-inline 11px, radius 9px, gap 9px, font 13px. Active: bg `#e1f5f2`, text `#007970`, weight 600. Inactive: transparent, text `#00000099`, weight 500. Contains a 6px status dot (`#00968840` ok / `#f59e0b` gap) and an optional count badge.
**Status pill** — padding 4px × 10px, radius 99px, 11px/600. ok: bg `#06764714`, text `#067647`. missing: bg `#dc262614`, text `#dc2626`.
**Avatar** — circle. 24px (header), 30px (rows/grid), 34px (cards/login), 38–48px (profile). Member: bg `#e1f5f2`, text `#007970`. Head: bg `#003935`, text #fff. Status-colored variants: bg `<color>1a`, text `<color>`. Content = two Arabic initials.
**Progress bar** — track h 6–7px, radius 99px, bg `#f2f4f4` (or `#e6e9e9` on tinted card); fill radius 99px, color from the percentage scale.
**Data table** — header row: padding 12–13px × 20px, bottom border `#00000014`, 11–11.5px/600, `#00000080`. Body row: padding 13–14px × 20px, divider `#00000010`, 12.5–13px. Tables live inside a card with `overflow-x:auto` and an inner `min-width` (760–840px).

### 4.6 Animation
- `rsFade`: `opacity 0→1, translateY(6px)→0`, 300–350ms ease — success states, AI result cards.
- `rsDrop`: `opacity 0→1, translateY(-6px)→0`, 160ms ease — header dropdowns.
- No other motion. Respect `prefers-reduced-motion`.

### 4.7 Accessibility
- Body text meets 4.5:1 on its background; pill text uses full-opacity ink on 8% tints (passes).
- Every icon-only control (bell) needs an accessible label.
- Dropdowns: close on outside click and `Esc`; trap focus while open; `aria-expanded` on trigger.
- Phone view hit targets ≥44px.

---

## 5. Screens

### 5.1 Login — `/login`

**Purpose:** authenticate with the ministry email; the account's role determines the destination.

**Layout:** full-viewport 2-column grid, `1fr 1fr`. Right column (RTL-first) = form on white; left column = dark brand panel. Below ~900px: stack, brand panel collapses or hides.

**Form column** — centered, `max-width 380px`, `gap 26px`, padding `48px 40px`.
1. **Brand lockup** — 36px teal rounded square (radius 10px) with "ر" 17px/700 white; beside it "رَصد" 16px/600 and "منصة متابعة الفريق التنفيذي" 11.5px `#00000080`.
2. **Heading** — h1 "تسجيل الدخول" 26px/600; sub "ادخلي ببريدك الوزاري — يتم توجيهك للوحة المناسبة لدورك تلقائياً." 13.5px/23px `#00000099`.
3. **Fields** — "البريد الوزاري" (ltr, placeholder `name@moe.gov.sa`), "كلمة المرور" (password). h 44px.
4. **Row** — checkbox "تذكّرني على هذا الجهاز" (accent `#009688`) / link "نسيت كلمة المرور؟".
5. **Primary button** "دخول" h 46px, full width.
6. **Error** (conditional) — "تأكدي من البريد الوزاري — أو اختاري حساباً من القائمة أدناه." 12px `#dc2626`, `rsFade` 200ms.
7. **Demo accounts block** — separated by `1px solid #00000012`, label "حسابات العرض التجريبي" 11.5px/600 `#00000080`; two full-width cards (34px avatar + name 13px/600 + role 11px + chevron "‹"), radius 11px, border `#00000014`. Clicking one logs straight in.
8. **Legal note** 11px/18px `#00000073`.

**Brand panel** — bg `#001d1a`, padding `52px 46px`, `space-between`. Overlay `radial-gradient(120% 90% at 100% 0%, #00968833 0%, transparent 60%)`.
- Eyebrow "إدارة التعليم · النطاق الإشرافي" 11px/600 `#80d5cb`, `letter-spacing .14em`.
- Headline "ملف واحد لكل عنقود، ولوحة واحدة تجمع النطاق كامل." 32px/48px #fff, `max-width 420px`.
- 2×2 stat grid (`#ffffff0f` cards, border `#ffffff1a`, radius 14px): ٢٥ عضوة فريق تنفيذي · ١٥٠ مدرسة في النطاق · ٧ أقسام في ملف العنقود · يومي تحديث المؤشرات.
- Quote "«صار عندي صورة كاملة عن كل عنقود بدون ما أجمع التقارير يدوياً.»" 13.5px/26px `#ffffffcc`; attribution "سارة القحطاني · رئيسة النطاق" 11.5px `#ffffff80`.

**Behavior:** submit matches the email against the account directory → route by role. Unknown email → inline error. Demo cards bypass the password. In production, replace with real auth (ministry SSO) and keep the role-based redirect.

---

### 5.2 App shell (both roles)

**Header** — sticky, `z 40`, h ≈ 59px, padding `11px 24px`, bg `#ffffffe8` + `backdrop-filter: blur(14px)`, bottom border `#00000014`.
- **Right:** 29px logo tile + "رَصد" + **role pill** ("عضو الفريق التنفيذي" teal tint / "رئيسة النطاق" `#0039350f` on `#003935`).
- **Center:** global search, `max-width 420px`, h 36px, bg `#f2f4f4`, radius 10px, placeholder "ابحثي عن مدرسة، عضوة، أو مؤشر…". Should search schools, members, and report content.
- **Left:** (member only) toggle "عرض الجوال الميداني" / "العودة للوحة"; notification bell 36px square with red count badge (`#dc2626`, 15px circle, top 5 / inset-inline-start 6px); avatar+name menu trigger.
- **Notifications dropdown** — 320px, radius 13px, `rsDrop`. Header "التنبيهات". Rows: 7px status dot (`#f59e0b` attention / `#067647` info) + text 12.5px/20px + time 10.5px.
  - Head role (7): "٣ عضوات لم يحدّثن بياناتهن اليوم" · "عنقود ٢ انخفض انضباطه إلى ٦٤٪" · "وصل ملف عنقود ٤ محدّثاً من هند الشمري".
  - Member role (3): "لم تُثبّت الغياب في مدرستين اليوم" · "باقي رفع استمارة تنفيذ الخطة ٣" · "تم استيراد تصنيف نافس لمدارسك".
- **Profile menu** — 230px: name+email header, "الملف الشخصي", "الإعدادات والصلاحيات", divider, "تسجيل الخروج" (`#dc2626`, 600).

**Body grid** — `240–250px | 1fr`, min-height `calc(100vh - 59px)`. Sidebar: white, border-inline-end `#00000014`, padding `18px 13px`. Main: padding `24px 28px 46px`, `overflow-x:hidden`.

---

### 5.3 Member workspace — `/cluster` (role: عضو الفريق التنفيذي)

**Sidebar**
1. **Completion card** — `#f7f8f8`, radius 12px: "اكتمال ملف العنقود" + big "٧٨٪" (15px/700 teal) + 6px progress.
2. **Nav** (7 items, section keys): البيانات الأولية `مكتمل` · مدارس العنقود `٦` · التقويم المدرسي · منصة مدرستي · الانضباط المدرسي · المهام `<pending count>` · التطوير المهني. Badge turns amber when the section has gaps.
3. **Gap card** (bottom) — `#fff7ed`: "ناقص عندك" + dynamic line "تثبيت الغياب لـN مدارس · رابط استمارة التنفيذ ٣".
4. **Primary CTA** — "إرسال التحديث لرئيسة النطاق" → "✓ أُرسل لرئيسة النطاق".

#### Section 1 — البيانات الأولية
Header: eyebrow "القسم الأول", h1, secondary "حفظ التعديلات" → "✓ حُفظت التعديلات" (turns teal-tinted).
One card, `max-width 1080px`, grid `repeat(auto-fit, minmax(220px,1fr))`, gap 16px. Fields in order:
الاسم الرباعي *(span 2)* · السجل المدني · الرقم الوظيفي · البريد الوزاري *(span 2, ltr)* · رقم الجوال · الرتبة *(select: خبير / متقدم / ممارس / ممارس متقدم)* · المؤهل · التخصص · التخصص الإشرافي · تاريخ التعيين *(Hijri)* · تاريخ التكليف بالإشراف *(Hijri)* · **عدد سنوات الخبرة** — read-only tile on `#f7f8f8` with hint "تُحسب تلقائياً" (derived from تاريخ التعيين).

#### Section 2 — بيانات مدارس العنقود
Header + summary pills: ٦ مدارس · ٣٬٢٤٠ طالبة · ٢٤٨ معلمة.
Two columns: `minmax(220px,270px) | 1fr`.
- **School list** (sticky, top 80px): rows with name 13px/600 + tier pill + meta "`<stage>` · `<students>` طالبة". Selected row: bg `#f0faf8`, `border-inline-end: 3px solid #009688`.
- **Detail stack** (3 cards):
  1. **School card** — title 18px/600 + meta "رقم العنقود ٤ · `<stage>` · `<الحي>` · الرقم الوزاري `<no>`" + tier pill; then an auto-fit field grid (`minmax(160px,1fr)`): البريد الوزاري · نوع التعليم (حضوري/مدمج) · برامج التربية الخاصة (+ النوع) · الحارس (يوجد/لايوجد) · عدد الفصول · عدد الطالبات · فصول موهبة · عدد فصول الموهبة · طالبات الموهبة · تطبيق اللغة الصينية (نعم/لا). Empty values render "—" in `#00000059`.
  2. **Staff card** "الهيئة التعليمية والإدارية" — 6 stat tiles on `#f7f8f8`: الهيئة التعليمية · الهيئة الإدارية · وكيلات المدرسة · المعلمات · رتبة خبير · رتبة متقدم. (Teaching-staff count is the sum of معلمات، موجهة طلابي، رائدة نشاط، موجهة صحية، محضرة مختبر، محضرة حاسب، أمينة مصادر — expose the breakdown on hover/expand.)
  3. **Leadership card** "القيادة المدرسية" — one row per role: left block = role label + state pill (rank, or مفرغة/مكلفة/لا يوجد — red pill when لا يوجد); right block = auto-fit field grid. Roles: مديرة المدرسة (الاسم، السجل المدني، الجوال، البريد الوزاري) · وكيلة الشؤون التعليمية · وكيلة الشؤون الطلابية · وكيلة الشؤون المدرسية (each: الاسم، الرتبة، السجل المدني، الجوال) · الموجهة الطلابية (الاسم، الجوال) · رائدة النشاط (الاسم، الجوال).
  > **Privacy:** national IDs and phone numbers are PII — gate them behind role permission and audit reads.

#### Section 3 — مؤشرات التقويم المدرسي
Header + import badge "مستورد من لوحة رئيسة النطاق · آخر تحديث ٠٢/٠٤" (teal tint).
- **Table** (min-width 840px), columns `1.4fr 1fr 1fr .9fr .9fr .9fr`: المدرسة · التصنيف (tier pill: تهيئة/انطلاق/تقدم/تميز) · نوع الدعم (الدعم وفق الاحتياج / الدعم عند الطلب) · نافس ("ارتفاع ٦٪" green / "انخفاض ٣٪" red) · القدرات · التحصيلي.
- **Two cards:** "التقرير الخارجي — المجالات والمعايير" (per-school drive link rows with مرفوع/ناقص pills) and "بطاقة نافس" (drive folder URL input + "تحديث الرابط").
- **Data source:** tiers and Nafes/Qudrat/Tahsili come from the district head's master Excel import, filtered per member — read-only here.

#### Section 4 — مؤشرات منصة مدرستي
- **Six average cards** (`minmax(170px,1fr)`): نسبة المعلمات المسندات للجداول · نسبة المعلمات المسندات للمقررات · نسبة الطلاب المسندين للفصول · نسبة دخول المعلمات · نسبة دخول الطالبات · نسبة الإنجاز. Value 24px/600 colored by the percentage scale + progress bar. Label block has `min-height 34px` so cards align.
- **Per-school table** (min-width 820px), `1.5fr repeat(6,1fr)` — same six metrics, every cell 600-weight and color-scaled.

#### Section 5 — مؤشرات الانضباط المدرسي
- **Table** (min-width 760px), `1.5fr 1fr 1fr 1fr 1fr`: المدرسة · التصنيف · يومي · أسبوعي · شهري. Daily value colored by the scale.
- **Two cards:** "خطة الانضباط للمدارس" (per-school معتمدة/لم تُرفع) and "خطة دعم الانضباط — عضو الفريق" (textarea + plan-file status row).
- **Data source:** discipline percentages import from the administration's daily Excel.

#### Section 6 — مهام عضو الفريق التنفيذي
- **تثبيت الغياب اليومي** card — header shows "N من ٦ مثبتة" + 110px progress (turns `#067647` at 6/6). Grid of school cards (`minmax(230px,1fr)`) each with a **toggle pill** تم / لم يتم. Not-done card: bg `#fef2f2`, border `#dc262626`. Resets daily; each toggle is an audited timestamped event.
- **تقارير الزيارات** card — teal pill with total "N زيارة"; per-school horizontal bars (label 130px / bar / count); button "رفع تقرير زيارة من الجوال" → opens the mobile view. **Visit count is derived from the number of uploaded reports in the drive folder — never hand-entered.**
- **الخطط** card — 5 rows, each name + hint "رابط درايف" + مرفوع/ناقص pill: تقرير تحليل الواقع · خطة التحسين · استمارة تنفيذ الخطة ١ · ٢ · ٣.

#### Section 7 — التطوير المهني
Four cards (`minmax(230px,1fr)`): مجتمعات التعلم المهنية · ورش العمل · دروس تطبيقية · برامج أخرى. Each: name 14px/600 + count 26px/700 teal; a `#f7f8f8` row "تقارير الدرايف" + مرفوعة/ناقصة pill; button "إضافة برنامج" (increments the count / opens an add-program form with a drive link).

---

### 5.4 Mobile field view (member) — `/field`

Shown inside an iPhone frame in the prototype; ship as the responsive mobile layout of the member app (or a PWA). 393×852 reference.

- **Top bar** (white): "عنقود ٤ · الأربعاء ١٤ شعبان" 11.5px + "مهام اليوم" 16.5px/600; 36px avatar tile (radius 12px).
- **Card 1 — تثبيت الغياب:** header + "N من ٦ مثبتة"; one compact row per school with the تم/لم يتم toggle pill.
- **Card 2 — تقرير زيارة سريع:** school `select` (h 42px) → activity chips (زيارة صفية · زيارة إشرافية · متابعة خطة · ورشة عمل) → textarea "وصف مختصر للزيارة وأبرز الملاحظات…" → 3-column attachment grid (filled teal tiles labeled صورة/PDF + dashed "+" tile, camera + file picker) → primary "رفع التقرير" → "✓ رُفع التقرير".
- **Card 3 — dark alert** (`#001d1a`): eyebrow "تنبيه رئيسة النطاق" + message.

Attachments: images and PDF/Word, client-side compressed; uploads must queue and retry offline (field connectivity is unreliable — a stated pain point).

---

### 5.5 District-head workspace — `/district` (role: رئيسة النطاق)

**Sidebar** — nav: نظرة النطاق · أعضاء الفريق `٢٥` · متابعة الإرسال `٧` · مساعد الذكاء الاصطناعي · التقرير المجمّع. Bottom: dark AI summary card (`#001d1a`) with eyebrow "ملخص الذكاء الاصطناعي", a generated paragraph, and button "افتحي المحادثة".

#### View A — نظرة النطاق (dashboard)
- Header: eyebrow with the Hijri date, h1, buttons "التقرير المجمّع" (secondary) + "متابعة الإرسال" (primary).
- **4 KPI cards** (`minmax(190px,1fr)`): عضوات حدّثن اليوم `١٨ / ٢٥` (+٣ عن أمس) · تثبيت الغياب `١٢٤ / ١٥٠` (٨٣٪ من مدارس النطاق) · متوسط الانضباط اليومي `٩٤٪` (−٢٪ عن الأسبوع, amber) · زيارات موثقة هذا الأسبوع `٤٧`.
- **Bar chart** "تثبيت الغياب خلال الأسبوع" — 5 bars (الأحد→الخميس), height = `value/150 × 128px`, radius `8px 8px 3px 3px`, max-width 54px. Current day `#009688`, others `#a2e0d8`, empty `#e6e9e9` with "—".
- **Tier breakdown** "تصنيف مدارس النطاق" — 4 labeled progress rows using tier colors (تميز ٢١ · تقدم ٦٨ · انطلاق ٥٢ · تهيئة ٩).
- **Cluster table** "أداء العناقيد" (min-width 760px), `1.3fr .8fr 1fr 1fr 1fr .9fr`: عضوة الفريق (avatar+name) · العنقود · تثبيت الغياب (`N / ٦`) · الانضباط (color-scaled) · الزيارات · الحالة (محدّثة green / متأخرة amber). Row click → that member's cluster file (read-only mirror of §5.3).

#### View B — متابعة الإرسال
- Header + primary "إرسال تذكير للباقيات" → "✓ أُرسل التذكير لـ٧ عضوات".
- Three count cards: حدّثن اليوم ١٨ (green) · متأخرات ٤ (amber) · لم يحدّثن ٣ (red).
- **Member grid** (`auto-fill, minmax(185px,1fr)`), 25 cards: status-colored avatar + name + "`<status>` · عنقود N". "لم تحدّث" card bg `#fef2f2`. Legend above with three dots.

#### View C — أعضاء الفريق
Filter chips (الكل · ملف مكتمل · ملف ناقص · انضباط منخفض) + card grid (`minmax(250px,1fr)`): avatar + name + "عنقود N · M مدارس" + completion row with a color-scaled progress bar. Card click → member cluster file.

#### View D — مساعد الذكاء الاصطناعي
- `max-width 880px`, column, height `calc(100vh - 105px)`.
- Message list: user bubble (teal, #fff, radius `16px 16px 4px 16px`, max-width 78%); assistant bubble (white + border, radius `16px 16px 16px 4px`, max-width 86%, line-height 26px).
- **Structured result cards** render below an answer when the response is tabular (e.g. "العناقيد الأقل في تثبيت الغياب" with name / cluster / color-scaled value). `rsFade` in.
- Suggestion chips: ملخص اليوم · من لم تحدّث بياناتها؟ · مدارس تصنيف تهيئة · نواقص التطوير المهني.
- Composer: input + "إرسال".
- **Required capabilities:** who submitted / who hasn't and when · daily & weekly summaries of report content · numeric extraction and aggregation · semantic search inside report text and attachments · flagging thin/incomplete reports · drafting reminder messages for late members.
- Ground every answer in retrieved records; **cite the member/school/date** behind each number and never invent figures.

#### View E — التقرير المجمّع
- Two columns `1fr | minmax(240px,290px)`.
- **Document card:** title "تقرير النطاق — `<date>`" + "مجمّع من ١٨ عضوة · ١٥٠ مدرسة"; **الملخص التنفيذي** (AI-generated paragraph, 14px/28px); **الأرقام المستخرجة** (6 tiles: مدرسة ١٥٠ · غياب مثبت ١٢٤ · زيارة ٤٧ · الانضباط ٩٤٪ · ورشة عمل ١٢ · مجتمع تعلم ٨); **المرفقات والروابط** (chips for the drive folders and Excel sources).
- **Sticky side card:** "خيارات التصدير" — three exclusive options (نص جاهز للنسخ · ملف PDF مجمّع · جدول Excel بالمؤشرات) + primary "تجهيز ونسخ" → "✓ تم النسخ" + note "ينسخ النص جاهزاً للصق في المنصة مع روابط مجلدات الدرايف."

---

## 6. Interactions & behavior

| Trigger | Result |
|---|---|
| Login submit | Match email → route by role. No match → inline error, field keeps focus. |
| Demo account card | Immediate login as that role. |
| Bell / avatar click | Open one dropdown, close the other. Outside click / `Esc` closes. |
| Sidebar nav | Switch section; main scrolls to top; URL updates (deep-linkable). |
| School list row | Select school; detail stack swaps; selection persists per session. |
| Absence toggle | Optimistic flip; writes a timestamped event; updates the section badge, gap card, and the head's KPIs live. |
| "حفظ التعديلات" | Save → button becomes "✓ حُفظت التعديلات" for ~3s. |
| "إرسال التحديث لرئيسة النطاق" | Submit snapshot → success label; head gets a notification + the member's row flips to "محدّثة". |
| "رفع التقرير" (mobile) | Upload with progress; on success "✓ رُفع التقرير"; visit counters recompute. |
| "إرسال تذكير للباقيات" | Sends to the pending members; label confirms the count. |
| AI suggestion chip / send | Append user message, stream the answer, render a result card when the answer is tabular. |
| "تجهيز ونسخ" | Generate the selected format; copy to clipboard or download; label confirms. |
| Member toggle "عرض الجوال الميداني" | Switch to the field layout; button label flips. |

**States to design for (not all shown in the prototype — implement them):** skeleton loaders for tables and KPI cards; empty states (no schools yet, no reports today, AI with no data); inline field validation (national ID length, phone format, ministry email domain, required fields before submit); upload failure with retry; offline banner on mobile; permission-denied view.

**Responsive:** ≥1280px as drawn. 1024–1280px: sidebar 240px, KPI grid wraps to 2 columns. <1024px: sidebar becomes a drawer; tables keep horizontal scroll (they already carry `min-width`). <768px: single column, phone layout of §5.4.

---

## 7. State & data model

**Session:** `user {id, name, email, role, clusterId?, initials}`, `token`, `permissions[]`.
**UI:** `activeSection` (member), `activeView` (head), `selectedSchoolId`, `menuOpen`, `notifOpen`, `fieldMode`, `filters`, transient success flags (`saved`, `sent`, `reminded`, `exported`) that auto-reset.

**Entities**
- `Member` — the 12 profile fields (§5.3.1) + `clusterId`; `yearsOfExperience` is **derived**.
- `Cluster` — `{id, number, memberId, schoolIds[]}`.
- `School` — identity (`name, stage, area, ministryNo, ministryEmail, educationType, specialEdProgram`), capacity (`classes, students, giftedClasses, giftedStudents, hasGifted, hasGuard, teachesChinese`), staffing (`teachingStaff{breakdown}, adminStaff, deputiesCount, teachers, expertRank, advancedRank`), leadership (`principal, deputies[], studentCounselor{assignment}, activityLeader{assignment}`).
- `EvaluationIndicators` — `{schoolId, tier, supportType, nafesDelta, qudrat, tahsili, externalReportUrl, nafesCardUrl, importedAt}` *(imported, read-only for members)*.
- `MadrasatiIndicators` — `{schoolId, scheduleAssignment, courseAssignment, studentAssignment, teacherLogin, studentLogin, completion, syncedAt}`.
- `DisciplineIndicators` — `{schoolId, tier, daily, weekly, monthly, planStatus, planUrl, importedAt}` + `memberSupportPlan {text, fileUrl}`.
- `AbsenceConfirmation` — `{schoolId, date, done, confirmedAt, confirmedBy}` (one per school per day).
- `VisitReport` — `{id, schoolId, memberId, type, text, attachments[], createdAt}`; cluster visit count = `count(VisitReport)`.
- `Plan` — `{clusterId, kind: realityAnalysis|improvement|execution1|execution2|execution3, url, status}`.
- `PDProgram` — `{clusterId, kind: plc|workshop|appliedLesson|other, count, reportsUrl, status}`.
- `DailySubmission` — `{memberId, date, status: submitted|late|missing, submittedAt}` (drives §5.5 B).
- `Notification`, `AuditLog` (who changed what, when — required for PII fields).

**Integrations**
1. **Nafes / external-report Excel** — uploaded by the head, parsed, filtered per cluster, pushed to members (read-only).
2. **Daily discipline Excel** — administration source, scheduled import.
3. **Madrasati indicators** — scheduled sync or manual upload.
4. **Google Drive** — folder-per-cluster; visit counts derived from file counts; store folder IDs, not just URLs.
5. **AI layer** — index report text, extracted numbers, and attachment OCR; retrieval-grounded answers with citations.

**Permissions:** members read/write only their own cluster; the head reads all and writes imports/reminders; PII (national IDs, phones) role-gated and logged.

---

## 8. Copy reference

All Arabic strings in §5 are final copy. Tone: **simple and direct**, addressing the user in the feminine second person (ادخلي، اسألي، أرفقي). Dates are Hijri (e.g. "الأربعاء ١٤ شعبان"). Numbers always Arabic-Indic. Avoid exclamation marks and emoji.

---

## 9. Assets

No images or icon sets are used. Glyphs in the prototype (`⌕`, `◔`, `▾`, `‹`, `✓`, `+`, `✦`) are placeholders — **replace with the codebase's icon library** (search, bell, chevron-down, chevron-start, check, plus, sparkle). Avatars are initials, not photos. The only external dependency is the Google Font.

---

## 10. Files in this bundle

| File | Role |
|---|---|
| `Rasd Platform.dc.html` | **Canonical design** — login + both role workspaces + mobile field view |
| `Rasd Reports v2.dc.html` | Earlier iteration without auth (reference only) |
| `ios-frame.jsx` | Device frame used to present the mobile view — presentation only, do not port |
| `support.js` | Prototype runtime — **do not port** |

Open either `.dc.html` file directly in a browser to interact with the design.

---

## 11. Suggested build order

1. RTL shell, theme tokens, typography, Arabic-numeral formatter.
2. Auth + role routing + app shell (header, dropdowns, sidebar).
3. Member sections 1–2 (profile, schools) — the data backbone.
4. Section 6 (tasks: absence + visits + plans) — the highest-frequency daily use.
5. Mobile field view with offline upload queue.
6. Imports (Nafes, discipline, Madrasati) → member sections 3–5.
7. District dashboard + submission tracking + reminders.
8. AI assistant over indexed reports.
9. Consolidated report generation and export.
