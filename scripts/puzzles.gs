For Google Sheets.

```js
function importPuzzle() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("data");
  const url = 'https://raw.githubusercontent.com/boringparty/countdown/main/puzzle_big.csv?cacheBust=' + Date.now();

  const response = UrlFetchApp.fetch(url);
  const csvData = Utilities.parseCsv(response.getContentText());

  sheet.clearContents();

  sheet
    .getRange(1, 1, csvData.length, csvData[0].length)
    .setValues(csvData);
}
```
