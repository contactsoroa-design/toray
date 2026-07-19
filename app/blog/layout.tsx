import Link from "next/link";
import type { ReactNode } from "react";

export default function BlogLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background font-sans text-bone selection:bg-sage/40">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(111,158,124,0.18),_transparent_55%)]"
      />
      <header className="relative z-10 border-b border-hairline">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            href="/"
            className="font-serif text-[22px] tracking-[-0.02em] text-bone transition hover:text-mint"
          >
            ToRay<span className="text-mint">.</span>
          </Link>
          <nav aria-label="Blog">
            <Link
              href="/blog"
              className="text-sm text-bone-muted transition hover:text-bone"
            >
              Blog
            </Link>
          </nav>
        </div>
      </header>
      <main className="relative z-10">{children}</main>
      <footer className="relative z-10 border-t border-hairline">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-4 text-[12px] text-bone-muted sm:px-6">
          <span>© 2026 ToRay</span>
          <div className="flex items-center gap-4">
            <Link href="/blog" className="transition hover:text-bone">
              Blog
            </Link>
            <Link href="/" className="transition hover:text-bone">
              Scanner
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
