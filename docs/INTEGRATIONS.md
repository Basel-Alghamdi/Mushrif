# ربط الخدمات

تعتمد رَصد على هذه الخدمات:

| الخدمة | الاستخدام |
|---|---|
| **Supabase** | قاعدة Postgres، تسجيل الدخول (Auth)، وتخزين الملفات المرفوعة (Storage) |
| **Railway** | استضافة الواجهة (`apps/web`) والـ API (`apps/api`) والعامل (`apps/worker`) |
| **Resend** | إرسال الدعوات والتذكيرات ورسائل استعادة كلمة المرور (اختياري) |
| **Claude** (اختياري) | فهم حر لأسئلة رئيسة النطاق وقراءة الملفات الممسوحة ضوئياً. بدون مفتاح يعمل المساعد بمحرك عربي مدمج |
| **OpenAI / GPT-5** (اختياري) | فهم أسئلة رئيسة النطاق وقراءة الملفات؛ يُستخدم عند ضبط `OPENAI_API_KEY` وله الأولوية على Claude |

## إعداد Supabase

1. أنشئ مشروعاً، ثم انسخ من **Project Settings → API Keys**:
   - الـ **Publishable key** (`sb_publishable_…`) إلى `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   - الـ **Secret key** (`sb_secret_…`) إلى `SUPABASE_SECRET_KEY`.
   - رابط المشروع إلى `SUPABASE_URL` و`NEXT_PUBLIC_SUPABASE_URL`.
2. من **Connect** انسخ:
   - رابط _Transaction pooler_ (المنفذ 6543) إلى `DATABASE_URL` — يستخدمه الـ API أثناء التشغيل.
   - رابط _Direct connection_ (المنفذ 5432) إلى `DIRECT_DATABASE_URL` — تستخدمه الهجرات فقط. الاتصال المباشر يعمل عبر IPv6؛ إن لم تدعمه شبكتك فاستخدم رابط _Session pooler_ بدلاً منه. إن تُرك فارغاً تستخدم الهجرات `DATABASE_URL`.
3. **Authentication → Sign In / Providers → Email**: أوقف "Allow new users to sign up". الحسابات تُنشأ فقط عبر الـ API (الإعداد الأولي، ملف الفريق، رئيسة النطاق، أو الدعوات).
4. **Authentication → URL Configuration**: اجعل Site URL رابط الواجهة، وأضف `<APP_URL>/reset-password` إلى Redirect URLs.
5. (اختياري) **Authentication → SMTP**: اربط Resend كخادم SMTP ليستخدمه Supabase عند غياب `RESEND_API_KEY`.
6. طبّق المخطط وأنشئ الحسابات:

```bash
pnpm --filter @rasd/api db:migrate      # المخطط كاملاً (يُطبّق الجديد فقط)
pnpm --filter @rasd/api bootstrap:head  # النطاق وحساب رئيسة النطاق (RASD_ADMIN_*)
pnpm --filter @rasd/api seed:roster     # حسابات المشرفات من apps/api/data/roster.xlsx — آمن للتكرار
```

المخطط في `supabase/migrations/`، ويُسجَّل ما طُبّق منه في `supabase_migrations.schema_migrations` — الجدول نفسه الذي يستخدمه Supabase CLI. تحتاج الهجرات رابط قاعدة البيانات فقط، أما إنشاء الحسابات فيحتاج أيضاً `SUPABASE_URL` و`SUPABASE_SECRET_KEY`.

حاوية التخزين الخاصة (`SUPABASE_STORAGE_BUCKET`، الافتراضي `attachments`) تُنشأ تلقائياً عند أول رفع. إن وُجدت حاوية بهذا الاسم وهي عامة (public) يحوّلها الـ API إلى خاصة ويسجّل تحذيراً، وإن تعذّر ذلك يرفض رفع الملفات حتى تُجعل خاصة.

## الدخول لأول مرة

حساب رئيسة النطاق يُنشأ بكلمة مرور (`RASD_ADMIN_PASSWORD`، ٨ أحرف على الأقل) ولا يمكن تفعيله من صفحة الدخول.

حسابات المشرفات التي تُنشأ من ملف الفريق أو من رئيسة النطاق لا تحتاج دعوة بالبريد: تكتب المشرفة بريدها في صفحة الدخول، وفي أول مرة تختار كلمة مرورها (٨ أحرف على الأقل) خلال ١٤ يوماً، وتصل رئيسة النطاق إشعار بكل تفعيل. «إعادة تعيين كلمة المرور» من ملف المشرفة يُنهي كل جلساتها ويعيدها لهذه الخطوة لمدة ٣ أيام. الطلبات العامة (التحقق من البريد، التفعيل، الاستعادة) محدودة العدد لكل عنوان IP ولكل بريد. تبقى الدعوات بالبريد ورابط الاستعادة متاحة كما هي.

## الأمان

- كل الكتابة تمر عبر الـ API الذي يتحقق من الدور والعنقود في كل طلب. العضوة لا تصل إلا لملفها، ورئيسة النطاق تقرأ نطاقها وتعدّل ملفات عضواتها (مباشرة أو عبر المساعد بعد موافقتها).
- RLS مفعّل على كل الجداول: لدور `authenticated` في Postgres صلاحية قراءة ما يخص المستخدم فقط، ولا صلاحية لدور `anon`.
- كل تعديل يُسجَّل في `audit_log` مع مصدره (الويب، الجوال، الاستيراد، المساعد)، وكل اطلاع لرئيسة النطاق على ملف عضوة كامل يُسجَّل كقراءة بيانات شخصية.
- الملفات المرفوعة تُقدَّم كتنزيل بنوع محتوى آمن (لا يُعرض HTML أو SVG داخل المنصة).
- `SUPABASE_SECRET_KEY` للخادم فقط؛ لا تضعه أبداً في متغير يبدأ بـ `NEXT_PUBLIC_`.
- ملف الفريق (`apps/api/data/roster.xlsx`) بيانات شخصية: المجلد مستثنى من git ولا يُرفع.

## الاختبارات بدون Supabase

`pnpm --filter @rasd/api test` يشغّل Postgres محلياً (embedded-postgres) مع بديل صغير لخدمات Supabase (الدخول والتخزين) — لا يلمس أي مشروع حقيقي. ولتجربة المنصة كاملة محلياً بنفس البيئة: `pnpm --filter @rasd/api stack:local` (يكتب `apps/api/data/stack/stack.env` لتشغيل الـ API والواجهة عليه عبر `RASD_ENV_FILE`). هذه البيئة للتطوير والاختبار فقط.

## المراحل القادمة

- **Railway**: ثلاث خدمات من المستودع نفسه، ومتغيرات البيئة أعلاه لكل خدمة. متغيرات `NEXT_PUBLIC_*` و`API_PROXY_TARGET` تُدمج في الواجهة وقت البناء، لذا يجب ضبطها قبل بناء خدمة الويب. في **Settings** لكل خدمة:
  - **Root Directory**: فارغ (جذر المستودع) — البناء يحتاج الحزم المشتركة في `packages/` وملف `pnpm-lock.yaml`، فتحديد `apps/…` هنا يُفشل البناء.
  - **Build / Start**: `pnpm --filter @rasd/<الخدمة> build` و`pnpm --filter @rasd/<الخدمة> start`.
  - **Watch Paths**: مجلد الخدمة (`/apps/<الخدمة>/**`) والحزم التي تستخدمها من `/packages/**`، مع `/package.json` و`/pnpm-lock.yaml` و`/pnpm-workspace.yaml` و`/tsconfig.base.json` — وإلا لا يُعاد نشر الخدمة عند تحديث الحزم المشتركة.
  - **Healthcheck Path**: `/health` للـ API و`/login` للواجهة.
  - إصدار Node يُحدَّد من `engines` في `package.json` بالجذر.
  - يرفض Railway النشر (لكل الخدمات) إذا كان في `pnpm-lock.yaml` إصدار من Next.js فيه ثغرة أمنية معروفة؛ حدّث `next` في `apps/web/package.json` عندها.
- المساعد يستخدم GPT-5 عند ضبط `OPENAI_API_KEY` و`OPENAI_CHAT_MODEL=gpt-5` في `.env` بجذر المستودع، وله الأولوية على Claude. متغيرا `OPENAI_EXTRACT_MODEL` و`OPENAI_EMBED_MODEL` محجوزان ولا يقرؤهما الكود بعد.
