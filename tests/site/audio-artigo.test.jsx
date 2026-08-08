// @vitest-environment jsdom
// tests/site/audio-artigo.test.jsx — leitor "Ouvir este artigo".
//
// Guarda as regressões reportadas a 8 ago 2026:
//   · faltava a velocidade 2x no ciclo;
//   · clicar na barra de progresso recomeçava do zero (falta de Range no
//     servidor — coberto no worker; aqui garante-se que o clique define
//     currentTime proporcional, não 0);
//   · não havia botões de recuar/avançar 10 segundos;
//   · o tempo mostrado era dividido pela velocidade (10:43 virava 8:34 a 1.25x).

import React, { useRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import AudioArtigo from '../../src/components/blog/AudioArtigo.jsx';

const TIMINGS = {
  duracao: 643, // 10:43, como no artigo real
  intro_fim: 12,
  palavras: [[12, 12.4], [12.4, 12.9], [13, 13.5]],
};

// Audio falso: o jsdom não implementa media. Guarda a última instância criada.
let ultimoAudio = null;
class AudioFalso {
  constructor(src) {
    this.src = src;
    this.currentTime = 0;
    this.duration = TIMINGS.duracao;
    this.playbackRate = 1;
    this.preload = '';
    ultimoAudio = this;
  }
  addEventListener() {}
  removeEventListener() {}
  play() { return Promise.resolve(); }
  pause() {}
}

function Palco() {
  const proseRef = useRef(null);
  return (
    <div>
      <AudioArtigo slug="artigo-teste" proseRef={proseRef} />
      <article ref={proseRef}>Uma prosa qualquer para acompanhar.</article>
    </div>
  );
}

async function montar() {
  render(<Palco />);
  // deixa o fetch dos timings resolver
  await act(async () => {});
  return screen.getByRole('button', { name: 'Ouvir este artigo' });
}

beforeEach(() => {
  ultimoAudio = null;
  vi.stubGlobal('Audio', AudioFalso);
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => TIMINGS }));
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AudioArtigo', () => {
  it('o ciclo de velocidades inclui o 2x e volta ao 1x', async () => {
    await montar();
    const vel = screen.getByRole('button', { name: 'Velocidade da narração' });
    expect(vel.textContent).toBe('1x');
    fireEvent.click(vel); // 1.25
    fireEvent.click(vel); // 1.5
    fireEvent.click(vel); // 2
    expect(vel.textContent).toBe('2x');
    fireEvent.click(vel);
    expect(vel.textContent).toBe('1x');
  });

  it('o tempo total mostrado é o real (10:43), independente da velocidade', async () => {
    await montar();
    expect(screen.getByText(/10:43/)).toBeTruthy();
    const vel = screen.getByRole('button', { name: 'Velocidade da narração' });
    fireEvent.click(vel); // 1.25x — o total NÃO pode encolher para 8:34
    expect(screen.getByText(/10:43/)).toBeTruthy();
  });

  it('clicar a meio da barra de progresso salta para o meio, não para o zero', async () => {
    const play = await montar();
    fireEvent.click(play);
    ultimoAudio.currentTime = 300;
    const barra = screen.getAllByRole('slider', { name: 'Posição da narração' })[0];
    vi.spyOn(barra, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 200 });
    fireEvent.click(barra, { clientX: 100 });
    expect(ultimoAudio.currentTime).toBeCloseTo(TIMINGS.duracao / 2, 0);
  });

  it('tem botões de recuar e avançar 10 segundos durante a sessão', async () => {
    const play = await montar();
    fireEvent.click(play);
    // simula progresso para a sessão ficar ativa (t > 0)
    ultimoAudio.currentTime = 60;
    const barra = screen.getAllByRole('slider', { name: 'Posição da narração' })[0];
    vi.spyOn(barra, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 200 });
    fireEvent.click(barra, { clientX: 100 }); // força setT(>0) → sessão

    fireEvent.click(screen.getAllByRole('button', { name: 'Recuar 10 segundos' })[0]);
    expect(ultimoAudio.currentTime).toBeCloseTo(TIMINGS.duracao / 2 - 10, 0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Avançar 10 segundos' })[0]);
    expect(ultimoAudio.currentTime).toBeCloseTo(TIMINGS.duracao / 2, 0);
  });

  it('as setas do teclado na barra saltam 10 segundos', async () => {
    const play = await montar();
    fireEvent.click(play);
    ultimoAudio.currentTime = 100;
    const barra = screen.getAllByRole('slider', { name: 'Posição da narração' })[0];
    fireEvent.keyDown(barra, { key: 'ArrowLeft' });
    expect(ultimoAudio.currentTime).toBe(90);
    fireEvent.keyDown(barra, { key: 'ArrowRight' });
    expect(ultimoAudio.currentTime).toBe(100);
  });

  it('o recuo nunca desce abaixo de 0', async () => {
    const play = await montar();
    fireEvent.click(play);
    ultimoAudio.currentTime = 3;
    const barra = screen.getAllByRole('slider', { name: 'Posição da narração' })[0];
    fireEvent.keyDown(barra, { key: 'ArrowLeft' });
    expect(ultimoAudio.currentTime).toBe(0);
  });
});
