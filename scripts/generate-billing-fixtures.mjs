import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPng } from "./lib/png-fixture.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "test/billing-golden/fixtures");

mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, "real"), { recursive: true });

function write(name, width, height, paint) {
  const file = join(outDir, name);
  writeFileSync(file, createPng(width, height, paint));
  console.log(`wrote ${name}`);
}

write("openai-platform-total.png", 960, 600, (g) => {
  g.fill(0, 0, 960, 600, [13, 13, 13]);
  g.text(40, 36, "OpenAI Platform", [255, 255, 255], 3);
  g.text(40, 90, "platform.openai.com/settings/organization/billing", [142, 142, 142], 2);
  g.text(40, 140, "Usage  Billing  Limits", [255, 255, 255], 2);
  g.text(40, 190, "Billing period: Jul 1 - Jul 31, 2026", [229, 231, 235], 2);
  g.text(40, 250, "Total spend", [255, 255, 255], 2);
  g.text(40, 300, "$142.50", [16, 163, 127], 5);
  g.text(40, 380, "Credits remaining $25.00", [142, 142, 142], 2);
  g.text(40, 430, "gpt-4o $88.20   gpt-4.1 $54.30", [142, 142, 142], 2);
});

write("anthropic-console-total.png", 960, 600, (g) => {
  g.fill(0, 0, 960, 600, [11, 15, 25]);
  g.text(40, 36, "Anthropic Console", [255, 255, 255], 3);
  g.text(40, 90, "console.anthropic.com  Usage  Billing", [156, 163, 175], 2);
  g.text(40, 160, "Current period: Jul 1 - Jul 31, 2026", [229, 231, 235], 2);
  g.text(40, 230, "Total Spend", [255, 255, 255], 2);
  g.text(40, 280, "$87.40", [52, 211, 153], 5);
  g.text(40, 370, "Credits remaining: $500.00", [156, 163, 175], 2);
  g.text(40, 420, "claude-opus-4: $12.10", [156, 163, 175], 2);
});

write("chatgpt-plus-settings.png", 960, 600, (g) => {
  g.fill(0, 0, 960, 600, [33, 33, 33]);
  g.text(40, 40, "ChatGPT", [255, 255, 255], 3);
  g.text(40, 100, "Settings  Account", [180, 180, 180], 2);
  g.text(40, 180, "ChatGPT Plus", [255, 255, 255], 3);
  g.text(40, 250, "$20 / month", [16, 163, 127], 4);
  g.text(40, 330, "chatgpt.com  Manage my subscription", [180, 180, 180], 2);
});

write("random-landscape.png", 960, 600, (g) => {
  g.fill(0, 0, 960, 280, [135, 206, 235]);
  g.fill(0, 280, 960, 320, [34, 139, 34]);
  g.fill(780, 50, 90, 90, [255, 215, 0]);
  g.text(40, 40, "Weekend hike", [255, 255, 255], 3);
  g.text(40, 100, "Photo from camera roll", [255, 255, 255], 2);
  g.text(40, 150, "$0 meaning nothing", [255, 255, 255], 2);
});

write("stripe-receipt.png", 960, 600, (g) => {
  g.fill(0, 0, 960, 600, [250, 250, 250]);
  g.text(40, 40, "Stripe", [99, 91, 255], 3);
  g.text(40, 110, "Receipt", [20, 20, 20], 3);
  g.text(40, 180, "Invoice total", [80, 80, 80], 2);
  g.text(40, 240, "$49.00", [20, 20, 20], 5);
  g.text(40, 340, "Payment succeeded", [80, 80, 80], 2);
});

write("midjourney-plan.png", 960, 600, (g) => {
  g.fill(0, 0, 960, 600, [18, 18, 24]);
  g.text(40, 40, "Midjourney", [255, 255, 255], 3);
  g.text(40, 110, "Plan billing", [180, 180, 190], 2);
  g.text(40, 190, "Standard Plan", [255, 255, 255], 3);
  g.text(40, 260, "$30 / month", [200, 160, 255], 4);
});

writeFileSync(
  join(outDir, "real/.gitkeep"),
  "# Drop consented real screenshots here. They are gitignored.\n",
);

console.log("fixtures ready in test/billing-golden/fixtures");
