// script.js – Business Data AI Explorer MVP
// ------------------------------------------------------------
// This script ties together:
//   • Client‑side CSV / Excel / text file upload
//   • Sending the user query + dataset/file contents to the Gemini backend
//   • Rendering the AI‑generated explanation, chart (Chart.js) and table
//   • Exporting PNG, CSV and PDF reports
// ------------------------------------------------------------

// ==================== Global State ====================
let dataset = []; // array of objects for tabular data
let columnNames = [];
let uploadedFileName = '';
let fileRawContent = '';
let chartInstance = null;

// ==================== UI Helpers ====================
function show(sectionId) {
  const el = document.getElementById(sectionId);
  if (el) el.classList.remove('hidden');
}

function hide(sectionId) {
  const el = document.getElementById(sectionId);
  if (el) el.classList.add('hidden');
}

function setStatus(id, msg, isError = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#ff6b6b' : '#a0a0ff';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==================== File Upload ====================
document.getElementById('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  uploadedFileName = file.name;
  const ext = file.name.split('.').pop().toLowerCase();

  // 1. CSV Files
  if (ext === 'csv') {
    setStatus('upload-status', '⏳ Parsing CSV...');
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: function (results) {
        dataset = (results.data || []).filter(row => Object.values(row).some(v => v !== null && v !== ''));
        columnNames = results.meta.fields || (dataset.length > 0 ? Object.keys(dataset[0]) : []);
        
        // Also read raw text snippet
        const reader = new FileReader();
        reader.onload = (ev) => { fileRawContent = ev.target.result || ''; };
        reader.readAsText(file);

        setStatus('upload-status', `✅ Loaded "${file.name}" (${dataset.length} rows, ${columnNames.length} columns).`);
        show('query-section');
      },
      error: function (err) {
        setStatus('upload-status', `❌ Failed to parse CSV: ${err.message}`, true);
      },
    });
  } 
  // 2. Excel Files (.xlsx, .xls)
  else if (ext === 'xlsx' || ext === 'xls') {
    if (typeof XLSX === 'undefined') {
      setStatus('upload-status', '❌ Excel parser library is loading. Please try again.', true);
      return;
    }
    setStatus('upload-status', '⏳ Parsing Excel spreadsheet...');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        dataset = json;
        columnNames = json.length > 0 ? Object.keys(json[0]) : [];
        fileRawContent = XLSX.utils.sheet_to_csv(worksheet);

        setStatus('upload-status', `✅ Loaded Excel sheet "${sheetName}" (${dataset.length} rows, ${columnNames.length} columns).`);
        show('query-section');
      } catch (err) {
        setStatus('upload-status', `❌ Failed to read Excel file: ${err.message}`, true);
      }
    };
    reader.readAsArrayBuffer(file);
  }
  // 3. Plain Text / Markdown / JSON / Documents
  else if (['txt', 'json', 'md', 'log'].includes(ext)) {
    setStatus('upload-status', '⏳ Reading document...');
    const reader = new FileReader();
    reader.onload = (ev) => {
      fileRawContent = ev.target.result || '';
      dataset = [];
      columnNames = [];

      // If JSON and structured as an array of records
      if (ext === 'json') {
        try {
          const parsed = JSON.parse(fileRawContent);
          if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
            dataset = parsed;
            columnNames = Object.keys(parsed[0]);
          }
        } catch (_) {}
      }

      const rowMsg = dataset.length > 0 ? ` (${dataset.length} records)` : '';
      setStatus('upload-status', `✅ Loaded "${file.name}"${rowMsg} (${(file.size / 1024).toFixed(1)} KB).`);
      show('query-section');
    };
    reader.readAsText(file);
  } else {
    // Attempt reading as text by default
    const reader = new FileReader();
    reader.onload = (ev) => {
      fileRawContent = ev.target.result || '';
      dataset = [];
      columnNames = [];
      setStatus('upload-status', `✅ Loaded "${file.name}" (${(file.size / 1024).toFixed(1)} KB).`);
      show('query-section');
    };
    reader.readAsText(file);
  }
});

// ==================== Prompt Constructor ====================
function buildAIPrompt(userQuery) {
  // If tabular dataset exists
  if (dataset && dataset.length > 0) {
    const previewCount = Math.min(dataset.length, 30);
    const sampleRows = dataset.slice(0, previewCount);

    return `You are an expert AI data analyst and business intelligence assistant.
The user uploaded a dataset file named "${uploadedFileName}".
Total rows: ${dataset.length}
Columns: ${JSON.stringify(columnNames)}

Here is a sample of the data (first ${previewCount} rows):
\`\`\`json
${JSON.stringify(sampleRows, null, 2)}
\`\`\`

User Request / Question:
"${userQuery}"

Instructions:
1. Provide a detailed, clear explanation and analysis in markdown format.
2. If the user's question can be effectively visualized with a chart (e.g. comparison, distribution, trend, totals), provide a Chart.js configuration.
3. If a summary table is useful, provide structured table headers and rows.
4. Output your answer as a JSON object with the following structure:
{
  "explanation": "Markdown formatted explanation and key findings...",
  "chart": {
    "type": "bar", // or "line", "pie", "doughnut"
    "labels": ["Category A", "Category B"],
    "datasets": [{ "label": "Sales", "data": [100, 200] }]
  },
  "table": {
    "headers": ["Column 1", "Column 2"],
    "rows": [["Value 1", "Value 2"]]
  }
}
If a chart or table is not relevant, set "chart": null and/or "table": null.
Output ONLY the JSON object (you may wrap it in \`\`\`json ... \`\`\`).`;
  }

  // If text file / document
  if (fileRawContent) {
    const textSnippet = fileRawContent.slice(0, 40000);
    return `You are an expert AI assistant.
The user uploaded a document named "${uploadedFileName}".
Here is the file content:
---
${textSnippet}
---

User Prompt / Question:
"${userQuery}"

Instructions:
Please provide a comprehensive, accurate analysis or summary directly addressing the user's prompt based on the file content.
Output your answer in clean markdown format.`;
  }

  // No file uploaded
  return userQuery;
}

// ==================== AI Interaction ====================
async function askAI(query) {
  setStatus('query-status', '🤖 Analyzing with Gemini…');

  const fullPrompt = buildAIPrompt(query);

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: fullPrompt }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      setStatus('query-status', `❌ Backend error ${response.status}: ${errData.error || response.statusText}`, true);
      return null;
    }

    const data = await response.json();
    if (data.error) {
      setStatus('query-status', `❌ ${data.error}`, true);
      return null;
    }

    const rawText = (data.response || '').trim();

    // Attempt to parse structured JSON from the model response
    let parsedResult = null;
    try {
      let jsonString = rawText;
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonString = jsonMatch[1].trim();
      }
      const parsed = JSON.parse(jsonString);
      if (parsed && typeof parsed === 'object') {
        parsedResult = parsed;
      }
    } catch (_) {
      // Response was not JSON, fallback to standard markdown text
    }

    if (parsedResult) {
      return {
        explanation: parsedResult.explanation || rawText,
        chart: parsedResult.chart || null,
        table: parsedResult.table || null,
      };
    }

    return {
      explanation: rawText,
      chart: null,
      table: null,
    };
  } catch (err) {
    setStatus('query-status', `❌ Network error: ${err.message}`, true);
    return null;
  }
}

// ==================== Query Execution ====================
document.getElementById('ask-btn').addEventListener('click', async () => {
  const query = document.getElementById('nl-query').value.trim();
  if (!query) {
    setStatus('query-status', 'Please enter a question.', true);
    return;
  }

  const aiResult = await askAI(query);
  if (!aiResult) return;

  // ------- Explanation -------
  const explanationEl = document.getElementById('explanation');
  if (typeof marked !== 'undefined' && marked.parse) {
    explanationEl.innerHTML = marked.parse(aiResult.explanation || '');
  } else {
    explanationEl.innerHTML = `<p>${escapeHtml(aiResult.explanation || '')}</p>`;
  }

  // ------- Chart -------
  if (aiResult.chart && aiResult.chart.labels && aiResult.chart.datasets) {
    const ctx = document.getElementById('result-chart').getContext('2d');
    if (chartInstance) chartInstance.destroy();

    // Default colorful palettes if not defined
    const defaultColors = [
      'rgba(106, 90, 205, 0.85)',
      'rgba(72, 219, 251, 0.85)',
      'rgba(255, 107, 107, 0.85)',
      'rgba(29, 209, 161, 0.85)',
      'rgba(254, 202, 87, 0.85)',
      'rgba(255, 159, 243, 0.85)',
      'rgba(84, 160, 255, 0.85)'
    ];

    aiResult.chart.datasets.forEach((ds, idx) => {
      if (!ds.backgroundColor) {
        ds.backgroundColor = aiResult.chart.type === 'pie' || aiResult.chart.type === 'doughnut'
          ? defaultColors
          : defaultColors[idx % defaultColors.length];
      }
      if (!ds.borderColor && aiResult.chart.type === 'line') {
        ds.borderColor = '#48dbfb';
        ds.borderWidth = 2;
      }
    });

    const chartOptions = {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#f0f0f0' } },
      },
      scales: (aiResult.chart.type === 'pie' || aiResult.chart.type === 'doughnut') ? {} : {
        x: { ticks: { color: '#e0e0ff' }, grid: { color: 'rgba(255,255,255,0.1)' } },
        y: { ticks: { color: '#e0e0ff' }, grid: { color: 'rgba(255,255,255,0.1)' } },
      },
      ...(aiResult.chart.options || {}),
    };

    chartInstance = new Chart(ctx, {
      type: aiResult.chart.type || 'bar',
      data: {
        labels: aiResult.chart.labels,
        datasets: aiResult.chart.datasets,
      },
      options: chartOptions,
    });
    show('chart-container');
  } else {
    hide('chart-container');
  }

  // ------- Table -------
  if (aiResult.table && aiResult.table.headers && aiResult.table.rows && aiResult.table.rows.length > 0) {
    const tbl = document.getElementById('result-table');
    tbl.innerHTML = '';
    
    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    aiResult.table.headers.forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    tbl.appendChild(thead);

    const tbody = document.createElement('tbody');
    aiResult.table.rows.forEach((row) => {
      const tr = document.createElement('tr');
      const cells = Array.isArray(row) ? row : Object.values(row);
      cells.forEach((cell) => {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    show('table-container');
  } else {
    hide('table-container');
  }

  // Show result section and update status
  show('result-section');
  setStatus('query-status', '✅ Done');
});

// ==================== Export Functions ====================
// Export PNG from Chart.js canvas
document.getElementById('export-png').addEventListener('click', () => {
  if (!chartInstance) return;
  const link = document.createElement('a');
  link.download = 'chart.png';
  link.href = chartInstance.toBase64Image();
  link.click();
});

// Export CSV of the table data
document.getElementById('export-csv').addEventListener('click', () => {
  const table = document.getElementById('result-table');
  if (!table) return;
  const rows = [];
  const headers = [];
  table.querySelectorAll('thead th').forEach((th) => headers.push('"' + th.textContent.replace(/"/g, '""') + '"'));
  if (headers.length > 0) rows.push(headers.join(','));

  table.querySelectorAll('tbody tr').forEach((tr) => {
    const cells = [];
    tr.querySelectorAll('td').forEach((td) => cells.push('"' + td.textContent.replace(/"/g, '""') + '"'));
    rows.push(cells.join(','));
  });

  const csvContent = rows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'result.csv');
  link.click();
  URL.revokeObjectURL(url);
});

// Export PDF report
document.getElementById('export-pdf').addEventListener('click', async () => {
  if (!window.jspdf) {
    alert('PDF export library is still loading. Please try again.');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  let y = 40;

  // Title
  doc.setFontSize(20);
  doc.text('Business Data AI Report', 40, y);
  y += 30;

  // Explanation
  doc.setFontSize(11);
  const explanation = document.getElementById('explanation').innerText || '';
  const lines = doc.splitTextToSize(explanation, 520);
  doc.text(lines, 40, y);
  y += lines.length * 14 + 20;

  // Chart image
  if (chartInstance && !document.getElementById('chart-container').classList.contains('hidden')) {
    if (y + 260 > 800) {
      doc.addPage();
      y = 40;
    }
    const imgData = chartInstance.toBase64Image();
    doc.addImage(imgData, 'PNG', 40, y, 520, 260);
    y += 280;
  }

  // Table
  const table = document.getElementById('result-table');
  if (table && !document.getElementById('table-container').classList.contains('hidden')) {
    if (y + 100 > 800) {
      doc.addPage();
      y = 40;
    }
    const headers = [];
    table.querySelectorAll('thead th').forEach((th) => headers.push(th.textContent));
    const rows = [];
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const row = [];
      tr.querySelectorAll('td').forEach((td) => row.push(td.textContent));
      rows.push(row);
    });

    doc.setFontSize(14);
    doc.text('Data Table:', 40, y);
    y += 20;
    doc.setFontSize(10);
    rows.slice(0, 30).forEach((row) => {
      if (y > 780) {
        doc.addPage();
        y = 40;
      }
      doc.text(row.join('  |  '), 40, y);
      y += 14;
    });
  }

  doc.save('business-data-ai-report.pdf');
});
