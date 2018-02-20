// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import http from "http";
import tmp from "tmp";
import vscode from "vscode";
import ws from "ws";

class OnMessage {
  private cleanupCallback?: () => void;
  private closed: boolean;
  private disposables: vscode.Disposable[];
  private document?: vscode.TextDocument;
  private editor?: vscode.TextEditor;
  private editorTitle?: string;
  private remoteChangedText?: string;
  private socket: ws;

  constructor(socket: ws) {
    this.closed = false;
    this.socket = socket;
    this.disposables = [];

    this.socket.on("text", this.onMessage);
    this.socket.on("close", this.doCleanup);
  }

  private async onMessage(text: string) {
    const request = JSON.parse(text);

    if (this.editor === null) {
      this.editorTitle = request.title;
      tmp.file((err, path, fd, cleanupCallback) => {
        this.cleanupCallback = cleanupCallback;

        vscode.workspace
          .openTextDocument(path)
          .then((textDocument: vscode.TextDocument) => {
            this.document = textDocument;
            vscode.window
              .showTextDocument(textDocument)
              .then((editor: vscode.TextEditor) => {
                this.editor = editor;
                this.updateEditorText(request.text);

                this.disposables.push(
                  vscode.workspace.onDidCloseTextDocument(
                    (doc: vscode.TextDocument) => {
                      if (doc === this.document) {
                        this.closed = true;
                        this.socket.close();
                        this.doCleanup();
                      }
                    },
                  ),
                );

                this.disposables.push(
                  vscode.workspace.onDidChangeTextDocument(
                    (event: vscode.TextDocumentChangeEvent) => {
                      if (event.document === this.document) {
                        const changedText = this.document.getText();
                        if (changedText !== this.remoteChangedText) {
                          const change = JSON.stringify({
                            selections: [],
                            syntax: "TODO",
                            text: changedText,
                            title: this.editorTitle,
                          });

                          // Empty doc change event fires before close.
                          // Work around race.
                          return setTimeout(
                            () => this.closed || this.socket.send(change),
                            50,
                          );
                        }
                      }
                    },
                  ),
                );
              });
          });
      });
    } else {
      this.updateEditorText(request.text);
      return (this.remoteChangedText = request.text);
    }
  }

  private doCleanup() {
    if (this.cleanupCallback) {
      this.cleanupCallback();
    }
    this.disposables.forEach((disposable: vscode.Disposable) =>
      disposable.dispose(),
    );
  }

  private updateEditorText(text: string) {
    const editor = this.editor!;
    editor.edit((editBuilder: vscode.TextEditorEdit) => {
      const lineCount = editor.document.lineCount;
      const lastLine = editor.document.lineAt(lineCount - 1);
      const endPos = lastLine.range.end;
      const range = new vscode.Range(new vscode.Position(0, 0), endPos);
      editBuilder.delete(range);
      editBuilder.insert(new vscode.Position(0, 0), text);
    });
  }
}

let httpStatusServer: http.Server;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  // console.log('Congratulations, your extension "ghosttext" is now active!');

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with  registerCommand
  // The commandId parameter must match the command field in package.json
  const disposable = vscode.commands.registerCommand(
    "extension.enableGhostText",
    () => {
      // The code you place here will be executed every time your command is executed

      // Display a message box to the user
      vscode.window.showInformationMessage("Ghost text has been enabled!");
    },
  );

  context.subscriptions.push(disposable);

  httpStatusServer = http.createServer((req, res) => {
    const wsServer = new ws.Server({ server: httpStatusServer });
    wsServer.on("connection", (socket: ws) => new OnMessage(socket));

    const response = JSON.stringify({
      ProtocolVersion: 1,
      WebSocketPort: httpStatusServer.address().port,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(response);
  });

  return httpStatusServer.listen(4001);
}

// this method is called when your extension is deactivated
export function deactivate() {
  return httpStatusServer.close();
}
