/**
 * Next.js instrumentation hook — runs ONCE when Next.js boots.
 *
 * Official pattern (Next.js docs): guard with NEXT_RUNTIME, then dynamically
 * import the node-only module. No eval() — the previous eval trick no longer
 * passes Turbopack's Edge-runtime Dynamic Code Evaluation check during
 * `next build` (build failed with "Dynamic Code Evaluation not allowed").
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "test") return;

  const { registerNode } = await import("./instrumentation-node");
  await registerNode();
}
