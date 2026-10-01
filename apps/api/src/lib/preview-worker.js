// Körs i en egen tråd (se preview.js) så att en tung EPS/PDF aldrig låser
// webbservern. Ghostscript kompilerat till WebAssembly: inget behöver
// installeras på servern, och filen tolkas i en isolerad minnes-sandlåda
// utan åtkomst till serverns filsystem.
import fs from "node:fs";
import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";
import Module from "@jspawn/ghostscript-wasm";

const require = createRequire(import.meta.url);
const wasmPath = require.resolve("@jspawn/ghostscript-wasm/gs.wasm");
// Ghostscript skriver en lång feldump till stdout när en fil inte går att
// tolka. Den hör inte hemma i serverloggen (felet skickas ändå tillbaka som
// meddelande), och i en arbetstråd är stdout trådens egen ström.
process.stdout.write = () => true;
process.stderr.write = () => true;

let compiled = null;

parentPort.on("message", async ({ id, input, args }) => {
  try {
    compiled ??= await WebAssembly.compile(fs.readFileSync(wasmPath));
    // Ny instans per fil: Ghostscripts main() är bara tänkt att köras en gång.
    const gs = await Module({
      print() {},
      printErr() {},
      instantiateWasm(imports, done) {
        WebAssembly.instantiate(compiled, imports).then((instance) => done(instance, compiled));
        return {};
      },
    });
    gs.FS.writeFile("/in", input);
    const code = gs.callMain([...args, "-sOutputFile=/out.png", "/in"]);
    if (code !== 0) throw new Error(`Ghostscript kunde inte läsa filen (kod ${code})`);
    const png = gs.FS.readFile("/out.png");
    parentPort.postMessage({ id, png }, [png.buffer]);
  } catch (err) {
    parentPort.postMessage({ id, error: err?.message ?? String(err) });
  }
});
