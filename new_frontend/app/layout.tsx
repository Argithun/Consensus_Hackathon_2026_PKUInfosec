import { EnvVarWarning } from "@/components/env-var-warning";
import HeaderAuth from "@/components/header-auth";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { WalletProvider } from "@/components/wallet/wallet-provider";
import { WalletConnectButton } from "@/components/wallet/wallet-connect-button";
import { hasEnvVars } from "@/utils/supabase/check-env-vars";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const metadataBase = process.env.VERCEL_URL ? new URL(`https://${process.env.VERCEL_URL}`) : undefined;

// Bump this when changing `app/favicon.ico` to bypass aggressive browser caching.
const FAVICON_VERSION = "1";

export const metadata: Metadata = {
  metadataBase,
  title: "Aegisflow",
  description: "The fastest way to build apps with Next.js and Supabase",
  icons: {
    icon: [{ url: `/favicon.ico?v=${FAVICON_VERSION}` }],
    shortcut: [{ url: `/favicon.ico?v=${FAVICON_VERSION}` }],
  },
};

const geistSans = Geist({
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={geistSans.className} suppressHydrationWarning>
      <body className="bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <WalletProvider>
            <main className="min-h-screen flex flex-col items-center">
              <div className="flex-1 w-full flex flex-col gap-20 items-center">
                <nav className="w-full flex justify-center border-b border-b-foreground/10 h-16">
                  <div className="w-full max-w-5xl flex justify-end items-center p-3 px-5 text-sm">
                    <div className="flex items-center gap-3">
                      {!hasEnvVars ? <EnvVarWarning /> : <HeaderAuth />}
                      <WalletConnectButton />
                    </div>
                  </div>
                </nav>
                <div className="flex flex-col gap-20 max-w-5xl p-5">{children}</div>

                <footer className="w-full flex items-center justify-center border-t mx-auto text-center text-xs gap-8 py-16">
                  <p>
                    Powered by{" "}
                    <a
                      target="_blank"
                      href="https://www.pku.edu.cn/"
                      className="font-bold hover:underline"
                      rel="noreferrer noopener"
                    >
                      Peking University
                    </a>
                  </p>
                  <ThemeSwitcher />
                </footer>
              </div>
            </main>
          </WalletProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
