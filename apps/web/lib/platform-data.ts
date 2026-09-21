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

export const accounts = {
  member: { name: "هند الشمري", initials: "هش", email: "h.alshammari@moe.gov.sa", role: "عضو الفريق التنفيذي" },
  head: { name: "سارة القحطاني", initials: "سق", email: "s.alqahtani@moe.gov.sa", role: "رئيسة النطاق" },
} as const;

export const schools: School[] = [
  { id:"school-1", name:"ابتدائية الأندلس", stage:"ابتدائية", area:"حي الأندلس", ministryNo:"124567", email:"andalus@moe.gov.sa", educationType:"حضوري", specialEducation:"يوجد — صعوبات تعلم", hasGuard:"يوجد", classes:24, students:612, giftedClasses:2, giftedStudents:44, teachesChinese:"لا", teachers:38, admin:6, deputies:3, expert:4, advanced:9, tier:"تقدم", support:"الدعم وفق الاحتياج", nafes:"ارتفاع ٦٪", qudrat:78, tahsili:74, madrasati:[96,92,99,88,81,86], discipline:[96,94,95], absence:true, visits:9, principal:"منال العنزي" },
  { id:"school-2", name:"متوسطة النهضة", stage:"متوسطة", area:"حي النهضة", ministryNo:"124590", email:"nahda@moe.gov.sa", educationType:"مدمج", specialEducation:"لا يوجد", hasGuard:"يوجد", classes:18, students:486, giftedClasses:0, giftedStudents:0, teachesChinese:"نعم", teachers:32, admin:5, deputies:2, expert:2, advanced:7, tier:"تميز", support:"الدعم عند الطلب", nafes:"ارتفاع ٩٪", qudrat:82, tahsili:79, madrasati:[100,97,100,93,88,91], discipline:[98,97,97], absence:true, visits:8, principal:"هيفاء الرشيد" },
  { id:"school-3", name:"ثانوية الرواد", stage:"ثانوية", area:"حي الملز", ministryNo:"124603", email:"rowad@moe.gov.sa", educationType:"حضوري", specialEducation:"يوجد — الدمج الكلي", hasGuard:"لا يوجد", classes:21, students:558, giftedClasses:1, giftedStudents:22, teachesChinese:"لا", teachers:41, admin:7, deputies:3, expert:5, advanced:11, tier:"انطلاق", support:"الدعم وفق الاحتياج", nafes:"انخفاض ٣٪", qudrat:71, tahsili:68, madrasati:[91,84,96,76,70,74], discipline:[88,86,87], absence:false, visits:11, principal:"فاطمة الأحمدي" },
  { id:"school-4", name:"ابتدائية الفيصلية", stage:"ابتدائية", area:"حي الفيصلية", ministryNo:"124619", email:"faisaliah@moe.gov.sa", educationType:"حضوري", specialEducation:"لا يوجد", hasGuard:"يوجد", classes:16, students:402, giftedClasses:0, giftedStudents:0, teachesChinese:"لا", teachers:27, admin:4, deputies:2, expert:1, advanced:6, tier:"تقدم", support:"الدعم عند الطلب", nafes:"ارتفاع ٤٪", qudrat:76, tahsili:72, madrasati:[95,90,98,85,79,83], discipline:[95,93,94], absence:true, visits:7, principal:"رغد النفيعي" },
  { id:"school-5", name:"متوسطة الخنساء", stage:"متوسطة", area:"حي السلام", ministryNo:"124628", email:"khansa@moe.gov.sa", educationType:"مدمج", specialEducation:"يوجد — التوحد", hasGuard:"يوجد", classes:15, students:389, giftedClasses:1, giftedStudents:18, teachesChinese:"لا", teachers:29, admin:5, deputies:2, expert:2, advanced:5, tier:"تقدم", support:"الدعم وفق الاحتياج", nafes:"ارتفاع ٢٪", qudrat:74, tahsili:70, madrasati:[94,89,97,83,77,81], discipline:[93,91,92], absence:false, visits:6, principal:"عبير القرني" },
  { id:"school-6", name:"ابتدائية الروضة", stage:"ابتدائية", area:"حي الروضة", ministryNo:"124637", email:"rawdah@moe.gov.sa", educationType:"حضوري", specialEducation:"لا يوجد", hasGuard:"لا يوجد", classes:14, students:793, giftedClasses:0, giftedStudents:0, teachesChinese:"لا", teachers:31, admin:5, deputies:2, expert:1, advanced:4, tier:"تهيئة", support:"الدعم وفق الاحتياج", nafes:"انخفاض ٧٪", qudrat:65, tahsili:61, madrasati:[86,78,92,68,62,66], discipline:[82,80,81], absence:false, visits:6, principal:"لطيفة الغامدي" },
];

const names = ["هند الشمري","منيرة الدوسري","لطيفة الغامدي","ريم الحربي","عبير القرني","أمل السبيعي","نورة العتيبي","سمية الزهراني","دلال المطيري","جواهر الرشيد","بشرى العنزي","مها الخالدي","شهد البقمي","نوف السهلي","رنا الجهني","أروى الثقفي","خلود الشهري","وجدان المالكي","تهاني الحسن","غادة الصاعدي","إيمان العمري","فاطمة الأحمدي","رغد النفيعي","سارة اليامي","حصة الشمراني"];
const completion = [92,78,85,64,96,71,88,59,80,74,90,66,82,95,70,86,61,79,93,68,84,72,89,63,77];
const discipline = [96,88,94,79,92,85,90,73,87,91,95,80,83,97,76,89,68,82,94,75,86,78,92,70,84];
const absence = [6,5,6,3,6,4,6,2,5,6,6,3,4,6,3,5,2,4,6,3,5,4,6,2,4];
const visits = [9,8,11,6,7,6,10,4,8,9,12,5,7,11,6,8,3,7,10,5,9,6,11,4,7];

export const members = names.map((name, index) => ({
  id: `member-${index + 1}`,
  name,
  initials: name.split(" ").map((part) => part[0]).join(""),
  cluster: index + 1,
  schools: 6 - (index % 2),
  completion: completion[index],
  discipline: discipline[index],
  absence: absence[index],
  visits: visits[index],
  status: index < 18 ? "حدّثت" : index < 22 ? "متأخرة" : "لم تحدّث",
}));

export const profileFields = [
  ["الاسم الرباعي", "هند سعد عبدالله الشمري"], ["السجل المدني", "١٠٤٥٢٢٨٩٣٧"],
  ["الرقم الوظيفي", "٤٤٢٧٩٠"], ["البريد الوزاري", accounts.member.email],
  ["رقم الجوال", "٠٥٥٤٢٣٨٨١٠"], ["الرتبة", "خبير"],
  ["المؤهل", "ماجستير إدارة تربوية"], ["التخصص", "رياضيات"],
  ["التخصص الإشرافي", "إشراف رياضيات"], ["تاريخ التعيين", "١٤٣٢/٠٧/١٥"],
  ["تاريخ التكليف بالإشراف", "١٤٤١/٠١/٠٣"], ["عدد سنوات الخبرة", "١٤"],
] as const;

export const metricLabels = ["المعلمات المسندات للجداول", "المعلمات المسندات للمقررات", "الطالبات المسندات للفصول", "دخول المعلمات", "دخول الطالبات", "نسبة الإنجاز"];

export const tierColor: Record<Tier, string> = { "تميز":"#067647", "تقدم":"#009688", "انطلاق":"#b45309", "تهيئة":"#dc2626" };
export const percentColor = (value: number) => value >= 95 ? "#067647" : value >= 85 ? "#009688" : value >= 75 ? "#b45309" : "#dc2626";
