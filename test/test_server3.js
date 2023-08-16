#!/usr/bin/env -S mocha -u tdd

import assert from 'assert'
import * as server3 from '../lib/server3.js'

suite('server3', function() {
    setup(function() {
    })

    test('accept_encoding_parse', function() {
        assert.deepEqual(server3.accept_encoding_parse(''), [])
        assert.deepEqual(server3.accept_encoding_parse(','), [])
        assert.deepEqual(server3.accept_encoding_parse('gzip, deflate'), [
            { name: 'gzip', q: 1 },
            { name: 'deflate', q: 1 },
        ])
        assert.deepEqual(server3.accept_encoding_parse('*;foo=bar;q=0.1, ;,compress,br;q=1.0, gzip;q=0.8'), [
            { name: 'compress', q: 1 },
            { name: 'br', q: 1 },
            { name: 'gzip', q: 0.8 },
            { name: '*', q: 0.1 }
        ])
    })

    test('accept_encoding_negotiate', function() {
        assert.equal(server3.accept_encoding_negotiate('deflate', server3.accept_encoding_parse('')), false)

        assert.equal(server3.accept_encoding_negotiate('deflate', server3.accept_encoding_parse('gzip, deflate')), true)

        let err = server3.accept_encoding_negotiate('deflate', server3.accept_encoding_parse('gzip, deflate;q=0'))
        assert(err instanceof Error)

        err = server3.accept_encoding_negotiate('deflate', server3.accept_encoding_parse('gzip, *;q=0'))
        assert(err instanceof Error)

        assert.equal(server3.accept_encoding_negotiate('deflate', server3.accept_encoding_parse('gzip, br')), false)
    })
})
