#!/usr/bin/env -S mocha -u tdd

import assert from 'assert'
import fs from 'fs'
import * as u from './u.js'

let server_ver = Number(process.env.server) || (
    console.error("Usage: server=4 test/test_common.js"),
    process.exit(1)
)
let server_name = `server${server_ver}.js`

suite(server_name, function() {
    suiteSetup(function(done) {
        this.kill = u.server_start(server_name, done)
    })

    suiteTeardown(function() {
        this.kill()
    })

    test('404', function() {
        let r = u.curl("http://127.0.0.1:3000")
        assert.match(r.hdr.server.status,
                     /HTTP\/1.1 404 Error: ENOENT.+index.html/)

        r = u.curl("http://127.0.0.1:3000/../foo")
        assert.match(r.hdr.server.status,
                     /HTTP\/1.1 404 Error: ENOENT.+[^.][^.]\/foo/)
    })

    test('directory', function() {
        let r = u.curl("http://127.0.0.1:3000/test")
        assert.equal(r.hdr.server.status, 'HTTP/1.1 400 Error: Invalid argument')
    })

    test('no permissions', function() {
        let file = 'noperm.txt'
        try {fs.unlinkSync(file)} catch { /**/ }
        fs.writeFileSync(file, 'delete me')
        fs.chmodSync(file, '0000')
        let r = u.curl(`http://127.0.0.1:3000/${file}`)
        assert.match(r.hdr.server.status, /HTTP\/1.1 403/)
        fs.unlinkSync(file)
    })

    test('application/octet-stream do not ask to compress', function() {
        let r = u.curl("http://127.0.0.1:3000/Makefile")
        assert.equal(r.hdr.server.status, 'HTTP/1.1 200 OK')
        let hdr = r.hdr.server.p
        assert.equal(hdr['content-length'], '95')
        assert.equal(hdr['content-type'], 'application/octet-stream')
        assert(!/compressed/.test(hdr.etag))
    })

    test('application/octet-stream ask to compress', function() {
        let r = u.curl("http://127.0.0.1:3000/Makefile", '--compressed')
        let hdr = r.hdr.server.p
        assert.equal(hdr['content-length'], '95')
        assert.equal(hdr['content-type'], 'application/octet-stream')
        assert(!/compressed/.test(hdr.etag))
    })

    test('application/json ask to compress', function() {
        if (server_ver < 3) this.skip()

        let r = u.curl("http://127.0.0.1:3000/package.json", '--compressed')
        let hdr = r.hdr.server.p
        assert.equal(hdr['content-length'], undefined)
        assert(/compressed/.test(hdr.etag))
    })

    test('406', function() {
        if (server_ver < 3) this.skip()

        let r = u.curl("http://127.0.0.1:3000/package.json",
                     '-H', 'Accept-Encoding: foo, *;q=0')
        assert.equal(r.hdr.server.status, 'HTTP/1.1 406 Error: Pas acceptable')
    })

})
