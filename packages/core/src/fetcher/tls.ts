import { connect, checkServerIdentity } from 'node:tls';
import type { PeerCertificate } from 'node:tls';
import type { TlsEvidence } from '../evidence.js';

const TLS_TIMEOUT_MS = 8_000;

export function gatherTls(host: string, port = 443): Promise<TlsEvidence> {
  return new Promise((resolve) => {
    const out: TlsEvidence = { connected: false, authorized: false, hostMatches: false, sans: [] };
    let settled = false;
    const finish = (ev: TlsEvidence) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(ev);
    };
    const socket = connect({ host, port, servername: host, rejectUnauthorized: false, ALPNProtocols: ['http/1.1'] }, () => {
      out.connected = true;
      out.authorized = socket.authorized;
      if (socket.authorizationError) out.authorizationError = String(socket.authorizationError);
      const cert = socket.getPeerCertificate(false) as PeerCertificate | Record<string, never>;
      if (cert && Object.keys(cert).length > 0) {
        const c = cert as PeerCertificate;
        out.validFrom = new Date(c.valid_from).toISOString();
        out.validTo = new Date(c.valid_to).toISOString();
        out.daysRemaining = Math.floor((new Date(c.valid_to).getTime() - Date.now()) / 86_400_000);
        out.sans = (c.subjectaltname ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.startsWith('DNS:'))
          .map((s) => s.slice(4).toLowerCase());
        const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
        out.issuer = one(c.issuer?.O) ?? one(c.issuer?.CN);
        out.subject = one(c.subject?.CN);
        const mismatch = checkServerIdentity(host, c);
        out.hostMatches = !mismatch;
        if (mismatch && !out.authorizationError) out.authorizationError = mismatch.message;
      } else {
        out.error = 'no certificate presented';
      }
      finish(out);
    });
    socket.setTimeout(TLS_TIMEOUT_MS, () => {
      out.error = 'timeout';
      finish(out);
    });
    socket.on('error', (e: NodeJS.ErrnoException) => {
      out.error = `${e.code ?? e.name}: ${e.message}`.slice(0, 160);
      finish(out);
    });
  });
}
