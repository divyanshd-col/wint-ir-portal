/**
 * Wint IR Portal — Quality Alert Sheet
 *
 * Paste this into Extensions → Apps Script inside your Google Sheet.
 * Then deploy as a Web App:
 *   Deploy → New deployment → Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Copy the deployment URL and paste it into Settings → Integrations →
 * Quality Alert Sheet in the portal.
 *
 * The script appends one row per failing chat. Columns:
 *   Date | Chat ID | Agent | Phone | IQS | CSAT | Disposition | Sub-Disposition | Failed Parameters | Reasoning
 */

const SHEET_NAME = 'Quality Alerts'; // change if your tab is named differently

const HEADERS = [
  'Date', 'Chat ID', 'Agent', 'Phone', 'IQS', 'CSAT',
  'Disposition', 'Sub-Disposition', 'Failed Parameters', 'Reasoning',
];

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    let sheet   = ss.getSheetByName(SHEET_NAME);

    // Create the tab if it doesn't exist yet
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
    }

    // Write header row on first use
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length)
           .setFontWeight('bold')
           .setBackground('#f0f0f0');
      sheet.setFrozenRows(1);
    }

    sheet.appendRow([
      data.date           || new Date().toISOString().slice(0, 19).replace('T', ' '),
      data.chatId         || '',
      data.agentName      || '',
      data.contactPhone   || '',
      data.iqs            || '',
      data.csat           || '',
      data.disposition    || '',
      data.subDisposition || '',
      data.failedParams   || '',
      data.reasoning      || '',
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Optional: test it manually in the Apps Script editor
function testPost() {
  const mockEvent = {
    postData: {
      contents: JSON.stringify({
        date:           '2026-04-24 12:00:00',
        chatId:         'TEST-001',
        agentName:      'Test Agent',
        contactPhone:   '9876543210',
        iqs:            '55%',
        csat:           'Bad',
        disposition:    'Repayment',
        subDisposition: 'Delay',
        failedParams:   'Technically / Legally Incorrect',
        reasoning:      'Technically / Legally Incorrect: Agent gave wrong maturity date.',
      }),
    },
  };
  const result = doPost(mockEvent);
  Logger.log(result.getContent());
}
