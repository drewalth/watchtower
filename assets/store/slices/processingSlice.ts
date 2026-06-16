import type { AppStateCreator, ProcessingSlice } from "./types";

export const createProcessingSlice: AppStateCreator<ProcessingSlice> = (
  set,
) => ({
  processingStages: [],
  processingAllDone: false,

  setProcessing: (stages, allDone) =>
    set((s) => {
      s.processingStages = stages;
      s.processingAllDone = allDone;
    }),
});
