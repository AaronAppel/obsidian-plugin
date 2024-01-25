
import * as fs from 'fs';
import * as main from 'main';

export class SourceFileContent {
    
    private m_filePath: string = "";
    private m_fileContent: string = "";
    private m_AdditionalIncludesArr: string[] = [""];

    constructor(filepathArgument: string, additionalIncludes: string) {

        this.m_AdditionalIncludesArr = additionalIncludes.split(/\r\n|\r|\n/);
        this.LoadFile(filepathArgument);
    }
    
    private LoadFile(filepathArgument: string) {
        
		const potentialFilePath = this.TryFindFilePath(filepathArgument);

		if (!fs.existsSync(potentialFilePath)) {
			//console.log("No valid filepath found");
			//console.log("filepathArgument: " + filepathArgument);
            return;
		}
        
        // #TODO Get file name (with ext) to check if the current file referrences itself (invalid)
        const slashIndex = potentialFilePath.lastIndexOf('/');
        const incrementor = slashIndex > -1 ? 1 : 0;
        const newFileName = potentialFilePath.substring(slashIndex + incrementor);
        // console.log("newFileName: " + newFileName);

        if (main.g_currentOpenedFile == null) {
            console.log("Cannot validate current file name!");
            return;
        }
        else if (newFileName == main.g_currentOpenedFile?.name) {
            console.log("Cannot reference currently opened file (self)!");
            return;
        }

        this.m_filePath = potentialFilePath;
        //console.log("Valid filepath found : " + this.m_filePath);
        // fs.ReadStream.;
        this.m_fileContent = fs.readFileSync(this.m_filePath, 'utf-8');
    }

	private TryFindFilePath(filePath: string) {

        if (filePath.length == 0) {
            // console.log("TryFindFilePath: empty argument");
			return "";
        }

		if (fs.existsSync(filePath)) {
			// console.log("TryFindFilePath: passed arg " + filePath);
			return filePath;
		}
        
        // console.log("Length: " + this.m_AdditionalIncludesArr.length);
        // console.log("Includes: " + this.m_AdditionalIncludesArr);

		for (let index = 0; index < this.m_AdditionalIncludesArr.length; index++) {
			
			const tryFilePath = this.m_AdditionalIncludesArr[index] + filePath;
            // console.log("tryFilePath: " + tryFilePath);

			if (fs.existsSync(tryFilePath)) {
				// console.log("TryFindFilePath: " + tryFilePath);
				return tryFilePath;
			}
		}
		
		// console.log("TryFindFilePath: return empty");
		return "";
	}

    public FileExists() : boolean {
		return fs.existsSync(this.m_filePath);
    }

    public Content() : string {
        return this.m_fileContent;
    }

    public ModTime() : number {
        return fs.statSync(this.m_filePath).mtime.getTime();
    }

    private SplitContent() : string[] {
        let fileSplitContent: string[] = [];
        let lastIndex = 0;
        for (let index = 0; index < this.m_fileContent.length; index++) {
            if (this.m_fileContent[index] == '\n') {
                // #NOTE index + 1 to get the '\n' on the same line that it ends
                fileSplitContent.push(this.m_fileContent.substring(lastIndex, index + 1));
                lastIndex = index + 1;
            }
        }

        return fileSplitContent;
    }

    private ReverseIndexOf(content: string, key: string, startingIndex: number = -1) : number {

        let index = content.length - 1;
        if (startingIndex != -1) {

            if (startingIndex >= 0 && startingIndex < content.length) {
                index = startingIndex;
            }
            else {
                console.log("Invalid index of " + startingIndex + " passed!");
            }
        }

        let str: string = "";
        for (; index >= 0; index--) {
            const element = content[index];

            if (key.contains(element)) {
                str = element + str;

                if (str == key) {
                    console.log("Index of: " + index);
                    return index;
                }
            }
            else {
                str = "";
            }
        }

        console.log("Index of: " + -1);
        return -1;
    }

    public SegmentSymbolLine(symbolKey: string) {
        
        if (!this.m_fileContent.contains(symbolKey)) {
            console.log("SourceFile content does not contain symbol line key: " + symbolKey);
            return;
        }

        const symbolKeyIndex = this.m_fileContent.indexOf(symbolKey);
        const subStringStartIndex = this.ReverseIndexOf(this.m_fileContent, '\n', symbolKeyIndex) + 1;
        const subStringEndIndex = this.m_fileContent.indexOf('\n', symbolKeyIndex) + 1;

        // #TODO test line search argument
        // console.log("subStringStartIndex " + subStringStartIndex + " subStringEndIndex " + subStringEndIndex);
        // this.m_fileContent = this.m_fileContent.substring(subStringStartIndex, subStringEndIndex);
    }

    public SegmentSymbolAndBraces(symbolKey: string) {
        
        if (!this.m_fileContent.contains(symbolKey)) {
            console.log("SourceFile content does not contain symbol and braces key: " + symbolKey);
            return;
        }

        const symbolKeyIndex = this.m_fileContent.indexOf(symbolKey);
        const subStringStartIndex = this.ReverseIndexOf(this.m_fileContent, '\n', symbolKeyIndex) + 1;

        let numBracesOpen = 0;
        let canBreak = false;
        let subStringEndIndex = -1;

        for (let index = subStringStartIndex; index < this.m_fileContent.length; index++) {
            const element = this.m_fileContent[index];

            if (element == '{') {
                numBracesOpen += 1;
                canBreak = true;
            }
            else if (element == '}') {

                if (numBracesOpen == 0) {
                    console.log("Found closing brace when numBracesOpen == 0!");
                    return;
                }

                numBracesOpen -= 1;

                if (numBracesOpen == 0 && canBreak) {
                    subStringEndIndex = index + 1; // + 1 to include brace
                    break;
                }
            }
        }

        // console.log("subStringStartIndex " + subStringStartIndex + " subStringEndIndex " + subStringEndIndex);
        this.m_fileContent = this.m_fileContent.substring(subStringStartIndex, subStringEndIndex);
    }

    public SegmentLinePhrase(linePhraseArgValue: string) {
        
        if (!this.m_fileContent.contains(linePhraseArgValue)) {
            console.log("linePhraseArgValue: " + linePhraseArgValue + " not found!");
        }

        let fileSplitContent: string[] = this.SplitContent();

        let trackingBraces = false;
        for (let index = 0; index < fileSplitContent.length; index++) {

            if (fileSplitContent[index].contains(linePhraseArgValue)) {

                this.m_fileContent = fileSplitContent[index].substring(0, fileSplitContent[index].length - 1);
                return;
            }
        }
    }

    public Segment(firstLineValue: number, lastLineValue:number) {
        console.log("Total len: " + this.m_fileContent.length);
        
        let fileSplitContent: string[] = this.SplitContent();
        
		firstLineValue = Math.clamp(firstLineValue, 1, fileSplitContent.length);
		lastLineValue = Math.clamp(lastLineValue, 1, fileSplitContent.length);
		console.log("firstLineValue " + firstLineValue + " lastLineValue " + lastLineValue);

        if (firstLineValue == 1 && lastLineValue == fileSplitContent.length) {
            return;
        }
        else if (firstLineValue > lastLineValue) {
			console.log("firstLineValue >= lastLineValue so returning early");
            this.m_fileContent = "";
			return;
		}
        else if (firstLineValue == lastLineValue) {
            const line = fileSplitContent[firstLineValue - 1];
            this.m_fileContent = line.substring(0, line.length - 1);
        }
		else {
			console.log("Starting # " + firstLineValue + " Ending # " + lastLineValue);
			
			let subStringStartCharIndex = 0;
			let subStringEndCharIndex = 0;

			for (let index = 0; index < firstLineValue - 1; index++) {
				subStringStartCharIndex += fileSplitContent[index].length;
                console.log("subStringStartCharIndex: " + subStringStartCharIndex);
			}

			for (let index = 0; index < lastLineValue; index++) {
				subStringEndCharIndex += fileSplitContent[index].length;
			}

            // console.log("pre: " + this.m_fileContent);
            // #NOTE index - 1 to avoid the last '\n'
            if (lastLineValue < fileSplitContent.length) {
                subStringEndCharIndex -= 1;
            }
			this.m_fileContent = this.m_fileContent.substring(subStringStartCharIndex, subStringEndCharIndex);
            // console.log("post: " + this.m_fileContent);
			
            this.Print();
            // console.log("subStringStartCharIndex: " + subStringStartCharIndex);
            // console.log("subStringEndCharIndex: " + subStringEndCharIndex);
		}
    }

    private Print() {
        console.log(this.m_fileContent);
    }
}