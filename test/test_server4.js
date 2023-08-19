#!/usr/bin/env -S mocha -u tdd

import assert from 'assert/strict'
import * as server4 from '../lib/server4.js'

suite('range', function() {
    test('junk in Range header', function() {
        assert.equal(server4.range_parse(' ', 1000), null)
        assert.equal(server4.range_parse('foo', 1000), null)
        assert.equal(server4.range_parse(',', 1000), null)
        assert.equal(server4.range_parse('-', 1000), null)
    })

    test('too many ranges', function() {
        assert.equal(server4.range_parse('0-1,0-1,0-1,0-1,0-1,0-1', 1000), null)
    })

    test('valid single', function() {
        assert.deepEqual(server4.range_parse('-500', 1000), [[500, 999]])
        assert.deepEqual(server4.range_parse('-1500', 1000), [[0, 999]])
        assert.deepEqual(server4.range_parse('500-', 1000), [[500, 999]])
        assert.deepEqual(server4.range_parse('500', 1000), [[500, 999]])
        assert.deepEqual(server4.range_parse('0-', 1000), [[0, 999]])
        assert.deepEqual(server4.range_parse('0', 1000), [[0, 999]])
        assert.deepEqual(server4.range_parse('-0', 1000), [[0, 999]])
        assert.deepEqual(server4.range_parse('10', 1000), [[10, 999]])
        assert.deepEqual(server4.range_parse('-1', 1000), [[999, 999]])
    })

    test('valid multi', function() {
        assert.deepEqual(server4.range_parse('0-0,-1', 1000),
                         [[0, 0], [999,999]])
    })

    test('invalid', function() {
        assert.equal(server4.range_parse('5-', 0), null)
        assert.equal(server4.range_parse('-10--10', 1000), null)
        assert.equal(server4.range_parse('-0--1', 1000), null)
        assert.equal(server4.range_parse('-1-lol', 1000), null)
        assert.equal(server4.range_parse('2-1', 1000), null)
    })

    test('overlaps', function() {
        assert.equal(server4.range_parse('1-10,11-20,2-10,12-19,3-5,-1', 1000), null)
        assert.deepEqual(server4.range_parse('1-10,11-20,2-10,12-19,-1', 1000),
                         [
                             [ 1, 10 ],
                             [ 11, 20 ],
                             [ 2, 10 ],
                             [ 12, 19 ],
                             [ 999, 999 ]
                         ])
    })
})
