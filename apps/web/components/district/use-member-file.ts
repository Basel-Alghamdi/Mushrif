"use client";

import { useCallback, useRef, useState } from "react";
import { api, ApiError, errorText, redirectIfSignedOut } from "../../lib/api";
import type { LabelValue, LeadershipRole, ProfileField, School, StaffTile, Workspace } from "../../lib/types";
import { isPrincipalRole, NAME_LABEL, PRINCIPAL_ROLE, principalName, principalRole, type Row, TEACHERS_TILE, teachersTile, uuid, withDerived } from "./model";
import { useToast } from "./toast";
import { conflictRow, useSaver } from "./use-saver";

type Evaluation = NonNullable<School["evaluation"]>;
export type EvaluationChange = Partial<Pick<Evaluation, "supportType" | "nafesValue" | "qudrat" | "tahsili">>;
export type DisciplineChange = Partial<Pick<School["discipline"], "daily" | "weekly" | "monthly">>;
/** School columns the head edits through PATCH /district/members/:id/schools/:schoolId. */
export type SchoolChange = Partial<Pick<School, "name" | "stage" | "area" | "ministryNo" | "ministryEmail" | "educationType" | "classes" | "students" | "tier">>;
const SCHOOL_COLUMNS = ["name", "stage", "area", "ministryNo", "ministryEmail", "educationType", "specialEdProgram", "hasGuard", "classes", "students", "giftedClasses", "giftedStudents", "teachesChinese", "tier"] as const;

const LOCAL = "local-";
const isLocal = (id: string) => id.startsWith(LOCAL);
const localId = () => `${LOCAL}${uuid()}`;
/** The server id a local row is created with (stable, so a retried create is answered with the same row). */
const serverId = (id: string) => id.slice(LOCAL.length);
const insertAt = <T>(list: T[], index: number, item: T) => [...list.slice(0, index), item, ...list.slice(index)];

const EMPTY_EVALUATION: Evaluation = {
  supportType: "", nafesValue: null, nafesDirection: "", nafesDelta: "", qudrat: null, tahsili: null, externalReportUrl: "", externalReportStatus: "", importedAt: null,
};

const toField = (row: Row): ProfileField => ({
  id: row.id, key: (row.fieldKey as string | null) ?? null, label: String(row.label), value: String(row.value ?? ""), span: Number(row.span) === 2 ? 2 : 1,
  type: (row.fieldType as ProfileField["type"]) ?? "text", options: (row.options as string[] | null) ?? [], updatedAt: row.updatedAt,
});
const toLabelValue = (row: Row): LabelValue => ({ id: row.id, label: String(row.label), value: String(row.value ?? ""), updatedAt: row.updatedAt });
const toTile = (row: Row): StaffTile => ({ id: row.id, label: String(row.label), value: Number(row.value ?? 0), updatedAt: row.updatedAt });
const schoolColumns = (row: Row) => Object.fromEntries(SCHOOL_COLUMNS.filter(key => key in row).map(key => [key, row[key]])) as Partial<School>;

function blankSchool(id: string, name: string): School {
  return {
    id, name, stage: "", area: "", ministryNo: "", ministryEmail: "", educationType: "", specialEdProgram: "", hasGuard: false, classes: 0, students: 0,
    giftedClasses: 0, giftedStudents: 0, teachesChinese: false, tier: null, updatedAt: new Date().toISOString(), evaluation: null,
    madrasati: [0, 0, 0, 0, 0, 0], discipline: { daily: 0, weekly: 0, monthly: 0, planStatus: "missing", planUrl: "" },
    absenceToday: false, visitCount: 0, customFields: [], staffTiles: [], leadership: [],
  };
}

/**
 * The head's editable copy of one member's file. Every edit shows at once and saves through main's head mirror routes
 * (/district/members/:memberId/...) with expectedUpdatedAt; a 409 CONFLICT takes the server's current row and says so.
 */
export function useMemberFile(memberId: string, initial: Workspace) {
  const toast = useToast();
  const base = `/district/members/${memberId}`;
  const [workspace, setWorkspace] = useState(() => withDerived(initial));
  const latest = useRef(workspace);
  const commit = useCallback((update: (current: Workspace) => Workspace) => {
    latest.current = withDerived(update(latest.current));
    setWorkspace(latest.current);
  }, []);
  const saver = useSaver(error => { if (!redirectIfSignedOut(error)) toast(errorText(error)); });
  const { schedule } = saver;
  /** main's conflict rule: show the newer copy, and offer to put back what she typed (saved over it with the new version). */
  const conflictNotice = useCallback((keepMine?: () => void) =>
    toast("عُدّلت هذه البيانات للتو من جهاز آخر — عرضنا أحدث نسخة", keepMine ? { label: "إبقاء ما كتبتِه", run: keepMine } : undefined), [toast]);
  /** Schools still being created: their edits wait for the row to exist. */
  const creating = useRef(new Map<string, Promise<unknown>>());
  const dirty = useRef(new Map<string, Set<string>>());
  /** Values the server refused (e.g. a ministry number another school already has), keyed "schoolId:field". */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const school = (id: string) => latest.current.schools.find(item => item.id === id);
  const mapSchool = useCallback((id: string, update: (school: School) => School) =>
    commit(current => ({ ...current, schools: current.schools.map(item => item.id === id ? update(item) : item) })), [commit]);
  const markDirty = (key: string, fields: string[]) => {
    const set = dirty.current.get(key) ?? new Set<string>();
    for (const field of fields) set.add(field);
    dirty.current.set(key, set);
  };
  /** Takes the dirty fields of a row; on failure they go back so the retry sends them again. */
  const takeDirty = (key: string) => {
    const set = dirty.current.get(key) ?? new Set<string>();
    dirty.current.delete(key);
    return { fields: [...set], restore: () => markDirty(key, [...set]) };
  };

  // ───────── profile fields ─────────
  const setField = useCallback((id: string, value: string) => {
    commit(current => ({ ...current, profile: current.profile.map(field => field.id === id ? { ...field, value } : field) }));
    schedule(`field:${id}`, async () => {
      const field = latest.current.profile.find(item => item.id === id);
      if (!field) return;
      try {
        const row = await api.patch<Row>(`${base}/profile-fields/${id}`, { value: field.value, expectedUpdatedAt: field.updatedAt });
        commit(current => ({ ...current, profile: current.profile.map(item => item.id === id ? { ...item, updatedAt: row.updatedAt } : item) }));
      } catch (error) {
        const row = conflictRow<Row>(error);
        if (!row) throw error;
        commit(current => ({ ...current, profile: current.profile.map(item => item.id === id ? { ...item, value: String(row.value ?? ""), updatedAt: row.updatedAt } : item) }));
        const mine = field.value;
        conflictNotice(mine !== String(row.value ?? "") ? () => setField(id, mine) : undefined);
      }
    });
  }, [base, commit, conflictNotice, schedule]);

  const addField = useCallback(async (label: string, value: string) => {
    const id = uuid();
    commit(current => ({ ...current, profile: [...current.profile, { id, key: null, label, value, span: 1, type: "text", options: [], updatedAt: new Date().toISOString() }] }));
    try {
      const row = await api.post<Row>(`${base}/profile-fields`, { id, label, value });
      commit(current => ({ ...current, profile: current.profile.map(item => item.id === id ? toField(row) : item) }));
    } catch (error) {
      commit(current => ({ ...current, profile: current.profile.filter(item => item.id !== id) }));
      throw error;
    }
  }, [base, commit]);

  const removeField = useCallback(async (id: string) => {
    const index = latest.current.profile.findIndex(item => item.id === id);
    const removed = latest.current.profile[index];
    if (!removed) return;
    commit(current => ({ ...current, profile: current.profile.filter(item => item.id !== id) }));
    try {
      await api.del(`${base}/profile-fields/${id}`);
    } catch (error) {
      commit(current => ({ ...current, profile: insertAt(current.profile, index, removed) }));
      throw error;
    }
    toast(`حُذفت خانة «${removed.label}»`, {
      label: "تراجع",
      run: () => {
        api.post<Row>(`${base}/profile-fields/${id}/restore`)
          .then(row => commit(current => ({ ...current, profile: insertAt(current.profile, index, toField(row)) })))
          .catch(reason => toast(errorText(reason)));
      },
    });
  }, [base, commit, toast]);

  // ───────── schools ─────────
  const addSchool = useCallback(async (name: string) => {
    const id = uuid();
    commit(current => ({ ...current, schools: [...current.schools, blankSchool(id, name)] }));
    const created = (async () => {
      const row = await api.post<Row>(`${base}/schools`, { id, name });
      // The server starts every school with its staff tiles and a principal role (main's defaults).
      const [tiles, roles] = await Promise.all([api.get<Row[]>(`${base}/schools/${id}/staff-tiles`), api.get<Row[]>(`${base}/schools/${id}/leadership`)]);
      const leadership: LeadershipRole[] = await Promise.all(roles.map(async role => ({
        id: role.id, role: String(role.role), state: String(role.state ?? ""), updatedAt: role.updatedAt,
        fields: (await api.get<Row[]>(`${base}/leadership/${role.id}/fields`)).map(toLabelValue),
      })));
      // Keep what she typed meanwhile: the principal's name and the teachers go onto the server's rows (their saves follow).
      mapSchool(id, item => {
        const typedName = principalName(item);
        const typedTeachers = teachersTile(item);
        const serverRole = leadership.find(isPrincipalRole);
        let roles = leadership;
        if (typedName && serverRole) {
          const hasName = serverRole.fields.some(field => field.label.trim() === NAME_LABEL);
          const fields = hasName
            ? serverRole.fields.map(field => field.label.trim() === NAME_LABEL ? { ...field, value: typedName } : field)
            : [{ id: localId(), label: NAME_LABEL, value: typedName, updatedAt: "" }, ...serverRole.fields];
          roles = leadership.map(role => role.id === serverRole.id ? { ...role, fields } : role);
        } else if (typedName) {
          roles = [...item.leadership.filter(role => isLocal(role.id)), ...leadership];
        }
        let staffTiles = tiles.map(toTile);
        if (typedTeachers) {
          const serverTile = staffTiles.find(tile => tile.label.trim() === TEACHERS_TILE);
          staffTiles = serverTile ? staffTiles.map(tile => tile.id === serverTile.id ? { ...tile, value: typedTeachers.value } : tile) : [typedTeachers, ...staffTiles];
        }
        return { ...item, updatedAt: row.updatedAt, staffTiles, leadership: roles };
      });
    })();
    creating.current.set(id, created.catch(() => undefined));
    try {
      await created;
    } catch (error) {
      commit(current => ({ ...current, schools: current.schools.filter(item => item.id !== id) }));
      throw error;
    } finally {
      creating.current.delete(id);
    }
    return id;
  }, [base, commit, mapSchool]);

  /** Saves the dirty columns of one school in one PATCH. A refused column is shown at its field and the others still save. */
  const schoolTask = (id: string) => async () => {
    await creating.current.get(id);
    const { fields, restore } = takeDirty(`school:${id}`);
    const current = school(id);
    if (!fields.length || !current) return;
    const body = Object.fromEntries(fields.map(key => [key, current[key as keyof School]]));
    try {
      const row = await api.patch<Row>(`${base}/schools/${id}`, { ...body, expectedUpdatedAt: current.updatedAt });
      mapSchool(id, item => ({ ...item, updatedAt: row.updatedAt }));
    } catch (error) {
      const row = conflictRow<Row>(error);
      if (row) {
        mapSchool(id, item => ({ ...item, ...schoolColumns(row), updatedAt: row.updatedAt }));
        conflictNotice(() => setSchool(id, body as SchoolChange));
        return;
      }
      const refused = error instanceof ApiError && error.status < 500 ? Object.keys(error.fields ?? {}).filter(key => fields.includes(key)) : [];
      if (!refused.length) { restore(); throw error; }
      setFieldErrors(errors => ({ ...errors, ...Object.fromEntries(refused.map(key => [`${id}:${key}`, (error as ApiError).fields![key]])) }));
      toast(errorText(error));
      const rest = fields.filter(key => !refused.includes(key));
      if (rest.length) { markDirty(`school:${id}`, rest); schedule(`school:${id}`, schoolTask(id), 0); }
    }
  };

  const setSchool = useCallback((id: string, change: SchoolChange) => {
    mapSchool(id, item => ({ ...item, ...change }));
    setFieldErrors(errors => {
      const keys = Object.keys(change).map(key => `${id}:${key}`).filter(key => key in errors);
      if (!keys.length) return errors;
      const next = { ...errors };
      for (const key of keys) delete next[key];
      return next;
    });
    markDirty(`school:${id}`, Object.keys(change));
    schedule(`school:${id}`, schoolTask(id));
    // schoolTask only reads refs and stable callbacks, so a fresh closure per call is fine.
  }, [mapSchool, schedule]);

  const removeSchool = useCallback(async (id: string) => {
    const index = latest.current.schools.findIndex(item => item.id === id);
    const removed = latest.current.schools[index];
    if (!removed) return;
    commit(current => ({ ...current, schools: current.schools.filter(item => item.id !== id) }));
    try {
      await api.del(`${base}/schools/${id}`);
    } catch (error) {
      commit(current => ({ ...current, schools: insertAt(current.schools, index, removed) }));
      throw error;
    }
    toast(`حُذفت «${removed.name || "المدرسة"}»`, {
      label: "تراجع",
      run: () => {
        api.post<Row>(`${base}/schools/${id}/restore`)
          .then(row => commit(current => ({ ...current, schools: insertAt(current.schools, index, { ...removed, updatedAt: row.updatedAt }) })))
          .catch(reason => toast(errorText(reason)));
      },
    });
  }, [base, commit, toast]);

  /** The principal's name: the «الاسم» field of the principal role, created on first use. */
  const setPrincipal = useCallback((schoolId: string, name: string) => {
    mapSchool(schoolId, item => {
      const role = principalRole(item);
      if (!role) {
        const local: LeadershipRole = { id: localId(), role: PRINCIPAL_ROLE, state: "", updatedAt: "", fields: [{ id: localId(), label: NAME_LABEL, value: name, updatedAt: "" }] };
        return { ...item, leadership: [local, ...item.leadership] };
      }
      const hasName = role.fields.some(field => field.label.trim() === NAME_LABEL);
      const fields = hasName
        ? role.fields.map(field => field.label.trim() === NAME_LABEL ? { ...field, value: name } : field)
        : [{ id: localId(), label: NAME_LABEL, value: name, updatedAt: "" }, ...role.fields];
      return { ...item, leadership: item.leadership.map(entry => entry.id === role.id ? { ...entry, fields } : entry) };
    });
    schedule(`principal:${schoolId}`, async () => {
      await creating.current.get(schoolId);
      let role = school(schoolId) && principalRole(school(schoolId)!);
      if (!role) return;
      const nameField = (entry: LeadershipRole) => entry.fields.find(item => item.label.trim() === NAME_LABEL);
      const nameNow = () => { const now = school(schoolId); const entry = now && principalRole(now); return (entry && nameField(entry)?.value) ?? ""; };
      const replaceRole = (id: string, next: LeadershipRole) => mapSchool(schoolId, item => ({ ...item, leadership: item.leadership.map(entry => entry.id === id ? next : entry) }));

      // 1. The role itself (main starts it with «الاسم» and «الجوال»). Created with a stable id, so a retry is the same row.
      if (isLocal(role.id)) {
        const created = await api.post<Row>(`${base}/schools/${schoolId}/leadership`, { id: serverId(role.id), role: PRINCIPAL_ROLE });
        const rows = (await api.get<Row[]>(`${base}/leadership/${created.id}/fields`)).map(toLabelValue);
        const value = nameNow();
        const serverName = rows.find(item => item.label.trim() === NAME_LABEL);
        const fields = serverName
          ? rows.map(item => item.id === serverName.id ? { ...item, value } : item)
          : [{ id: localId(), label: NAME_LABEL, value, updatedAt: "" }, ...rows];
        const next = { id: created.id, role: String(created.role), state: String(created.state ?? ""), updatedAt: created.updatedAt, fields };
        replaceRole(role.id, next);
        role = next;
      }
      // 2. Its «الاسم» field.
      const field = nameField(role)!;
      const value = nameNow();
      const setField = (next: LabelValue) => mapSchool(schoolId, item => ({
        ...item, leadership: item.leadership.map(entry => entry.id === role!.id ? { ...entry, fields: entry.fields.map(f => f.id === field.id ? next : f) } : entry),
      }));
      if (isLocal(field.id)) {
        const saved = toLabelValue(await api.post<Row>(`${base}/leadership/${role.id}/fields`, { id: serverId(field.id), label: NAME_LABEL, value }));
        setField({ ...saved, value: nameNow() });
        return;
      }
      try {
        const row = await api.patch<Row>(`${base}/leadership/${role.id}/fields/${field.id}`, { value, expectedUpdatedAt: field.updatedAt });
        setField({ ...toLabelValue(row), value: nameNow() });
      } catch (error) {
        const row = conflictRow<Row>(error);
        if (!row) throw error;
        setField(toLabelValue(row));
        conflictNotice();
      }
    });
  }, [base, conflictNotice, mapSchool, schedule]);

  /** Number of teachers = the «الهيئة التعليمية» staff tile, created on first use. */
  const setTeachers = useCallback((schoolId: string, value: number) => {
    mapSchool(schoolId, item => {
      const tile = teachersTile(item);
      return tile
        ? { ...item, staffTiles: item.staffTiles.map(entry => entry.id === tile.id ? { ...entry, value } : entry) }
        : { ...item, staffTiles: [{ id: localId(), label: TEACHERS_TILE, value, updatedAt: "" }, ...item.staffTiles] };
    });
    schedule(`teachers:${schoolId}`, async () => {
      await creating.current.get(schoolId);
      const current = school(schoolId);
      const tile = current && teachersTile(current);
      if (!tile) return;
      const replace = (row: Row, keepValue: boolean) => mapSchool(schoolId, item => ({
        ...item, staffTiles: item.staffTiles.map(entry => entry.id === tile.id ? { ...toTile(row), value: keepValue ? entry.value : Number(row.value ?? 0) } : entry),
      }));
      if (isLocal(tile.id)) {
        replace(await api.post<Row>(`${base}/schools/${schoolId}/staff-tiles`, { id: serverId(tile.id), label: TEACHERS_TILE, value: tile.value }), true);
        return;
      }
      try {
        replace(await api.patch<Row>(`${base}/schools/${schoolId}/staff-tiles/${tile.id}`, { value: tile.value, expectedUpdatedAt: tile.updatedAt }), true);
      } catch (error) {
        const row = conflictRow<Row>(error);
        if (!row) throw error;
        replace(row, false);
        conflictNotice();
      }
    });
  }, [base, conflictNotice, mapSchool, schedule]);

  // ───────── indicators (the head sets every value; PUT upserts, so there is no conflict check) ─────────
  const setEvaluation = useCallback((schoolId: string, change: EvaluationChange) => {
    mapSchool(schoolId, item => ({ ...item, evaluation: { ...(item.evaluation ?? EMPTY_EVALUATION), ...change } }));
    markDirty(`evaluation:${schoolId}`, Object.keys(change));
    schedule(`evaluation:${schoolId}`, async () => {
      await creating.current.get(schoolId);
      const { fields, restore } = takeDirty(`evaluation:${schoolId}`);
      const evaluation = school(schoolId)?.evaluation;
      if (!fields.length || !evaluation) return;
      try {
        await api.put(`${base}/indicators/evaluation`, { schoolId, ...Object.fromEntries(fields.map(key => [key, evaluation[key as keyof Evaluation]])) });
      } catch (error) { restore(); throw error; }
    });
  }, [base, mapSchool, schedule]);

  const setMadrasati = useCallback((schoolId: string, index: number, value: number) => {
    mapSchool(schoolId, item => ({ ...item, madrasati: item.madrasati.map((metric, position) => position === index ? value : metric) }));
    schedule(`madrasati:${schoolId}`, async () => {
      await creating.current.get(schoolId);
      const current = school(schoolId);
      if (current) await api.put(`${base}/indicators/madrasati`, { schoolId, metrics: current.madrasati });
    });
  }, [base, mapSchool, schedule]);

  const setDiscipline = useCallback((schoolId: string, change: DisciplineChange) => {
    mapSchool(schoolId, item => ({ ...item, discipline: { ...item.discipline, ...change } }));
    markDirty(`discipline:${schoolId}`, Object.keys(change));
    schedule(`discipline:${schoolId}`, async () => {
      await creating.current.get(schoolId);
      const { fields, restore } = takeDirty(`discipline:${schoolId}`);
      const discipline = school(schoolId)?.discipline;
      if (!fields.length || !discipline) return;
      try {
        await api.put(`${base}/indicators/discipline`, { schoolId, ...Object.fromEntries(fields.map(key => [key, discipline[key as keyof typeof discipline]])) });
      } catch (error) { restore(); throw error; }
    });
  }, [base, mapSchool, schedule]);

  return {
    workspace, saveState: saver.state, retry: saver.retry, fieldErrors,
    setField, addField, removeField, addSchool, setSchool, removeSchool, setPrincipal, setTeachers, setEvaluation, setMadrasati, setDiscipline,
  };
}

export type MemberFile = ReturnType<typeof useMemberFile>;
