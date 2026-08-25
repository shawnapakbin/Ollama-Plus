/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 */
const APPROVAL_POLICIES = {
  'human-tool-routing-v1': {
    id: 'human-tool-routing-v1',
    actionScope: 'tool-routing',
    minRiskScore: 60,
    requiredApproverRole: 'runtime-reviewer'
  }
};

const GRAPH_CATALOG = [
  {
    id: 'core-chat',
    name: 'Core Chat Graph',
    summary: 'Primary LangGraph conversation runtime with tool routing, approvals, memory, and persistence.',
    stageCount: 6,
    approvalPolicy: {
      id: 'human-tool-routing-v1',
      checkpointOrders: [4]
    },
    stages: [
      'Normalize user input and session state.',
      'Assemble memory, prompt, and retrieval context.',
      'Run the model node and capture streamed output.',
      'Route tool intents through human approval checkpoints.',
      'Persist checkpoints, runs, and tool artifacts locally.',
      'Emit final assistant output back to the renderer.'
    ]
  },
  {
    id: 'memory-ingest',
    name: 'Memory Ingest Graph',
    summary: 'Turns approved conversation facts into long-term local memory with retrieval metadata.',
    stageCount: 4,
    stages: [
      'Extract candidate memory facts from completed runs.',
      'Score importance and retention policy locally.',
      'Generate retrieval metadata and memory documents.',
      'Write durable memory records to the local store.'
    ]
  },
  {
    id: 'eval-regression',
    name: 'Eval Regression Graph',
    summary: 'Runs dataset-driven evaluation batches and prepares optional LangSmith upload payloads.',
    stageCount: 5,
    stages: [
      'Load saved eval dataset and prompt versions.',
      'Execute graph runs against the local runtime.',
      'Collect grader outputs and regression deltas.',
      'Persist results locally for offline review.',
      'Package traces for optional LangSmith sync.'
    ]
  }
];

export function getGraphCatalog() {
  return GRAPH_CATALOG.map((graph) => ({ ...graph, stages: [...graph.stages] }));
}

export function getGraphDefinition(graphId) {
  return GRAPH_CATALOG.find((graph) => graph.id === graphId) ?? null;
}

export function buildRunBlueprint(graphId) {
  const graph = getGraphDefinition(graphId);
  if (!graph) {
    throw new Error(`Unknown graph: ${graphId}`);
  }

  const approvalOrders = new Set(graph.approvalPolicy?.checkpointOrders ?? []);
  const approvalPolicy = graph.approvalPolicy?.id
    ? APPROVAL_POLICIES[graph.approvalPolicy.id] ?? null
    : null;

  return {
    graphId: graph.id,
    graphName: graph.name,
    summary: graph.summary,
    checkpoints: graph.stages.map((stage, index) => ({
      id: `${graph.id}:stage:${index + 1}`,
      order: index + 1,
      title: stage,
      status: index === 0 ? 'ready' : 'pending',
      requiresApproval: approvalOrders.has(index + 1),
      approvalPolicyId: approvalOrders.has(index + 1) ? (graph.approvalPolicy?.id ?? 'manual-approval') : null,
      approvalPolicy: approvalOrders.has(index + 1)
        ? (approvalPolicy
          ? { ...approvalPolicy }
          : {
              id: graph.approvalPolicy?.id ?? 'manual-approval',
              actionScope: 'unspecified',
              minRiskScore: 0,
              requiredApproverRole: 'runtime-reviewer'
            })
        : null
    })),
    nextAction: 'Wire the concrete LangGraph executor and stream callbacks into this run.'
  };
}