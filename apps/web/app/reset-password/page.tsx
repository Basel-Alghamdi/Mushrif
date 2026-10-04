"use client";

import { Check, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { ar } from "../../lib/format";
import { supabase } from "../../lib/supabase";
import "../login/login.css";

const MIN_PASSWORD = 8;

// Reached from the reset email: either ?token_hash=…&type=recovery (our Resend email) or a #access_token fragment
// (Supabase's built-in mailer, picked up automatically by supabase-js).
export default function ResetPasswordPage() {
  const [state, setState] = useState<"checking" | "ready" | "invalid" | "done">("checking");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);

  useEffect(() => {
    const tokenHash = new URLSearchParams(window.location.search).get("token_hash");
    const verify = tokenHash
      ? supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" }).then(({ error: verifyError }) => !verifyError)
      : supabase.auth.getSession().then(({ data }) => Boolean(data.session));
    verify.then(valid => setState(valid ? "ready" : "invalid")).catch(() => setState("invalid"));
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(password ? `اكتبي ${ar(MIN_PASSWORD)} أحرف أو أرقام على الأقل` : "اختاري كلمة مرور أولاً");
      return;
    }
    setError("");
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(updateError.message.includes("different") ? "اختاري كلمة مرور مختلفة عن السابقة" : "تعذّر تحديث كلمة المرور — أعيدي المحاولة");
      return;
    }
    await supabase.auth.signOut();
    setState("done");
  };

  return (
    <main className="lg lg-single">
      <section className="lg-main">
        <div className="lg-card">
          <div className="lg-brand"><span className="lg-mark">ر</span><b>رَصد</b></div>
          {state === "checking" && <div className="lg-checking"><span className="spinner" aria-hidden />جارٍ التحقق من الرابط…</div>}
          {state === "invalid" && (
            <div className="lg-stack">
              <div className="lg-title">
                <h1>الرابط غير صالح</h1>
                <p>انتهت صلاحية رابط الاستعادة أو سبق استخدامه. اطلبي رابطاً جديداً من صفحة الدخول.</p>
              </div>
              <a className="btn btn-secondary btn-lg btn-block" href="/login">صفحة الدخول</a>
            </div>
          )}
          {state === "done" && (
            <div className="lg-stack">
              <div className="lg-title">
                <h1>تم تحديث كلمة المرور</h1>
                <p>ادخلي الآن بكلمة المرور الجديدة.</p>
              </div>
              <a className="btn btn-primary btn-lg btn-block" href="/login">تسجيل الدخول</a>
            </div>
          )}
          {state === "ready" && (
            <form onSubmit={save} noValidate>
              <div className="lg-title">
                <h1>كلمة مرور جديدة</h1>
                <p>اختاري كلمة مرور لحسابك.</p>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="reset-password">كلمة المرور الجديدة</label>
                <div className="lg-password">
                  <input id="reset-password" className="input" type={show ? "text" : "password"} autoComplete="new-password" value={password}
                    placeholder={`${ar(MIN_PASSWORD)} أحرف أو أرقام على الأقل`} onChange={event => { setPassword(event.target.value); setError(""); }} />
                  <button type="button" className="lg-eye" onClick={() => setShow(value => !value)} aria-label={show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} aria-pressed={show}>
                    {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                  </button>
                </div>
              </div>
              {error && <p className="lg-error" role="alert">{error}</p>}
              <button className="btn btn-primary btn-lg btn-block" disabled={saving}>
                {saving ? <LoaderCircle className="lg-spin" aria-hidden /> : <Check aria-hidden />}
                {saving ? "جارٍ الحفظ…" : "حفظ كلمة المرور"}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
