import { describe, expect, it } from 'vitest';
import { buildRunBlueprint, getGraphCatalog, getGraphDefinition } from '../electron/runtime/graphCatalog.js';

describe('graphCatalog', () => {
  it('exposes the rebuild graphs', () => {
    const graphs = getGraphCatalog();

    expect(graphs.map((graph) => graph.id)).toEqual([
      'core-chat',
      'memory-ingest',
      'eval-regression'
    ]);
  });

  it('builds a checkpoint blueprint from a graph definition', () => {
    const run = buildRunBlueprint('core-chat');

    expect(run.graphName).toBe('Core Chat Graph');
    expect(run.checkpoints).toHaveLength(6);
    expect(run.checkpoints[0]).toMatchObject({ status: 'ready', order: 1 });
    expect(run.checkpoints[1]).toMatchObject({ status: 'pending', order: 2 });
    expect(run.checkpoints[3]).toMatchObject({
      order: 4,
      requiresApproval: true,
      approvalPolicyId: 'human-tool-routing-v1'
    });
    expect(run.checkpoints[3].approvalPolicy).toMatchObject({
      id: 'human-tool-routing-v1',
      actionScope: 'tool-routing',
      minRiskScore: 60,
      requiredApproverRole: 'runtime-reviewer'
    });
  });

  it('returns null for unknown graph definitions', () => {
    expect(getGraphDefinition('missing-graph')).toBeNull();
  });
});