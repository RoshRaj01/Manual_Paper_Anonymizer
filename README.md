# 📄 Paper Anonymizer

A web-based tool to anonymize research papers by removing author names, affiliations, and other identifying information before peer review.

---

## 🚀 Features

* 📂 Select input and output folders
* 📄 Supports **PDF, DOC, DOCX** files
* 🔄 Automatic **DOC/DOCX → PDF conversion** using Microsoft Word COM
* 🖱️ Interactive PDF viewer with drag-to-select redaction
* ✂️ Remove selected regions precisely (word-level redaction)
* 👁️ Preview removals before saving
* ↩️ Undo applied redactions
* 💾 Save anonymized files to output folder
* 🔗 Merge acknowledgement document (optional)
* 🧹 Removes PDF metadata for full anonymization

---

## 🏗️ Project Structure

```
Anonymizer-Paper/
│
├── backend/
│   ├── app.py              # FastAPI backend
│   ├── converter.py        # DOC/DOCX → PDF conversion (Word COM)
│   ├── pdf_editor.py       # Redaction + metadata removal
│   ├── utils.py            # File utilities
│   ├── requirements.txt    # Dependencies
│   └── temp/               # Temporary converted PDFs
│
├── input/                  # Input papers
├── output/                 # Anonymized papers
│
├── app.js                  # Frontend logic
├── index.html              # UI
├── style.css               # Styling
```
```
.
├── app.py              # FastAPI backend
├── converter.py        # DOC/DOCX → PDF conversion (Word COM)
├── pdf_editor.py       # Redaction + metadata removal
├── utils.py            # File utilities
├── requirements.txt    # Dependencies
│
├── index.html          # Frontend UI
├── app.js              # Frontend logic
├── style.css           # UI styling
│
├── input/              # Input papers
├── output/             # Anonymized papers
├── temp/               # Temporary converted PDFs

````

---

## ⚙️ Setup Instructions

### 1. Clone / Download

```bash
git clone <repo-url>
cd paper-anonymizer
````

---

### 2. Create Virtual Environment

```bash
python -m venv .venv
.venv\Scripts\activate   # Windows
```

---

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

Dependencies include:

* FastAPI
* PyMuPDF
* pywin32 (for Word conversion)

---

### 4. Enable Word COM (IMPORTANT)

```bash
python -m win32com.client.makepy
```

Then select:

```
Microsoft Word XX.X Object Library
```

⚠️ Requires:

* Windows OS
* Microsoft Word installed

---

### 5. Run Backend Server

```bash
uvicorn app:app --reload
```

Server runs at:

```
http://localhost:8000
```

---

### 6. Open Frontend

Open:

```
index.html
```

Or run via Live Server:

```
http://localhost:63342/.../index.html
```

---

## 🧠 How It Works

### 1. File Loading

* Backend lists files using `list_files()`
* DOC/DOCX files are converted using Word COM

### 2. PDF Rendering

* Uses **PDF.js** to render pages in browser
* Text layer enables accurate selection

### 3. Selection System

* User drags to select regions
* Coordinates are converted to PDF space

### 4. Redaction Engine

From `pdf_editor.py`:

* Extracts words using:

  ```python
  page.get_text("words")
  ```
* Removes only words intersecting selection
* Uses overlap threshold (>20%) for accuracy

### 5. Metadata Removal

```python
doc.set_metadata({})
doc.del_xml_metadata()
```

---

## 🧪 Workflow

1. Select input & output folders
2. Choose a paper from sidebar
3. Drag to select author/affiliation area
4. Click **REMOVE** (preview)
5. Click **SAVE** to finalize
6. (Optional) Upload acknowledgement and click **MERGE & SAVE**

---

## ⚠️ Known Limitations

* Word → PDF conversion may alter text positioning
* Complex layouts (multi-column, tables) may cause slight inaccuracies
* Requires Microsoft Word (not cross-platform)

---

## 🔮 Future Improvements

* 🤖 Auto-detect author sections
* 📊 Confidence score for anonymization
* 🧠 NLP-based entity removal (names, emails, institutions)
---

## 🛠️ Tech Stack

**Frontend:**

* HTML, CSS, JavaScript
* PDF.js

**Backend:**

* FastAPI
* PyMuPDF (fitz)
* pywin32 (Word COM)

---

## 📌 Notes

* Output files are saved as:

  ```
  <original_name>_anonymized.pdf
  ```
* Temporary files stored in `/temp`
* Supports recursive folder scanning

---

## 📸 Screenshots
<img width="1919" height="1030" alt="image" src="https://github.com/user-attachments/assets/e910fa4c-5fee-4249-9c2d-7eedde602543" />

---

## ⭐ Summary

This tool provides a **semi-automated anonymization pipeline** combining:

* manual precision (user selection)
* automated processing (word-level redaction + metadata removal)

Designed for **research paper review workflows** where bias-free evaluation is required.
