# ربط الخدمات الإنتاجية

يعمل المشروع محلياً بوضع العرض دون أسرار. لتفعيل البيئة الإنتاجية:

1. أنشئ قاعدة Neon وفعّل `pgvector`، ثم عيّن `DATABASE_URL`.
2. أنشئ تطبيق Clerk وأضف `role`, `clusterId`, `districtId` إلى public metadata وقالب JWT.
3. أنشئ حاوية R2 خاصة واضبط CORS للواجهة، ثم أضف مفاتيح R2.
4. تحقق من نطاق الإرسال في Resend وأضف `RESEND_API_KEY`.
5. أضف مفتاح Gemini ومعرّفات النماذج في متغيرات البيئة؛ لا تثبّت أسماء النماذج داخل المصدر.
6. استخدم مفتاحاً عشوائياً مستقلاً في `PII_ENCRYPTION_KEY` ولا تضع بيانات شخصية حقيقية في وضع العرض.

الـ API الحالي يقدم عقوداً محلية قابلة للاختبار. أما البيانات فيه فهي مؤقتة داخل الذاكرة إلى أن يتم تزويد اتصال Neon.

## عقود جاهزة

- `GET /health`
- `GET /api/overview`
- `PUT /api/schools/:id/absence`
- `POST /api/visits`
- `POST /api/uploads/presign`
- `GET /api/ai/summary`
- `GET /events`
