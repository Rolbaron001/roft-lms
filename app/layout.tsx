import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { currentTenant } from "@/lib/request";
import "./globals.css";
import { platformName } from "@/lib/platform";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * The tab title carries the tenant's own name, resolved per request, so a
 * client's people never see the operator's branding on their own system. The
 * static title here is only the fallback for a page rendered outside a tenant,
 * and it names whoever operates this deployment rather than any one company.
 */
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await currentTenant();
  return {
    // A colon rather than the em dash this used, which house style rules out
    // in anything the platform produces (Heidi, 21 September).
    title: tenant
      ? `${tenant.displayName}: Learning`
      : `${platformName()} Learning Management System`,
    description: tenant
      ? `Learning and competency records for ${tenant.displayName}.`
      : "Multi-tenant learning management and competency assurance.",
    /*
     * The install manifest, for a provider with offline switched on and no
     * one else. It existed from 11 September and was linked from nowhere, so
     * no phone was ever offered to install the platform, which is how the
     * ranger programme's learners were meant to take it into the field.
     */
    ...(tenant?.offlineEnabled ? { manifest: "/manifest.webmanifest" } : {}),
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
