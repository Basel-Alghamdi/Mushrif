"use client";

import { api } from "../../lib/api";
import { useMember } from "./context";

/** Optimistic delete with an 8-second undo toast; the server keeps soft-deleted rows so undo restores id and position. */
export function useRemove() {
  const { notify, fail, reload } = useMember();
  return async function remove({ text, apply, rollback, path }: { text: string; apply: () => void; rollback: () => void; path: string }) {
    apply();
    try {
      await api(path, { method: "DELETE" });
      notify(text, [{ label: "تراجع", run: () => { api(`${path}/restore`, { method: "POST", body: {} }).then(reload).catch(error => fail(error)); } }]);
    } catch (error) {
      rollback();
      fail(error);
    }
  };
}

/** Optimistic create with a client-generated id (safe to retry: the API treats a repeated id as the same row). */
export function useCreate() {
  const { fail } = useMember();
  return async function create<T>({ path, body, apply, rollback, then }: { path: string; body: Record<string, unknown>; apply: () => void; rollback: () => void; then?: (row: T) => void }) {
    apply();
    try { then?.(await api<T>(path, { method: "POST", body })); }
    catch (error) { rollback(); fail(error, () => create({ path, body, apply, rollback, then })); }
  };
}

export const replaceById = <T extends { id: string }>(items: T[], id: string, patch: Partial<T> | ((item: T) => T)) =>
  items.map(item => (item.id === id ? (typeof patch === "function" ? patch(item) : { ...item, ...patch }) : item));
