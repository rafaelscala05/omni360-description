const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf8');

// Find the line where '  );' is printed before {/* Preview Modal */}
const lines = content.split('\n');

let newLines = [];
let i = 0;
while (i < lines.length) {
  if (lines[i].trim() === ");" && lines[i+2] && lines[i+1].includes("{/* Preview Modal */}")) {
    // skip this ");"
    newLines.push(lines[i+1]);
    newLines.push(lines[i+2]);
    i += 3;
    continue;
  }
  newLines.push(lines[i]);
  i++;
}

// Now append } at the very end. Wait, the very end of the file is currently:
//    </div>
//  );
// }
// if we removed the ");" from the middle, we need to ensure the end has ");".
// Let's check the bottom of the file in newLines.
let lastLineIdx = newLines.length - 1;
while(lastLineIdx >= 0 && newLines[lastLineIdx].trim() === "") lastLineIdx--;

// Since we removed '  );', the file currently ends with:
//      />
//
//    </div>
//  );
// }
// Wait! Let's check the end of the file first using head/tail equivalent to be sure.

fs.writeFileSync('src/App.tsx', newLines.join('\n'), 'utf8');
