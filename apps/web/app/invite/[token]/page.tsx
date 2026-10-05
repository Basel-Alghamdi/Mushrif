"use client";

import { Check, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { BrandMark } from "../../../components/brand/brand-mark";
import { api, ApiError, errorText } from "../../../lib/api";
import { ar } from "../../../lib/format";
import { rememberDevice, supabase } from "../../../lib/supabase";
import "../../login/login.css";

type Invitation = { name: string; email: string; clusterLabel: string; status: string; expiresAt: string };
const MIN_PASSWORD = 8;

/** main's invitation link: she chooses a password (and may add her phone), then lands in her file. */
export default function AcceptInvitationPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [show, setShow] = useState(false);

  useEffect(() => {
    api<Invitation>(`/public/invitations/${token}`, { auth: false })
      .then(setInvitation)
      .catch(reason => setError(errorText(reason)))
      .finally(() => setLoading(false));
  }, [token]);

  const accept = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(password ? `اكتبي ${ar(MIN_PASSWORD)} أحرف أو أرقام على الأقل` : "اختاري كلمة مرور أولاً");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { email } = await api<{ email: string }>(`/public/invitations/${token}/accept`, { method: "POST", auth: false, body: { password, phone } });
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) { router.replace("/login"); return; }
      rememberDevice(true);
      try { localStorage.setItem("rasd:lastEmail", email); } catch { /* private mode */ }
      router.replace("/cluster");
    } catch (reason) {
      setError(reason instanceof ApiError && reason.fields ? Object.values(reason.fields)[0] : errorText(reason));
      setSaving(false);
    }
  };

  return (
    <main className="lg lg-single">
      <section className="lg-main">
        <div className="lg-card">
          <div className="lg-brand"><BrandMark className="lg-mark" /><b>رَصد</b></div>
          {loading ? (
            <div className="lg-checking"><span className="spinner" aria-hidden />جارٍ التحقق من الدعوة…</div>
          ) : !invitation ? (
            <div className="lg-stack">
              <div className="lg-title"><h1>تعذّر فتح الدعوة</h1></div>
              {error && <p className="lg-error" role="alert">{error}</p>}
              <a className="btn btn-secondary btn-lg btn-block" href="/login">العودة لتسجيل الدخول</a>
            </div>
          ) : invitation.status !== "pending" ? (
            <div className="lg-stack">
              <div className="lg-title">
                <h1>الدعوة غير متاحة</h1>
                <p>انتهت صلاحية هذه الدعوة أو سبق استخدامها. اطلبي من رئيسة النطاق إعادة إرسالها، أو ادخلي ببريدك مباشرة.</p>
              </div>
              <a className="btn btn-primary btn-lg btn-block" href="/login">تسجيل الدخول</a>
            </div>
          ) : (
            <form onSubmit={accept} noValidate>
              <input type="email" name="username" autoComplete="username" value={invitation.email} readOnly hidden />
              <div className="lg-title">
                <h1>أهلاً {invitation.name}</h1>
                <p>اختاري كلمة مرور لحسابك{invitation.clusterLabel ? ` في ${invitation.clusterLabel}` : ""}.</p>
                <p className="lg-who"><bdi dir="ltr" className="lg-who-email">{invitation.email}</bdi></p>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="invite-password">كلمة المرور الجديدة</label>
                <div className="lg-password">
                  <input id="invite-password" className="input" type={show ? "text" : "password"} autoComplete="new-password" value={password}
                    placeholder={`${ar(MIN_PASSWORD)} أحرف أو أرقام على الأقل`} onChange={event => { setPassword(event.target.value); setError(""); }} />
                  <button type="button" className="lg-eye" onClick={() => setShow(value => !value)} aria-label={show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} aria-pressed={show}>
                    {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                  </button>
                </div>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="invite-phone">رقم الجوال <span className="lg-optional">(اختياري)</span></label>
                <input id="invite-phone" className="input" type="tel" inputMode="tel" dir="ltr" autoComplete="tel" value={phone} placeholder="مثال: 0551234567"
                  onChange={event => setPhone(event.target.value)} />
              </div>
              {error && <p className="lg-error" role="alert">{error}</p>}
              <button className="btn btn-primary btn-lg btn-block" disabled={saving}>
                {saving ? <LoaderCircle className="lg-spin" aria-hidden /> : <Check aria-hidden />}
                {saving ? "جارٍ إنشاء الحساب…" : "قبول الدعوة والدخول"}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
