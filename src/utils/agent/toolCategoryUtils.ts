/**
 * Tool Category Utilities
 *
 * Maps tool categories to their accent colors and icon names
 * for consistent visual rendering across the agent chat interface.
 */

import type { ToolCategory } from '../../types/agentChat';

/**
 * Returns the accent color hex string for a given tool category.
 *
 * Color mapping:
 * - file → green (#64d28c)
 * - terminal → blue (#6cb4f8)
 * - browser → purple (#c0a0f0)
 * - http → amber (#f0c83c)
 * - python → violet (#a78bfa)
 */
export function getCategoryColor(category: ToolCategory): string {
  switch (category) {
    case 'file':
      return '#64d28c';
    case 'terminal':
      return '#6cb4f8';
    case 'browser':
      return '#c0a0f0';
    case 'http':
      return '#f0c83c';
    case 'python':
      return '#a78bfa';
    default: {
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}

/**
 * Returns the icon name for a given tool category.
 *
 * Icon mapping:
 * - file → 'folder'
 * - terminal → 'terminal'
 * - browser → 'globe'
 * - http → 'wifi'
 * - python → 'code'
 */
export function getCategoryIcon(category: ToolCategory): string {
  switch (category) {
    case 'file':
      return 'folder';
    case 'terminal':
      return 'terminal';
    case 'browser':
      return 'globe';
    case 'http':
      return 'wifi';
    case 'python':
      return 'code';
    default: {
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}
