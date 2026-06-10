#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { create, all } from 'mathjs';

// Create a mathjs instance with all functions but a limited set of safe options
const math = create(all, {
  // Prevent catastrophically large computations
  number: 'number',
  precision: 64
});

// Restrict potentially dangerous functions (file system, network, etc.)
// mathjs itself is sandboxed but we explicitly remove import/createUnit mutation helpers
const BLOCKED_NAMES = new Set(['import', 'createUnit', 'reviver']);

const server = new Server(
  {
    name: 'ollama-plus-calculator',
    version: '0.1.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

function asTextResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

/** Safely evaluate an expression and serialise the result. */
function safeEvaluate(expression, scope) {
  // Block any attempt to call restricted names in the expression
  for (const blocked of BLOCKED_NAMES) {
    if (expression.includes(blocked)) {
      throw new Error(`Function "${blocked}" is not allowed.`);
    }
  }

  const result = math.evaluate(expression, scope || {});
  return result;
}

function serialiseResult(result) {
  if (typeof result === 'number' || typeof result === 'boolean' || typeof result === 'string') {
    return { type: typeof result, value: result };
  }
  if (result && typeof result === 'object') {
    if (typeof result.toNumber === 'function') {
      return { type: 'number', value: result.toNumber(), repr: result.toString() };
    }
    if (typeof result.toString === 'function') {
      return { type: result.type || 'object', value: result.toString() };
    }
  }
  return { type: 'unknown', value: String(result) };
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'calculator_evaluate',
      description:
        'Evaluate a mathematical expression. Supports arithmetic, algebra, trigonometry ' +
        '(sin, cos, tan, asin, acos, atan, atan2), logarithms (log, log2, log10, exp), ' +
        'powers (^, sqrt, cbrt, nthRoot), complex numbers, fractions, matrices, ' +
        'statistical functions (mean, median, std, variance, min, max, sum, prod), ' +
        'combinatorics (factorial, combinations, permutations), ' +
        'bitwise operations, and physical unit conversions. ' +
        'Examples: "2^10", "sin(pi/6)", "sqrt(2)", "log(100, 10)", ' +
        '"5 feet to meters", "derivative(\'x^2\', x)", "simplify(\'2x + 3x\')".',
      inputSchema: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'Mathematical expression to evaluate.'
          },
          scope: {
            type: 'object',
            description: 'Optional variable bindings (e.g. {"x": 5, "y": 3}).',
            additionalProperties: true
          }
        },
        required: ['expression'],
        additionalProperties: false
      }
    },
    {
      name: 'calculator_evaluate_multi',
      description:
        'Evaluate multiple expressions sharing the same variable scope in sequence. ' +
        'Later expressions can reference variables defined in earlier ones. ' +
        'Useful for multi-step calculations (e.g. ["a = 3", "b = 4", "c = sqrt(a^2 + b^2)"]).',
      inputSchema: {
        type: 'object',
        properties: {
          expressions: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of expressions to evaluate in order.'
          },
          scope: {
            type: 'object',
            description: 'Optional initial variable bindings.',
            additionalProperties: true
          }
        },
        required: ['expressions'],
        additionalProperties: false
      }
    },
    {
      name: 'calculator_unit_convert',
      description:
        'Convert a value from one physical unit to another. ' +
        'Supports length, mass, time, temperature, speed, energy, power, pressure, data, and more. ' +
        'Examples: from="5 km" to="miles", from="100 degC" to="degF", from="1 GB" to="MB".',
      inputSchema: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'Value and source unit (e.g. "5 km", "100 degC", "1 GB").'
          },
          to: {
            type: 'string',
            description: 'Target unit (e.g. "miles", "degF", "MB").'
          }
        },
        required: ['from', 'to'],
        additionalProperties: false
      }
    },
    {
      name: 'calculator_constants',
      description:
        'List well-known mathematical and physical constants available in expressions ' +
        '(e.g. pi, e, phi, tau, Infinity, i, speedOfLight, gravitationConstant, etc.).',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'calculator_evaluate': {
      const { expression, scope } = args;
      try {
        const result = safeEvaluate(expression, scope);
        return asTextResult({
          expression,
          ...serialiseResult(result),
          latex: (() => { try { return math.parse(expression).toTex(); } catch { return null; } })()
        });
      } catch (err) {
        return asTextResult({ expression, error: err.message });
      }
    }

    case 'calculator_evaluate_multi': {
      const { expressions, scope } = args;
      const sharedScope = Object.assign({}, scope || {});
      const results = [];
      for (const expr of expressions) {
        try {
          const result = safeEvaluate(expr, sharedScope);
          results.push({ expression: expr, ...serialiseResult(result) });
        } catch (err) {
          results.push({ expression: expr, error: err.message });
        }
      }
      // Expose final scope variables (exclude built-in functions)
      const scopeSnapshot = {};
      for (const [k, v] of Object.entries(sharedScope)) {
        if (typeof v !== 'function') {
          scopeSnapshot[k] = typeof v.toNumber === 'function' ? v.toNumber() : v;
        }
      }
      return asTextResult({ results, finalScope: scopeSnapshot });
    }

    case 'calculator_unit_convert': {
      const { from, to } = args;
      try {
        const unit = math.unit(from);
        const converted = unit.to(to);
        return asTextResult({
          from,
          to,
          result: converted.toString(),
          numericValue: converted.toNumber(to),
          fromValue: unit.toNumber(unit.units[0]?.unit.name || to)
        });
      } catch (err) {
        return asTextResult({ from, to, error: err.message });
      }
    }

    case 'calculator_constants': {
      const constants = {
        mathematical: {
          pi: math.pi,
          e: math.e,
          phi: math.phi,
          tau: math.tau,
          Infinity: Infinity,
          i: '(imaginary unit, sqrt(-1))'
        },
        physical: {
          speedOfLight: `${math.evaluate('speedOfLight')} m/s`,
          gravitationConstant: `${math.evaluate('gravitationConstant')} m^3/(kg s^2)`,
          planckConstant: `${math.evaluate('planckConstant')} J s`,
          electronMass: `${math.evaluate('electronMass')} kg`,
          protonMass: `${math.evaluate('protonMass')} kg`,
          elementaryCharge: `${math.evaluate('elementaryCharge')} C`,
          boltzmannConstant: `${math.evaluate('boltzmannConstant')} J/K`,
          avogadroConstant: `${math.evaluate('avogadroConstant')} mol^-1`
        },
        notes: 'Use constant names directly in expressions, e.g. "2 * pi * r" or "planckConstant * frequency".'
      };
      return asTextResult(constants);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
