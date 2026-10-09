import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

test("cleans encoded ATS markup from job descriptions", async () => {
  const { stripHtml } = await vite.ssrLoadModule("/lib/job-intelligence.ts");
  const description =
    '&lt;div class="content-intro"&gt;&lt;div class="c-message__blocks"&gt;Reddit is a community of communities. It&rsquo;s built on shared interests, passion, and trust.&lt;/div&gt;&lt;/div&gt;';

  assert.equal(
    stripHtml(description),
    "Reddit is a community of communities. It’s built on shared interests, passion, and trust.",
  );
});

test("cleans double-encoded markup without losing text entities", async () => {
  const { stripHtml } = await vite.ssrLoadModule("/lib/job-intelligence.ts");
  const description =
    "&amp;lt;p&amp;gt;Security &amp;amp;amp; AI leadership&amp;lt;/p&amp;gt;";

  assert.equal(stripHtml(description), "Security & AI leadership");
});
