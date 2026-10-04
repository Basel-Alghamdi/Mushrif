// Creates the district and its head (رئيسة النطاق) account. Safe to run repeatedly.
//   RASD_ADMIN_EMAIL, RASD_ADMIN_NAME, RASD_ADMIN_PASSWORD (required, ≥ 8 characters), RASD_DISTRICT_NAME
// The head always gets her password here: unlike members, her account can never be claimed at first sign-in.
import { validators } from "@rasd/schemas";
import { MIN_PASSWORD, findAuthUserByEmail } from "../src/accounts.js";
import { supabaseAdmin } from "../src/auth.js";
import { sql } from "../src/db.js";
import { cleanText, normalizeEmail } from "../src/parse.js";

const email = normalizeEmail(process.env.RASD_ADMIN_EMAIL ?? "");
const name = cleanText(process.env.RASD_ADMIN_NAME ?? "");
const password = process.env.RASD_ADMIN_PASSWORD ?? "";
const districtName = cleanText(process.env.RASD_DISTRICT_NAME ?? "") || "النطاق الإشرافي";

try {
  if (validators.loginEmail(email)) throw new Error("RASD_ADMIN_EMAIL must be an email address");
  if (!name) throw new Error("RASD_ADMIN_NAME is required");

  const [existing] = await sql`select id, role from profiles where email = ${email}`;
  if (existing) {
    console.log(`profile already exists for ${email} (role: ${existing.role}) — nothing to do`);
  } else {
    if (password.length < MIN_PASSWORD) throw new Error(`RASD_ADMIN_PASSWORD is required (at least ${MIN_PASSWORD} characters)`);
    let user = await findAuthUserByEmail(email);
    if (!user) {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name }, app_metadata: { rasd: true } });
      if (error) throw error;
      user = data.user;
      console.log(`created auth user ${email}`);
    } else {
      // An existing sign-in account gets the configured password, so nobody else can know or claim it.
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
      if (error) throw error;
    }
    await sql.begin(async tx => {
      const [district] = await tx`insert into districts ${tx({ name: districtName })} returning id`;
      await tx`insert into profiles ${tx({ id: user!.id, districtId: district.id, role: "head", name, email, activatedAt: new Date() })}`;
    });
    console.log(`created district "${districtName}" with head ${name} <${email}>`);
  }
} finally {
  await sql.end();
}
