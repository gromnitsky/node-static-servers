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
        process.env.DEBUG_BOUNDARY = '12345'
        this.kill = u.server_start(server_name, done)
    })

    suiteTeardown(function() {
        delete process.env.DEBUG_BOUNDARY
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
        assert.equal(r.hdr.server.status, 'HTTP/1.1 400 Error: Argument invalide')
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
        assert(!/deflate/.test(hdr.etag))
    })

    test('application/octet-stream ask to compress', function() {
        let r = u.curl("http://127.0.0.1:3000/Makefile", '--compressed')
        let hdr = r.hdr.server.p
        assert.equal(hdr['content-length'], '95')
        assert.equal(hdr['content-type'], 'application/octet-stream')
        assert(!/deflate/.test(hdr.etag))
    })

    test('if-modified-since', function() {
        if (server_ver < 2) this.skip()

        let stats = fs.statSync('package.json')
        let r = u.curl("http://127.0.0.1:3000/package.json", '-H',
                       `if-modified-since: ${stats.mtime.toUTCString()}`)
        assert.equal(r.hdr.server.status, 'HTTP/1.1 304 Not Modified')

        let date = new Date(stats.mtime-1000)
        r = u.curl("http://127.0.0.1:3000/package.json", '-H',
                   `if-modified-since: ${date.toUTCString()}`)
        assert.equal(r.hdr.server.status, 'HTTP/1.1 200 OK')
    })

    test('if-none-match', function() {
        if (server_ver < 2) this.skip()
        let etag = s => '"'+[s.dev, s.ino, s.mtime.getTime()].join("-")+'"'

        let stats = fs.statSync('package.json')
        let r = u.curl("http://127.0.0.1:3000/package.json", '-H',
                       `if-none-match: ${etag(stats)}`)
        assert.equal(r.hdr.server.status, 'HTTP/1.1 304 Not Modified')

        r = u.curl("http://127.0.0.1:3000/package.json", '-H',
                       `if-none-match: 1`)
        assert.equal(r.hdr.server.status, 'HTTP/1.1 200 OK')
    })

    test('application/json ask to compress', function() {
        if (server_ver < 3) this.skip()

        let r = u.curl("http://127.0.0.1:3000/package.json", '--compressed')
        let hdr = r.hdr.server.p
        assert.equal(hdr['content-length'], undefined)
        assert(/-deflate/.test(hdr.etag))
    })

    test('406', function() {
        if (server_ver < 3) this.skip()

        let r = u.curl("http://127.0.0.1:3000/package.json",
                     '-H', 'Accept-Encoding: foo, *;q=0')
        assert.equal(r.hdr.server.status, 'HTTP/1.1 406 Error: Pas acceptable')
    })

    test('416', function() {
        if (server_ver < 4) this.skip()

        let r = u.curl("http://127.0.0.1:3000/package.json",
                       '-H', 'range: bytes=2-1')
        assert.equal(r.hdr.server.status, 'HTTP/1.1 416 Error: Plage non satisfaisable')
    })

    test('range: bytes=0-10', function() {
        if (server_ver < 4) this.skip()

        let r = u.curl("http://127.0.0.1:3000/package.json",
                       '-H', 'range: bytes=0-10')
        let hdr = r.hdr.server.p
        assert.equal(hdr['content-length'], '11')
        assert.equal(hdr['content-range'], 'bytes 0-10/50')
    })

    test('range: bytes=0-10, --compressed', function() {
        if (server_ver < 4) this.skip()

        let r = u.curl("http://127.0.0.1:3000/package.json",
                       '-H', 'range: bytes=0-10', '--compressed')
        let hdr = r.hdr.server.p
        assert.equal(hdr['content-length'], 11)
        assert.equal(hdr['content-range'], 'bytes 0-10/50')
        assert.equal(r.body, '{"type":"mo')
    })

    test('range: bytes=0-10,-1', function() {
        if (server_ver < 4) this.skip()

        let r = u.curl("http://127.0.0.1:3000/package.json",
                       '-H', 'range: bytes=0-10,-1')
        let hdr = r.hdr.server.p
        assert.equal(hdr['content-length'], 176)
        assert.equal(hdr['content-range'], undefined)
        assert.equal(hdr['content-type'], `multipart/byteranges; boundary=12345`)
        assert.equal(r.body, `
--12345
Content-Type: application/json
Content-Range: bytes 0-10/50

{"type":"mo
--12345
Content-Type: application/json
Content-Range: bytes 49-49/50

}
--12345--
`.replaceAll("\n", "\r\n"))
    })

    test('if-range date', function() {
        if (server_ver < 4) this.skip()

        let stats = fs.statSync('package.json')
        let r = u.curl("http://127.0.0.1:3000/package.json",
                       '-H', 'range: bytes=0-10',
                       '-H', `if-range: ${stats.mtime.toUTCString()}`)
        assert.equal('HTTP/1.1 206 Partial Content', r.hdr.server.status)

        let date = new Date(stats.mtime-1000)
        r = u.curl("http://127.0.0.1:3000/package.json", '-H',
                       '-H', 'range: bytes=0-10',
                       '-H', `if-range: ${date.toUTCString()}`)
        assert.equal(r.hdr.server.status, 'HTTP/1.1 200 OK')
    })

    test('if-range etag', function() {
        if (server_ver < 4) this.skip()
        let etag = s => '"'+[s.dev, s.ino, s.mtime.getTime()].join("-")+'"'

        let stats = fs.statSync('package.json')
        let r = u.curl("http://127.0.0.1:3000/package.json",
                       '-H', 'range: bytes=0-10',
                       '-H', `if-range: ${etag(stats)}`)
        assert.equal('HTTP/1.1 206 Partial Content', r.hdr.server.status)

        r = u.curl("http://127.0.0.1:3000/package.json", '-H',
                       '-H', 'range: bytes=0-10',
                       '-H', `if-range: 1`)
        assert.equal(r.hdr.server.status, 'HTTP/1.1 200 OK')
    })

})
