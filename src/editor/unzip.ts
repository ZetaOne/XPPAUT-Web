// Reading a .zip (Restore from .zip): stored and deflated entries, with the
// browser's own DecompressionStream.

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(s).arrayBuffer())
}

export async function unzip(buf: Uint8Array): Promise<Array<{ name: string; data: Uint8Array }>> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  // the end of central directory record, searched from the end
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  if (eocd < 0) throw new Error('not a .zip file')
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const out: Array<{ name: string; data: Uint8Array }> = []
  for (let k = 0; k < count; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const method = v.getUint16(p + 10, true)
    const csize = v.getUint32(p + 20, true)
    const nlen = v.getUint16(p + 28, true)
    const xlen = v.getUint16(p + 30, true)
    const clen = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen))
    p += 46 + nlen + xlen + clen
    if (name.endsWith('/')) continue
    const lnlen = v.getUint16(local + 26, true)
    const lxlen = v.getUint16(local + 28, true)
    const start = local + 30 + lnlen + lxlen
    const raw = buf.subarray(start, start + csize)
    const data = method === 0 ? new Uint8Array(raw) : method === 8 ? await inflate(raw) : null
    if (data) out.push({ name, data })
  }
  return out
}
