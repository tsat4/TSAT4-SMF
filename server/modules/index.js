import sto from './sto/index.js';
import act from './act/index.js';
import system from './system/index.js';

// Every feature module. Add a new unit here after creating server/modules/<id>/index.js.
// Keep `system` last: it collects the tables of every module above it.
export const MODULES = [sto, act, system];
