// Creates the district and its head (رئيسة النطاق) account. Safe to run repeatedly.
//   RASD_ADMIN_EMAIL, RASD_ADMIN_NAME, RASD_ADMIN_PASSWORD, RASD_DISTRICT_NAME
import { validators } from "@rasd/schemas";
import { supabaseAdmin } from "../src/auth.js";
import { sql } from "../src/db.js";

const email = process.env.RASD_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
const name = process.env.RASD_ADMIN_NAME?.trim() ?? "";
const password = process.env.RASD_ADMIN_PASSWORD ?? "";
const districtName = process.env.RASD_DISTRICT_NAME?.trim() || "النطاق الإشرافي";

async function findAuthUser(target: string) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find(item => item.email?.toLowerCase() === target);
    if (user || data.users.length < 1000) return user ?? null;
  }
}

try {
  if (!email || validators.email(email)) throw new Error("RASD_ADMIN_EMAIL must be a @moe.gov.sa address");
  if (!name) throw new Error("RASD_ADMIN_NAME is required");

  const [existing] = await sql`select id, role from profiles where email = ${email}`;
  if (existing) {
    console.log(`profile already exists for ${email} (role: ${existing.role}) — nothing to do`);
  } else {
    let user = await findAuthUser(email);
    if (!user) {
      if (password.length < 12) throw new Error("RASD_ADMIN_PASSWORD must be at least 12 characters");
      const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
      if (error) throw error;
      user = data.user;
      console.log(`created auth user ${email}`);
    }
    await sql.begin(async tx => {
      const [district] = await tx`insert into districts ${tx({ name: districtName })} returning id`;
      await tx`insert into profiles ${tx({ id: user!.id, districtId: district.id, role: "head", name, email })}`;
    });
    console.log(`created district "${districtName}" with head ${name} <${email}>`);
  }
} finally {
  await sql.end();
}
