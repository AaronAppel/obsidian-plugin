import { readFile } from 'fs';
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, Workspace, WorkspaceLeaf } from 'obsidian';

import * as fs from 'fs'; // #TODO Deprecate as above lines already import fs

// #TODO Remember to rename these classes and interfaces!
// The template is still alive and well, with excess logic and default names.

interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

// #TODO Find a better way to store these globals, in settings, or in the plugin class scope
// Safe guard constants and search keys
const g_codeBlockMarkerSyntax = "```";
const g_clobberBlockContentsIfNullFile = true;
const g_clobberIfFileIsOutdated = false;
const g_insertWarningsWhenFileIsOutdated = true;

// #Potential feature placeholders
// const g_showPopUpWarningsOnInvalidArgumentEntry = true;
// const g_functionSearchCaseSensitivityOn = false;

const g_myPluginKeywordTag = "live:"; // Tag to enable all plugin functionality for a block
const g_myPluginKeywordTagRequiredArgValue = "true"; // Value required to also enable functionality

const g_fileLineTag = "ln:";
const g_fileNameTag = "file:";
const g_fileModTimeTag = "mod:"; // #TODO Coming soon
const g_fileFunctionNameTag = "fn:"; // #TODO Coming soon
const g_codeBlockArgs = [g_myPluginKeywordTag, g_fileLineTag, g_fileNameTag, g_fileModTimeTag, g_fileFunctionNameTag];

let g_previousOpenedFile: TFile | null;
let g_currentOpenedFile: TFile | null;

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	loggingEnabled: boolean = false; // For easily stripping logs from builds on commit

	private Log(message: string) {
		if (this.loggingEnabled) {
			console.log(message);
		}
	}

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
				// this.Log("active-leaf-change");

				g_previousOpenedFile = g_currentOpenedFile;
				g_currentOpenedFile = this.app.workspace.getActiveFile();

				if (g_currentOpenedFile) {
					// this.Log("Active file: " + g_currentOpenedFile.name);
					const content = await this.app.vault.read(g_currentOpenedFile);
					if (this.CanTryReplaceCodeBlockContent(content)) {
						const result =  this.ReplaceCodeBlockContent(content);
						if (result[0]) {
							await this.app.vault.modify(g_currentOpenedFile, result[1]);
							// this.Log("active-leaf-change set value");
						}
					}
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('editor-change', editor => {
				// this.Log("editor-change");
				
				const editedNoteContent = editor.getDoc().getValue();
				
				if (editor.hasFocus() && this.CanTryReplaceCodeBlockContent(editedNoteContent)) {
					const previousCursorChar = editor.getCursor().ch;
					const previousCursorLine = editor.getCursor().line;
					
					const result = this.ReplaceCodeBlockContent(editedNoteContent);
					if (result[0] && g_currentOpenedFile != null) {
						editor.getDoc().setValue(result[1]);
						
						// #TODO See if this avoid triggering another 'editor-change' event
						// await this.app.vault.modify(g_currentOpenedFile, result[1]);

						editor.setCursor(previousCursorLine, previousCursorChar);
						// this.Log("editor-change set value");
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

	private FindCodeBlockMarkersTagIndices1stChar(fileContent: string): [number, number] {
		const indexOfMarkerStart = fileContent.indexOf(g_codeBlockMarkerSyntax);
		const indexOfMarkerEnd = fileContent.indexOf(g_codeBlockMarkerSyntax, indexOfMarkerStart + 1);
		// this.Log(indexOfMarkerStart + " indices " + indexOfMarkerEnd);
		return [indexOfMarkerStart, indexOfMarkerEnd];
	}

	private FoundExistingCodeBlockContent(fileContent: string) {

		// #TODO Review logic for safety. Only look if it's safe to replace content
		// so the default is no/unsafe unless we find no/empty content.

		const tagIndices = this.FindCodeBlockMarkersTagIndices1stChar(fileContent);
		if (tagIndices[0] != -1 && tagIndices[1] != -1) {

			const indexOfNextNewLine = fileContent.indexOf('\n', tagIndices[0]);
			if (indexOfNextNewLine < 0) {
				this.Log("FoundExistingContent() returned false. No new line found");
				return false;
			}

			const contentBetweenMarkers = fileContent.substring(indexOfNextNewLine,  tagIndices[1]);
			this.Log("FoundExistingContent() returned " + (contentBetweenMarkers.trim().length > 0));
			return contentBetweenMarkers.trim().length > 0;
		}
		return false;
	}

	private CanTryReplaceCodeBlockContent(fileContent: string) {
		
		// #TODO Multi block support using g_codeBlockMarker count
		// #TODO Handle app load, leaf changed, and editor changed events better (specifically/differently)

		const tagIndices = this.FindCodeBlockMarkersTagIndices1stChar(fileContent);

		if (tagIndices[0] != -1 && tagIndices[1] != -1) {

			const indexOfNextNewLine = fileContent.indexOf('\n', tagIndices[0]);
			if (indexOfNextNewLine < 0) {
				// Log("CanTryReplace() returned false. No new line found");
				return false;
			}

			if (!g_clobberBlockContentsIfNullFile) {
				if (this.FoundExistingCodeBlockContent(fileContent)) {
					// this.Log("CanTryReplace() returned false. Found existing content");
					return false;
				}
			}

			const indexOfLiveTag = fileContent.indexOf(g_myPluginKeywordTag);
			const indexOfFileTag = fileContent.indexOf(g_fileNameTag);
			
			const liveTagInBlock = indexOfLiveTag > tagIndices[0] && indexOfLiveTag < tagIndices[1];
			const fileTagInBlock = indexOfFileTag > tagIndices[0] && indexOfFileTag < tagIndices[1];

			// this.Log("CanTryReplace() in returned " + (liveTagInBlock && fileTagInBlock) + " missing tags" + !(liveTagInBlock && fileTagInBlock));
			return liveTagInBlock && fileTagInBlock;
		}

		// this.Log("CanTryReplace() returned false. Tags out of range");
		return false;
	}

	private ReplaceCodeBlockContent(fileContent: string) : [boolean, string] {
		
		const WRITE_NEW_DATA = false; // #TODO Improve safety return boolean

		// #TODO Handle multiple code blocks
		// const cursor = editorEditorField.GetCursor()
		this.Log("ReplaceFileTagContent");

		const markerTagIndices = this.FindCodeBlockMarkersTagIndices1stChar(fileContent);
		if (markerTagIndices[0] == -1 || markerTagIndices[1] == -1) {
			this.Log("FindTagIndices are invalid");
			return [WRITE_NEW_DATA, fileContent];
		}

		const blockHeaderStartIndex = markerTagIndices[0] + g_codeBlockMarkerSyntax.length;
		const blockHeaderEndIndex = fileContent.indexOf('\n', blockHeaderStartIndex);
		const blockHeader = fileContent.substring(blockHeaderStartIndex, blockHeaderEndIndex);
		// this.Log("Block header:\n" + blockHeader);
		
		// #NOTE blockBody includes starting '\n' char
		// #TODO use markerTagIndices[1] since it's pre-calculated
		const blockBody = fileContent.substring(blockHeaderEndIndex, markerTagIndices[1]);
		// this.Log("Block body:\n" + blockBody);

		const blockHeaderArgs = this.FindBlockHeaderArgs(blockHeader);
		for (let index = 0; index < blockHeaderArgs.length; index++) {
			this.Log("Args: " + blockHeaderArgs[index][0] + ", " + blockHeaderArgs[index][1]);
		}

		if (this.GetBlockHeaderArgValueByKey(blockHeaderArgs, g_myPluginKeywordTag) != g_myPluginKeywordTagRequiredArgValue)
		{
			// #NOTE DO NOT OPERATE WITHOUT THIS ARGUMENT VALUE PRESENT!
			this.Log("Missing " + g_myPluginKeywordTag + " tag so returning early");
		}

		const filepath = this.GetBlockHeaderArgValueByKey(blockHeaderArgs, g_fileNameTag);
		if (!filepath || filepath.length < 1)
		{
			this.Log("Missing " + g_fileNameTag + " tag or so returning early");

			if (g_clobberBlockContentsIfNullFile) { // #TODO Duplicated logic can be a function or better statement structure

				if (this.FoundExistingCodeBlockContent(fileContent)) { // #TODO Body has already been substringed into blockBody
					
					this.Log("Deleting block contents");

					const preBlockContent = fileContent.substring(0, markerTagIndices[0] + g_codeBlockMarkerSyntax.length);
					const postBlockContent = fileContent.substring(markerTagIndices[1]);

					const newContent = preBlockContent + blockHeader + "\n" + postBlockContent;
					this.Log(newContent);
					return [true, newContent];
				}
			}
		}

		if (!fs.existsSync(filepath)) {
			this.Log("Filepath doesn't exist");

			if (g_clobberBlockContentsIfNullFile) {

				if (this.FoundExistingCodeBlockContent(fileContent)) { // #TODO Body has already been substringed into blockBody
					
					this.Log("Deleting block contents");

					const preBlockContent = fileContent.substring(0, markerTagIndices[0] + g_codeBlockMarkerSyntax.length);
					const postBlockContent = fileContent.substring(markerTagIndices[1]);

					const newContent = preBlockContent + blockHeader + "\n" + postBlockContent;
					this.Log(newContent);
					return [true, newContent];
				}
			}

			return [WRITE_NEW_DATA, fileContent];
		}
		this.Log("Filepath exists");

		// #TODO Detect user changes by caching and comparing header information.
		// When a user makes an argument change, then we could look to clobber the body contents and
		// update the body content with the file information, taking new user argument info into account.
		const onlyClobberBodyContentIfBodyIsEmpty = true;

		if (onlyClobberBodyContentIfBodyIsEmpty) {
			if (blockBody.trim().length > 0) { // #NOTE Cheap check
				this.Log("ReplaceFileTagContent block body is not empty");
				return [WRITE_NEW_DATA, fileContent];
			}
	
			if (this.FoundExistingCodeBlockContent(fileContent)) { // #NOTE More involved but safer check
				this.Log("ReplaceFileTagContent FoundExistingCodeBlockContent found existing content");
				return [WRITE_NEW_DATA, fileContent];
			}
		}

		let assetFileContent = fs.readFileSync(filepath, 'utf-8');
		// this.Log("AssetFileContent:\n" + assetFileContent);
		const result = this.SplitStringByLineBreaks(assetFileContent);
		const numberOfLines = result.length;
		// this.Log("AssetFilelines: " + numberOfLines);

		let firstLineValue = 1; // #NOTE Inclusive
		let lastLineValue = numberOfLines; // #NOTE Inclusive

		const fileLineArgValue = this.GetBlockHeaderArgValueByKey(blockHeaderArgs, g_fileLineTag);
		if (fileLineArgValue.length > 0) {
			this.Log("fileLineArgValue: " + fileLineArgValue);

			const delimiterIndex = fileLineArgValue.indexOf('-');

			if (delimiterIndex > -1) {
				firstLineValue = +fileLineArgValue.substring(0, delimiterIndex);
				lastLineValue = +fileLineArgValue.substring(delimiterIndex + 1);
			}
			else {
				firstLineValue = +fileLineArgValue;
			}
		}

		firstLineValue = Math.clamp(firstLineValue, 1, numberOfLines);
		lastLineValue = Math.clamp(lastLineValue, 1, numberOfLines);
		this.Log("firstLineValue " + firstLineValue + " lastLineValue " + lastLineValue);

		if (firstLineValue >= lastLineValue) { // #TODO Handle case where they are equal
			this.Log("firstLineValue >= lastLineValue so returning early");
			return [WRITE_NEW_DATA, fileContent];
		}
		else {
			this.Log("Starting # " + firstLineValue + " Ending # " + lastLineValue);
			
			let subStringStartCharIndex = 0;
			let subStringEndCharIndex = 0;

			for (let index = 0; index < firstLineValue - 1; index++) {
				subStringStartCharIndex += result[index].length + 1;
			}

			for (let index = 0; index < lastLineValue; index++) {
				subStringEndCharIndex += result[index].length;
				if (index > 0) {
					subStringEndCharIndex += 1; // #TODO Handle '\n' char
				}
			}

			assetFileContent = assetFileContent.substring(subStringStartCharIndex, subStringEndCharIndex);
			this.Log(subStringStartCharIndex + " " + subStringEndCharIndex);
		}

		const preBlockContent = fileContent.substring(0, blockHeaderEndIndex);
		// this.Log("ss1: " + preBlockContent);
		const postBlockContent = fileContent.substring(markerTagIndices[1]);
		// this.Log("ss2: " + postBlockContent);
		fileContent = preBlockContent + "\n" + assetFileContent + "\n" + postBlockContent;
		// this.Log(preBlockContent + "\n" + assetFileContent + postBlockContent);
		this.Log(fileContent);

		return [true, fileContent]; // #TODO remove early return for testing
		// Below code is experimental

		const blockContentIsUpToDate = false;
		if (blockContentIsUpToDate) { // #TODO Compare file history versus last updated in block
			this.Log("Live file up to date");
			return [WRITE_NEW_DATA, fileContent];
		}

		const modtimeArgValue = this.GetBlockHeaderArgValueByKey(blockHeaderArgs, g_fileModTimeTag);
		if (modtimeArgValue.length > 0) {

			// #TODO Find file last modified date
			let fileLastModifiedTime = 0; // #TODO Add date to react to file changes
			const file = this.app.workspace.getActiveFile();
			if (file != null) {
				// fileLastModifiedTime = file.stat.mtime;
			}
	
			const contentIsOlderThanFile = fileLastModifiedTime > +modtimeArgValue;
			if (contentIsOlderThanFile)
			{
				if (g_insertWarningsWhenFileIsOutdated) {
				}
				
				if (g_clobberIfFileIsOutdated) {
				}
			}
			
			// #TODO Add g_fileModTimeTag + fileLastModifiedTime to the args header
			// assetFileContent, fileLastModifiedTime;
		}
		else {
			// #TODO Add mod time to block arguments (append to end by default)
			this.Log(g_fileModTimeTag + " tag not found");
		}

		return [true, fileContent];
	}

	private FindBlockHeaderArgs(blockHeaderContent: string): [[string, string]] {

		if (blockHeaderContent == null || blockHeaderContent.length < 1) {
			return [["", ""]];
		}

		let arr: [[string, string]] = [["", ""]]; // #TODO Find out how to create an empty array of tuples
		arr.pop(); // #TODO Work around to ensure tuple array is empty (for logging convenience)

		for (let index = 0; index < g_codeBlockArgs.length; index++) {
			if (blockHeaderContent.contains(g_codeBlockArgs[index])) {
				const result = this.FindBlockHeaderArg(blockHeaderContent, g_codeBlockArgs[index]);
				if (result.length > 0) {
					arr.push([g_codeBlockArgs[index], result]);
					// this.Log("Pushed: " + g_codeBlockArgs[index] + ", " + result);
				}
			}
		}

		return arr;
	}

	private FindBlockHeaderArg(blockHeaderContent: string, arg: string) {
		// this.Log("arg: " + arg + " Content: " + blockHeaderContent);

		let indexStart = blockHeaderContent.indexOf(arg) + arg.length;

		if (indexStart > -1) {
			
			let indexEnd;
			if (blockHeaderContent.indexOf("\"") == indexStart) { // #TODO Dependency with quotes coming earlier than file name argument
				indexStart += 1;
				indexEnd = blockHeaderContent.indexOf("\"", indexStart);
				// this.Log("Arg starts with quote at index: " + indexStart);
			}
			else {
				indexEnd = blockHeaderContent.indexOf(" ", indexStart); // #TODO Handle \n,\t,\r,' ', or general white space
			}
			// this.Log("indexStart: " + indexStart + " indexEnd: " + indexEnd);
			
			if (indexEnd > indexStart) {
				const argValue = blockHeaderContent.substring(indexStart, indexEnd);
				// this.Log("Found arg: " + argValue);
				return argValue;
			}
		}
		// this.Log("Error finding cod block header argument value");
		return "";
	}

	private GetBlockHeaderArgValueByKey(argumentsArray: [[string, string]], argumentKey: string) : string {

		for (let index = 0; index < argumentsArray.length; index++) {
			if (argumentsArray[index][0] == argumentKey) {
				return argumentsArray[index][1];
			}
		}
		return "";
	}

	private SplitStringByLineBreaks(assetFileContent: string) {
		return assetFileContent.split(/\r\n|\r|\n/);
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
