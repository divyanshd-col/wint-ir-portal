const fs = require('fs');

function addBoundary(file) {
  let content = fs.readFileSync(file, 'utf8');
  if (!content.includes('ErrorBoundary')) {
    content = content.replace(
      "import EvalPanel from './EvalPanel';",
      "import EvalPanel from './EvalPanel';\nimport { ErrorBoundary } from '../../scratch/ErrorBoundary';"
    );
    content = content.replace(
      /<EvalPanel/g,
      '<ErrorBoundary><EvalPanel'
    );
    content = content.replace(
      /<\/EvalPanel>/g,
      '</EvalPanel></ErrorBoundary>'
    );
    // For self-closing tags
    content = content.replace(
      /(<EvalPanel[^>]*\/>)/g,
      '<ErrorBoundary>$1</ErrorBoundary>'
    );
    fs.writeFileSync(file, content);
  }
}

addBoundary('components/quality/ReviewedChatsTable.tsx');
addBoundary('components/quality/DisputesTable.tsx');
