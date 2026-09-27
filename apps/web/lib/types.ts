// Shapes returned by the Rasd API (dates arrive as ISO strings).

export type LabelValue = { id: string; label: string; value: string; updatedAt: string };

export type ProfileField = {
  id: string; key: string | null; label: string; value: string; span: 1 | 2;
  type: "text" | "select" | "derived" | "hijri_date"; options: string[]; updatedAt: string;
};

export type StaffTile = { id: string; label: string; value: number; updatedAt: string };
export type LeadershipRole = { id: string; role: string; state: string; updatedAt: string; fields: LabelValue[] };

export type School = {
  id: string; name: string; stage: string; area: string; ministryNo: string; ministryEmail: string;
  educationType: string; specialEdProgram: string; hasGuard: boolean; classes: number; students: number;
  giftedClasses: number; giftedStudents: number; teachesChinese: boolean; tier: string | null; updatedAt: string;
  evaluation: {
    supportType: string; nafesValue: number | null; nafesDirection: string; nafesDelta: string; qudrat: number | null; tahsili: number | null;
    externalReportUrl: string; externalReportStatus: string; importedAt: string | null;
  } | null;
  madrasati: number[];
  discipline: { daily: number; weekly: number; monthly: number; planStatus: string; planUrl: string };
  absenceToday: boolean;
  visitCount: number;
  customFields: LabelValue[];
  staffTiles: StaffTile[];
  leadership: LeadershipRole[];
};

export type Plan = { id: string; kind: string; label: string; hint: string; url: string; status: string; updatedAt: string };
export type Program = { id: string; kind: string; label: string; count: number; reportsUrl: string; status: string; updatedAt: string };
export type CustomSection = { id: string; label: string; updatedAt: string; fields: LabelValue[] };

export type Workspace = {
  cluster: {
    id: string; label: string; memberId: string; memberName: string; memberEmail: string; memberPhone: string;
    nafesCardFolderUrl: string; today: string; submittedToday: string | null; lastActivityAt: string;
  };
  profile: ProfileField[];
  schools: School[];
  hiddenSchoolFields: string[];
  plans: Plan[];
  programs: Program[];
  sections: CustomSection[];
  disciplineSupportPlan: { text: string; updatedAt: string | null };
  completion: number;
};

export type Submission = "submitted" | "late" | "missing";

export type MemberSummary = {
  id: string; clusterId: string; name: string; email: string; clusterLabel: string; initials: string; completion: number;
  schoolCount: number; absence: number; discipline: number | null; visits: number; submission: Submission;
  submittedAt: string | null; lastActivityAt: string;
};

export type Invitation = {
  id: string; name: string; email: string; clusterLabel: string; status: "pending" | "expired";
  deliveryStatus: "sending" | "sent" | "link_ready" | "failed"; expiresAt: string; createdAt: string;
};

export type TimelineEntry = {
  id: string; kind: string; title: string; body: string; at: string; source: string; sourceLabel: string; actorName: string; flagged: boolean;
};

export type Notification = { id: string; kind: string; text: string; level: "info" | "attention"; readAt: string | null; createdAt: string };
