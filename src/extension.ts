import * as vscode from 'vscode';

type KeysForType<T, U> = { [K in keyof T]: T[K] extends U ? K : never; }[keyof T];

const enum WebviewType {
	MainEditor = 'mainEditor',
	SideView = 'sideView'
};

interface WebviewContainers {
	[WebviewType.MainEditor]?: vscode.WebviewPanel;
	[WebviewType.SideView]?: vscode.WebviewView;
}

class NotepadStorage {
	constructor(private readonly ctx: vscode.ExtensionContext) {}

	getText() {
		return this.ctx.workspaceState.get<string>('workspace-notepad') ?? '';
	}

	setText(txt: string) {
		this.ctx.workspaceState.update('workspace-notepad', txt);
	}

	async download() {
		const txt = this.getText();

		const uri = await vscode.window.showSaveDialog({
			defaultUri: vscode.Uri.file('workspace-notepad.txt')
		});
		
		if (!uri) {
			return;
		}

		await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(txt));
	}
}

class ActiveHistory<T> {
	private readonly history = new Set<T>();

	push(type: T) {
		this.history.delete(type); // Move to the end
		this.history.add(type);
	}

	remove(type: T) {
		this.history.delete(type);
	}

	get empty() {
		return this.history.size === 0;
	}

	get active() {
		return [...this.history].pop();
	}
}

class WebviewProvider implements vscode.WebviewViewProvider {
	private readonly containers: WebviewContainers = {};
	private readonly activeHistory = new ActiveHistory<WebviewType>();

	constructor(
		private readonly ctx: vscode.ExtensionContext,
		private readonly storage: NotepadStorage
	) {}

	private getHtml(webview: vscode.Webview, type: WebviewType) {
		const styleURI = webview.asWebviewUri(
			vscode.Uri.joinPath(this.ctx.extensionUri, 'assets', 'webview.css')
		);
		const scriptURI = webview.asWebviewUri(
			vscode.Uri.joinPath(this.ctx.extensionUri, 'out', 'webview.js')
		);

		return `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<link rel="stylesheet" type="text/css" href="${styleURI}" />
				</head>
				<body data-type="${type}">
					<dialog id="disabled-dialog">
						<button id="activate">Use Here</button>
					</dialog>
					<div id="notepad">Loading...</div>
					<script type="module" src="${scriptURI}"></script>
				</body>
			</html>
		`;
	}

	private makeActive(type: WebviewType) {
		if (!this.containers[type]) {
			return;
		}

		for (const [otherType, container] of Object.entries(this.containers)) {
			if (otherType !== type) {
				container.webview.postMessage({ action: 'disable' });
			}
		}

		this.activeHistory.push(type);

		this.containers[type].webview.postMessage({
			action: 'activate',
			text: this.storage.getText()
		});
	}

	private onInactive(type: WebviewType) {
		const isActive = this.activeHistory.active === type;

		this.activeHistory.remove(type);

		if (isActive && !this.activeHistory.empty) {
			this.makeActive(this.activeHistory.active);
		}
	}

	private handleMessage(msg: any) {
		switch (msg.action) {
			case 'input':
				this.storage.setText(msg.text);
				break;
			case 'activate':
				this.makeActive(msg.type);
				break;
		}
	}

	private handleViewStateChanges<T extends WebviewType, U extends Required<WebviewContainers>[T]>(
		type: T, webviewContainer: U, eventName: KeysForType<U, Function>
	) {
		let lastVisible = true;

		(webviewContainer[eventName] as Function)(() => {
			if (webviewContainer.visible === lastVisible) {
				return;
			}
			
			lastVisible = webviewContainer.visible;

			if (webviewContainer.visible) {
				this.makeActive(type);
			} else {
				this.onInactive(type);
			}
		});
	}

	private resolveWebview<T extends WebviewType, U extends Required<WebviewContainers>[T]>(
		type: T, webviewContainer: U, viewStateChangeEvent: KeysForType<U, Function>
	) {
		webviewContainer.webview.options = { enableScripts: true };
		webviewContainer.webview.html = this.getHtml(webviewContainer.webview, type);
		
		this.containers[type] = webviewContainer;
		webviewContainer.webview.onDidReceiveMessage(this.handleMessage, this);
		this.handleViewStateChanges(type, webviewContainer, viewStateChangeEvent);

		webviewContainer.onDidDispose(() => {
			delete this.containers[type];
			this.onInactive(type);
		});
	}
	
	resolveWebviewView(webviewView: vscode.WebviewView) {
		this.resolveWebview(WebviewType.SideView, webviewView, 'onDidChangeVisibility');
	}

	resolveMainEditorWebview(webviewPanel: vscode.WebviewPanel) {
		this.resolveWebview(WebviewType.MainEditor, webviewPanel, 'onDidChangeViewState');
	}

	showIfExists(type: WebviewType) {
		if (!this.containers[type]) {
			return false;
		}

		switch (type) {
			case WebviewType.MainEditor:
				this.containers[type].reveal();
				break;
			case WebviewType.SideView:
				this.containers[type].show();
				break;
		}

		this.makeActive(type);
		return true;
	}

	disposeMainEditorWebview() {
		this.containers[WebviewType.MainEditor]?.dispose();
	}
}

function createMainEditorWebviewPanel(ctx: vscode.ExtensionContext) {
	const panel = vscode.window.createWebviewPanel(
		'workspace-notepad-main-editor',
		'Workspace Notepad',
		vscode.ViewColumn.Active
	);

	panel.iconPath = {
		light: vscode.Uri.joinPath(ctx.extensionUri, 'media', 'icons', 'light.svg'),
		dark: vscode.Uri.joinPath(ctx.extensionUri, 'media', 'icons', 'dark.svg')
	};

	return panel;
}

export function activate(ctx: vscode.ExtensionContext) {
	const storage = new NotepadStorage(ctx);
	const webViewProvider = new WebviewProvider(ctx, storage);

	ctx.subscriptions.push(
		vscode.commands.registerCommand('workspace-notepad.download', () => storage.download()),
		vscode.commands.registerCommand('workspace-notepad.open-main-editor', async () => {
			if (!webViewProvider.showIfExists(WebviewType.MainEditor)) {
				webViewProvider.resolveMainEditorWebview(
					createMainEditorWebviewPanel(ctx)
				);
			}
		}),
		vscode.commands.registerCommand('workspace-notepad.move-to-side-view', () => {
			if (!webViewProvider.showIfExists(WebviewType.SideView)) {
				vscode.commands.executeCommand('workspace-notepad-side-view.focus');
			}

			webViewProvider.disposeMainEditorWebview();
		}),
		vscode.window.registerWebviewViewProvider('workspace-notepad-side-view', webViewProvider),
		vscode.window.registerWebviewPanelSerializer('workspace-notepad-main-editor', {
			async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel) {
				webViewProvider.resolveMainEditorWebview(webviewPanel);
			}
		})
	);
}