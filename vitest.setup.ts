/**
 * No test may touch the network.
 *
 * CLAUDE.md rule 16 and the M2 acceptance criteria require that CI never depends
 * on a live third-party provider. Source adapters take an injected `fetchImpl`,
 * so any call reaching the real `fetch` is a mistake — fail loudly instead of
 * silently making a request.
 */
// Declared async so it fails the way the real `fetch` does — a rejected promise,
// not a synchronous throw — and code that only catches rejections still sees it.
const blocked = async (input: unknown): Promise<never> => {
  const target = typeof input === 'string' ? input : String(input);
  throw new Error(
    `Network access is disabled in tests. Something tried to fetch ${target}. ` +
      'Adapters must be driven with a stubbed fetchImpl over saved fixtures.',
  );
};

globalThis.fetch = blocked as unknown as typeof fetch;
