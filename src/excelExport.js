import { enterpriseMonthlySummary } from "./model.js";

const esc = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const T = (value, style = 0) => ({ value: value ?? "", style });
const N = (value, style = 4) => ({ value: Number.isFinite(Number(value)) ? Number(value) : 0, style, numeric: true });
const date = value => value ? String(value).slice(0, 10) : "";
const total = (rows, fn) => rows.reduce((n, row) => n + Number(fn(row) || 0), 0);
const inMonth = (value, month) => String(value || "").startsWith(month);
const colName = n => { let out = ""; while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); } return out; };
const encoder = new TextEncoder();
const u16 = n => { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, n, true); return a; };
const u32 = n => { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n >>> 0, true); return a; };
const join = parts => { const a = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let off = 0; parts.forEach(p => { a.set(p, off); off += p.length; }); return a; };
const crc32 = bytes => { let crc = 0xffffffff; for (let i = 0; i < bytes.length; i++) { crc ^= bytes[i]; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
function zipStore(files) {
  const local = [], central = []; let offset = 0; const dosDate = 33;
  Object.entries(files).forEach(([path, body]) => {
    const name = encoder.encode(path), data = encoder.encode(body), crc = crc32(data);
    const header = join([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(dosDate), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name]);
    local.push(header, data);
    central.push(join([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(dosDate), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += header.length + data.length;
  });
  const localBytes = join(local), centralBytes = join(central);
  const end = join([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(centralBytes.length), u32(localBytes.length), u16(0)]);
  return new Blob([localBytes, centralBytes, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
function stylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;E &quot;#,##0.00;[Red](&quot;E &quot;#,##0.00)"/></numFmts>' +
  '<fonts count="3"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts>' +
  '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF163A35"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF23766B"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD7E2DF"/></left><right style="thin"><color rgb="FFD7E2DF"/></right><top style="thin"><color rgb="FFD7E2DF"/></top><bottom style="thin"><color rgb="FFD7E2DF"/></bottom><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}
function worksheetXml(config) {
  const rows = config.rows || [], maxCols = Math.max(1, ...rows.map(r => r.cells.length));
  const widths = (config.widths || Array(maxCols).fill(18)).map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + Math.min(42, Math.max(10, w)) + '" customWidth="1"/>').join("");
  const rowXml = rows.map((r, ri) => {
    const rowNum = ri + 1;
    const cells = r.cells.map((c, ci) => {
      if (c == null || c.value === "") return "";
      const ref = colName(ci + 1) + rowNum, style = c.style || 0;
      if (c.numeric) return '<c r="' + ref + '" s="' + style + '" t="n"><v>' + Number(c.value) + '</v></c>';
      const v = String(c.value);
      return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t' + ((/^\s|\s$/.test(v) || v.includes("\n")) ? ' xml:space="preserve"' : "") + '>' + esc(v) + '</t></is></c>';
    }).join("");
    return '<row r="' + rowNum + '"' + (r.height ? ' ht="' + r.height + '" customHeight="1"' : "") + '>' + cells + '</row>';
  }).join("");
  const pane = config.freezeRows ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + config.freezeRows + '" topLeftCell="A' + (config.freezeRows + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : "";
  const merges = (config.merges || []).map(r => '<mergeCell ref="' + r + '"/>').join("");
  const mergeXml = merges ? '<mergeCells count="' + config.merges.length + '">' + merges + '</mergeCells>' : "";
  const filter = config.filter && rows.length > (config.headerRow || 0) ? '<autoFilter ref="A' + config.headerRow + ':' + colName(maxCols) + rows.length + '"/>' : "";
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:' + colName(maxCols) + Math.max(1, rows.length) + '"/>' + pane + '<sheetFormatPr defaultRowHeight="18"/><cols>' + widths + '</cols><sheetData>' + rowXml + '</sheetData>' + filter + mergeXml + '<pageMargins left="0.3" right="0.3" top="0.6" bottom="0.6" header="0.3" footer="0.3"/></worksheet>';
}
function makeWorkbook(sheets) {
  const files = {};
  files["[Content_Types].xml"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("") + '</Types>';
  files["_rels/.rels"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  files["xl/workbook.xml"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join("") + '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>';
  files["xl/_rels/workbook.xml.rels"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join("") + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  files["xl/styles.xml"] = stylesXml();
  sheets.forEach((s, i) => { files["xl/worksheets/sheet" + (i + 1) + ".xml"] = worksheetXml(s); });
  return zipStore(files);
}
function reportSheet(name, subtitle, month, headers, rows, widths) {
  const count = headers.length;
  return { name, widths, freezeRows: 4, filter: true, headerRow: 4, merges: ["A1:" + colName(count) + "1", "A2:" + colName(count) + "2"], rows: [
    { cells: [T(name, 1), ...Array(count - 1).fill(null)], height: 30 },
    { cells: [T(subtitle, 2), ...Array(count - 1).fill(null)], height: 23 },
    { cells: [T("Report month: " + month), ...Array(count - 1).fill(null)] },
    { cells: headers.map(h => T(h, 3)), height: 32 },
    ...rows.map(cells => ({ cells }))
  ] };
}

export function downloadMonthlyExcelReport({
  month, events = [], journal = [], batches = [], mortality = [], moves = [], expenses = [], sales = [],
  customers = [], invoices = [], loans = [], products = [], stockBatches = [], loanSummary = {}
}) {
  const reportMonth = month || new Date().toISOString().slice(0, 7);
  const selectedEvents = events.filter(e => inMonth(e.business_date, reportMonth));
  const chickenSales = sales.filter(s => inMonth(s.sale_date, reportMonth));
  const chickenExpenses = expenses.filter(e => inMonth(e.expense_date, reportMonth));
  const monthDeaths = mortality.filter(e => inMonth(e.death_date, reportMonth));
  const summary = enterpriseMonthlySummary({ month: reportMonth, events, journal, sales, batches, expenses });
  const customerName = id => customers.find(c => c.id === id)?.name || "";
  const batchName = id => batches.find(b => b.id === id)?.batch_name || "";
  const salesRows = [];
  selectedEvents.filter(e => ["sale", "income"].includes(e.kind)).forEach(e => {
    const p = e.payload || {}, gross = Number(e.amount || 0), paid = Math.min(gross, Math.max(0, Number(p.paid ?? gross)));
    salesRows.push([T(e.business_date), T(e.division || "Business"), T(e.kind === "income" ? "Business income" : "Sale"), T(p.customer_name || customerName(p.customer_id) || "Walk-in"), N(p.quantity || (e.kind === "sale" ? 1 : 0), 5), T(e.description || ""), N(gross), N(paid), N(Math.max(0, gross - paid)), T(gross - paid <= 0 ? "Paid cash" : "Credit")]);
  });
  chickenSales.forEach(s => {
    const gross = Number(s.total || 0), paid = Number(s.paid || 0);
    salesRows.push([T(s.sale_date), T("Poultry / Chickens"), T("Dressed chicken sale"), T(customerName(s.customer_id) || (paid < gross ? "Customer not found" : "Walk-in")), N(s.quantity, 5), T(batchName(s.batch_id) || "Chicken batch"), N(gross), N(paid), N(Math.max(0, gross - paid)), T(paid >= gross ? "Paid cash" : "Credit")]);
  });
  salesRows.sort((a, b) => String(a[0].value).localeCompare(String(b[0].value)));
  const expenseRows = selectedEvents.filter(e => e.kind === "expense").map(e => [T(e.business_date), T(e.division || "Business"), T("General expense"), T(e.description || ""), T(""), N(e.amount)]);
  chickenExpenses.forEach(e => expenseRows.push([T(e.expense_date), T("Poultry / Chickens"), T(e.category || "Chicken expense"), T(e.description || ""), T(batchName(e.batch_id) || "Whole poultry enterprise"), N(e.amount)]));
  expenseRows.sort((a, b) => String(a[0].value).localeCompare(String(b[0].value)));
  const openInvoices = invoices.filter(i => Number(i.paid || 0) < Number(i.total || 0));
  const invoiceRows = openInvoices.map(i => {
    const e = events.find(x => x.id === i.id);
    return [T(e?.business_date || ""), T(customerName(i.customer_id) || "Customer"), T(i.id || ""), N(i.total), N(i.paid), N(Math.max(0, Number(i.total || 0) - Number(i.paid || 0))), T(e?.description || "Sale"), T("Open balance as of export")];
  });
  const poultryRows = batches.filter(b => inMonth(b.received_on, reportMonth)).map(b => {
    const dead = total(mortality.filter(x => x.batch_id === b.id), x => x.quantity);
    const batchMoves = moves.filter(x => x.batch_id === b.id);
    const dressed = total(batchMoves.filter(x => x.move_type === "dressed"), x => x.quantity);
    const soldDressed = total(sales.filter(x => x.batch_id === b.id && x.sale_type === "dressed"), x => x.quantity);
    const live = Number(b.initial_quantity || 0) - dead - dressed, dressedLeft = dressed - soldDressed;
    const cost = Number(b.initial_quantity || 0) * Number(b.unit_cost || 0) + total(expenses.filter(x => x.batch_id === b.id), x => x.amount);
    const revenue = total(sales.filter(x => x.batch_id === b.id), x => x.total), paid = total(sales.filter(x => x.batch_id === b.id), x => x.paid);
    return [T(b.batch_name), T(b.received_on), N(b.initial_quantity, 5), N(dead, 5), N(live, 5), N(dressedLeft, 5), N(cost), N(revenue), N(paid), N(Math.max(0, revenue - paid)), N(revenue - cost)];
  });
  const loanRows = loans.map(l => [T(customerName(l.customer_id) || "Customer"), T(l.status || ""), T(l.due_on || ""), N(l.principal), N(l.interest), N(Number(l.principal || 0) + Number(l.interest || 0)), T(l.id || "")]);
  const loanActivityRows = selectedEvents.filter(e => String(e.division || "").toLowerCase() === "loans").map(e => [T(e.business_date), T(e.kind), T(e.payload?.customer_name || customerName(e.payload?.customer_id) || ""), T(e.description || ""), N(e.amount), T(e.id || "")]);
  const liveTotal = total(batches, b => Number(b.initial_quantity || 0) - total(mortality.filter(m => m.batch_id === b.id), m => m.quantity) - total(moves.filter(m => m.batch_id === b.id && m.move_type === "dressed"), m => m.quantity));
  const dressedTotal = total(batches, b => total(moves.filter(m => m.batch_id === b.id && m.move_type === "dressed"), m => m.quantity) - total(sales.filter(x => x.batch_id === b.id && x.sale_type === "dressed"), x => x.quantity));
  const stockRows = [[T("Poultry / Chickens"), T("Live / undressed chickens"), N(liveTotal, 5), T("Current total across batches")], [T("Poultry / Chickens"), T("Dressed chickens"), N(dressedTotal, 5), T("Current total across batches")]];
  products.forEach(p => stockBatches.filter(b => b.product_id === p.id).forEach(b => stockRows.push([T(p.division || "Pigs"), T(p.name + " — " + String(b.received_on || "").slice(0, 10) + (b.sex ? " — " + b.sex : "")), N(b.remaining, 5), T("Remaining cost: E " + Number(b.remaining_cost || 0).toFixed(2))])));
  const transactionRows = selectedEvents.map(e => [T(e.business_date), T(e.division || "Business"), T(e.kind || ""), T(e.description || ""), T(e.payload?.customer_name || customerName(e.payload?.customer_id) || ""), N(e.amount), T(e.id || "")]);
  const outstanding = total(openInvoices, i => Math.max(0, Number(i.total || 0) - Number(i.paid || 0)));
  const pigSalesTotal = total(salesRows.filter(r => String(r[1].value).toLowerCase().includes("pig") && String(r[2].value) === "Sale"), r => r[6].value);
  const chickenSalesTotal = total(chickenSales, s => s.total);
  const salesCash = total(salesRows.filter(r => r[9].value === "Paid cash"), r => r[6].value);
  const salesCredit = total(salesRows.filter(r => r[9].value === "Credit"), r => r[8].value);
  const summaryRows = [
    { cells: [T("SAKHELWE BUSINESS CONTROL", 1)], height: 34 },
    { cells: [T("MONTH-END EXCEL REPORT", 2)], height: 24 },
    { cells: [T("Report month"), T(reportMonth)] },
    { cells: [T("Generated in Eswatini time"), T(new Date().toLocaleString("en-GB", { timeZone: "Africa/Mbabane" }))] },
    { cells: [T("")] },
    { cells: [T("Enterprise", 3), T("Income / Sales (E)", 3), T("Expenses / Costs (E)", 3), T("Profit / (Loss) (E)", 3)] },
    ...summary.rows.map(r => ({ cells: [T(r.section === "Poultry" ? "Poultry / Chickens" : r.section === "Pigs" ? "Pigs / Pork" : r.section, 0), N(r.revenue), N(r.costs), N(r.profit)] })),
    { cells: [T("COMBINED TOTAL", 6), N(summary.totalSales, 6), N(summary.totalCosts, 6), N(summary.totalProfit, 6)], height: 24 },
    { cells: [T("")] },
    { cells: [T("Month-end checks", 3), T("Value", 3)] },
    { cells: [T("Chicken sales this month (E)"), N(chickenSalesTotal)] },
    { cells: [T("Pig sales this month (E)"), N(pigSalesTotal)] },
    { cells: [T("Cash sales recorded (E)"), N(salesCash)] },
    { cells: [T("Outstanding credit amount on sales listed (E)"), N(salesCredit)] },
    { cells: [T("Unpaid customer balances as of export (E)"), N(outstanding)] },
    { cells: [T("Unpaid customer invoices"), N(openInvoices.length, 5)] },
    { cells: [T("Chicken mortality this month"), N(total(monthDeaths, x => x.quantity), 5)] },
    { cells: [T("Active loan balances (E)"), N(total(loans.filter(l => l.status === "active"), l => Number(l.principal || 0) + Number(l.interest || 0)))] },
    { cells: [T("Available lending fund (E)"), N(loanSummary.available || 0)] },
    { cells: [T("")] },
    { cells: [T("Important note", 3)] },
    { cells: [T("Sales and expenses are filtered to the report month. Customer balances, loan balances and livestock stock show the position when this workbook was downloaded.")], height: 35 }
  ];
  const readme = [
    { cells: [T("HOW TO USE THIS REPORT", 1)], height: 32 },
    { cells: [T("Sakhelwe Business Control • Emalangeni (E)", 2)] },
    { cells: [T("Selected month"), T(reportMonth)] },
    { cells: [T("")] },
    { cells: [T("Sheet", 3), T("What it contains", 3)] },
    { cells: [T("Monthly Summary"), T("Four enterprise totals, combined totals and month-end checks.")] },
    { cells: [T("Sales"), T("Sales and business income recorded in the selected month, including cash/credit status.")] },
    { cells: [T("Expenses"), T("General expenses and poultry-specific expenses recorded in the selected month.")] },
    { cells: [T("Poultry Batches"), T("Batches received in the selected month with recorded stock, cost, revenue, payments, owing and profit/loss to date.")] },
    { cells: [T("Customer Balances"), T("Open customer invoices at download time, not a historic month-end balance snapshot.")] },
    { cells: [T("Loans"), T("Current loan accounts, balances and due dates.")] },
    { cells: [T("Loan Activity"), T("Loan enterprise transaction records dated in the selected month.")] },
    { cells: [T("Stock Snapshot"), T("Current livestock quantities at download time.")] },
    { cells: [T("Transactions"), T("General event records dated in the selected month.")] },
    { cells: [T("")] },
    { cells: [T("Month-end routine", 3)] },
    { cells: [T("1. Open Sakhelwe and go to Reports.")] },
    { cells: [T("2. Select the month that has just ended.")] },
    { cells: [T("3. Click Download Excel report and save the file using the month in its name.")] },
    { cells: [T("4. Check sales, expenses, customer balances, stock and loan records before filing.")] },
    { cells: [T("")] },
    { cells: [T("Currency"), T("All monetary amounts are in Emalangeni (E).")] }
  ];
  const sheets = [
    { name: "Monthly Summary", widths: [45, 25, 25, 25], freezeRows: 5, merges: ["A1:D1", "A2:D2", "A24:D24", "A25:D25"], rows: summaryRows },
    reportSheet("Sales", "Sales and business income for selected month", reportMonth, ["Date", "Enterprise", "Record type", "Customer", "Quantity", "Description / batch", "Total (E)", "Paid (E)", "Owing (E)", "Payment status"], salesRows, [13, 22, 23, 25, 12, 32, 16, 16, 16, 18]),
    reportSheet("Expenses", "Recorded expenses for selected month", reportMonth, ["Date", "Enterprise", "Category", "Description", "Batch / scope", "Amount (E)"], expenseRows, [13, 22, 22, 34, 30, 17]),
    reportSheet("Poultry Batches", "Batches received in selected month; cycle figures include activity to date", reportMonth, ["Batch", "Arrival date", "Started", "Deaths", "Live remaining", "Dressed remaining", "Costs to date (E)", "Sales to date (E)", "Paid (E)", "Owing (E)", "Profit / loss to date (E)"], poultryRows, [32, 14, 12, 12, 16, 18, 19, 19, 16, 16, 23]),
    reportSheet("Customer Balances", "Open invoices as of workbook download time", reportMonth, ["Sale date", "Customer", "Invoice / record ID", "Invoice total (E)", "Paid (E)", "Owing (E)", "Description", "Position"], invoiceRows, [13, 24, 38, 17, 17, 17, 28, 27]),
    reportSheet("Loans", "Current loan accounts as of download time", reportMonth, ["Customer", "Status", "Due date", "Principal (E)", "Interest (E)", "Balance (E)", "Loan ID"], loanRows, [25, 16, 14, 17, 17, 17, 38]),
    reportSheet("Loan Activity", "Loan enterprise records recorded in selected month", reportMonth, ["Date", "Record type", "Customer", "Description", "Amount (E)", "Record ID"], loanActivityRows, [13, 18, 24, 32, 17, 38]),
    reportSheet("Stock Snapshot", "Livestock quantities at time of download", reportMonth, ["Enterprise", "Stock / batch", "Quantity remaining", "Notes"], stockRows, [22, 34, 19, 38]),
    reportSheet("Transactions", "General ledger events recorded in selected month", reportMonth, ["Date", "Enterprise", "Record type", "Description", "Customer", "Amount (E)", "Record ID"], transactionRows, [13, 22, 18, 34, 24, 17, 38]),
    { name: "Read Me", widths: [27, 96], freezeRows: 4, merges: ["A1:B1", "A2:B2"], rows: readme }
  ];
  const blob = makeWorkbook(sheets);
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "Sakhelwe_Monthly_Report_" + reportMonth + ".xlsx";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
