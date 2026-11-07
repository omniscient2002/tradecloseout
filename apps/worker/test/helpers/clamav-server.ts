import net from 'net';
import { once } from 'events';

export const EICAR_TEST_STRING = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export async function createClamAvServer() {
  let mode: 'normal' | 'error' | 'hang' = 'normal';
  const scans: { bytes: Buffer; infected: boolean; signature?: string }[] = [];

  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    if (mode === 'error') {
      socket.destroy();
      return;
    }
    if (mode === 'hang') {
      // Do nothing, let it timeout
      return;
    }

    let buffer = Buffer.alloc(0);
    let state: 'WAITING_COMMAND' | 'READING_CHUNKS' = 'WAITING_COMMAND';
    const receivedChunks: Buffer[] = [];
    let expectedChunkLen: number | null = null;

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);

      if (state === 'WAITING_COMMAND') {
        const nullIdx = buffer.indexOf(0);
        const newlineIdx = buffer.indexOf(10);
        const delimIdx = nullIdx !== -1 ? nullIdx : newlineIdx;
        if (delimIdx !== -1) {
          buffer = buffer.subarray(delimIdx + 1);
          state = 'READING_CHUNKS';
        }
      }

      if (state === 'READING_CHUNKS') {
        while (true) {
          if (expectedChunkLen === null) {
            if (buffer.length < 4) break;
            expectedChunkLen = buffer.readUInt32BE(0);
            buffer = buffer.subarray(4);
            if (expectedChunkLen === 0) {
              // End of stream
              const allBytes = Buffer.concat(receivedChunks);
              const text = allBytes.toString('utf8');
              const isInfected = text.includes(EICAR_TEST_STRING) || text.includes('EICAR');
              scans.push({
                bytes: allBytes,
                infected: isInfected,
                signature: isInfected ? 'Win.Test.EICAR_HDB-1' : undefined,
              });

              if (isInfected) {
                socket.write('stream: Win.Test.EICAR_HDB-1 FOUND\0');
              } else {
                socket.write('stream: OK\0');
              }
              socket.end();
              break;
            }
          } else {
            if (buffer.length < expectedChunkLen) break;
            receivedChunks.push(buffer.subarray(0, expectedChunkLen));
            buffer = buffer.subarray(expectedChunkLen);
            expectedChunkLen = null;
          }
        }
      }
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as net.AddressInfo).port;

  return {
    host: '127.0.0.1',
    port,
    scans,
    setMode: (m: 'normal' | 'error' | 'hang') => {
      mode = m;
    },
    close: async () => {
      (server as any).closeAllConnections?.();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
