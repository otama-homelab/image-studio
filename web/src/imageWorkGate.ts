import {createWorkerGate} from '../../tools/browser-library-adapter/worker-gate.mjs';
// One heavy image task across every editor in this page. No Worker job queue.
export const imageWorkGate=createWorkerGate();
