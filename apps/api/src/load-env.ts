import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Local development reads the repo-root .env; on Railway the variables come from the service settings.
// Variables already present in the process environment always win over the file.
// RASD_ENV_FILE points at a different file (e.g. an isolated test environment).
const file = process.env.RASD_ENV_FILE?.trim() || fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(file)) process.loadEnvFile(file);
