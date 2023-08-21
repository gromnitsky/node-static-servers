#!/usr/bin/env -S mocha -u tdd

import assert from 'assert'
import * as server3 from '../lib/server3.js'

suite('accept_encoding', function() {
    test('accept_encoding_parse', function() {
        let parse = server3.accept_encoding_parse
        assert.deepEqual(parse(''), [])
        assert.deepEqual(parse(','), [])
        assert.deepEqual(parse('gzip, deflate'), [
            { name: 'gzip', q: 1 },
            { name: 'deflate', q: 1 },
        ])
        assert.deepEqual(parse('*;foo=bar;q=0.1, ;,lol,br;q=1.0, gzip;q=0.8'), [
            { name: 'lol', q: 1 },
            { name: 'br', q: 1 },
            { name: 'gzip', q: 0.8 },
            { name: '*', q: 0.1 }
        ])
    })

    test('accept_encoding_negotiate', function() {
        let nt = enc => server3.accept_encoding_negotiate('deflate', server3.accept_encoding_parse(enc))
        assert.equal(nt(), 'pass-through')
        assert.equal(nt('gzip, deflate'), 'compress')
        assert.equal(nt('gzip, deflate;q=0'), 'no deal')
        assert.equal(nt('gzip, *;q=0'), 'no deal')
        assert.equal(nt('gzip, br'), 'pass-through')
    })
})
