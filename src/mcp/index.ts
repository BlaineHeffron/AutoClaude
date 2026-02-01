// MCP Server for autoclaude - Phase 3 implementation
// This is a stub that will be replaced with the full MCP server

import { logger } from '../util/logger';

logger.info('autoclaude MCP server started (stub - Phase 3)');

// Keep process alive
process.stdin.resume();
process.stdin.on('end', () => {
  process.exit(0);
});
