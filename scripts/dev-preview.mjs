import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
const args = process.argv.slice(2);
// Managed preview serves the validated build; ordinary npm run dev retains HMR.
const managedPreview = args.includes("--strictPort");
const mode = managedPreview ? "start" : "dev";
const out = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--strictPort") continue;
  out.push(args[i] === "--host" ? "--hostname" : args[i]);
}
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", mode, ...out],
  { stdio: ["inherit", "pipe", "pipe"], env: {...process.env, NODE_ENV: managedPreview ? "production" : "development"} },
);
const log = createWriteStream(".preview.log", { flags: "a" });
child.stdout.pipe(process.stdout);
child.stdout.pipe(log);
child.stderr.pipe(process.stderr);
child.stderr.pipe(log);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
