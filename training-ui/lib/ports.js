const net = require('net');

const IPV6_UNAVAILABLE = new Set(['EAFNOSUPPORT', 'EPROTONOSUPPORT', 'EADDRNOTAVAIL']);

function probeAddress(port, host, ipv6Only = false) {
    return new Promise(resolve => {
        const tester = net.createServer();
        tester.once('error', error => {
            // Hosts without IPv6 can still serve the UI over IPv4.
            resolve(host === '::' && IPV6_UNAVAILABLE.has(error.code));
        });
        tester.once('listening', () => tester.close(() => resolve(true)));
        tester.listen({ port, host, ipv6Only, exclusive: true });
    });
}

async function checkPort(port) {
    // On Windows an IPv6 bind can succeed while another application owns IPv4.
    // Check both explicitly so localhost and 127.0.0.1 cannot reach different apps.
    if (!await probeAddress(port, '0.0.0.0')) return false;
    return probeAddress(port, '::', true);
}

async function findAvailablePort(startPort, maxAttempts = 10) {
    const end = Math.min(startPort + maxAttempts, 65536);
    for (let port = startPort; port < end; port++) {
        if (await checkPort(port)) return port;
    }
    return null;
}

module.exports = { checkPort, findAvailablePort };
