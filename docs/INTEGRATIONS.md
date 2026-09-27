# ربط الخدمات

تعتمد رَصد على أربع خدمات فقط:

| الخدمة | الاستخدام |
|---|---|
| **Supabase** | قاعدة Postgres، تسجيل الدخول (Auth)، والتخزين لاحقاً (Storage) |
| **Railway** | استضافة الواجهة (`apps/web`) والـ API (`apps/api`) والعامل (`apps/worker`) |
| **OpenAI** | المساعد الذكي والاستيراد الذكي للملفات (المرحلة القادمة) |
| **Resend** | إرسال الدعوات والتذكيرات ورسائل استعادة كلمة المرور |

## إعداد Supabase

1. أنشئ مشروعاً، ثم انسخ من **Project Settings → API Keys** مفتاح `anon` ومفتاح `service_role` إلى `.env`.
2. من **Connect** انسخ رابط _Transaction pooler_ (المنفذ 6543) إلى `DATABASE_URL`.
3. **Authentication → Sign In / Providers → Email**: أوقف "Allow new users to sign up". الحسابات تُنشأ فقط من دعوات رئيسة النطاق عبر الـ API.
4. **Authentication → URL Configuration**: اجعل Site URL رابط الواجهة، وأضف `<APP_URL>/reset-password` إلى Redirect URLs.
5. (اختياري) **Authentication → SMTP**: اربط Resend كخادم SMTP ليستخدمه Supabase عند غياب `RESEND_API_KEY`.
6. طبّق المخطط وأنشئ حساب رئيسة النطاق:

```bash
pnpm --filter @rasd/api db:migrate
pnpm --filter @rasd/api bootstrap:head
```

المخطط في `supabase/migrations/`، ويُسجَّل ما طُبّق منه في `supabase_migrations.schema_migrations` — الجدول نفسه الذي يستخدمه Supabase CLI.

## الأمان

- كل الكتابة تمر عبر الـ API الذي يتحقق من الدور والعنقود في كل طلب. العضوة لا تصل إلا لملفها، ورئيسة النطاق تقرأ نطاقها وتعدّل بيانات التواصل فقط.
- RLS مفعّل على كل الجداول: للمستخدم المسجّل صلاحية قراءة ما يخصه فقط، ولا صلاحية لـ `anon`.
- كل تعديل يُسجَّل في `audit_log` مع مصدره (الويب، الجوال، الاستيراد، المساعد)، وكل اطلاع لرئيسة النطاق على ملف عضوة كامل يُسجَّل كقراءة بيانات شخصية.
- `SUPABASE_SERVICE_ROLE_KEY` للخادم فقط؛ لا تضعه أبداً في متغير يبدأ بـ `NEXT_PUBLIC_`.

## المراحل القادمة

- **Supabase Storage**: مرفقات تقارير الزيارات وخطة الانضباط والاستيراد الذكي بروابط موقّعة قصيرة الصلاحية.
- **OpenAI**: استخراج الحقول من الملفات مع المصدر ودرجة الثقة، وصياغة إجابات المساعد مع الاستشهادات.
- **Railway**: ثلاث خدمات من المستودع نفسه، ومتغيرات البيئة أعلاه لكل خدمة.
