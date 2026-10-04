"use client";

import type { MemberDetail } from "@rasd/schemas";
import { ArrowRight, BellRing, Check, CircleAlert, Copy, Ellipsis, KeyRound, Mail, MessageCircle, Phone, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, ApiRequestError } from "../../lib/api";
import { copyText, initialsOf, loginMessage, whatsappLink } from "../../lib/chat/helpers";
import { ar, counted, firstName, pct, relativeTime } from "../../lib/format";
import { ConfirmDialog, Dialog } from "./dialog";
import { DocumentsTab } from "./documents-tab";
import { VisitsTab } from "./member-lists";
import { emptyEssentialIds, ProfileTab } from "./profile-tab";
import { SchoolsTab } from "./schools-tab";
import { useToast } from "./toast";
import { SaveState, useWorkspaceAutosave } from "./use-workspace-autosave";

type Tab = "profile" | "schools" | "documents" | "visits";

export function MemberProfile({ memberId }: { memberId: string }) {
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await api.get<MemberDetail>(`/district/members/${memberId}`));
      setError(null);
    } catch (reason) {
      setError(reason as ApiRequestError);
    }
  }, [memberId]);

  useEffect(() => { void load(); }, [load]);

  if (error && !detail) {
    return (
      <div className="d-page">
        <BackLink />
        <div className="empty">
          <CircleAlert />
          <b>{error.status === 404 ? "لم نجد هذه المشرفة" : "تعذّر تحميل الملف"}</b>
          <span>{error.status === 404 ? "ربما حُذفت من الفريق." : error.message}</span>
          {error.status === 404
            ? <Link href="/district/team" className="btn btn-primary">العودة للفريق</Link>
            : <button className="btn btn-primary" onClick={() => void load()}><RefreshCw /> إعادة المحاولة</button>}
        </div>
      </div>
    );
  }
  if (!detail) return <ProfileSkeleton />;
  return <ProfileView detail={detail} setDetail={setDetail} />;
}

/** Desktop only — on phones the topbar shows a back arrow instead. */
function BackLink() {
  return <Link href="/district/team" className="mp-back"><ArrowRight /> الفريق والأرقام</Link>;
}

function statusText(detail: MemberDetail) {
  if (!detail.activated) return { text: "لم تفعّل حسابها بعد", tone: "warn" };
  if (detail.submittedToday) return { text: "حدّثت اليوم", tone: "ok" };
  if (detail.lastActivityAt) return { text: `آخر تحديث ${relativeTime(detail.lastActivityAt)}`, tone: "" };
  if (detail.lastLoginAt) return { text: `آخر دخول ${relativeTime(detail.lastLoginAt)}`, tone: "" };
  return { text: "فعّلت حسابها", tone: "" };
}

function ProfileView({ detail, setDetail }: { detail: MemberDetail; setDetail: (detail: MemberDetail) => void }) {
  const router = useRouter();
  const toast = useToast();
  const { workspace, state, update, absorb, retry } = useWorkspaceAutosave(detail.id, detail.workspace, () => toast("تم تحديث الملف للتو — عرضنا أحدث نسخة"));
  const [tab, setTab] = useState<Tab>("profile");
  const [onlyIds, setOnlyIds] = useState<string[] | null>(null);
  const [editingEmail, setEditingEmail] = useState(false);
  const [dialog, setDialog] = useState<"reminder" | "reset" | "delete" | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const value = (id: string) => workspace.profile.find(field => field.id === id)?.value.trim() ?? "";
  const name = value("name") || detail.name;
  const title = value("title") || detail.title;
  const phone = value("phone") || detail.phone;
  const status = statusText(detail);

  const refresh = useCallback(async () => {
    const fresh = await api.get<MemberDetail>(`/district/members/${detail.id}`);
    setDetail(fresh);
    absorb(fresh.workspace);
  }, [detail.id, setDetail, absorb]);

  const showMissing = () => {
    setTab("profile");
    setOnlyIds(emptyEssentialIds(workspace));
    window.setTimeout(() => panel.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 30);
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "profile", label: "البيانات" },
    { id: "schools", label: "المدارس", count: workspace.schools.length },
    { id: "documents", label: "الملفات", count: detail.documents.length },
    { id: "visits", label: "الزيارات", count: detail.visits.length },
  ];

  return (
    <div className="d-page mp">
      <BackLink />

      <section className="card mp-header">
        <div className="mp-header-main">
          <span className="avatar avatar-lg">{initialsOf(name)}</span>
          <div className="mp-identity">
            <h1>{name}</h1>
            {title && <p>{title}</p>}
            {editingEmail
              ? <LoginEmailForm detail={detail} beforeSave={retry} onDone={() => setEditingEmail(false)} onSaved={fresh => { setDetail(fresh); absorb(fresh.workspace); }} />
              : <span className="mp-email" dir="ltr">{detail.email}</span>}
          </div>
          <MoreMenu
            phone={phone}
            onEmail={() => setEditingEmail(true)}
            onReset={() => setDialog("reset")}
            onDelete={() => setDialog("delete")}
          />
        </div>

        <p className="mp-status">
          <span className={`mp-status-dot ${status.tone ? `is-${status.tone}` : ""}`} aria-hidden />
          <span>{status.text}</span>
          <span aria-hidden>·</span>
          <span>{pct(workspace.completion)}</span>
          <span aria-hidden>·</span>
          {workspace.missing.length
            ? <button className="mp-missing-link" onClick={showMissing}>ينقصها {ar(workspace.missing.length)}</button>
            : <span className="mp-complete">مكتمل ✓</span>}
        </p>

        <div className="mp-actions">
          <button className="btn btn-primary" onClick={() => setDialog("reminder")}><BellRing /> رسالة تذكير</button>
          <Link href={`/district?q=${encodeURIComponent(`أعطيني ملخص ملف ${name}`)}&send=1`} className="btn btn-secondary"><Sparkles /> <span>اسألي <span className="mp-wide-only">المساعد </span>عنها</span></Link>
        </div>
      </section>

      <div className="mp-tabs" role="tablist" aria-label="أقسام الملف" ref={panel}>
        {tabs.map(item => (
          <button key={item.id} role="tab" id={`tab-${item.id}`} aria-selected={tab === item.id} aria-controls="mp-tabpanel" className={`mp-tab ${tab === item.id ? "is-active" : ""}`} onClick={() => setTab(item.id)}>
            {item.label}{Boolean(item.count) && <span className="mp-tab-count">{ar(item.count!)}</span>}
          </button>
        ))}
      </div>

      <div id="mp-tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "profile" && <ProfileTab workspace={workspace} update={update} onlyIds={onlyIds} onShowAll={() => setOnlyIds(null)} onGo={setTab} />}
        {tab === "schools" && <SchoolsTab workspace={workspace} update={update} />}
        {tab === "documents" && <DocumentsTab memberId={detail.id} documents={detail.documents} onChanged={() => void refresh()} />}
        {tab === "visits" && <VisitsTab visits={detail.visits} />}
      </div>

      <SaveIndicator state={state} onRetry={() => void retry()} />

      {dialog === "reminder" && (
        <ReminderDialog target={{ name, email: detail.email, activated: detail.activated, missing: workspace.missing }} phone={phone} onClose={() => setDialog(null)} />
      )}
      {dialog === "reset" && (
        <ConfirmDialog
          title="إعادة تعيين كلمة المرور؟"
          description={<>عند دخولها القادم ستكتب بريدها <span dir="ltr">{detail.email}</span> ثم تختار كلمة مرور جديدة. بياناتها وملفاتها تبقى كما هي.</>}
          confirmLabel="إعادة التعيين"
          onConfirm={async () => {
            await api.post(`/district/members/${detail.id}/reset-password`);
            toast("تمت إعادة التعيين — ستختار كلمة مرور جديدة عند دخولها");
            await refresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "delete" && (
        <ConfirmDialog
          title={`حذف ${name}؟`}
          description="سيُحذف حسابها وملفها وملفاتها المرفوعة نهائياً، ولن تتمكن من الدخول."
          confirmLabel="حذف نهائياً"
          danger
          onConfirm={async () => {
            await api.del(`/district/members/${detail.id}`);
            toast(`حُذفت ${name} من الفريق`);
            router.push("/district/team");
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

type MoreMenuProps = { phone: string; onEmail: () => void; onReset: () => void; onDelete: () => void };

/** The rare actions live behind «⋯»: call, change login email, reset password, delete. */
function MoreMenu({ phone, onEmail, onReset, onDelete }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const pick = (action: () => void) => () => { setOpen(false); action(); };

  return (
    <div className="mp-more" ref={root}>
      <button className="btn btn-ghost btn-icon" onClick={() => setOpen(value => !value)} aria-label="خيارات أخرى" aria-haspopup="menu" aria-expanded={open}>
        <Ellipsis />
      </button>
      {open && (
        <div className="d-menu" role="menu">
          {phone && <a role="menuitem" href={`tel:${phone}`} onClick={() => setOpen(false)}><Phone /> اتصال <span dir="ltr" className="muted">{phone}</span></a>}
          <button role="menuitem" onClick={pick(onEmail)}><Mail /> تغيير بريد الدخول</button>
          <button role="menuitem" onClick={pick(onReset)}><KeyRound /> إعادة تعيين كلمة المرور</button>
          <button role="menuitem" className="is-danger" onClick={pick(onDelete)}><Trash2 /> حذف من الفريق</button>
        </div>
      )}
    </div>
  );
}

/** «جارٍ الحفظ…» → «حُفظ ✓» for 2 seconds → hidden. Errors stay with a retry. */
function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (state !== "saved") return;
    setShowSaved(true);
    const timer = window.setTimeout(() => setShowSaved(false), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);

  let content = null;
  if (state === "pending" || state === "saving") content = <><span className="spinner" /> جارٍ الحفظ…</>;
  else if (state === "saved" && showSaved) content = <><Check /> حُفظ</>;
  else if (state === "error") content = <><CircleAlert /> تعذّر الحفظ <button onClick={onRetry}>إعادة المحاولة</button></>;

  return (
    <div className="mp-save-wrap" role="status" aria-live="polite">
      {content && <span className={`mp-save ${state === "error" ? "is-error" : state === "saved" ? "is-ok" : ""}`}>{content}</span>}
    </div>
  );
}

type LoginEmailProps = { detail: MemberDetail; beforeSave: () => Promise<void>; onSaved: (detail: MemberDetail) => void; onDone: () => void };

/** The email she signs in with (separate from the profile's email field, which is just information). */
function LoginEmailForm({ detail, beforeSave, onSaved, onDone }: LoginEmailProps) {
  const toast = useToast();
  const [email, setEmail] = useState(detail.email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await beforeSave();
      onSaved(await api.patch<MemberDetail>(`/district/members/${detail.id}`, { email: email.trim() }));
      onDone();
      toast("تم تغيير بريد الدخول");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mp-email-form" onSubmit={save}>
      <label className="sr-only" htmlFor="login-email">بريد الدخول</label>
      <input id="login-email" className="input" value={email} onChange={event => setEmail(event.target.value)} onKeyDown={event => { if (event.key === "Escape") onDone(); }} dir="ltr" inputMode="email" autoFocus />
      <button className="btn btn-primary btn-icon" disabled={busy} aria-label="حفظ البريد">{busy ? <span className="spinner spinner-light" /> : <Check />}</button>
      <button type="button" className="btn btn-secondary btn-icon" onClick={onDone} aria-label="إلغاء"><X /></button>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  );
}

const MORE_ITEMS = { one: "بند آخر", two: "بندان آخران", few: "بنود أخرى", many: "بنداً آخر" };

type ReminderTarget = { name: string; email: string; activated: boolean; missing: string[] };

function reminderText({ name, email, activated, missing }: ReminderTarget) {
  const first = firstName(name);
  const site = `${window.location.origin}/login`;
  // Not signed in yet: how to get in comes first, then one line about what is missing.
  if (!activated) {
    const shown = missing.slice(0, 3).join("، ");
    const rest = missing.length > 3 ? ` و${counted(missing.length - 3, MORE_ITEMS)}` : "";
    return [loginMessage(name, email), ...(missing.length ? [`ينقص ملفك الآن: ${shown}${rest}.`] : [])].join("\n");
  }
  if (!missing.length) return `السلام عليكم أ. ${first}،\nشكراً لك على إكمال ملفك في منصة رَصد.\nرابط المنصة: ${site}`;
  return [
    `السلام عليكم أ. ${first}،`,
    "نرجو استكمال ملفك في منصة رَصد، وما زال ينقصه:",
    ...missing.map(item => `- ${item}`),
    "",
    `رابط الدخول: ${site}`,
    "شكراً لك.",
  ].join("\n");
}

function ReminderDialog({ target, phone, onClose }: { target: ReminderTarget; phone: string; onClose: () => void }) {
  const { name, activated, missing } = target;
  const [copied, setCopied] = useState(false);
  const text = reminderText(target);
  const copy = async () => {
    if (await copyText(text)) { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
  };
  return (
    <Dialog
      title="رسالة تذكير"
      description={!activated ? `رسالة جاهزة: كيف تدخل ${firstName(name)} أول مرة وما ينقص ملفها.` : missing.length ? `رسالة جاهزة بما ينقص ملف ${firstName(name)}.` : "ملفها مكتمل — هذه رسالة شكر."}
      onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={copy}>{copied ? <><Check /> تم النسخ</> : <><Copy /> نسخ</>}</button>
        <a className="btn btn-primary" href={whatsappLink(text, phone)} target="_blank" rel="noopener noreferrer"><MessageCircle /> إرسال واتساب</a>
      </>}
    >
      <div className="blk-copy-text">{text}</div>
    </Dialog>
  );
}

function ProfileSkeleton() {
  return (
    <div className="d-page mp" aria-label="جارٍ التحميل">
      <BackLink />
      <i className="skeleton mp-skeleton-head" />
      <i className="skeleton mp-skeleton-tabs" />
      <div className="mp-fields">{Array.from({ length: 6 }, (_, index) => <i key={index} className="skeleton mp-skeleton-field" />)}</div>
    </div>
  );
}
