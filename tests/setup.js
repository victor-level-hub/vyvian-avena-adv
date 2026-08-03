// tests/setup.js — corre antes de cada ficheiro de teste.
//
// Rede fechada por omissão. Sem isto, um teste que se esqueça de mockar o fetch
// bate mesmo na API do Gemini / Resend / Meta: fica lento, falha fora de linha e
// — pior — pode enviar um e-mail a sério. Quem precisa de rede mocka-a
// explicitamente com vi.stubGlobal('fetch', mockFetch(...)).
globalThis.fetch = async (url) => {
  throw new Error(
    `Chamada de rede não mockada neste teste: ${url}\n` +
    `Use vi.stubGlobal('fetch', mockFetch(...)) — ver tests/README.md.`
  );
};
