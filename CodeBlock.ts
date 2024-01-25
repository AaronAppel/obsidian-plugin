
import * as main from 'main';

export class LiveCodeBlock {

	m_header: CodeBlockHeader;
	m_body: CodeBlockBody;

	private m_fileStartIndex: number = 0;
	private m_fileEndIndex: number = 0;

	constructor(blockContentStr: string, fileStartIndex: number, fileEndIndex: number) {

		this.m_header = new CodeBlockHeader(blockContentStr);
		this.m_body = new CodeBlockBody(blockContentStr);

		this.m_fileStartIndex = fileStartIndex;
		this.m_fileEndIndex = fileEndIndex;
	}

	public FileStartIndex() : number {
		return this.m_fileStartIndex;
	}

	public FileEndIndex() : number {
		return this.m_fileEndIndex;
	}

	public HasChanged() : boolean {
		return this.m_header.HasChanged() || this.m_body.HasChanged();
	}

	public IsValidCodeBlock() : boolean {
		return this.m_header.IsValidCodeBlockHeader() && this.m_body.IsValidCodeBlockBody();
	}

	public IsValidLiveCodeBlock() : boolean {
		return this.m_header.IsLiveCodeBlock() && this.m_body.IsLiveCodeBlock();
	}

	public Content() {
		return this.m_header.Content() + this.m_body.Content();
	}

	public Print() {
		this.m_header.Print();
		this.m_body.Print();
	}
}

export class CodeBlockHeader {

	private m_headerContent: string = "";
    private m_argsArr: [[string, string]] = [["", ""]];

	private m_hasChanged: boolean = false;
	
	constructor(blockContent: string) {
		
		// #TODO Support 1 line/inline code blocks
		// #NOTE Header keeps ending '\n' char so body doesn't have to
		this.m_headerContent = blockContent.substring(0, blockContent.indexOf('\n') + 1);
		this.m_argsArr.pop(); // Empty the default value
		this.CollectHeaderArgs(this.m_headerContent);
	}

	public AddArg(argKey: string, argValue: string) {

		if (this.m_headerContent.contains(argKey)) {
			console.log("Header already contains: " + argKey);
			return;
		}

		const contentNoNewLine = this.m_headerContent.substring(0, this.m_headerContent.length - 1);
		// this.m_headerContent = contentNoNewLine + ' ' + argKey + "\"" + argValue + '\" \n';
		this.m_headerContent = contentNoNewLine + ' ' + argKey + argValue + ' \n';
	}

	public HasChanged() : boolean {
		return this.m_hasChanged;
	}

	public IsValidCodeBlockHeader() : boolean {

		if (this.m_headerContent == null || this.m_headerContent.length < 1) {
			return false;
		}
		
		if (!this.m_headerContent.startsWith(main.g_codeBlockMarkerSyntax)) {
			return false;
		}

		return true;
	}

	public IsLiveCodeBlock() : boolean {

		// #NOTE DO NOT OPERATE WITHOUT THIS ARGUMENT VALUE PRESENT!
		if (!this.m_headerContent.contains(main.g_myPluginKeywordTag + main.g_myPluginKeywordTagRequiredArgValue)) {
			console.log("Missing " + main.g_myPluginKeywordTag + " tag so returning early");
            return false;
        }

		return true;
	}

	private CollectHeaderArgs(blockHeaderContent: string) {

        if (this.m_argsArr.length > 0) {
            console.log("m_arr is not empty!");
        }

        for (let index = 0; index < this.m_argsArr.length; index++) {
            this.m_argsArr.pop();
        }

		if (blockHeaderContent == null || blockHeaderContent.length < 1) {
            console.log("LoadHeaderArgs() blockHeaderContent is null or empty!");
			return;
		}

		for (let index = 0; index < main.g_codeBlockArgs.length; index++) {
			if (blockHeaderContent.contains(main.g_codeBlockArgs[index])) {
				const result = this.FindBlockHeaderArg(blockHeaderContent, main.g_codeBlockArgs[index]);
				if (result.length > 0) {
					this.m_argsArr.push([main.g_codeBlockArgs[index], result]);
					// console.log("Pushed: " + main.g_codeBlockArgs[index] + ", " + result);
				}
			}
		}
	}

    public PrintArgs() {
		for (let index = 0; index < this.m_argsArr.length; index += 2) {
			console.log("Args: " + this.m_argsArr[index][0] + ", " + this.m_argsArr[index][1]);
		}
    }

	public FindBlockHeaderArg(blockHeaderContent: string, arg: string) {
		// this.Log("arg: " + arg + " Content: " + blockHeaderContent);

		let indexStart = blockHeaderContent.indexOf(arg) + arg.length;

		if (indexStart > -1) {
			
			let indexEnd;
			if (blockHeaderContent.indexOf("\"", indexStart) == indexStart) { // #TODO Dependency with quotes coming earlier than file name argument
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

	public GetBlockHeaderArgValueByKey(argumentKey: string) : string {

		for (let index = 0; index < this.m_argsArr.length; index++) {
			if (this.m_argsArr[index][0] == argumentKey) {
				return this.m_argsArr[index][1];
			}
		}
		
		console.log("Code block header could not find key " + argumentKey + "!");
		return "";
	}

	public Content() {
		return this.m_headerContent;
	}

	public Print() {
		console.log("Code block header:\n" + this.m_headerContent);
	}
}

export class CodeBlockBody {
    
	private m_bodyContent: string = "";
	private m_hasChanged: boolean = false;
	
	constructor(blockContent: string) {
		// #TODO Support 1 line/inline code blocks
		// #NOTE blockBody excludes starting '\n' char
		this.m_bodyContent = blockContent.substring(blockContent.indexOf('\n'));
	}

	public HasChanged() : boolean {
		return this.m_hasChanged;
	}

	public IsValidCodeBlockBody() : boolean {
		return this.m_bodyContent.endsWith(main.g_codeBlockMarkerSyntax);
	}

	public IsLiveCodeBlock() : boolean {
		return true;
	}

	public IsEmpty() : boolean {
		// console.log("Code block body empty: " + (this.m_bodyContent.trim().replace('\n', '') == main.g_codeBlockMarkerSyntax));
		return this.m_bodyContent.trim().replace('\n', '') == main.g_codeBlockMarkerSyntax;
	}

	public DeleteContents() {
		if (!this.IsEmpty()) {
			// console.log("Deleting code block contents");
			this.m_bodyContent = main.g_codeBlockMarkerSyntax;
			this.m_hasChanged = true;
		}
	}

	public Content() {
		return this.m_bodyContent;
	}

	public ReplaceContent(content: string) {
		this.m_bodyContent = content + '\n' + main.g_codeBlockMarkerSyntax;
		this.m_hasChanged = true;
	}
	
	public Print() {
		console.log("Code block body:\n" + this.m_bodyContent);
	}
}
