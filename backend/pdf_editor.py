import fitz  # PyMuPDF
import os
import shutil
import tempfile


def remove_text_from_pdf(input_pdf, output_pdf, selections):
    doc = fitz.open(input_pdf)

    for sel in selections:
        page = doc[sel["page"]]

        # 1. Removed the artificial + (-2, -2, 2, 2) expansion
        rect = fitz.Rect(sel["bbox"])

        # Get actual text blocks inside selection
        words = page.get_text("words")  # (x0, y0, x1, y1, word, block, line, word_no)

        for w in words:
            w_rect = fitz.Rect(w[:4])

            # 2. Check if they intersect at all
            if rect.intersects(w_rect):
                # Calculate the overlapping rectangle
                overlap = rect & w_rect

                # Calculate areas
                word_area = w_rect.width * w_rect.height
                overlap_area = overlap.width * overlap.height

                # Only redact if more than 20% of the word's area is inside the selection box.
                # This prevents slight brushing against line-heights from deleting whole words.
                if word_area > 0 and (overlap_area / word_area) > 0.20:
                    page.add_redact_annot(w_rect, fill=(1, 1, 1))

    # Apply redactions AFTER processing all
    for page in doc:
        page.apply_redactions()

    doc.save(output_pdf)
    doc.close()


def remove_metadata(pdf_path: str):
    """Strip all metadata from a PDF in-place using a safe temp-file swap."""
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".pdf")
    os.close(tmp_fd)
    try:
        doc = fitz.open(pdf_path)
        doc.set_metadata({})
        doc.del_xml_metadata()
        doc.save(tmp_path, garbage=4, deflate=True, clean=True)
        doc.close()
        shutil.move(tmp_path, pdf_path)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise