import { readFile } from 'fs';
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, Workspace, WorkspaceLeaf } from 'obsidian';

import * as fs from 'fs';

// #TODO Remember to rename these classes and interfaces!
// The template is still alive and well, with excess logic and default names.

interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

// Safe guard constants and search keys
const g_codeBlockMarker = "```";
const g_pluginKeyword = "live:true";
const g_fileNameTag = "file:";

const g_deleteBlockContentsIfNullFile = true;
const g_functionSearchCaseSensitivityOn = false;

const g_clobberIfFileIsOutdated = false;
const g_insertWarningsWhenFileIsOutdated = true;

let g_previousOpenedFile: TFile | null;
let g_currentOpenedFile: TFile | null;

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() : Promise<void> {
		await this.loadSettings();

		this.addSettingTab(new SettingTab(this.app, this));

		this.addCommand({
			id: "navigate-to-last-leaf",
			name: "Navigate to last opened leaf",
			callback: () => {
				const currentLeaf = this.app.workspace.getLeaf();
				if (currentLeaf && g_previousOpenedFile) {
					currentLeaf.openFile(g_previousOpenedFile);
				}
			},
			hotkeys: [
			  {
				modifiers: ["Mod"],
				key: "tab", // #TODO Save and load hotkey in settings
			  },
			],
		});

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", async () =>{

				g_previousOpenedFile = g_currentOpenedFile;
				g_currentOpenedFile = this.app.workspace.getActiveFile();

				if (g_currentOpenedFile) {
					console.log("Active file: " + g_currentOpenedFile.name);
					const content = await this.app.vault.read(g_currentOpenedFile);
					if (this.CanTryReplace(content)) {
						const result =  this.ReplaceFileTagContent(content);
						if (result[0]) {
							await this.app.vault.modify(g_currentOpenedFile, result[1]);
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

class SettingTab extends PluginSettingTab {
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
