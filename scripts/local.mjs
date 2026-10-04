// Runs Rasd locally in production mode: builds the web app, then starts the API (4000) and the web app (3000).
// Usage: pnpm local            (build + start)
//        pnpm local --no-build (start the last build)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";

const isWindows = process.platform === "win32";
const children = [];

const lan = Object.values(networkInterfaces()).flat()
  .filter(address => address && address.family === "IPv4" && !address.internal)
  .map(address => `http://${address.address}:3000`);

// Links in the messages the assistant prepares for members must open on their phones, so unless apps/api/.env
// sets APP_URL, use this computer's Wi-Fi address instead of "localhost".
const apiEnvFile = new URL("../apps/api/.env", import.meta.url);
const apiEnv = existsSync(apiEnvFile) ? readFileSync(apiEnvFile, "utf8") : "";
const childEnv = { ...process.env, FORCE_COLOR: "1" };
if (!process.env.APP_URL && !/^\s*APP_URL\s*=\s*\S/m.test(apiEnv) && lan[0]) childEnv.APP_URL = lan[0];

function run(name, color, args) {
  const child = spawn("pnpm", args, { shell: isWindows, env: childEnv });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = stream => stream.on("data", chunk => {
    for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) process.stdout.write(prefix + line + "\n");
  });
  pipe(child.stdout);
  pipe(child.stderr);
  child.on("exit", code => {
    console.log(`${prefix}stopped (${code ?? "signal"})`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (isWindows) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (!process.argv.includes("--no-build")) {
  console.log("Building the web app…");
  const build = spawnSync("pnpm", ["--filter", "@rasd/web", "build"], { stdio: "inherit", shell: isWindows });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

run("api", "36", ["--filter", "@rasd/api", "start"]);
run("web", "35", ["--filter", "@rasd/web", "start", "-p", "3000"]);

setTimeout(() => {
  console.log("\n  رَصد يعمل الآن");
  console.log("  على هذا الجهاز:  http://localhost:3000");
  for (const url of lan) console.log(`  من الجوال (نفس الواي فاي):  ${url}`);
  console.log("  للإيقاف: Ctrl + C\n");
}, 4000);
