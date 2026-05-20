<script lang="ts">
  import { getContext } from "svelte";

  import { Handle, Position, type NodeProps } from "@xyflow/svelte";

  import { VIEW_ACTIONS, type ViewActions } from "./actions.ts";

  interface PersonNodeData {
    name: string;
    label: string;
    description: string;
    external: boolean;
    technology: string;
  }

  let { data, selected }: NodeProps<{ data: PersonNodeData }> = $props();

  const actions = getContext<ViewActions>(VIEW_ACTIONS);
</script>

<div
  class="person"
  class:external={data.external}
  class:is-selected={selected}
  role="button"
  tabindex="0"
  onclick={() => actions?.selectElement(data.name)}
  onkeydown={(event) => {
    if (event.key === "Enter") actions?.selectElement(data.name);
  }}
>
  <Handle type="target" position={Position.Left} />
  <div class="head" aria-hidden="true">
    <span class="silhouette"></span>
  </div>
  <div class="body">
    <span class="kind">Person</span>
    <span class="label">{data.label}</span>
    {#if data.description}
      <span class="desc">{data.description}</span>
    {/if}
  </div>
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .person {
    display: grid;
    grid-template-rows: 36px 1fr;
    gap: 6px;
    padding: 12px 14px 14px;
    border-radius: 14px;
    background: linear-gradient(180deg, #08427b 0%, #073768 100%);
    color: #f8fafc;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    cursor: pointer;
    box-shadow:
      0 10px 30px -18px rgba(8, 66, 123, 0.85),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    transition:
      transform 120ms ease,
      box-shadow 120ms ease;
  }
  .person:hover {
    transform: translateY(-1px);
    box-shadow:
      0 14px 40px -16px rgba(8, 66, 123, 0.95),
      inset 0 1px 0 rgba(255, 255, 255, 0.12);
  }
  .person.is-selected {
    outline: 2px solid #38bdf8;
    outline-offset: 2px;
  }
  .person.external {
    background: linear-gradient(180deg, #475569 0%, #334155 100%);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .silhouette {
    width: 30px;
    height: 30px;
    background:
      radial-gradient(circle at 50% 30%, #f8fafc 0 8px, transparent 9px),
      radial-gradient(
        ellipse at 50% 90%,
        #f8fafc 0 14px,
        transparent 14px 100%
      );
    background-repeat: no-repeat;
    opacity: 0.92;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: center;
    text-align: center;
  }
  .kind {
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(248, 250, 252, 0.75);
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
  .desc {
    font-size: 11px;
    line-height: 1.25;
    color: rgba(248, 250, 252, 0.7);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
</style>
