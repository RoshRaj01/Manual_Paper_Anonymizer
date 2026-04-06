from fastapi.responses import FileResponse
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import os
import shutil
import fitz
from converter import convert_to_pdf
from pdf_editor import remove_text_from_pdf, remove_metadata
from utils import list_files

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

INPUT_FOLDER  = r"D:\Academic_Works\Anonymizer-Paper\input"
OUTPUT_FOLDER = r"D:\Academic_Works\Anonymizer-Paper\output"
TEMP_FOLDER   = os.path.join(os.path.dirname(__file__), "temp")

os.makedirs(TEMP_FOLDER,   exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)


# ── helpers ──────────────────────────────────────────────────────────────────

def safe_name(filename: str) -> str:
    """Make a flat, filesystem-safe name from a relative path."""
    return filename.replace("/", "_").replace("\\", "_")


def get_page_rotations(pdf_path: str) -> list:
    """Return list of rotation values (0/90/180/270) for every page."""
    doc = fitz.open(pdf_path)
    rotations = [page.rotation for page in doc]
    doc.close()
    return rotations


def normalize_rotation(pdf_path: str):
    """
    Bake visual rotation into page content so every page reports 0°.
    Fixes upside-down / sideways rendering from Word COM exports.
    """
    import tempfile
    doc = fitz.open(pdf_path)
    needs_fix = any(page.rotation != 0 for page in doc)
    if not needs_fix:
        doc.close()
        return

    for page in doc:
        if page.rotation != 0:
            # set_rotation(0) resets the /Rotate entry without transforming content,
            # which visually "unrotates" the page in PDF terms.
            # To actually normalise we use a matrix approach:
            rot = page.rotation
            page.set_rotation(0)
            # apply the inverse rotation matrix to all content
            mat = fitz.Matrix(rot)  # rotation matrix for `rot` degrees
            page.transform(mat)

    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".pdf")
    os.close(tmp_fd)
    try:
        doc.save(tmp_path, garbage=4, deflate=True, clean=True)
        doc.close()
        shutil.move(tmp_path, pdf_path)
    except Exception:
        doc.close()
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


# ── endpoints ────────────────────────────────────────────────────────────────

@app.post("/upload-ack")
async def upload_ack(file: UploadFile = File(...)):
    """Uploads the acknowledgement file to the temp folder and returns the filename."""
    filepath = os.path.join(TEMP_FOLDER, "ack_temp.pdf")
    with open(filepath, "wb") as f:
        f.write(await file.read())
    return {"filename": "ack_temp.pdf"}

@app.post("/set-folders")
def set_folders(input_path: str, output_path: str):
    global INPUT_FOLDER, OUTPUT_FOLDER
    INPUT_FOLDER  = input_path
    OUTPUT_FOLDER = output_path
    os.makedirs(OUTPUT_FOLDER, exist_ok=True)
    return {"message": "Folders set", "input": INPUT_FOLDER, "output": OUTPUT_FOLDER}


@app.get("/files")
def get_files():
    return {
        "input":  list_files(INPUT_FOLDER),
        "output": list_files(OUTPUT_FOLDER),
    }


@app.get("/load-pdf")
def load_pdf(filename: str):
    """
    Convert DOC/DOCX→PDF if needed, return a servable URL + per-page rotations.
    The frontend uses rotations to draw the canvas correctly and map bbox coords.
    """
    path = os.path.join(INPUT_FOLDER, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    flat = safe_name(filename)

    if filename.lower().endswith((".doc", ".docx")):
        pdf_name = flat + ".pdf"
        pdf_path = os.path.join(TEMP_FOLDER, pdf_name)
        if not os.path.exists(pdf_path):
            convert_to_pdf(os.path.abspath(path), os.path.abspath(pdf_path))
        source = "converted"
    else:
        pdf_name = flat
        pdf_path = os.path.join(TEMP_FOLDER, pdf_name)
        shutil.copy2(path, pdf_path)
        source = "original"

    rotations = get_page_rotations(pdf_path)

    return {
        "pdf_url":   f"/serve-pdf/temp/{pdf_name}",
        "source":    source,
        "rotations": rotations,   # list[int], one per page
    }


@app.get("/serve-pdf/temp/{filename}")
def serve_temp_pdf(filename: str):
    path = os.path.join(TEMP_FOLDER, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path, media_type="application/pdf")


@app.get("/serve-pdf/output/{filename}")
def serve_output_pdf(filename: str):
    path = os.path.join(OUTPUT_FOLDER, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path, media_type="application/pdf")


@app.post("/remove")
def remove_text(data: dict):
    filename   = data.get("filename")
    selections = data.get("selections", [])
    ack_filename = data.get("ack_filename") # NEW

    if not filename:
        raise HTTPException(status_code=400, detail="filename is required")
    if not selections:
        raise HTTPException(status_code=400, detail="No selections provided")

    flat = safe_name(filename)

    if filename.lower().endswith((".doc", ".docx")):
        input_path = os.path.join(TEMP_FOLDER, flat + ".pdf")
    else:
        input_path = os.path.join(TEMP_FOLDER, flat)

    if not os.path.exists(input_path):
        raise HTTPException(status_code=404, detail=f"Source PDF not found: {input_path}")

    # Determine if an ack file was provided
    ack_path = os.path.join(TEMP_FOLDER, ack_filename) if ack_filename else None

    base_name       = os.path.splitext(os.path.basename(filename))[0]
    output_filename = f"{base_name}_anonymized.pdf"
    output_path     = os.path.join(OUTPUT_FOLDER, output_filename)

    try:
        remove_text_from_pdf(input_path, output_path, selections, ack_pdf=ack_path)
        remove_metadata(output_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "message":  "Processed successfully",
        "output":   output_filename,
        "pdf_url":  f"/serve-pdf/output/{output_filename}",
    }