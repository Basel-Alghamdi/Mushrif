"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../lib/api";

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";
type Task = () => Promise<void>;

const DEBOUNCE_MS = 700;

/** 409 CONFLICT from main's optimistic concurrency (expectedUpdatedAt): the row as it is now on the server. */
export function conflictRow<T>(error: unknown): T | null {
  return error instanceof ApiError && error.status === 409 && error.code === "CONFLICT" ? (error.details?.current as T | undefined) ?? null : null;
}

/**
 * Debounced saves, one queue per key (a row): a key never has two requests in flight, so each request carries the
 * updatedAt of the previous answer. Failed saves stay in the indicator with a retry; `onError` reports the reason.
 */
export function useSaver(onError: (error: unknown) => void) {
  const timers = useRef(new Map<string, number>());
  const queued = useRef(new Map<string, Task>());
  const running = useRef(new Set<string>());
  const failed = useRef(new Map<string, Task>());
  const report = useRef(onError);
  report.current = onError;
  const [, setTick] = useState(0);
  const bump = () => setTick(value => value + 1);

  const run = useCallback(async (key: string) => {
    const task = queued.current.get(key);
    if (!task || running.current.has(key)) return;
    queued.current.delete(key);
    running.current.add(key);
    bump();
    try {
      await task();
    } catch (error) {
      failed.current.set(key, task);
      report.current(error);
    } finally {
      running.current.delete(key);
      // A newer edit arrived while this one was saving: send it now (its timer already fired).
      if (queued.current.has(key) && !timers.current.has(key)) void run(key);
      bump();
    }
  }, []);

  const schedule = useCallback((key: string, task: Task, delay = DEBOUNCE_MS) => {
    window.clearTimeout(timers.current.get(key));
    failed.current.delete(key);
    queued.current.set(key, task);
    timers.current.set(key, window.setTimeout(() => { timers.current.delete(key); void run(key); }, delay));
    bump();
  }, [run]);

  const retry = useCallback(() => {
    for (const [key, task] of failed.current) schedule(key, task, 0);
  }, [schedule]);

  // Leaving the page sends what is still waiting for its debounce.
  useEffect(() => () => {
    for (const [key, timer] of timers.current) { window.clearTimeout(timer); timers.current.delete(key); void run(key); }
  }, [run]);

  const busy = timers.current.size > 0 || running.current.size > 0;
  const state: SaveState = failed.current.size ? "error" : running.current.size ? "saving" : busy ? "pending" : "idle";
  // «حُفظ» after a save finished; the indicator hides it again after a moment.
  const [saved, setSaved] = useState(false);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (busy) { wasBusy.current = true; setSaved(false); return; }
    if (wasBusy.current && !failed.current.size) { wasBusy.current = false; setSaved(true); }
  }, [busy]);

  return useMemo(() => ({ schedule, retry, state: state === "idle" && saved ? "saved" as const : state }), [schedule, retry, state, saved]);
}
