<script lang="ts">
  import { getContext } from "svelte";

  import { Handle, Position, type NodeProps } from "@xyflow/svelte";

  import { VIEW_ACTIONS, type ViewActions } from "./actions.ts";

  interface ElementNodeData {
    name: string;
    label: string;
    kind: string;
    description: string;
    external: boolean;
    technology: string;
  }

  let { data, selected }: NodeProps<{ data: ElementNodeData }> = $props();

  const actions = getContext<ViewActions>(VIEW_ACTIONS);

  // Simon Brown / c4model.com canonical palette: deeper blue for
  // higher-level abstractions, fading to lighter shades as we drill
  // down. Externals collapse to neutral slate so they read as
  // "someone else's box."
  const palette = (kind: string, external: boolean): string => {
    if (external) return "#475569";
    if (kind === "System") return "#1168bd";
    if (kind === "Container") return "#438dd5";
    if (kind === "Component") return "#85bbf0";
    return "#1168bd";
  };
  const fill = $derived(palette(data.kind, data.external));
  const textColor = $derived(
    data.kind === "Component" && !data.external ? "#0f172a" : "#f8fafc",
  );
</script>

<div
  class="el"
  class:external={data.external}
  class:is-selected={selected}
  style:--fill={fill}
  style:--text={textColor}
  role="button"
  tabindex="0"
  onclick={() => actions?.selectElement(data.name)}
  onkeydown={(event) => {
    if (event.key === "Enter") actions?.selectElement(data.name);
  }}
>
  <Handle type="target" position={Position.Left} />
  <div class="head">
    <span class="kind">{data.kind}{data.external ? " · external" : ""}</span>
  </div>
  <span class="label">{data.label}</span>
  {#if data.technology}
    <span class="tech">[{data.technology}]</span>
  {/if}
  {#if data.description}
    <span class="desc">{data.description}</span>
  {/if}
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .el {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 14px 14px;
    border-radius: 12px;
    background: linear-gradient(
      180deg,
      var(--fill) 0%,
      color-mix(in srgb, var(--fill) 82%, black) 100%
    );
    color: var(--text, #f8fafc);
    box-shadow:
      0 10px 28px -18px color-mix(in srgb, var(--fill) 70%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    cursor: pointer;
    transition:
      transform 120ms ease,
      box-shadow 120ms ease;
  }
  .el:hover {
    transform: translateY(-1px);
    box-shadow:
      0 14px 36px -16px color-mix(in srgb, var(--fill) 80%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.12);
  }
  .el.is-selected {
    outline: 2px solid #38bdf8;
    outline-offset: 2px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .kind {
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--text) 70%, transparent);
    font-weight: 700;
  }
  .label {
    font-size: 14px;
    font-weight: 700;
    line-height: 1.15;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .tech {
    font-size: 10px;
    color: color-mix(in srgb, var(--text) 85%, transparent);
    font-style: italic;
  }
  .desc {
    font-size: 11px;
    line-height: 1.3;
    color: color-mix(in srgb, var(--text) 78%, transparent);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
</style>
