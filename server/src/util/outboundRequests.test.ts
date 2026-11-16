import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  BlockedOutboundUrlError,
  checkOutboundUrl,
  classifyUpstreamError,
  guardedAgents,
  isBlockedOutboundUrlError,
  outboundRedirectGuard,
  outboundRequestGuard,
} from './outboundRequests.ts';

vi.mock('node:dns/promises', () => ({
  default: {
    lookup: vi.fn(async (hostname: string) => {
      if (hostname === 'rebind.example') {
        return [{ address: '169.254.169.254', family: 4 }];
      }
      if (hostname === 'jellyfin.lan') {
        return [{ address: '192.168.1.50', family: 4 }];
      }
      // Resolves to loopback so the allow-path test gets an instant
      // ECONNREFUSED instead of touching the real network.
      if (hostname === 'loopback.example') {
        return [{ address: '127.0.0.1', family: 4 }];
      }
      throw new Error('ENOTFOUND');
    }),
  },
}));

describe('checkOutboundUrl', () => {
  describe('blocks cloud metadata endpoints', () => {
    it.each([
      'http://169.254.169.254/latest/meta-data?x=',
      'http://169.254.169.254',
      'https://169.254.0.1',
      'http://[fd00:ec2::254]',
      'http://[fe80::1]',
      'http://[::ffff:169.254.169.254]',
      'http://metadata.google.internal',
    ])('blocks %s', async (url) => {
      await expect(checkOutboundUrl(url)).resolves.toBe('blocked-address');
    });

    it('blocks a hostname that resolves to a metadata address', async () => {
      await expect(checkOutboundUrl('http://rebind.example')).resolves.toBe(
        'blocked-address',
      );
    });
  });

  describe('allows the addresses Tunarr actually needs', () => {
    // Tunarr exists to reach media servers on the user's own network. If these
    // ever start failing, the guard has been "hardened" into breaking the product.
    it.each([
      'http://192.168.1.50:8096',
      'http://10.0.0.5:32400',
      'http://172.16.4.4:8096',
      'http://127.0.0.1:8096',
      'http://localhost:8096',
      'http://[::1]:8096',
      'https://plex.example.com:32400',
      'http://jellyfin.lan:8096',
    ])('allows %s', async (url) => {
      await expect(checkOutboundUrl(url)).resolves.toBeUndefined();
    });

    it('allows a name that does not resolve, so the request reports normally', async () => {
      await expect(
        checkOutboundUrl('http://nonexistent.invalid'),
      ).resolves.toBeUndefined();
    });
  });

  describe('rejects malformed input', () => {
    it('rejects a non-URL', async () => {
      await expect(checkOutboundUrl('not a url')).resolves.toBe('invalid-url');
    });

    it.each(['file:///etc/passwd', 'gopher://169.254.169.254'])(
      'rejects the non-http protocol in %s',
      async (url) => {
        await expect(checkOutboundUrl(url)).resolves.toBe(
          'unsupported-protocol',
        );
      },
    );
  });
});

describe('outboundRedirectGuard', () => {
  const { beforeRedirect, maxRedirects } = outboundRedirectGuard;

  it('caps the redirect chain', () => {
    expect(maxRedirects).toBeLessThanOrEqual(3);
  });

  it.each([
    '169.254.169.254',
    '169.254.0.1',
    'fd00:ec2::254',
    'fe80::1',
    '::ffff:a9fe:a9fe',
    'metadata.google.internal',
  ])('rejects a redirect to %s', (hostname) => {
    expect(() => beforeRedirect({ hostname, protocol: 'http:' })).toThrow(
      BlockedOutboundUrlError,
    );
  });

  it('rejects a redirect to a non-http protocol', () => {
    expect(() =>
      beforeRedirect({ hostname: 'example.com', protocol: 'file:' }),
    ).toThrow(BlockedOutboundUrlError);
  });

  it.each(['192.168.1.50', '127.0.0.1', '10.0.0.5', 'plex.example.com'])(
    'allows a redirect to %s',
    (hostname) => {
      expect(() =>
        beforeRedirect({ hostname, protocol: 'https:' }),
      ).not.toThrow();
    },
  );
});

describe('outboundRequestGuard agent lookup', () => {
  // The unit tests above cover the pieces. This drives a real axios request
  // through the agent, which is the only way to confirm the lookup is actually
  // wired in and that the refusal survives axios's error wrapping.
  it('refuses a connection to a host that resolves into a blocked range', async () => {
    const error = await axios
      .get('http://rebind.example/whatever', {
        ...outboundRequestGuard,
        timeout: 5000,
      })
      .then(() => undefined)
      .catch((e: unknown) => e);

    expect(error).toBeDefined();
    expect(isBlockedOutboundUrlError(error)).toBe(true);
  });

  // Regression: Node skips DNS when the host is already an IP literal, so
  // guardedLookup is never called for one. Before the createConnection guard
  // this request connected and hung until timeout instead of being refused.
  it('refuses a request straight to a blocked IP literal', async () => {
    const error = await axios
      .get('http://169.254.169.254/latest/meta-data', {
        ...outboundRequestGuard,
        timeout: 3000,
      })
      .then(() => undefined)
      .catch((e: unknown) => e);

    expect(error).toBeDefined();
    expect(isBlockedOutboundUrlError(error)).toBe(true);
  });

  it('refuses a blocked IPv6 literal', async () => {
    const error = await axios
      .get('http://[fd00:ec2::254]/latest/meta-data', {
        ...outboundRequestGuard,
        timeout: 3000,
      })
      .then(() => undefined)
      .catch((e: unknown) => e);

    expect(error).toBeDefined();
    expect(isBlockedOutboundUrlError(error)).toBe(true);
  });

  it('does not refuse a host that resolves to a private address', async () => {
    // Connection is refused because nothing is listening, but it must not be
    // refused by policy - that is the case we deliberately allow.
    const error = await axios
      .get('http://loopback.example:1/whatever', {
        ...outboundRequestGuard,
        timeout: 5000,
      })
      .then(() => undefined)
      .catch((e: unknown) => e);

    // It still fails - nothing is listening - but not by policy, which is the
    // distinction that matters.
    expect(error).toBeDefined();
    expect(isBlockedOutboundUrlError(error)).toBe(false);
  });
});

describe('outboundRequestGuard connections', () => {
  // A local server that counts the connections opened to it.
  async function countingServer() {
    const counts = { connections: 0 };
    const server = http.createServer((_, res) => res.end('ok'));
    server.on('connection', () => counts.connections++);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    const close = async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    };
    return { counts, port, close };
  }

  // A library scan makes thousands of requests to one media server. Opening a
  // connection for each costs a TCP and TLS handshake every time.
  it('reuses one connection for back-to-back requests to the same server', async () => {
    const { counts, port, close } = await countingServer();

    try {
      for (let i = 0; i < 3; i++) {
        await axios.get(`http://127.0.0.1:${port}/`, {
          ...outboundRequestGuard,
        });
      }
    } finally {
      await close();
    }

    expect(counts.connections).toBe(1);
  });

  // Requests to a media server normally carry a timeout. The Jellyfin and
  // Emby sign-in calls do not, and a slow sign-in must not be cut off by the
  // limit meant for a connection nobody is using.
  it('lets a slow request with no timeout finish on a reused connection', async () => {
    const idleMs = 150;
    const config = { ...outboundRedirectGuard, ...guardedAgents(idleMs) };
    let connections = 0;
    let firstClosed = () => {};
    const closed = new Promise<void>((resolve) => (firstClosed = resolve));
    const server = http.createServer((req, res) => {
      // Slow enough to outlast the idle limit several times over.
      setTimeout(() => res.end('ok'), req.url === '/slow' ? idleMs * 4 : 0);
    });
    // The server would hold an idle connection for a minute, so only the
    // client's own limit can close one sooner.
    server.keepAliveTimeout = 60_000;
    server.on('connection', (socket) => {
      if (++connections === 1) {
        socket.on('close', firstClosed);
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    try {
      await axios.get(`${base}/`, { ...config, timeout: 60_000 });
      const slow = await axios.post(`${base}/slow`, {}, config);

      expect(slow.status).toBe(200);
      expect(connections).toBe(1);

      // Left alone, the client closes the connection itself.
      await closed;
      await axios.get(`${base}/`, { ...config, timeout: 60_000 });
      expect(connections).toBe(2);
    } finally {
      config.httpAgent.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // The guards act when a connection is opened. One held open to an allowed
  // server must not carry, or excuse, a request to a refused destination.
  it('still refuses a blocked destination while a connection is held open', async () => {
    const { counts, port, close } = await countingServer();
    const attempt = (url: string) =>
      axios
        .get(url, { ...outboundRequestGuard, timeout: 3000 })
        .then(() => undefined)
        .catch((e: unknown) => e);

    try {
      await axios.get(`http://127.0.0.1:${port}/`, { ...outboundRequestGuard });

      const literal = await attempt(`http://169.254.169.254:${port}/`);
      const resolved = await attempt(`http://rebind.example:${port}/`);
      expect(isBlockedOutboundUrlError(literal)).toBe(true);
      expect(isBlockedOutboundUrlError(resolved)).toBe(true);

      // The held connection is still the one in use afterwards.
      await axios.get(`http://127.0.0.1:${port}/`, { ...outboundRequestGuard });
    } finally {
      await close();
    }

    expect(counts.connections).toBe(1);
  });
});

describe('isBlockedOutboundUrlError', () => {
  it('finds our error underneath an axios wrapper', () => {
    const wrapped = new Error('connect failed', {
      cause: new BlockedOutboundUrlError('blocked-address'),
    });

    expect(isBlockedOutboundUrlError(wrapped)).toBe(true);
  });

  it('does not claim an ordinary connection failure', () => {
    expect(
      isBlockedOutboundUrlError(
        new Error('connect ECONNREFUSED 10.0.0.5:6379'),
      ),
    ).toBe(false);
  });

  it('terminates on a cyclic cause chain', () => {
    const a: { cause?: unknown } = new Error('a');
    const b: { cause?: unknown } = new Error('b');
    a.cause = b;
    b.cause = a;

    expect(isBlockedOutboundUrlError(a)).toBe(false);
  });
});

describe('classifyUpstreamError', () => {
  function axiosError(extra: Record<string, unknown>) {
    return { isAxiosError: true, ...extra };
  }

  it('reports a connection failure as unreachable without the errno', () => {
    expect(
      classifyUpstreamError(
        axiosError({
          code: 'ECONNREFUSED',
          message: 'connect ECONNREFUSED 10.0.0.5:6379',
        }),
      ),
    ).toBe('unreachable');
  });

  it('reports a timeout', () => {
    expect(classifyUpstreamError(axiosError({ code: 'ETIMEDOUT' }))).toBe(
      'timeout',
    );
  });

  it.each([401, 403])('reports %i as auth', (status) => {
    expect(classifyUpstreamError(axiosError({ response: { status } }))).toBe(
      'auth',
    );
  });

  it('reports another HTTP status as bad_response', () => {
    expect(
      classifyUpstreamError(axiosError({ response: { status: 404 } })),
    ).toBe('bad_response');
  });

  it('reports a non-axios error as unknown', () => {
    expect(classifyUpstreamError(new Error('boom'))).toBe('unknown');
  });
});
