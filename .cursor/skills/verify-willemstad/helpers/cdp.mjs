export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null) {
        const waiter = this.pending.get(msg.id);
        if (!waiter) return;
        this.pending.delete(msg.id);
        clearTimeout(waiter.timer);
        if (msg.error) waiter.reject(new Error(`${msg.error.message || JSON.stringify(msg.error)}`));
        else waiter.resolve(msg.result);
        return;
      }
      for (const evWait of this.events) {
        if (evWait.method === msg.method && evWait.sessionId === (msg.sessionId || null)) {
          evWait.resolve(msg.params);
        }
      }
      this.events = this.events.filter((event) => !event.done);
    });
  }

  send(method, params = {}, sessionId = null) {
    const id = ++this.nextId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  once(method, sessionId = null, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const waiter = {
        method,
        sessionId,
        done: false,
        timer: null,
        resolve(params) {
          if (waiter.done) return;
          waiter.done = true;
          clearTimeout(waiter.timer);
          resolve(params);
        },
      };
      waiter.timer = setTimeout(() => {
        if (!waiter.done) {
          waiter.done = true;
          this.events = this.events.filter((event) => event !== waiter);
          reject(new Error(`CDP event timeout: ${method}`));
        }
      }, timeoutMs);
      this.events.push(waiter);
    });
  }
}
