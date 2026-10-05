"use client";

import { riyadhDate, type DocumentInfo, type DocumentPlacement } from "@rasd/schemas";
import { api } from "../../lib/api";
import type { LabelValue, LeadershipRole, Plan, ProfileField, Program, School, StaffTile, VisitReport } from "../../lib/types";
import { useMember, type Row, type SaveJob } from "./context";
import { NOTES_FIELD } from "./model";
import { replaceById, useCreate, useRemove, withVersion } from "./mutations";

type SchoolValue = string | number | boolean | null;
/** The columns of a schools row that the workspace shows as they are. */
const SCHOOL_COLUMNS = [
  "name", "stage", "area", "ministryNo", "ministryEmail", "educationType", "specialEdProgram", "hasGuard",
  "classes", "students", "giftedClasses", "giftedStudents", "teachesChinese", "tier",
] as const;
export type VisitDraft = { schoolId: string; type: string; text: string; beneficiaries: number; sessions: number; blockers: string };

const labelValue = (row: Row): LabelValue => ({ id: String(row.id), label: String(row.label), value: String(row.value ?? ""), updatedAt: row.updatedAt });

/**
 * Every change she makes, saved on main's granular endpoints: the screen changes at once, the request follows
 * (after a short pause while typing), and each row carries the version it was loaded at (409 CONFLICT → choice toast).
 */
export function useActions() {
  const { current, update, save, schedule, notify, fail, reload, setDocuments, setVisits } = useMember();
  const create = useCreate();
  const remove = useRemove();

  const school = (id: string) => current().schools.find(item => item.id === id);
  const editSchool = (id: string, change: (item: School) => School) =>
    update(ws => ({ ...ws, schools: replaceById(ws.schools, id, change) }));

  /** A PATCH of one value on one row; `read` gives the value and version at the moment it is sent. */
  function patchJob(key: string, path: string, read: () => { body: Record<string, unknown>; updatedAt?: string } | null,
    apply: (row: Row, sent: Record<string, unknown>) => void, onConflict: (row: Row) => void): SaveJob<Row> {
    let sent: Record<string, unknown> = {};
    return {
      key,
      send: force => {
        const state = read();
        if (!state) return Promise.reject(new Error("هذا العنصر لم يعد موجوداً"));
        sent = state.body;
        return api.patch<Row>(path, withVersion(state.body, state.updatedAt, force));
      },
      saved: row => apply(row, sent),
      conflict: onConflict,
    };
  }

  // ───────── بياناتي ─────────
  const setProfileValue = (field: ProfileField, value: string, delay?: number) => {
    update(ws => ({ ...ws, profile: replaceById(ws.profile, field.id, { value }) }));
    const find = () => current().profile.find(item => item.id === field.id);
    schedule(`profile:${field.id}`, () => patchJob(`profile:${field.id}`, `/cluster/me/profile-fields/${field.id}`,
      () => { const item = find(); return item ? { body: { value: item.value }, updatedAt: item.updatedAt } : null; },
      (row, sent) => update(ws => ({
        ...ws, profile: replaceById(ws.profile, field.id, item => ({ ...item, updatedAt: row.updatedAt, value: item.value === sent.value ? String(row.value) : item.value })),
      })),
      row => update(ws => ({ ...ws, profile: replaceById(ws.profile, field.id, { value: String(row.value), updatedAt: row.updatedAt }) }))), delay);
  };

  const addCustomField = (label: string, value: string) => {
    const id = crypto.randomUUID();
    const field: ProfileField = { id, key: null, label: label.trim(), value, span: 1, type: "text", options: [], updatedAt: "" };
    return create<Row>({
      path: "/cluster/me/profile-fields", body: { id, label: field.label, value },
      apply: ws => ({ ...ws, profile: [...ws.profile, field] }),
      rollback: ws => ({ ...ws, profile: ws.profile.filter(item => item.id !== id) }),
      then: row => update(ws => ({ ...ws, profile: replaceById(ws.profile, id, { updatedAt: row.updatedAt }) })),
    });
  };

  const removeCustomField = (field: ProfileField) => {
    const index = current().profile.findIndex(item => item.id === field.id);
    return remove({
      text: "حُذفت الخانة", path: `/cluster/me/profile-fields/${field.id}`,
      apply: ws => ({ ...ws, profile: ws.profile.filter(item => item.id !== field.id) }),
      rollback: ws => ({ ...ws, profile: [...ws.profile.slice(0, index), field, ...ws.profile.slice(index)] }),
    });
  };

  // ───────── مدارسي ─────────
  /** Creates the school on the server (it adds the default leadership role and staff tiles), then reloads. */
  const addSchool = async (name: string) => {
    const id = crypto.randomUUID();
    try {
      await api.post("/cluster/me/schools", { id, name: name.trim() || "مدرسة جديدة" });
      await reload();
      return id;
    } catch (error) {
      fail(error);
      return null;
    }
  };

  const removeSchool = (target: School) => {
    const index = current().schools.findIndex(item => item.id === target.id);
    return remove({
      text: "حُذفت المدرسة", path: `/cluster/me/schools/${target.id}`,
      apply: ws => ({ ...ws, schools: ws.schools.filter(item => item.id !== target.id) }),
      rollback: ws => ({ ...ws, schools: [...ws.schools.slice(0, index), target, ...ws.schools.slice(index)] }),
    });
  };

  const setSchool = (id: string, key: keyof School, value: SchoolValue, delay?: number) => {
    editSchool(id, item => ({ ...item, [key]: value }));
    schedule(`school:${id}:${String(key)}`, () => patchJob(`school:${id}`, `/cluster/me/schools/${id}`,
      () => { const item = school(id); return item ? { body: { [key]: item[key] }, updatedAt: item.updatedAt } : null; },
      (row, sent) => editSchool(id, item => ({ ...item, updatedAt: row.updatedAt, ...(item[key] === sent[key] ? { [key]: row[key] } : {}) })),
      // The server's copy of the whole row: whatever else changed on it shows too.
      row => editSchool(id, item => ({ ...item, ...Object.fromEntries(SCHOOL_COLUMNS.filter(column => column in row).map(column => [column, row[column]])), updatedAt: row.updatedAt }))), delay);
  };

  /** A staff count (عدد المعلمات = «الهيئة التعليمية»). Creates the tile the first time if it was removed. */
  const setTile = (schoolId: string, label: string, value: number) => {
    const existing = school(schoolId)?.staffTiles.find(tile => tile.label === label);
    if (!existing) {
      const tile: StaffTile = { id: crypto.randomUUID(), label, value, updatedAt: "" };
      editSchool(schoolId, item => ({ ...item, staffTiles: [...item.staffTiles, tile] }));
      void save<Row>({
        key: `tile:${tile.id}`,
        send: () => api.post<Row>(`/schools/${schoolId}/staff-tiles`, { id: tile.id, label, value }),
        saved: row => editSchool(schoolId, item => ({ ...item, staffTiles: replaceById(item.staffTiles, tile.id, { updatedAt: row.updatedAt }) })),
      });
      return;
    }
    const setTiles = (change: (tile: StaffTile) => StaffTile) => editSchool(schoolId, item => ({ ...item, staffTiles: replaceById(item.staffTiles, existing.id, change) }));
    setTiles(tile => ({ ...tile, value }));
    const find = () => school(schoolId)?.staffTiles.find(tile => tile.id === existing.id);
    schedule(`tile:${existing.id}`, () => patchJob(`tile:${existing.id}`, `/schools/${schoolId}/staff-tiles/${existing.id}`,
      () => { const tile = find(); return tile ? { body: { value: tile.value }, updatedAt: tile.updatedAt } : null; },
      (row, sent) => setTiles(tile => ({ ...tile, updatedAt: row.updatedAt, value: tile.value === sent.value ? Number(row.value) : tile.value })),
      row => setTiles(tile => ({ ...tile, value: Number(row.value), updatedAt: row.updatedAt }))));
  };

  // A label + value row under a school (custom fields) or a leadership role (its الاسم / الجوال).
  type Child = { list: (schoolId: string) => LabelValue[] | undefined; set: (schoolId: string, change: (fields: LabelValue[]) => LabelValue[]) => void; base: string };
  const customChild = (schoolId: string): Child => ({
    list: id => school(id)?.customFields,
    set: (id, change) => editSchool(id, item => ({ ...item, customFields: change(item.customFields) })),
    base: `/schools/${schoolId}/custom-fields`,
  });
  const roleChild = (roleId: string): Child => ({
    list: id => school(id)?.leadership.find(role => role.id === roleId)?.fields,
    set: (id, change) => editSchool(id, item => ({ ...item, leadership: replaceById(item.leadership, roleId, role => ({ ...role, fields: change(role.fields) })) })),
    base: `/leadership/${roleId}/fields`,
  });

  /** Sets the value of the child row with this label, creating it on first use. */
  const setChild = (schoolId: string, child: Child, label: string, value: string) => {
    const existing = child.list(schoolId)?.find(field => field.label === label);
    if (!existing) {
      const field: LabelValue = { id: crypto.randomUUID(), label, value, updatedAt: "" };
      child.set(schoolId, fields => [...fields, field]);
      void save<Row>({
        key: `child:${field.id}`,
        send: () => api.post<Row>(child.base, { id: field.id, label, value }),
        saved: row => child.set(schoolId, fields => replaceById(fields, field.id, { updatedAt: row.updatedAt })),
      });
      return;
    }
    setChildValue(schoolId, child, existing.id, value);
  };
  const setChildValue = (schoolId: string, child: Child, id: string, value: string) => {
    child.set(schoolId, fields => replaceById(fields, id, { value }));
    const find = () => child.list(schoolId)?.find(field => field.id === id);
    schedule(`child:${id}`, () => patchJob(`child:${id}`, `${child.base}/${id}`,
      () => { const field = find(); return field ? { body: { value: field.value }, updatedAt: field.updatedAt } : null; },
      (row, sent) => child.set(schoolId, fields => replaceById(fields, id, field => ({ ...field, updatedAt: row.updatedAt, value: field.value === sent.value ? String(row.value) : field.value }))),
      row => child.set(schoolId, fields => replaceById(fields, id, labelValue(row)))));
  };

  const setNotes = (schoolId: string, value: string) => setChild(schoolId, customChild(schoolId), NOTES_FIELD, value);
  const setCustom = (schoolId: string, id: string, value: string) => setChildValue(schoolId, customChild(schoolId), id, value);
  const addCustom = (schoolId: string, label: string) => {
    const field: LabelValue = { id: crypto.randomUUID(), label: label.trim(), value: "", updatedAt: "" };
    return create<Row>({
      path: `/schools/${schoolId}/custom-fields`, body: { id: field.id, label: field.label },
      apply: ws => ({ ...ws, schools: replaceById(ws.schools, schoolId, item => ({ ...item, customFields: [...item.customFields, field] })) }),
      rollback: ws => ({ ...ws, schools: replaceById(ws.schools, schoolId, item => ({ ...item, customFields: item.customFields.filter(value => value.id !== field.id) })) }),
      then: row => customChild(schoolId).set(schoolId, fields => replaceById(fields, field.id, { updatedAt: row.updatedAt })),
    });
  };
  const removeCustom = (schoolId: string, field: LabelValue) => remove({
    text: "حُذفت الخانة", path: `/schools/${schoolId}/custom-fields/${field.id}`,
    apply: ws => ({ ...ws, schools: replaceById(ws.schools, schoolId, item => ({ ...item, customFields: item.customFields.filter(value => value.id !== field.id) })) }),
    rollback: ws => ({ ...ws, schools: replaceById(ws.schools, schoolId, item => ({ ...item, customFields: [...item.customFields, field] })) }),
  });

  // Leadership: a role with its الاسم / الجوال fields.
  const setRoleField = (schoolId: string, roleId: string, label: string, value: string) => setChild(schoolId, roleChild(roleId), label, value);
  const setRoleName = (schoolId: string, roleId: string, value: string) => {
    const setRole = (change: (role: LeadershipRole) => LeadershipRole) => editSchool(schoolId, item => ({ ...item, leadership: replaceById(item.leadership, roleId, change) }));
    setRole(role => ({ ...role, role: value }));
    if (!value.trim()) return; // a role needs a name; the box keeps what she typed until she writes one
    const find = () => school(schoolId)?.leadership.find(role => role.id === roleId);
    schedule(`role:${roleId}`, () => patchJob(`role:${roleId}`, `/schools/${schoolId}/leadership/${roleId}`,
      () => { const role = find(); return role ? { body: { role: role.role.trim() }, updatedAt: role.updatedAt } : null; },
      row => setRole(role => ({ ...role, updatedAt: row.updatedAt })),
      row => setRole(role => ({ ...role, role: String(row.role), updatedAt: row.updatedAt }))));
  };
  /** Adds a role; the server gives it الاسم and الجوال, which are fetched before the row appears. */
  const addRole = async (schoolId: string, roleName: string) => {
    const id = crypto.randomUUID();
    try {
      const row = await api.post<Row>(`/schools/${schoolId}/leadership`, { id, role: roleName });
      const fields = await api.get<Row[]>(`/leadership/${id}/fields`);
      const role: LeadershipRole = { id, role: String(row.role), state: String(row.state), updatedAt: row.updatedAt, fields: fields.map(labelValue) };
      editSchool(schoolId, item => ({ ...item, leadership: [...item.leadership, role] }));
      return id;
    } catch (error) {
      fail(error);
      return null;
    }
  };
  const removeRole = (schoolId: string, role: LeadershipRole) => remove({
    text: "حُذف الدور", path: `/schools/${schoolId}/leadership/${role.id}`,
    apply: ws => ({ ...ws, schools: replaceById(ws.schools, schoolId, item => ({ ...item, leadership: item.leadership.filter(value => value.id !== role.id) })) }),
    rollback: ws => ({ ...ws, schools: replaceById(ws.schools, schoolId, item => ({ ...item, leadership: [...item.leadership, role] })) }),
  });

  // Indicators: مدرستي and الانضباط are hers; التقويم values are the head's (members may only set the external report link).
  const setMadrasati = (schoolId: string, index: number, value: number) => {
    editSchool(schoolId, item => ({ ...item, madrasati: item.madrasati.map((old, position) => (position === index ? value : old)) }));
    schedule(`madrasati:${schoolId}`, () => ({
      key: `madrasati:${schoolId}`,
      send: () => api.put<Row>("/cluster/me/indicators/madrasati", { schoolId, metrics: school(schoolId)?.madrasati ?? [] }),
    }));
  };
  const setDiscipline = (schoolId: string, key: "daily" | "weekly" | "monthly", value: number) => {
    editSchool(schoolId, item => ({ ...item, discipline: { ...item.discipline, [key]: value } }));
    schedule(`discipline:${schoolId}:${key}`, () => ({
      key: `discipline:${schoolId}`,
      send: () => api.put<Row>("/cluster/me/indicators/discipline", { schoolId, [key]: school(schoolId)?.discipline[key] ?? 0 }),
    }));
  };
  const setReportUrl = (schoolId: string, url: string) => {
    const blank = { supportType: "", nafesValue: null, nafesDirection: "", nafesDelta: "", qudrat: null, tahsili: null, externalReportUrl: "", externalReportStatus: "missing", importedAt: null };
    editSchool(schoolId, item => ({ ...item, evaluation: { ...(item.evaluation ?? blank), externalReportUrl: url, externalReportStatus: url.trim() ? "uploaded" : "missing" } }));
    schedule(`evaluation:${schoolId}`, () => ({
      key: `evaluation:${schoolId}`,
      send: () => {
        const link = (school(schoolId)?.evaluation?.externalReportUrl ?? "").trim();
        return api.put<Row>("/cluster/me/indicators/evaluation", { schoolId, externalReportUrl: link, externalReportStatus: link ? "uploaded" : "missing" });
      },
    }));
  };

  const toggleAbsence = (target: School) => {
    const done = !target.absenceToday;
    editSchool(target.id, item => ({ ...item, absenceToday: done }));
    void save<Row>({
      key: `absence:${target.id}`,
      send: () => api.put<Row>(`/schools/${target.id}/absence`, { date: riyadhDate(), done }),
      rejected: () => editSchool(target.id, item => ({ ...item, absenceToday: !done })),
    });
  };

  // ───────── تقاريري ─────────
  const setPlanUrl = (plan: Plan, url: string) => {
    const setPlan = (change: (item: Plan) => Plan) => update(ws => ({ ...ws, plans: replaceById(ws.plans, plan.id, change) }));
    setPlan(item => ({ ...item, url, status: url.trim() ? "uploaded" : "missing" }));
    const find = () => current().plans.find(item => item.id === plan.id);
    schedule(`plan:${plan.id}`, () => patchJob(`plan:${plan.id}`, `/plans/${plan.id}`,
      () => { const item = find(); return item ? { body: { url: item.url.trim() }, updatedAt: item.updatedAt } : null; },
      row => setPlan(item => ({ ...item, status: String(row.status), updatedAt: row.updatedAt })),
      row => setPlan(item => ({ ...item, url: String(row.url), status: String(row.status), updatedAt: row.updatedAt }))));
  };

  const setNafesFolder = (url: string) => {
    update(ws => ({ ...ws, cluster: { ...ws.cluster, nafesCardFolderUrl: url } }));
    schedule("nafes-folder", () => ({
      key: "nafes-folder",
      send: () => api.put<Row>("/cluster/me/indicators/evaluation", { nafesCardFolderUrl: current().cluster.nafesCardFolderUrl.trim() }),
    }));
  };

  const addVisit = async (draft: VisitDraft) => {
    const visit = await api.post<VisitReport>("/visits", { id: crypto.randomUUID(), ...draft });
    setVisits(list => [visit, ...list]);
    editSchool(draft.schoolId, item => ({ ...item, visitCount: item.visitCount + 1 }));
    return visit;
  };

  const uploadDocument = async (file: File, placement?: DocumentPlacement) => {
    const saved = await api.upload<DocumentInfo[]>("/cluster/me/documents", [file], placement ? { folder: placement.folder, schoolId: placement.schoolId ?? "" } : {});
    setDocuments(list => [...saved, ...list]);
    update(ws => ({ ...ws, cluster: { ...ws.cluster, documentCount: ws.cluster.documentCount + saved.length } }));
    return saved;
  };

  const moveDocument = async (document: DocumentInfo, placement: DocumentPlacement) => {
    const moved = await api.patch<DocumentInfo>(`/attachments/${document.id}`, placement);
    setDocuments(list => list.map(item => (item.id === moved.id ? moved : item)));
    notify("نُقل الملف");
  };

  const removeDocument = async (document: DocumentInfo) => {
    setDocuments(list => list.filter(item => item.id !== document.id));
    try {
      await api.del(`/attachments/${document.id}`);
      notify("حُذف الملف");
    } catch (error) {
      setDocuments(list => [document, ...list]);
      fail(error);
    }
  };

  // ───────── التطوير المهني ─────────
  const addProgram = (label: string) => {
    const id = crypto.randomUUID();
    const program: Program = { id, kind: "workshop", label: label.trim(), count: 0, reportsUrl: "", status: "missing", updatedAt: "" };
    return create<Row>({
      path: "/pd", body: { id, kind: program.kind, label: program.label, count: 0, reportsUrl: "", status: "missing" },
      apply: ws => ({ ...ws, programs: [...ws.programs, program] }),
      rollback: ws => ({ ...ws, programs: ws.programs.filter(item => item.id !== id) }),
      then: row => update(ws => ({ ...ws, programs: replaceById(ws.programs, id, { updatedAt: row.updatedAt }) })),
    }).then(ok => (ok ? id : null));
  };

  const setProgram = (program: Program, key: "label" | "kind" | "count" | "reportsUrl", value: string | number, delay?: number) => {
    const setOne = (change: (item: Program) => Program) => update(ws => ({ ...ws, programs: replaceById(ws.programs, program.id, change) }));
    setOne(item => ({ ...item, [key]: value, ...(key === "reportsUrl" ? { status: String(value).trim() ? "uploaded" : "missing" } : {}) }));
    if (key === "label" && !String(value).trim()) return;
    const find = () => current().programs.find(item => item.id === program.id);
    schedule(`pd:${program.id}:${key}`, () => patchJob(`pd:${program.id}`, `/pd/${program.id}`,
      () => {
        const item = find();
        if (!item) return null;
        const body: Record<string, unknown> = { [key]: typeof item[key] === "string" ? String(item[key]).trim() : item[key] };
        if (key === "reportsUrl") body.status = item.reportsUrl.trim() ? "uploaded" : "missing";
        return { body, updatedAt: item.updatedAt };
      },
      row => setOne(item => ({ ...item, updatedAt: row.updatedAt })),
      row => setOne(item => ({ ...item, [key]: row[key], status: String(row.status), updatedAt: row.updatedAt }))), delay);
  };

  const removeProgram = (program: Program) => {
    const index = current().programs.findIndex(item => item.id === program.id);
    return remove({
      text: "حُذف البرنامج", path: `/pd/${program.id}`,
      apply: ws => ({ ...ws, programs: ws.programs.filter(item => item.id !== program.id) }),
      rollback: ws => ({ ...ws, programs: [...ws.programs.slice(0, index), program, ...ws.programs.slice(index)] }),
    });
  };

  return {
    setProfileValue, addCustomField, removeCustomField,
    addSchool, removeSchool, setSchool, setTile, setNotes, setCustom, addCustom, removeCustom,
    setRoleField, setRoleName, addRole, removeRole, setMadrasati, setDiscipline, setReportUrl, toggleAbsence,
    setPlanUrl, setNafesFolder, addVisit, uploadDocument, moveDocument, removeDocument,
    addProgram, setProgram, removeProgram,
  };
}
