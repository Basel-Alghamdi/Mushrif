"use client";

import type { AuthCheckResult } from "@rasd/schemas";
import { Eye, EyeOff, Info, LoaderCircle, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { BrandMark } from "../../components/brand/brand-mark";
import { api, ApiError, errorText } from "../../lib/api";
import { ar, firstName } from "../../lib/format";
import { enforceSessionOnly, rememberDevice, supabase, supabaseConfigured } from "../../lib/supabase";
import type { Me } from "../../lib/types";
import "./login.css";

type Step = "email" | "password" | "activate";

const MIN_PASSWORD = 8; // also enforced by the API
const LAST_EMAIL = "rasd:lastEmail";
const LAST_NAME = "rasd:lastName"; // remembered on this device after she signs in (the API never reveals names)
const homeFor = (role: Me["user"]["role"]) => (role === "head" ? "/district" : "/cluster");

const readLastEmail = () => { try { return localStorage.getItem(LAST_EMAIL) ?? ""; } catch { return ""; } };
const saveLastEmail = (email: string) => { try { localStorage.setItem(LAST_EMAIL, email); } catch { /* private mode */ } };
const readLastName = (email: string) => { try { return readLastEmail() === email ? localStorage.getItem(LAST_NAME) ?? "" : ""; } catch { return ""; } };
const saveLastName = (name: string) => { try { localStorage.setItem(LAST_NAME, name); } catch { /* private mode */ } };

const check = (email: string) => api<AuthCheckResult>("/public/auth/check", { method: "POST", body: { email }, auth: false });

/** Email first. Activated → password (Supabase sign-in); first time → she chooses a password (POST /public/auth/activate). */
export default function LoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState<"closed" | "open" | "sent">("closed");
  const passwordInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);

  // Signed in already → her home. Otherwise, if this device remembers her email, open straight on the password step.
  useEffect(() => {
    const resume = async () => {
      const last = readLastEmail();
      if (last) {
        setEmail(last);
        try {
          const result = await check(last);
          if (result.exists) {
            setName(readLastName(last));
            setStep(result.activated ? "password" : "activate");
          }
        } catch { /* stay on the email step */ }
      }
      setChecking(false);
    };
    (async () => {
      await enforceSessionOnly();
      const { data } = await supabase.auth.getSession();
      if (!data.session) return resume();
      try {
        const { user } = await api.get<Me>("/auth/me");
        router.replace(homeFor(user.role));
      } catch {
        await supabase.auth.signOut().catch(() => {});
        await resume();
      }
    })();
  }, [router]);

  useEffect(() => {
    if (checking) return;
    (step === "email" ? emailInput : passwordInput).current?.focus();
  }, [step, checking]);

  const goTo = (next: Step) => {
    setStep(next);
    setPassword("");
    setError("");
    setForgot("closed");
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  /** Supabase session → her role decides where she lands. */
  const enter = async (address: string, secret: string) => {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: address, password: secret });
    if (signInError) {
      throw new Error(signInError.message.toLowerCase().includes("invalid") ? "كلمة المرور غير صحيحة — جرّبي مرة أخرى" : "تعذّر الدخول — أعيدي المحاولة");
    }
    rememberDevice(remember);
    saveLastEmail(address);
    const { user } = await api.get<Me>("/auth/me");
    saveLastName(user.name);
    router.replace(homeFor(user.role));
  };

  const checkEmail = (event: FormEvent) => {
    event.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value) {
      setError("اكتبي بريدك الإلكتروني أولاً");
      return;
    }
    void run(async () => {
      const result = await check(value);
      if (!result.exists) {
        setError("هذا البريد غير مسجّل — تأكدي منه أو تواصلي مع رئيسة النطاق");
        return;
      }
      setEmail(value);
      setName(readLastName(value));
      setNotice("");
      goTo(result.activated ? "password" : "activate");
    });
  };

  const login = (event: FormEvent) => {
    event.preventDefault();
    if (!password) {
      setError("اكتبي كلمة المرور");
      return;
    }
    void run(() => enter(email, password));
  };

  const activate = (event: FormEvent) => {
    event.preventDefault();
    // The rule lives in the placeholder while the box is empty, and in the error once she typed too little — never both.
    if (password.length < MIN_PASSWORD) {
      setError(password ? `اكتبي ${ar(MIN_PASSWORD)} أحرف أو أرقام على الأقل` : "اختاري كلمة مرور أولاً");
      return;
    }
    void run(async () => {
      try {
        await api("/public/auth/activate", { method: "POST", body: { email, password }, auth: false });
      } catch (reason) {
        if (reason instanceof ApiError && reason.code === "ALREADY_ACTIVATED") {
          goTo("password");
          setNotice("حسابك مفعّل مسبقاً — ادخلي بكلمة المرور التي اخترتِها");
          return;
        }
        if (reason instanceof ApiError && reason.fields?.password) throw new Error(reason.fields.password);
        throw reason;
      }
      await enter(email, password);
    });
  };

  const sendReset = () => void run(async () => {
    await api("/public/auth/forgot-password", { method: "POST", body: { email }, auth: false });
    setForgot("sent");
  });

  const changeEmail = () => {
    goTo("email");
    setNotice("");
    setName("");
  };

  const first = firstName(name || "");

  return (
    <main className="lg">
      <aside className="lg-panel">
        <div className="lg-panel-inner">
          <div className="lg-brand lg-brand-light">
            <BrandMark className="lg-mark" />
            <b>رَصد</b>
          </div>
          <h2>مساحة واحدة للفريق التنفيذي</h2>
          <p>المشرفات يحدّثن ملفاتهن ومدارسهن، ورئيسة النطاق تتابع كل شيء وتسأل المساعد الذكي عنه.</p>
        </div>
      </aside>

      <section className="lg-main">
        <div className="lg-card">
          <div className="lg-brand">
            <BrandMark className="lg-mark" />
            <b>رَصد</b>
          </div>

          {!supabaseConfigured && <p className="lg-error" role="alert">إعدادات الدخول غير مكتملة على هذا الخادم.</p>}

          {checking ? (
            <div className="lg-checking"><span className="spinner" aria-hidden />جارٍ التحقق…</div>
          ) : step === "email" ? (
            <form onSubmit={checkEmail} noValidate>
              <div className="lg-title">
                <h1>تسجيل الدخول</h1>
                <p>اكتبي بريدك المسجّل لدى رئيسة النطاق.</p>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="login-email">البريد الإلكتروني</label>
                <input ref={emailInput} id="login-email" className="input" type="email" inputMode="email" dir="ltr" autoComplete="username"
                  autoCapitalize="none" spellCheck={false} placeholder="مثال: name@gmail.com" value={email}
                  onChange={event => { setEmail(event.target.value); setError(""); }} aria-invalid={Boolean(error)} aria-describedby={error ? "login-error" : undefined} />
              </div>
              {error && <p id="login-error" className="lg-error" role="alert">{error}</p>}
              <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
                {busy && <LoaderCircle className="lg-spin" aria-hidden />}متابعة
              </button>
            </form>
          ) : (
            <form onSubmit={step === "password" ? login : activate} noValidate>
              <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
              <div className="lg-title">
                <h1>{first ? `أهلاً ${first}` : "أهلاً بك"}</h1>
                {/* A remembered name means she signed in here before: after a reset it is not her first time. */}
                <p>{step === "password" ? "اكتبي كلمة المرور للدخول." : name ? "اختاري كلمة مرور جديدة لحسابك." : "أول مرة تدخلين — اختاري كلمة مرور لحسابك."}</p>
                <p className="lg-who">
                  <bdi dir="ltr" className="lg-who-email">{email}</bdi>
                  <button type="button" className="lg-link" onClick={changeEmail}>{first ? `لستِ ${first}؟ غيّري البريد` : "غيّري البريد"}</button>
                </p>
              </div>
              {notice && <p className="lg-notice" role="status"><Info aria-hidden />{notice}</p>}

              <div className="field">
                <label className="field-label" htmlFor="login-password">{step === "password" ? "كلمة المرور" : "كلمة المرور الجديدة"}</label>
                <div className="lg-password">
                  <input ref={passwordInput} id="login-password" className="input" type={showPassword ? "text" : "password"}
                    autoComplete={step === "password" ? "current-password" : "new-password"} value={password}
                    placeholder={step === "activate" ? `${ar(MIN_PASSWORD)} أحرف أو أرقام على الأقل` : undefined}
                    onChange={event => { setPassword(event.target.value); setError(""); }}
                    aria-invalid={Boolean(error)} aria-describedby={error ? "login-error" : undefined} />
                  <button type="button" className="lg-eye" onClick={() => setShowPassword(value => !value)}
                    aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} aria-pressed={showPassword}>
                    {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                  </button>
                </div>
              </div>

              {step === "password" && (
                <label className="lg-remember">
                  <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />
                  <span>تذكّريني على هذا الجهاز</span>
                </label>
              )}

              {error && <p id="login-error" className="lg-error" role="alert">{error}</p>}
              <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
                {busy && <LoaderCircle className="lg-spin" aria-hidden />}
                {step === "password" ? "دخول" : "حفظ كلمة المرور والدخول"}
              </button>

              {step === "password" && (
                <div className="lg-forgot">
                  <button type="button" className="lg-link" onClick={() => setForgot(value => (value === "closed" ? "open" : "closed"))} aria-expanded={forgot !== "closed"}>
                    نسيتِ كلمة المرور؟
                  </button>
                  {forgot === "open" && (
                    <>
                      <p className="lg-notice"><Lock aria-hidden />رئيسة النطاق تستطيع إعادة تعيين كلمة مرورك، ثم تختارين كلمة جديدة عند الدخول.</p>
                      <button type="button" className="lg-link" onClick={sendReset} disabled={busy}>أو أرسلي لي رابطاً على بريدي</button>
                    </>
                  )}
                  {forgot === "sent" && (
                    <p className="lg-notice" role="status"><Info aria-hidden />إن كان بريدك مسجّلاً فسيصلك رابط لتعيين كلمة مرور جديدة.</p>
                  )}
                </div>
              )}
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
