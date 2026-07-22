import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DOCUMENT_DROPZONE_HINT,
  DOCUMENT_DROPZONE_MULTI_REJECT_SINGLE,
  filesFromFileList,
  nextDragDepth,
  preventBrowserFileOpen,
  resolveDocumentDropzoneSelection,
} from "./documentDropzone";

function fakeFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, {
    type: "application/pdf",
  });
}

describe("P103 documentDropzone helpers", () => {
  it("hint canónico", () => {
    assert.match(DOCUMENT_DROPZONE_HINT, /Arrastra el archivo aquí/);
    assert.match(DOCUMENT_DROPZONE_HINT, /haz clic/);
  });

  it("single: entrega solo el primero; rechaza múltiples", () => {
    const one = resolveDocumentDropzoneSelection({
      files: [fakeFile("a.pdf")],
      multiple: false,
    });
    assert.equal(one.ok, true);
    if (one.ok) assert.equal(one.files.length, 1);

    const many = resolveDocumentDropzoneSelection({
      files: [fakeFile("a.pdf"), fakeFile("b.pdf")],
      multiple: false,
    });
    assert.equal(many.ok, false);
    if (!many.ok) {
      assert.equal(many.reason, "too_many");
      assert.equal(many.message, DOCUMENT_DROPZONE_MULTI_REJECT_SINGLE);
    }
  });

  it("multiple: respeta contrato y entrega todos", () => {
    const files = [fakeFile("a.pdf"), fakeFile("b.pdf")];
    const res = resolveDocumentDropzoneSelection({ files, multiple: true });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.files.length, 2);
  });

  it("empty no llama handler (ok=false empty)", () => {
    const res = resolveDocumentDropzoneSelection({ files: [], multiple: false });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "empty");
  });

  it("preventBrowserFileOpen llama preventDefault", () => {
    let prevented = false;
    let stopped = false;
    preventBrowserFileOpen({
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {
        stopped = true;
      },
    });
    assert.equal(prevented, true);
    assert.equal(stopped, true);
  });

  it("drag depth no baja de 0", () => {
    assert.equal(nextDragDepth(0, -1), 0);
    assert.equal(nextDragDepth(0, 1), 1);
    assert.equal(nextDragDepth(2, -1), 1);
  });

  it("filesFromFileList vacío → []", () => {
    assert.deepEqual(filesFromFileList(null), []);
  });

  it("drop válido single → una sola entrega (simulación handler)", () => {
    let calls = 0;
    let lastLen = 0;
    const deliver = (raw: File[]) => {
      const resolved = resolveDocumentDropzoneSelection({
        files: raw,
        multiple: false,
      });
      if (!resolved.ok) return;
      calls += 1;
      lastLen = resolved.files.length;
    };
    deliver([fakeFile("ok.pdf")]);
    deliver([fakeFile("a.pdf"), fakeFile("b.pdf")]);
    assert.equal(calls, 1);
    assert.equal(lastLen, 1);
  });
});
