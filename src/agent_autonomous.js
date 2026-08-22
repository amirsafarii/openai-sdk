import { agent } from './provider/agent.js';
import { Debugger } from './debugger.js';
import { state, memory } from './state_memory.js';
import { ledger, approval } from './ledger_approval.js';

export async function autonomousRun(input, session) {
  const d = new Debugger();
  const runId = 'run-' + Date.now();
  d.append({runId, type:'run.started', turnId:'t1', data:{input}});
  state.save('run', {runId, status:'running', sessionId: session?.id||'s1'});
  memory.set('last_input', input);
  try {
    const { run } = await import('@openai/agents');
    const stream = await run(agent, input, { session, stream:true });
    d.append({runId, type:'run.completed', turnId:'t1', data:{}});
    state.save('run', {runId, status:'completed'});
  } catch(e) {
    d.append({runId, type:'run.failed', turnId:'t1', data:{error:e.message}});
    state.save('run', {runId, status:'failed', error:e.message});
  }
  d.persist();
  return { runId, state: state.load(), memory: memory.get('__all') };
}
