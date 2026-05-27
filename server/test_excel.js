const xlsx = require('xlsx');
const fs = require('fs');

const excelPath = "C:\\Users\\ROG\\Desktop\\快递专用.xlsx";

try {
    const workbook = xlsx.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // 转换成二维数组: header: 1
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    
    fs.writeFileSync('output.json', JSON.stringify({
        total: data.length,
        header: data[0],
        rows: data.slice(1, 10) // first 9 rows
    }, null, 2));
    console.log("Wrote to output.json");
} catch (error) {
    console.error("Error reading file:", error.message);
}
