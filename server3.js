#!/usr/bin/env node

import http from 'http'
import mime from 'mime'
import serve_static from './lib/server3.js'

let server = http.createServer( (req, res) => {
    serve_static(req, res, req.url, {
        headers: { 'server': '3' },
        mime: { 'text/markdown': ['txt'] },
        verbose: true
    })
})

server.listen(process.env.PORT || 3000)
console.error(process.pid, process.cwd())
