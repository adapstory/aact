/// <reference types="svelte" />

// Vite's `?worker` import returns a Worker constructor with the
// chunk URL baked in. The default `vite/client` triple-slash
// directive pulls these declarations in for projects that include
// it; we don't include the full client surface (the SPA doesn't
// touch import.meta.env, hot reload helpers, etc.) so we declare
// just the worker variant directly.
declare module "*?worker" {
  const WorkerConstructor: {
    new (options?: { name?: string }): Worker;
  };
  export default WorkerConstructor;
}
