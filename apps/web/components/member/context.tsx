"use client";

import type { DocumentInfo } from "@rasd/schemas";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, errorText, redirectIfSignedOut } from "../../lib/api";
import { enforceSessionOnly, supabase } from "../../lib/supabase";
import type { Me, VisitReport, Workspace } from "../../lib/types";

export type ToastAction = { label: string; run: () => void };
type Toast = { id: number; text: string; tone: "ok" | "info" | "error"; actions?: ToastAction[] };
export type SaveState = "idle" | "saving" | "saved" | "error";
export type Row = Record<string, unknown> & { updatedAt: string };

/**
 * One write to one server row. `send` builds the request when it runs (so it reads the latest state); jobs for
 * the same `key` run one after another, so each carries the version the previous one returned.
 */
export type SaveJob<T = Row> = {
  key: string;
  /** `force` skips the optimistic-concurrency check (she chose «استخدام قيمتي»). */
  send: (force: boolean) => Promise<T>;
  saved?: (row: T) => void;
  /** Someone else changed the row first: apply the server's copy («استخدام القيمة الجديدة»). */
  conflict?: (current: T) => void;
  /** The server refused the value: put the screen back as it was. */
  rejected?: () => void;
};

type Updater = (workspace: Workspace) => Workspace;

type MemberContextValue = {
  me: Me["user"];
  ws: Workspace;
  /** The latest workspace, also between renders (async steps read it). */
  current: () => Workspace;
  /** Changes the workspace locally right away. */
  update: (change: Updater) => void;
  reload: () => Promise<void>;
  documents: DocumentInfo[];
  setDocuments: (change: (documents: DocumentInfo[]) => DocumentInfo[]) => void;
  visits: VisitReport[];
  setVisits: (change: (visits: VisitReport[]) => VisitReport[]) => void;
  notify: (text: string, options?: { tone?: Toast["tone"]; actions?: ToastAction[] }) => void;
  /** Reports a failed action that is not a field save: session expiry → login; otherwise an error toast with retry. */
  fail: (error: unknown, retry?: () => void) => void;
  save: <T>(job: SaveJob<T>) => Promise<boolean>;
  /** Saves after she pauses typing; a later call for the same field replaces the earlier one. */
  schedule: <T>(field: string, job: () => SaveJob<T>, delay?: number) => void;
  /** Sends scheduled saves now (all of them, or one field's). */
  flush: (field?: string) => void;
  /** Sends everything and waits until the server answered (before signing out). */
  settle: () => Promise<void>;
  saveState: SaveState;
  retry: () => void;
};

export const MemberContext = createContext<MemberContextValue | null>(null);

export function useMember() {
  const value = useContext(MemberContext);
  if (!value) throw new Error("useMember must be used inside the member workspace");
  return value;
}

const isConflict = (error: unknown): error is ApiError => error instanceof ApiError && error.status === 409 && error.code === "CONFLICT";
const fieldMessage = (error: ApiError) => (error.fields ? Object.values(error.fields)[0] : error.message);

/** Loads her account and file, keeps them in sync with the server, and shows the toast. */
export function MemberProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me["user"] | null>(null);
  const [ws, setWsState] = useState<Workspace | null>(null);
  const [documents, setDocumentsState] = useState<DocumentInfo[]>([]);
  const [visits, setVisitsState] = useState<VisitReport[]>([]);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const wsRef = useRef<Workspace | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const chains = useRef(new Map<string, Promise<boolean>>());
  const timers = useRef(new Map<string, { timer: number; run: () => void }>());
  const failed = useRef(new Map<string, () => void>());
  const pending = useRef(0);
  /** The last answer was a conflict or a refusal: the header must not say «حُفظ» (the toast explains). */
  const unsaved = useRef(false);

  const busy = () => pending.current > 0 || timers.current.size > 0;
  const refreshState = useCallback(() => {
    setSaveState(failed.current.size ? "error" : busy() ? "saving" : unsaved.current ? "idle" : "saved");
  }, []);

  const update = useCallback((change: Updater) => {
    if (!wsRef.current) return;
    wsRef.current = change(wsRef.current);
    setWsState(wsRef.current);
  }, []);
  const replace = useCallback((next: Workspace) => { wsRef.current = next; setWsState(next); }, []);

  const notify = useCallback<MemberContextValue["notify"]>((text, options = {}) => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, tone: options.tone ?? "ok", actions: options.actions });
    toastTimer.current = window.setTimeout(() => setToast(null), options.actions?.length ? 8000 : 4000);
  }, []);

  const fail = useCallback<MemberContextValue["fail"]>((error, retry) => {
    if (redirectIfSignedOut(error)) return;
    notify(errorText(error), { tone: "error", actions: retry ? [{ label: "إعادة المحاولة", run: retry }] : undefined });
  }, [notify]);

  const save = useCallback(<T,>(job: SaveJob<T>, force = false): Promise<boolean> => {
    pending.current += 1;
    refreshState();
    const run = async () => {
      try {
        const row = await job.send(force);
        failed.current.delete(job.key);
        unsaved.current = false;
        job.saved?.(row);
        return true;
      } catch (error) {
        if (redirectIfSignedOut(error)) return false;
        failed.current.delete(job.key);
        if (isConflict(error)) {
          unsaved.current = true;
          const current = error.details?.current as T | undefined;
          notify(error.message, {
            tone: "info",
            actions: [
              { label: "استخدام قيمتي", run: () => void save(job, true) },
              ...(current && job.conflict ? [{ label: "استخدام القيمة الجديدة", run: () => job.conflict!(current) }] : []),
            ],
          });
          return false;
        }
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          unsaved.current = true;
          job.rejected?.();
          notify(fieldMessage(error), { tone: "error" });
          return false;
        }
        failed.current.set(job.key, () => void save(job, force)); // network or server error: keep it for «إعادة المحاولة»
        return false;
      } finally {
        pending.current -= 1;
        refreshState();
      }
    };
    const next = (chains.current.get(job.key) ?? Promise.resolve(true)).then(run, run);
    chains.current.set(job.key, next);
    return next;
  }, [notify, refreshState]);

  const schedule = useCallback(<T,>(field: string, job: () => SaveJob<T>, delay = 700) => {
    const existing = timers.current.get(field);
    if (existing) window.clearTimeout(existing.timer);
    const run = () => { timers.current.delete(field); void save(job()); };
    timers.current.set(field, { timer: window.setTimeout(run, delay), run });
    refreshState();
  }, [save, refreshState]);

  const flush = useCallback((field?: string) => {
    for (const [key, entry] of [...timers.current]) {
      if (field && key !== field) continue;
      window.clearTimeout(entry.timer);
      entry.run();
    }
  }, []);

  const settle = useCallback(async () => {
    flush();
    await Promise.all([...chains.current.values()]);
  }, [flush]);

  const retry = useCallback(() => {
    const jobs = [...failed.current.values()];
    failed.current.clear();
    refreshState();
    jobs.forEach(job => job());
  }, [refreshState]);

  const loadData = useCallback(async () => {
    const [workspace, docs, visitRows] = await Promise.all([
      api.get<Workspace>("/member/workspace"),
      api.get<DocumentInfo[]>("/cluster/me/documents"),
      api.get<VisitReport[]>("/cluster/me/visits"),
    ]);
    replace(workspace);
    setDocumentsState(docs);
    setVisitsState(visitRows);
  }, [replace]);

  const reload = useCallback(async () => {
    try { await loadData(); } catch (error) { fail(error); }
  }, [loadData, fail]);

  // Session (Supabase) → her account (role decides the home) → her file.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await enforceSessionOnly();
      const { data } = await supabase.auth.getSession();
      if (!data.session) { router.replace("/login"); return; }
      const { user } = await api.get<Me>("/auth/me");
      if (user.role === "head") { router.replace("/district"); return; }
      if (cancelled) return;
      setMe(user);
      await loadData();
    })().catch(error => { if (!cancelled && !redirectIfSignedOut(error)) setLoadError(errorText(error)); });
    const { data: listener } = supabase.auth.onAuthStateChange(event => { if (event === "SIGNED_OUT") router.replace("/login"); });
    return () => { cancelled = true; listener.subscription.unsubscribe(); };
  }, [router, loadData]);

  // Pull what changed elsewhere (رئيسة النطاق, her other device) when she comes back — never while she is typing or saving.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || !wsRef.current || busy() || failed.current.size) return;
      if (document.activeElement?.matches("input,textarea,select")) return;
      loadData().catch(() => { /* offline: try again next time */ });
    };
    const hidden = () => { if (document.visibilityState === "hidden") flush(); }; // switching apps on a phone sends what she typed
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("online", retry);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("online", retry);
    };
  }, [loadData, flush, retry]);

  // Warn before the tab closes while something is still on its way.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      flush();
      if (!busy() && !failed.current.size) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [flush]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const setDocuments = useCallback((change: (list: DocumentInfo[]) => DocumentInfo[]) => setDocumentsState(change), []);
  const setVisits = useCallback((change: (list: VisitReport[]) => VisitReport[]) => setVisitsState(change), []);
  const current = useCallback(() => wsRef.current!, []);

  const value = useMemo(() => (me && ws ? {
    me, ws, current, update, reload, documents, setDocuments, visits, setVisits, notify, fail, save, schedule, flush, settle, saveState, retry,
  } : null), [me, ws, current, update, reload, documents, setDocuments, visits, setVisits, notify, fail, save, schedule, flush, settle, saveState, retry]);

  if (loadError) {
    return (
      <div className="m-boot">
        <p>{loadError}</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>إعادة المحاولة</button>
      </div>
    );
  }
  if (!value) return <div className="m-boot"><span className="spinner" aria-hidden /><p>جارٍ فتح ملفك…</p></div>;

  return (
    <MemberContext.Provider value={value}>
      {children}
      {toast && (
        <div key={toast.id} className={`toast m-toast m-toast-${toast.tone}${toast.actions?.length ? " has-actions" : ""}`}
          role={toast.tone === "error" ? "alert" : "status"} aria-live="polite">
          <span className="m-toast-text">{toast.text}</span>
          {toast.actions?.map(action => (
            <button key={action.label} type="button" onClick={() => { setToast(null); action.run(); }}>{action.label}</button>
          ))}
          <button type="button" className="m-toast-x" onClick={() => setToast(null)} aria-label="إغلاق التنبيه"><X aria-hidden /></button>
        </div>
      )}
    </MemberContext.Provider>
  );
}
