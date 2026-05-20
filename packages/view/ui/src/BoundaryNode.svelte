<script lang="ts">
  import { Handle, Position, type NodeProps } from "@xyflow/svelte";

  interface BoundaryNodeData {
    name: string;
    label: string;
    kind: string;
    childCount: number;
  }

  let { data }: NodeProps<{ data: BoundaryNodeData }> = $props();
</script>

<div class="boundary">
  <Handle type="target" position={Position.Left} />
  <span class="kind">{data.kind} boundary</span>
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
    border: 2px dashed #94a3b8;
    color: #e2e8f0;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  }
  .kind {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #94a3b8;
    font-weight: 600;
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
