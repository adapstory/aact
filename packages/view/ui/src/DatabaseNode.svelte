<script lang="ts">
  import { getContext } from "svelte";

  import { Handle, Position, type NodeProps } from "@xyflow/svelte";

  import { VIEW_ACTIONS, type ViewActions } from "./actions.ts";

  interface DatabaseNodeData {
    name: string;
    label: string;
    kind: string;
    description: string;
    external: boolean;
    technology: string;
  }

  let { data, selected }: NodeProps<{ data: DatabaseNodeData }> = $props();

  const actions = getContext<ViewActions>(VIEW_ACTIONS);

  // Database fill follows the C4 container/system gradient. Externals
  // drop to neutral grey per Simon Brown's reference palette so the
  // "ours vs theirs" distinction stays at a glance.
  const fill = data.external ? "#475569" : "#1168bd";
</script>

<div
  class="db"
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
  <div class="cyl-top" aria-hidden="true"></div>
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
  .db {
    position: relative;
    display: grid;
    grid-template-rows: 14px 1fr;
    padding: 0;
    border-radius: 14px 14px 22px 22px / 14px 14px 30px 30px;
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
    transition:
      transform 120ms ease,
      box-shadow 120ms ease;
  }
  .db:hover {
    transform: translateY(-1px);
  }
  .db.is-selected {
    outline: 2px solid #38bdf8;
    outline-offset: 2px;
  }
  .cyl-top {
    height: 14px;
    background: rgba(0, 0, 0, 0.18);
    border-radius: 14px 14px 50% 50% / 14px 14px 100% 100%;
    border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 14px 14px;
    overflow: hidden;
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
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
</style>
