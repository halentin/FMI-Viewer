import * as vscode from "vscode";
import { FmuEditorProvider } from "./fmuEditorProvider";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      FmuEditorProvider.viewType,
      new FmuEditorProvider(context),
      { supportsMultipleEditorsPerDocument: false },
    ),
  );
}

export function deactivate() {}
