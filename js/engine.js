// Petit client UCI autour de Stockfish (WebAssembly) exécuté dans un Web Worker.

const ENGINE_PATH = 'engine/stockfish-19-lite-single.js';

export class Engine {
  constructor(path = ENGINE_PATH) {
    this.worker = new Worker(path);
    this.listeners = new Set();
    this.worker.onmessage = (e) => {
      const line = String(e.data);
      for (const fn of [...this.listeners]) fn(line);
    };
    this.failure = new Promise((_, reject) => {
      this.worker.onerror = () => reject(new Error("Impossible de charger le moteur d'analyse."));
    });
    this.failure.catch(() => {});
    this.queue = Promise.resolve();
    this.ready = null;
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  waitFor(predicate) {
    return new Promise((resolve) => {
      const fn = (line) => {
        if (predicate(line)) {
          this.listeners.delete(fn);
          resolve(line);
        }
      };
      this.listeners.add(fn);
    });
  }

  async isReady() {
    const ok = this.waitFor((l) => l === 'readyok');
    this.send('isready');
    await ok;
  }

  init() {
    if (!this.ready) {
      this.ready = Promise.race([this.failure, (async () => {
        const ok = this.waitFor((l) => l === 'uciok');
        this.send('uci');
        await ok;
        this.send('setoption name Hash value 32');
        await this.isReady();
      })()]);
    }
    return this.ready;
  }

  /** Interrompt la recherche en cours (le résultat partiel est quand même renvoyé). */
  stop() {
    this.send('stop');
  }

  newGame() {
    return this.enqueue(async () => {
      await this.init();
      this.send('ucinewgame');
      await this.isReady();
    });
  }

  enqueue(task) {
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  }

  /**
   * Analyse une position. Les recherches sont exécutées l'une après l'autre.
   * Renvoie { score: { type: 'cp' | 'mate', value }, bestMove, pv, depth },
   * le score étant exprimé du point de vue du joueur au trait.
   */
  analyse(fen, depth) {
    const run = async () => {
      await this.init();
      let last = { score: { type: 'cp', value: 0 }, pv: [], depth: 0 };
      const onInfo = (line) => {
        if (!line.startsWith('info ') || line.includes(' multipv 2')) return;
        const score = line.match(/ score (cp|mate) (-?\d+)/);
        if (!score) return;
        const pv = line.match(/ pv (.+)$/);
        const d = line.match(/ depth (\d+)/);
        last = {
          score: { type: score[1], value: Number(score[2]) },
          pv: pv ? pv[1].trim().split(/\s+/) : last.pv,
          depth: d ? Number(d[1]) : last.depth,
        };
      };
      this.listeners.add(onInfo);
      const done = this.waitFor((l) => l.startsWith('bestmove'));
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
      const bestLine = await done;
      this.listeners.delete(onInfo);
      const best = bestLine.split(/\s+/)[1];
      return { ...last, bestMove: best && best !== '(none)' ? best : null };
    };
    return this.enqueue(run);
  }
}
