"use client";

import type { DocumentInfo, PublicUser, Workspace, WorkspaceSaveInput } from "@rasd/schemas";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiRequestError } from "../../lib/api";

type SaveKey = "profile" | "schools" | "programs" | "sections";
const SAVE_KEYS: SaveKey[] = ["profile", "schools", "programs", "sections"];
const SAVE_DELAY = 600;
const RETRY_DELAY = 5000;

export type SaveState = "idle" | "saving" | "saved" | "error";
export type Toast = { id: number; text: string; tone: "ok" | "info" | "error" };

type WorkspaceContextValue = {
  user: PublicUser;
  workspace: Workspace;
  documents: DocumentInfo[];
  setDocuments: (update: (documents: DocumentInfo[]) => DocumentInfo[]) => void;
  /** Applies a change locally right away and saves it shortly after. */
  update: (mutator: (workspace: Workspace) => Workspace) => void;
  saveState: SaveState;
  /** Sends any pending edits now. Resolves false when the save failed. */
  flush: () => Promise<boolean>;
  retry: () => void;
  notify: (text: string, tone?: Toast["tone"]) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return value;
}

export function WorkspaceProvider({ initialUser, children }: { initialUser: PublicUser; children: ReactNode }) {
  const user = initialUser;
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [documents, setDocumentsState] = useState<DocumentInfo[]>([]);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [toast, setToast] = useState<Toast | null>(null);

  // The save queue lives in refs so every async step sees the latest values.
  const workspaceRef = useRef<Workspace | null>(null);
  const versionRef = useRef(0);
  const dirty = useRef(new Set<SaveKey>());
  const inFlight = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const waiters = useRef<((ok: boolean) => void)[]>([]);

  const pending = () => dirty.current.size > 0 || inFlight.current;

  const commit = useCallback((next: Workspace) => {
    workspaceRef.current = next;
    setWorkspace(next);
  }, []);

  /** Takes the server copy but keeps sections she is still editing locally. */
  const mergeServer = useCallback((server: Workspace): Workspace => {
    const local = workspaceRef.current;
    if (!local) return server;
    const merged: Workspace = { ...server };
    for (const key of SAVE_KEYS) if (dirty.current.has(key)) (merged[key] as unknown) = local[key];
    return merged;
  }, []);

  const notify = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);

  const resolveWaiters = (ok: boolean) => waiters.current.splice(0).forEach(resolve => resolve(ok));

  const schedule = useCallback((delay = SAVE_DELAY) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void pumpRef.current(), delay);
  }, []);

  // One PUT at a time; the next one uses the version returned by the previous one.
  const pump = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    if (inFlight.current) return;
    const local = workspaceRef.current;
    if (!local || !dirty.current.size) {
      resolveWaiters(true);
      return;
    }
    const keys = [...dirty.current];
    dirty.current.clear();
    const payload: WorkspaceSaveInput = { version: versionRef.current };
    for (const key of keys) (payload[key] as unknown) = local[key];

    inFlight.current = true;
    setSaveState("saving");
    try {
      const saved = await api.put<Workspace>("/member/workspace", payload);
      versionRef.current = saved.version;
      inFlight.current = false;
      commit(mergeServer(saved));
    } catch (error) {
      inFlight.current = false;
      if (error instanceof ApiRequestError && error.code === "STALE_WORKSPACE") {
        const current = error.payload?.error.current as Workspace | undefined;
        dirty.current.clear();
        if (current) {
          versionRef.current = current.version;
          commit(current);
        }
        setSaveState("saved");
        notify("تم تحديث ملفك من رئيسة النطاق — عرضنا أحدث نسخة", "info");
        resolveWaiters(true);
        return;
      }
      keys.forEach(key => dirty.current.add(key));
      setSaveState("error");
      resolveWaiters(false);
      schedule(RETRY_DELAY);
      return;
    }
    if (dirty.current.size) void pumpRef.current();
    else {
      setSaveState("saved");
      resolveWaiters(true);
    }
  }, [commit, mergeServer, notify, schedule]);

  const pumpRef = useRef(pump);
  pumpRef.current = pump;

  const update = useCallback((mutator: (workspace: Workspace) => Workspace) => {
    const previous = workspaceRef.current;
    if (!previous) return;
    const next = mutator(previous);
    if (next === previous) return;
    for (const key of SAVE_KEYS) if (next[key] !== previous[key]) dirty.current.add(key);
    commit(next);
    setSaveState("saving");
    schedule();
  }, [commit, schedule]);

  const flush = useCallback(() => {
    if (!pending()) return Promise.resolve(true);
    const done = new Promise<boolean>(resolve => waiters.current.push(resolve));
    if (!inFlight.current) void pumpRef.current();
    return done;
  }, []);

  const retry = useCallback(() => void pumpRef.current(), []);

  const setDocuments = useCallback((change: (documents: DocumentInfo[]) => DocumentInfo[]) => setDocumentsState(change), []);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get<Workspace>("/member/workspace"), api.get<DocumentInfo[]>("/member/documents")])
      .then(([loaded, docs]) => {
        if (cancelled) return;
        versionRef.current = loaded.version;
        commit(loaded);
        setDocumentsState(docs);
      })
      .catch(error => !cancelled && setLoadError((error as Error).message));
    return () => { cancelled = true; };
  }, [commit]);

  // Pull changes made elsewhere (e.g. by رئيسة النطاق) when she comes back to the tab.
  useEffect(() => {
    const refresh = async () => {
      if (document.visibilityState !== "visible" || pending() || !workspaceRef.current) return;
      try {
        const [fresh, docs] = await Promise.all([api.get<Workspace>("/member/workspace"), api.get<DocumentInfo[]>("/member/documents")]);
        setDocumentsState(docs);
        if (pending()) return;
        if (fresh.version !== versionRef.current) {
          versionRef.current = fresh.version;
          commit(fresh);
        }
      } catch { /* offline — try again next time */ }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [commit]);

  // Warn before closing the tab while a save is still on its way.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!pending()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => () => {
    window.clearTimeout(saveTimer.current);
    window.clearTimeout(toastTimer.current);
  }, []);

  const value = useMemo(() => workspace && ({
    user, workspace, documents, setDocuments, update, saveState, flush, retry, notify,
  }), [user, workspace, documents, setDocuments, update, saveState, flush, retry, notify]);

  if (loadError) {
    return (
      <div className="m-boot">
        <p>{loadError}</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>إعادة المحاولة</button>
      </div>
    );
  }
  if (!value) return <div className="m-boot"><span className="spinner" aria-hidden /><p>جارٍ تحميل ملفك…</p></div>;

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
      {toast && (
        <div key={toast.id} className={`toast m-toast m-toast-${toast.tone}`} role="status" aria-live="polite">
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} aria-label="إغلاق التنبيه">حسناً</button>
        </div>
      )}
    </WorkspaceContext.Provider>
  );
}
