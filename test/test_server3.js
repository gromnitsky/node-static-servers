#!/usr/bin/env -S mocha -u tdd

import assert from 'assert'
import fs from 'fs'
import path from 'path'
import child_process from 'child_process'
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

function curl(url, ...args) {
    let r = child_process.spawnSync('curl', ['-sfv', url, ...args],
                                    {encoding: 'utf-8'})
    let stderr = r.stderr.split("\r\n")
    let server = stderr.filter( v => v[0] === '<')
        .map( v => v.slice(2)).filter(Boolean)
    return {
        status: r.status,
        body: r.stdout,
        hdr: {
            client: stderr.filter( v => v[0] === '>')
                .map( v => v.slice(2)).filter(Boolean),
            server: {
                status: server[0],
                p: server.slice(1).map( v => {
                    let sep = v.indexOf(':')
                    return {
                        name: v.slice(0, sep).toLowerCase(),
                        val: v.slice(sep+2)
                    }
                }).reduce( (acc, cur) => {
                    acc[cur.name] = cur.val
                    return acc
                }, {})
            }
        }
    }
}

let __dirname = new URL('.', import.meta.url).pathname
let src = path.join(__dirname, '..')

suite('server3', function() {
    setup(function(done) {
        this.kill = () => child_process.spawnSync('make', ['kill', 'server=server3.js'])
        this.kill()

        let server = child_process.spawn(path.join(src, 'server3.js'))
        server.stderr.on('data', () => done())
    })

    teardown(function() {
        this.kill()
    })

    test('404', function() {
        let r = curl("http://127.0.0.1:3000")
        assert.match(r.hdr.server.status,
                     /HTTP\/1.1 404 Error: ENOENT.+index.html/)

        r = curl("http://127.0.0.1:3000/../foo")
        assert.match(r.hdr.server.status,
                     /HTTP\/1.1 404 Error: ENOENT.+[^.][^.]\/foo/)
    })

    test('directory', function() {
        let r = curl("http://127.0.0.1:3000/test")
        assert.equal(r.hdr.server.status, 'HTTP/1.1 400 Error: Invalid argument')
    })

    test('no permissions', function() {
        try {fs.unlinkSync('noperm')} catch { /**/ }
        fs.writeFileSync('noperm', 'delete me')
        fs.chmodSync('noperm', '0000')
        let r = curl("http://127.0.0.1:3000/noperm")
        assert.match(r.hdr.server.status, /HTTP\/1.1 403/)
        fs.unlinkSync('noperm')
    })

    test('application/octet-stream do not ask to compress', function() {
        let r = curl("http://127.0.0.1:3000/Makefile")
        assert.equal(r.hdr.server.status, 'HTTP/1.1 200 OK')
        let hdr = r.hdr.server.p
        assert.equal(hdr['content-length'], '95')
        assert.equal(hdr['content-type'], 'application/octet-stream')
        assert(!/compressed/.test(hdr.etag))
    })

    test('application/octet-stream ask to compress', function() {
        let r = curl("http://127.0.0.1:3000/Makefile", '--compressed')
        let hdr = r.hdr.server.p
        assert.equal(hdr['content-length'], '95')
        assert.equal(hdr['content-type'], 'application/octet-stream')
        assert(!/compressed/.test(hdr.etag))
    })

    test('application/json ask to compress', function() {
        let r = curl("http://127.0.0.1:3000/package.json", '--compressed')
        let hdr = r.hdr.server.p
        assert.equal(hdr['content-length'], undefined)
        assert(/compressed/.test(hdr.etag))
    })

    test('406', function() {
        let r = curl("http://127.0.0.1:3000/package.json",
                     '-H', 'Accept-Encoding: foo, *;q=0')
        assert.equal(r.hdr.server.status, 'HTTP/1.1 406 Error: Pas acceptable')
    })

})
