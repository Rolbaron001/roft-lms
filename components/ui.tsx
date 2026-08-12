/**
 * Small presentational pieces, deliberately free of any server import.
 *
 * These live apart from `app-shell` because that file reaches into the
 * database to read the unread notification count. Anything a client component
 * imports must not drag that in behind it — a single shared import is enough
 * to pull the Postgres driver into the browser bundle, which fails the build
 * with a confusing "can't resolve 'net'" rather than anything about React.
 */

export function Card({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
      {title ? (
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          {title}
        </h2>
      ) : null}
      {description ? (
        <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>
      ) : null}
      <div className={title || description ? "mt-4" : undefined}>{children}</div>
    </section>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "published" || status === "completed" || status === "active"
      ? "bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/30"
      : status === "archived" || status === "anonymised"
        ? "bg-[var(--muted)]/10 text-[var(--muted)] border-[var(--muted)]/30"
        : status === "overdue" || status === "suspended"
          ? "bg-[var(--danger)]/10 text-[var(--danger)] border-[var(--danger)]/30"
          : "bg-[var(--brand-accent)]/10 text-[var(--brand-accent)] border-[var(--brand-accent)]/40";

  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${tone}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function PrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="rounded-md px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      style={{ background: "var(--brand-primary)" }}
    >
      {children}
    </button>
  );
}

export function TextField({
  label,
  name,
  ...props
}: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium">{label}</span>
      <input
        name={name}
        {...props}
        className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30"
      />
    </label>
  );
}
