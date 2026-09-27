export type Tier = "تميز" | "تقدم" | "انطلاق" | "تهيئة";

export type School = {
  id: string;
  name: string;
  stage: string;
  area: string;
  ministryNo: string;
  email: string;
  educationType: string;
  specialEducation: string;
  hasGuard: string;
  classes: number;
  students: number;
  giftedClasses: number;
  giftedStudents: number;
  teachesChinese: string;
  teachers: number;
  admin: number;
  deputies: number;
  expert: number;
  advanced: number;
  tier: Tier;
  support: string;
  nafes: string;
  qudrat: number;
  tahsili: number;
  madrasati: number[];
  discipline: number[];
  absence: boolean;
  visits: number;
  principal: string;
  hiddenFields?: string[];
  customFields?: {id:string;label:string;value:string}[];
  staffTiles?: {id:string;label:string;value:number}[];
  leadership?: {id:string;role:string;state:string;fields:{id:string;label:string;value:string}[]}[];
  updatedAt?: string;
};

export const metricLabels = ["المعلمات المسندات للجداول", "المعلمات المسندات للمقررات", "الطالبات المسندات للفصول", "دخول المعلمات", "دخول الطالبات", "نسبة الإنجاز"];

export const tierColor: Record<Tier, string> = { "تميز":"#007970", "تقدم":"#009688", "انطلاق":"#5cbfb4", "تهيئة":"#a2e0d8" };
export const percentColor = (value: number) => value < 75 ? "#dc2626" : "#000000de";
export const progressColor = (value: number) => value < 75 ? "#dc2626" : "#009688";
