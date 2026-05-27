const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const excelPath = path.join(__dirname, 'data', '快递专用.xlsx');
if (!fs.existsSync(excelPath)) {
    console.log("Excel not found");
    process.exit(1);
}

const workbook = xlsx.readFile(excelPath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

console.log("Total rows:", data.length);

for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const colId = row[1] ? String(row[1]).trim() : '';
    const colStatus = row[5] ? String(row[5]).trim() : '';
    if (colId === 'FE28' || i < 10) {
        console.log(`Row ${i} [ID: ${colId}] Status: "${colStatus}"`);
    }
}
