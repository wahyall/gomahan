import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Rumah Studio 3D — Arsitektur 5×17 m, Struktur SNI, Simulasi & RAB",
  description:
    "Aplikasi 3D arsitektur lokal-first berbasis data grid untuk merancang rumah 5×17 m, menguji struktur SNI, simulasi pencahayaan/udara/banjir, menghitung RAB bata & adukan, serta mengekspor paket kontraktor.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className={`${jakarta.variable} ${jetbrains.variable} font-sans antialiased bg-background text-foreground`}>
        {children}
        <Toaster theme="dark" position="bottom-right" richColors />
      </body>
    </html>
  );
}
