import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./maker.css";
import "./tindie-theme.css";
import { Providers } from "@/components/Providers";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import BottomTabBar from "@/components/BottomTabBar";

const SITE_URL = "https://resource.tindie.com";
const TITLE = "Tindie Resources — Hardware Discoveries, Components & Open Hardware";
const DESC = "Daily hardware discoveries, a trusted maker directory, component search with CAD previews, open-source hardware designs and a PCB planner.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s — Tindie Resources",
  },
  description: DESC,
  applicationName: "Tindie Resources",
  keywords: [
    "hardware", "makers", "open source hardware", "electronics", "DIY electronics",
    "developer boards", "hardware directory", "maker tools", "PCB", "Tindie",
    "hardware news", "hardware discoveries", "manufacturing partners",
  ],
  authors: [{ name: "Tindie" }],
  creator: "Tindie",
  publisher: "Tindie",
  manifest: "/manifest.json",
  alternates: {
    canonical: "/",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Tindie",
  },
  icons: {
    apple: "/icons/icon-192.png",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Tindie Resources",
    title: TITLE,
    description: DESC,
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512, alt: "Tindie Resources" }],
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESC,
    images: ["/icons/icon-512.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  category: "technology",
};

export const viewport: Viewport = {
  themeColor: "#22b8c4",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

// Structured data so search engines and AI crawlers understand the site.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Tindie Resources",
  url: SITE_URL,
  description: DESC,
  publisher: {
    "@type": "Organization",
    name: "Tindie",
    url: "https://www.tindie.com",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <Providers>{children}</Providers>

        <BottomTabBar />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

