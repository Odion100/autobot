// Proves the phase-1 loop end to end: snapshot → ref → act → verify. No vision calls.
import { createAxCore } from "./axCore.js";

const ax = createAxCore({ headless: true });

try {
  await ax.start();
  console.log("tools:", (await ax.listTools()).join(", "));

  const landing = await ax.navigate("https://example.com");
  console.log("\n--- snapshot after navigate ---");
  console.log(landing.slice(0, 600));

  const refMatch = landing.match(/link "Learn more" \[ref=(\w+)\]/);
  if (!refMatch) throw new Error("no ref found for the example.com link");
  const ref = refMatch[1];
  console.log(`\nclicking link ref=${ref}`);
  await ax.click({ element: 'link "Learn more"', ref });

  const check = await ax.verify({ snapshotIncludes: "IANA" });
  console.log("\nverify:", check.ok ? "OK — effect confirmed" : check.failures);
  if (!check.ok) process.exitCode = 1;
} finally {
  await ax.stop();
}
