import { createServer } from 'http';
import { once } from 'events';
import { S3Client } from '@aws-sdk/client-s3';

/** Programmable S3 HTTP contract fixture supporting full object versioning and error injection. */
export async function storageServer() {
  const objects = new Map<string, Buffer>();
  const latestVersions = new Map<string, string>();
  const objectMetadata = new Map<string, Record<string, string>>();
  const requests: { method: string; key: string; version: string | null }[] = [];
  const uploads: { key: string; bytes: Buffer; version: string }[] = [];
  let rejectUploads = false;
  let rejectDownloads = false;
  let wrongVersion = false;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, 'http://fixture');
      const key = decodeURIComponent(url.pathname).replace(/^\/[^/]+\//, '');
      const version = url.searchParams.get('versionId');
      requests.push({ method: req.method!, key, version });

      if (req.method === 'PUT') {
        if (rejectUploads) {
          res.writeHead(503);
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        const newVersion = `v${uploads.length + 1}`;
        uploads.push({ key, bytes, version: newVersion });
        objects.set(`${key}:${newVersion}`, bytes);
        latestVersions.set(key, newVersion);

        const metaHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (k.toLowerCase().startsWith('x-amz-meta-') && typeof v === 'string') {
            metaHeaders[k.toLowerCase()] = v;
          }
        }
        objectMetadata.set(`${key}:${newVersion}`, metaHeaders);

        res.writeHead(200, { 'x-amz-version-id': newVersion });
        res.end();
        return;
      }

      if (req.method === 'HEAD' || req.method === 'GET') {
        if (rejectDownloads) {
          res.writeHead(503);
          res.end();
          return;
        }
        const resolvedVersion = version || latestVersions.get(key);
        if (!resolvedVersion) {
          res.writeHead(404);
          res.end();
          return;
        }
        const bytes = objects.get(`${key}:${resolvedVersion}`);
        if (!bytes) {
          res.writeHead(404);
          res.end();
          return;
        }
        const meta = objectMetadata.get(`${key}:${resolvedVersion}`) || {};
        res.writeHead(200, {
          'content-length': bytes.length,
          'x-amz-version-id': wrongVersion ? 'wrong-version' : resolvedVersion,
          'content-type': 'application/octet-stream',
          ...meta,
        });
        res.end(req.method === 'HEAD' ? undefined : bytes);
        return;
      }

      res.writeHead(405);
      res.end();
    } catch {
      res.writeHead(500);
      res.end();
    }
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  const endpoint = `http://127.0.0.1:${address.port}`;
  const s3 = new S3Client({
    endpoint,
    region: 'test-region',
    credentials: { accessKeyId: 'fixture', secretAccessKey: 'fixture' },
    forcePathStyle: true,
    maxAttempts: 1,
  });

  return {
    s3,
    endpoint,
    port: address.port,
    objects,
    latestVersions,
    requests,
    uploads,
    rejectUploads: (reject: boolean) => {
      rejectUploads = reject;
    },
    rejectDownloads: (reject: boolean) => {
      rejectDownloads = reject;
    },
    wrongVersion: (wrong: boolean) => {
      wrongVersion = wrong;
    },
    close: async () => {
      s3.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
