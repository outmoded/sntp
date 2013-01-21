// Load modules

var Dgram = require('dgram');


// Declare internals

var internals = {};


exports.sntpTime = function (host, callback) {

    var sent = 0;

    var isFinished = false;
    var finish = function (err, result) {

        if (!isFinished) {
            isFinished = true;
            socket.close();
            return callback(err, result);
        }
    };

    var socket = Dgram.createSocket('udp4');

    socket.on('message', function (buffer, rinfo) {

        var received = Date.now();

        var message = new internals.NtpMessage(buffer);
        if (!message.isValid ||
            message.mode !== 'server') {

            return finish(new Error('Invalid server response'));
        }

        message.roundtrip = (received - sent) - (message.transmitTimestamp - message.receiveTimestamp);
        message.offset = received - message.transmitTimestamp - (message.roundtrip / 2);

        return finish(null, message);
    });

    socket.on('error', function (err) {

        return finish(err);
    });

    var message = new Buffer(48);
    message[0] = 0x1B;                      // Set version number to 4 and Mode to 3 (client)
    for (var i = 1; i < 48; i++) {          // Set rest of message to zeros
        message[i] = 0;
    }

    sent = Date.now();
    socket.send(message, 0, message.length, 123, 'pool.ntp.org', function (err, bytes) {

        if (err) {
            return finish(err);
        }

        if (bytes !== 48) {
            return finish(new Error('too short'));
        }
    });
};


internals.NtpMessage = function (buffer) {

    this.isValid = false;

    // Validate

    if (buffer.length !== 48) {
        return;
    }

    // Leap indicator

    var li = (buffer[0] >> 6);
    switch (li) {
        case 0: this.leapIndicator = 'noWarning'; break;
        case 1: this.leapIndicator = 'lastMinute61'; break;
        case 2: this.leapIndicator = 'lastMinute59'; break;
        case 3:
        default: this.leapIndicator = 'alarm'; break;
    }

    // Version

    var vn = ((buffer[0] & 0x38) >> 3);
    this.version = vn;

    // Mode

    var mode = (buffer[0] & 0x7);
    switch (mode) {
        case 1: this.mode = 'symmetricActive'; break;
        case 2: this.mode = 'symmetricPassive'; break;
        case 3: this.mode = 'client'; break;
        case 4: this.mode = 'server'; break;
        case 5: this.mode = 'broadcast'; break;
        case 0:
        case 6:
        case 7:
        default: this.mode = 'unknown'; break;
    }

    // Stratum

    var stratum = buffer[1];
    if (stratum === 0) {
        this.stratum = 'unspecified';
    }
    else if (stratum === 1) {
        this.stratum = 'primary';
    }
    else if (stratum <= 15) {
        this.stratum = 'secondary';
    }
    else {
        this.stratum = 'reserved';
    }

    // Poll interval

    this.pollInterval = Math.round(Math.pow(2, buffer[2]));

    // Precision (msecs)

    this.precision = Math.pow(2, buffer[3]) * 1000;

    // Root delay (msecs)

    var rootDelay = 256 * (256 * (256 * buffer[4] + buffer[5]) + buffer[6]) + buffer[7];
    this.rootDelay = 1000 * (rootDelay / 0x10000);

    // Root dispersion (msecs)

    var rootDispersion = 256 * (256 * (256 * buffer[8] + buffer[9]) + buffer[10]) + buffer[11];
    this.rootDispersion = 1000 * (rootDispersion / 0x10000);

    // Reference identifier

    this.referenceId = '';
    switch (this.stratum) {
        case 'unspecified':
        case 'primary':
            this.referenceId = String.fromCharCode(buffer[12]) + String.fromCharCode(buffer[13]) + String.fromCharCode(buffer[14]) + String.fromCharCode(buffer[15]);
            break;
        case 'secondary':
            switch (this.version) {
                case 3:
                    this.referenceId = '' + buffer[12] + '.' + buffer[13] + '.' + buffer[14] + '.' + buffer[15];
                    break;
                case 4:
                    this.referenceId = (new Date(internals.toMsecs(buffer, 12))).toString();
                    break;
                default:
                    this.referenceId = 'unknown';
                    break;
            }
    }

    // Reference timestamp

    this.referenceTimestamp = internals.toMsecs(buffer, 16);

    // Originate timestamp

    this.originateTimestamp = internals.toMsecs(buffer, 24);

    // Receive timestamp

    this.receiveTimestamp = internals.toMsecs(buffer, 32);

    // Transmit timestamp

    this.transmitTimestamp = internals.toMsecs(buffer, 40);

    this.isValid = true;
    return this;
};


internals.toMsecs = function (buffer, offset) {

    var seconds = 0;
    var fraction = 0;

    for (var i = 0; i <= 3; ++i) {
        seconds = (256 * seconds) + buffer[offset + i];
    }

    for (i = 4; i <= 7; ++i) {
        fraction = (256 * fraction) + buffer[offset + i];
    }

    return ((seconds - 2208988800 + (fraction / Math.pow(2, 32))) * 1000);
};

