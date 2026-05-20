<script lang="ts">
  import { getContext } from "svelte";

  import { Handle, Position, type NodeProps } from "@xyflow/svelte";

  import { VIEW_ACTIONS, type ViewActions } from "./actions.ts";

  interface QueueNodeData {
    name: string;
    label: string;
    kind: string;
    description: string;
    external: boolean;
    technology: string;
  }

  let { data, selected }: NodeProps<{ data: QueueNodeData }> = $props();

  const actions = getContext<ViewActions>(VIEW_ACTIONS);

  const fill = data.external ? "#475569" : "#1168bd";
</script>

<div
  class="q"
  class:external={data.external}
  class:is-selected={selected}
  style:--fill={fill}
  role="button"
  tabindex="0"
  onclick={() => actions?.selectElement(data.name)}
  onkeydown={(event) => {
    if (event.key === "Enter") actions?.selectElement(data.name);
  }}
>
  <Handle type="target" position={Position.Left} />
  <div class="body">
    <span class="kind">{data.kind}</span>
    <span class="label">{data.label}</span>
    {#if data.technology}
      <span class="tech">[{data.technology}]</span>
    {/if}
    {#if data.description}
      <span class="desc">{data.description}</span>
    {/if}
  </div>
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .q {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 0;
    /* Pipe / capsule end-caps so it reads as a queue at a glance. */
    border-radius: 999px;
    background: linear-gradient(
      180deg,
      var(--fill) 0%,
      color-mix(in srgb, var(--fill) 80%, black) 100%
    );
    color: #f8fafc;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    cursor: pointer;
    box-shadow:
      0 10px 28px -18px color-mix(in srgb, var(--fill) 70%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.1);
    transition: transform 120ms ease;
  }
  .q:hover {
    transform: translateY(-1px);
  }
  .q.is-selected {
    outline: 2px solid #38bdf8;
    outline-offset: 2px;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 14px 22px;
    overflow: hidden;
    height: 100%;
    justify-content: center;
  }
  .kind {
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(248, 250, 252, 0.78);
    font-weight: 700;
  }
  .label {
    font-size: 13px;
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
    color: rgba(248, 250, 252, 0.85);
    font-style: italic;
  }
  .desc {
    font-size: 11px;
    line-height: 1.3;
    color: rgba(248, 250, 252, 0.75);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
  }
</style>
