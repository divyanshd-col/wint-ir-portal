/**
 * Wint IR Portal — Compliance Alert Sheet Apps Script
 *
 * Sheet: https://docs.google.com/spreadsheets/d/1IgPoXykhI9dSswVDGxto_hfmvhmhNaNKDmwqXggGmGY/edit?gid=0#gid=0
 * Tab: Sheet1
 *
 * How to deploy:
 * 1. In your Google Sheet, open Extensions → Apps Script.
 * 2. Replace any code with this entire script.
 * 3. Click "Deploy" → "New deployment".
 * 4. Select type: "Web app".
 * 5. Configuration:
 *      - Description: Compliance Flags Webhook
 *      - Execute as: "Me"
 *      - Who has access: "Anyone"
 * 6. Click "Deploy", authorize permissions if prompted, and copy the Web App URL.
 * 7. Set COMPLIANCE_ALERT_SHEET_URL in .env.local to the copied Web App URL.
 */

const SHEET_NAME = 'Sheet1';

const HEADERS = [
  'Date',
  'Chat ID',
  'Agent',
  'TL',
  'Phone',
  'IQS',
  'Disposition',
  'Sub-Disposition',
  'Breach Type',
  'Reason / Quote'
];

function doGet(e) {
  try {
    let data;
    if (e.parameter && e.parameter.payload) {
      data = JSON.parse(e.parameter.payload);
    } else {
      data = e.parameter || {};
    }
    return appendRow(data);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    let data;
    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else if (e.parameter && e.parameter.payload) {
      data = JSON.parse(e.parameter.payload);
    } else {
      data = e.parameter || {};
    }
    return appendRow(data);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function appendRow(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  // If first row is empty, add headers
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }

  const row = [
    data.date || new Date().toISOString().slice(0, 19).replace('T', ' '),
    data.chatId || '',
    data.agentName || '',
    data.tl || '',
    data.contactPhone || '',
    data.iqs || '',
    data.disposition || '',
    data.subDisposition || '',
    data.breachType || '',
    data.reasoning || ''
  ];

  sheet.appendRow(row);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
