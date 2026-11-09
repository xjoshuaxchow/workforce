import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const args = [
  "compose",
  "-p",
  "whatsapp-microservice-smoke",
  "-f",
  "compose.yaml",
  "-f",
  "compose.smoke.yaml",
];
function docker(extra, input) {
  const result = spawnSync("docker", [...args, ...extra], {
    stdio: input ? ["pipe", "inherit", "inherit"] : "inherit",
    input,
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(`Docker smoke command failed (${extra[0]})`);
}
let success = false;
try {
  docker(["up", "-d", "--build", "--wait", "--wait-timeout", "120"]);
  docker(["stop", "worker"]); // The smoke test never sends a request to real Meta.
  docker(
    ["exec", "-T", "api", "node", "--input-type=module"],
    readFileSync(new URL("./smoke-seed.mjs", import.meta.url), "utf8"),
  );
  docker(["down"]); // Keep named volumes to verify a complete container recreation.
  docker(["up", "-d", "--wait", "--wait-timeout", "120"]);
  docker(
    ["exec", "-T", "api", "node", "--input-type=module"],
    readFileSync(new URL("./smoke-verify.mjs", import.meta.url), "utf8"),
  );
  success = true;
} finally {
  docker(["down", "--volumes", "--remove-orphans"]); // Only the isolated smoke project.
}
if (success)
  console.log(
    "Compose smoke test passed: bootstrap, API, SQL, worker health, credentials, and volumes.",
  );
