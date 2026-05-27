const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(express.json());

// 安全保护全局密码
const AUTH_PASS = '818304';
const AUTH_TOKEN = 'secure-admin-token-818304';

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}
const excelPath = path.join(dataDir, '快递专用.xlsx');

const upload = multer({ storage: multer.memoryStorage() });

// 登录接口（无需鉴权即可访问）
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === AUTH_PASS) {
        res.json({ success: true, token: AUTH_TOKEN });
    } else {
        res.status(401).json({ success: false, message: '密码错误' });
    }
});

// 鉴权拦截器中间件
const requireAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;
    if (token === AUTH_TOKEN) {
        next();
    } else {
        res.status(401).json({ error: '非法访问，请先验证密码！', code: 'UNAUTHORIZED' });
    }
};

app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '请选择要上传的文件' });
        }

        const keepStatus = req.query.keepStatus !== 'false';

        // 1. 读取新上传的文件到内存中
        const newWorkbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const newSheetName = newWorkbook.SheetNames[0];
        const newSheet = newWorkbook.Sheets[newSheetName];
        
        const newData = xlsx.utils.sheet_to_json(newSheet, { header: 1 });

        // 2. 如果选择保留状态且已存在旧文件，读取旧文件中的所有订单状态并保存
        const existingStatuses = new Map(); // colId -> statusString
        if (keepStatus && fs.existsSync(excelPath)) {
            const oldWorkbook = xlsx.readFile(excelPath);
            const oldSheet = oldWorkbook.Sheets[oldWorkbook.SheetNames[0]];
            const oldData = xlsx.utils.sheet_to_json(oldSheet, { header: 1 });
            
            for (let i = 1; i < oldData.length; i++) {
                const row = oldData[i];
                if (!row || row.length === 0) continue;
                const colId = row[1] ? String(row[1]).trim() : '';
                const colStatus = row[5] ? String(row[5]).trim() : '';
                if (colId && colStatus) {
                    existingStatuses.set(colId, colStatus);
                }
            }
        }

        // 3. 将之前保存的状态回填到新表格的对应行（Column F，c: 5）
        if (keepStatus && existingStatuses.size > 0) {
            for (let i = 1; i < newData.length; i++) {
                const row = newData[i];
                if (!row || row.length === 0) continue;
                const colId = row[1] ? String(row[1]).trim() : '';
                
                if (colId && existingStatuses.has(colId)) {
                    const savedStatus = existingStatuses.get(colId);
                    const cellRef = xlsx.utils.encode_cell({ c: 5, r: i });
                    if (!newSheet[cellRef]) {
                        newSheet[cellRef] = { t: 's', v: savedStatus };
                    } else {
                        newSheet[cellRef].v = savedStatus;
                    }
                }
            }
        }

        // 4. 将新表格写入磁盘，覆盖原有文件
        xlsx.writeFile(newWorkbook, excelPath);
        res.json({ success: true, message: keepStatus ? '文件上传并成功合并原有打包状态' : '新一轮发货表格上传成功，所有状态已重置' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '上传文件失败: ' + err.message });
    }
});

app.get('/api/download', requireAuth, (req, res) => {
    if (!fs.existsSync(excelPath)) {
        return res.status(404).send('没有找到可供下载的文件，请先上传原始表格。');
    }
    const filename = encodeURIComponent('最新状态_快递专用.xlsx');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.download(excelPath, '最新状态_快递专用.xlsx');
});

// 获取所有订单并解析
app.get('/api/orders', (req, res) => {
    try {
        if (!fs.existsSync(excelPath)) {
            return res.status(404).json({ error: "Excel file not found", code: "NO_FILE" });
        }
        const workbook = xlsx.readFile(excelPath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        
        const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        let ordersMap = new Map();
        
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (!row || row.length === 0) continue;
            
            const colAccount = row[0] ? String(row[0]).trim() : '';
            const colId = row[1] ? String(row[1]).trim() : '';
            const colPickupCode = row[3] ? String(row[3]).trim() : '';
            const colItemsStr = row[4] ? String(row[4]).trim() : '';
            let colStatus = row[5] ? String(row[5]).trim() : '';
            const colAddress = row[7] ? String(row[7]).trim() : '';
            if (colId) {
                let itemsList = [];
                if (colItemsStr) {
                    itemsList = colItemsStr.split(/[,，\n]/).map(s => s.trim()).filter(s => s);
                }

                const [statusCore, meta1, meta2] = colStatus.split('|');
                let boxCount = 1;
                let packedIndices = [];

                // 解析逻辑：如果 meta1 是数字，则是包裹数
                if (meta1 && !isNaN(parseInt(meta1)) && meta1.indexOf(',') === -1) {
                    boxCount = parseInt(meta1);
                    // 如果核心状态是“待合包”，meta2 对应的是索引项
                    if (statusCore === '待合包') {
                        packedIndices = meta2 ? meta2.split(',').map(n => parseInt(n)).filter(n => !isNaN(n)) : [];
                    }
                } else if (meta1) {
                    // 兼容旧格式：待合包|0,1,2
                    packedIndices = meta1.split(',').map(n => parseInt(n)).filter(n => !isNaN(n));
                }

                if (ordersMap.has(colId)) {
                    const existingOrder = ordersMap.get(colId);
                    if (itemsList.length > 0) existingOrder.items.push(...itemsList);
                    if (colAccount && !existingOrder.accounts.includes(colAccount)) {
                        existingOrder.accounts.push(colAccount);
                    }
                    if (colAddress) existingOrder.address = colAddress;
                    if (colPickupCode) existingOrder.pickupCode = colPickupCode;
                    if (statusCore && (!existingOrder.status || existingOrder.status === '未打包')) {
                        existingOrder.status = statusCore;
                        existingOrder.packedIndices = packedIndices;
                        existingOrder.boxCount = boxCount;
                    }
                } else {
                    ordersMap.set(colId, {
                        accounts: colAccount ? [colAccount] : [],
                        id: colId,
                        status: statusCore || '未打包',
                        packedIndices: packedIndices,
                        boxCount: boxCount,
                        items: itemsList,
                        address: colAddress,
                        pickupCode: colPickupCode
                    });
                }
            }
        }
        
        let orders = Array.from(ordersMap.values());
        res.json(orders);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// 更新发货状态
app.post('/api/orders/:id/status', (req, res) => {
    const { id } = req.params;
    const { status, packedIndices, boxCount } = req.body;
    
    // 强制元数据格式：Status|BoxCount[|Indices]
    let finalStatus = status;
    if (status === '已打包' || status === '待合包') {
        if (packedIndices && packedIndices.length > 0) {
            finalStatus = `${status}|${boxCount || 1}|${packedIndices.join(',')}`;
        } else {
            finalStatus = `${status}|${boxCount || 1}`;
        }
    } else if (status === '已发货') {
        finalStatus = '已发货';
    }

    console.log(`[Status Update] ID: ${id}, New Status String: "${finalStatus}"`);
    
    try {
        if (!fs.existsSync(excelPath)) {
            return res.status(404).json({ error: "Excel file not found", code: "NO_FILE" });
        }
        const workbook = xlsx.readFile(excelPath);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        
        let foundCount = 0;
        for (let i = 1; i < data.length; i++) {
             const row = data[i];
             if (row && String(row[1]).trim() === String(id).trim()) {
                 foundCount++;
                 const cellRef = xlsx.utils.encode_cell({ c: 5, r: i });
                 if (!sheet[cellRef]) {
                     sheet[cellRef] = { t: 's', v: finalStatus };
                 } else {
                     sheet[cellRef].v = finalStatus;
                 }
             }
        }
        
        if (foundCount > 0) {
            xlsx.writeFile(workbook, excelPath);
            console.log(`[Status Update] Successfully updated ${foundCount} rows for ID: ${id}`);
            res.json({ success: true, status: status, packedIndices: packedIndices || [], boxCount: boxCount || 1 });
        } else {
            res.status(404).json({ error: 'Order not found' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.use(express.static(path.join(__dirname, '../dist')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
