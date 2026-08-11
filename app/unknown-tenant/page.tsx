export default function UnknownTenantPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold">
          This address is not in use
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          No organisation is set up at this web address, or its access has been
          suspended. Check the address you were given, or contact whoever
          arranged your training.
        </p>
      </div>
    </main>
  );
}
