<script lang="ts">
  import { getContext } from "svelte";

  import { Handle, Position, type NodeProps } from "@xyflow/svelte";

  import { VIEW_ACTIONS, type ViewActions } from "./actions.ts";

  interface BoundaryNodeData {
    name: string;
    label: string;
    kind: string;
    childCount: number;
  }

  let { data }: NodeProps<{ data: BoundaryNodeData }> = $props();

  const actions = getContext<ViewActions>(VIEW_ACTIONS);

  // System boundaries get a distinct accent so they don't blend
  // with Container boundaries on Landscape view — same palette as
  // System elements, applied to the dashed border + kind chip.
  const accent =
    data.kind === "System"
      ? "#6366f1"
      : data.kind === "Component"
        ? "#14b8a6"
        : "#94a3b8";

  const onDblClick = (event: MouseEvent): void => {
    event.stopPropagation();
    actions?.enterBoundary(data.name, data.label);
  };

  const onClick = (): void => {
    actions?.selectBoundary(data.name);
  };
</script>

<div
  class="boundary"
  style:--accent={accent}
  role="button"
  tabindex="0"
  onclick={onClick}
  ondblclick={onDblClick}
  onkeydown={(event) => {
    if (event.key === "Enter")
      actions?.enterBoundary(data.name, data.label);
  }}
>
  <Handle type="target" position={Position.Left} />
  <span class="kind">
    <span class="kind-chip">{data.kind}</span>
    boundary
  </span>
  <span class="label">{data.label}</span>
  <span class="hint">
    {data.childCount} child{data.childCount === 1 ? "" : "ren"} · double-click to enter
  </span>
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .boundary {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(30, 41, 59, 0.6);
    border: 2px dashed var(--accent, #94a3b8);
    color: #e2e8f0;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    cursor: pointer;
  }
  .boundary:hover {
    background: rgba(30, 41, 59, 0.85);
  }
  .kind {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #94a3b8;
    font-weight: 600;
  }
  .kind-chip {
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--accent, #94a3b8);
    color: white;
    font-weight: 700;
  }
  .label {
    font-size: 14px;
    font-weight: 700;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    font-size: 11px;
    color: #94a3b8;
  }
</style>
