import { readFile } from 'fs';
import { App, TextAreaComponent, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, Workspace, WorkspaceLeaf } from 'obsidian';

import { SourceFileContent } from 'SourceFile';
import { LiveCodeBlock } from 'CodeBlock';

interface MyPluginSettings {
	mySetting: string;
	additionalIncludePaths: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default',
	additionalIncludePaths: ""
}

// #TODO Find a better way to store these globals, in settings, or in the plugin class scope
// Safe guard constants and search keys
export const g_codeBlockMarkerSyntax = "```";
export const g_clobberBlockContentsIfNullFile = true;
const g_clobberIfFileIsOutdated = false;
const g_insertWarningsWhenFileIsOutdated = true;

// #Potential feature placeholders
// const g_showPopUpWarningsOnInvalidArgumentEntry = true;
// const g_functionSearchCaseSensitivityOn = false;

// #TODO Add buttons for users to see and interact with:
// Update: Manual update button to grab latest source file content
// Edit Source: Write the content of the code block back into the source code file section (update source with local changes)

// #TODO Add notifications for users to see
// Warnings: File out of date, invalid arguments, corrupted/invalid data or settings, etc

export const g_myPluginKeywordTag = "live:"; // Tag to enable all plugin functionality for a block
export const g_myPluginKeywordTagRequiredArgValue = "true"; // Value required to also enable functionality
const g_codeBlockModeArgTag = "mode:";	// :live (update on change),
										// :manual (button to update),
										// :mod (auto change using mod time arg)
										// :sync, :link (ideas to consider)

const g_fileLineTag = "ln:";
const g_fileNameTag = "file:";
const g_fileModTimeTag = "mod:"; // #TODO Coming soon
const g_fileSymbolNameTag = "sym:"; // #TODO Coming soon
const g_fileLinePhraseTag = "lnPhrase:"; // TODO Review
export const g_codeBlockArgs = [g_myPluginKeywordTag, g_fileLineTag, g_fileNameTag, g_fileModTimeTag, g_fileSymbolNameTag, g_fileLinePhraseTag];

let g_previousOpenedFile: TFile | null;
export let g_currentOpenedFile: TFile | null;

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	
	async onload() : Promise<void> {
		await this.loadSettings();

		this.addSettingTab(new SettingsTab(this.app, this));

		this.addCommand({
			id: "navigate-to-last-note",
			name: "Navigate to last opened note",
			callback: () => {
				const currentLeaf = this.app.workspace.getLeaf();
				if (currentLeaf && g_previousOpenedFile) {
					currentLeaf.openFile(g_previousOpenedFile);
				}
			},
			hotkeys: [
			  {
				modifiers: ["Mod"],
				key: "tab",
			  },
			],
		});

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", async () =>{
				// console.log("active-leaf-change");

				g_previousOpenedFile = g_currentOpenedFile;
				g_currentOpenedFile = this.app.workspace.getActiveFile();

				if (g_currentOpenedFile) {
					// console.log("Active file name: " + g_currentOpenedFile.name);

					const content = await this.app.vault.read(g_currentOpenedFile);
					const result = this.UpdateLiveCodeBlocks(content);

					if (result[0]) {
						await this.app.vault.modify(g_currentOpenedFile, result[1]);
						// console.log("active-leaf-change set value");
					}
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('editor-change', editor => {
				
				const editedNoteContent = editor.getDoc().getValue();
				
				if (editor.hasFocus() ) { //&& this.CanTryReplaceCodeBlockContent(editedNoteContent)) {
					const previousCursorChar = editor.getCursor().ch;
					const previousCursorLine = editor.getCursor().line;
					
					const result = this.UpdateLiveCodeBlocks(editedNoteContent);
					if (result[0] && g_currentOpenedFile != null) {
						editor.getDoc().setValue(result[1]);
						
						// #TODO See if this avoid triggering another 'editor-change' event
						// this.app.vault.modify(g_currentOpenedFile, result[1]);

						editor.setCursor(previousCursorLine, previousCursorChar);
						// console.log("editor-change set value");
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

	g_writesRemaining: number = 30; // #TODO Review infinite loop safety
	private UpdateLiveCodeBlocks(fileContent: string) : [boolean, string] {

		// 1. Find all live code blocks in current file content
		// #NOTE Handle odd number markers by finding headers with args and reacting from there
		let passedCharCount = 0;
		let codeBlockMarkerIndexPairs : [number] = [0];
		codeBlockMarkerIndexPairs.pop();

		for (let index = 0; index < fileContent.length; index++) {
			const element = fileContent[index];
			if (element == '`') {
				passedCharCount += 1;
				if (passedCharCount >2) {
					passedCharCount = 0;
					codeBlockMarkerIndexPairs.push(index - 2);
					// console.log("Block marker: " + (index - 2));
				}
			}
			else {
				passedCharCount = 0;
			}
		}

		if (codeBlockMarkerIndexPairs.length % 2) {
			console.log("UpdateLiveCodeBlocks() Found " + codeBlockMarkerIndexPairs.length + " code block markers. Cannot work with odd number of code blocks so returning earlry");
			return [false, fileContent];
		}

		// 2. Parse each block to modify or ignore
		let changedLiveCodeBlocks: LiveCodeBlock[] = [];
		for (let index = 0; index < codeBlockMarkerIndexPairs.length; index += 2) {

			const openingBlockIndex = codeBlockMarkerIndexPairs[index];
			const closingBlockIndex = codeBlockMarkerIndexPairs[index + 1] + g_codeBlockMarkerSyntax.length;
			
			const blockContentStr = fileContent.substring(openingBlockIndex, closingBlockIndex);
			const liveCodeBlock: LiveCodeBlock = new LiveCodeBlock(blockContentStr, openingBlockIndex, closingBlockIndex);
			// console.log("Block:\n" + liveCodeBlock.Content());

			// const result = this.old_ReplaceCodeBlockContent(fileContent);
			if (liveCodeBlock.IsValidCodeBlock()) {
				const resultLiveCodeBlock = this.ReplaceCodeBlockContent(liveCodeBlock);

				// #TODO Accumulate block content and stich them back into file content
				// console.log(resultLiveCodeBlock.Content());

				if (resultLiveCodeBlock.IsValidCodeBlock() && resultLiveCodeBlock.HasChanged() && this.g_writesRemaining > 0) {
					changedLiveCodeBlocks.push(resultLiveCodeBlock);
				}
			}
			else {
				console.log("Continue\n");
				continue;
			}
		}

		if (changedLiveCodeBlocks.length == 0) {
			return [false, fileContent];
		}

		let newFileContent = "";
		let lastContentIndex = 0;
		for (let index = 0; index < changedLiveCodeBlocks.length; index++) {

			newFileContent += fileContent.substring(lastContentIndex, changedLiveCodeBlocks[index].FileStartIndex());
			newFileContent += changedLiveCodeBlocks[index].Content();
			lastContentIndex = changedLiveCodeBlocks[index].FileEndIndex();
		}

		newFileContent += fileContent.substring(lastContentIndex);

		this.g_writesRemaining -= 1;
		console.log("Writes remaining: " + this.g_writesRemaining);
		if (this.g_writesRemaining == 0) {
			this.g_writesRemaining -= 1;
			console.log("!! Write limit reached !!");
		}

		return [true, newFileContent];
	}
	
	private ReplaceCodeBlockContent(liveCodeBlock: LiveCodeBlock) : LiveCodeBlock {

		// console.log("ReplaceCodeBlockContent");

		if (liveCodeBlock.IsValidCodeBlock() && liveCodeBlock.IsValidLiveCodeBlock()) {
			// console.log("Block met requirements:\n");
		}
		else {
			console.log("Block requirements not met:\n");
			return liveCodeBlock;
		}
		// liveCodeBlock.Print();
		
		const filepathArgument = liveCodeBlock.m_header.GetBlockHeaderArgValueByKey(g_fileNameTag);
		let sourceFileContent: SourceFileContent = new SourceFileContent(filepathArgument, this.settings.additionalIncludePaths);
		
		if (!sourceFileContent.FileExists())
		{
			if (g_clobberBlockContentsIfNullFile) { // #TODO Duplicated logic can be a function or better statement structure
				liveCodeBlock.m_body.DeleteContents();
			}
			return liveCodeBlock;
		}

		// #TODO Detect user changes by caching and comparing header information.
		// When a user makes an argument change, then we could look to clobber the body contents and
		// update the body content with the file information, taking new user argument info into account.
		const onlyClobberBodyContentIfBodyIsEmpty = true;

		if (onlyClobberBodyContentIfBodyIsEmpty && !liveCodeBlock.m_body.IsEmpty()) {
			return liveCodeBlock;
		}

		liveCodeBlock.m_header.PrintArgs();
		const modTimeArgValue = liveCodeBlock.m_header.GetBlockHeaderArgValueByKey(g_fileModTimeTag);
		const sourceFileModTime = sourceFileContent.ModTime();
		console.log("modTimeArgValue: " + modTimeArgValue);

		if (modTimeArgValue.length > 0) {
			const argModTimeNum = +modTimeArgValue;
			console.log("modTimeNum " + argModTimeNum);
			if (sourceFileModTime > argModTimeNum) {
				// #TODO Update block body content
				console.log("sourceFileModTime is greater");
			}
			else {
				console.log("argModTimeNum is greater");
			}
		}
		else {
			liveCodeBlock.m_header.AddArg(g_fileModTimeTag, sourceFileModTime.toString());
		}

		let firstLineValue = 1; // #NOTE Inclusive
		let lastLineValue = Number.MAX_VALUE;
		
		const fileSymbolNameArgValue = liveCodeBlock.m_header.GetBlockHeaderArgValueByKey(g_fileSymbolNameTag);
		console.log("fileSymbolNameArgValue: " + fileSymbolNameArgValue);
		const fileLinePhraseArgValue = liveCodeBlock.m_header.GetBlockHeaderArgValueByKey(g_fileLinePhraseTag);
		const fileLineArgValue = liveCodeBlock.m_header.GetBlockHeaderArgValueByKey(g_fileLineTag);

		if (fileSymbolNameArgValue.length > 0) { // fn:
			sourceFileContent.SegmentSymbolAndBraces(fileSymbolNameArgValue);
		}
		else if (fileLinePhraseArgValue.length > 0) { // lnPhrase:
			sourceFileContent.SegmentLinePhrase(fileLinePhraseArgValue);
		}
		else if (fileLineArgValue.length > 0) { // ln:
			// console.log("fileLineArgValue: " + fileLineArgValue);

			const delimiterIndex = fileLineArgValue.indexOf('-');

			if (delimiterIndex > -1) {
				firstLineValue = +fileLineArgValue.substring(0, delimiterIndex);
				lastLineValue = +fileLineArgValue.substring(delimiterIndex + 1);
			}
			else {
				firstLineValue = +fileLineArgValue;
			}
			sourceFileContent.Segment(firstLineValue, lastLineValue);
		}

		liveCodeBlock.m_body.ReplaceContent(sourceFileContent.Content());
		return liveCodeBlock;
	}
}

function setAttributes(element: any, attributes: any) {
	for (let key in attributes) {
	  element.setAttribute(key, attributes[key]);
	}
  }

class SettingsTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();
		
		containerEl.createEl("h1", { text: "Header" });

		const stylingTemplateSetting = new Setting(containerEl);
		stylingTemplateSetting.settingEl.setAttribute(
		  "style",
		  "display: grid; grid-template-columns: 1fr;"
		);
		stylingTemplateSetting
		  .setName("CSS snippet template")
		  .setDesc(
			"Set default CSS styling as a template for new CSS files you choose to create."
		  );

		const stylingTemplateContent = new TextAreaComponent(
			stylingTemplateSetting.controlEl
		  );
		  setAttributes(stylingTemplateContent.inputEl, {
			style: "margin-top: 12px; width: 100%;  height: 32vh;",
			class: "ms-css-editor",
		  });
		  stylingTemplateContent
	  
			.setValue(this.plugin.settings.additionalIncludePaths)
			.onChange(async (value) => {
			  // #TODO Ensure proper directory syntax (handle quotes and missing end slash)
			  const sanitizedIncludeDirs = value;
			  this.plugin.settings.additionalIncludePaths = sanitizedIncludeDirs;
			  this.plugin.saveSettings();
			});

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
