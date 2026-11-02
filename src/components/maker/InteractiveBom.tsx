"use client";
import { useEffect, useRef, useState } from "react";
import type { CanonicalIrBundle } from "@/vendor/canon/lib/eda/types";
import { ibomData, ibomConfig, scriptJson } from "@/lib/maker/ibom";
import { download } from "@/lib/maker/download";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
export default function InteractiveBom({
  bundle,
  active = true,
}: {
  bundle: CanonicalIrBundle;
  active?: boolean;
}) {
  const [board, setBoard] = useState(0),
    [html, setHtml] = useState(""),
    [error, setError] = useState(""),
    [key, setKey] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const pcb = bundle.pcbs[board];
  const redraw = () =>
    frame.current?.contentWindow?.postMessage(
      { type: "tindie-ibom-resize" },
      "*",
    );
  useEffect(() => {
    if (!active || !frame.current) return;
    const observer = new ResizeObserver(redraw);
    observer.observe(frame.current);
    const id = requestAnimationFrame(redraw);
    return () => {
      cancelAnimationFrame(id);
      observer.disconnect();
    };
  }, [active, html]);
  useEffect(() => {
    if (!pcb) return;
    const abort = new AbortController();
    setHtml("");
    setError("");
    (async () => {
      try {
        const names = [
          "LICENSE",
          "ibom.html",
          "ibom.css",
          "split.js",
          "pep.js",
          "util.js",
          "render.js",
          "table-util.js",
          "ibom.js",
        ];
        const contents = await Promise.all(
          names.map(async (n) => {
            const r = await fetch("/ibom/" + n, { signal: abort.signal });
            if (!r.ok) throw Error("iBOM assets could not be loaded.");
            return r.text();
          }),
        );
        const files = Object.fromEntries(names.map((n, i) => [n, contents[i]]));
        const data = ibomData(bundle, pcb);
        const storageKey =
          "maker-ibom-" +
          bytesToHex(
            sha256(
              new TextEncoder().encode(
                JSON.stringify([bundle.project.name, pcb]),
              ),
            ),
          );
        let saved = {};
        try {
          saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
        } catch {}
        const bridge = `/*MAKER_PROGRESS*/var makerSaved=${scriptJson(saved)};/*END_MAKER_PROGRESS*/storagePrefix=${scriptJson(storageKey + "__")};var originalInitStorage=initStorage;initStorage=function(){if(parent===window){originalInitStorage();if(storage){Object.keys(makerSaved).forEach(function(k){if(storage.getItem(k)===null)storage.setItem(k,makerSaved[k])});return}}storage={getItem:function(k){return makerSaved[k]||null},setItem:function(k,v){makerSaved[k]=v;if(parent!==window)parent.postMessage({type:'tindie-ibom-save',key:${scriptJson(storageKey)},values:makerSaved},'*')}}};`;

        const substitutions: Record<string, string> = {
          CSS: files["ibom.css"],
          USERCSS: `body{font-family:Arial,sans-serif;color:#29434d}button.depressed{background-color:#159fb0}button{border-color:#d4e1e5;border-radius:6px}.top{border-color:#d4e1e5}.bom table{font-family:Arial,sans-serif}#bomtable{font-family:Arial,sans-serif;font-size:12px;min-width:760px}#bomtable th{background:#f0f6f7;word-break:normal}#bomtable td,#bomtable th{border-color:#dae5e8;padding:9px 6px}#bomtable tr.highlighted{background:#d6f0f2}input{accent-color:#159fb0}.searchbox{background:#f7fafb}#title{font-size:18px}:root{--pad-color:#416f8d;--track-color:#bfdedc;--pcb-edge-color:#466b75;--pad-color-highlight:#ed784c}`,
          SPLITJS: files["split.js"],
          "LZ-STRING": "",
          POINTER_EVENTS_POLYFILL: files["pep.js"],
          CONFIG: "var config=" + scriptJson(ibomConfig) + ";",
          PCBDATA: "var pcbdata=" + scriptJson(data) + ";",
          UTILJS: files["util.js"],
          RENDERJS: files["render.js"],
          TABLEUTILJS: files["table-util.js"],
          IBOMJS: files["ibom.js"],
          USERJS:
            bridge +
            `
var makerResizeFrame=0;
function makerResize(){cancelAnimationFrame(makerResizeFrame);makerResizeFrame=requestAnimationFrame(function(){requestAnimationFrame(function(){if(typeof initDone!=="undefined"&&initDone&&document.documentElement.clientWidth>0&&document.documentElement.clientHeight>0)resizeAll();});});}
window.addEventListener('message',function(e){if(e.source===parent&&e.data&&e.data.type==='tindie-ibom-resize')makerResize();});
window.addEventListener('load',makerResize);
document.addEventListener('visibilitychange',function(){if(!document.hidden)makerResize();});
`,
          USERHEADER: "",
          USERFOOTER: "",
        };
        const output =
          "<!-- InteractiveHtmlBom MIT license\n" +
          files["LICENSE"] +
          "\n-->\n" +
          files["ibom.html"].replace(
            /\/\/\/([A-Z_-]+)\/\/\//g,
            (_, name) => substitutions[name] ?? "",
          );
        if (!abort.signal.aborted) {
          setKey(storageKey);
          setHtml(output);
        }
      } catch (e) {
        if (!abort.signal.aborted) setError(String(e));
      }
    })();
    return () => abort.abort();
  }, [bundle, pcb]);
  useEffect(() => {
    const listener = (e: MessageEvent) => {
      if (
        e.source !== frame.current?.contentWindow ||
        e.data?.type !== "tindie-ibom-save" ||
        e.data.key !== key
      )
        return;
      const value = JSON.stringify(e.data.values);
      if (value.length < 1000000)
        try {
          localStorage.setItem(key, value);
        } catch {
          setError(
            "Browser storage is unavailable. Export progress using iBOM settings.",
          );
        }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [key]);
  if (!pcb)
    return (
      <p className="notice">
        iBOM requires a PCB with component placements. Open the matching board
        file along with the schematic.
      </p>
    );
  return (
    <section className="ibom-panel">
      <div className="section-top">
        <h2>Interactive BOM</h2>
        <select
          aria-label="iBOM board"
          value={board}
          onChange={(e) => setBoard(Number(e.target.value))}
        >
          {bundle.pcbs.map((p, i) => (
            <option key={p.id} value={i}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          className="btn"
          disabled={!html}
          onClick={() =>
            download(
              new TextEncoder().encode(
                html.replace(
                  /\/\*MAKER_PROGRESS\*\/[\s\S]*?\/\*END_MAKER_PROGRESS\*\//,
                  () => {
                    let saved = {};
                    try {
                      saved = JSON.parse(localStorage.getItem(key) || "{}");
                    } catch {}
                    return (
                      "/*MAKER_PROGRESS*/var makerSaved=" +
                      scriptJson(saved) +
                      ";/*END_MAKER_PROGRESS*/"
                    );
                  },
                ),
              ),
              pcb.name + "-ibom.html",
              "text/html",
            )
          }
        >
          Download offline HTML
        </button>
      </div>
      <p className="notice">
        Select a BOM row or click a component on the board. Sourced / Placed
        progress is saved in this browser. DNP parts are excluded from assembly
        quantities. Copper fills and text not supplied by the project parser are
        omitted.
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {html ? (
        <iframe
          ref={frame}
          onLoad={redraw}
          title="Interactive PCB bill of materials"
          sandbox="allow-scripts allow-downloads"
          srcDoc={html}
          style={{
            width: "100%",
            height: 780,
            border: "1px solid #dce6e9",
            borderRadius: 12,
          }}
        />
      ) : (
        <p>Loading iBOM…</p>
      )}
      <small>
        Powered by{" "}
        <a
          href="https://github.com/openscopeproject/InteractiveHtmlBom"
          target="_blank"
          rel="noreferrer"
        >
          InteractiveHtmlBom
        </a>{" "}
        · MIT license · project data stays in your browser.
      </small>
    </section>
  );
}
