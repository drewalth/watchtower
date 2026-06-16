import { ThemeProvider } from "next-themes";

import { AppInitializer } from "@/components/AppInitializer";
import { Toaster } from "@/components/ui/sonner";
import { useIngestionStatus } from "@/hooks/useIngestionStatus";

export function App() {
  useIngestionStatus();
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <div className="h-screen w-screen">
        <AppInitializer />
        <Toaster position="bottom-right" richColors />
      </div>
    </ThemeProvider>
  );
}
