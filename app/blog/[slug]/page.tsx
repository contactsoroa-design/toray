import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAllBlogPosts,
  getBlogPostBySlug,
  getBlogSlugs,
} from "@/lib/blog-posts";

type BlogPostPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return getBlogSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPostBySlug(slug);
  if (!post) {
    return { title: "Article not found — ToRay" };
  }

  return {
    title: `${post.title} — ToRay Blog`,
    description: post.description,
    keywords: [post.keyword],
    alternates: {
      canonical: `/blog/${post.slug}`,
    },
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      publishedTime: post.publishedAt,
    },
  };
}

function formatDate(isoDate: string) {
  return new Date(`${isoDate}T12:00:00.000Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = getBlogPostBySlug(slug);
  if (!post) notFound();

  const related = getAllBlogPosts()
    .filter((item) => item.slug !== post.slug)
    .slice(0, 2);

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <nav aria-label="Breadcrumb" className="text-[12px] text-bone-muted">
        <Link href="/blog" className="transition hover:text-bone">
          Blog
        </Link>
        <span aria-hidden className="mx-2 text-bone-muted/50">
          /
        </span>
        <span className="text-bone-muted/80">{post.keyword}</span>
      </nav>

      <header className="mt-6 max-w-2xl">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-sage-soft">
          {post.keyword}
        </p>
        <h1 className="mt-3 font-serif text-4xl font-medium tracking-[-0.02em] text-bone md:text-5xl">
          {post.title}
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-bone-muted">
          {post.description}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-bone-muted">
          <time dateTime={post.publishedAt}>
            {formatDate(post.publishedAt)}
          </time>
          <span>{post.author}</span>
        </div>
      </header>

      <div
        className="prose prose-invert prose-lg mt-10 max-w-none prose-headings:font-serif prose-headings:tracking-[-0.02em] prose-headings:text-bone prose-p:text-bone-muted prose-li:text-bone-muted prose-strong:text-bone prose-a:text-sage-soft prose-a:no-underline hover:prose-a:text-mint prose-hr:border-hairline"
        dangerouslySetInnerHTML={{ __html: post.contentHtml }}
      />

      <aside className="mt-12 rounded-[28px] border border-sage/35 bg-sage/10 px-5 py-5 md:px-6">
        <p className="font-serif text-xl text-bone">
          See your AI burn before the card does
        </p>
        <p className="mt-2 text-sm leading-relaxed text-bone-muted">
          Scan OpenAI or Anthropic billing screenshots free, then track the rest
          of your stack in one dashboard.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex rounded-full bg-sage px-4 py-2 text-sm font-medium text-bone transition hover:bg-sage-glow"
        >
          Open ToRay scanner
        </Link>
      </aside>

      {related.length > 0 && (
        <section aria-label="More articles" className="mt-12">
          <h2 className="font-serif text-2xl tracking-[-0.02em] text-bone">
            More from the blog
          </h2>
          <ul className="mt-4 space-y-3">
            {related.map((item) => (
              <li key={item.slug}>
                <Link
                  href={`/blog/${item.slug}`}
                  className="text-[15px] text-sage-soft underline-offset-4 transition hover:text-bone hover:underline"
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
