import * as vscode from "vscode";
import { parseFmu, Variable } from "./fmuParser";
import { generateWebviewHtml } from "./webview";

const CHUNK_SIZE = 10_000;

export class FmuEditorProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = "fmiview.fmuViewer";

  constructor(private readonly context: vscode.ExtensionContext) {}

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    webviewPanel.webview.options = { enableScripts: true };

    try {
      const data = await parseFmu(document.uri.fsPath);
      const variables = data.variables;
      const nonce = getNonce();
      webviewPanel.webview.html = generateWebviewHtml(data, nonce);

      // Send variables in chunks via postMessage to avoid huge inline HTML
      await sendVariablesInChunks(webviewPanel.webview, variables);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      webviewPanel.webview.html = `<!DOCTYPE html><html><body>
        <h2>Failed to open FMU</h2>
        <p>${msg.replace(/</g, "&lt;")}</p>
      </body></html>`;
    }
  }
}

async function sendVariablesInChunks(
  webview: vscode.Webview,
  variables: Variable[],
): Promise<void> {
  const total = variables.length;
  for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
    const chunk = variables.slice(offset, offset + CHUNK_SIZE).map((v) => ({
      n: v.name,
      vr: v.valueReference,
      t: v.type,
      c: v.causality || "",
      va: v.variability || "",
      s: v.start || "",
      u: v.unit || "",
      d: v.description || "",
    }));
    const done = offset + chunk.length >= total;
    webview.postMessage({ type: "variables", chunk, done, total });
    // Yield to event loop between chunks
    if (!done) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
