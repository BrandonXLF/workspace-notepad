const vscode = acquireVsCodeApi();
const notepad = document.getElementById('notepad')!;
const disabledDialog = document.getElementById('disabled-dialog')! as HTMLDialogElement;
const enable = document.getElementById('activate')!;

function setUpNotepad() {
	notepad.focus();

	const range = document.createRange();
	range.selectNodeContents(notepad);
	range.collapse(false); // Collapse to end of selection

	const selection = window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
}

function makeActive() {
	vscode.postMessage({
		action: 'activate',
		type: document.body.getAttribute('data-type')
	});
}

makeActive();

notepad.addEventListener('input', () => vscode.postMessage({
	action: 'input',
	text: notepad.innerText
}));

enable.addEventListener('click', makeActive);

window.addEventListener('message', e => {
	switch (e.data.action) {
		case 'disable':
			disabledDialog.showModal();
			notepad.setAttribute('contenteditable', 'false');
			notepad.setAttribute('aria-disabled', 'true');

			break;
		case 'activate':
			disabledDialog.close();
			notepad.setAttribute('contenteditable', 'plaintext-only');
			notepad.setAttribute('aria-disabled', 'false');

			notepad.innerText = e.data.text;
			setUpNotepad();

			break;
	}
});