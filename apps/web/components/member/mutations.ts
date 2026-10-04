"use client";

import { api } from "../../lib/api";
import type { Workspace } from "../../lib/types";
import { useMember } from "./context";

type Change = (workspace: Workspace) => Workspace;

/** Optimistic delete with an 8-second undo toast; the server keeps soft-deleted rows so undo restores id and position. */
export function useRemove() {
  const { update, notify, fail, reload } = useMember();
  return async function remove({ text, apply, rollback, path }: { text: string; apply: Change; rollback: Change; path: string }) {
    update(apply);
    try {
      await api.del(path);
      notify(text, { actions: [{ label: "تراجع", run: () => { api.post(`${path}/restore`).then(reload).catch(error => fail(error)); } }] });
    } catch (error) {
      update(rollback);
      fail(error);
    }
  };
}

/** Optimistic create with a client-generated id (safe to retry: the API treats a repeated id as the same row). */
export function useCreate() {
  const { update, fail } = useMember();
  return async function create<T>({ path, body, apply, rollback, then }: { path: string; body: Record<string, unknown>; apply: Change; rollback: Change; then?: (row: T) => void }): Promise<boolean> {
    update(apply);
    try {
      then?.(await api.post<T>(path, body));
      return true;
    } catch (error) {
      update(rollback);
      fail(error, () => void create({ path, body, apply, rollback, then }));
      return false;
    }
  };
}

export const replaceById = <T extends { id: string }>(items: T[], id: string, patch: Partial<T> | ((item: T) => T)) =>
  items.map(item => (item.id === id ? (typeof patch === "function" ? patch(item) : { ...item, ...patch }) : item));

/** Adds the version the row was loaded at, unless she chose to overwrite (EDITABILITY §1.5). */
export const withVersion = (body: Record<string, unknown>, updatedAt: string | undefined, force: boolean) =>
  force || !updatedAt ? body : { ...body, expectedUpdatedAt: updatedAt };
