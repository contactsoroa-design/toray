/**
 * Static blog posts for SEO / future Outrank.so (or similar) ingestion.
 * Swap or extend this array — no database required.
 */
export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  keyword: string;
  publishedAt: string;
  author: string;
  /** HTML body ready for prose rendering / external CMS import */
  contentHtml: string;
};

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "track-stop-openai-api-budget-spikes",
    title: "How to track and stop OpenAI API budget spikes instantly",
    description:
      "A practical playbook for catching OpenAI API budget spikes before they hit your card — screenshot scanning, spend caps, and a single dashboard for usage-based costs.",
    keyword: "openai api budget",
    publishedAt: "2026-07-10",
    author: "ToRay",
    contentHtml: `
      <p>If you ship with the OpenAI API, the most expensive surprise is rarely the model choice — it is an unnoticed <strong>OpenAI API budget</strong> spike from retries, eval loops, or a feature that suddenly went viral overnight.</p>
      <h2>Why OpenAI API budgets spike</h2>
      <p>Usage-based billing compounds quietly. A single agentic workflow can multiply token volume. Without a current-period total in front of you, “we’ll check the invoice later” becomes a five-figure card charge.</p>
      <h2>See the period total in seconds</h2>
      <p>Open the OpenAI Platform billing or usage screen, capture the current-period total, and drop the screenshot into <a href="/">ToRay</a>. Vision reads the USD total so you do not retype numbers from a busy console.</p>
      <h2>Stop the spike before month-end</h2>
      <ul>
        <li>Track OpenAI API alongside the rest of your stack in one place.</li>
        <li>Set a monthly budget ceiling so burn rate is visible early.</li>
        <li>Compare usage-based pace against fixed subscriptions on the same dashboard.</li>
      </ul>
      <p>Free Instant Scanner covers OpenAI Platform screenshots so you can validate the workflow before upgrading. When you are ready for outlook and multi-provider Vision, ToRay Pro unlocks the rest.</p>
      <h2>Key takeaway</h2>
      <p>Controlling your <strong>openai api budget</strong> starts with a truthful current-period number — not a spreadsheet you update once a quarter.</p>
    `,
  },
  {
    slug: "anthropic-claude-pro-vs-api-cost",
    title: "Anthropic Claude Pro vs API: Which is more cost-effective for teams?",
    description:
      "Compare Claude Pro subscription spend with Claude API usage costs for teams — when seats win, when tokens win, and how to track both without guesswork.",
    keyword: "claude api cost",
    publishedAt: "2026-07-12",
    author: "ToRay",
    contentHtml: `
      <p>Teams evaluating Anthropic usually ask the same question: is Claude Pro cheaper than paying <strong>Claude API cost</strong> for production workloads? The honest answer depends on how you work — chat seats versus metered tokens.</p>
      <h2>Claude Pro is predictable</h2>
      <p>A Pro seat is a fixed monthly line item. Great for researchers and PMs who live in the chat UI. Painful when five engineers each need a seat but only call the API from CI.</p>
      <h2>API cost scales with usage</h2>
      <p>The Claude API shines for products and pipelines. You pay for what you run. That is also why <strong>claude api cost</strong> can jump when a batch job retries or a new prompt template doubles context.</p>
      <h2>A simple decision frame</h2>
      <ol>
        <li>Mostly human chat and drafting → prefer Claude Pro seats.</li>
        <li>Product features, agents, or eval harnesses → prefer API with a hard monthly budget.</li>
        <li>Mixed teams → track both on one dashboard so finance sees the whole Anthropic bill.</li>
      </ol>
      <p>With ToRay, you can scan Anthropic Console usage screenshots on the free plan and keep Claude Pro as a tracked subscription line. That way seat cost and API burn sit side by side.</p>
      <h2>Key takeaway</h2>
      <p>“More cost-effective” is not a slogan — it is whichever line stays under your budget while the team ships. Measure both before you standardize.</p>
    `,
  },
  {
    slug: "manage-cursor-pro-github-copilot-spend",
    title:
      "The ultimate developer dashboard to manage Cursor Pro and GitHub Copilot spend",
    description:
      "How engineering teams manage Cursor Pro and GitHub Copilot spend alongside API usage — one dashboard for seats, overages, and AI tool burn.",
    keyword: "manage cursor pro spend",
    publishedAt: "2026-07-15",
    author: "ToRay",
    contentHtml: `
      <p>IDE copilots feel cheap until finance asks why AI tooling is a top-five SaaS line. If you need to <strong>manage Cursor Pro spend</strong> next to GitHub Copilot and your model APIs, scattered invoices are not a strategy.</p>
      <h2>Seats hide the real story</h2>
      <p>Cursor Pro and Copilot are often billed per seat, with usage or premium-request overages on top. Teams that only watch seat count miss the month the overage line quietly doubles.</p>
      <h2>One dashboard for the whole AI stack</h2>
      <p>ToRay is built for developers who already juggle OpenAI, Anthropic, Cursor, and Copilot. Track fixed subscriptions and usage-based tools together, set a budget, and keep the current-period picture honest.</p>
      <ul>
        <li>Add Cursor Pro and GitHub Copilot as tracked tools.</li>
        <li>Scan API consoles when usage moves faster than seats.</li>
        <li>Use ToRay Pro when you want custom tool names, outlook, and extra Vision providers.</li>
      </ul>
      <h2>Operating cadence that works</h2>
      <p>Once a week, refresh totals. Once a month, compare budget headroom before renewals. That cadence is enough to <strong>manage cursor pro spend</strong> without building an internal FinOps tool.</p>
      <h2>Key takeaway</h2>
      <p>Copilot and Cursor are product multipliers — treat their cost like production infrastructure, not a personal expense buried in a card statement.</p>
    `,
  },
];

export function getAllBlogPosts(): BlogPost[] {
  return [...BLOG_POSTS].sort((a, b) =>
    a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0,
  );
}

export function getBlogPostBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((post) => post.slug === slug);
}

export function getBlogSlugs(): string[] {
  return BLOG_POSTS.map((post) => post.slug);
}
