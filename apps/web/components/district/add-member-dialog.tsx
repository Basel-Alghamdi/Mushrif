"use client";

import type { MemberCreateInput } from "@rasd/schemas";
import { Check, Copy, Mail, UserPlus } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { api, ApiError, errorText } from "../../lib/api";
import { copyText, loginMessage } from "../../lib/chat/helpers";
import { useSendMessages } from "../../lib/send-messages";
import type { MemberSummary } from "../../lib/types";
import { Dialog } from "./dialog";
import { TITLE_SUGGESTIONS } from "./model";

type Props = { onClose: () => void; onCreated: (member: MemberSummary) => void; clusters: string[] };

/** POST /district/members: her account is ready at once; the first time she signs in she chooses her password. */
export function AddMemberDialog({ onClose, onCreated, clusters }: Props) {
  const [form, setForm] = useState({ name: "", email: "", title: "", clusterLabel: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<MemberSummary | null>(null);

  const set = (key: keyof typeof form) => (value: string) => setForm(state => ({ ...state, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setFields({});
    try {
      const input: MemberCreateInput = { name: form.name.trim(), email: form.email.trim(), title: form.title.trim(), clusterLabel: form.clusterLabel.trim() };
      const member = await api.post<MemberSummary>("/district/members", input);
      setCreated(member);
      onCreated(member);
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === "ACCOUNT_EXISTS") setFields({ email: reason.message });
      else if (reason instanceof ApiError && reason.fields) setFields(reason.fields);
      else setError(errorText(reason));
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
      <form id="add-member-form" className="d-form" onSubmit={submit} noValidate>
        <label className="field">
          <span className="field-label">الاسم</span>
          <input className="input" value={form.name} onChange={event => set("name")(event.target.value)} placeholder="مثال: نورة محمد العتيبي" autoComplete="off" maxLength={200} aria-invalid={Boolean(fields.name) || undefined} />
          {fields.name && <span className="field-error">{fields.name}</span>}
        </label>
        <label className="field">
          <span className="field-label">البريد الذي ستدخل به</span>
          <input className="input" value={form.email} onChange={event => set("email")(event.target.value)} placeholder="مثال: name@gmail.com" dir="ltr" inputMode="email" autoComplete="off" aria-invalid={Boolean(fields.email) || undefined} />
          {fields.email && <span className="field-error">{fields.email}</span>}
        </label>
        <label className="field">
          <span className="field-label">الصفة</span>
          <input className="input" value={form.title} onChange={event => set("title")(event.target.value)} list="title-suggestions" placeholder="اختاري أو اكتبي" maxLength={200} />
          <datalist id="title-suggestions">{TITLE_SUGGESTIONS.map(item => <option key={item} value={item} />)}</datalist>
        </label>
        <label className="field">
          <span className="field-label">العنقود <small className="field-hint">(اختياري)</small></span>
          <input className="input" value={form.clusterLabel} onChange={event => set("clusterLabel")(event.target.value)} list="cluster-suggestions" placeholder="مثال: عنقود ٤" maxLength={200} />
          <datalist id="cluster-suggestions">{clusters.map(item => <option key={item} value={item} />)}</datalist>
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}

function CreatedStep({ member, onClose }: { member: MemberSummary; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const email = useSendMessages();
  const message = loginMessage(member.name, member.email);

  const copy = async () => {
    if (await copyText(message)) { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
  };

  return (
    <Dialog
      title={`تمت إضافة ${member.name}`}
      description={`أرسلي لها هذه الرسالة على بريدها (${member.email}) لتدخل حسابها:`}
      onClose={onClose}
      footer={<>
        <button className="btn btn-secondary" onClick={copy}>{copied ? <><Check /> تم النسخ</> : <><Copy /> نسخ</>}</button>
        <button className="btn btn-primary" onClick={() => void email.send({ kind: "login", messages: [{ memberId: member.id, body: message }] })} disabled={email.busy || email.status === "sent"}>
          {email.busy ? <span className="spinner spinner-light" /> : email.status === "sent" ? <Check /> : <Mail />}
          {email.status === "sent" ? " أُرسلت" : " إرسال لبريدها"}
        </button>
      </>}
    >
      <div className="blk-copy-text">{message}</div>
      {email.note && <p className={`blk-send-note is-${email.status}`} role="status">{email.note}</p>}
      <Link href={`/district/team/${member.id}`} className="d-dialog-link" onClick={onClose}>فتح ملفها</Link>
    </Dialog>
  );
}
