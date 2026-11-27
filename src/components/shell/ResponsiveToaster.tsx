"use client";

import { Toaster } from "sonner";
import { useMobileLayout } from "@/lib/hooks/useMobileLayout";

export function ResponsiveToaster() {
  const isMobile = useMobileLayout();
  return (
    <Toaster
      theme="dark"
      position={isMobile ? "top-center" : "bottom-right"}
      offset={isMobile ? "max(0.75rem, env(safe-area-inset-top))" : undefined}
      richColors
    />
  );
}
