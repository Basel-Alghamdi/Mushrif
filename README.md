# رَصد — منصة الإشراف المدرسي

منصة عربية RTL لإدارة أعمال الإشراف: ملف العنقود لكل عضوة، المهام اليومية والزيارات الميدانية، والمؤشرات ولوحة رئيسة النطاق.

## التشغيل المحلي

```bash
pnpm install
cp .env.example .env              # ثم أضف مفاتيح Supabase (انظر docs/INTEGRATIONS.md)
pnpm --filter @rasd/api db:migrate   # يستخدم DIRECT_DATABASE_URL، أو DATABASE_URL إن لم يُضبط
pnpm --filter @rasd/api bootstrap:head
pnpm dev
```

- الواجهة: `http://localhost:3000`
- الـ API: `http://localhost:4000`

## البنية

- `apps/web`: Next.js — مساحة العضوة (`/cluster/*`)، لوحة رئيسة النطاق (`/district`)، الجوال الميداني (`/field`).
- `apps/api`: Hono على Postgres (Supabase) — المصدر الوحيد للكتابة، مع التحقق والصلاحيات وسجل التدقيق.
- `apps/worker`: مهام الخلفية (قيد الإعداد).
- `packages/schemas`: قواعد التحقق وبنية الملف ونسبة الاكتمال، مشتركة بين الواجهة والـ API.
- `packages/i18n`: الأرقام العربية والتاريخ الهجري.
- `supabase/migrations`: مخطط قاعدة البيانات وسياسات RLS.
