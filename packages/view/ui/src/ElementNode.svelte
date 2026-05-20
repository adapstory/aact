<script lang="ts">
  import { Handle, Position, type NodeProps } from "@xyflow/svelte";

  interface ElementNodeData {
    name: string;
    label: string;
    kind: string;
    external: boolean;
    technology: string;
    color: string;
  }

  let { data }: NodeProps<{ data: ElementNodeData }> = $props();
</script>

<div class="el" style:--accent={data.color} class:external={data.external}>
  <Handle type="target" position={Position.Left} />
  <span class="kind">{data.kind}</span>
  <span class="label">{data.label}</span>
  {#if data.technology}
    <span class="tech">{data.technology}</span>
  {/if}
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .el {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border-radius: 8px;
    background: #0f172a;
    border: 1px solid var(--accent, #2563eb);
    color: #e2e8f0;
    box-shadow:
      0 0 0 0 transparent,
      0 4px 14px -8px rgba(0, 0, 0, 0.5);
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
  }
  .el.external {
    background: #1e293b;
    border-style: dashed;
  }
  .kind {
    display: inline-block;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--accent, #2563eb);
    color: white;
    align-self: flex-start;
    font-weight: 600;
  }
  .label {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tech {
    font-size: 11px;
    color: #94a3b8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
