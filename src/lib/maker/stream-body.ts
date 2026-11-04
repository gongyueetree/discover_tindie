/**
 * Pass an upstream file to the browser as a stream instead of buffering it whole: the server never
 * holds more than a chunk, and large files are not built into one in-memory response. The first
 * `peek` bytes are read up front so the caller can check what the file is; the stream errors (and the
 * upstream download is cancelled) once more than `max` bytes have passed.
 */
export async function peekStream(body: ReadableStream<Uint8Array> | null, peek: number, max: number) {
  if (!body) throw Error("empty");
  const reader = body.getReader();
  const head: Uint8Array[] = [];
  let have = 0;
  let done = false;
  while (have < peek) {
    const r = await reader.read();
    if (r.done) {
      done = true;
      break;
    }
    head.push(r.value);
    have += r.value.length;
    if (have > max) {
      await reader.cancel();
      throw Error("too large");
    }
  }
  const first = new Uint8Array(have);
  let o = 0;
  for (const c of head) first.set(c, (o += c.length) - c.length);
  let sent = have;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (first.length) controller.enqueue(first);
      if (done) controller.close();
    },
    async pull(controller) {
      if (done) return;
      const r = await reader.read();
      if (r.done) {
        done = true;
        controller.close();
        return;
      }
      sent += r.value.length;
      if (sent > max) {
        done = true;
        await reader.cancel();
        controller.error(new Error("too large"));
        return;
      }
      controller.enqueue(r.value);
    },
    async cancel() {
      done = true;
      await reader.cancel();
    },
  });
  return { head: first, stream, cancel: () => reader.cancel().catch(() => undefined) };
}

/** A finished in-memory file sent in 256 KB chunks (a generated ZIP). */
export function chunkStream(bytes: Uint8Array, size = 256 * 1024) {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(i, (i += size)));
    },
  });
}
