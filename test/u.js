import child_process from 'child_process'
import path from 'path'

export function curl(url, ...args) {
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

export function __dirname() { return new URL('.', import.meta.url).pathname }

export function server_start(n, callback) {
    let kill = () => child_process.spawnSync('make', ['kill', `server=${n}`])
    kill()

    let src = path.join(__dirname(), '..')
    let server = child_process.spawn(path.join(src, n))
    server.stderr.on('data', () => callback())

    return kill
}
