import { agent } from './src/provider/agent.js';
export const runtime = { agent, emit: (e) => console.log('[EVENT]', e) };
