import { ThemeProvider } from "next-themes";

import { AppInitializer } from "@/components/AppInitializer";
import { Toaster } from "@/components/ui/sonner";
import { useProcessingStatus } from "@/hooks/useProcessingStatus";

export function App() {
  useProcessingStatus();
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
