# رَصد — Editability & Actions Specification
### كل ما يجب أن يكون قابلاً للتعديل — العقد الكامل للإجراءات

**Read this together with `SPEC.md`.** SPEC describes what the screens *look like*. This document describes what the user can *change*, and is the acceptance contract for the build. A screen that renders correctly but cannot be mutated is **not done**.

---

# PART 0 — The rule

> **Rasd is a data-entry product, not a dashboard.** Every value a user sees in their own cluster file is either (a) something they can change, or (b) explicitly listed in §4 as derived or imported. There is no third category. If the agent built a screen where a field is printed as text and cannot be edited, that screen is unfinished.

Three failure modes to reject in review:
1. **Static text where an input belongs** — values rendered as `<span>` in the member's own file.
2. **Buttons that don't mutate** — `+ إضافة`, `×`, toggles, and `حفظ` that are wired to nothing or only to local component state that dies on reload.
3. **Fixed structure** — a hard-coded list of 12 profile fields / 6 leadership roles / 10 school fields. The structure itself is user data. Districts differ; the member must be able to add, rename, delete, hide, and reorder.

---

# PART 1 — Global interaction contract

Applies to every mutation in Part 2 unless that row overrides it.

## 1.1 Save model
- **Field inputs auto-save on blur** (and on `Enter` for single-line inputs), debounced 600ms for continuous typing.
- The explicit **`حفظ التعديلات`** button performs a flush of all dirty fields on the page, then shows `✓ حُفظت التعديلات` for ~3s. It is a reassurance affordance, not the only save path — a user who edits and navigates away must not lose data.
- **Structural mutations (add / delete / reorder / hide) save immediately**, no debounce, no explicit save needed.
- Never block the UI on a save. No full-page spinners on edit.

## 1.2 Optimistic updates + rollback
Apply the change to the UI instantly, fire the request, reconcile on response.
- On failure: revert the value to its server state, mark the field with the error border (`#dc2626`), show the Arabic error under it, and surface a toast `تعذّر الحفظ — أعيدي المحاولة` with a `إعادة المحاولة` action.
- Never silently drop a failed write. Never leave the optimistic value on screen after a failure.

## 1.3 Validation
Run the §6.5 SPEC rules **client-side on blur** and **server-side always**. Server is the source of truth. Errors render inline under the field in Arabic, 11.5px, `#dc2626`; the field border turns `#dc2626`. An invalid field does not block other fields from saving.

## 1.4 Deletion & confirmation
| Destructiveness | Items | Behavior |
|---|---|---|
| **Low** — instantly reversible | a profile field, a staff tile, a leadership field, a custom-section field | Delete immediately, show toast `حُذف الحقل` + **`تراجع`** (undo window 8s) |
| **High** — carries children | a school, a leadership role, a whole custom section | Confirm dialog first: title, the item's name, a line naming what else is lost (`سيتم حذف ٤ أدوار قيادية و٦ مؤشرات`), buttons `حذف` (red) / `إلغاء`. Then delete with an 8s undo toast |

Undo restores the row with its original id and ordering. Deletion is **soft** server-side (`deleted_at`) for 30 days so undo and audit both work.

## 1.5 Conflict handling
Two devices, one member (phone in the field + laptop). Use per-row `updatedAt`: if the server row is newer than the value the client loaded, reject with `409` and show `تم تعديل هذا الحقل من جهاز آخر` + both values + `استخدام قيمتي` / `استخدام القيمة الجديدة`. Never last-write-wins silently on a shared cluster file.

## 1.6 Offline (mobile field view is the priority case)
Queue mutations in IndexedDB, replay in order on reconnect, show a persistent `في انتظار الاتصال — N تغييرات` bar. Uploads retry with backoff. A member standing in a school with no signal must be able to finish her entry.

## 1.7 Audit
Every mutation writes `{actorId, entity, entityId, field, before, after, at, source: "web"|"mobile"|"ingest"|"agent"}`. The head's member timeline (§2.11 SPEC) is rendered **from this log** — it is not decorative seed data. Ingest-applied and agent-applied changes are labelled with their source in the timeline.

## 1.8 Permissions (enforce server-side, not just by hiding UI)
| Actor | Own cluster file | Other clusters | District-level |
|---|---|---|---|
| **Member** (عضو الفريق التنفيذي) | full CRUD | no read, no write | no |
| **Head** (رئيسة النطاق) | read all 25 · edit contact fields only · cannot edit a member's section data | read | full: imports, reminders, report generation, agent actions |

The head **never** silently edits a member's numbers. If the head needs a correction, she sends a reminder/comment — the member changes it. This is a product rule, not a technical one; it preserves ownership of the data.

## 1.9 Keyboard & a11y
`Tab` moves through inputs in visual RTL order. `Enter` commits a rename input and exits label-edit for that field. `Esc` cancels a rename and restores the previous label. Every `×` and icon-only control needs `aria-label` naming its target (`حذف حقل السجل المدني`). Toasts are `role="status"`; confirm dialogs trap focus.

## 1.10 Empty states — every list that can be emptied needs one
Schools · leadership roles · staff tiles · profile fields · custom sections · custom fields · PD programs · attachments · ingest queue. Each empty state carries the **add** action inside it, not just an illustration. E.g. `ما في مدارس بعد` + `+ إضافة مدرسة`.

---

# PART 2 — Complete mutation inventory

Every row is an action the build must ship. `Ctl` = control type. Endpoints per SPEC §6.

## 2.1 Member · البيانات الأولية

| # | Action | Ctl | Endpoint | Notes |
|---|---|---|---|---|
| P-1 | Edit any field value | text input | `PATCH /cluster/me/profile-fields/:id` | auto-save on blur |
| P-2 | Change الرتبة | select (خبير / متقدم / ممارس / ممارس متقدم) | same | |
| P-3 | Rename any field label | dashed input (label-edit mode) | same, `{label}` | 1–60 chars |
| P-4 | Delete a field | `×` | `DELETE …/:id` | undo toast; **including built-in fields** |
| P-5 | Add a field | dashed `+ إضافة حقل` | `POST /cluster/me/profile-fields` | defaults: label `حقل جديد`, empty value, span 1, text |
| P-6 | Reorder fields | drag handle | `PUT …/order { ids[] }` | *not in the reference — add it* |
| P-7 | Flush saves | `حفظ التعديلات` | batch PATCH | → `✓ حُفظت التعديلات`, 3s |
| — | عدد سنوات الخبرة | **read-only** | — | derived; see §4 |

## 2.2 Member · مدارس العنقود

| # | Action | Ctl | Endpoint | Notes |
|---|---|---|---|---|
| S-1 | Add a school | `+ إضافة مدرسة` | `POST /cluster/me/schools` | creates `مدرسة جديدة`, **auto-selects it**, seeds 1 leadership role (مديرة المدرسة) + 2 staff tiles |
| S-2 | Delete a school | `×` in list row | `DELETE …/:id` | **confirm dialog** — names the leadership roles and indicators that go with it |
| S-3 | Rename a school | span ⇄ dashed input | `PATCH …/:id {name}` | |
| S-4 | Edit any info value (10 base fields) | input / select | `PATCH …/:id` | typed per §6.5: ints for فصول/طالبات, enums for نوع التعليم / الحارس / اللغة الصينية |
| S-5 | Change tier (التصنيف) | select | `PATCH …/:id {tier}` | recolors the pill everywhere it appears |
| S-6 | Hide / show a base field **cluster-wide** | toggle chip in تخصيص حقول المدرسة | `PUT /schools/:id/field-overrides {hidden[]}` | applies to all 6 schools, not just the selected one |
| S-7 | Add a custom school field | `+ إضافة حقل للمدرسة` | `POST /schools/:id/custom-fields` | |
| S-8 | Rename / edit / delete a custom field | input · `×` | `PATCH` · `DELETE` | |
| S-9 | Edit a staff tile value | borderless 20px input | `PATCH /schools/:id/staff-tiles/:tid` | ints ≥0 |
| S-10 | Rename a staff tile | dashed input | same | |
| S-11 | Delete a staff tile | absolute `×` | `DELETE …` | undo toast |
| S-12 | Add a staff tile | `+ إضافة مؤشر` | `POST /schools/:id/staff-tiles` | |
| S-13 | Add a leadership role | `+ إضافة دور قيادي` | `POST /schools/:id/leadership` | defaults `دور جديد` / `مكلفة` / fields الاسم + الجوال |
| S-14 | Rename a role | dashed input | `PATCH …/:rid {role}` | |
| S-15 | Change role state | pill ⇄ text input (مفرغة / مكلفة / لا يوجد) | `PATCH …/:rid {state}` | `لا يوجد` → red pill |
| S-16 | Delete a role | `حذف الدور` (red) | `DELETE …/:rid` | **confirm** — it carries its fields |
| S-17 | Add a field to a role | `+ حقل` (teal) | `POST /leadership/:rid/fields` | |
| S-18 | Rename / edit / delete a role field | input · `×` | `PATCH` · `DELETE` | البريد الوزاري renders `dir=ltr` |
| S-19 | Reorder schools & roles | drag | `PUT …/order` | *add it* |

## 2.3 Member · indicators

| # | Action | Ctl | Endpoint | Notes |
|---|---|---|---|---|
| I-1 | **التقويم المدرسي table** | — | `GET` only | **read-only, imported by the head.** Show the import badge + date. Do not build inputs here |
| I-2 | Update نافس folder link | URL input + `تحديث الرابط` | `PUT /cluster/me/indicators/evaluation` | validate it's a URL |
| I-3 | Mark external-report row مرفوع/ناقص | pill toggle + drive link | same | |
| I-4 | Edit مدرستي per-school metric | cell input | `PUT /cluster/me/indicators/madrasati` | 0–100 int; **the six average cards recompute live** |
| I-5 | Edit انضباط daily/weekly/monthly | cell input | `PUT /cluster/me/indicators/discipline` | 0–100 int; cell color rescales live |
| I-6 | Mark a discipline plan معتمدة / لم تُرفع | pill toggle | same | |
| I-7 | Edit خطة دعم الانضباط | textarea | `PUT /cluster/me/discipline-support-plan` | auto-save, ~1000 char cap |
| I-8 | Attach / replace the plan file | file row | `POST /attachments` | |

## 2.4 Member · المهام

| # | Action | Ctl | Endpoint | Notes |
|---|---|---|---|---|
| T-1 | Toggle تثبيت الغياب per school | pill `تم` ⇄ `لم يتم` | `PUT /schools/:id/absence {date,done}` | optimistic; **updates the header count, the progress bar, the sidebar nav badge, and the gap card in the same tick**; writes an audited event |
| T-2 | Upload a visit report | `رفع تقرير زيارة من الجوال` | `POST /visits` multipart | visit count is derived from this — see §4 |
| T-3 | Edit a plan's drive link / status | input · pill | `PATCH /plans/:id` | 5 plan rows |

## 2.5 Member · التطوير المهني

| # | Action | Ctl | Endpoint | Notes |
|---|---|---|---|---|
| D-1 | Add a program | `إضافة برنامج` | `POST /pd` | opens a small form: kind, label, count, drive link — **not a blind counter increment** |
| D-2 | Edit count / label / link | inputs | `PATCH /pd/:id` | |
| D-3 | Toggle reports مرفوعة / ناقصة | pill | `PATCH /pd/:id` | |
| D-4 | Delete a program | `×` | `DELETE /pd/:id` | undo toast |

## 2.6 Member · sections & navigation

| # | Action | Ctl | Endpoint | Notes |
|---|---|---|---|---|
| N-1 | Add a custom section | `+ إضافة قسم جديد` | `POST /cluster/me/sections` | title `قسم جديد`, appears in nav, **navigates to it immediately** |
| N-2 | Rename a section | dashed title input | `PATCH /sections/:id` | |
| N-3 | Delete a custom section | `×` in nav | `DELETE /sections/:id` | **confirm** — names the field count |
| N-4 | Add / rename / edit / delete a section field | rows + `×` + `+ إضافة حقل` | `POST` · `PATCH` · `DELETE /sections/:id/fields` | |
| N-5 | Toggle label-edit mode | `تعديل مسميات الحقول` ⇄ `✓ إنهاء تعديل المسميات` | client state | see §3 |
| N-6 | Submit the daily update | `إرسال التحديث لرئيسة النطاق` | `POST /cluster/me/submit` | → `✓ أُرسل لرئيسة النطاق`; creates the DailySubmission and notifies the head **in real time** |
| — | Built-in sections | — | — | **cannot be hidden or deleted** — only custom sections carry a `×` |

## 2.7 Member · الاستيراد الذكي

| # | Action | Ctl | Endpoint | Notes |
|---|---|---|---|---|
| G-1 | Upload files | dropzone + `اختيار الملفات` | `POST /ingest/upload` | drag-drop **and** picker; ≤20 files, ≤25MB each; per-file progress |
| G-2 | Watch job progress | — | SSE `/ingest/stream` | real progress, not a fake animation |
| G-3 | Edit an extracted value before applying | table cell input | `PATCH /ingest/fields/:id` | |
| G-4 | Accept / reject a single field | row control | `PATCH …{status}` | |
| G-5 | Resolve a conflict (two sources disagree) | choice control | same | show both values + sources; forced choice |
| G-6 | Apply all | `تطبيق ٣٧ حقلاً على ملف العنقود` | `POST /ingest/apply {fieldIds[]}` | → `✓ طُبّق ٣٧ حقلاً`; **writes through to the real fields** and stamps them `source: ingest` in the audit log |
| G-7 | Manual edit before approval | `تعديل يدوي قبل الاعتماد` | — | switches the table into edit mode |
| G-8 | Delete a queued file | `×` | `DELETE /ingest/jobs/:id` | |

## 2.8 Mobile field view — `/field`
Every task on this screen is a write. It is the highest-frequency surface in the product.
- Log a visit: school picker, type, free text, numbers, photos/PDF (client-compressed), audio note → `POST /visits`.
- Toggle absence per school (same endpoint as T-1, same optimistic rules).
- All of it must work **offline-first** per §1.6 — queue and retry.

## 2.9 Head · district

| # | Action | Ctl | Endpoint | Notes |
|---|---|---|---|---|
| H-1 | Import نافس / انضباط / مدرستي | file upload | `POST /district/imports/*` | this is what populates the members' read-only tables (I-1) |
| H-2 | Send reminders | select members + `تذكير` | `POST /district/reminders` | multi-select, optional body |
| H-3 | Edit a member's contact info | inputs | `PATCH /district/members/:id/contact` | **email and phone only** — the only member data the head can write |
| H-4 | Generate the consolidated report | `توليد التقرير` | `POST /district/report/generate` | date + format; produces text or file |
| H-5 | Ask the AI assistant | chat input | `POST /ai/chat` SSE | answers must carry citations |
| H-6 | Approve / reject an agent action | `اعتماد` / `رفض` | `POST /ai/agent/:id/approve|reject` | **nothing the agent proposes executes without an explicit approval** |
| H-7 | Preview / download attachments, download a cluster ZIP | buttons | `GET /attachments/*`, `/clusters/:id/attachments.zip` | signed URLs |
| H-8 | Filter / sort / search members and submissions | controls | query params | real server-side filtering, not client-only on a stub list |

---

# PART 3 — Label-edit mode semantics

One toggle, cluster-wide, client state only. It is a **display mode, not a permission**.

**On:** every label becomes a dashed rename input; the school customize panel appears; school names become editable inputs.
**Off:** labels render as plain text.

**Always visible in both modes — this is the most commonly mis-built detail:**
- every `×` delete
- every `+ إضافة …` button
- every value input

A user must be able to add a school or fix a number without first switching to an "edit mode". Only *renaming the structure* lives behind the toggle.

---

# PART 4 — Never editable (enforce read-only, server-side too)

| Value | Why | Source |
|---|---|---|
| عدد سنوات الخبرة | derived | `now − تاريخ التعيين` |
| عدد الزيارات per school | derived | `count(VisitReport)` in the drive folder — **never hand-entered**; this is a core product rule |
| اكتمال ملف العنقود ٪ | derived | filled required fields ÷ total |
| مؤشرات التقويم المدرسي (نافس / القدرات / التحصيلي / نوع الدعم) | imported by the head | `POST /district/imports/nafes` |
| متوسطات مدرستي (the six cards) | computed | mean of the 6 schools' values — recompute on every cell edit |
| N من ٦ مثبتة, gap card contents, nav badges | computed | from live state |
| DailySubmission status (مُرسل / متأخر / لم تُرسل) | computed | vs. the deadline |
| Audit timeline entries | append-only | the log |

Render these as tinted read-only tiles (`#f7f8f8`) with the hint `تُحسب تلقائياً`. If a user tries to type in one, do nothing — don't show an error, show the hint.

---

# PART 5 — Cross-screen reactivity

Mutations are not local. When one of these changes, everything downstream updates **without a reload**:

```
edit a school's طالبات      → cluster summary pills · district student totals
add / delete a school       → nav badge ٦ · summary pills · every indicator table · absence task list
toggle absence              → task header count · progress bar · nav badge · gap card · head's submission board
fill a required field       → completion % · sidebar bar · gap card · head's section-completion view
apply ingest fields         → every target field · completion % · audit timeline (source: ingest)
submit the daily update     → head's متابعة الإرسال row flips to مُرسل in real time · head notification
edit a مدرستي cell          → that school's row color · the six average cards
delete a custom section     → nav · the consolidated report's contents
```

Build this on a single normalized client store (or server-state library with invalidation), not by passing props between sibling screens. Getting this wrong is the difference between a prototype and a product.

---

# PART 6 — Acceptance checklist

Run this against the build. Every line must pass **and survive a page reload** — that last clause is what catches local-state-only implementations.

**Structure**
- [ ] Add a profile field, rename it, type a value, reload → all three persist
- [ ] Delete a built-in profile field → gone; undo within 8s → restored in its original position
- [ ] Add a school → auto-selected, seeded with 1 role + 2 tiles, nav badge reads ٧
- [ ] Delete a school → confirm dialog names its children; after confirm every indicator table loses that row
- [ ] Add a leadership role, add a field to it, rename both, delete the field, delete the role
- [ ] Add a staff tile, edit its number, delete it
- [ ] Hide `تطبيق اللغة الصينية` → hidden on **all six** schools
- [ ] Add a custom section, rename it, add 3 fields, delete one, delete the section
- [ ] Built-in sections have no `×` anywhere

**Values & validation**
- [ ] Every value in the member's own file is an input or an explicitly-derived tile — walk all 8 sections and confirm
- [ ] Bad national ID / phone / email / percentage each show the exact Arabic error from SPEC §6.5
- [ ] Server rejects an invalid value even when the client is bypassed
- [ ] Edit a مدرستي cell → the average card above recomputes immediately
- [ ] The التقويم المدرسي table has no inputs at all

**Behavior**
- [ ] Kill the network, edit a field → error toast + rollback, value is not left on screen
- [ ] Two tabs, same field, different values → 409 conflict UI, not silent overwrite
- [ ] Mobile: airplane mode, log a visit + toggle absence, reconnect → both replay
- [ ] Toggle absence → four places update in the same tick
- [ ] Submit the daily update → head's board flips in real time
- [ ] Ingest: upload, edit an extracted value, apply → real fields change and the audit says `ingest`
- [ ] Head cannot write any member section field via the API (403), even with a crafted request
- [ ] Every mutation appears in the head's member timeline with the right source label

**Surfaces**
- [ ] Every list that can be emptied has an empty state containing its add action
- [ ] Every icon-only control has an `aria-label`
- [ ] All of the above still works at 390px width
