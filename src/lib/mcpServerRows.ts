/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * MCP server status row mapping for the Status UI.
 *
 * Extracted from src/App.tsx so the row-mapping logic (catalog, probe → rows,
 * and the gateway-status failure handling) is importable and testable.
 */

export type McpServerStatusTone = 'ok' | 'warn' | 'danger' | 'neutral';

export type McpServerStatusRow = {
  id: string;
  label: string;
  state: string;
  tone: McpServerStatusTone;
  detail: string;
};

export const MCP_SERVER_CATALOG: Array<{ id: string; label: string; detail: string }> = [
  { id: 'gateway', label: 'MCP Gateway', detail: 'Electron main-process dispatcher' },
  { id: 'browser', label: 'Browser (Playwright)', detail: 'Browser automation runtime' },
  { id: 'terminal', label: 'Terminal', detail: 'Guarded terminal runtime' },
  { id: 'folder', label: 'Folder', detail: 'Rooted file operations runtime' },
  { id: 'python', label: 'Python sandbox', detail: 'Docker-isolated Python runtime' },
  { id: 'openscad', label: 'OpenSCAD', detail: 'OpenSCAD compile runtime' },
  { id: 'blender_plate', label: 'Blender Plate', detail: 'Blender build runtime' }
];

export function defaultMcpServerRows(): McpServerStatusRow[] {
  return MCP_SERVER_CATALOG.map((entry) => ({
    id: entry.id,
    label: entry.label,
    state: 'unknown',
    tone: 'neutral',
    detail: entry.detail
  }));
}

export function buildMcpServerRows(payload: unknown): McpServerStatusRow[] {
  const rows = defaultMcpServerRows();
  const rowById = new Map(rows.map((row) => [row.id, row]));

  if (!(payload && typeof payload === 'object' && !Array.isArray(payload))) {
    return rows;
  }

  const status = payload as {
    checkedAt?: string;
    gateway?: { ok?: unknown; note?: unknown };
    services?: Record<string, unknown>;
  };

  const gatewayRow = rowById.get('gateway');
  if (gatewayRow) {
    const gatewayOk = Boolean(status.gateway?.ok);
    gatewayRow.state = gatewayOk ? 'online' : 'offline';
    gatewayRow.tone = gatewayOk ? 'ok' : 'danger';
    if (typeof status.gateway?.note === 'string' && status.gateway.note.trim()) {
      gatewayRow.detail = status.gateway.note;
    }
  }

  const services = status.services && typeof status.services === 'object' ? status.services : {};
  for (const [serviceId, serviceValue] of Object.entries(services)) {
    const row = rowById.get(serviceId);
    if (!row || !serviceValue || typeof serviceValue !== 'object') continue;

    const service = serviceValue as {
      ok?: unknown;
      note?: unknown;
      root?: unknown;
      activeSessionCount?: unknown;
      executable?: unknown;
      docker?: unknown;
    };

    const ok = Boolean(service.ok);
    row.state = ok ? 'online' : 'offline';
    row.tone = ok ? 'ok' : 'danger';

    if (serviceId === 'browser') {
      const activeSessionCount = Number(service.activeSessionCount ?? 0);
      row.state = activeSessionCount > 0 ? 'active' : (ok ? 'ready' : 'offline');
      row.detail = `Active sessions: ${Number.isFinite(activeSessionCount) ? activeSessionCount : 0}`;
      row.tone = ok ? 'ok' : 'danger';
      continue;
    }

    if (typeof service.note === 'string' && service.note.trim()) {
      row.detail = service.note;
    } else if (typeof service.root === 'string' && service.root.trim()) {
      row.detail = `Root: ${service.root}`;
    }

    if (serviceId === 'python' && typeof service.docker === 'string' && service.docker.trim()) {
      row.detail = service.docker;
      if (ok) row.tone = 'ok';
      if (!ok) row.tone = 'warn';
    }

    if ((serviceId === 'openscad' || serviceId === 'blender_plate') && typeof service.executable === 'string' && service.executable.trim()) {
      row.detail = `${row.detail} (${service.executable})`;
    }
  }

  return rows;
}

/**
 * Applies the `mcpGatewayStatus()` request-failure handling: only the gateway
 * row is forced offline (with the failure message as its detail) while every
 * other row preserves its last-known state, tone, and detail.
 */
export function applyMcpGatewayStatusFailure(
  previousRows: McpServerStatusRow[],
  message: string
): McpServerStatusRow[] {
  return previousRows.map((row) => (
    row.id === 'gateway'
      ? { ...row, state: 'offline', tone: 'danger', detail: message }
      : row
  ));
}
