import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const tasks = {
  install: [["ams", "npm", ["ci"]], ["api", "npm", ["ci"]], ["whatsapp-microservice", "npm", ["ci"]]],
  build: [["ams", "npm", ["run", "build"]], ["whatsapp-microservice", "npm", ["run", "build"]]],
  test: [["ams", "npm", ["test"]], ["api", "npm", ["test"]], ["whatsapp-microservice", "npm", ["run", "test:unit"]]],
  "whatsapp-key": [["whatsapp-microservice", "docker", ["compose", "--project-name", "workforce-whatsapp", "exec", "-T", "api", "node", "dist/cli.js", "api-key"]]],
  "whatsapp-up": [["whatsapp-microservice", "docker", ["compose", "--project-name", "workforce-whatsapp", "up", "--build", "-d"]]],
};
const steps = tasks[process.argv[2]];
if (!steps) throw Error("Unknown project task");
for (const [folder, command, args] of steps) {
  console.log(`\n[${folder}] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: fileURLToPath(new URL(`../${folder}/`, import.meta.url)), stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
