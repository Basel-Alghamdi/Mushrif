# رَصد (Rasd) — Complete Build Specification

**Supervision-district reporting & indicator platform · Arabic-first (RTL) · Saudi MoE context**

Version 1.0 · Build-ready. Everything needed to implement is in this document: screens, every field, every string, data model, DB schema, API contracts, permissions, validation, AI layer, imports, and build order.

Design reference: `Rasd Platform.dc.html` (open in a browser — interactive). It is a **design reference**, not production code. Recreate it in your target stack.

---

# PART 0 — Product summary

## 0.1 Problem
A district head (**رئيسة النطاق**) supervises **25 executive team members** (**أعضاء الفريق التنفيذي**). Each member owns a **cluster (عنقود)** of ~6 schools — **~150 schools** total. Today each member sends daily/near-daily reports by WhatsApp/email; the head merges them by hand and uploads a consolidated report to the ministry platform. Manual, lossy, no visibility on who submitted.

## 0.2 Solution
1. Each member maintains a structured **cluster file** (8 sections) and files field work from their phone.
2. Files are uploaded as-is (PDF / Word / Excel / images / audio) and an **AI ingest pipeline** transcribes, extracts, and pre-fills fields with source citations and confidence levels.
3. The head gets a live dashboard, submission tracking, a per-member profile with a full delivery timeline, an **AI agent** that answers questions and executes actions, and a one-click **consolidated report**.
4. Because field applicability varies by district, members can **add, rename, delete** fields, indicators, leadership roles, schools, and whole sections.

> **The structure is user data, not a hard-coded layout.** Every value in a member's own cluster file is editable unless it is listed as derived or imported. See **`EDITABILITY.md`** for the complete action inventory — it is binding, not optional.

## 0.3 Roles
| Role | Arabic | Scope |
|---|---|---|
| Executive team member | عضو الفريق التنفيذي | Own cluster only (read/write) |
| District head | رئيسة النطاق | All 25 clusters (read) + imports, reminders, exports |

## 0.4 Non-negotiable product rules
1. **Visit counts are derived**, never hand-entered — `count(VisitReport)` in the cluster's drive folder.
2. **Years of experience is derived** from `تاريخ التعيين`.
3. **Evaluation indicators (tier, Nafes, Qudrat, Tahsili) are imported by the head** — read-only for members.
4. **Absence confirmation resets daily** and every toggle writes an audited, timestamped event.
5. **Every AI-extracted value carries its source** (file + page/row) and a confidence level; nothing is written to the file without member confirmation.
6. **Every AI answer cites** the member / school / date behind each number. Never invent figures.
7. **PII (national IDs, phones) is role-gated and every read is logged.**
8. All numerals display as **Arabic-Indic digits** (٠١٢٣٤٥٦٧٨٩); storage is Western digits.

---

# PART 1 — Design foundations

## 1.1 Direction & language
- `dir="rtl"` on document root. Sidebar **right**, content **left**, text right-aligned.
- Use logical CSS properties only: `margin-inline-start/end`, `padding-inline`, `border-inline-end`, `inset-inline-start`. Never `left`/`right`.
- Latin content (emails, URLs) inside an RTL page: `dir="ltr"; text-align:left` on that element only.
- **Numeral formatter** at the display layer:
  ```js
  const AR = s => String(s).replace(/[0-9]/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);
  const fromAR = s => parseInt(String(s).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)), 10);
  ```
  Thousands separator: `٣٬٢٤٠` (Arabic thousands separator U+066C).
- Dates display as **Hijri** (`الأربعاء ١٤ شعبان`, `١٤٣٢/٠٧/١٥`); store ISO Gregorian + Hijri string.

## 1.2 Typography
Family: **IBM Plex Sans Arabic** (Google Fonts) — 400 / 500 / 600 / 700. Fallback `system-ui, sans-serif`. `-webkit-font-smoothing: antialiased`.

| Role | Size | Weight | Line-height | Extra |
|---|---|---|---|---|
| Login hero headline | 32px | 600 | 48px | on dark |
| Login title | 26px | 600 | — | |
| Page title h1 | 24–26px | 600 | — | `letter-spacing:-.02em` |
| Profile name | 21px | 600 | — | `letter-spacing:-.02em` |
| School detail title | 18px | 600 | — | |
| Card title | 14–15px | 600 | — | |
| KPI number | 26–30px | 600 | 1 | `letter-spacing:-.02em` |
| Stat tile number | 20–22px | 600 | 1.1 | |
| PD count | 26px | 700 | 1 | teal |
| Body | 13.5–14px | 400 | 23–28px | |
| Table cell | 12.5–13px | 400/600 | — | |
| Nav item | 13px | 500/600 | — | |
| Field label | 11.5–12px | 600 | — | `#00000099` |
| Section eyebrow | 11px | 600 | — | `letter-spacing:.1em`, `#009688` |
| Dark-panel eyebrow | 10.5–11px | 600 | — | `letter-spacing:.08em`, `#80d5cb` |
| Meta / caption | 11–11.5px | 400 | 17–19px | `#00000080` |
| Pill / badge | 10.5–11px | 600 | — | |

Floor: 11px (meta only); interactive text ≥12px; mobile hit targets ≥44px.

## 1.3 Color tokens

```
primary            #009688   brand, primary buttons, active nav, progress fills
primary-dark       #007970   text on tint, hover
primary-tint       #e1f5f2   active nav bg, avatar bg, badges
primary-tint-soft  #f0faf8   selected row bg, dashed edit surfaces
ink-dark           #001d1a   dark panels (login hero, AI summary, agent plan)
ink-deep           #003935   head-role avatar
mint               #80d5cb   eyebrow on dark
bar-soft           #a2e0d8   non-current chart bars
bar-empty          #e6e9e9   empty bar / tinted track
canvas             #f2f4f4   app background
surface            #ffffff   cards, header, sidebar
surface-alt        #f7f8f8   inner stat tiles, read-only fields
text               #000000de
text-2             #00000099
text-3             #00000080
text-4             #00000073
text-5             #00000059
text-6             #00000047   placeholder
border             #00000014
border-soft        #00000010
border-input       #0000001f
success            #067647
warning            #b45309 / #92400e ; dot #f59e0b ; bg #fff7ed ; border #f59e0b2e
danger             #dc2626 ; bg #fef2f2 ; border #dc262626
```

**Percentage scale** (all indicator values): `≥95 → #067647` · `≥85 → #009688` · `≥75 → #b45309` · `<75 → #dc2626`

**School tier colors:** تميز `#067647` · تقدم `#009688` · انطلاق `#b45309` · تهيئة `#dc2626`
Tier pill = `background: <color>14` (8% α), `color: <color>`.

## 1.4 Spacing, radius, elevation
- Spacing: 2 3 4 5 6 7 8 9 10 11 12 13 14 16 18 20 22 24 26 28 30 46 px.
- Page padding `24px 28px 46px`. Card padding 17–26px. Grid gaps 9–16px.
- Radius: pill `99px` · card `14px` · inner tile/dropdown `11–13px` · input/small button `9–10px` · nav item `9px` · tiny button `6–8px`.
- Shadows: cards are **border-only** (`1px solid #00000014`), no shadow.
  - Primary button: `inset 0 0 0 1px rgba(255,255,255,.16), 0 2px 10px rgba(0,150,136,.24)`
  - Dropdown: `0 12px 32px rgba(10,13,18,.14)`
  - Segmented active: `0 1px 2px rgba(0,0,0,.08)`

## 1.5 Component primitives

| Component | Spec |
|---|---|
| **Primary button** | h 42–46px, r 10–11px, bg `#009688`, #fff 13.5–14.5px/600, inset highlight + teal glow |
| **Secondary button** | h 38–40px, r 9px, bg #fff, border `#00000014`, `#00000099` 12.5–13px/500–600 |
| **Small button** | h 30–36px, r 8–9px, 11.5–12.5px/600 |
| **Tiny delete (×)** | 20–24px square, r 5–7px, border `#dc262633`, bg #fff, `#dc2626` 11–13px/700 |
| **Add button (dashed)** | h 34–36px, r 9px, `1.5px dashed #00968866`, bg `#f0faf8`, `#007970` 12–12.5px/600 |
| **Input / select** | h 40–44px (34–38 compact), r 9–10px, border `#0000001f`, bg #fff, 13–13.5px. Placeholder `#00000047` |
| **Label-rename input** | h 24–30px, r 6–7px, `1px dashed #00968866`, bg `#f0faf8`, `#007970` 10.5–11.5px/600 |
| **Textarea** | padding 11px, r 10px, border `#0000001f`, lh 21–23px, `resize:none` |
| **Chip** | padding 7–8 × 12–13px, r 99px. Off: #fff / `#00000014` / `#00000099` / 500. On: `#e1f5f2` / `#009688` / `#007970` / 600 |
| **Nav item** | full width, min-h 38px, padding-inline 11px, r 9px, gap 9px, 13px. Active: `#e1f5f2` / `#007970` / 600. Inactive: transparent / `#00000099` / 500. 6px status dot (`#00968840` ok, `#f59e0b` gap) + optional count badge |
| **Status pill** | padding 4 × 10px, r 99px, 11px/600. ok `#06764714`/`#067647` · missing `#dc262614`/`#dc2626` · late `#f59e0b1f`/`#92400e` |
| **Avatar** | circle. 24px header · 30px rows/grid · 34px cards/login · 38px sidebar · 48–54px profile. Member `#e1f5f2`/`#007970`; head `#003935`/#fff; status variants `<color>1a`/`<color>`. Content = 2 Arabic initials |
| **Progress bar** | track h 6–7px, r 99px, `#f2f4f4` (`#e6e9e9` on tinted card); fill r 99px, color from % scale |
| **Data table** | header: padding 12–13 × 20px, bottom border `#00000014`, 11–11.5px/600 `#00000080`. Body row: padding 13–14 × 20px, divider `#00000010`, 12.5–13px. Inside a card with `overflow-x:auto` + inner `min-width` 700–840px |
| **Upload dropzone** | `1.5px dashed #00968840`, r 14px, padding 30px, centered; 46px tinted icon tile, title 14.5px/600, hint 12px `#00000080`, primary button |

## 1.6 Animation
```css
@keyframes rsFade { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:none } }  /* 250–350ms ease */
@keyframes rsDrop { from { opacity:0; transform:translateY(-6px) } to { opacity:1; transform:none } }  /* 160ms ease */
```
`rsFade` — success states, AI result cards, preview panel. `rsDrop` — header dropdowns. Nothing else. Respect `prefers-reduced-motion`.

## 1.7 Accessibility
- Body text ≥4.5:1; pill text is full-opacity ink on 8% tint (passes).
- Icon-only controls (bell, ×) need `aria-label`.
- Dropdowns: close on outside click + `Esc`, focus trap, `aria-expanded` on trigger.
- Every input has a programmatically associated label.
- Delete actions on destructive items (school, section, leadership role) need a confirm step in production.

## 1.8 Icons
No icon set is used in the reference. Glyphs `⌕ ◔ ▾ ‹ ✓ × + ↑ ✦ !` are placeholders — replace with the codebase's icon library: search, bell, chevron-down, chevron-start, check, close, plus, upload, sparkle, alert. Avatars are initials, never photos.

## 1.9 Responsive

One breakpoint carries the whole system: **900px**. Above it, the layout is exactly as drawn. At or below it, the app switches to the phone layout below. The reference implements this and it is verified down to 390px — match it.

| Width | Behavior |
|---|---|
| ≥1280px | As drawn |
| 900–1280 | Sidebar 240px; auto-fit grids reflow on their own (`minmax` floors already handle it) |
| ≤900 | Phone layout — full rule set below |

### Rules at ≤900px

**Login** — the 2-column grid collapses to one column and the dark brand panel is **hidden** (its content is marketing, not task). Form column keeps `max-width 380px`, padding drops to `32px 20px`.

**Header** — padding `9px 13px`, gap 9px. A **36px burger button** (right-most, before the brand lockup) appears and is the drawer trigger. Hidden at this width: the global search field, the user's name next to the avatar, and the **role pill**. The member's `عرض الجوال الميداني` button collapses to a **36px icon-only square**. The bell, avatar, and burger stay — three 36px targets plus the brand lockup fit 390px with room.

**Sidebar → drawer** — the `240–250px | 1fr` body grid becomes a single column and the sidebar becomes an off-canvas panel:
```
position: fixed; inset-block: 0; inset-inline-end: 0;
width: 284px; max-width: 86vw; z-index: 60;
transform: translateX(104%);            /* RTL: off to the inline-end edge */
transition: transform .22s ease;
box-shadow: -18px 0 44px rgba(0,0,0,.18);
```
Open state clears the transform. A scrim (`position:fixed; inset:0; background:#00000059; z-index:55`) renders only while open; tapping the scrim **or any item inside the drawer** closes it, so a nav pick navigates and dismisses in one tap. The sidebar keeps its own scroll; the completion card, gap card, and primary CTA all travel with it.

**Main** — padding `16px 13px 40px`.

**Grids that must be forced to one column** (their `minmax` floor or fixed track would otherwise overflow):
- the profile fields grid — **and its `grid-column: span 2` items must be reset to `span 1`**; a span-2 item forces a second track even when `auto-fit` resolved to one, which pushes ~160px of the card outside the viewport
- the schools two-column split (list + detail) — the sticky school list also drops to `position: static` and stacks above the detail
- each leadership row (`minmax(130px,190px) | 1fr`) — and its inner field grid's `minmax(120px,1fr)` floor must relax to `minmax(0,1fr)`, or the inputs overflow their 110px track
- the profile timeline's `150px 1fr`
- the consolidated-report `1fr | side card` split

**Dropdowns** — the notification (320px) and profile (230px) menus switch to `position:fixed; top:56px; inset-inline:12px; width:auto` so they can't be clipped by the viewport edge.

**Tables** are already correct: every wide table sits in a card with `overflow-x:auto` around an inner `min-width` (700–840px), so it scrolls horizontally instead of breaking the page. Do not remove those wrappers.

**Below 768px** the member may also use the dedicated field layout (§3.4); it is the same data, optimized for one-handed daily entry.

### Desktop sidebar (≥900px)
`position:sticky; top:<headerH>; height:calc(100vh - <headerH>); overflow-y:auto`, with the body grid `align-items:start` — the bottom block must sit in the same place on every page.

### Verification checklist
At 390px, 414px, and 768px, no element may report `scrollWidth > clientWidth` except the intentional `overflow-x:auto` table wrappers. Check the profile fields card, the leadership card, and the header specifically — those are the three that break first.

---

# PART 2 — Seed data (use verbatim for the prototype/demo)

## 2.1 Accounts
```js
member: { name:"هند سعد عبدالله الشمري", short:"هند الشمري", initials:"هش",
          email:"h.alshammari@moe.gov.sa", role:"عضو الفريق التنفيذي · عنقود ٤" }
head:   { name:"سارة القحطاني", initials:"سق",
          email:"s.alqahtani@moe.gov.sa", role:"رئيسة النطاق · ٢٥ عضوة" }
```

## 2.2 The 25 members
```
هند الشمري · منيرة الدوسري · لطيفة الغامدي · ريم الحربي · عبير القرني · أمل السبيعي ·
نورة العتيبي · سمية الزهراني · دلال المطيري · جواهر الرشيد · بشرى العنزي · مها الخالدي ·
شهد البقمي · نوف السهلي · رنا الجهني · أروى الثقفي · خلود الشهري · وجدان المالكي ·
تهاني الحسن · غادة الصاعدي · إيمان العمري · فاطمة الأحمدي · رغد النفيعي · سارة اليامي ·
حصة الشمراني
```
Email local parts (append `@moe.gov.sa`):
```
h.alshammari m.aldosari l.alghamdi r.alharbi a.alqarni a.alsubaie n.alotaibi s.alzahrani
d.almutairi j.alrashid b.alanzi m.alkhalidi s.albaqami n.alsahli r.aljuhani a.althaqafi
k.alshehri w.almalki t.alhassan g.alsaedi e.alamri f.alahmadi r.alnufaie s.alyami h.alshamrani
```
Phones:
```
٠٥٥٤٢٣٨٨١٠ ٠٥٠٣٣٤٤٥٥٦ ٠٥٤٩٩٨٨٧٧٦ ٠٥٥٦٦٧٧٨٨٩ ٠٥٠٢٢٣٣٤٤٥ ٠٥٣٤٤٥٥٦٦٧ ٠٥٦٧٧٨٨٩٩٠
٠٥٥١٢٣٤٥٦٧ ٠٥٩٨٧٦٥٤٣٢ ٠٥٣٢٢٣٣٤٤٥ ٠٥٦١٢٣٤٥٦٧ ٠٥٤٤٥٥٦٦٧٧ ٠٥٠٩٩٨٨٧٧٦ ٠٥٥٩٨٧٦٥٤٣
٠٥٣١١٢٢٣٣٤ ٠٥٥٤٤٣٣٢٢١ ٠٥٠٧٧٦٦٥٥٤ ٠٥٦٣٣٢٢١١٠ ٠٥٤٨٨٧٧٦٦٥ ٠٥٣٥٥٤٤٣٣٢ ٠٥٠١١٢٢٣٣٤
٠٥٦٩٩٨٨٧٧٦ ٠٥٥٢٢١١٠٠٩ ٠٥٤٦٦٥٥٤٤٣ ٠٥٣٧٧٨٨٩٩٠
```
Per-member derived demo values (index 0–24):
```
completion  92 78 85 64 96 71 88 59 80 74 90 66 82 95 70 86 61 79 93 68 84 72 89 63 77
discipline  96 88 94 79 92 85 90 73 87 91 95 80 83 97 76 89 68 82 94 75 86 78 92 70 84
absenceDone  6  5  6  3  6  4  6  2  5  6  6  3  4  6  3  5  2  4  6  3  5  4  6  2  4
visits       9  8 11  6  7  6 10  4  8  9 12  5  7 11  6  8  3  7 10  5  9  6 11  4  7
rank cycle  خبير / متقدم / ممارس متقدم / ممارس   (index % 4)
major cycle رياضيات / لغة عربية / علوم / اجتماعيات / لغة إنجليزية   (index % 5)
```
Submission status: indices **0–17 = حدّثت** (18), **18–21 = متأخرة** (4), **22–24 = لم تحدّث** (3).
Last-update label: حدّثت → `اليوم ١:٤٢ م` · متأخرة → `اليوم ٤:٥٠ م (بعد الموعد)` · لم تحدّث → `أمس ٣:٥٠ م`.

## 2.3 Cluster 4 — the 6 schools (full records)

**School 1 — ابتدائية الأندلس**
```
stage ابتدائية · area حي الأندلس · ministryNo ١٢٤٥٦٧ · email andalus@moe.gov.sa
educationType حضوري · specialEd يوجد — صعوبات تعلم · guard يوجد
classes 24 · students 612 · teachingStaff 38 · adminStaff 6 · deputies 3 · expert 4 · advanced 9
gifted يوجد · giftedClasses 2 · giftedStudents 44 · chinese لا
tier تقدم · support الدعم وفق الاحتياج · nafes ارتفاع ٦٪ · qudrat ٧٨٪ · tahsili ٧٤٪
madrasati [96,92,99,88,81,86] · discipline {daily ٩٦٪, weekly ٩٤٪, monthly ٩٥٪}
absenceConfirmed true · visits 9
principal منال العنزي · خبير · ١٠٢٣٤٥٦٧٨٩ · ٠٥٥١٢٣٤٥٦٧ · m.alanzi@moe.gov.sa
deputies: وكيلة الشؤون التعليمية سمية الزهراني متقدم | وكيلة الشؤون الطلابية دلال المطيري ممارس متقدم | وكيلة الشؤون المدرسية نوف السهلي ممارس
counselor مفرغة · رنا الجهني · ٠٥٠٣٣٤٤٥٥٦
activityLeader مكلفة · أروى الثقفي · ٠٥٣٢٢٣٣٤٤٥
```

**School 2 — متوسطة النهضة**
```
stage متوسطة · area حي النهضة · ministryNo ١٢٤٥٩٠ · email nahda@moe.gov.sa
educationType مدمج · specialEd لا يوجد · guard يوجد
classes 18 · students 486 · teachingStaff 32 · adminStaff 5 · deputies 2 · expert 2 · advanced 7
gifted لا يوجد · giftedClasses 0 · giftedStudents 0 · chinese نعم
tier تميز · support الدعم عند الطلب · nafes ارتفاع ٩٪ · qudrat ٨٢٪ · tahsili ٧٩٪
madrasati [100,97,100,93,88,91] · discipline {٩٨٪, ٩٧٪, ٩٧٪}
absenceConfirmed true · visits 8
principal هيفاء الرشيد · خبير · ١٠٣٣٤٥٥٦٧٨ · ٠٥٥٩٨٧٦٥٤٣ · h.alrashid@moe.gov.sa
deputies: التعليمية بشرى العنزي متقدم | الطلابية مها الخالدي ممارس متقدم
counselor مفرغة · شهد البقمي · ٠٥٦٧٧٨٨٩٩٠
activityLeader مفرغة · غادة الصاعدي · ٠٥٤٤٥٥٦٦٧٧
```

**School 3 — ثانوية الرواد**
```
stage ثانوية · area حي الملز · ministryNo ١٢٤٦٠٣ · email rowad@moe.gov.sa
educationType حضوري · specialEd يوجد — الدمج الكلي · guard لا يوجد
classes 21 · students 558 · teachingStaff 41 · adminStaff 7 · deputies 3 · expert 5 · advanced 11
gifted يوجد · giftedClasses 1 · giftedStudents 22 · chinese لا
tier انطلاق · support الدعم وفق الاحتياج · nafes انخفاض ٣٪ · qudrat ٧١٪ · tahsili ٦٨٪
madrasati [91,84,96,76,70,74] · discipline {٨٨٪, ٨٦٪, ٨٧٪}
absenceConfirmed false · visits 11
principal فاطمة الأحمدي · متقدم · ١٠٤٤٥٥٦٦٧٧ · ٠٥٣١١٢٢٣٣٤ · f.alahmadi@moe.gov.sa
deputies: التعليمية تهاني الحسن متقدم | الطلابية خلود الشهري ممارس | المدرسية وجدان المالكي ممارس
counselor مكلفة · إيمان العمري · ٠٥٠٩٩٨٨٧٧٦
activityLeader لا يوجد · — · —
```

**School 4 — ابتدائية الفيصلية**
```
stage ابتدائية · area حي الفيصلية · ministryNo ١٢٤٦١٩ · email faisaliah@moe.gov.sa
educationType حضوري · specialEd لا يوجد · guard يوجد
classes 16 · students 402 · teachingStaff 27 · adminStaff 4 · deputies 2 · expert 1 · advanced 6
gifted لا يوجد · chinese لا
tier تقدم · support الدعم عند الطلب · nafes ارتفاع ٤٪ · qudrat ٧٦٪ · tahsili ٧٢٪
madrasati [95,90,98,85,79,83] · discipline {٩٥٪, ٩٣٪, ٩٤٪}
absenceConfirmed true · visits 7
principal رغد النفيعي · متقدم · ١٠٥٥٦٦٧٧٨٨ · ٠٥٥٤٤٣٣٢٢١ · r.alnufaie@moe.gov.sa
deputies: التعليمية سارة اليامي ممارس متقدم | الطلابية حصة الشمراني ممارس
counselor مكلفة · نجود الحربي · ٠٥٦١٢٣٤٥٦٧
activityLeader مكلفة · أفنان القرني · ٠٥٩٨٧٦٥٤٣٢
```

**School 5 — متوسطة الخنساء**
```
stage متوسطة · area حي السلام · ministryNo ١٢٤٦٢٨ · email khansa@moe.gov.sa
educationType مدمج · specialEd يوجد — التوحد · guard يوجد
classes 15 · students 389 · teachingStaff 29 · adminStaff 5 · deputies 2 · expert 2 · advanced 5
gifted يوجد · giftedClasses 1 · giftedStudents 18 · chinese لا
tier تقدم · support الدعم وفق الاحتياج · nafes ارتفاع ٢٪ · qudrat ٧٤٪ · tahsili ٧٠٪
madrasati [94,89,97,83,77,81] · discipline {٩٣٪, ٩١٪, ٩٢٪}
absenceConfirmed false · visits 6
principal عبير القرني · متقدم · ١٠٦٦٧٧٨٨٩٩ · ٠٥٠٢٢٣٣٤٤٥ · a.alqarni@moe.gov.sa
deputies: التعليمية جواهر الرشيد متقدم | الطلابية لمى الدوسري ممارس
counselor مفرغة · ريم الحربي · ٠٥٥٦٦٧٧٨٨٩
activityLeader مكلفة · هيا السبيعي · ٠٥٣٤٤٥٥٦٦٧
```

**School 6 — ابتدائية الروضة**
```
stage ابتدائية · area حي الروضة · ministryNo ١٢٤٦٣٧ · email rawdah@moe.gov.sa
educationType حضوري · specialEd لا يوجد · guard لا يوجد
classes 14 · students 793 · teachingStaff 31 · adminStaff 5 · deputies 2 · expert 1 · advanced 4
gifted لا يوجد · chinese لا
tier تهيئة · support الدعم وفق الاحتياج · nafes انخفاض ٧٪ · qudrat ٦٥٪ · tahsili ٦١٪
madrasati [86,78,92,68,62,66] · discipline {٨٢٪, ٨٠٪, ٨١٪}
absenceConfirmed false · visits 6
principal لطيفة الغامدي · ممارس متقدم · ١٠٧٧٨٨٩٩٠٠ · ٠٥٤٩٩٨٨٧٧٦ · l.alghamdi@moe.gov.sa
deputies: التعليمية أمل السبيعي ممارس | المدرسية نورة العتيبي ممارس
counselor لا يوجد · — · —
activityLeader لا يوجد · — · —
```

Deputy placeholder PII (demo): nid `١٠٨٨٩٩٠٠١١`, phone `٠٥٥٠٠١١٢٢٣`.
Cluster 4 summary pills: **٦ مدارس · ٣٬٢٤٠ طالبة · ٢٤٨ معلمة**. Cluster completion **٧٨٪**.

## 2.4 District-level numbers
```
members 25 · schools 150 · date الأربعاء ١٤ شعبان
KPI: عضوات حدّثن اليوم ١٨/٢٥ (+٣ عن أمس, good)
     تثبيت الغياب ١٢٤/١٥٠ (٨٣٪ من مدارس النطاق, good)
     متوسط الانضباط اليومي ٩٤٪ (−٢٪ عن الأسبوع, warn)
     زيارات موثقة هذا الأسبوع ٤٧ (من ٢٥ عنقوداً, good)
Week bars (absence fixed / 150): الأحد 142 · الاثنين 148 · الثلاثاء 131 · الأربعاء 124 · الخميس 0 (—)
Tier split: تميز ٢١ مدرسة (14%) · تقدم ٦٨ (45%) · انطلاق ٥٢ (35%) · تهيئة ٩ (6%)
Cluster table rows 1–6: discipline 96 88 94 79 92 85 · absence 6/5/6/3/6/4 of ٦ · visits 9 8 11 6 7 6
  → row 4 (ريم الحربي) state "متأخرة"; others "محدّثة"
Notification counts: head ٧ · member ٣
```

## 2.5 Madrasati averages (computed from the 6 schools)
Labels, in order:
```
نسبة المعلمات المسندات للجداول · نسبة المعلمات المسندات للمقررات · نسبة الطلاب المسندين للفصول
نسبة دخول المعلمات · نسبة دخول الطالبات · نسبة الإنجاز
```
Averages: **٩٤ · ٩٠ · ٩٧ · ٨٢ · ٧٦ · ٨٠** (rounded mean of the six schools' arrays).

## 2.6 Professional development (cluster 4)
```
مجتمعات التعلم المهنية 4 (مرفوعة) · ورش العمل 12 (مرفوعة) · دروس تطبيقية 6 (مرفوعة) · برامج أخرى 2 (ناقصة)
```

## 2.7 Plans (cluster 4)
```
تقرير تحليل الواقع    رابط درايف   مرفوع   (رُفع ٢٨ رجب)
خطة التحسين          رابط درايف   مرفوع   (رُفعت ٠٨ شعبان)
استمارة تنفيذ الخطة ١  رابط درايف   مرفوع   (رُفعت ٠٢ شعبان)
استمارة تنفيذ الخطة ٢  رابط درايف   مرفوع   (رُفعت ١١ شعبان)
استمارة تنفيذ الخطة ٣  لم تُرفع بعد  ناقص    (متأخرة ٤ أيام)
```

## 2.8 Ingest queue seed
```
تقرير نافس — مدارس العنقود.pdf   PDF     ٢٫٤ م.ب   done        14 fields
الانضباط اليومي.xlsx              Excel   ٨٤٠ ك.ب   done        18 fields
محضر اجتماع القيادة.docx          Word    ١٢٠ ك.ب   review       5 fields
صور الزيارة الصفية.jpg            صورة    ٣٫١ م.ب   processing   0 fields  (bar 46%)
```
"Add files" appends: `خطة التحسين ١٤٤٧.pdf · PDF · ١٫١ م.ب · processing`.

Extraction review table (`٣٧ حقلاً · ٥ تحتاج تأكيدك`):
```
نتيجة نافس — ابتدائية الأندلس       | ارتفاع ٦٪       | عالية  | تقرير نافس.pdf · ص ٢
تصنيف المدرسة — ثانوية الرواد        | انطلاق          | عالية  | تقرير نافس.pdf · ص ٥
الانضباط اليومي — متوسطة الخنساء    | ٩٣٪             | عالية  | الانضباط اليومي.xlsx · صف ١٢
عدد المعلمات — ابتدائية الروضة       | ٣١              | متوسطة | محضر الاجتماع.docx · فقرة ٣
وكيلة الشؤون الطلابية — الفيصلية     | حصة الشمراني    | متوسطة | محضر الاجتماع.docx · فقرة ٦
```
Agent steps (dark panel, "ما الذي فعله المساعد"):
```
✓ قرأ ٤ ملفات وحوّل الصور والمسح الضوئي إلى نص
✓ استخرج ٣ جداول وطابق أسماء المدارس مع سجل العنقود
✓ حوّل النسب والأرقام إلى حقول المؤشرات
! رصد تعارضين بين ملف الانضباط ومحضر الاجتماع
footnote: كل قيمة مستخرجة مرتبطة بمصدرها في الملف — تقدرين ترجعين للسطر الأصلي قبل الاعتماد.
```

## 2.9 AI chat seed & canned answers
Opening exchange:
```
user: أي عناقيد متأخرة في تثبيت الغياب اليوم؟
ai:   ثلاثة عناقيد تحت ٧٠٪: عنقود ٢ (٦٤٪)، عنقود ٧ (٦٨٪)، عنقود ١١ (٦٩٪). الأثر الأكبر من ٦ مدارس لم تُثبّت منذ يومين.
table "العناقيد الأقل في تثبيت الغياب":
  منيرة الدوسري | عنقود ٢  | ٦٤٪
  خلود الشهري   | عنقود ٧  | ٦٨٪
  بشرى العنزي   | عنقود ١١ | ٦٩٪
```
Suggestion chips + answers:
```
"ملخص اليوم" →
١٢٤ من ١٥٠ مدرسة ثبّتت الغياب (٨٣٪). ٤٧ زيارة موثقة، متوسط الانضباط اليومي ٩٤٪. ثلاث مدارس تصنيفها «تهيئة» انخفض انضباطها عن ٨٥٪.

"من لم تحدّث بياناتها؟" →
لم تحدّث اليوم: إيمان العمري (عنقود ١٩)، رغد النفيعي (عنقود ٢٢)، سارة اليامي (عنقود ٢٤). آخر تحديث لهن كان أمس.

"مدارس تصنيف تهيئة" →
٩ مدارس في النطاق تصنيفها «تهيئة»، متوسط نافس فيها انخفاض ٥٪ ومتوسط انضباطها ٨٤٪. ٦ منها ضمن الدعم وفق الاحتياج.

"نواقص التطوير المهني" →
٥ عضوات لم يرفعن تقارير مجتمعات التعلم المهنية، و٣ عضوات بدون روابط درايف لورش العمل.

fallback →
راجعت ملفات ٢٥ عنقوداً: النشاط الأكثر تكراراً هو الزيارات الصفية بنسبة ٦١٪ من إجمالي الزيارات الموثقة.
```
Agent-mode actions and plan:
```
chips: ذكّري المتأخرات · جهّزي التقرير المجمّع · راجعي الملفات الناقصة
plan (dark card "خطة الوكيل"):
  ✓ حدّد ٧ عضوات لم يرسلن حتى ٢:١٠ م
  ✓ جمع نواقص كل عضوة من ملف عنقودها
  ✓ صاغ رسالة تذكير مخصصة لكل واحدة
  … بانتظار موافقتك قبل الإرسال
button: موافقة وإرسال → ✓ أُرسلت ٧ رسائل تذكير
```

## 2.10 Consolidated report seed
```
title: تقرير النطاق — الأربعاء ١٤ شعبان        meta: مجمّع من ١٨ عضوة · ١٥٠ مدرسة
executive summary:
ثبّتت مدارس النطاق الغياب في ١٢٤ مدرسة من أصل ١٥٠ بنسبة ٨٣٪، ونفّذ الفريق ٤٧ زيارة ميدانية موثّقة. بلغ متوسط الانضباط اليومي ٩٤٪ مع انخفاض في ثلاث مدارس بعنقودي ٢ و٧. رُفعت ١٢ ورشة عمل و٨ مجتمعات تعلم مهنية هذا الأسبوع. أبرز المعوقات: تأخر استيراد بيانات نافس لعنقودين، ونقص الموجهات الطلابيات في أربع مدارس.
stats: ١٥٠ مدرسة · ١٢٤ غياب مثبت · ٤٧ زيارة · ٩٤٪ الانضباط · ١٢ ورشة عمل · ٨ مجتمع تعلم
attachments: تقارير الزيارات — درايف · خطط التحسين — درايف · بطاقات نافس — درايف · إكسل الانضباط اليومي · التقرير الخارجي للمدارس
export options: نص جاهز للنسخ · ملف PDF مجمّع · جدول Excel بالمؤشرات
note: ينسخ النص جاهزاً للصق في المنصة مع روابط مجلدات الدرايف.
```

## 2.11 Member profile timeline (head view, seed)
```
اليوم · الأربعاء ١٤ شعبان | <lastAt>   | تثبيت الغياب            | ثبّتت الغياب في N من ٦ مدارس                                           | غياب      | —
اليوم                      | ١٢:٢٠ م   | تقرير زيارة صفية        | ابتدائية الأندلس · ٣ زيارات صفية لمعلمات الرياضيات مع تغذية راجعة وخطة متابعة أسبوعين | زيارة     | ٣ مرفقات
أمس · الثلاثاء ١٣ شعبان    | ٢:١٠ م    | ورشة عمل                | متوسطة النهضة · ورشة التقويم البنائي بحضور ٢٢ معلمة، رضا ٩٢٪            | تطوير مهني | ٤ مرفقات
أمس                       | ١١:٠٥ ص   | تحديث مؤشرات مدرستي     | حدّثت نسب الإسناد والدخول لـ٦ مدارس                                    | مؤشرات    | —
الأحد · ١١ شعبان          | ٩:٣٠ ص    | استمارة تنفيذ الخطة ٢   | رفعت الاستمارة على مجلد الدرايف                                        | خطط       | مرفق واحد
الأحد                     | ٨:٤٠ ص    | متابعة خطة تحسين        | ثانوية الرواد · مراجعة المؤشرات الثلاثة مع قائدة المدرسة — التقرير مختصر ويحتاج أرقام | زيارة | مرفق واحد
```
Dot color: `#009688` when ok, `#f59e0b` when the entry is flagged (incomplete).

Profile attachments tab:
```
تقارير الزيارات — مجلد درايف | مجلد | —       | N ملفاً   | مرفوع
خطة التحسين.pdf              | PDF   | ١٫٤ م.ب | ١٢ صفحة  | مرفوع
تقرير تحليل الواقع.pdf        | PDF   | ٢٫١ م.ب | ١٨ صفحة  | مرفوع
استمارة تنفيذ الخطة ١.docx    | Word  | ٢٤٠ ك.ب | ٤ صفحات  | مرفوع
استمارة تنفيذ الخطة ٢.docx    | Word  | ٢٦٠ ك.ب | ٤ صفحات  | مرفوع
استمارة تنفيذ الخطة ٣.docx    | Word  | —       | —        | ناقص
بطاقات نافس.xlsx              | Excel | ٦٨٠ ك.ب | ٦ أوراق  | مرفوع
تقارير مجتمعات التعلم.pdf     | PDF   | ٣٫٢ م.ب | ٢٦ صفحة  | مرفوع (ناقص if completion ≤ 75)
```
Profile section-completion bars (derived from `completion` c and `absenceDone` a):
```
البيانات الأولية   100
مدارس العنقود      min(100, c+8)
التقويم المدرسي    100
منصة مدرستي        max(40, c-6)
الانضباط المدرسي   max(35, c-12)
المهام             round(a/6 × 100)
التطوير المهني     max(30, c-20)
```

---

# PART 3 — Screens

## 3.1 Login — `/login`

Full-viewport grid `1fr 1fr`. Right column = form on white; left = dark brand panel. Below ~900px: stack, panel collapses.

**Form column** — centered, `max-width 380px`, `gap 26px`, padding `48px 40px`:
1. **Brand lockup** — 36px teal square (r 10px) with "ر" 17px/700 #fff; "رَصد" 16px/600; "منصة متابعة الفريق التنفيذي" 11.5px `#00000080`.
2. **Heading** — h1 `تسجيل الدخول`; sub `ادخلي ببريدك الوزاري — يتم توجيهك للوحة المناسبة لدورك تلقائياً.` 13.5px/23px.
3. **Fields** — `البريد الوزاري` (ltr, placeholder `name@moe.gov.sa`) · `كلمة المرور` (password, h 44px).
4. **Row** — checkbox `تذكّرني على هذا الجهاز` (accent `#009688`) / link `نسيت كلمة المرور؟`.
5. **Primary** `دخول` h 46px full width.
6. **Error** (conditional, `rsFade` 200ms) — `تأكدي من البريد الوزاري — أو اختاري حساباً من القائمة أدناه.` 12px `#dc2626`.
7. **Demo accounts** — divider `1px solid #00000012`; label `حسابات العرض التجريبي` 11.5px/600; two full-width cards (34px avatar + name 13px/600 + role 11px + `‹`), r 11px. Click = instant login.
8. **Legal** — `الدخول يعني موافقتك على سياسة استخدام بيانات المدارس والالتزام بسريتها.` 11px/18px `#00000073`.

**Brand panel** — bg `#001d1a`, padding `52px 46px`, `justify-content:space-between`, overlay `radial-gradient(120% 90% at 100% 0%, #00968833 0%, transparent 60%)`:
- Eyebrow `إدارة التعليم · النطاق الإشرافي` 11px/600 `#80d5cb`, `letter-spacing:.14em`.
- Headline `ملف واحد لكل عنقود، ولوحة واحدة تجمع النطاق كامل.` 32px/48px #fff, `max-width 420px`.
- 2×2 stats (`#ffffff0f`, border `#ffffff1a`, r 14px): **٢٥** عضوة فريق تنفيذي · **١٥٠** مدرسة في النطاق · **٧** أقسام في ملف العنقود · **يومي** تحديث المؤشرات.
- Quote `«صار عندي صورة كاملة عن كل عنقود بدون ما أجمع التقارير يدوياً.»` 13.5px/26px `#ffffffcc`; attribution `سارة القحطاني · رئيسة النطاق` 11.5px `#ffffff80`.

**Behavior:** match email against the directory → route by role (`/cluster` for member, `/district` for head). Unknown → inline error, keep focus. Demo cards bypass password. Production: ministry SSO, keep role-based redirect.

## 3.2 App shell (both roles)

**Header** — sticky, `z 40`, h ≈ 59px, padding `11px 24px`, bg `#ffffffe8` + `backdrop-filter:blur(14px)`, bottom border `#00000014`.
- **Right:** 29px logo tile + `رَصد` + **role pill** (`عضو الفريق التنفيذي` teal tint / `رئيسة النطاق` `#0039350f` on `#003935`).
- **Center:** global search, `max-width 420px`, h 36px, bg `#f2f4f4`, r 10px, glyph `⌕`, placeholder `ابحثي عن مدرسة، عضوة، أو مؤشر…`. Searches schools, members, indicators, and report content.
- **Left:** (member only) toggle `عرض الجوال الميداني` ⇄ `العودة للوحة`; bell 36px square with red count badge (`#dc2626`, 15px circle, `top:5px; inset-inline-start:6px`); avatar+name menu.

**Notifications dropdown** — 320px, r 13px, shadow, `rsDrop`. Header `التنبيهات` 12.5px/600. Rows: 7px dot (`#f59e0b` attention / `#067647` info) + text 12.5px/20px + time 10.5px `#00000073`.
```
head:    ٣ عضوات لم يحدّثن بياناتهن اليوم        قبل ١٢ دقيقة   attention
         عنقود ٢ انخفض انضباطه إلى ٦٤٪           قبل ساعة       attention
         وصل ملف عنقود ٤ محدّثاً من هند الشمري   قبل ٣ ساعات    info
member:  لم تُثبّت الغياب في مدرستين اليوم        قبل ٢٠ دقيقة   attention
         باقي رفع استمارة تنفيذ الخطة ٣           أمس            attention
         تم استيراد تصنيف نافس لمدارسك            أمس            info
```

**Profile menu** — 230px, r 13px, `rsDrop`: name + email header; `الملف الشخصي`; `الإعدادات والصلاحيات`; divider; `تسجيل الخروج` (`#dc2626`, 600).

Only one dropdown open at a time; outside click / `Esc` closes.

**Body grid** — `240–250px | minmax(0,1fr)`, `align-items:start`, min-height `calc(100vh - 59px)`. Sidebar sticky full-height (see §1.9). Main `padding:24px 28px 46px; min-width:0; overflow-x:hidden`.

## 3.3 Member workspace — `/cluster`

### Sidebar
1. **Completion card** — `#f7f8f8`, r 12px: `اكتمال ملف العنقود` + `٧٨٪` (15px/700 teal) + 6px bar.
2. **Label-edit toggle** — `تعديل مسميات الحقول` ⇄ `✓ إنهاء تعديل المسميات`. Turns dashed rename inputs on/off. **Add/delete buttons are always visible regardless of this toggle.**
3. **Nav** (8 items):
   | key | label | badge |
   |---|---|---|
   | `profile` | البيانات الأولية | مكتمل |
   | `schools` | مدارس العنقود | ٦ |
   | `eval` | التقويم المدرسي | — |
   | `madrasati` | منصة مدرستي | — |
   | `discipline` | الانضباط المدرسي | — |
   | `tasks` | المهام | pending absence count |
   | `pd` | التطوير المهني | — |
   | `ingest` | الاستيراد الذكي | جديد |

   Plus any **custom sections** the member added (each with a `×` delete). Built-in sections are never hideable.
4. **Add section** — dashed `+ إضافة قسم جديد`.
5. **Gap card** (bottom) — `#fff7ed`: `ناقص عندك` + dynamic `تثبيت الغياب لـN مدارس · رابط استمارة التنفيذ ٣`.
6. **Primary CTA** — `إرسال التحديث لرئيسة النطاق` → `✓ أُرسل لرئيسة النطاق`.

### Section 1 — البيانات الأولية (`القسم الأول`)
Header + secondary `حفظ التعديلات` → `✓ حُفظت التعديلات` (teal tint, resets after ~3s).
One card, `max-width 1080px`, grid `repeat(auto-fit, minmax(220px,1fr))`, gap 16px. **Every field is a live input; each has a `×` delete and (in label-edit mode) a dashed rename input. Dashed `+ إضافة حقل` below the grid.**

| id | label | default | span | control |
|---|---|---|---|---|
| p1 | الاسم الرباعي | هند سعد عبدالله الشمري | 2 | text |
| p2 | السجل المدني | ١٠٤٥٢٢٨٩٣٧ | 1 | text |
| p3 | الرقم الوظيفي | ٤٤٢٧٩٠ | 1 | text |
| p4 | البريد الوزاري | h.alshammari@moe.gov.sa | 2 | text, `dir=ltr` |
| p5 | رقم الجوال | ٠٥٥٤٢٣٨٨١٠ | 1 | text |
| p6 | الرتبة | خبير | 1 | **select**: خبير / متقدم / ممارس / ممارس متقدم |
| p7 | المؤهل | ماجستير إدارة تربوية | 1 | text |
| p8 | التخصص | رياضيات | 1 | text |
| p9 | التخصص الإشرافي | إشراف رياضيات | 1 | text |
| p10 | تاريخ التعيين | ١٤٣٢/٠٧/١٥ | 1 | text (Hijri) |
| p11 | تاريخ التكليف بالإشراف | ١٤٤١/٠١/٠٣ | 1 | text (Hijri) |
| p12 | عدد سنوات الخبرة | ١٤ | 1 | **read-only derived tile** on `#f7f8f8`, hint `تُحسب تلقائياً` |

New fields default to label `حقل جديد`, empty value, span 1, plain text.

### Section 2 — بيانات مدارس العنقود (`القسم الثاني · عنقود ٤`)
Header + summary pills `٦ مدارس` `٣٬٢٤٠ طالبة` `٢٤٨ معلمة`.
Two columns `minmax(220px,270px) | minmax(0,1fr)`.

**School list** (sticky, `top:80px`): rows = name 13px/600 + tier pill + `×` delete + meta `<stage> · <students> طالبة`. Selected: bg `#f0faf8`, `border-inline-end:3px solid #009688`. Footer button `+ إضافة مدرسة` (bg `#f0faf8`, top border) — appends a school named `مدرسة جديدة`, selects it, seeds one leadership role (مديرة المدرسة) and two staff tiles.

**Customize panel** (dashed card, shown in label-edit mode) — `تخصيص حقول المدرسة` + hint `اضغطي على الحقل لإخفائه من الملف إذا ما كان ينطبق على مدارسك، أو أضيفي حقلاً خاصاً بنطاقك.` Toggle chips `<label> · ظاهر|مخفي` for the 10 base info fields; rows of extra custom fields (label + value + `×`); `+ إضافة حقل للمدرسة`.

**School card** — editable name (view span ⇄ dashed input in label-edit mode) + meta `رقم العنقود ٤ · <stage> · <area> · الرقم الوزاري <no>` + tier pill. Info grid `repeat(auto-fit, minmax(160px,1fr))`, **every value an input**:
```
البريد الوزاري · نوع التعليم (حضوري|مدمج) · برامج التربية الخاصة · الحارس (يوجد|لا يوجد)
عدد الفصول · عدد الطالبات · فصول موهبة · عدد فصول الموهبة · طالبات الموهبة · تطبيق اللغة الصينية (نعم|لا)
```
Hidden fields are filtered out; custom fields appended. Dashed `+ إضافة حقل لهذه المدرسة`.

**Staff card** — `الهيئة التعليمية والإدارية`. Tiles `repeat(auto-fit, minmax(130px,1fr))` on `#f7f8f8`, r 11px; value = borderless 20px/600 input; label = view span ⇄ dashed rename input; absolute `×` at `top:6px; inset-inline-start:6px`. Dashed `+ إضافة مؤشر`. Defaults:
```
الهيئة التعليمية <teachingStaff> · الهيئة الإدارية <adminStaff> · وكيلات المدرسة <deputies>
المعلمات <teachingStaff−4> · رتبة خبير <expert> · رتبة متقدم <advanced>
```
> Teaching staff = معلمات + موجهة طلابي + رائدة نشاط + موجهة صحية + محضرة مختبر + محضرة حاسب + أمينة مصادر. Expose the breakdown on expand.

**Leadership card** — `القيادة المدرسية`. One row per role, grid `minmax(130px,190px) | minmax(0,1fr)`, `align-items:start`, r 12px, border `#00000012`.
- Left block: role (view ⇄ dashed rename input) + state (pill ⇄ text input) + buttons `+ حقل` (teal) and `حذف الدور` (red).
- Right block: field grid `repeat(auto-fit, minmax(120px,1fr))`; each field = label (view ⇄ dashed rename) + `×` + value input. `البريد الوزاري` renders `dir=ltr; text-align:left`.
- Dashed `+ إضافة دور قيادي` under the list. New role: `دور جديد` / state `مكلفة` / fields `الاسم`, `الجوال`.

Default roles & fields:
```
مديرة المدرسة              state=<rank>   الاسم، السجل المدني، الجوال، البريد الوزاري
وكيلة الشؤون التعليمية      state=<rank>   الاسم، الرتبة، السجل المدني، الجوال
وكيلة الشؤون الطلابية       state=<rank>   الاسم، الرتبة، السجل المدني، الجوال
وكيلة الشؤون المدرسية       state=<rank>   الاسم، الرتبة، السجل المدني، الجوال
الموجهة الطلابية            مفرغة|مكلفة|لا يوجد   الاسم، الجوال
رائدة النشاط                مفرغة|مكلفة|لا يوجد   الاسم، الجوال
```
State pill: red (`#dc262614`/`#dc2626`) when `لا يوجد`, otherwise teal.

### Section 3 — مؤشرات التقويم المدرسي (`القسم الثالث`)
Header + import badge `مستورد من لوحة رئيسة النطاق` / `آخر تحديث ٠٢/٠٤` (teal tint card).
**Table** (min-width 840px) `1.4fr 1fr 1fr .9fr .9fr .9fr`:
`المدرسة` · `التصنيف` (tier pill) · `نوع الدعم` (الدعم وفق الاحتياج | الدعم عند الطلب) · `نافس` (green when `ارتفاع…`, red when `انخفاض…`) · `القدرات` · `التحصيلي`. **Read-only** — imported.
Two cards:
- `التقرير الخارجي — المجالات والمعايير` + `أرفقي صورة التقرير الخارجي لكل مدرسة عبر رابط درايف.` + per-school rows with مرفوع/ناقص pills (first 2 مرفوع, 3rd ناقص in seed).
- `بطاقة نافس` + `رابط مجلد بطاقات نافس لمدارس العنقود.` + URL input `drive.google.com/drive/folders/nafes-c4` (ltr) + `تحديث الرابط`.

### Section 4 — مؤشرات منصة مدرستي (`القسم الرابع`)
- **Six average cards** `minmax(170px,1fr)`: label block `min-height:34px`, value 24px/600 color-scaled, 6px bar.
- **Per-school table** (min-width 820px) `1.5fr repeat(6,1fr)` — the six metrics, each cell 600-weight + color-scaled.

### Section 5 — مؤشرات الانضباط المدرسي (`القسم الخامس`)
- **Table** (min-width 760px) `1.5fr 1fr 1fr 1fr 1fr`: `المدرسة` · `التصنيف` · `يومي` (color-scaled) · `أسبوعي` · `شهري`.
- `خطة الانضباط للمدارس` — per-school معتمدة/لم تُرفع (first 2 معتمدة).
- `خطة دعم الانضباط — عضو الفريق` — textarea, default `زيارتان أسبوعياً لمدرستي التصنيف المنخفض، وتفعيل برنامج «حضوري أمانة» مع الموجهات الطلابيات.` + plan-file row `ملف الخطة` / `مرفوع`.

### Section 6 — مهام عضو الفريق التنفيذي (`القسم السادس`)
Header + `اليوم · الأربعاء ١٤ شعبان`.
- **تثبيت الغياب اليومي** — header `N من ٦ مثبتة` + 110px bar (fill `#067647` at 6/6, else `#009688`). Cards `minmax(230px,1fr)` per school with a toggle pill `تم` ⇄ `لم يتم`. Not-done card: bg `#fef2f2`, border `#dc262626`. Optimistic flip; writes an audited event.
- **تقارير الزيارات** — teal pill `N زيارة`; note `يُحتسب عدد الزيارات آلياً من عدد التقارير المرفوعة في مجلد الدرايف.`; per-school bars (label 130px / bar / count, scale /12); button `رفع تقرير زيارة من الجوال` → opens the field view.
- **الخطط** — 5 rows (name + hint + مرفوع/ناقص pill) per §2.7.

### Section 7 — التطوير المهني (`القسم السابع`)
Four cards `minmax(230px,1fr)`: name 14px/600 + count 26px/700 teal; `#f7f8f8` row `تقارير الدرايف` + مرفوعة/ناقصة pill; button `إضافة برنامج` (increments the count / opens an add form with a drive link).

### Section 8 — الاستيراد الذكي للملفات (`القسم الثامن`)
Intro: `ارفعي ملفاتك كما هي — إكسل، PDF، وورد، صور، أو تسجيل صوتي — ويقرأها المساعد، يحوّل الصور والمسح الضوئي إلى نص، ويعبّي حقول ملف العنقود بدل الإدخال اليدوي.`
1. **Dropzone** — `↑` tile, `اسحبي الملفات هنا أو اختاري من جهازك`, hint `PDF · Word · Excel · صور · تسجيل صوتي — حتى ٢٠ ملفاً دفعة واحدة`, button `اختيار الملفات`.
2. **Grid** `repeat(auto-fit, minmax(320px,1fr))`:
   - **الملفات المرفوعة** — per file: 38px kind tile, name 12.5px/600, `<size> · <N> حقل مستخرج`, state pill (`تم الاستخراج` green / `يحتاج مراجعة` amber / `جاري التحليل…` teal), 4px progress (46% while processing, 100% @25% opacity when done).
   - **ما الذي فعله المساعد** — dark `#001d1a` card with the 4 agent steps (§2.8) and the source footnote.
3. **الحقول المستخرجة — مراجعة قبل الاعتماد** — meta `٣٧ حقلاً · ٥ تحتاج تأكيدك`; table (min-width 720px) `1.6fr 1fr .8fr 1.2fr`: `الحقل` · `القيمة المستخرجة` · `الثقة` (عالية green / متوسطة amber pill) · `المصدر`. Footer: primary `تطبيق ٣٧ حقلاً على ملف العنقود` → `✓ طُبّق ٣٧ حقلاً على ملف العنقود`; secondary `تعديل يدوي قبل الاعتماد`.

### Custom section page
Editable title (dashed input, default `قسم جديد`) under eyebrow `قسم مخصّص`. Card `حقول القسم`: rows of label input + value input + `×`; dashed `+ إضافة حقل`; footnote `الأقسام والحقول المخصّصة تظهر لرئيسة النطاق في ملف عنقودك، ويشملها التقرير المجمّع.`

## 3.4 Mobile field view — `/field`
Shown in an iPhone frame in the reference (393×852). Ship as the responsive mobile layout or a PWA.
- **Top bar** (white): `عنقود ٤ · الأربعاء ١٤ شعبان` 11.5px + `مهام اليوم` 16.5px/600; 36px avatar tile (r 12px).
- **Card 1 — تثبيت الغياب:** header + `N من ٦ مثبتة`; compact row per school with the تم/لم يتم toggle pill.
- **Card 2 — تقرير زيارة سريع:** school `select` (h 42px) → activity chips `زيارة صفية · زيارة إشرافية · متابعة خطة · ورشة عمل` → textarea `وصف مختصر للزيارة وأبرز الملاحظات…` → 3-col attachment grid (teal tiles labeled صورة/PDF + dashed `+`; camera + file picker) → primary `رفع التقرير` → `✓ رُفع التقرير`.
- **Card 3 — dark alert** (`#001d1a`): eyebrow `تنبيه رئيسة النطاق` + `باقي رفع استمارة تنفيذ الخطة ٣ قبل نهاية الأسبوع.`

Attachments: images + PDF/Word, client-compressed. **Uploads must queue and retry offline** — field connectivity is unreliable.

## 3.5 District-head workspace — `/district`

**Sidebar** — nav: `نظرة النطاق` · `أعضاء الفريق` `٢٥` · `متابعة الإرسال` `٧` · `مساعد الذكاء الاصطناعي` · `التقرير المجمّع`. Bottom dark card (`#001d1a`): eyebrow `ملخص الذكاء الاصطناعي` + `١٨ من ٢٥ عضوة حدّثن اليوم. تثبيت الغياب مكتمل في ١٢٤ من ١٥٠ مدرسة. ٣ عناقيد انضباطها تحت ٩٠٪.` + button `افتحي المحادثة`.

### View A — نظرة النطاق
- Header: Hijri-date eyebrow, h1 `نظرة النطاق`, buttons `التقرير المجمّع` (secondary) + `متابعة الإرسال` (primary).
- **4 KPI cards** `minmax(190px,1fr)` per §2.4 (delta green when good, amber when not).
- **Bar chart** `تثبيت الغياب خلال الأسبوع` / `من ١٥٠ مدرسة` — 5 bars, height `v/150 × 128px` (min 4px), r `8px 8px 3px 3px`, `max-width 54px`. Current day `#009688`, others `#a2e0d8`, zero `#e6e9e9` + label `—`.
- **تصنيف مدارس النطاق** — 4 labeled bars in tier colors.
- **أداء العناقيد** table (min-width 760px) `1.3fr .8fr 1fr 1fr 1fr .9fr`: `عضوة الفريق` (avatar+name) · `العنقود` · `تثبيت الغياب` (`N / ٦`) · `الانضباط` (color-scaled) · `الزيارات` · `الحالة` (محدّثة green / متأخرة amber). **Row click → member profile.** Header link `عرض الكل` → أعضاء الفريق.

### View B — متابعة الإرسال
- Header + primary `إرسال تذكير للباقيات` → `✓ أُرسل التذكير لـ٧ عضوات`.
- Three count cards: `حدّثن اليوم` ١٨ (green) · `متأخرات` ٤ (amber) · `لم يحدّثن` ٣ (red).
- **Member grid** `auto-fill, minmax(185px,1fr)` — 25 clickable cards: status-colored 30px avatar + name + `<status> · عنقود N`. `لم تحدّث` card bg `#fef2f2`. Legend with three dots above.

### View C — أعضاء الفريق
Eyebrow `٢٥ عضوة · ١٥٠ مدرسة`, h1 `ملفات أعضاء الفريق التنفيذي`.
Filter chips `الكل · ملف مكتمل · ملف ناقص · انضباط منخفض` + card grid `minmax(250px,1fr)`: 34px avatar + name + `عنقود N · M مدارس` + completion row with color-scaled bar. **Card click → member profile.**

### View D — ملف العضوة (member profile)
Reached from any member card/row. Back button `رجوع لأعضاء الفريق`.
- **Header card:** 54px avatar; name 21px/600 + status pill (حدّثت/متأخرة/لم تحدّث); meta `عنقود N · M مدارس · <rank> · <major>`; `آخر تحديث: <lastAt>`; actions `طلب توضيح` (secondary) + `إرسال تذكير` (primary).
- **4 KPI tiles** on `#f7f8f8`: `اكتمال الملف` · `تثبيت الغياب اليوم` (`N / ٦`) · `الزيارات هذا الأسبوع` · `متوسط الانضباط`. Value amber when below threshold (completion <80, absence <6, visits <7, discipline <85).
- **Completion bar** — `اكتمال ملف العنقود` + %.
- **Contact block** — `بيانات التواصل` + toggle `تعديل بيانات التواصل` ⇄ `حفظ بيانات التواصل`. Read view: two labeled values. Edit view: two inputs (email `dir=ltr`). Values are the member's real email/phone from §2.2 and are editable.
- **Tabs** (chips): `سجل التسليم` · `أقسام الملف` · `المرفقات والروابط` · `مدارس العنقود`.
  - **سجل التسليم** — `وش سلّمت ومتى`; rows grid `150px 1fr`: left = day 12px/600 + time 11px; right = 9px status dot + title 13.5px/600 + kind pill + attachment count + body 12.5px/21px. Seed in §2.11.
  - **أقسام الملف** — `اكتمال أقسام الملف السبعة`, 7 labeled bars (§2.11 formulas).
  - **المرفقات والروابط** — header + `تنزيل الكل (ZIP)`; per row: 36px kind tile, name, meta, مرفوع/ناقص pill, buttons `عرض` + `تنزيل` → `✓ نُزّل`. Missing files: buttons disabled (`#00000047`, `cursor:not-allowed`). **Preview panel** (`rsFade`) below: header `<name>` + `<kind> · <size> · <pages> · <meta>` + `تنزيل الملف` → `✓ نُزّل الملف` + `إغلاق`; body on `#f7f8f8` with a `max-width:520px; aspect-ratio:1/1.3` white page placeholder (`معاينة <kind>` + `<pages>`) and note `المعاينة تُقرأ من مجلد الدرايف مباشرة دون تنزيل.`
  - **مدارس العنقود** — table (min-width 700px) `1.6fr 1fr 1fr .8fr .8fr`: `المدرسة` · `التصنيف` · `تثبيت الغياب` (تم/لم يتم pill — first `absenceDone` schools are تم) · `الزيارات` · `الانضباط`.

### View E — مساعد الذكاء الاصطناعي
`max-width 880px`, column, height `calc(100vh - 105px)`.
- Header: eyebrow `مساعد رَصد`, h1 `اسألي عن أي رقم أو مؤشر في النطاق`.
- **Agent-mode bar** (teal tint, border `#00968826`): `وضع الوكيل — ينفّذ إجراءات بعد موافقتك:` + chips `ذكّري المتأخرات` · `جهّزي التقرير المجمّع` · `راجعي الملفات الناقصة`.
- **Message list** (auto-scrolls to bottom on new message / view entry): user bubble teal #fff r `16px 16px 4px 16px` max-w 78%; assistant bubble white+border r `16px 16px 16px 4px` max-w 86% lh 26px.
- **Structured result card** when the answer is tabular (§2.9) — white card, header row, `rsFade`.
- **Agent plan card** (dark, `rsFade`) — eyebrow `خطة الوكيل`, 4 steps with ✓/… badges, button `موافقة وإرسال` → `✓ أُرسلت ٧ رسائل تذكير`. **Nothing executes without this approval.**
- Suggestion chips (§2.9) + composer (input placeholder `مثال: كم مدرسة تصنيفها تهيئة وما نسبة انضباطها؟` + `إرسال`).

**Required AI capabilities:** who submitted / who hasn't and when · daily & weekly content summaries · numeric extraction and aggregation · semantic search inside report text and attachments · flag thin/incomplete reports · draft reminder messages · execute approved actions (send reminders, assemble the report, list gaps).

### View F — التقرير المجمّع
Two columns `minmax(0,1fr) | minmax(240px,290px)`.
- **Document card:** title + meta; `الملخص التنفيذي` (AI paragraph 14px/28px); `الأرقام المستخرجة` (6 tiles `minmax(120px,1fr)`); `المرفقات والروابط` (chips). Content per §2.10.
- **Sticky side card** (`top:82px`): `خيارات التصدير` — 3 exclusive options + primary `تجهيز ونسخ` → `✓ تم النسخ` + note.

---

# PART 4 — Interactions

| Trigger | Result |
|---|---|
| Login submit | Match email → route by role. No match → inline error, keep focus |
| Demo account card | Instant login as that role |
| Bell / avatar | Open one dropdown, close the other; outside click / `Esc` closes |
| Sidebar nav | Switch section, scroll main to top, update URL (deep-linkable) |
| School list row | Select school; detail stack swaps; selection persists per session |
| `+ إضافة مدرسة` | Append `مدرسة جديدة`, select it, seed 1 leadership role + 2 staff tiles |
| School `×` | Confirm → delete school + its leaders/staff; clamp `schoolId` |
| Any value input | Debounced autosave (500ms) → PATCH; optimistic UI |
| Label rename input | Same, patches the field's `label` |
| Field `×` | Remove field (custom) or hide it (base school field) |
| `+ إضافة حقل` | Append `{label:"حقل جديد", value:""}` |
| `+ إضافة دور قيادي` | Append role `دور جديد` / `مكلفة` with الاسم + الجوال |
| `حذف الدور` | Confirm → remove the leadership row |
| `+ إضافة مؤشر` | Append staff tile `مؤشر جديد` / `٠` |
| `+ إضافة قسم جديد` | Create custom section, navigate to it |
| Custom section `×` | Confirm → delete section + its fields; fall back to `profile` |
| Absence toggle | Optimistic flip; timestamped audited event; updates section badge, gap card, head KPIs live |
| `حفظ التعديلات` | Save → `✓ حُفظت التعديلات` ~3s |
| `إرسال التحديث لرئيسة النطاق` | Submit snapshot → success label; head notification; member row flips to محدّثة |
| Dropzone / `اختيار الملفات` | Upload, enqueue ingest job, stream per-file status |
| `تطبيق ٣٧ حقلاً…` | Write confirmed extractions into the cluster file (audited, source-linked) |
| `عرض` (attachment) | Open the preview panel for that file |
| `تنزيل` / `تنزيل الملف` | Download; label → `✓ نُزّل` |
| `تنزيل الكل (ZIP)` | Server zips the cluster's drive folder |
| `إرسال تذكير للباقيات` | Send to pending members; label confirms the count |
| Member card / cluster row | Open member profile |
| `رجوع لأعضاء الفريق` | Clear `profileId`, return to the list |
| Profile tab chip | Switch tab (no refetch if cached) |
| `تعديل بيانات التواصل` | Toggle read ⇄ edit; save on toggle-off |
| AI suggestion chip / `إرسال` | Append user message, stream answer, render result card when tabular, autoscroll |
| Agent chip | Render the plan card; **nothing runs until** `موافقة وإرسال` |
| `تجهيز ونسخ` | Generate the selected format; copy/download; label confirms |
| `عرض الجوال الميداني` | Switch to field layout; button label flips |

## 4.1 States to implement (not all drawn)
- Skeletons for tables, KPI cards, profile timeline.
- Empty states: no schools yet · no reports today · AI with no data · no attachments · no custom sections.
- Inline validation: national ID 10 digits starting 1/2 · phone `05XXXXXXXX` · email must end `@moe.gov.sa` · percentages 0–100 · required fields before submit.
- Upload failure with retry; offline banner on mobile; queued-upload indicator.
- Permission-denied view; session-expired modal.
- Confirm dialogs on every destructive delete.
- Conflict handling when two devices edit the same field (last-write-wins + a "تم تحديثه من جهاز آخر" toast).

---

# PART 5 — Data model

## 5.1 Entities

```ts
User {
  id, name, shortName, email /*unique, @moe.gov.sa*/, phone, role: "member"|"head",
  initials, rank: "خبير"|"متقدم"|"ممارس متقدم"|"ممارس",
  nationalId /*PII*/, employeeNo, qualification, major, supervisoryMajor,
  hireDateHijri, supervisionStartHijri,
  yearsOfExperience /*DERIVED from hireDate*/,
  clusterId?, districtId, createdAt, updatedAt
}

Cluster { id, number, districtId, memberId, name, completionPct /*DERIVED*/, createdAt }

School {
  id, clusterId, name, stage: "ابتدائية"|"متوسطة"|"ثانوية", area, ministryNo /*unique*/, ministryEmail,
  educationType: "حضوري"|"مدمج"|"عن بعد",
  specialEdProgram /*text, "لا يوجد" or "يوجد — <type>"*/,
  hasGuard: bool, classes: int, students: int,
  hasGifted: bool, giftedClasses: int, giftedStudents: int, teachesChinese: bool,
  isCustom: bool, sortOrder, createdAt, updatedAt
}

SchoolStaffTile { id, schoolId, label, value, sortOrder, isCustom }

SchoolFieldOverride { id, clusterId, fieldKey, hidden: bool }      // hides a base info field
SchoolCustomField   { id, schoolId, label, value, sortOrder }

LeadershipRole {
  id, schoolId, role /*editable label*/, state /*rank or مفرغة|مكلفة|لا يوجد*/,
  isCustom: bool, sortOrder
}
LeadershipField { id, roleId, label, value, sortOrder }            // الاسم، السجل المدني /*PII*/، الجوال /*PII*/، البريد الوزاري، الرتبة…

EvaluationIndicators {                                             // IMPORTED, read-only for members
  id, schoolId, tier: "تميز"|"تقدم"|"انطلاق"|"تهيئة",
  supportType: "الدعم وفق الاحتياج"|"الدعم عند الطلب",
  nafesDelta /*e.g. "ارتفاع ٦٪"*/, nafesDirection: "up"|"down", nafesValue: int,
  qudrat: int, tahsili: int,
  externalReportUrl, externalReportStatus: "uploaded"|"missing",
  nafesCardFolderUrl, importedAt, importedBy
}

MadrasatiIndicators {
  id, schoolId, scheduleAssignment, courseAssignment, studentAssignment,
  teacherLogin, studentLogin, completion,                          // all int 0–100
  syncedAt, source: "sync"|"upload"
}

DisciplineIndicators {
  id, schoolId, daily, weekly, monthly,                            // int 0–100
  planStatus: "approved"|"missing", planUrl, importedAt
}
DisciplineSupportPlan { id, clusterId, text, fileUrl, updatedAt }

AbsenceConfirmation { id, schoolId, date /*unique per school+date*/, done: bool, confirmedAt, confirmedBy }

VisitReport {
  id, schoolId, clusterId, memberId,
  type: "زيارة صفية"|"زيارة إشرافية"|"متابعة خطة"|"ورشة عمل"|<custom>,
  text, beneficiaries?: int, sessions?: int, blockers?: text,
  attachments: Attachment[], driveFileIds: string[],
  createdAt, syncedAt, flagged: bool, flagReason?
}
// cluster visitCount = COUNT(VisitReport) — never stored as an editable number

Plan {
  id, clusterId,
  kind: "realityAnalysis"|"improvement"|"execution1"|"execution2"|"execution3"|<custom>,
  label, hint, url, status: "uploaded"|"missing", uploadedAtHijri
}

PDProgram { id, clusterId, kind: "plc"|"workshop"|"appliedLesson"|"other", label, count, reportsUrl, status }

CustomSection { id, clusterId, label, sortOrder, createdAt }
CustomSectionField { id, sectionId, label, value, sortOrder }

ProfileField { id, userId, label, value, span: 1|2, fieldType: "text"|"select"|"derived",
               options?: string[], hint?, isCustom: bool, sortOrder }

Attachment { id, ownerType, ownerId, name, kind: "PDF"|"Word"|"Excel"|"صورة"|"صوت"|"مجلد",
             sizeBytes, pages?, driveFileId, mimeType, uploadedAt, uploadedBy }

IngestJob {
  id, clusterId, memberId, attachmentId,
  status: "queued"|"processing"|"done"|"review"|"failed",
  progressPct, transcript /*text*/, tablesJson, error?, startedAt, finishedAt
}
ExtractedField {
  id, ingestJobId, targetEntity, targetId?, targetFieldKey,
  label /*display, e.g. "نتيجة نافس — ابتدائية الأندلس"*/, value,
  confidence: "high"|"medium"|"low", sourceRef /*"تقرير نافس.pdf · ص ٢"*/,
  status: "pending"|"applied"|"rejected"|"edited", appliedAt, appliedBy
}

DailySubmission { id, memberId, date, status: "submitted"|"late"|"missing", submittedAt, snapshotId }
Notification { id, userId, kind, text, level: "info"|"attention", read: bool, createdAt }
Reminder { id, fromUserId, toUserId, channel: "app"|"sms"|"email", body, sentAt, agentRunId? }

AgentRun {
  id, userId, action: "remind"|"report"|"gaps",
  plan: {step, ok}[], status: "proposed"|"approved"|"executed"|"rejected",
  resultSummary, proposedAt, approvedAt
}
ChatMessage { id, userId, role: "user"|"assistant", text, citations: {entity,id,date}[],
              resultTable?: json, createdAt }

ConsolidatedReport {
  id, districtId, date, summaryText, stats: {label,value}[],
  attachmentRefs: string[], memberCount, schoolCount,
  format: "text"|"pdf"|"excel", generatedAt, generatedBy
}

AuditLog { id, actorId, action, entity, entityId, before, after, ip, at }
```

## 5.2 Derived values — never stored as editable
| Value | Formula |
|---|---|
| `yearsOfExperience` | now − `hireDateHijri` |
| `cluster.visitCount` | `COUNT(VisitReport WHERE clusterId)` |
| `cluster.completionPct` | weighted fill-rate across the 8 sections |
| `madrasatiAverage[i]` | `round(mean(schools[].madrasati[i]))` |
| `absenceDoneToday` | `COUNT(AbsenceConfirmation WHERE date=today AND done)` |
| District KPIs | aggregates over clusters/schools |
| Percentage colors | the §1.3 scale |
| `DailySubmission.status` | `submitted` if before deadline · `late` if after · `missing` if none |

## 5.3 Postgres sketch
```sql
create type user_role   as enum ('member','head');
create type school_tier as enum ('تميز','تقدم','انطلاق','تهيئة');
create type ingest_status as enum ('queued','processing','done','review','failed');
create type confidence  as enum ('high','medium','low');

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null, short_name text, email citext unique not null,
  phone text, role user_role not null, initials text,
  rank text, national_id text, employee_no text,
  qualification text, major text, supervisory_major text,
  hire_date date, supervision_start date,
  cluster_id uuid, district_id uuid not null,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table schools (
  id uuid primary key default gen_random_uuid(),
  cluster_id uuid not null references clusters(id) on delete cascade,
  name text not null, stage text, area text,
  ministry_no text unique, ministry_email citext,
  education_type text, special_ed_program text,
  has_guard boolean, classes int, students int,
  has_gifted boolean, gifted_classes int default 0, gifted_students int default 0,
  teaches_chinese boolean, is_custom boolean default false, sort_order int,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table absence_confirmations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  date date not null, done boolean not null default false,
  confirmed_at timestamptz, confirmed_by uuid references users(id),
  unique (school_id, date)
);
create index on absence_confirmations (date);

create table visit_reports (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  cluster_id uuid not null, member_id uuid not null references users(id),
  type text not null, text text,
  beneficiaries int, sessions int, blockers text,
  drive_file_ids text[], flagged boolean default false, flag_reason text,
  created_at timestamptz default now()
);
create index on visit_reports (cluster_id, created_at desc);

create table extracted_fields (
  id uuid primary key default gen_random_uuid(),
  ingest_job_id uuid not null references ingest_jobs(id) on delete cascade,
  target_entity text, target_id uuid, target_field_key text,
  label text not null, value text,
  confidence confidence not null, source_ref text not null,
  status text default 'pending', applied_at timestamptz, applied_by uuid
);

create table audit_log (
  id bigserial primary key,
  actor_id uuid references users(id), action text not null,
  entity text not null, entity_id uuid,
  before jsonb, after jsonb, ip inet, at timestamptz default now()
);
create index on audit_log (entity, entity_id, at desc);
```
Row-level security: members see only rows whose `cluster_id` matches their cluster; head sees the whole `district_id`. Every read of `national_id` / `phone` writes an `audit_log` row.

---

# PART 6 — API

Base `/api/v1`. Auth: bearer JWT (`sub`, `role`, `clusterId`, `districtId`). All responses `{ data, meta? }`; errors `{ error: { code, message, fields? } }` with Arabic `message`.

## 6.1 Auth
```
POST   /auth/login              { email, password, remember }  → { token, user }
POST   /auth/logout
GET    /auth/me                                                → { user, permissions[] }
POST   /auth/forgot-password    { email }
```

## 6.2 Member — cluster file
```
GET    /cluster/me                      → cluster + completion + section summaries
GET    /cluster/me/profile-fields       → ProfileField[]
POST   /cluster/me/profile-fields       { label, value, span }
PATCH  /cluster/me/profile-fields/:id   { label?, value? }
DELETE /cluster/me/profile-fields/:id

GET    /cluster/me/schools              → School[] (+ staffTiles, leadership, customFields)
POST   /cluster/me/schools              { name }                 → seeds 1 role + 2 tiles
PATCH  /cluster/me/schools/:id          { any School field }
DELETE /cluster/me/schools/:id

GET    /schools/:id/field-overrides
PUT    /schools/:id/field-overrides     { hidden: string[] }     // cluster-wide
POST   /schools/:id/custom-fields       { label, value }
PATCH  /schools/:id/custom-fields/:fid  { label?, value? }
DELETE /schools/:id/custom-fields/:fid

POST   /schools/:id/staff-tiles         { label, value }
PATCH  /schools/:id/staff-tiles/:tid    { label?, value? }
DELETE /schools/:id/staff-tiles/:tid

POST   /schools/:id/leadership          { role, state }
PATCH  /schools/:id/leadership/:rid     { role?, state? }
DELETE /schools/:id/leadership/:rid
POST   /leadership/:rid/fields          { label, value }
PATCH  /leadership/:rid/fields/:fid     { label?, value? }
DELETE /leadership/:rid/fields/:fid

GET    /cluster/me/indicators/evaluation      // read-only
GET/PUT /cluster/me/indicators/madrasati
GET/PUT /cluster/me/indicators/discipline
GET/PUT /cluster/me/discipline-support-plan

GET    /cluster/me/absence?date=YYYY-MM-DD
PUT    /schools/:id/absence              { date, done }          → audited event
GET    /cluster/me/visits
POST   /visits                           multipart: schoolId, type, text, numbers, files[]
GET    /cluster/me/plans      PATCH /plans/:id   { url, status }
GET    /cluster/me/pd         POST  /pd          { kind, label, count, reportsUrl }
PATCH  /pd/:id                DELETE /pd/:id

GET    /cluster/me/sections              → CustomSection[]
POST   /cluster/me/sections              { label }
PATCH  /sections/:id                     { label }
DELETE /sections/:id
POST   /sections/:id/fields              { label, value }
PATCH  /sections/:id/fields/:fid         { label?, value? }
DELETE /sections/:id/fields/:fid

POST   /cluster/me/submit                → DailySubmission + head notification
```

## 6.3 Ingest & AI
```
POST   /ingest/upload            multipart files[]        → IngestJob[]
GET    /ingest/jobs?clusterId    → IngestJob[] (poll or SSE /ingest/stream)
GET    /ingest/jobs/:id/fields   → ExtractedField[]
PATCH  /ingest/fields/:id        { value?, status }        // edit before applying
POST   /ingest/apply             { fieldIds[] }            → { appliedCount }

POST   /ai/chat                  { message }               → SSE stream
                                 final: { text, citations[], resultTable? }
GET    /ai/summary?scope=district|cluster                  → { text, generatedAt }
POST   /ai/agent/propose         { action }                → AgentRun (status "proposed")
POST   /ai/agent/:id/approve                               → executes, returns resultSummary
POST   /ai/agent/:id/reject
```

## 6.4 Head
```
GET  /district/overview                  → KPIs, weekBars, tierSplit, clusterRows
GET  /district/members?filter=           → member cards
GET  /district/members/:id               → profile header + KPIs + section completion
GET  /district/members/:id/timeline      → delivery timeline
GET  /district/members/:id/attachments    → Attachment[] with status
PATCH /district/members/:id/contact      { email?, phone? }
GET  /district/submissions?date=         → 25 statuses
POST /district/reminders                 { memberIds[], body? }
POST /district/imports/nafes             multipart file
POST /district/imports/discipline        multipart file
POST /district/imports/madrasati         multipart file
GET  /district/report?date=              → ConsolidatedReport draft
POST /district/report/generate           { date, format } → { text | fileUrl }

GET  /attachments/:id/preview            → signed preview URL
GET  /attachments/:id/download           → signed download URL
GET  /clusters/:id/attachments.zip       → streamed ZIP
```

## 6.5 Validation rules
| Field | Rule | Arabic error |
|---|---|---|
| email | ends `@moe.gov.sa` | `البريد يجب أن ينتهي بـ moe.gov.sa` |
| nationalId | 10 digits, starts 1 or 2 | `السجل المدني ١٠ أرقام ويبدأ بـ ١ أو ٢` |
| phone | `05` + 8 digits | `رقم الجوال يبدأ بـ ٠٥ ويكون ١٠ أرقام` |
| ministryNo | 6 digits, unique | `الرقم الوزاري مستخدم لمدرسة أخرى` |
| percentages | 0–100 int | `النسبة بين ٠ و١٠٠` |
| classes/students | ≥0 int | `القيمة يجب أن تكون رقماً` |
| Hijri date | `١٤XX/MM/DD` | `صيغة التاريخ غير صحيحة` |
| upload | ≤20 files, ≤25MB each; pdf/docx/xlsx/jpg/png/m4a/mp3 | `نوع الملف غير مدعوم` / `حجم الملف أكبر من المسموح` |
| field label | 1–60 chars, non-empty | `اسم الحقل مطلوب` |

---

# PART 7 — AI layer

## 7.1 Ingest pipeline
```
upload → virus scan → store (drive/S3) → detect kind
  ├── PDF        text layer? extract : OCR (Arabic)
  ├── Word       docx → text + tables
  ├── Excel      sheets → normalized tables
  ├── Image      OCR (Arabic handwriting-tolerant)
  └── Audio      ASR (Arabic) → transcript
→ chunk + embed → index (pgvector / OpenSearch)
→ structured extraction (LLM, function-calling into the field schema)
→ school-name fuzzy match against the cluster roster
→ ExtractedField rows with {value, confidence, sourceRef}
→ conflict detection across files → flag
→ member review → apply (audited)
```
**Confidence:** `high` = exact table cell / labeled value · `medium` = inferred from prose · `low` = ambiguous (never auto-applied, always flagged).
**Conflicts:** when two sources disagree on the same `targetFieldKey`, surface both with their sources and force a choice.

## 7.2 Retrieval index
Index, per cluster: visit report text, blockers, extracted numbers, attachment transcripts, indicator snapshots, submission events. Metadata: `clusterId, memberId, schoolId, date, kind`. Head queries span the district; member queries are scoped to their own cluster.

## 7.3 Answer contract
Every numeric claim must attach `citations[] = {entity, id, date}`, rendered as the member/school/date behind the number. If retrieval returns nothing, say so — never estimate. Tabular answers additionally return `resultTable` (rendered as the structured card).

## 7.4 Agent actions (approval-gated)
| Action | Plan steps | On approve |
|---|---|---|
| `remind` | identify pending members → gather each one's gaps → draft a personalized message → await approval | send reminders, log `Reminder` rows |
| `report` | collect today's submissions → extract numbers → draft the executive summary → await approval | create `ConsolidatedReport` draft |
| `gaps` | scan the 25 cluster files → list missing/thin items → rank by impact → await approval | produce the gap list / assign follow-ups |

The plan card renders `plan[]` with ✓ for done steps and `…` for the awaiting step. **No side effects before approval.**

---

# PART 8 — Permissions & audit

| Capability | Member | Head |
|---|---|---|
| Read own cluster file | ✔ | ✔ |
| Write own cluster file | ✔ | ✖ |
| Read other clusters | ✖ | ✔ |
| Add/edit/delete fields, sections, schools, roles (own cluster) | ✔ | ✖ |
| Read PII (national IDs, phones) | own cluster | all (logged) |
| Edit member contact info | own | any |
| Import Nafes / discipline / Madrasati | ✖ | ✔ |
| Send reminders | ✖ | ✔ |
| Generate consolidated report | ✖ | ✔ |
| Run AI agent actions | ✖ | ✔ |
| Ask AI (own cluster scope) | ✔ | ✔ (district scope) |
| Download attachments | own cluster | all |

Audit every: field create/update/delete, school create/delete, absence toggle, submit, import, reminder, PII read, extraction apply, agent approval, export.
Retention: audit ≥3 years. PII encrypted at rest. Attachments behind signed, short-lived URLs.

---

# PART 9 — Copy reference

Tone: **simple and direct**, feminine second person (ادخلي، اسألي، أرفقي، ثبّتي). Hijri dates. Arabic-Indic numerals. No exclamation marks, no emoji.

All Arabic strings in Parts 2–3 are **final production copy** — use verbatim. Key repeated labels:
```
buttons:  دخول · حفظ التعديلات · إرسال التحديث لرئيسة النطاق · رفع التقرير · اختيار الملفات
          تطبيق N حقلاً على ملف العنقود · تعديل يدوي قبل الاعتماد · عرض · تنزيل · تنزيل الكل (ZIP)
          إرسال تذكير للباقيات · طلب توضيح · إرسال تذكير · تجهيز ونسخ · موافقة وإرسال
          + إضافة حقل · + إضافة مدرسة · + إضافة دور قيادي · + إضافة مؤشر · + إضافة قسم جديد · + حقل · حذف الدور
success:  ✓ حُفظت التعديلات · ✓ أُرسل لرئيسة النطاق · ✓ رُفع التقرير · ✓ طُبّق N حقلاً على ملف العنقود
          ✓ نُزّل · ✓ نُزّل الملف · ✓ أُرسل التذكير لـN عضوات · ✓ تم النسخ · ✓ أُرسلت ٧ رسائل تذكير
states:   مرفوع · ناقص · معتمدة · لم تُرفع · تم · لم يتم · مكتمل · تم الاستخراج · يحتاج مراجعة · جاري التحليل…
          حدّثت · متأخرة · لم تحدّث · محدّثة · مفرغة · مكلفة · لا يوجد · عالية · متوسطة
```

---

# PART 10 — Build order

1. **Foundation** — RTL shell, tokens, typography, Arabic-numeral formatter, sticky-sidebar layout, primitives library.
2. **Auth & shell** — login + role routing, header, dropdowns, notifications, both sidebars.
3. **Member sections 1–2** — profile fields and school data **with full add/rename/delete** (this is the data backbone and the riskiest surface).
4. **Section 6 (المهام)** — absence toggles + visit reports + plans (highest-frequency daily use).
5. **Mobile field view** — with an offline upload queue.
6. **Imports** — Nafes / discipline / Madrasati → member sections 3–5.
7. **Head dashboard** — KPIs, charts, cluster table, submission tracking, reminders.
8. **Member profiles** — timeline, section completion, attachments with view/download/preview, contact editing.
9. **Ingest pipeline** — upload → transcribe → extract → review → apply.
10. **AI assistant** — retrieval-grounded chat with citations, then approval-gated agent actions.
11. **Consolidated report** — generation + text/PDF/Excel export.
12. **Hardening** — audit log, RLS, PII gating, validation, empty/error/offline states, confirm dialogs.

## 10.1 Definition of done per screen
- Renders correctly at 1440, 1280, 1024, 768, 390 px.
- Skeleton, empty, error, and permission-denied states implemented.
- All numerals Arabic-Indic; all dates Hijri.
- Every input labeled; keyboard-navigable; dropdowns Esc-closable.
- Every mutation optimistic + audited; every destructive action confirmed.
- No hardcoded literal that should come from the API.

---

## Files in this bundle
| File | Role |
|---|---|
| `SPEC.md` | **This document — the build spec** |
| `EDITABILITY.md` | **Required companion — every action the user must be able to perform (CRUD inventory, save/undo/conflict contract, permissions, acceptance checklist). A screen that renders but cannot be mutated is not done.** |
| `README.md` | Earlier condensed handoff (superseded by this file) |
| `Rasd Platform.dc.html` | **Canonical interactive design reference** |
| `Rasd Reports v2.dc.html` | Earlier iteration, reference only |
| `ios-frame.jsx` | Device frame for presenting the mobile view — presentation only, do not port |
| `support.js` | Prototype runtime — **do not port** |
