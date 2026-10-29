import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nBootstrap } from "@/components/i18n-bootstrap";
import { SessionCleanup } from "@/components/shared/session-cleanup";
import { ServiceWarmer } from "@/components/shared/service-warmer";
import { FloatingChatWidget } from "@/components/floating-chat/floating-chat-widget";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Clothing Studio - Local Virtual Try-On",
  description:
    "Privacy-first AI virtual try-on studio. All processing local. No image uploads to cloud. Switch garments on photos while preserving face, body, and identity.",
  keywords: [
    "Virtual Try-On",
    "AI Clothing",
    "Local AI",
    "Privacy-First",
    "CatVTON",
    "Image Generation",
  ],
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcut: ["/favicon-32x32.png"],
    apple: [{ url: "/apple-icon-180x180.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AI Clothing Studio",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider>
          <I18nBootstrap />
          <SessionCleanup />
          <ServiceWarmer />
          {children}
          <FloatingChatWidget />
          <Toaster />
          <SonnerToaster position="top-center" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
