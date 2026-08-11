import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { currentTenant } from "@/lib/request";
import "./globals.css";

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
 * client's people never see ROFT's branding on their own system. The static
 * title here is only the fallback for a page rendered outside a tenant.
 */
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await currentTenant();
  return {
    title: tenant
      ? `${tenant.displayName} — Learning`
      : "ROFT Learning Management System",
    description: tenant
      ? `Learning and competency records for ${tenant.displayName}.`
      : "Multi-tenant learning management and competency assurance.",
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
