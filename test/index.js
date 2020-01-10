'use strict';

const Dgram = require('dgram');

const Code = require('@hapi/code');
const Hoek = require('@hapi/hoek');
const Lab = require('@hapi/lab');
const Sntp = require('..');
const Teamwork = require('@hapi/teamwork');


const internals = {};


const { describe, it } = exports.lab = Lab.script();
const expect = Code.expect;


describe('SNTP', () => {

    const origDate = Date.now;
    Date.now = () => {

        return origDate() - 5;
    };

    describe('time()', () => {

        it('returns consistent result over multiple tries', async () => {

            const time1 = await Sntp.time();
            expect(time1).to.exist();
            const t1 = time1.t;

            const time2 = await Sntp.time();
            expect(time2).to.exist();
            const t2 = time2.t;
            expect(Math.abs(t1 - t2)).to.be.below(200);
        });

        it('resolves reference IP', async () => {

            const time = await Sntp.time({ host: 'ntp.exnet.com', resolveReference: true });
            expect(time).to.exist();
            expect(time.referenceHost).to.exist();
        });

        it('times out on no response', async () => {

            await expect(Sntp.time({ port: 124, timeout: 100 })).to.reject('Timeout');
        });

        it('errors on error event', async () => {

            const orig = Dgram.createSocket;
            Dgram.createSocket = function (type) {

                Dgram.createSocket = orig;
                const socket = Dgram.createSocket(type);
                setImmediate(() => {

                    socket.emit('error', new Error('Fake'));
                });
                return socket;
            };

            await expect(Sntp.time()).to.reject('Fake');
        });

        it('errors on incorrect sent size', async () => {

            const orig = Dgram.Socket.prototype.send;
            Dgram.Socket.prototype.send = function (buf, offset, length, port, address, callback) {

                Dgram.Socket.prototype.send = orig;
                return callback(null, 40);
            };

            await expect(Sntp.time()).to.reject('Could not send entire message');
        });

        it('times out on invalid host', async () => {

            await expect(Sntp.time({ host: 'no-such-hostname' })).to.reject(/getaddrinfo/);
        });

        it('fails on bad response buffer size', async (flags) => {

            const server = Dgram.createSocket('udp4');
            flags.onCleanup = (next) => server.close(next);
            server.on('message', (message, remote) => {

                const msg = Buffer.alloc(10);
                server.send(msg, 0, msg.length, remote.port, remote.address, Hoek.ignore);
            });

            server.bind(49123);

            await expect(Sntp.time({ host: 'localhost', port: 49123 })).to.reject('Invalid server response');
        });

        const messup = function (bytes, flags) {

            const server = Dgram.createSocket('udp4');
            flags.onCleanup = (next) => server.close(next);
            server.on('message', (message, remote) => {

                const msg = Buffer.from([
                    0x24, 0x01, 0x00, 0xe3,
                    0x00, 0x00, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x00,
                    0x41, 0x43, 0x54, 0x53,
                    0xd4, 0xa8, 0x2d, 0xc7,
                    0x1c, 0x5d, 0x49, 0x1b,
                    0xd4, 0xa8, 0x2d, 0xe6,
                    0x67, 0xef, 0x9d, 0xb2,
                    0xd4, 0xa8, 0x2d, 0xe6,
                    0x71, 0xed, 0xb5, 0xfb,
                    0xd4, 0xa8, 0x2d, 0xe6,
                    0x71, 0xee, 0x6c, 0xc5
                ]);

                for (let i = 0; i < bytes.length; ++i) {
                    msg[bytes[i][0]] = bytes[i][1];
                }

                server.send(msg, 0, msg.length, remote.port, remote.address, Hoek.ignore);
            });

            server.bind(49123);
        };

        it('fails on bad version', async (flags) => {

            messup([[0, (0 << 6) + (3 << 3) + (4 << 0)]], flags);

            const err = await expect(Sntp.time({ host: 'localhost', port: 49123 })).to.reject('Invalid server response');
            expect(err.time.version).to.equal(3);
        });

        it('fails on bad originateTimestamp', async (flags) => {

            messup([[24, 0x83], [25, 0xaa], [26, 0x7e], [27, 0x80], [28, 0], [29, 0], [30, 0], [31, 0]], flags);

            await expect(Sntp.time({ host: 'localhost', port: 49123 })).to.reject('Invalid server response');
        });

        it('fails on bad receiveTimestamp', async (flags) => {

            messup([[32, 0x83], [33, 0xaa], [34, 0x7e], [35, 0x80], [36, 0], [37, 0], [38, 0], [39, 0]], flags);

            await expect(Sntp.time({ host: 'localhost', port: 49123 })).to.reject('Invalid server response');
        });

        it('fails on bad originate timestamp and alarm li', async (flags) => {

            messup([[0, (3 << 6) + (4 << 3) + (4 << 0)]], flags);

            const err = await expect(Sntp.time({ host: 'localhost', port: 49123 })).to.reject('Wrong originate timestamp');
            expect(err.time.leapIndicator).to.equal('alarm');
        });

        it('returns time with death stratum and last61 li', async (flags) => {

            messup([[0, (1 << 6) + (4 << 3) + (4 << 0)], [1, 0]], flags);

            const err = await expect(Sntp.time({ host: 'localhost', port: 49123 })).to.reject();
            expect(err.time.stratum).to.equal('death');
            expect(err.time.leapIndicator).to.equal('last-minute-61');
        });

        it('returns time with reserved stratum and last59 li', async (flags) => {

            messup([[0, (2 << 6) + (4 << 3) + (4 << 0)], [1, 0x1f]], flags);

            const err = await expect(Sntp.time({ host: 'localhost', port: 49123 })).to.reject();
            expect(err.time.stratum).to.equal('reserved');
            expect(err.time.leapIndicator).to.equal('last-minute-59');
        });

        it('fails on bad mode (symmetric-active)', async (flags) => {

            messup([[0, (0 << 6) + (4 << 3) + (1 << 0)]], flags);

            const err = await expect(Sntp.time({ host: 'localhost', port: 49123 })).to.reject();
            expect(err.time.mode).to.equal('symmetric-active');
        });

        it('fails on bad mode (symmetric-passive)', async (flags) => {

            messup([[0, (0 << 6) + (4 << 3) + (2 << 0)]], flags);

            const err = await expect(Sntp.time({ host: 'localhost', port: 49123 })).to.reject();
            expect(err.time.mode).to.equal('symmetric-passive');
        });

        it('fails on bad mode (client)', async (flags) => {

            messup([[0, (0 << 6) + (4 << 3) + (3 << 0)]], flags);

            const err = await expect(Sntp.time({ host: 'localhost', port: 49123 })).to.reject();
            expect(err.time.mode).to.equal('client');
        });

        it('fails on bad mode (broadcast)', async (flags) => {

            messup([[0, (0 << 6) + (4 << 3) + (5 << 0)]], flags);

            const err = await expect(Sntp.time({ host: 'localhost', port: 49123 })).to.reject();
            expect(err.time.mode).to.equal('broadcast');
        });

        it('fails on bad mode (reserved)', async (flags) => {

            messup([[0, (0 << 6) + (4 << 3) + (6 << 0)]], flags);

            const err = await expect(Sntp.time({ host: 'localhost', port: 49123 })).to.reject();
            expect(err.time.mode).to.equal('reserved');
        });
    });

    describe('offset()', () => {

        it('gets the current offset', async () => {

            const offset = await Sntp.offset();
            expect(offset).to.not.equal(0);
        });

        it('gets the current offset from cache', async () => {

            const offset1 = await Sntp.offset();
            expect(offset1).to.not.equal(0);

            const offset2 = await Sntp.offset({});
            expect(offset2).to.equal(offset1);
        });

        it('gets the new offset on different server (host)', async (flags) => {

            const offset1 = await Sntp.offset();
            expect(offset1).to.not.equal(0);

            const offset2 = await Sntp.offset({ host: 'us.pool.ntp.org' });
            expect(offset2).to.not.equal(0);
        });

        it('gets the new offset on different server (port)', async (flags) => {

            const offset1 = await Sntp.offset();
            expect(offset1).to.not.equal(0);

            const offset2 = await Sntp.offset({ port: 123 });
            expect(offset2).to.not.equal(0);
        });

        it('fails getting the current offset on invalid server', async () => {

            await expect(Sntp.offset({ host: 'no-such-host-error', timeout: 100 })).to.reject();
        });
    });

    describe('start()', () => {

        it('returns error (direct)', async (flags) => {

            Sntp.stop();

            await expect(Sntp.start({ host: 'no-such-host-error', onError: Hoek.ignore, timeout: 10 })).to.reject();
            Sntp.stop();
        });

        it('returns error (handler)', async (flags) => {

            Sntp.stop();

            const team = new Teamwork.Team();
            const onError = (err) => {

                expect(err).to.be.an.error();
                Sntp.stop();
                team.attend();
            };

            const orig = Sntp.offset;
            Sntp.offset = () => {

                Sntp.offset = orig;
            };

            await Sntp.start({ host: 'no-such-host-error', onError, clockSyncRefresh: 100, timeout: 10 });
            await team.work;
        });

        it('ignores errors', async (flags) => {

            Sntp.stop();

            const orig = Sntp.offset;
            Sntp.offset = () => {

                Sntp.offset = orig;
            };

            await expect(Sntp.start({ host: 'no-such-host-error', clockSyncRefresh: 100, timeout: 10 })).to.not.reject();
            await Hoek.wait(110);
        });
    });

    describe('now()', () => {

        it('starts auto-sync, gets now, then stops', async (flags) => {

            Sntp.stop();

            const before = Sntp.now();
            expect(before).to.be.about(Date.now(), 5);

            await Sntp.start();
            const now = Sntp.now();
            expect(now).to.not.equal(Date.now());
            Sntp.stop();
        });

        it('starts twice', async (flags) => {

            Sntp.stop();

            await Sntp.start();
            await Sntp.start();

            const now = Sntp.now();
            expect(now).to.not.equal(Date.now());
            Sntp.stop();
        });

        it('starts auto-sync, gets now, waits, gets again after timeout', async () => {

            Sntp.stop();

            const before = Sntp.now();
            expect(before).to.be.about(Date.now(), 5);

            await Sntp.start({ clockSyncRefresh: 100 });

            const now = Sntp.now();
            expect(now).to.not.equal(Date.now());
            expect(now).to.be.about(Sntp.now(), 5);

            await Hoek.wait(110);

            expect(Sntp.now()).to.not.equal(now);
            Sntp.stop();
        });
    });
});

