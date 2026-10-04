"use client";

import type { MemberSummary } from "@rasd/schemas";
import { Check, Copy, MessageCircle, UserPlus } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { api } from "../../lib/api";
import { copyText, loginMessage, whatsappLink } from "../../lib/chat/helpers";
import { Dialog } from "./dialog";

export const TITLE_SUGGESTIONS = ["عضو فريق تنفيذي", "عضو نواتج تعلم", "أخصائية نشاط طلابي", "أخصائية توجيه طلابي"];

type Props = { onClose: () => void; onCreated: (member: MemberSummary) => void; clusters: string[] };

export function AddMemberDialog({ onClose, onCreated, clusters }: Props) {
  const [form, setForm] = useState({ name: "", email: "", title: "", clusterLabel: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<MemberSummary | null>(null);

  const set = (key: keyof typeof form) => (value: string) => setForm(state => ({ ...state, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const member = await api.post<MemberSummary>("/district/members", {
        name: form.name.trim(), email: form.email.trim(), title: form.title.trim(), clusterLabel: form.clusterLabel.trim(),
      });
      setCreated(member);
      onCreated(member);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (created) return <CreatedStep member={created} onClose={onClose} />;

  return (
    <Dialog
      title="إضافة مشرفة"
      description="اسمها وبريدها يكفيان؛ تدخل ببريدها وتختار كلمة مرور وتكمل ملفها بنفسها."
      onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose}>إلغاء</button>
        <button type="submit" form="add-member-form" className="btn btn-primary" disabled={busy}>
          {busy ? <span className="spinner spinner-light" /> : <UserPlus />} إضافة
        </button>
      </>}
    >
      <form id="add-member-form" className="d-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">الاسم</span>
          <input className="input" value={form.name} onChange={event => set("name")(event.target.value)} placeholder="مثال: نورة محمد العتيبي" autoComplete="off" />
        </label>
        <label className="field">
          <span className="field-label">البريد الذي ستدخل به</span>
          <input className="input" value={form.email} onChange={event => set("email")(event.target.value)} placeholder="مثال: name@gmail.com" dir="ltr" inputMode="email" autoComplete="off" />
        </label>
        <label className="field">
          <span className="field-label">الصفة</span>
          <input className="input" value={form.title} onChange={event => set("title")(event.target.value)} list="title-suggestions" placeholder="اختاري أو اكتبي" />
          <datalist id="title-suggestions">{TITLE_SUGGESTIONS.map(item => <option key={item} value={item} />)}</datalist>
        </label>
        <label className="field">
          <span className="field-label">العنقود <small className="field-hint">(اختياري)</small></span>
          <input className="input" value={form.clusterLabel} onChange={event => set("clusterLabel")(event.target.value)} list="cluster-suggestions" placeholder="مثال: عنقود ٤" />
          <datalist id="cluster-suggestions">{clusters.map(item => <option key={item} value={item} />)}</datalist>
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}

function CreatedStep({ member, onClose }: { member: MemberSummary; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const message = loginMessage(member.name, member.email);

  const copy = async () => {
    if (await copyText(message)) { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
  };

  return (
    <Dialog
      title={`تمت إضافة ${member.name}`}
      description="أرسلي لها هذه الرسالة لتدخل حسابها:"
      onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={copy}>{copied ? <><Check /> تم النسخ</> : <><Copy /> نسخ</>}</button>
        <a className="btn btn-primary" href={whatsappLink(message, member.phone)} target="_blank" rel="noopener noreferrer"><MessageCircle /> إرسال واتساب</a>
      </>}
    >
      <div className="blk-copy-text">{message}</div>
      <Link href={`/district/team/${member.id}`} className="d-dialog-link" onClick={onClose}>فتح ملفها</Link>
    </Dialog>
  );
}
