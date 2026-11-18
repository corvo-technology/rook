import type { E2BComputerSize } from "../e2b-template.js";
import { buildE2BComputerTemplate, E2B_COMPUTER_SIZE_NAMES } from "../e2b-template.js";

const apiKey = process.env.E2B_API_KEY?.trim();
if (!apiKey) {
  process.stderr.write("Set E2B_API_KEY to the E2B key this deployment uses.\n");
  process.exit(1);
}

// Optional argument: one size to publish. With none, every size is published.
const requested = process.argv[2];
if (requested && !E2B_COMPUTER_SIZE_NAMES.includes(requested as E2BComputerSize)) {
  process.stderr.write(`Unknown size "${requested}". Use ${E2B_COMPUTER_SIZE_NAMES.join(", ")}.\n`);
  process.exit(1);
}
const sizes = requested ? [requested as E2BComputerSize] : E2B_COMPUTER_SIZE_NAMES;

for (const size of sizes) {
  const built = await buildE2BComputerTemplate(apiKey, {
    size,
    onBuildLogs: (line) => process.stdout.write(`${line}\n`),
  });
  process.stdout.write(`Built E2B template ${built.name} (${size}).\n`);
}
process.stdout.write("New computers use them from their next start.\n");
