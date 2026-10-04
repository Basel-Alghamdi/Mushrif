// Creates sign-in accounts for the team roster (decision 3). Safe to run repeatedly: existing emails are skipped.
//   RASD_ROSTER_FILE (default apps/api/data/roster.xlsx, roster.csv or roster.json — personal data, git-ignored)
// Each member then signs in with her email and chooses her password the first time.
import { sql } from "../src/db.js";
import { loadRoster, rosterFile, seedRoster } from "../src/seed/roster.js";

try {
  const file = rosterFile();
  if (!file) throw new Error("No roster file: set RASD_ROSTER_FILE or put roster.xlsx in apps/api/data/");
  const entries = loadRoster();
  if (!entries.length) throw new Error(`No members found in ${file} (expected columns like الاسم · الصفة · البريد)`);
  const result = await seedRoster(sql, entries);
  console.log(`roster ${file}: ${result.created.length} created, ${result.existing.length} already had accounts, ${result.failed.length} failed`);
  for (const failure of result.failed) console.error(`  ${failure.email}: ${failure.error}`);
  if (result.failed.length) process.exitCode = 1;
} finally {
  await sql.end();
}
