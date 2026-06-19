// ── Notebook Kernel ────────────────────────────────────────────────────────────
// Single authoritative entry point for all code execution across the app.
// Wraps compiler.js so every screen (generative, coding, future notebook) uses
// the same Pyodide instance and the same persistent namespace (_dp_kernel_ns).

export {
  compile   as runCell,
  resetKernel,
  injectDataFrame,
  preloadPython,
} from '../../compiler/compiler.js';

// Convenience alias — callers that want the full compiler API can import this
export { compile } from '../../compiler/compiler.js';
