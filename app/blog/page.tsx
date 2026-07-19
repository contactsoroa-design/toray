import type { Metadata } from "next";
import Link from "next/link";
import { getAllBlogPosts } from "@/lib/blog-posts";

export const metadata: Metadata = {
  title: "Blog — ToRay AI Spend Guides",
  description:
    "Practical guides for OpenAI API budgets, Claude API cost, Cursor Pro spend, and managing AI tooling without invoice surprises.",
  alternates: {
    canonical: "/blog",
  },
};

function formatDate(isoDate: string) {
  return new Date(`${isoDate}T12:00:00.000Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function BlogIndexPage() {
  const posts = getAllBlogPosts();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="max-w-2xl">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-sage-soft">
          Blog
        </p>
        <h1 className="mt-3 font-serif text-4xl font-medium tracking-[-0.02em] text-bone md:text-5xl">
          Guides for AI spend you can actually operate
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-bone-muted">
          Field notes for developers tracking OpenAI, Anthropic, Cursor, and
          Copilot costs — written to rank for the searches that show up before
          the invoice does.
        </p>
      </header>

      <section aria-label="Articles" className="mt-12 space-y-5">
        {posts.map((post) => (
          <article
            key={post.slug}
            className="rounded-[28px] border border-hairline bg-surface p-6 transition hover:border-sage-soft/35 md:p-7"
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-sage-soft">
              {post.keyword}
            </p>
            <h2 className="mt-3 font-serif text-2xl tracking-[-0.02em] text-bone md:text-[1.75rem]">
              <Link
                href={`/blog/${post.slug}`}
                className="transition hover:text-mint"
              >
                {post.title}
              </Link>
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-bone-muted">
              {post.description}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-bone-muted">
              <time dateTime={post.publishedAt}>
                {formatDate(post.publishedAt)}
              </time>
              <span>{post.author}</span>
              <Link
                href={`/blog/${post.slug}`}
                className="text-sage-soft underline-offset-4 transition hover:text-bone hover:underline"
              >
                Read article
              </Link>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
