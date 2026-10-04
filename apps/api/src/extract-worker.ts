// Worker thread for documents.ts: reads one file's text and tables off the API's event loop.
// "ready" comes first, so the parent can tell a worker that could not start (it then reads in-thread) from a bad file.
// The tables come back as JSON text: one string is cheap to hand over, a large array of rows is not.
import { parentPort, workerData } from "node:worker_threads";
import type { DocumentKind } from "@rasd/schemas";
import { extractContent } from "./extract.js";

const { buffer, name, kind } = workerData as { buffer: Uint8Array; name: string; kind: DocumentKind };
parentPort!.postMessage({ type: "ready" });
try {
  const { text, tables, pages } = await extractContent(Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength), name, kind);
  parentPort!.postMessage({ type: "done", text, tablesJson: JSON.stringify(tables), pages });
} catch (error) {
  parentPort!.postMessage({ type: "failed", error: String((error as Error)?.message ?? error).slice(0, 300) });
}
