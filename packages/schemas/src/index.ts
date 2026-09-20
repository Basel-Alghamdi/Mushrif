import { z } from "zod";

export const absenceSchema = z.object({
  schoolId: z.string().min(1, "اختر المدرسة"),
  date: z.string().date("التاريخ غير صحيح"),
  done: z.boolean(),
});

export const visitSchema = z.object({
  schoolId: z.string().min(1, "اختر المدرسة"),
  type: z.enum(["دورية", "طارئة", "متابعة"]),
  text: z.string().min(10, "أضف وصفاً لا يقل عن ١٠ أحرف"),
  attachmentIds: z.array(z.string()).default([]),
});

export type AbsenceInput = z.infer<typeof absenceSchema>;
export type VisitInput = z.infer<typeof visitSchema>;
