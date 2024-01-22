import { readFile } from 'fs';
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

import * as fs from 'fs';

// #TODO Remember to rename these classes and interfaces!
// The template is still alive and well, with excess logic and default names.

interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

// Safe guards constants and search keys
const g_codeBlockMarker = "```";
const g_pluginKeyword = "live:true";
const g_fileNameTag = "file:";

const g_deleteBlockContentsIfNullFile = true;
const g_functionSearchCaseSensitivityOn = false;

const g_clobberIfFileIsOutdated = false;
const g_insertWarningsWhenFileIsOutdated = true;

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() : Promise<void> {
		await this.loadSettings();
		console.log("onload");

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('Notice me!');
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", async () =>{
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile) {
					
					console.log("Active file: " + activeFile.name);
					const content = await this.app.vault.read(activeFile);
					if (this.CanTryReplace(content)) {
						const result =  this.ReplaceFileTagContent(content);
						if (result[0]) {
							await this.app.vault.modify(activeFile, result[1]);
							console.log("active-leaf-change set value");
						}
					}
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('editor-change', editor => {
				console.log("editor-change");
				
				const editedNoteContent = editor.getDoc().getValue();
				
				if (editor.hasFocus() && this.CanTryReplace(editedNoteContent)) {
					const previousCursorChar = editor.getCursor().ch;
					const previousCursorLine = editor.getCursor().line;
					
					const result = this.ReplaceFileTagContent(editedNoteContent);
					if (result[0]) {
						editor.getDoc().setValue(result[1]);
						editor.setCursor(previousCursorLine, previousCursorChar);
						console.log("editor-change set value");
					}
				}
			})
		);
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private FindMarkerTagIndices(fileContent: string): [number, number] {

		const indexOfMarkerStart = fileContent.indexOf(g_codeBlockMarker);
		const indexOfMarkerEnd = fileContent.indexOf(g_codeBlockMarker, indexOfMarkerStart + 1);
		console.log(indexOfMarkerStart + " indices " + indexOfMarkerEnd);

		return [indexOfMarkerStart, indexOfMarkerEnd];
	}

	private FoundExistingContent(fileContent: string) {
		const tagIndices = this.FindMarkerTagIndices(fileContent);

		if (tagIndices[0] != -1 && tagIndices[1] != -1) {

			const indexOfNextNewLine = fileContent.indexOf('\n', tagIndices[0]);
			if (indexOfNextNewLine < 0) {
				console.log("FoundExistingContent() returned false. No new line found");
				return false;
			}

			const contentBetweenMarkers = fileContent.substring(indexOfNextNewLine,  tagIndices[1]);
			console.log("FoundExistingContent() returned " + (contentBetweenMarkers.trim().length > 0));
			return contentBetweenMarkers.trim().length > 0;
		}
	}

	private CanTryReplace(fileContent: string) {
		
		// #TODO Multi block support using g_codeBlockMarker count

		const tagIndices = this.FindMarkerTagIndices(fileContent);

		if (tagIndices[0] != -1 && tagIndices[1] != -1) {

			const indexOfNextNewLine = fileContent.indexOf('\n', tagIndices[0]);
			if (indexOfNextNewLine < 0) {
				console.log("CanTryReplace() returned false. No new line found");
				return false;
			}

			if (!g_deleteBlockContentsIfNullFile) {
				if (this.FoundExistingContent(fileContent)) {
					console.log("CanTryReplace() returned false. Found existing content");
					return false;
				}
			}

			const indexOfLiveTag = fileContent.indexOf(g_pluginKeyword);
			const indexOfFileTag = fileContent.indexOf(g_fileNameTag);
			
			const liveTagInBlock = indexOfLiveTag > tagIndices[0] && indexOfLiveTag < tagIndices[1];
			const fileTagInBlock = indexOfFileTag > tagIndices[0] && indexOfFileTag < tagIndices[1];
			
			console.log("CanTryReplace() returned " + (liveTagInBlock && fileTagInBlock));
			return liveTagInBlock && fileTagInBlock;
		}

		console.log("CanTryReplace() returned false");
		return false;
	}

	private ReplaceFileTagContent(fileContent: string) : [boolean, string] {
		
		// #TODO Could rename ReplaceFileBlockContent() and handle multiple blocks

		console.log("ReplaceFileTagContent");
		
		if (!this.CanTryReplace(fileContent))
		{
			console.log("ReplaceFileTagContent: CanTryReplace() returned false");
			return [false, fileContent];
		}

		const fileOutOfDate = false;
		if (fileOutOfDate) { // #TODO Compare file history versus last updated in block
			console.log("Live file up to date");
			return [false, fileContent];
		}

		const tagIndices = this.FindMarkerTagIndices(fileContent);
		if (tagIndices[0] == -1 || tagIndices[1] == -1) {
			console.log("FindTagIndices are invalid");
			return [false, fileContent];
		}

		const indexOfFileTag = fileContent.indexOf(g_fileNameTag);

		const openingQuoteIndex = fileContent.indexOf("\"", indexOfFileTag);
		const closingQuoteIndex = fileContent.indexOf("\"", openingQuoteIndex + 1);
		// console.log(openingQuoteIndex + " " + closingQuoteIndex);

		// #TODO Handle : relative file paths, back slashes
		const filepath = fileContent.substring(openingQuoteIndex + 1, closingQuoteIndex);
		// filepath = filepath.replace("\\", "/", );
		// console.log("Filepath: " + filepath);

		const indexOfNextNewLine = fileContent.indexOf('\n', tagIndices[0]);
		if (!fs.existsSync(filepath)) {
			console.log("Filepath doesn't exist");

			if (g_deleteBlockContentsIfNullFile) {

				if (this.FoundExistingContent(fileContent)) {
					
					console.log("Deleting block contents");

					const preBlockContent = fileContent.substring(0, indexOfNextNewLine + 1);
					const postBlockContent = fileContent.substring(tagIndices[1]);

					console.log(preBlockContent + postBlockContent);

					return [true, preBlockContent + postBlockContent];
				}
			}

			return [false, fileContent];
		}
		console.log("Filepath exists");
		
		if (this.FoundExistingContent(fileContent)) {
			console.log("ReplaceFileTagContent found existing content");
			return [false, fileContent];
		}

		let assetFileContent = fs.readFileSync(filepath, 'utf-8');
		
		const args = "";
		if (args.includes("ln:"))
		{
			// #TODO Substring file by lines
			const lines = args.indexOf("ln:") + "ln:".length;
			const lineFormat = args.substring(lines, args.indexOf(' ', lines));

			// #TODO Format? ln:1-2, ln:1, ln:
			// lineFormat

			assetFileContent = this.CutdownFileInfo(assetFileContent);
		}
		else if (args.includes("fn:")) { // #TODO Search file for function by name and return only the code block of that function
			// g_functionSearchCaseSensitivityOn
		}

		const lastModifiedDate = ""; // #TODO Add date to react to file changes
		if (lastModifiedDate.length > 0)
		{
			// #TODO Find file last modified date

			// if (g_clobberIfFileIsOutdated) {}
			// if (g_insertWarningsWhenFileIsOutdated) {}

			assetFileContent += " date:" + lastModifiedDate;
		}

		const subString1 = fileContent.substring(0, indexOfNextNewLine);
		// console.log("ss1: " + subString1);
		const subString2 = fileContent.substring(tagIndices[1]);
		// console.log("ss2: " + subString2);
		fileContent = subString1 + "\n" + assetFileContent + subString2;
		// console.log(subString1 + "\n" + assetFileContent + subString2);
		// console.log(fileContent);

		return [true, fileContent];
	}

	private CutdownFileInfo(assetFileContent: string) {
		assetFileContent.split(/\r\n|\r|\n/);
		return assetFileContent;
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
