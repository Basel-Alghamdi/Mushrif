"use client";

import type { AuthCheckResult, AuthSession, PublicUser, Role } from "@rasd/schemas";
import { Eye, EyeOff, Info, LoaderCircle, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiRequestError, getToken, setToken } from "../../lib/api";
import { firstName } from "../../lib/format";
import "./login.css";

type Step = "email" | "password" | "activate";

const homeFor = (role: Role) => (role === "head" ? "/district" : "/cluster");
const LAST_EMAIL = "rasd:lastEmail";

const readLastEmail = () => { try { return localStorage.getItem(LAST_EMAIL) ?? ""; } catch { return ""; } };
const saveLastEmail = (email: string) => { try { localStorage.setItem(LAST_EMAIL, email); } catch { /* private mode */ } };

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
  const [forgot, setForgot] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);

  // Signed in already → her home. Otherwise, if this device remembers her email, open straight on the password step.
  useEffect(() => {
    const resume = async () => {
      const last = readLastEmail();
      if (last) {
        setEmail(last);
        try {
          const result = await api.post<AuthCheckResult>("/auth/check", { email: last });
          if (result.exists) {
            setName(result.name ?? "");
            setStep(result.activated ? "password" : "activate");
          }
        } catch { /* stay on the email step */ }
      }
      setChecking(false);
    };
    if (!getToken()) {
      void resume();
      return;
    }
    api.get<{ user: PublicUser }>("/auth/me")
      .then(({ user }) => router.replace(homeFor(user.role)))
      .catch(() => {
        setToken(null);
        void resume();
      });
  }, [router]);

  useEffect(() => {
    if (checking) return;
    (step === "email" ? emailInput : passwordInput).current?.focus();
  }, [step, checking]);

  const goTo = (next: Step) => {
    setStep(next);
    setPassword("");
    setError("");
    setForgot(false);
  };

  const enter = (session: AuthSession) => {
    saveLastEmail(session.user.email);
    setToken(session.token);
    router.replace(homeFor(session.user.role));
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const checkEmail = (event: FormEvent) => {
    event.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value) {
      setError("اكتبي بريدك الإلكتروني أولاً");
      return;
    }
    void run(async () => {
      const result = await api.post<AuthCheckResult>("/auth/check", { email: value });
      if (!result.exists) {
        setError("هذا البريد غير مسجّل — تأكدي منه أو تواصلي مع رئيسة النطاق");
        return;
      }
      setEmail(value);
      setName(result.name ?? "");
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
    void run(async () => {
      try {
        enter(await api.post<AuthSession>("/auth/login", { email, password, remember }));
      } catch (reason) {
        if (!(reason instanceof ApiRequestError)) throw reason;
        if (reason.code === "NOT_ACTIVATED") return goTo("activate");
        if (reason.code === "ACCOUNT_NOT_FOUND") {
          goTo("email");
          throw reason;
        }
        if (reason.code === "INVALID_CREDENTIALS") throw new Error("كلمة المرور غير صحيحة — جرّبي مرة أخرى");
        throw reason;
      }
    });
  };

  const activate = (event: FormEvent) => {
    event.preventDefault();
    // The rule lives in the placeholder while the box is empty, and in the error once she typed too little — never both.
    if (password.length < 4) {
      setError(password ? "اكتبي ٤ أحرف أو أرقام على الأقل" : "اختاري كلمة مرور أولاً");
      return;
    }
    void run(async () => {
      try {
        enter(await api.post<AuthSession>("/auth/activate", { email, password }));
      } catch (reason) {
        if (reason instanceof ApiRequestError && reason.code === "ALREADY_ACTIVATED") {
          goTo("password");
          setNotice("حسابك مفعّل مسبقاً — ادخلي بكلمة المرور التي اخترتِها");
          return;
        }
        throw reason;
      }
    });
  };

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
            <span className="lg-mark">ر</span>
            <b>رَصد</b>
          </div>
          <h2>مساحة واحدة للفريق التنفيذي</h2>
          <p>المشرفات يحدّثن ملفاتهن ومدارسهن، ورئيسة النطاق تتابع كل شيء وتسأل المساعد الذكي عنه.</p>
        </div>
      </aside>

      <section className="lg-main">
        <div className="lg-card">
          <div className="lg-brand">
            <span className="lg-mark">ر</span>
            <b>رَصد</b>
          </div>

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
                <p>{step === "password" ? "اكتبي كلمة المرور للدخول." : "أول مرة تدخلين — اختاري كلمة مرور لحسابك."}</p>
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
                    placeholder={step === "activate" ? "٤ أحرف أو أرقام على الأقل" : undefined}
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
                  <button type="button" className="lg-link" onClick={() => setForgot(value => !value)} aria-expanded={forgot}>نسيتِ كلمة المرور؟</button>
                  {forgot && (
                    <p className="lg-notice">
                      <Lock aria-hidden />
                      تواصلي مع رئيسة النطاق لتعيد تعيين كلمة مرورك، ثم ادخلي ببريدك واختاري كلمة مرور جديدة.
                    </p>
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
