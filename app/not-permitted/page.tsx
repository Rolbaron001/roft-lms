import Link from "next/link";

export default function NotPermittedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold">You do not have access to this</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          You are signed in, but this is not yours to see — either it belongs to
          someone else, or it needs a role your account does not hold. If you
          think that is wrong, ask your administrator to check.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-md px-4 py-2 text-sm font-semibold text-white"
          style={{ background: "var(--brand-primary)" }}
        >
          Back to your home page
        </Link>
      </div>
    </main>
  );
}
