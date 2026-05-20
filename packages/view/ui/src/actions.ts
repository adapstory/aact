/**
 * Bridge between custom Svelte Flow nodes (which can't receive
 * props from App.svelte directly — Svelte Flow only forwards
 * `data` / `selected` / `dragging`) and the app-level state.
 *
 * App.svelte registers a `ViewActions` object via `setContext`.
 * Node components read it via `getContext` and call back when
 * the user interacts (single click → select, double click on a
 * boundary → drill in). Decoupling actions from data keeps the
 * `data` payload serialisable and stops nodes from re-rendering
 * just because a parent re-assigned a callback identity.
 */
export interface ViewActions {
  selectElement(name: string): void;
  selectBoundary(name: string): void;
  enterBoundary(name: string, label: string): void;
}

export const VIEW_ACTIONS = Symbol("aact-view:actions");
