// Servidor WebSocket mínimo (RFC 6455) sin dependencias.
// Soporta frames de texto, fragmentación, ping/pong y cierre.
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class WsConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.open = true;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.#onData(d));
    socket.on('close', () => this.#closed());
    socket.on('error', () => this.#closed());
  }

  send(obj) {
    if (!this.open) return;
    const data = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
    this.#writeFrame(0x1, data);
  }

  close(code = 1000) {
    if (!this.open) return;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code);
    this.#writeFrame(0x8, b);
    this.socket.end();
    this.#closed();
  }

  #writeFrame(opcode, data) {
    const len = data.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
    }
    try { this.socket.write(Buffer.concat([header, data])); } catch { this.#closed(); }
  }

  #closed() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0], b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buffer.length < 4) return; len = this.buffer.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buffer.length < 10) return; len = Number(this.buffer.readBigUInt64BE(2)); off = 10; }
      if (len > 4 * 1024 * 1024) { this.close(1009); return; }
      const maskLen = masked ? 4 : 0;
      if (this.buffer.length < off + maskLen + len) return;
      let payload = this.buffer.subarray(off + maskLen, off + maskLen + len);
      if (masked) {
        const mask = this.buffer.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buffer = this.buffer.subarray(off + maskLen + len);

      if (opcode === 0x8) { this.close(); return; }
      if (opcode === 0x9) { this.#writeFrame(0xA, payload); continue; }
      if (opcode === 0xA) continue;
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        this.fragments.push(payload);
        if (fin) {
          const msg = Buffer.concat(this.fragments).toString('utf8');
          this.fragments = [];
          let parsed;
          try { parsed = JSON.parse(msg); } catch { continue; }
          this.emit('message', parsed);
        }
      }
    }
  }
}

/** Acepta un upgrade HTTP y devuelve una conexión, o null si no es válido. */
export function acceptUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.destroy();
    return null;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  return new WsConnection(socket, req);
}
