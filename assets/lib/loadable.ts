import { match } from "ts-pattern";

interface Loaded<T> {
  state: "loaded";
  data: T;
}

interface Loading {
  state: "loading";
  data: null;
}

interface Reloading<T> {
  state: "reloading";
  data: T;
}

interface Initial {
  state: "initial";
  data: null;
}

interface Failed {
  state: "failed";
  error: string;
  data: null;
}

export type Loadable<T> = Loaded<T> | Loading | Reloading<T> | Initial | Failed;

export function isLoading<T>(loadable: Loadable<T>): loadable is Loading {
  return loadable.state === "loading";
}

export function isReloading<T>(
  loadable: Loadable<T>,
): loadable is Reloading<T> {
  return loadable.state === "reloading";
}

export function isInitial<T>(loadable: Loadable<T>): loadable is Initial {
  return loadable.state === "initial";
}

export function isFailed<T>(loadable: Loadable<T>): loadable is Failed {
  return loadable.state === "failed";
}

export function isLoaded<T>(loadable: Loadable<T>): loadable is Loaded<T> {
  return loadable.state === "loaded";
}

export function initialLoadable(): Initial {
  return {
    state: "initial",
    data: null,
  };
}

export function getNextLoadableState<T>(next: Loadable<T>): Loadable<T> {
  return match<Loadable<T>, Loadable<T>>(next)
    .with({ state: "initial" }, () => ({
      state: "loading",
      data: null,
    }))
    .with({ state: "loading" }, (state) => state)
    .with({ state: "reloading" }, (state) => state)
    .with({ state: "loaded" }, (state) => ({
      state: "reloading",
      data: state.data,
    }))
    .with({ state: "failed" }, (state) => ({
      state: "loading",
      data: null,
    }))
    .exhaustive();
}

export function getLoadedData<T>(loadable: Loadable<T>): T | null {
  if (isLoaded(loadable) || isReloading(loadable)) {
    return loadable.data;
  }
  return null;
}

export function extractLoadableData<Input, Output>(
  loadable: Loadable<Input>,
  fn: (input: Input) => Output,
): Loadable<Output> {
  if (loadable.state !== "loaded" && loadable.state !== "reloading") {
    return loadable;
  }
  return {
    ...loadable,
    data: fn(loadable.data),
  };
}
