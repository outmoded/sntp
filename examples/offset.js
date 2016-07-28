'use strict';

// Load modules

const Sntp = require('../lib');


// Declare internals

const internals = {};


// Request offset once

Sntp.offset((err, offset1) => {

    console.log(err, offset1);                    // New (served fresh)

    // Request offset again

    Sntp.offset((err, offset2) => {

        console.log(err, offset2);                // Identical (served from cache)
    });
});
