import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ScribeAI",
  description: "AI-powered meeting transcription and scribing",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="">
      <head>
        {/* Dark mode logic loaded BEFORE page renders */}
        <Script id="theme-script" strategy="beforeInteractive">
          {`
            (function() {
              const stored = localStorage.getItem("theme");
              if (stored === "dark") {
                document.documentElement.classList.add("dark");
              } else if (stored === "light") {
                document.documentElement.classList.remove("dark");
              } else {
                if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
                  document.documentElement.classList.add("dark");
                }
              }
            })();
          `}
        </Script>
      </head>

      <body
        className={`
          ${geistSans.variable} ${geistMono.variable}
          antialiased
          bg-white text-black
          dark:bg-black dark:text-white
          transition-colors duration-300
        `}
      >
        {children}
      </body>
    </html>
  );
}
