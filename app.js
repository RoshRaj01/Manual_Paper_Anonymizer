// ─── CONFIG ──────────────────────────────────────────────────────────────────
const API = "http://localhost:8000";

pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

// ─── STATE ───────────────────────────────────────────────────────────────────
let files        = [];
let outputFiles  = [];
let currentIndex = -1;
let currentPdfDoc   = null;
let currentPage     = 1;
let totalPages      = 1;
let pageRotations   = [];   // rotation per page from backend (0/90/180/270)
let currentFilename = null;
let selections        = [];   // { page, bbox, label }
let ackFilename = null;
let appliedRedactions = [];   // NEW: Items that are visually "removed" but not saved

// Drag state
let isDragging = false;
let dragStart  = { x: 0, y: 0 };

// Viewport of the currently rendered page (set in renderPage)
let currentViewport = null;

// ─── DOM ─────────────────────────────────────────────────────────────────────
const canvas          = document.getElementById("pdfCanvas");
const ctx             = canvas.getContext("2d");
const textLayerDiv    = document.getElementById("textLayer");
const viewerContainer = document.getElementById("viewerContainer");
const placeholder     = document.getElementById("placeholder");
const pageControls    = document.getElementById("pageControls");
const pageInfoEl      = document.getElementById("pageInfo");
const titleEl         = document.getElementById("title");
const selectionCount  = document.getElementById("selectionCount");
const pendingList     = document.getElementById("pendingList");
const removeBtn       = document.getElementById("removeBtn");
const statusMsg       = document.getElementById("statusMsg");
const prevBtn         = document.getElementById("prevBtn");
const nextBtn         = document.getElementById("nextBtn");
const folderModal     = document.getElementById("folderModal");
const configBtn       = document.getElementById("configBtn");
const undoBtn         = document.getElementById("undoBtn");
const saveBtn         = document.getElementById("saveBtn");

// Drag box overlay
const dragBox = document.createElement("div");
dragBox.id = "dragBox";
viewerContainer.appendChild(dragBox);

// ─── FOLDER MODAL ────────────────────────────────────────────────────────────
document.getElementById("setFoldersBtn").addEventListener("click", async () => {
    const inputPath  = document.getElementById("inputFolderInput").value.trim();
    const outputPath = document.getElementById("outputFolderInput").value.trim();
    const errEl = document.getElementById("modalError");

    if (!inputPath || !outputPath) { errEl.textContent = "Both folders are required."; return; }
    errEl.textContent = "";

    try {
        const res = await fetch(
            `${API}/set-folders?input_path=${encodeURIComponent(inputPath)}&output_path=${encodeURIComponent(outputPath)}`,
            { method: "POST" }
        );
        if (!res.ok) throw new Error(await res.text());

        document.getElementById("inputFolderDisplay").textContent  = inputPath;
        document.getElementById("outputFolderDisplay").textContent = outputPath;
        folderModal.classList.add("hidden");
        await loadFiles();
    } catch (e) {
        errEl.textContent = "Error: " + e.message;
    }
});

configBtn.addEventListener("click", () => folderModal.classList.remove("hidden"));

document.getElementById('ackFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    setStatus("Uploading Ack...", "working");
    try {
        const res = await fetch(`${API}/upload-ack`, { method: "POST", body: formData });
        const data = await res.json();
        ackFilename = data.filename;
        document.getElementById('ackFileName').textContent = file.name;
        setStatus("Acknowledgement file ready", "success");
    } catch (err) {
        setStatus("Upload failed", "error");
    }
});

// ─── FILE LISTING ────────────────────────────────────────────────────────────
async function loadFiles() {
    try {
        const res  = await fetch(`${API}/files`);
        const data = await res.json();
        files       = data.input  || [];
        outputFiles = data.output || [];
        renderSidebar();
        if (files.length > 0 && currentIndex === -1) loadFile(0);
    } catch (e) {
        setStatus("Cannot reach backend. Is uvicorn running?", "error");
    }
}

function renderSidebar() {
    // 1. INPUT FILES LIST
    const ul = document.getElementById("inputFiles");
    ul.innerHTML = "";
    files.forEach((f, i) => {
        const li = document.createElement("li");
        li.title = f;
        li.textContent = f.split("/").pop();
        if (i === currentIndex) li.classList.add("active"); // Restored the active highlight
        li.onclick = () => loadFile(i); // FIXED: Use standard loadFile for inputs
        ul.appendChild(li);
    });

    // 2. OUTPUT FILES LIST
    const ul2 = document.getElementById("outputFiles");
    ul2.innerHTML = "";
    outputFiles.forEach(f => {
        const li = document.createElement("li");
        li.title = f;
        li.textContent = f.split("/").pop();
        li.style.cursor = "pointer"; // Keep the clickable styling
        li.onclick = () => loadOutputFile(f.split("/").pop()); // Use loadOutputFile for outputs
        ul2.appendChild(li);
    });

    prevBtn.disabled = currentIndex <= 0;
    nextBtn.disabled = currentIndex >= files.length - 1;
}

// ─── FILE LOADING ────────────────────────────────────────────────────────────
async function loadFile(index) {
    if (index < 0 || index >= files.length) return;
    currentIndex    = index;
    currentFilename = files[index];

    titleEl.textContent = currentFilename.split("/").pop();
    canvas.style.pointerEvents = "auto";
    clearSelections();
    setStatus("Loading…", "working");
    renderSidebar();

    try {
        const res  = await fetch(`${API}/load-pdf?filename=${encodeURIComponent(currentFilename)}`);
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const data = await res.json();

        pageRotations = data.rotations || [];   // ← per-page rotation from backend

        await openPdf(`${API}${data.pdf_url}`);
        setStatus("", "");
    } catch (e) {
        setStatus("Load failed: " + e.message, "error");
    }
}

async function loadOutputFile(filename) {
    titleEl.textContent = "[PREVIEW] " + filename;
    clearSelections();
    setStatus("Loading output preview…", "working");

    // Disable making new selections visually
    canvas.style.pointerEvents = "none";

    try {
        await openPdf(`${API}/serve-pdf/output/${encodeURIComponent(filename)}`);
        setStatus("Viewing saved file.", "success");
        currentFilename = null; // Prevent accidental overwriting
        updateSelectionUI(); // Ensure save buttons are disabled
    } catch (e) {
        setStatus("Preview failed: " + e.message, "error");
    }
}

// ─── PDF OPEN ────────────────────────────────────────────────────────────────
async function openPdf(url) {
    placeholder.style.display = "none";
    canvas.style.display      = "block";

    currentPdfDoc = await pdfjsLib.getDocument(url).promise;
    totalPages    = currentPdfDoc.numPages;
    currentPage   = 1;

    // Fill in any missing rotation values
    while (pageRotations.length < totalPages) pageRotations.push(0);

    await renderPage(currentPage);
    pageControls.style.display = totalPages > 1 ? "flex" : "none";
}

// ─── PAGE RENDERING ──────────────────────────────────────────────────────────
async function renderPage(pageNum) {
    const page     = await currentPdfDoc.getPage(pageNum);
    const rotation = pageRotations[pageNum - 1] ?? 0;

    // Use PDF.js rotation parameter so the canvas is rendered right-side-up.
    // This overrides whatever /Rotate is stored in the PDF.
    const viewport = page.getViewport({ scale: 1.5 });
    currentViewport = viewport;

    canvas.width  = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;

    pageInfoEl.textContent = `Page ${pageNum} / ${totalPages}`;

    await buildTextLayer(page, viewport);
    redrawSelections();
}

// ─── TEXT LAYER ──────────────────────────────────────────────────────────────
async function buildTextLayer(page, viewport) {
    textLayerDiv.innerHTML = "";
    textLayerDiv.style.width  = canvas.width  + "px";
    textLayerDiv.style.height = canvas.height + "px";
    textLayerDiv.style.left   = canvas.offsetLeft + "px";
    textLayerDiv.style.top    = canvas.offsetTop  + "px";

    const textContent = await page.getTextContent();
    pdfjsLib.renderTextLayer({ textContent, container: textLayerDiv, viewport, textDivs: [] });
}

// ─── COORDINATE HELPERS ──────────────────────────────────────────────────────

function clientToLocal(clientX, clientY) {
    const rect = viewerContainer.getBoundingClientRect();
    return {
        x: clientX - rect.left + viewerContainer.scrollLeft,
        y: clientY - rect.top  + viewerContainer.scrollTop,
    };
}

// NEW: Get the true offset of the canvas relative to the scrollable viewer
function getCanvasOffset() {
    const cRect = canvas.getBoundingClientRect();
    const vRect = viewerContainer.getBoundingClientRect();
    return {
        x: cRect.left - vRect.left + viewerContainer.scrollLeft,
        y: cRect.top  - vRect.top  + viewerContainer.scrollTop
    };
}

// FIXED: Remove the inaccurate `offsetLeft/Top` logic
function localToCanvas(lx, ly) {
    const offset = getCanvasOffset();
    return {
        x: lx - offset.x,
        y: ly - offset.y,
    };
}

// FIXED: Map to PyMuPDF's top-left origin by inverting the Y-axis
function canvasToPdfPoint(cx, cy) {
    // PDF.js gives standard PDF coordinates (origin at bottom-left)
    const pt = currentViewport.convertToPdfPoint(cx, cy);

    // Calculate the unrotated height of the page directly from the viewport
    const unrotatedHeight = currentViewport.viewBox[3] - currentViewport.viewBox[1];

    // Invert the Y-axis so it matches PyMuPDF's top-left origin
    return {
        x: pt[0],
        y: unrotatedHeight - pt[1]
    };
}

// ─── DRAG SELECTION ──────────────────────────────────────────────────────────
canvas.addEventListener("mousedown", e => {
    if (!currentPdfDoc) return;
    isDragging = true;
    dragStart  = clientToLocal(e.clientX, e.clientY);

    dragBox.style.cssText = `display:block; left:${dragStart.x}px; top:${dragStart.y}px; width:0; height:0`;
    e.preventDefault();
});

viewerContainer.addEventListener("mousemove", e => {
    if (!isDragging) return;
    const cur = clientToLocal(e.clientX, e.clientY);
    const x = Math.min(dragStart.x, cur.x);
    const y = Math.min(dragStart.y, cur.y);
    dragBox.style.left   = x + "px";
    dragBox.style.top    = y + "px";
    dragBox.style.width  = Math.abs(cur.x - dragStart.x) + "px";
    dragBox.style.height = Math.abs(cur.y - dragStart.y) + "px";
});

viewerContainer.addEventListener("mouseup", e => {
    if (!isDragging) return;
    isDragging = false;
    dragBox.style.display = "none";

    const dragEnd = clientToLocal(e.clientX, e.clientY);
    if (Math.abs(dragEnd.x - dragStart.x) < 5 && Math.abs(dragEnd.y - dragStart.y) < 5) return;

    // Canvas-local pixel coordinates of the selection corners
    const c0 = localToCanvas(Math.min(dragStart.x, dragEnd.x), Math.min(dragStart.y, dragEnd.y));
    const c1 = localToCanvas(Math.max(dragStart.x, dragEnd.x), Math.max(dragStart.y, dragEnd.y));

    // Convert to PDF user-space using viewport (handles rotation + scale)
    const p0 = canvasToPdfPoint(c0.x, c0.y);
    const p1 = canvasToPdfPoint(c1.x, c1.y);

    const bbox = [
        Math.min(p0.x, p1.x),
        Math.min(p0.y, p1.y),
        Math.max(p0.x, p1.x),
        Math.max(p0.y, p1.y),
    ];

    // Store canvas coords for visual display, PDF coords for backend
    addSelection(currentPage - 1, bbox, c0, c1);
});

// ─── SELECTION MANAGEMENT ────────────────────────────────────────────────────
function addSelection(pageIndex, pdfBbox, c0, c1) {
    const label = `p${pageIndex + 1} [${pdfBbox.map(v => Math.round(v)).join(", ")}]`;
    selections.push({ page: pageIndex, bbox: pdfBbox, c0, c1, label });
    updateSelectionUI();
    redrawSelections();
}

function clearSelections() {
    selections = [];
    updateSelectionUI();
    redrawSelections();
}

function removeSelection(i) {
    selections.splice(i, 1);
    updateSelectionUI();
    redrawSelections();
}

function updateSelectionUI() {
    const pendingCount = selections.length;
    const appliedCount = appliedRedactions.length;

    selectionCount.textContent = pendingCount + appliedCount;

    const applyBtn = document.getElementById("applyBtn");
    const undoBtn = document.getElementById("undoBtn");
    const saveBtn = document.getElementById("saveBtn");
    const saveMergeBtn = document.getElementById("saveMergeBtn");
    const removeBtn = document.getElementById("removeBtn");

    if(applyBtn) applyBtn.disabled = pendingCount === 0;
    if(undoBtn) undoBtn.disabled = appliedCount === 0;
    if(saveBtn) saveBtn.disabled = appliedCount === 0;
    if(saveMergeBtn) saveMergeBtn.disabled = appliedCount === 0;
    if(removeBtn) removeBtn.disabled = pendingCount === 0;

    pendingList.innerHTML = "";

    // Show both applied (previewed) and pending selections
    [...appliedRedactions, ...selections].forEach((sel, i) => {
        const div = document.createElement("div");
        div.className = "pending-item";

        const isApplied = i < appliedRedactions.length;
        div.style.opacity = isApplied ? "0.6" : "1";
        if (isApplied) div.style.borderLeft = "3px solid #16a05a"; // Green indicator
        div.textContent = (isApplied ? "✓ " : "") + sel.label;

        // Only allow individual deletion for pending items
        if (!isApplied) {
            const btn = document.createElement("button");
            btn.className   = "remove-sel";
            btn.textContent = "✕";
            const pendingIndex = i - appliedRedactions.length;
            btn.onclick     = () => removeSelection(pendingIndex);
            div.appendChild(btn);
        }
        pendingList.appendChild(div);
    });
}

/**
 * Draw red rectangles on the viewer for selections on the current page.
 * We convert the stored PDF bbox back to screen coords via the viewport.
 */
function redrawSelections() {
    viewerContainer.querySelectorAll(".selection-rect, .redacted-rect").forEach(el => el.remove());
    if (!currentPdfDoc || !currentViewport) return;

    const offset = getCanvasOffset();
    const unrotatedHeight = currentViewport.viewBox[3] - currentViewport.viewBox[1];

    const drawBox = (sel, className) => {
        if (sel.page !== currentPage - 1) return;

        // Revert PyMuPDF coords (top-left) back to standard PDF coords (bottom-left)
        const stdX0 = sel.bbox[0];
        const stdY0 = unrotatedHeight - sel.bbox[1];
        const stdX1 = sel.bbox[2];
        const stdY1 = unrotatedHeight - sel.bbox[3];

        const [px0, py0] = currentViewport.convertToViewportPoint(stdX0, stdY0);
        const [px1, py1] = currentViewport.convertToViewportPoint(stdX1, stdY1);

        const screenX = offset.x + Math.min(px0, px1);
        const screenY = offset.y + Math.min(py0, py1);
        const w       = Math.abs(px1 - px0);
        const h       = Math.abs(py1 - py0);

        const rect = document.createElement("div");
        rect.className    = className;
        rect.style.left   = screenX + "px";
        rect.style.top    = screenY + "px";
        rect.style.width  = w + "px";
        rect.style.height = h + "px";
        viewerContainer.appendChild(rect);
    };

    selections.forEach(sel => drawBox(sel, "selection-rect"));
    appliedRedactions.forEach(sel => drawBox(sel, "redacted-rect"));
}

viewerContainer.addEventListener("scroll", redrawSelections);
window.addEventListener("resize", () => { if (currentPdfDoc) renderPage(currentPage); });
document.addEventListener("keydown", e => {
    if (e.key === "Enter") {
        const applyBtn = document.getElementById("applyBtn");
        if (applyBtn && !applyBtn.disabled) applyRemove();
    }
});

// ─── NAVIGATION ──────────────────────────────────────────────────────────────
function prevFile() { if (currentIndex > 0) loadFile(currentIndex - 1); }
function nextFile() { if (currentIndex < files.length - 1) loadFile(currentIndex + 1); }
function prevPage() { if (currentPage > 1)          { currentPage--; renderPage(currentPage); } }
function nextPage() { if (currentPage < totalPages)  { currentPage++; renderPage(currentPage); } }

// ─── REMOVE ──────────────────────────────────────────────────────────────────
// 1. Move selections to the preview stage
function applyRemove() {
    if (selections.length === 0) return;
    appliedRedactions.push(...selections);
    selections = [];
    updateSelectionUI();
    redrawSelections();
}


// 2. Undo the last previewed removal
function undoRedaction() {
    if (appliedRedactions.length === 0) return;
    appliedRedactions.pop();
    updateSelectionUI();
    redrawSelections();
}


async function saveDocument(withMerge = false) {
    if (!currentFilename || appliedRedactions.length === 0) return;

    // Check if they want to merge but haven't uploaded a file
    if (withMerge && !ackFilename) {
        setStatus("Please upload an Acknowledgement file first!", "error");
        return;
    }

    setStatus(withMerge ? "Merging & Saving…" : "Saving to folder…", "working");

    const saveBtn = document.getElementById("saveBtn");
    const saveMergeBtn = document.getElementById("saveMergeBtn");
    if(saveBtn) saveBtn.disabled = true;
    if(saveMergeBtn) saveMergeBtn.disabled = true;

    try {
        const res = await fetch(`${API}/remove`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                filename:   currentFilename,
                // Pass the appliedRedactions to the backend instead of 'selections'
                selections: appliedRedactions.map(s => ({ page: s.page, bbox: s.bbox })),
                ack_filename: withMerge ? ackFilename : null
            }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(err.detail || res.statusText);
        }

        const data = await res.json();
        setStatus(`✓ Saved: ${data.output}`, "success");

        // Load the freshly anonymized PDF from the backend safely
        await loadOutputFile(data.output);

        // Clear state
        appliedRedactions = [];
        clearSelections();
        await refreshOutputFiles();
    } catch (e) {
        setStatus("Error: " + e.message, "error");
    } finally {
        updateSelectionUI();
    }
}


async function refreshOutputFiles() {
    try {
        const res  = await fetch(`${API}/files`);
        const data = await res.json();
        outputFiles = data.output || [];
        const ul = document.getElementById("outputFiles");
        ul.innerHTML = "";
        outputFiles.forEach((f, i) => {
            const li = document.createElement("li");
            li.title = f;
            li.textContent = f.split("/").pop();
            li.style.cursor = "pointer"; // Make it look clickable
            li.onclick = () => loadOutputFile(f.split("/").pop()); // Load it when clicked
            ul.appendChild(li);
        });
    } catch { /* ignore */ }
}

// ─── STATUS ──────────────────────────────────────────────────────────────────
function setStatus(msg, type) {
    statusMsg.textContent = msg;
    statusMsg.className   = "status-msg " + (type || "");
}

// ─── INIT ────────────────────────────────────────────────────────────────────
folderModal.classList.remove("hidden");
document.getElementById("inputFolderInput").value  = String.raw`D:\Academic_Works\Anonymizer-Paper\input`;
document.getElementById("outputFolderInput").value = String.raw`D:\Academic_Works\Anonymizer-Paper\output`;