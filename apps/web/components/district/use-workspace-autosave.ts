"use client";

import type { Workspace } from "@rasd/schemas";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiRequestError } from "../../lib/api";

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 700;
const RETRY_MS = 5000;

/**
 * Local copy of a member's workspace that saves itself (debounced, one request at a time).
 * On 409 the server's latest copy replaces local state and `onConflict` is called.
 */
export function useWorkspaceAutosave(memberId: string, initial: Workspace, onConflict: () => void) {
  const [workspace, setWorkspace] = useState(initial);
  const [state, setState] = useState<SaveState>("idle");
  const latest = useRef(initial);
  const version = useRef(initial.version);
  const dirty = useRef(false);
  const saving = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const conflict = useRef(onConflict);
  conflict.current = onConflict;

  const commit = (next: Workspace) => { latest.current = next; setWorkspace(next); };

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (saving.current || !dirty.current) return;
    saving.current = true;
    dirty.current = false;
    setState("saving");
    const snapshot = latest.current;
    let retryLater = false;
    try {
      const saved = await api.put<Workspace>(`/district/members/${memberId}/workspace`, {
        version: version.current, profile: snapshot.profile, schools: snapshot.schools, programs: snapshot.programs, sections: snapshot.sections,
      });
      version.current = saved.version;
      // If she kept typing while this request was out, keep her edits and only take the server-computed parts.
      commit(dirty.current ? { ...latest.current, version: saved.version, completion: saved.completion, missing: saved.missing } : saved);
      setState(dirty.current ? "pending" : "saved");
    } catch (error) {
      const failure = error as ApiRequestError;
      const current = failure.status === 409 ? failure.payload?.error.current as Workspace | undefined : undefined;
      if (current) {
        version.current = current.version;
        dirty.current = false;
        commit(current);
        setState("saved");
        conflict.current();
      } else {
        dirty.current = true;
        retryLater = true;
        setState("error");
      }
    } finally {
      saving.current = false;
      if (dirty.current) timer.current = window.setTimeout(() => void flush(), retryLater ? RETRY_MS : DEBOUNCE_MS);
    }
  }, [memberId]);

  const update = useCallback((mutate: (current: Workspace) => Workspace) => {
    commit(mutate(latest.current));
    dirty.current = true;
    setState("pending");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), DEBOUNCE_MS);
  }, [flush]);

  /** Takes a fresher copy from the server (e.g. after a file upload) without dropping unsaved edits. */
  const absorb = useCallback((fresh: Workspace) => {
    if (dirty.current || saving.current) {
      commit({ ...latest.current, completion: fresh.completion, missing: fresh.missing });
      return;
    }
    version.current = fresh.version;
    commit(fresh);
  }, []);

  // Save whatever is left when she leaves the page.
  useEffect(() => () => { if (dirty.current) void flush(); }, [flush]);

  return { workspace, state, update, absorb, retry: flush };
}
